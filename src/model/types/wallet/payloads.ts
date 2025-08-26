import { type OutputData } from '../../OutputData';
import { type Proof } from './index';

/**
 * Payload that needs to be sent to the mint when melting. Includes Return for overpaid fees.
 */
export type MeltPayload = {
	/**
	 * ID of the melt quote.
	 */
	quote: string;
	/**
	 * Inputs (Proofs) to be melted.
	 */
	inputs: Proof[];
	/**
	 * Blank outputs (blinded messages) that can be filled by the mint to return overpaid fees.
	 */
	outputs: SerializedBlindedMessage[];
};

/**
 * Payload that needs to be send to the mint to request a melt quote.
 */
export type MeltQuotePayload = {
	/**
	 * Unit to be melted.
	 */
	unit: string;
	/**
	 * Request to be melted to.
	 */
	request: string;
	/**
	 * Melt Quote options (e.g. multi-path payments NUT-15)
	 */
	options?: MeltQuoteOptions;
};

/**
 * Payload for requesting a BOLT12 melt quote. Used to pay Lightning Network offers.
 */
export type Bolt12MeltQuotePayload = MeltQuotePayload;

/**
 * Request for an on-chain melt quote. Used for sending Bitcoin to an on-chain address.
 */
export type OnchainMeltQuoteRequest = {
	/**
	 * Bitcoin address to send to (destination address).
	 */
	request: string;
	/**
	 * Unit to be melted (e.g., 'sat' for satoshis).
	 */
	unit: string;
	/**
	 * Amount in satoshis to send to the Bitcoin address.
	 */
	amount: number;
};

/**
 * Melt quote specific options.
 */
export type MeltQuoteOptions = {
	mpp?: MPPOption;
	amountless?: AmountlessOption;
};

/**
 * Multi path payments option.
 */
export type MPPOption = {
	amount: number;
};

/**
 * Amountless option.
 */
export type AmountlessOption = {
	amount_msat: number;
};

/**
 * Payload that needs to be sent to the mint when requesting a mint.
 */
export type MintPayload = {
	/**
	 * Quote ID received from the mint.
	 */
	quote: string;
	/**
	 * Outputs (blinded messages) to be signed by the mint.
	 */
	outputs: SerializedBlindedMessage[];
	/**
	 * Public key the quote is locked to.
	 */
	signature?: string;
};

/**
 * Payload that needs to be sent to the mint when requesting a mint.
 */
export type MintQuotePayload = {
	/**
	 * Unit to be minted.
	 */
	unit: string;
	/**
	 * Amount to be minted.
	 */
	amount: number;
	/**
	 * Description for the invoice.
	 */
	description?: string;
	/**
	 * Public key to lock the quote to.
	 */
	pubkey?: string;
};
/**
 * Payload for requesting a BOLT12 mint quote.
 */
export type Bolt12MintQuotePayload = Omit<MintQuotePayload, 'amount'> & {
	/**
	 * Optional amount for the offer. If not specified, then the offer must have an amount.
	 */
	amount?: number;
	/**
	 * Public key required to lock the quote.
	 */
	pubkey: string;
};

/**
 * Request for an on-chain mint quote. Used for minting tokens via Bitcoin on-chain payments.
 */
export type OnchainMintQuoteRequest = {
	/**
	 * Unit of the quote.
	 */
	unit: string;
	/**
	 * Public key required to lock the quote.
	 */
	pubkey: string;
};

/**
 * Payload that needs to be sent to the mint when performing a split action.
 */
export type SwapPayload = {
	/**
	 * Inputs to the split operation.
	 */
	inputs: Proof[];
	/**
	 * Outputs (blinded messages) to be signed by the mint.
	 */
	outputs: SerializedBlindedMessage[];
};

/**
 * Blinded message for sending to the mint.
 */
export type SerializedBlindedMessage = {
	/**
	 * Amount.
	 */
	amount: number;
	/**
	 * Blinded message.
	 */
	B_: string;
	/**
	 * Keyset id.
	 */
	id: string;
};

/**
 * Payload that needs to be sent to the mint when requesting blind auth tokens.
 */
export type BlindAuthMintPayload = {
	/**
	 * Outputs (blinded messages) to be signed by the mint.
	 */
	outputs: SerializedBlindedMessage[];
};

/**
 * Includes all data required to swap inputs for outputs and construct proofs from them.
 */
export type SwapTransaction = {
	/**
	 * Payload that will be sent to the mint for a swap.
	 */
	payload: SwapPayload;
	/**
	 * Blinding data required to construct proofs.
	 */
	outputData: OutputData[];
	/**
	 * List of booleans to determine which proofs to keep.
	 */
	keepVector: boolean[];
	/**
	 * Indices that can be used to restore original output data.
	 */
	sortedIndices: number[];
};
