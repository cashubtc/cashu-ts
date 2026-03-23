import { type OutputDataLike } from '../../model/OutputData';
import { type Proof } from '../../model/types/proof';
import { type AmountLike } from '../../model/Amount';
import {
	type MeltQuoteBaseResponse,
	type MintQuoteBaseResponse,
	type SwapRequest,
	type MintRequest,
} from '../../model/types';

/**
 * Preview of a mint transaction created by prepareMint.
 */
export interface MintPreview<
	TQuote extends Pick<MintQuoteBaseResponse, 'quote'> = MintQuoteBaseResponse,
> {
	method: string;
	/**
	 * Mint payload to be sent to the mint.
	 */
	payload: MintRequest;
	/**
	 * Blinding data required to construct proofs.
	 */
	outputData: OutputDataLike[];
	/**
	 * Keyset ID used to prepare the outputs.
	 */
	keysetId: string;
	/**
	 * Mint Quote object.
	 */
	quote: TQuote;
}

/**
 * Preview of a Melt transaction created by prepareMelt.
 */
export interface MeltPreview<
	TQuote extends Pick<MeltQuoteBaseResponse, 'quote'> = MeltQuoteBaseResponse,
> {
	method: string;
	/**
	 * Inputs (Proofs) to be melted.
	 */
	inputs: Proof[];
	/**
	 * Outputs (blinded messages) that can be filled by the mint to return overpaid fees.
	 */
	outputData: OutputDataLike[];
	/**
	 * Keyset ID used to prepare the outputs.
	 */
	keysetId: string;
	/**
	 * Melt Quote object.
	 */
	quote: TQuote;
}

/**
 * Includes all data required to swap inputs for outputs and construct proofs from them.
 */
export type SwapTransaction = {
	/**
	 * Payload that will be sent to the mint for a swap.
	 */
	payload: SwapRequest;
	/**
	 * Blinding data required to construct proofs.
	 */
	outputData: OutputDataLike[];
	/**
	 * List of booleans to determine which proofs to keep.
	 */
	keepVector: boolean[];
	/**
	 * Indices that can be used to restore original output data.
	 */
	sortedIndices: number[];
};

/**
 * Preview of a swap transaction created by prepareSend / prepareReceive.
 */
export type SwapPreview = {
	/**
	 * Amount being sent or received (excluding fees).
	 */
	amount: AmountLike;
	/**
	 * Total fees for the swap (inc receiver's fees if applicable)
	 */
	fees: AmountLike;
	/**
	 * Keyset ID used to prepare the outputs.
	 */
	keysetId: string;
	/**
	 * Input Proofs for this transaction.
	 */
	inputs: Proof[];
	/**
	 * Blinding data to construct proofs to send.
	 */
	sendOutputs?: OutputDataLike[];
	/**
	 * Blinding data to construct proofs to keep.
	 */
	keepOutputs?: OutputDataLike[];
	/**
	 * Proofs not selected for this transaction (can be returned to storage).
	 */
	unselectedProofs?: Proof[];
};
