import { Proof } from './index';

/**
 * Data that the library needs to hold in memory while it awaits the blinded signatures for the mint. It is later used for unblinding the signatures.
 */
export type BlindingData = {
	/**
	 * Blinded messages sent to the mint for signing.
	 */
	blindedMessages: Array<SerializedBlindedMessage>;
	/**
	 * secrets, kept client side for constructing proofs later.
	 */
	secrets: Array<Uint8Array>;
	/**
	 * Blinding factor used for blinding messages and unblinding signatures after they are received from the mint.
	 */
	blindingFactors: Array<bigint>;
};

/**
 * Payload that needs to be sent to the mint when melting. Includes Return for overpaid fees
 */
export type MeltPayload = {
	/**
	 * ID of the melt quote
	 */
	quote: string;
	/**
	 * Inputs (Proofs) to be melted
	 */
	inputs: Array<Proof>;
	/**
	 * Blank outputs (blinded messages) that can be filled by the mint to return overpaid fees
	 */
	outputs: Array<SerializedBlindedMessage>;
};

/**
 * Payload that needs to be send to the mint to request a melt quote
 */
export type MeltQuotePayload = {
	/**
	 * Unit to be melted
	 */
	unit: string;
	/**
	 * Request to be melted to
	 */
	request: string;

	options?: MeltQuotePayloadAmountLess;
};

/**
 * Payload for a melt quote with an optional amountless option.
 */
export type MeltQuotePayloadAmountLess = {
	/**
	 * Optional property for specifying an amountless option.
	 */
	amountless?: {
		/**
		 * The amount in milli-satoshis.
		 */
		amount_msat: number;
	};
};

/**
 * Payload that needs to be sent to the mint when requesting a mint
 */
export type MintPayload = {
	/**
	 * Quote ID received from the mint.
	 */
	quote: string;
	/**
	 * Outputs (blinded messages) to be signed by the mint.
	 */
	outputs: Array<SerializedBlindedMessage>;
};

/**
 * Payload that needs to be sent to the mint when requesting a mint
 */
export type MintQuotePayload = {
	/**
	 * Unit to be minted
	 */
	unit: string;
	/**
	 * Amount to be minted
	 */
	amount: number;
	/**
	 * Description for the invoice
	 */
	description?: string;
};

/**
 * Payload that needs to be sent to the mint when performing a split action
 */
export type SwapPayload = {
	/**
	 * Inputs to the split operation
	 */
	inputs: Array<Proof>;
	/**
	 * Outputs (blinded messages) to be signed by the mint
	 */
	outputs: Array<SerializedBlindedMessage>;
};

/**
 * blinded message for sending to the mint
 */
export type SerializedBlindedMessage = {
	/**
	 * amount
	 */
	amount: number;
	/**
	 * Blinded message
	 */
	B_: string;
	/**
	 * Keyset id
	 */
	id: string;
};
