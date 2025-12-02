import type {
	SerializedBlindedMessage,
	SerializedBlindedSignature,
} from '../../model/types/blinded';

/**
 * Response from mint at /v1/restore endpoint.
 */
export type PostRestoreResponse = {
	outputs: SerializedBlindedMessage[];
	signatures: SerializedBlindedSignature[];
};

/**
 * Response from the mint after performing a split action.
 */
export type SwapResponse = {
	/**
	 * Represents the outputs after the split.
	 */
	signatures: SerializedBlindedSignature[];
};
