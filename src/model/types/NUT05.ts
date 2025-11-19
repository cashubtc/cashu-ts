import { type SerializedBlindedSignature } from './blinded';

export const MeltQuoteState = {
	UNPAID: 'UNPAID',
	PENDING: 'PENDING',
	PAID: 'PAID',
} as const;
export type MeltQuoteState = (typeof MeltQuoteState)[keyof typeof MeltQuoteState];

/**
 * Base melt quote response - all melt quotes have these fields (NUT-05)
 */
export type MeltQuoteBaseResponse = {
	/**
	 * Quote ID.
	 */
	quote: string;
	/**
	 * Amount to be melted.
	 */
	amount: number;
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
