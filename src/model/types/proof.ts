import { type Amount, type AmountLike } from '../Amount';

import { type SerializedDLEQ } from './blinded';

/**
 * A proof-shaped object whose `amount` field has not yet been normalized to `Amount`.
 *
 * Use this type to model proofs coming from external storage (localStorage, databases, JSON blobs)
 * where `amount` may be a `number`, `string`, or any other {@link AmountLike} value.
 *
 * @see {@link Proof} for the fully normalized type with `amount: Amount`.
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
  amount: Amount;
  /**
   * The initial secret that was (randomly) chosen for the creation of this proof.
   */
  secret: string;
  /**
   * The unblinded signature for this secret, signed by the mints private key.
   *
   * Hex length depends on the keyset version (id prefix):
   *
   * - V1/v2 (`00…` / `01…`): 66 hex chars (secp256k1 compressed).
   * - V3 (`02…`): 96 hex chars (BLS12-381 G1 compressed).
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
  /**
   * Taproot spend info (v3 keysets): what the next owner needs that the proof does not say.
   */
  spend_info?: SpendInfo;
};

/**
 * Taproot spend info (spec 2.5): a key and, when conditions exist, the leaf tree.
 *
 * @remarks
 * `k` and `E` are mutually exclusive: `k` (32-byte scalar hex) means "here is the key" (bearer),
 * `E` (33-byte point hex) means "derive your key" (receiver-keyed). `tree` lists serialized leaves
 * (hex) in slot-map order. Fund-critical for locked proofs: belongs in storage and backups, and
 * until the proof is swept it is the only thing that can spend it.
 */
export type SpendInfo = {
  k?: string;
  E?: string;
  /**
   * Internal public key for script-only transfers (33-byte hex), when neither `k` nor `E` travels.
   */
  K?: string;
  /**
   * NUMS offset (32-byte hex): present iff `K` is `H + u*G`, which is what proves the proof has no
   * key path. Holders check `K - u*G == H`. Distinct from the blinding factor `r`, which never
   * travels.
   */
  u?: string;
  tree?: string[];
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
