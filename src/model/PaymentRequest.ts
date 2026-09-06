import { equalBytes } from '@noble/curves/utils.js';

import { normalizeSecpPubkey } from '../crypto/curve_secp';
import { getTag, getTagInt, getTagScalar } from '../crypto/NUT10';
import type { P2PKOptions, P2PKTag } from '../crypto/NUT11';
import { P2PK_KNOWN_TAG_KEYS, p2pkOptionsToPRNut10, parseP2PKSecret } from '../crypto/NUT11';
import {
  parseNutrootLeaf,
  serializeNutrootLeaf,
  serializeNutrootLeafHex,
  NUTROOT_MAX_TREE_LEAVES,
  NUTROOT_NUMS_KEY,
  type ParsedNutrootOption,
} from '../crypto/nutroot';
import {
  decodeBase64ToUint8Legacy,
  decodeBase64UrlToUint8,
  decodeCBOR,
  hexToBytes,
  encodeCBOR,
  encodeUint8ToBase64UrlPadded,
  normalizeMintUrl,
} from '../utils';
import { decodeBech32m, encodeBech32m } from '../utils/bech32m';
import { JSONInt } from '../utils/JSONInt';
import { decodeTLV, encodeTLV } from '../utils/tlv';
import type { DecodedTLVPaymentRequest } from '../utils/tlv';
import { lockToNutrootOptions, lockToP2PKOptions, type LockOptions } from '../wallet/lock';
import type { LockBuilder } from '../wallet/LockBuilder';
import { PaymentRequestTransportType } from '../wallet/types';
import type {
  RawPaymentRequest,
  RawTransport,
  NUT10Option,
  PaymentRequestPayload,
  PaymentRequestTransport,
  SupportedMethod,
  NutrootOption,
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
  nutroot?: NutrootOption;
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
  public nutroot?: NutrootOption;

  constructor(options: PaymentRequestOptions = {}) {
    this.id = options.id;
    this.nutroot = options.nutroot;
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
   * Plain `JSON.stringify` can't serialize the bigint proof amounts, so use this. Proofs must come
   * from `mint` and net the request after fees: `wallet.ops.sendToRequest` produces both, this only
   * packages. Send it as the POST body or Nostr DM content.
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
   * Validates payload shape only. To confirm the payment settles the request, pass the result to
   * {@link Wallet.isPaymentRequestSatisfied}. Imposes no size limit of its own: cap the raw text at
   * the transport (POST body, DM) before decoding.
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
      if (typeof amount === 'string') {
        // A quoted amount is the tell-tale of plain JSON.stringify over bigint proofs (or an
        // Amount VO via toJSON). NUT-18 amounts are JSON numbers: point the payer at the encoder.
        throw new CTSError(
          `invalid payment payload: proof amount at index ${i} is a string; amounts must be JSON numbers (serialize with encodePayload() or JSONInt.stringify, not JSON.stringify)`,
        );
      }
      if (typeof amount !== 'number' && typeof amount !== 'bigint') {
        throw new CTSError(`invalid payment payload: malformed proof amount at index ${i}`);
      }
      return { ...(p as Omit<Proof, 'amount'>), amount: Amount.from(amount) };
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
    if (this.nutroot) {
      rawRequest.nutroot = {
        k: this.nutroot.receiverKey,
        ...(this.nutroot.leaves?.length && { l: this.nutroot.leaves }),
        ...(this.nutroot.blindKeys?.length && { b: this.nutroot.blindKeys }),
      };
    }
    return rawRequest;
  }

  toEncodedRequest(): string {
    const rawRequest: RawPaymentRequest = this.toRawRequest();
    const data = encodeCBOR(rawRequest);
    const encodedData = encodeUint8ToBase64UrlPadded(data);
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
      nutroot: this.nutroot,
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
   * Converts this request's `nut10` locking option into a wire {@link P2PKOptions}; decode with
   * `p2pkToLockOptions()` for `.asLocked()`, so a payer locks proofs to exactly the requested
   * condition.
   *
   * @remarks
   * Supports `P2PK` (NUT-11) and `HTLC` (NUT-14) only; returns `undefined` for no `nut10` or an
   * unbuildable kind.
   * @throws If the option is missing its `data` field, carries malformed NUT-10 tags, or holds a
   *   non-compliant pubkey (x-only or off-curve). Paying this request creates new outputs under the
   *   lock, so invalid lock semantics must not be silently dropped or repaired.
   */
  toP2PKOptions(): P2PKOptions | undefined {
    return nut10ToP2PKOptions(this.nut10);
  }

  /**
   * Converts this request's `nutroot` option into the arguments for a receiver-keyed nutroot send
   * (NUT-28), so a payer can derive outputs to the payee's static key under the tree they asked
   * for, honouring their blind-me tags.
   *
   * @remarks
   * `undefined` when the request carries no nutroot option. Leaves must round-trip byte for byte: a
   * payer that cannot reproduce the payee's exact leaf bytes would build a different tree, hence a
   * different secret, so it refuses rather than paying to something the payee did not ask for.
   * @throws If the receiver key is not a valid point, or a requested leaf is unparsable or would
   *   not re-serialize to the bytes the payee sent.
   */
  toNutrootOptions(): ParsedNutrootOption | undefined {
    const nutroot = this.nutroot;
    if (!nutroot) return undefined;
    if (!nutroot.receiverKey) {
      throw new CTSError('nutroot option is missing its receiver key');
    }
    const receiverKey = normalizeSecpPubkey(nutroot.receiverKey);
    // NUT-10: the payer offsets the NUMS base per output, so uniqueness no longer depends on
    // the tree and the requested leaves are reproduced unchanged. Leaves are still required:
    // nothing else could spend a proof with no key path.
    if (receiverKey === NUTROOT_NUMS_KEY && !nutroot.leaves?.length) {
      throw new CTSError('malformed request: a NUMS receiver key requires leaves');
    }
    if (!nutroot.leaves?.length) {
      if (nutroot.blindKeys?.length) {
        throw new CTSError('malformed request: blind-me keys require a tree');
      }
      return { receiverKey };
    }
    if (nutroot.leaves.length > NUTROOT_MAX_TREE_LEAVES) {
      throw new CTSError(`nutroot tree exceeds ${NUTROOT_MAX_TREE_LEAVES} leaves`);
    }
    const leaves = nutroot.leaves.map((hex, i) => {
      const bytes = hexToBytes(hex);
      const leaf = parseNutrootLeaf(bytes);
      /* v8 ignore next 3 -- backstop: parseNutrootLeaf admits only canonical bytes today */
      if (!equalBytes(serializeNutrootLeaf(leaf), bytes)) {
        throw new CTSError(`requested leaf ${i} does not round-trip: cannot reproduce its bytes`);
      }
      return leaf;
    });
    const blindKeys = (nutroot.blindKeys ?? []).map((key) => normalizeSecpPubkey(key));
    const leafKeys = new Set(leaves.flatMap((leaf) => leaf.keys));
    for (const key of blindKeys) {
      if (!leafKeys.has(key)) {
        throw new CTSError(`blind-me key is not in the requested tree: ${key}`);
      }
    }
    return {
      receiverKey,
      leaves,
      ...(blindKeys.length && { blindKeys }),
    };
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
    const nutroot = rawPaymentRequest.nutroot
      ? {
          receiverKey: rawPaymentRequest.nutroot.k,
          leaves: rawPaymentRequest.nutroot.l,
          blindKeys: rawPaymentRequest.nutroot.b,
        }
      : undefined;
    return new PaymentRequest({
      nutroot,
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
      // The HRP must be exactly `creqb` (NUT-26); a longer HRP shares the prefix but is not it.
      const { hrp, data } = decodeBech32m(lowerRequest);
      if (hrp !== 'creqb') {
        throw new CTSError('unsupported pr: invalid prefix');
      }
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
        nutroot: decoded.nutroot,
      });
    }

    // Version A: CBOR encoding (creqA...). The prefix check is case-insensitive (NUT-26);
    // the base64 payload keeps its case.
    if (!lowerRequest.startsWith('creq')) {
      throw new CTSError('unsupported pr: invalid prefix');
    }
    const version = lowerRequest[4];
    if (version !== 'a') {
      throw new CTSError('unsupported pr version');
    }
    const encodedData = encodedRequest.slice(5);
    // NUT-18 mandates base64url, but requests this library emitted before it encoded that way
    // are standard base64 and still in circulation. CDK falls back the same way, and only here.
    let data: Uint8Array;
    try {
      data = decodeBase64UrlToUint8(encodedData);
    } catch (urlSafeError) {
      try {
        data = decodeBase64ToUint8Legacy(encodedData);
      } catch {
        throw urlSafeError;
      }
    }
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
  private _nutroot?: NutrootOption;
  private _omitted: { nut10?: string; nutroot?: string } = {};

  /**
   * Why the last `lock()` left an encoding out, per encoding; empty when nothing was dropped.
   *
   * @remarks
   * Lets a caller tell a deliberate omission (eg no `nut10` for blinded keys or disclosure) from a
   * bug, and show the reason. Reset by the next `lock()`.
   */
  get omitted(): Readonly<{ nut10?: string; nutroot?: string }> {
    return { ...this._omitted };
  }
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
   * Sets the locking condition from semantic {@link LockOptions}, a {@link LockBuilder}, or wire
   * {@link P2PKOptions}. Replaces any condition set earlier.
   *
   * @remarks
   * Semantic input is encoded as `nutroot` (the current spec) and, while `legacy` is not `false`,
   * also as `nut10` so payers that predate v3 can pay: a NUT-18 transition measure. Wire
   * `P2PKOptions` target `nut10` alone; `requestNutroot()` makes a deliberately v3-only request.
   * @throws If no permitted encoding can express the lock, or a wire lock is invalid.
   */
  lock(lock: LockOptions | LockBuilder | P2PKOptions, opts?: { legacy?: boolean }): this {
    const semantic = asLockOptions(lock);
    this._omitted = {};
    if (!semantic) {
      this._nut10 = p2pkOptionsToPRNut10(lock as P2PKOptions);
      this._nutroot = undefined;
      return this;
    }
    const omitted: { nut10?: string; nutroot?: string } = {};
    const tryEncode = <T>(key: keyof typeof omitted, encode: () => T): T | undefined => {
      try {
        return encode();
      } catch (e) {
        omitted[key] = e instanceof Error ? e.message : String(e);
        return undefined;
      }
    };
    const nut10 =
      opts?.legacy === false
        ? undefined
        : tryEncode('nut10', () => p2pkOptionsToPRNut10(lockToP2PKOptions(semantic)));
    const nutroot = tryEncode('nutroot', () => encodeNutrootRequest(semantic));
    if (!nut10 && !nutroot) {
      throw new CTSError(
        `lock fits no permitted request encoding: ${Object.values(omitted).join('; ')}`,
      );
    }
    this._omitted = omitted;
    this._nut10 = nut10;
    this._nutroot = undefined;
    if (nutroot) this.requestNutroot(nutroot);
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
   * Requests nutroot (v3 keyset) outputs derived to `receiverKey`, optionally under a tree.
   *
   * @remarks
   * NUT-28: the receiver key is blinded at slot 0 by the payer, so one request can be reused
   * without linking payments. The payer assigns slots in transmitted leaf order; the receiver
   * derives every occupied slot and matches keys by value. `blindKeys` names the leaf keys to
   * blind.
   * @throws If the receiver key is not a valid point, a leaf is unparsable, or a blind-me key is
   *   not one of the leaves' keys.
   */
  requestNutroot(lock: NutrootOption | LockOptions | LockBuilder): this {
    const semantic = asLockOptions(lock);
    const option: NutrootOption = semantic
      ? encodeNutrootRequest(semantic)
      : (lock as NutrootOption);
    const nutroot: NutrootOption = {
      receiverKey: normalizeSecpPubkey(option.receiverKey),
      ...(option.leaves?.length && { leaves: [...option.leaves] }),
      ...(option.blindKeys?.length && {
        blindKeys: option.blindKeys.map((k) => normalizeSecpPubkey(k)),
      }),
    };
    if ((nutroot.leaves?.length ?? 0) > NUTROOT_MAX_TREE_LEAVES) {
      throw new CTSError(`nutroot tree exceeds ${NUTROOT_MAX_TREE_LEAVES} leaves`);
    }
    // Validate here rather than at build(): a request nobody can pay is worth catching at the
    // point the payee wrote it, not at the payer.
    const leafKeys = new Set(
      (nutroot.leaves ?? []).flatMap((hex) => parseNutrootLeaf(hexToBytes(hex)).keys),
    );
    for (const key of nutroot.blindKeys ?? []) {
      if (!leafKeys.has(key)) {
        throw new CTSError(`blind-me key is not in the requested tree: ${key}`);
      }
    }
    if (nutroot.receiverKey === NUTROOT_NUMS_KEY && !nutroot.leaves?.length) {
      throw new CTSError('A NUMS receiver key requires leaves');
    }
    this._nutroot = nutroot;
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
      nutroot: this._nutroot,
    });
  }
}

/**
 * Reads semantic lock input; undefined for a wire shape (`P2PKOptions` carries `kind`, a
 * `NutrootOption` carries `receiverKey`).
 */
function asLockOptions(
  lock: LockOptions | LockBuilder | P2PKOptions | NutrootOption,
): LockOptions | undefined {
  if (typeof (lock as LockBuilder).toOptions === 'function') {
    return (lock as LockBuilder).toOptions();
  }
  if ('kind' in lock || 'receiverKey' in lock) return undefined;
  return lock as LockOptions;
}

/**
 * Encodes semantic lock options as a wire nutroot request.
 */
function encodeNutrootRequest(lock: LockOptions): NutrootOption {
  const { receiverKey, leaves, blindKeys } = lockToNutrootOptions(lock);
  return {
    receiverKey,
    ...(leaves?.length && { leaves: leaves.map((leaf) => serializeNutrootLeafHex(leaf)) }),
    ...(blindKeys?.length && { blindKeys }),
  };
}

/**
 * A NUT-10 locking option as wire {@link P2PKOptions}, canonicalising kind, data and tags.
 *
 * @remarks
 * Shared by the payer (build the lock) and the payee (check a proof carries it). Supports `P2PK`
 * (NUT-11) and `HTLC` (NUT-14) only; returns `undefined` for no option or an unbuildable kind.
 * @throws If the option is missing `data`, carries malformed tags, or holds a non-compliant pubkey.
 */
export function nut10ToP2PKOptions(nut10: NUT10Option | undefined): P2PKOptions | undefined {
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
