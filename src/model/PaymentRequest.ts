import { getTag, getTagInt, getTagScalar } from '../crypto/NUT10';
import type { P2PKOptions, P2PKTag } from '../crypto/NUT11';
import { P2PK_KNOWN_TAG_KEYS, parseP2PKSecret } from '../crypto/NUT11';
import { encodeBase64toUint8, decodeCBOR, encodeCBOR, Bytes } from '../utils';
import { decodeBech32mToBytes, encodeBech32m } from '../utils/bech32m';
import { decodeTLV, encodeTLV } from '../utils/tlv';
import type { DecodedTLVPaymentRequest } from '../utils/tlv';
import type {
  RawPaymentRequest,
  RawTransport,
  NUT10Option,
  PaymentRequestTransport,
  PaymentRequestTransportType,
} from '../wallet/types';

import { Amount, type AmountLike } from './Amount';
import { CTSError } from './Errors';

export class PaymentRequest {
  public amount?: Amount;
  public feeReserve?: Amount;
  public mintsStrict?: boolean;

  constructor(
    public transport?: PaymentRequestTransport[],
    public id?: string,
    amount?: AmountLike,
    public unit?: string,
    public mints?: string[],
    public description?: string,
    public singleUse: boolean = false,
    public nut10?: NUT10Option,
    mintsStrict?: boolean,
    feeReserve?: AmountLike,
    public supportedMethods?: string[],
  ) {
    this.amount = amount !== undefined ? Amount.from(amount) : undefined;
    this.feeReserve = feeReserve !== undefined ? Amount.from(feeReserve) : undefined;
    // Coerce to a real boolean so an untyped falsy CBOR value (`0`/`null`)
    // can't read strict via the getter yet serialize false over TLV.
    this.mintsStrict = mintsStrict === undefined ? undefined : Boolean(mintsStrict);
  }

  /**
   * Resolves the NUT-18 mint list strictness per spec.
   *
   * - `undefined` if no mint list is set (`ms` and `fr` SHOULD be ignored)
   * - `true` if the list is strict (`ms` absent or `true`)
   * - `false` if the list is preferred (`ms === false`)
   */
  get isMintListStrict(): boolean | undefined {
    if (!this.mints?.length) {
      return undefined;
    }
    return this.mintsStrict !== false;
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
    if (this.mintsStrict !== undefined) {
      rawRequest.ms = this.mintsStrict;
    }
    if (this.feeReserve) {
      rawRequest.fr = this.feeReserve.toBigInt();
    }
    if (this.supportedMethods && this.supportedMethods.length > 0) {
      rawRequest.sm = this.supportedMethods;
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
    const tlvRequest: DecodedTLVPaymentRequest = {
      id: this.id,
      amount: this.amount !== undefined ? this.amount.toBigInt() : undefined,
      unit: this.unit,
      singleUse: this.singleUse,
      mints: this.mints,
      mintsStrict: this.mintsStrict,
      feeReserve: this.feeReserve !== undefined ? this.feeReserve.toBigInt() : undefined,
      supportedMethods: this.supportedMethods,
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
    return new PaymentRequest(
      transports,
      rawPaymentRequest.i,
      rawPaymentRequest.a,
      rawPaymentRequest.u,
      rawPaymentRequest.m,
      rawPaymentRequest.d,
      rawPaymentRequest.s,
      nut10,
      rawPaymentRequest.ms,
      rawPaymentRequest.fr,
      rawPaymentRequest.sm,
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
        decoded.mintsStrict,
        decoded.feeReserve,
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
    const data = encodeBase64toUint8(encodedData);
    const decoded = decodeCBOR(data) as RawPaymentRequest;
    return this.fromRawRequest(decoded);
  }
}
