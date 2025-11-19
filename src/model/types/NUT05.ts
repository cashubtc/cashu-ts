import { type SerializedBlindedMessage, type SerializedBlindedSignature } from './blinded';
import { type Proof } from './proof';

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

/**
 * Generic payload for Melt.
 *
 * NUT-05 core fields plus optional blanks for overpayment change.
 */
export type MeltPayload = {
	/**
	 * Quote ID.
	 */
	quote: string;
	/**
	 * Proofs to melt.
	 */
	inputs: Proof[];
	/**
	 * Optional blanks for fee change. If present, the mint may return signatures in `change`.
	 */
	outputs?: SerializedBlindedMessage[];
} & Record<string, unknown>;
