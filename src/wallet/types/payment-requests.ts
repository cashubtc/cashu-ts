import { type Proof } from '../../model/types/proof';

export type RawTransport = {
  t: PaymentRequestTransportType; // type
  a: string; // target
  g?: string[][]; // tags
};

export type RawNUT10Option = {
  k: string; // kind
  d: string; // data
  t: string[][]; // tags
};

export type RawPaymentRequest = {
  i?: string; // id
  a?: number | bigint; // amount
  u?: string; // unit
  s?: boolean; // single use
  m?: string[]; // mints
  ms?: boolean; // mints strict
  fr?: number | bigint; // fee reserve (additional, in request unit, when paying from a non-strict-list mint)
  sm?: string[]; // supported payment methods the sending mint must support (e.g. "bolt11", "bolt12", "onchain")
  d?: string; // description
  t?: RawTransport[]; // transports
  nut10?: RawNUT10Option;
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
   * Tags associated with the spending condition for additional data.
   */
  tags: string[][];
};
