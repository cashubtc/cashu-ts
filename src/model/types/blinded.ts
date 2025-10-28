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
 * Blinded signature as it is received from the mint.
 */
export type SerializedBlindedSignature = {
	/**
	 * Keyset id for indicating which public key was used to sign the blinded message.
	 */
	id: string;
	/**
	 * Amount denominated in Satoshi.
	 */
	amount: number;
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
