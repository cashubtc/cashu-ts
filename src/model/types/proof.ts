import { type AmountLike } from '../Amount';

import { type SerializedDLEQ } from './blinded';

/**
 * A proof-shaped object whose `amount` field has not yet been normalized to `bigint`.
 *
 * Use this type to model proofs coming from external storage (localStorage, databases, JSON blobs)
 * where `amount` may be a `number`, `string`, or any other {@link AmountLike} value.
 *
 * @see {@link Proof} for the fully normalized type with `amount: bigint`.
 */
export type ProofLike = Omit<Proof, 'amount'> & { amount: AmountLike };

/**
 * Represents a single Cashu proof.
 */
export type Proof = {
  /**
   * Keyset id, used to link proofs to a mint and its MintKeys.
   */
  id: string;
  /**
   * Amount denominated in unit of the mints keyset id.
   */
  amount: bigint;
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
