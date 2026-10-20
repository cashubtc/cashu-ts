/**
 * Entries of CheckStateResponse with state of the proof.
 */
export type ProofState = {
  Y: string;
  state: CheckStateEnum;
  /**
   * The witness that spent the proof, once `SPENT`; on v3 keysets also while `PENDING`.
   */
  witness: string | null;
  /**
   * Input digest the v3 `witness` signs, hex (NUT-00); null otherwise.
   */
  input_digest?: string | null;
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
