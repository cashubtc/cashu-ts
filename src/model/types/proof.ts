import { type SerializedDLEQ } from './blinded';

/**
 * Represents a single Cashu proof.
 */
export type Proof = {
	/**
	 * Keyset id, used to link proofs to a mint an its MintKeys.
	 */
	id: string;
	/**
	 * Amount denominated in Satoshis. Has to match the amount of the mints signing key.
	 */
	amount: number;
	/**
	 * The initial secret that was (randomly) chosen for the creation of this proof.
	 */
	secret: string;
	/**
	 * The unblinded signature for this secret, signed by the mints private key.
	 */
	C: string;
	/**
	 * DLEQ proof.
	 */
	dleq?: SerializedDLEQ;
	/**
	 * The P2BK ephemeral pubkey "E" (SEC1-compressed 33-byte hex).
	 */
	p2pk_e?: string;
	/**
	 * The witness for this proof.
	 */
	witness?: string | P2PKWitness | HTLCWitness;
};

/**
 * P2PK witness.
 */
export type P2PKWitness = {
	/**
	 * An array of signatures in hex format.
	 */
	signatures?: string[];
};

/**
 * HTLC witness.
 */
export type HTLCWitness = {
	/**
	 * Preimage.
	 */
	preimage: string;
	/**
	 * An array of signatures in hex format.
	 */
	signatures?: string[];
};
