import { getTag, getTagInt, getTagScalar } from '../crypto/NUT10';
import type { P2PKOptions, P2PKTag } from '../crypto/NUT11';
import { isP2PKKnownTagKey, parseP2PKSecret } from '../crypto/NUT11';
import {
  decodeBase64AnyToUint8,
  decodeCBOR,
  encodeCBOR,
  encodeUint8ToBase64UrlPadded,
  normalizeMintUrl,
} from '../utils';
import { decodeBech32mToBytes, encodeBech32m } from '../utils/bech32m';
import { JSONInt } from '../utils/JSONInt';
import { decodeTLV, encodeTLV } from '../utils/tlv';
import type { DecodedTLVPaymentRequest } from '../utils/tlv';
import type {
  RawPaymentRequest,
  RawTransport,
  NUT10Option,
  PaymentRequestPayload,
  PaymentRequestTransport,
  PaymentRequestTransportType,
  SupportedMethod,
} from '../wallet/types';

import { Amount, type AmountLike } from './Amount';
import { CTSError } from './Errors';
import type { Proof } from './types/proof';

/**
 * Normalizes a wire boolean flag, admitting true/false, the numeric 0/1 form, and null.
 *
 * @remarks
 * `null` is treated the same as an absent key: some encoders (eg cdk) serialize an unset optional
 * field as CBOR null rather than omitting it.
 * @throws If `value` is present, non-null, and not one of those four values.
 */
function normalizePaymentRequestFlag(value: unknown, field: 's' | 'mp'): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new CTSError(`invalid payment request: ${field} must be a boolean (or 0/1)`);
}

export class PaymentRequest {
  public amount?: Amount;
  public supportedMethods?: SupportedMethod[];

  constructor(
    public transport?: PaymentRequestTransport[],
    public id?: string,
    amount?: AmountLike,
    public unit?: string,
    public mints?: string[],
    public description?: string,
    public singleUse: boolean = false,
    public nut10?: NUT10Option,
    public mintsPreferred?: boolean,
    supportedMethods?: Array<{ method: string; fee?: AmountLike }>,
  ) {
    this.amount = amount !== undefined ? Amount.from(amount) : undefined;
    this.mintsPreferred = normalizePaymentRequestFlag(mintsPreferred, 'mp');
    this.supportedMethods = supportedMethods?.map((m) => ({
      method: m.method,
      fee: m.fee !== undefined ? Amount.from(m.fee) : undefined,
    }));
  }

  /**
   * NUT-18: `u` MUST be set if `a` or `sm` is set: `mf` and the melt-method check are denominated
   * in the request unit. Enforced when pricing; encoding and parsing stay lenient on v4.
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
   * @remarks
   * For amountless requests, add the result to the payer-chosen amount. Prices only; does not check
   * admissibility (eg a strict mint list, or a mint supporting none of `sm`).
   * @param mint - The mint URL the payer will send from.
   * @param meltMethods - The methods the mint can melt the request unit via (its NUT-05 melt
   *   methods, matched against `sm`); omit if unknown (prices as `0`).
   * @throws If the request sets `a` or `sm` without `u` (invalid per NUT-18).
   */
  feesFor(mint: string, meltMethods?: string[]): Amount {
    this.assertUnitRule();
    // Fees compensate the payee for melting out: payments from a listed mint carry none.
    if (!this.supportedMethods?.length || this.includesMint(mint)) {
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
   * @throws If the request has no amount (use {@link PaymentRequest.feesFor | feesFor} instead), or
   *   no unit (invalid per NUT-18).
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
   * Use this, not plain `JSON.stringify`, which writes proof amounts as quoted strings. Proofs must
   * come from `mint` and net the request amount. Send it as the POST body or Nostr DM content.
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
   * Validates payload shape only, accepting proof amounts as JSON numbers or canonical decimal
   * strings. Matching the payload to the request (id, mint, amount) is the payee's job. Imposes no
   * size limit of its own: cap the raw text at the transport (POST body, DM) before decoding.
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
      // Accept canonical decimal strings: plain JSON.stringify over Amount writes them.
      if (typeof amount !== 'number' && typeof amount !== 'bigint' && typeof amount !== 'string') {
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
    if (this.description) {
      rawRequest.d = this.description;
    }
    if (this.singleUse) {
      rawRequest.s = this.singleUse;
    }
    if (this.nut10) {
      rawRequest.nut10 = {
        k: this.nut10.kind,
        d: this.nut10.data,
        t: this.nut10.tags,
      };
    }
    if (this.mintsPreferred !== undefined) {
      rawRequest.mp = this.mintsPreferred;
    }
    if (this.supportedMethods && this.supportedMethods.length > 0) {
      rawRequest.sm = this.supportedMethods.map((m) =>
        m.fee !== undefined ? { mn: m.method, mf: m.fee.toBigInt() } : { mn: m.method },
      );
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
    const tlvRequest: DecodedTLVPaymentRequest = {
      id: this.id,
      amount: this.amount !== undefined ? this.amount.toBigInt() : undefined,
      unit: this.unit,
      singleUse: this.singleUse,
      mints: this.mints,
      description: this.description,
      transports: this.transport,
      nut10: this.nut10
        ? {
            kind: this.nut10.kind,
            data: this.nut10.data,
            tags: this.nut10.tags,
          }
        : undefined,
      mintsPreferred: this.mintsPreferred,
      supportedMethods: this.supportedMethods?.map((m) => ({
        method: m.method,
        fee: m.fee !== undefined ? m.fee.toBigInt() : undefined,
      })),
    };

    const tlvBytes = encodeTLV(tlvRequest);
    return encodeBech32m('creqb', tlvBytes).toUpperCase();
  }

  getTransport(type: PaymentRequestTransportType) {
    return this.transport?.find((t: PaymentRequestTransport) => t.type === type);
  }

  /**
   * Converts this request's `nut10` locking option into the {@link P2PKOptions} accepted by the
   * `.asP2PK()` builder, so a payer can produce proofs locked to exactly the spending condition the
   * payee requested.
   *
   * Supports `P2PK` (NUT-11) and `HTLC` (NUT-14) only. Returns `undefined` when there is no `nut10`
   * option or its kind is not one we can build.
   *
   * @throws If the option is missing its `data` field, or carries malformed NUT-10 tags — invalid
   *   lock semantics must not be silently dropped.
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
    const taggedPubkeys = getTag(secret, 'pubkeys') ?? [];
    const pubkeys = [nut10.data, ...taggedPubkeys];
    const options: P2PKOptions = isHTLC
      ? { hashlock: nut10.data, pubkey: taggedPubkeys }
      : { pubkey: pubkeys.length === 1 ? pubkeys[0] : pubkeys };

    // Optional fields pass straight through: the accessors return undefined when
    // absent, and the builder ignores undefined options. getTag never yields [].
    options.locktime = getTagInt(secret, 'locktime');
    options.refundKeys = getTag(secret, 'refund');
    options.requiredSignatures = getTagInt(secret, 'n_sigs');
    options.requiredRefundSignatures = getTagInt(secret, 'n_sigs_refund');
    if (getTagScalar(secret, 'sigflag') === 'SIG_ALL') {
      options.sigFlag = 'SIG_ALL';
    }

    // Forward any non-standard tags verbatim.
    const additionalTags = (nut10.tags ?? []).filter(
      (t) => t.length > 0 && !isP2PKKnownTagKey(t[0]),
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
    return new PaymentRequest(
      transports,
      rawPaymentRequest.i,
      rawPaymentRequest.a,
      rawPaymentRequest.u,
      rawPaymentRequest.m,
      rawPaymentRequest.d,
      rawPaymentRequest.s,
      nut10,
      rawPaymentRequest.mp,
      rawPaymentRequest.sm?.map((m) => ({ method: m.mn, fee: m.mf })),
    );
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
      return new PaymentRequest(
        decoded.transports,
        decoded.id,
        decoded.amount,
        decoded.unit,
        decoded.mints,
        decoded.description,
        decoded.singleUse ?? false,
        nut10,
        decoded.mintsPreferred,
        decoded.supportedMethods,
      );
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
    const data = decodeBase64AnyToUint8(encodedData);
    const decoded = decodeCBOR(data) as RawPaymentRequest;
    return this.fromRawRequest(decoded);
  }
}
