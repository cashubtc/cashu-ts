import type { Amount, AmountLike } from '../Amount';

import { type MintQuoteBaseRequest, type MintQuoteBaseResponse } from './NUT04';
import { type MeltQuoteBaseRequest, type MeltQuoteBaseResponse } from './NUT05';

/**
 * Payload for requesting an onchain mint quote.
 */
export type MintQuoteOnchainRequest = MintQuoteBaseRequest & {
  /**
   * Public key to lock the quote to. Required for onchain minting.
   */
  pubkey: string;
};

/**
 * Response from the mint after requesting an onchain mint quote.
 */
export type MintQuoteOnchainResponse = MintQuoteBaseResponse & {
  /**
   * Timestamp of when the quote expires. `null` when the mint does not set an expiry.
   */
  expiry: number | null;
  /**
   * Public key the quote is locked to.
   */
  pubkey: string;
  /**
   * The amount that has been paid to the mint via the onchain transaction.
   */
  amount_paid: Amount;
  /**
   * The amount of ecash that has been issued for the given mint quote.
   */
  amount_issued: Amount;
};

/**
 * Payload for requesting an onchain melt quote.
 */
export type MeltQuoteOnchainRequest = MeltQuoteBaseRequest & {
  /**
   * Amount to melt.
   */
  amount: AmountLike;
};

/**
 * Response from the mint after requesting an onchain melt quote.
 *
 * @remarks
 * Extends MeltQuoteBaseResponse for compatibility with existing generics. The inherited `change?`
 * is never populated for onchain melts (NUT-08 does not apply).
 */
export type MeltQuoteOnchainResponse = MeltQuoteBaseResponse & {
  /**
   * Bitcoin address or destination.
   */
  request: string;
  /**
   * Absolute fee for the onchain transaction. Not a fee reserve.
   */
  fee: Amount;
  /**
   * Estimated number of blocks for confirmation.
   */
  estimated_blocks: number;
  /**
   * Outpoint (txid:vout) once the transaction has been broadcast.
   */
  outpoint?: string;
};
