import type { NutrootLeaf } from '../../crypto/nutroot';
import type { OutputDataLike } from '../../model/OutputData';
import type { MeltQuoteBaseResponse, Proof } from '../../model/types';

/**
 * Response after melting proofs.
 */
export type MeltProofsResponse<
  TQuote extends Pick<MeltQuoteBaseResponse, 'quote'> = MeltQuoteBaseResponse,
> = {
  /**
   * If false, the proofs have not been invalidated and the payment can be tried later again with
   * the same proofs.
   */
  quote: TQuote;
  /**
   * Return/change from overpaid fees. Empty when the mint defers change (async/onchain melts).
   */
  change: Proof[];
  /**
   * NUT-08 outputs retained for deferred-change recovery (onchain, NUT-23 `prefer_async`). Empty
   * when `change` is populated — no recovery needed. Otherwise pair with the polled quote's
   * `change` via `wallet.createMeltChangeProofs()`.
   */
  outputData: OutputDataLike[];
};

/**
 * Response after sending.
 */
export type SendResponse = {
  /**
   * Proofs that exceeded the needed amount.
   */
  keep: Proof[];
  /**
   * Proofs to be sent, matching the chosen amount.
   */
  send: Proof[];
  serialized?: Array<{ proof: Proof; keep: boolean }>;
};

/**
 * One disclosed leaf of a v3 proof's tree, and whether this wallet can spend through it.
 *
 * @remarks
 * Nutroot secrets 2.3 and 2.7. `keys` are the slot keys the wallet recovered for this leaf,
 * verbatim or blinded. `satisfiable` is this wallet's own assessment from what it holds; the mint
 * compares an `after` leaf against its own clock, so a leaf that unlocked seconds ago may still be
 * refused.
 */
export type SpendOption = {
  leafIndex: number;
  leaf: NutrootLeaf;
  keys: Array<{ keyIndex: number; secretKey: string; blinded: boolean }>;
  satisfiable: boolean;
  /**
   * Why the leaf is not satisfiable from what this wallet holds. `preimage` means a hashlock leaf,
   * which always needs one supplied by the caller.
   */
  blockedBy?: 'threshold' | 'locktime' | 'preimage';
  /**
   * Unix seconds an `after` leaf unlocks.
   */
  availableAt?: number;
};

/**
 * What a v3 proof can be spent through: the key path, the script path, or neither.
 */
export type SpendOptions = {
  /**
   * True when the wallet can recover a key-path key: a bearer `k`, a receiver-keyed `E` matched
   * against a supplied private key, or its own seed derivation.
   */
  keyPath: boolean;
  /**
   * One entry per disclosed leaf, in tree order. Empty when the proof discloses no tree.
   */
  script: SpendOption[];
};
