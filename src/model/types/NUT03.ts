import { type SerializedBlindedMessage } from './blinded';
import { type Proof } from './proof';

/**
 * Payload that needs to be sent to the mint when performing a split action.
 */
export type SwapRequest = {
	/**
	 * Inputs to the split operation.
	 */
	inputs: Proof[];
	/**
	 * Outputs (blinded messages) to be signed by the mint.
	 */
	outputs: SerializedBlindedMessage[];
};
