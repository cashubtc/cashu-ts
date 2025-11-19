import { type SerializedBlindedSignature } from './blinded';

export const MintQuoteState = {
	UNPAID: 'UNPAID',
	PAID: 'PAID',
	ISSUED: 'ISSUED',
} as const;
export type MintQuoteState = (typeof MintQuoteState)[keyof typeof MintQuoteState];

/**
 * Base mint quote response - all mint quotes have these fields (NUT-04) and may have optional
 * fields (NUT-20)
 */
export type MintQuoteBaseResponse = {
	/**
	 * Quote ID.
	 */
	quote: string;
	/**
	 * Payment request.
	 */
	request: string;
	/**
	 * Unit of the melt quote.
	 */
	unit: string;
	/**
	 * Optional. Public key the quote is locked to (NUT-20)
	 */
	pubkey?: string;
};

/**
 * Response from the mint after requesting a mint.
 */
export type MintResponse = {
	signatures: SerializedBlindedSignature[];
};
