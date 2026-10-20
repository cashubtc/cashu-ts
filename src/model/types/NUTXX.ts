import { type Amount } from '../Amount';

import { type SerializedBlindedMessage, type SerializedBlindedSignature } from './blinded';
import { type MeltQuoteBaseResponse } from './NUT05';
import { type Proof } from './proof';

/**
 * NUT-XX transactions info advertised by the mint in the NUT-06 info response.
 */
export type NutXXInfo = {
  supported: boolean;
  quote_input_fee_ppk?: number;
};

/**
 * A paid, locked mint quote spent as a transaction input (NUT-XX).
 */
export type TransactionQuoteInput = {
  quote: string;
  /**
   * The amount this transaction issues against the quote.
   */
  amount: Amount;
  witness: string;
};

/**
 * Payload for `POST /v1/transaction` (NUT-XX).
 */
export type TransactionRequest = {
  proof_inputs: Proof[];
  mint_quote_inputs: TransactionQuoteInput[];
  blinded_outputs: SerializedBlindedMessage[];
  /**
   * At most one melt: the quote, the fee reserve committed to it and, for a quote offering
   * `fee_options`, the selected `fee_index`.
   */
  melt_quote_outputs: Array<{ quote: string; fee_reserve: Amount; fee_index?: number }>;
  prefer_async?: boolean;
};

export type TransactionState = 'PENDING' | 'PAID' | 'FAILED';

/**
 * Response from `POST /v1/transaction` (NUT-XX).
 */
export type TransactionResponse = {
  state: TransactionState;
  /**
   * One per blinded message, in request order; empty unless `PAID`.
   */
  signatures: SerializedBlindedSignature[];
  /**
   * The melt quote, if any; once `PAID` its `change` carries the same signatures.
   */
  melt_quotes: MeltQuoteBaseResponse[];
};
