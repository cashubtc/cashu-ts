import type { Amount } from '../../model/Amount';
import { type Proof } from '../../model/types/proof';

export type RawTransport = {
  t: PaymentRequestTransportType; // type
  a: string; // target
  g?: string[][]; // tags
};

export type RawNUT10Option = {
  k: string; // kind
  d: string; // data
  t?: string[][]; // tags (optional per NUT-18)
};

export type RawTaprootOption = {
  k: string; // static receiver key, 33-byte compressed hex
  l?: string[]; // requested tree: serialized leaves (spec 2.6 wire form), hex
  b?: string[]; // keys in `l` the payee wants blinded; every other key is verbatim
};

export type RawSupportedMethod = {
  mn: string; // method name (e.g. "bolt11", "bolt12", "onchain")
  mf?: number | bigint; // per-method fee, in request unit; omitted = 0
};

export type RawPaymentRequest = {
  i?: string; // id
  a?: number | bigint; // amount
  u?: string; // unit
  s?: boolean; // single use
  m?: string[]; // mints
  mp?: boolean; // mints preferred: strict list when absent or false, advisory list when true
  sm?: RawSupportedMethod[]; // supported methods the payee accepts, each with an optional per-method fee
  d?: string; // description
  t?: RawTransport[]; // transports
  nut10?: RawNUT10Option;
  v3?: RawTaprootOption; // taproot secrets: static receiver key, optional requested tree
};

/**
 * A payee's taproot (v3 keyset) locking option: the static key outputs are derived to, and an
 * optional tree the payer must build over it.
 *
 * @remarks
 * Spec 2.7 and the NUT-18 row of the delta map. `receiverKey` is blinded at slot 0, always, so a
 * request is reusable without linking payments. `leaves` are serialized leaf bytes (2.6 wire form)
 * hex. The payer assigns slots in transmitted order and the receiver matches derived keys by value.
 * `blindKeys` are the leaf keys their owner tagged blind-me; every other leaf key travels verbatim.
 * The tag lives here, on the key's delivery channel, and never in proof data.
 */
export type TaprootOption = {
  receiverKey: string;
  leaves?: string[];
  blindKeys?: string[];
};

/**
 * A payment method the payee accepts, with an optional per-method fee. The fee applies only when
 * paying from a mint outside the request's mint list (or from any mint if no list is set); the
 * payer owes the lowest fee among the listed methods their mint supports (NUT-18).
 */
export type SupportedMethod = {
  method: string;
  fee?: Amount;
};

export type PaymentRequestTransport = {
  type: PaymentRequestTransportType;
  target: string;
  tags?: string[][];
};

export enum PaymentRequestTransportType {
  POST = 'post',
  NOSTR = 'nostr',
}

export type PaymentRequestPayload = {
  id?: string;
  memo?: string;
  unit: string;
  mint: string;
  proofs: Proof[];
};

/**
 * Used to express a spending condition that proofs should be encumbered with.
 */
export type NUT10Option = {
  /**
   * The kind of spending condition.
   */
  kind: string;
  /**
   * Expresses the spending condition relative to the kind.
   */
  data: string;
  /**
   * Optional tags associated with the spending condition for additional data. Absent and empty are
   * equivalent: neither is encoded.
   */
  tags?: string[][];
};
