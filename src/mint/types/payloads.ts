import { type SerializedBlindedMessage } from '../../model/types/blinded';

/**
 * Payload that needs to be sent to the mint when checking for spendable proofs.
 */
export type CheckStatePayload = {
	/**
	 * The Y = hash_to_curve(secret) of the proofs to be checked.
	 */
	Ys: string[];
};

/**
 * Request to mint at /v1/restore endpoint.
 */
export type PostRestorePayload = {
	outputs: SerializedBlindedMessage[];
};
