import type { Amount, AmountLike } from '../Amount';

import { type SerializedBlindedMessage, type SerializedBlindedSignature } from './blinded';
import { type Proof } from './proof';

export const MeltQuoteState = {
  UNPAID: 'UNPAID',
  PENDING: 'PENDING',
  PAID: 'PAID',
} as const;
export type MeltQuoteState = (typeof MeltQuoteState)[keyof typeof MeltQuoteState];

/**
 * Base melt quote request - all melt quote requests have these fields (NUT-05)
 */
export type MeltQuoteBaseRequest = {
  /**
   * Unit to be melted.
   */
  unit: string;
  /**
   * Request to be melted to.
   */
  request: string;
  /**
   * Optional. Amount to be melted. Method-specific NUTs may require it (e.g. onchain).
   */
  amount?: AmountLike;
};

/**
 * Base melt quote response - all melt quotes have these fields (NUT-05)
 */
export type MeltQuoteBaseResponse = {
  /**
   * Quote ID.
   */
  quote: string;
  /**
   * Method-specific payment routing instructions (e.g. bolt11 invoice, onchain address, bank
   * account reference).
   */
  request: string;
  /**
   * Amount to be melted.
   */
  amount: Amount;
  /**
   * Optional. Additional fee reserve for using the method.
   */
  fee_reserve?: Amount;
  /**
   * Unit of the melt quote.
   */
  unit: string;
  /**
   * State of the melt quote.
   */
  state: MeltQuoteState;
  /**
   * Timestamp of when the quote expires.
   */
  expiry: number;
  /**
   * Optional change from overpaid fees. If blanks were provided in `outputs`, the mint may return
   * signatures here.
   */
  change?: SerializedBlindedSignature[];
};

/**
 * Melt quote response for methods without first-class types. Base fields are normalized and
 * validated; method-specific fields pass through unchanged.
 */
export type MeltQuoteGenericResponse = MeltQuoteBaseResponse & Record<string, unknown>;

/**
 * Generic Melt request payload.
 *
 * NUT-05 core fields plus optional blanks for overpayment change.
 */
export type MeltRequest = {
  /**
   * Quote ID.
   */
  quote: string;
  /**
   * Proofs to melt.
   */
  inputs: Proof[];
  /**
   * Optional blanks for fee change. If present, the mint may return signatures in `change`.
   */
  outputs?: SerializedBlindedMessage[];
  /**
   * When true, request async processing from the mint. Note: This is a request, not a guarantee.
   */
  prefer_async?: boolean;
} & Record<string, unknown>;
