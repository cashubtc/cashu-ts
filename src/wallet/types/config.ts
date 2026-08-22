import { type P2PKOptions } from '../../crypto';
import { type NutrootLeaf } from '../../crypto/nutroot';
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
   * Counters per restore request. Defaults to the mint's advertised `max_array_length` (NUT-06), or
   * `500` when it advertises none.
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
 * Configuration for `restoreAll`: `batchRestore` options minus the per-keyset fields.
 */
export type RestoreAllConfig = Omit<BatchRestoreConfig, 'counter' | 'keysetId'>;

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
       * Receiver-keyed nutroot outputs on a v3 keyset (NUT-28).
       *
       * @remarks
       * Each output is derived to `receiverPub` under its own fresh ephemeral, and carries the
       * spend info the payee needs. `leaves` lock the outputs under a tree; `blindKeys` names the
       * leaf keys their owner tagged blind-me.
       */
      type: 'nutroot';
      options: { receiverPub: string; leaves?: NutrootLeaf[]; blindKeys?: string[] };
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
 * A caller's choice to spend one v3 input through one leaf of its disclosed tree (NUT-10).
 *
 * @remarks
 * Keyed by `secret`, not by input index: selection decides the input order and the caller does not
 * see it before the transaction is built. The wallet supplies the slot keys it holds for the leaf;
 * `extraKeys` and `preimage` are what only the caller can provide.
 */
export type ScriptPathPlan = {
  /**
   * The input to spend this way, by its 33-byte point secret hex.
   */
  secret: string;
  /**
   * Which leaf of the proof's disclosed tree, by its index in that list.
   */
  leafIndex: number;
  /**
   * Preimage for a hashlock leaf, hex.
   */
  preimage?: string;
  /**
   * Keys to sign with beyond those the wallet recovers itself, hex.
   */
  extraKeys?: string[];
  /**
   * Co-signer hook for a leaf whose other keys live elsewhere, called once the transaction is fixed
   * and its digest known.
   *
   * @remarks
   * Awaited inside the send, so it may reach a remote signer, but the transaction is in flight
   * while it runs: use it for ceremonies measured in seconds, not ones needing human approval
   * across days. Returns BIP-340 signature hex over `digest` by the leaf's keys.
   */
  cosign?: (digest: Uint8Array, leaf: NutrootLeaf) => Promise<string[]>;
};

/**
 * Configuration for send operations.
 */
export type SendConfig = {
  keysetId?: string;
  privkey?: string | string[];
  scriptPath?: ScriptPathPlan[];
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
  scriptPath?: ScriptPathPlan[];
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
  scriptPath?: ScriptPathPlan[];
  onCountersReserved?: OnCountersReserved;
  /**
   * Request NUT-08 blank outputs so the mint can return unspent fee reserve. Defaults to true. Set
   * false to forfeit the change, which also permits melting on an inactive keyset.
   */
  nut08Change?: boolean;
};

export type CompleteMeltOptions = {
  preferAsync?: boolean;
  /**
   * Method-specific fields merged into the melt request. Keys that collide with the prepared
   * request (`quote`, `inputs`, `outputs`, `prefer_async`) are rejected.
   */
  extraPayload?: Record<string, unknown>;
  /**
   * Script path spends for v3 inputs, evaluated when the transaction digest exists.
   */
  scriptPath?: ScriptPathPlan[];
};
