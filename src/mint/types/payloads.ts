// src/mint/types/payloads.ts
import type { SerializedBlindedMessage } from '../../model/types/blinded';

/**
 * Payload for /v1/checkstate.
 */
export type CheckStatePayload = {
	/**
	 * Y = hash_to_curve(secret) values to check.
	 */
	Ys: string[];
};

/**
 * Payload for /v1/restore.
 */
export type PostRestorePayload = {
	outputs: SerializedBlindedMessage[];
};
