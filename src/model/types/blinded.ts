import type { Amount } from '../Amount';

/**
 * Blinded message for sending to the mint.
 */
export type SerializedBlindedMessage = {
  /**
   * Amount denominated in keyset unit.
   */
  amount: Amount;
  /**
   * Blinded message. Hex length depends on the keyset version:
   *
   * - V1/v2 (`00…` / `01…` id): 66 hex chars (secp256k1 compressed, 33 bytes).
   * - V3 (`02…` id): 96 hex chars (BLS12-381 G1 compressed, 48 bytes).
   */
  B_: string;
  /**
   * Keyset id.
   */
  id: string;
  /**
   * NUT-342 (draft, experimental) recovery gap: plaintext integer or hex-encoded AES-128-GCM
   * payload. Omitted unless the wallet backs up recovery gaps.
   */
  d_gap?: number | string;
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
   * Blinded signature. Hex length matches `B_` for the same keyset:
   *
   * - V1/v2: 66 hex chars (secp256k1 compressed).
   * - V3: 96 hex chars (BLS12-381 G1 compressed).
   */
  C_: string;
  /**
   * DLEQ Proof.
   */
  dleq?: SerializedDLEQ;
  /**
   * NUT-342 (draft, experimental) recovery gap, echoed verbatim from the stored BlindedMessage.
   */
  d_gap?: number | string;
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
