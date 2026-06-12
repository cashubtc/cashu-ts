import type { Amount, AmountLike } from '../Amount';

import { type SerializedBlindedMessage, type SerializedBlindedSignature } from './blinded';

export const MintQuoteState = {
  UNPAID: 'UNPAID',
  PAID: 'PAID',
  ISSUED: 'ISSUED',
} as const;
export type MintQuoteState = (typeof MintQuoteState)[keyof typeof MintQuoteState];

/**
 * Base mint quote request - all mint quote requests have these fields (NUT-04) and may have
 * optional fields (NUT-20)
 */
export type MintQuoteBaseRequest = {
  /**
   * Unit to be minted.
   */
  unit: string;
  /**
   * Optional. Amount to be minted. Method-specific NUTs may require it (e.g. bolt11).
   */
  amount?: AmountLike;
  /**
   * Optional. Description for the payment request.
   */
  description?: string;
  /**
   * Optional. Public key to lock the quote to (NUT-20).
   */
  pubkey?: string;
};

/**
 * Base mint quote response - all mint quotes have these fields (NUT-04) and may have optional
 * fields (NUT-20)
 */
export type MintQuoteBaseResponse = {
  /**
   * Quote ID.
   */
  quote: string;
  /**
   * Payment request.
   */
  request: string;
  /**
   * Unit of the melt quote.
   */
  unit: string;
  /**
   * Total amount paid to the mint for this quote, in `unit`. Derived from the legacy `state` for
   * mints that do not report accounting fields.
   */
  amount_paid: Amount;
  /**
   * Total amount of ecash issued for this quote, in `unit`. The difference between `amount_paid`
   * and `amount_issued` can be minted.
   */
  amount_issued: Amount;
  /**
   * Unix timestamp of the last quote update. `null` when the mint does not report it.
   */
  updated_at: number | null;
  /**
   * Timestamp of when the quote expires. `null` when the mint does not set an expiry.
   */
  expiry: number | null;
  /**
   * Optional. Public key the quote is locked to (NUT-20)
   */
  pubkey?: string;
};

/**
 * Mint quote response for methods without first-class types. Base fields are normalized and
 * validated; method-specific fields pass through unchanged.
 */
export type MintQuoteGenericResponse = MintQuoteBaseResponse & Record<string, unknown>;

/**
 * Payload that needs to be sent to the mint when requesting a mint.
 */
export type MintRequest = {
  /**
   * Quote ID received from the mint.
   */
  quote: string;
  /**
   * Outputs (blinded messages) to be signed by the mint.
   */
  outputs: SerializedBlindedMessage[];
  /**
   * Optional. Signature for the Public key the quote is locked to (NUT-20)
   */
  signature?: string;
};

/**
 * Response from the mint after requesting a mint.
 */
export type MintResponse = {
  signatures: SerializedBlindedSignature[];
};
