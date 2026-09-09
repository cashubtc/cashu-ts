/**
 * Entries of CheckStateResponse with state of the proof.
 */
export type ProofState = {
  Y: string;
  state: CheckStateEnum;
  /**
   * The witness that spent the proof. Pre-v3: present when the spend needed one. v3: only for a
   * spend through a leaf carrying `disclosure` mode 0x01; private spends return a commitment.
   */
  witness: string | null;
  /**
   * Input digest a published v3 witness signs, hex (NUT-10); null unless disclosed.
   */
  input_digest?: string | null;
  /**
   * V3 spend commitment, hex: `tagged_hash("Cashu_SpendCommitment", Y || input_digest ||
   * SHA256(witness))` over the exact witness string. Present for every spent v3 proof.
   */
  commitment?: string | null;
};

/**
 * Enum for the state of a proof.
 */
export const CheckStateEnum = {
  UNSPENT: 'UNSPENT',
  PENDING: 'PENDING',
  SPENT: 'SPENT',
} as const;
export type CheckStateEnum = (typeof CheckStateEnum)[keyof typeof CheckStateEnum];

/**
 * Response when checking proofs if they are spendable. Should not rely on this for receiving, since
 * it can be easily cheated.
 */
export type CheckStateResponse = {
  states: ProofState[];
};
