import { OutputData } from '../../OutputData';
import { Proof } from './index';

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

/**
 * includes all data required to swap inputs for outputs and construct proofs from them.
 */
export type SwapTransaction = {
	/**
	 * payload that will be sent to the mint for a swap
	 */
	payload: SwapPayload;
	/**
	 * blinding data required to construct proofs
	 */
	outputData: Array<OutputData>;
	/**
	 * list of booleans to determine which proofs to keep
	 */
	keepVector: Array<boolean>;
	/**
	 * indices that can be used to restore original output data
	 */
	sortedIndices: Array<number>;
};
