import { type SerializedBlindedMessage } from '../../model/types/blinded';
import { type Proof } from '../../model/types/proof';

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

/**
 * Generic payload for Melt.
 *
 * NUT-05 core fields plus optional blanks for overpayment change.
 */
export type NUT05MeltPayload = {
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
