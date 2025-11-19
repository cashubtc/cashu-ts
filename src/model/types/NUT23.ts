import { type SerializedBlindedSignature } from './blinded';
import { type MintQuoteBaseResponse, type MintQuoteState } from './NUT04';
import { type MeltQuoteBaseResponse } from './NUT05';

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
	/**
	 * Return/Change from overpaid fees. This happens due to Lighting fee estimation being inaccurate.
	 */
	change?: SerializedBlindedSignature[];
};
