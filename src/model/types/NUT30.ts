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
 * One fee/confirmation option offered for an onchain melt quote.
 */
export type MeltQuoteOnchainFeeOption = {
  /**
   * Index used to select this option in the melt request.
   */
  fee_index: number;
  /**
   * Fee reserve for the onchain transaction.
   */
  fee_reserve: Amount;
  /**
   * Estimated number of blocks for confirmation.
   */
  estimated_blocks: number;
};

/**
 * Response from the mint after requesting an onchain melt quote.
 *
 * @remarks
 * Extends MeltQuoteBaseResponse for compatibility with existing generics. The inherited `change?`
 * contains NUT-08 change signatures when the mint returns onchain melt change.
 */
export type MeltQuoteOnchainResponse = MeltQuoteBaseResponse & {
  /**
   * Bitcoin address or destination.
   */
  request: string;
  /**
   * Available fee and confirmation estimates for this quote.
   */
  fee_options: MeltQuoteOnchainFeeOption[];
  /**
   * `fee_index` of the chosen fee option once the quote has been executed.
   */
  selected_fee_index: number | null;
  /**
   * Outpoint (txid:vout) once the transaction has been broadcast.
   */
  outpoint: string | null;
};
