import type { Amount, AmountLike } from '../Amount';

import {
  type MintQuoteBaseRequest,
  type MintQuoteBaseResponse,
  type MintQuoteState,
} from './NUT04';
import { type MeltQuoteBaseRequest, type MeltQuoteBaseResponse } from './NUT05';

/**
 * Payload that needs to be sent to the mint when requesting a mint.
 */
export type MintQuoteBolt11Request = MintQuoteBaseRequest & {
  /**
   * Amount to be minted.
   */
  amount: AmountLike;
  /**
   * Description for the invoice.
   */
  description?: string;
};

/**
 * Response from the mint after requesting a BOLT11 mint quote.
 */
export type MintQuoteBolt11Response = MintQuoteBaseResponse & {
  /**
   * Amount requested for mint quote.
   */
  amount: Amount;
  /**
   * State of the mint quote. Deprecated in NUT-04 in favour of the accounting fields; cashu-ts
   * always populates it for bolt11.
   */
  state: MintQuoteState;
};

/**
 * Melt quote payload.
 *
 * Includes options:
 *
 * - Amountless: amountless invoices.
 * - Mpp: multi-path payments (NUT-15)
 */
export type MeltQuoteBolt11Request = MeltQuoteBaseRequest & {
  options?: {
    amountless?: {
      amount_msat: AmountLike;
    };
    mpp?: {
      amount: AmountLike;
    };
  };
};

/**
 * Response from the mint after requesting a BOLT11 melt quote. Contains payment details and state
 * for paying Lightning Network offers.
 */
export type MeltQuoteBolt11Response = MeltQuoteBaseResponse & {
  /**
   * Fee reserve to be added to the amount.
   */
  fee_reserve: Amount;
  /**
   * Preimage of the paid invoice. is null if it the invoice has not been paid yet. can be null,
   * depending on which LN-backend the mint uses.
   */
  payment_preimage: string | null;
};
