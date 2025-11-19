import { type SerializedBlindedMessage, type SerializedBlindedSignature } from './blinded';

export const MintQuoteState = {
	UNPAID: 'UNPAID',
	PAID: 'PAID',
	ISSUED: 'ISSUED',
} as const;
export type MintQuoteState = (typeof MintQuoteState)[keyof typeof MintQuoteState];

/**
 * Base mint quote request - all mint quote requests have these fields (NUT-04) and may have
 * optional fields (NUT-20)
 */
export type MintQuoteBaseRequest = {
	/**
	 * Unit to be minted.
	 */
	unit: string;
	/**
	 * Optional. Public key to lock the quote to (NUT-20).
	 */
	pubkey?: string;
};

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
 * Payload that needs to be sent to the mint when requesting a mint.
 */
export type MintRequest = {
	/**
	 * Quote ID received from the mint.
	 */
	quote: string;
	/**
	 * Outputs (blinded messages) to be signed by the mint.
	 */
	outputs: SerializedBlindedMessage[];
	/**
	 * Optional. Signature for the Public key the quote is locked to (NUT-20)
	 */
	signature?: string;
};

/**
 * Response from the mint after requesting a mint.
 */
export type MintResponse = {
	signatures: SerializedBlindedSignature[];
};
