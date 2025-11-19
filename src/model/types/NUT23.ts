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
	amount: number;
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
	amount?: number;
	/**
	 * State of the mint quote.
	 */
	state: MintQuoteState;
	/**
	 * Timestamp of when the quote expires.
	 */
	expiry: number;
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
			amount_msat: number;
		};
		mpp?: {
			amount: number;
		};
	};
};

/**
 * Response from the mint after requesting a BOLT11 melt quote. Contains payment details and state
 * for paying Lightning Network offers.
 */
export type MeltQuoteBolt11Response = MeltQuoteBaseResponse & {
	/**
	 * Payment request for the melt quote.
	 */
	request: string; // LN invoice
	/**
	 * Fee reserve to be added to the amount.
	 */
	fee_reserve: number;
	/**
	 * Preimage of the paid invoice. is null if it the invoice has not been paid yet. can be null,
	 * depending on which LN-backend the mint uses.
	 */
	payment_preimage: string | null;
};
