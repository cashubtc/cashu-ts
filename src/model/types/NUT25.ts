import { type MintQuoteBaseResponse } from './NUT04';
import { type MeltQuoteBolt11Response } from './NUT23';

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
 * Response from the mint after requesting a BOLT12 melt quote.
 *
 * @remarks
 * - Same as Bolt11.
 */
export type MeltQuoteBolt12Response = MeltQuoteBolt11Response;
