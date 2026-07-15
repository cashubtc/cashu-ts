import { type P2PKOptions } from '../../crypto';
import { type AmountLike } from '../../model/Amount';
import { type OutputDataFactory, type OutputDataLike } from '../../model/OutputData';
import type { ProofLike } from '../../model/types/proof';
import { type OperationCounters } from '../CounterSource';

export type SecretsPolicy = 'auto' | 'deterministic' | 'random';

export type RestoreConfig = {
  keysetId?: string;
};

/**
 * Configuration for `batchRestore`.
 */
export type BatchRestoreConfig = {
  /**
   * Consecutive empty counters that end the scan. A floor, not an exact ceiling: batches already in
   * flight past it are still processed. `Infinity` disables the gap rule (use with `maxCounter`).
   * Default is `300`
   */
  gapLimit?: number;
  /**
   * Inclusive scan ceiling: no counter above it is probed and the scan stops there even without a
   * gap. Combine with `gapLimit: Infinity` to fetch a known range wall to wall. Default is
   * unbounded.
   */
  maxCounter?: number;
  /**
   * Counters per restore request. Default is `500`
   */
  batchSize?: number;
  /**
   * Starting counter. Default is `0`
   */
  counter?: number;
  /**
   * Keyset to restore; defaults to the wallet's.
   */
  keysetId?: string;
  /**
   * Drop spent proofs (NUT-07) before returning. Default is `true`
   */
  filterSpent?: boolean;
};

/**
 * Config for {@link Wallet.restoreEfficient} (draft NUT-342, experimental).
 */
export type RestoreEfficientConfig = {
  keysetId?: string;
  /**
   * Nonces per probe window; also the largest derivation gap the search tolerates. Larger windows
   * are safer but reveal more nonces per probe round. Default is `25`.
   */
  probeWindow?: number;
  /**
   * Chunk size for the final window restore (mints cap request lengths); chunks are requested
   * concurrently. Must be 1-1000. Default is `300`.
   */
  batchSize?: number;
  /**
   * Probe windows per search request (grid width). Larger budgets pin T in fewer rounds but land
   * more probes in issued history, letting the mint link more old signatures to the recovery. Must
   * be 2-40. Default is `12`.
   */
  probeBudget?: number;
  /**
   * Drop spent proofs (NUT-07) before returning. Default is `true`
   */
  filterSpent?: boolean;
};

/**
 * Returns the lowest deterministic counter among the app's unspent AND pending proofs for a keyset,
 * or undefined when there are none (draft NUT-342, experimental).
 *
 * @remarks
 * Pending proofs (e.g. inputs reserved for an in-flight swap or melt) MUST be included, or recovery
 * windows may miss live proofs.
 */
export type RecoveryGapProvider = (keysetId: string) => Promise<number | undefined>;

/**
 * Shared properties for most `OutputType` variants (except 'custom').
 */
export interface SharedOutputTypeProps {
  /**
   * Optional custom amounts for splitting outputs.
   *
   * @default Uses basic splitAmount if omitted.
   */
  denominations?: AmountLike[];
}

/**
 * Configuration for generating blinded message outputs.
 *
 * @remarks
 * A discriminated union based on the `type` field.
 * @example
 *
 *     // Random with custom splits
 *     const random: OutputType = { type: 'random', denominations: [1, 2, 4] };
 *     // Deterministic
 *     const deterministic: OutputType = { type: 'deterministic', counter: 0 };
 */
export type OutputType =
  | ({
      /**
       * Random blinding factors (default behavior).
       */
      type: 'random';
    } & SharedOutputTypeProps)
  | ({
      /**
       * Deterministic outputs based on a counter.
       *
       * @remarks
       * Counter: 0 means “auto-assign from wallet’s CounterSource”. Any positive value is used as
       * the exact starting counter without reservation. Negative values are invalid.
       */
      type: 'deterministic';
      counter: number;
    } & SharedOutputTypeProps)
  | ({
      /**
       * P2PK (NUT-11) or HTLC (NUT-14) locked outputs.
       *
       * @see P2PKOptions
       */
      type: 'p2pk';
      options: P2PKOptions;
    } & SharedOutputTypeProps)
  | ({
      /**
       * Factory-generated OutputData.
       *
       * @remarks
       * Outputs count from denominations or basic split.
       * @see OutputDataFactory
       */
      type: 'factory';
      factory: OutputDataFactory;
    } & SharedOutputTypeProps)
  | {
      /**
       * Pre-created OutputData, bypassing splitting.
       */
      type: 'custom';
      data: OutputDataLike[];
    };

/**
 * Output config for send/swap operations.
 *
 * @remarks
 * Defines types for sent and kept proofs.
 *
 * - `send`: Required for recipient proofs.
 * - `keep`: Optional; defaults to wallet defaultOutputType policy.
 *
 * @example
 *
 *     const config: OutputConfig = {
 *       send: { type: 'random', denominations: [1, 2] },
 *       keep: { type: 'deterministic', counter: 0 },
 *     };
 *     await wallet.send(3, proofs, config, { includeFees: true });
 */
export interface OutputConfig {
  send: OutputType;
  keep?: OutputType;
}

export type OnCountersReserved = (info: OperationCounters) => void;

/**
 * Configuration for send operations.
 */
export type SendConfig = {
  keysetId?: string;
  privkey?: string | string[];
  includeFees?: boolean;
  proofsWeHave?: Array<Pick<ProofLike, 'amount'>>;
  onCountersReserved?: OnCountersReserved;
};

/**
 * Configuration for offline send operations.
 */
export type SendOfflineConfig = {
  requireDleq?: boolean;
  includeFees?: boolean;
  exactMatch?: boolean;
};

/**
 * Configuration for receive operations.
 */
export type ReceiveConfig = {
  keysetId?: string;
  privkey?: string | string[];
  requireDleq?: boolean;
  proofsWeHave?: Array<Pick<ProofLike, 'amount'>>;
  onCountersReserved?: OnCountersReserved;
};

/**
 * Configuration for minting operations.
 */
export type MintProofsConfig = {
  keysetId?: string;
  privkey?: string | string[];
  proofsWeHave?: Array<Pick<ProofLike, 'amount'>>;
  onCountersReserved?: OnCountersReserved;
};

/**
 * Configuration for melting operations.
 */
export type MeltProofsConfig = {
  keysetId?: string;
  privkey?: string | string[];
  onCountersReserved?: OnCountersReserved;
};

export type PrepareMeltConfig = MeltProofsConfig & {
  nut08Change?: boolean;
};

export type CompleteMeltOptions = {
  preferAsync?: boolean;
  extraPayload?: Record<string, unknown>;
};
