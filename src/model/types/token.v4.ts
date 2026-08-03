export type V4DLEQTemplate = {
  /**
   * Challenge.
   */
  e: Uint8Array;
  /**
   * Response.
   */
  s: Uint8Array;
  /**
   * Blinding factor.
   */
  r: Uint8Array;
};

/**
 * Template for a Proof inside a V4 Token.
 */
export type V4ProofTemplate = {
  /**
   * Amount.
   */
  a: number | bigint;
  /**
   * Secret.
   */
  s: string;
  /**
   * Signature.
   */
  c: Uint8Array;
  /**
   * DLEQ.
   */
  d?: V4DLEQTemplate;
  /**
   * P2BK E.
   */
  pe?: Uint8Array;
  /**
   * Witness.
   */
  w?: string;
  /**
   * Taproot spend info (v3): what the next owner needs that the proof does not say.
   */
  si?: V4SpendInfoTemplate;
};

/**
 * Template for taproot spend info inside a V4 Token.
 */
export type V4SpendInfoTemplate = {
  /**
   * Bearer private key (32 bytes). Mutually exclusive with `e`.
   */
  k?: Uint8Array;
  /**
   * Receiver-keyed DH ephemeral (33 bytes). Mutually exclusive with `k`.
   */
  e?: Uint8Array;
  /**
   * Serialized leaves, in slot-map order.
   */
  t?: Uint8Array[];
};

/**
 * TokenEntry in a V4 Token.
 */
export type V4InnerToken = {
  /**
   * ID.
   */
  i: Uint8Array;
  /**
   * Proofs.
   */
  p: V4ProofTemplate[];
};

/**
 * Template for a V4 Token.
 */
export type TokenV4Template = {
  /**
   * TokenEntries.
   */
  t: V4InnerToken[];
  /**
   * Memo.
   */
  d: string;
  /**
   * Mint Url.
   */
  m: string;
  /**
   * Unit.
   */
  u: string;
};
