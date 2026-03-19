import type { Amount } from '../Amount';

/**
 * Blinded message for sending to the mint.
 */
export type SerializedBlindedMessage = {
	/**
	 * Amount as a bigint so that JSONInt.stringify emits a raw numeric JSON token (never a quoted
	 * string) for values that exceed Number.MAX_SAFE_INTEGER (e.g. msat denominations).
	 */
	amount: bigint;
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
 * Blinded signature as it is received from the mint.
 */
export type SerializedBlindedSignature = {
	/**
	 * Keyset id for indicating which public key was used to sign the blinded message.
	 */
	id: string;
	/**
	 * Amount denominated in keyset unit.
	 */
	amount: Amount;
	/**
	 * Blinded signature.
	 */
	C_: string;
	/**
	 * DLEQ Proof.
	 */
	dleq?: SerializedDLEQ;
};

/*
 * Zero-Knowledge that BlindedSignature
 * was generated using a specific public key
 */
export type SerializedDLEQ = {
	s: string;
	e: string;
	r?: string;
};
