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
};

/**
 * Zero-knowledge proof that a BlindSignature was generated using a specific public key (NUT-12).
 *
 * @remarks
 * The mint's half of the proof. The wallet completes it into a {@link SerializedProofDLEQ}.
 */
export type SerializedDLEQ = {
  s: string;
  e: string;
};

/**
 * A mint's DLEQ proof completed by the wallet with its own blinding factor, as carried on a Proof.
 *
 * @remarks
 * NUT-12 splits the work: the mint issues `{e, s}`, the wallet adds the `r` it blinded with. A
 * Proof carrying only `{e, s}` cannot be verified by the next holder and is not valid.
 */
export type SerializedProofDLEQ = SerializedDLEQ & {
  r: string;
};
