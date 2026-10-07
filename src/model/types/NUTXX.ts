import { type Amount } from '../Amount';

import { type SerializedBlindedMessage, type SerializedBlindedSignature } from './blinded';
import { type MintQuoteBaseResponse } from './NUT04';
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
  /**
   * Change quotes to create: each a lock key (33-byte compressed hex) and a positive amount, or no
   * amount on at most one of them, the remainder quote that takes the balance.
   */
  change_quote_outputs?: Array<{ pubkey: string; amount?: Amount }>;
  prefer_async?: boolean;
};

export type TransactionState = 'PENDING' | 'PAID' | 'FAILED';

/**
 * Response from `POST /v1/transaction` and `GET /v1/transaction/{digest}` (NUT-XX).
 */
export type TransactionResponse = {
  /**
   * The transaction digest, hex.
   */
  digest: string;
  state: TransactionState;
  /**
   * One per blinded message, in request order; empty unless `PAID`.
   */
  signatures: SerializedBlindedSignature[];
  melt_quotes: MeltQuoteBaseResponse[];
  /**
   * One per change quote output, in request order: the quote once `PAID`, else null (a remainder
   * quote with zero change stays null).
   */
  change_quotes: Array<MintQuoteBaseResponse | null>;
};
