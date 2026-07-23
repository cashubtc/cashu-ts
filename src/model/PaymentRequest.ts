import { normalizeSecpPubkey } from '../crypto/curve_secp';
import { getTag, getTagInt, getTagScalar } from '../crypto/NUT10';
import type { P2PKOptions, P2PKTag } from '../crypto/NUT11';
import { P2PK_KNOWN_TAG_KEYS, p2pkOptionsToPRNut10, parseP2PKSecret } from '../crypto/NUT11';
import { encodeBase64toUint8, decodeCBOR, encodeCBOR, Bytes, normalizeMintUrl } from '../utils';
import { decodeBech32mToBytes, encodeBech32m } from '../utils/bech32m';
import { JSONInt } from '../utils/JSONInt';
import { decodeTLV, encodeTLV } from '../utils/tlv';
import type { DecodedTLVPaymentRequest } from '../utils/tlv';
import { PaymentRequestTransportType } from '../wallet/types';
import type {
  RawPaymentRequest,
  RawTransport,
  NUT10Option,
  PaymentRequestPayload,
  PaymentRequestTransport,
  SupportedMethod,
} from '../wallet/types';

import { Amount, type AmountLike } from './Amount';
import { CTSError } from './Errors';
import type { Proof } from './types/proof';

/**
 * Constructor options for {@link PaymentRequest}. Keys mirror the class properties; `amount` and
 * method `fee` values accept flexible input and are normalized on construction.
 */
export type PaymentRequestOptions = {
  id?: string;
  amount?: AmountLike;
  unit?: string;
  mints?: string[];
  description?: string;
  transport?: PaymentRequestTransport[];
  singleUse?: boolean;
  nut10?: NUT10Option;
  mintsPreferred?: boolean;
  supportedMethods?: Array<{ method: string; fee?: AmountLike }>;
};

export class PaymentRequest {
  public id?: string;
  public amount?: Amount;
  public unit?: string;
  public mints?: string[];
  public description?: string;
  public transport?: PaymentRequestTransport[];
  public singleUse?: boolean;
  public nut10?: NUT10Option;
  public mintsPreferred?: boolean;
  public supportedMethods?: SupportedMethod[];

  constructor(options: PaymentRequestOptions = {}) {
    this.id = options.id;
    this.unit = options.unit;
    this.mints = options.mints;
    this.description = options.description;
    this.transport = options.transport;
    this.nut10 = options.nut10;
    this.amount = options.amount !== undefined ? Amount.from(options.amount) : undefined;
    this.supportedMethods = options.supportedMethods?.map((m) => ({
      method: m.method,
      fee: m.fee !== undefined ? Amount.from(m.fee) : undefined,
    }));
    // Coerce the optional flags to real booleans (preserving `undefined` for the
    // absent/tri-state case) so an untyped CBOR value (`0`/`1`/`null`) can't leak a
    // non-boolean into the getter or get re-serialized verbatim over the wire.
    this.singleUse = options.singleUse === undefined ? undefined : Boolean(options.singleUse);
    this.mintsPreferred =
      options.mintsPreferred === undefined ? undefined : Boolean(options.mintsPreferred);
  }

  /**
   * Resolves the NUT-18 mint list strictness per spec.
   *
   * - `undefined` if no mint list is set (`mp` SHOULD be ignored)
   * - `true` if the list is strict (`mp` absent or `false`)
   * - `false` if the list is preferred/advisory (`mp === true`)
   */
  get isMintListStrict(): boolean | undefined {
    if (!this.mints?.length) {
      return undefined;
    }
    return this.mintsPreferred !== true;
  }

  /**
   * NUT-18: `u` MUST be set if `a` or `sm` is set: `mf` and the melt-method check are denominated
   * in the request unit. Enforced when encoding or pricing; parsing stays lenient so foreign
   * requests can still be inspected.
   */
  private assertUnitRule(): void {
    if (!this.unit && (this.amount !== undefined || this.supportedMethods?.length)) {
      throw new CTSError(
        'invalid payment request: unit (u) is required when an amount (a) or supported methods (sm) are set',
      );
    }
  }

  /**
   * The per-method fee (`mf`) the payer must add when paying from `mint`: `0` if `mint` is in the
   * mint list, otherwise the lowest fee among the `sm` methods that `meltMethods` says the mint
   * supports (NUT-18).
   *
   * Use this for amountless requests (where the payer chooses the amount): add the result to the
   * chosen amount. This prices only the fee that applies; it does NOT validate admissibility (e.g.
   * a strict mint list, or a mint supporting none of `sm`) — callers that must reject disallowed
   * mints/methods check that separately.
   *
   * @param mint - The mint URL the payer will send from.
   * @param meltMethods - The methods the mint can melt the request unit via (its NUT-05 melt
   *   methods, matched against `sm`); omit if unknown (prices as `0`).
   * @throws If the request sets `a` or `sm` without `u` (invalid per NUT-18; `mf` is denominated in
   *   the request unit).
   */
  feesFor(mint: string, meltMethods?: string[]): Amount {
    this.assertUnitRule();
    // Fees compensate the payee for melting out: payments from a listed mint carry none.
    if (!this.supportedMethods?.length || this.mints?.includes(mint)) {
      return Amount.zero();
    }
    const applicable = this.supportedMethods
      .filter((m) => meltMethods?.includes(m.method))
      .map((m) => m.fee ?? Amount.zero());
    if (!applicable.length) {
      return Amount.zero();
    }
    return applicable.reduce((min, fee) => Amount.min(min, fee));
  }

  /**
   * The total amount to send from `mint`: the requested amount plus
   * {@link PaymentRequest.feesFor | feesFor}.
   *
   * @param mint - The mint URL the payer will send from.
   * @param meltMethods - The methods the mint can melt the request unit via (its NUT-05 melt
   *   methods, matched against `sm`); omit if unknown.
   * @throws If the request has no amount (amountless requests have no base to add fees to; use
   *   {@link PaymentRequest.feesFor | feesFor} and add it to the amount the payer chooses), or no
   *   unit (invalid per NUT-18).
   */
  amountToSend(mint: string, meltMethods?: string[]): Amount {
    if (!this.amount) {
      throw new CTSError(
        'cannot compute amount to send: request has no amount; use feesFor() and add the payer-chosen amount',
      );
    }
    return this.amount.add(this.feesFor(mint, meltMethods));
  }

  /**
   * Whether `mintUrl` is in the request's mint list, compared after URL normalization.
   *
   * @remarks
   * Foreign requests may carry non-normalized or unparsable entries; those fall back to a raw
   * string comparison. `false` when the request has no mint list.
   */
  includesMint(mintUrl: string): boolean {
    const norm = (u: string) => {
      try {
        return normalizeMintUrl(u);
      } catch {
        return u;
      }
    };
    const target = norm(mintUrl);
    return this.mints?.some((m) => norm(m) === target) ?? false;
  }

  /**
   * Serializes the default NUT-18 payment payload for this request.
   *
   * @remarks
   * BigInt-safe JSON; plain `JSON.stringify` throws on proof amounts. Proofs must come from `mint`
   * and net the request after fees: `wallet.ops.sendToRequest` produces both, this only packages.
   * Send it as the POST body or Nostr DM content.
   * @param mint - The mint the proofs are from.
   * @param proofs - The proofs to send (eg the `send` half of a send flow).
   * @param opts.memo - Optional memo for the payee.
   * @param opts.unit - Unit when the request has none (default 'sat').
   * @throws If the request has a strict mint list and `mint` is not in it.
   */
  encodePayload(mint: string, proofs: Proof[], opts?: { memo?: string; unit?: string }): string {
    if (this.isMintListStrict && !this.includesMint(mint)) {
      throw new CTSError("mint is not in the request's strict mint list");
    }
    const payload: PaymentRequestPayload = {
      ...(this.id !== undefined && { id: this.id }),
      ...(opts?.memo !== undefined && { memo: opts.memo }),
      unit: this.unit ?? opts?.unit ?? 'sat',
      mint,
      proofs,
    };
    return JSONInt.stringify(payload)!;
  }

  /**
   * Parses a default NUT-18 payment payload received from a payer.
   *
   * @remarks
   * BigInt-safe: proof amounts are normalized to `bigint` whatever their JSON size. Validates shape
   * only; matching the payload to a request (id, mint, netting the amount) is the payee's job.
   * @param json - Raw payload text (POST body or Nostr DM content).
   * @throws {@link CTSError} If the text is not valid JSON or not payload-shaped.
   */
  static decodePayload(json: string): PaymentRequestPayload {
    let raw: unknown;
    try {
      raw = JSONInt.parse(json, undefined, { strict: true });
    } catch (e) {
      throw new CTSError('invalid payment payload: not valid JSON', { cause: e });
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new CTSError('invalid payment payload: expected a JSON object');
    }
    const { id, memo, unit, mint, proofs } = raw as Record<string, unknown>;
    if (typeof mint !== 'string' || !mint) {
      throw new CTSError('invalid payment payload: missing mint');
    }
    if (typeof unit !== 'string' || !unit) {
      throw new CTSError('invalid payment payload: missing unit');
    }
    if (id !== undefined && typeof id !== 'string') {
      throw new CTSError('invalid payment payload: id must be a string');
    }
    if (memo !== undefined && typeof memo !== 'string') {
      throw new CTSError('invalid payment payload: memo must be a string');
    }
    if (!Array.isArray(proofs) || proofs.length === 0) {
      throw new CTSError('invalid payment payload: missing proofs');
    }
    const normalized = proofs.map((p: unknown, i: number) => {
      if (
        typeof p !== 'object' ||
        p === null ||
        Array.isArray(p) ||
        typeof (p as Record<string, unknown>).id !== 'string' ||
        typeof (p as Record<string, unknown>).secret !== 'string' ||
        typeof (p as Record<string, unknown>).C !== 'string'
      ) {
        throw new CTSError(`invalid payment payload: malformed proof at index ${i}`);
      }
      const amount = (p as Record<string, unknown>).amount;
      if (typeof amount !== 'number' && typeof amount !== 'bigint') {
        throw new CTSError(`invalid payment payload: malformed proof amount at index ${i}`);
      }
      return { ...p, amount: Amount.from(amount).toBigInt() } as unknown as Proof;
    });
    return {
      ...(id !== undefined && { id }),
      ...(memo !== undefined && { memo }),
      unit,
      mint,
      proofs: normalized,
    };
  }

  toRawRequest() {
    this.assertUnitRule();
    const rawRequest: RawPaymentRequest = {};
    if (this.transport) {
      rawRequest.t = this.transport.map((t: PaymentRequestTransport) => ({
        t: t.type,
        a: t.target,
        g: t.tags,
      }));
    }
    if (this.id) {
      rawRequest.i = this.id;
    }
    if (this.amount) {
      rawRequest.a = this.amount.toBigInt();
    }
    if (this.unit) {
      rawRequest.u = this.unit;
    }
    if (this.mints) {
      rawRequest.m = this.mints;
    }
    if (this.mintsPreferred !== undefined) {
      rawRequest.mp = this.mintsPreferred;
    }
    if (this.supportedMethods && this.supportedMethods.length > 0) {
      rawRequest.sm = this.supportedMethods.map((m) =>
        m.fee !== undefined ? { mn: m.method, mf: m.fee.toBigInt() } : { mn: m.method },
      );
    }
    if (this.description) {
      rawRequest.d = this.description;
    }
    if (this.singleUse !== undefined) {
      rawRequest.s = this.singleUse;
    }
    if (this.nut10) {
      rawRequest.nut10 = {
        k: this.nut10.kind,
        d: this.nut10.data,
        t: this.nut10.tags,
      };
    }
    return rawRequest;
  }

  toEncodedRequest(): string {
    const rawRequest: RawPaymentRequest = this.toRawRequest();
    const data = encodeCBOR(rawRequest);
    const encodedData = Bytes.toBase64(data);
    return 'creq' + 'A' + encodedData;
  }

  /**
   * Encodes the payment request to creqA format (CBOR).
   *
   * @returns A base64 encoded payment request string with 'creqA' prefix.
   */
  toEncodedCreqA(): string {
    return this.toEncodedRequest();
  }

  /**
   * Encodes the payment request to creqB format (TLV + bech32m).
   *
   * @returns A bech32m encoded payment request string with 'CREQB' prefix.
   * @experimental
   */
  toEncodedCreqB(): string {
    this.assertUnitRule();
    const tlvRequest: DecodedTLVPaymentRequest = {
      id: this.id,
      amount: this.amount !== undefined ? this.amount.toBigInt() : undefined,
      unit: this.unit,
      singleUse: this.singleUse,
      mints: this.mints,
      mintsPreferred: this.mintsPreferred,
      supportedMethods: this.supportedMethods?.map((m) => ({
        method: m.method,
        fee: m.fee !== undefined ? m.fee.toBigInt() : undefined,
      })),
      description: this.description,
      transports: this.transport,
      nut10: this.nut10
        ? {
            kind: this.nut10.kind,
            data: this.nut10.data,
            tags: this.nut10.tags,
          }
        : undefined,
    };

    const tlvBytes = encodeTLV(tlvRequest);
    return encodeBech32m('creqb', tlvBytes).toUpperCase();
  }

  getTransport(type: PaymentRequestTransportType) {
    return this.transport?.find((t: PaymentRequestTransport) => t.type === type);
  }

  /**
   * A fresh {@link PaymentRequestBuilder}.
   */
  static builder(): PaymentRequestBuilder {
    return new PaymentRequestBuilder();
  }

  /**
   * Converts this request's `nut10` locking option into a {@link P2PKOptions} for the wallet's
   * `.asP2PK()` gate, so a payer can lock proofs to exactly the condition the payee requested.
   *
   * @remarks
   * Supports `P2PK` (NUT-11) and `HTLC` (NUT-14) only; returns `undefined` for no `nut10` or an
   * unbuildable kind.
   * @throws If the option is missing its `data` field, carries malformed NUT-10 tags, or holds a
   *   non-compliant pubkey (x-only or off-curve). Paying this request creates new outputs under the
   *   lock, so invalid lock semantics must not be silently dropped or repaired.
   */
  toP2PKOptions(): P2PKOptions | undefined {
    const nut10 = this.nut10;
    const isHTLC = nut10?.kind === 'HTLC';
    if (!nut10 || (nut10.kind !== 'P2PK' && !isHTLC)) {
      return undefined;
    }
    if (!nut10.data) {
      throw new CTSError(`NUT-10 ${nut10.kind} option is missing its data field`);
    }

    // Use parseP2PKSecret (the parser the verifier uses): it rejects malformed
    // tags, duplicate tag keys and bad sigflags — all of which NUT-11 says make a
    // proof unspendable — so a bad lock fails loudly instead of silently first-winning.
    const secret = parseP2PKSecret([
      nut10.kind,
      { nonce: '', data: nut10.data, tags: nut10.tags ?? [] },
    ]);
    // `data` is the NUT-10 data slot (hashlock for HTLC, primary pubkey for P2PK);
    // the `pubkeys` tag carries the optional additional / receiver keys for either kind.
    const taggedPubkeys = (getTag(secret, 'pubkeys') ?? []).map(normalizeSecpPubkey);
    const options: P2PKOptions = {
      kind: isHTLC ? 'HTLC' : 'P2PK',
      data: isHTLC ? nut10.data : normalizeSecpPubkey(nut10.data),
      ...(taggedPubkeys.length ? { pubkeys: taggedPubkeys } : {}),
    };

    // Optional fields pass straight through: the accessors return undefined when
    // absent, and the builder ignores undefined options. getTag never yields [].
    options.locktime = getTagInt(secret, 'locktime');
    options.refundKeys = getTag(secret, 'refund')?.map(normalizeSecpPubkey);
    options.requiredSignatures = getTagInt(secret, 'n_sigs');
    options.requiredRefundSignatures = getTagInt(secret, 'n_sigs_refund');
    if (getTagScalar(secret, 'sigflag') === 'SIG_ALL') {
      options.sigFlag = 'SIG_ALL';
    }

    // Forward any non-standard tags verbatim.
    const additionalTags = (nut10.tags ?? []).filter(
      (t) => t.length > 0 && !P2PK_KNOWN_TAG_KEYS.has(t[0]),
    ) as P2PKTag[];
    if (additionalTags.length > 0) {
      options.additionalTags = additionalTags;
    }

    return options;
  }

  /**
   * Creates a PaymentRequest from a raw payment request. Supports both creqA and creqB versions.
   *
   * @param rawPaymentRequest - The raw payment request string to create a PaymentRequest from.
   * @returns A PaymentRequest object.
   * @throws An error if the raw payment request is not supported.
   */
  static fromRawRequest(rawPaymentRequest: RawPaymentRequest): PaymentRequest {
    const transports = rawPaymentRequest.t
      ? rawPaymentRequest.t.map((t: RawTransport) => ({
          type: t.t,
          target: t.a,
          tags: t.g,
        }))
      : undefined;
    const nut10 = rawPaymentRequest.nut10
      ? {
          kind: rawPaymentRequest.nut10.k,
          data: rawPaymentRequest.nut10.d,
          tags: rawPaymentRequest.nut10.t,
        }
      : undefined;
    const supportedMethods = rawPaymentRequest.sm?.map((m) => ({ method: m.mn, fee: m.mf }));
    return new PaymentRequest({
      transport: transports,
      id: rawPaymentRequest.i,
      amount: rawPaymentRequest.a,
      unit: rawPaymentRequest.u,
      mints: rawPaymentRequest.m,
      description: rawPaymentRequest.d,
      singleUse: rawPaymentRequest.s,
      nut10,
      mintsPreferred: rawPaymentRequest.mp,
      supportedMethods,
    });
  }

  static fromEncodedRequest(encodedRequest: string): PaymentRequest {
    const lowerRequest = encodedRequest.toLowerCase();

    // Version B: bech32m + TLV encoding (creqb...)
    if (lowerRequest.startsWith('creqb')) {
      const data = decodeBech32mToBytes(lowerRequest);
      const decoded = decodeTLV(data);
      const nut10 = decoded.nut10
        ? {
            kind: decoded.nut10.kind,
            data: decoded.nut10.data,
            tags: decoded.nut10.tags ?? [],
          }
        : undefined;
      return new PaymentRequest({
        transport: decoded.transports,
        id: decoded.id,
        amount: decoded.amount,
        unit: decoded.unit,
        mints: decoded.mints,
        description: decoded.description,
        singleUse: decoded.singleUse,
        nut10,
        mintsPreferred: decoded.mintsPreferred,
        supportedMethods: decoded.supportedMethods,
      });
    }

    // Version A: CBOR encoding (creqA...)
    if (!encodedRequest.startsWith('creq')) {
      throw new CTSError('unsupported pr: invalid prefix');
    }
    const version = encodedRequest[4];
    if (version !== 'A') {
      throw new CTSError('unsupported pr version');
    }
    const encodedData = encodedRequest.slice(5);
    const data = encodeBase64toUint8(encodedData);
    const decoded = decodeCBOR(data) as RawPaymentRequest;
    return this.fromRawRequest(decoded);
  }
}

/**
 * Fluent builder for authoring a {@link PaymentRequest} (NUT-18).
 *
 * @remarks
 * Setters collect state in any order and never throw on cross-field state; `build()` is the single
 * validation point. The {@link PaymentRequest} class itself stays lenient because it is also the
 * decode type for foreign requests.
 */
export class PaymentRequestBuilder {
  private _id?: string;
  private _amount?: AmountLike;
  private _unit?: string;
  private _description?: string;
  private _mints: string[] = [];
  private _mintsPreferred?: boolean;
  private _singleUse?: boolean;
  private _transports: PaymentRequestTransport[] = [];
  private _nut10?: NUT10Option;
  private _methods: Array<{ method: string; fee?: AmountLike }> = [];

  /**
   * Sets the optional payment ID reference.
   */
  id(id: string): this {
    this._id = id;
    return this;
  }

  /**
   * Sets the requested amount and its unit together (NUT-18: `u` MUST be set when `a` is set).
   *
   * @throws If the unit is empty.
   */
  amount(amount: AmountLike, unit: string): this {
    if (!unit) {
      throw new CTSError('amount requires a unit (NUT-18: `u` MUST be set when `a` is set)');
    }
    this._amount = amount;
    this._unit = unit;
    return this;
  }

  /**
   * Sets the unit for an amountless request. The last write here or via `amount()` wins.
   *
   * @throws If the unit is empty.
   */
  unit(unit: string): this {
    if (!unit) {
      throw new CTSError('unit must be a non-empty string');
    }
    this._unit = unit;
    return this;
  }

  /**
   * A human readable description for the payment request.
   */
  description(description: string): this {
    this._description = description;
    return this;
  }

  /**
   * Appends to the mint list; URLs are normalized (as `Mint` does) and deduplicated, first-seen
   * order preserved.
   *
   * @throws If a URL is not a valid mint URL.
   */
  addMint(mint: string | string[]): this {
    const arr = Array.isArray(mint) ? mint : [mint];
    for (const m of arr) {
      const normalized = normalizeMintUrl(m);
      if (!this._mints.includes(normalized)) this._mints.push(normalized);
    }
    return this;
  }

  /**
   * Marks the mint list advisory (`mp`) rather than strict; requires mints at `build()`.
   */
  mintsPreferred(preferred = true): this {
    this._mintsPreferred = preferred;
    return this;
  }

  singleUse(single = true): this {
    this._singleUse = single;
    return this;
  }

  /**
   * Appends a transport; order is preference order (NUT-18).
   */
  addTransport(transport: PaymentRequestTransport): this {
    this._transports.push(transport);
    return this;
  }

  /**
   * Appends a nostr transport for the given NIPs (default NIP-17 direct messages).
   *
   * @throws If the target is not an nprofile, or `nips` is empty (the `n` tag MUST carry at least
   *   one value).
   */
  addNostrTransport(nprofile: string, nips: string[] = ['17']): this {
    if (!nprofile.startsWith('nprofile1')) {
      throw new CTSError('nostr transport target must be an nprofile');
    }
    if (nips.length === 0) {
      throw new CTSError('nostr transport requires at least one NIP (`n` tag value)');
    }
    return this.addTransport({
      type: PaymentRequestTransportType.NOSTR,
      target: nprofile,
      tags: [['n', ...nips.map(String)]],
    });
  }

  /**
   * Appends an HTTP POST transport; the payer POSTs the payment payload to `url`.
   */
  addHttpPostTransport(url: string): this {
    return this.addTransport({ type: PaymentRequestTransportType.POST, target: url });
  }

  /**
   * Appends a NUT-05 melting method the payee accepts (`sm`), with an optional per-method fee.
   *
   * @throws If the method name is empty.
   */
  addSupportedMethod(method: string, fee?: AmountLike): this {
    if (!method) {
      throw new CTSError('supported method name must be a non-empty string');
    }
    this._methods.push({ method, fee });
    return this;
  }

  /**
   * Sets the `nut10` locking condition from a complete P2PK/HTLC {@link P2PKOptions} (e.g. from
   * `P2PKBuilder.toOptions()`). Last call here or via `nut10()` wins.
   *
   * @throws If the lock is invalid or uses `blindKeys` (not expressible in a request).
   */
  lock(p2pk: P2PKOptions): this {
    this._nut10 = p2pkOptionsToPRNut10(p2pk);
    return this;
  }

  /**
   * Sets the `nut10` locking condition verbatim, for kinds `lock()` cannot express.
   */
  nut10(option: NUT10Option): this {
    this._nut10 = option;
    return this;
  }

  /**
   * Validates cross-field state and constructs the {@link PaymentRequest}.
   *
   * @throws If `mintsPreferred` is set without mints (NUT-18 ignores `mp` without `m`), a supported
   *   method is listed twice, or supported methods are set without a unit (NUT-18: `u` MUST be set
   *   when `sm` is set).
   */
  build(): PaymentRequest {
    if (this._mintsPreferred !== undefined && this._mints.length === 0) {
      throw new CTSError('mintsPreferred (mp) requires a mint list; add mints or drop the flag');
    }
    if (this._methods.length > 0 && !this._unit) {
      throw new CTSError(
        'supported methods (sm) require a unit; set it via amount(value, unit) or unit()',
      );
    }
    const seen = new Set<string>();
    for (const m of this._methods) {
      if (seen.has(m.method)) {
        throw new CTSError(`duplicate supported method "${m.method}"`);
      }
      seen.add(m.method);
    }
    // Copy the collected arrays so reusing the builder cannot mutate the built request.
    return new PaymentRequest({
      id: this._id,
      amount: this._amount,
      unit: this._unit,
      mints: this._mints.length ? [...this._mints] : undefined,
      description: this._description,
      transport: this._transports.length ? [...this._transports] : undefined,
      singleUse: this._singleUse,
      nut10: this._nut10,
      mintsPreferred: this._mintsPreferred,
      supportedMethods: this._methods.length ? this._methods : undefined,
    });
  }
}
