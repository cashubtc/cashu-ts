import { type MintQuoteBaseRequest, type MintQuoteBaseResponse } from './NUT04';
import { type MeltQuoteBaseRequest } from './NUT05';
import { type MeltQuoteBolt11Response } from './NUT23';

/**
 * Payload that needs to be sent to the mint when requesting a mint.
 */
export type MintQuoteBolt12Request = MintQuoteBaseRequest & {
	/**
	 * Optional. Amount to be minted.
	 */
	amount?: number;
	/**
	 * Optional. Description for the invoice.
	 */
	description?: string;
};

/**
 * Response from the mint after requesting a BOLT12 mint quote.
 */
export type MintQuoteBolt12Response = MintQuoteBaseResponse & {
	/**
	 * Amount requested for mint quote.
	 */
	amount?: number;
	/**
	 * Timestamp of when the quote expires.
	 */
	expiry: number;
	/**
	 * Public key the quote is locked to.
	 *
	 * @remarks
	 * Required for bolt12.
	 */
	pubkey: string;
	/**
	 * The amount that has been paid to the mint via the bolt12 offer. The difference between this and
	 * `amount_issued` can be minted.
	 */
	amount_paid: number;
	/**
	 * The amount of ecash that has been issued for the given mint quote.
	 */
	amount_issued: number;
};

/**
 * Melt quote payload.
 *
 * Includes options:
 *
 * - Amountless: amountless invoices.
 */
export type MeltQuoteBolt12Request = MeltQuoteBaseRequest & {
	options?: {
		amountless?: {
			amount_msat: number;
		};
	};
};

/**
 * Response from the mint after requesting a BOLT12 melt quote.
 *
 * @remarks
 * - Same as Bolt11.
 */
export type MeltQuoteBolt12Response = MeltQuoteBolt11Response;
