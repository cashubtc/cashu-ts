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
 * Nutroot secrets 2.3 and 2.7. `keys` are the on-tree public keys the wallet can sign for, verbatim
 * or blinded; the scalars stay internal (planning and diagnostics need none). `satisfiable` is this
 * wallet's own assessment from what it holds; the mint compares an `after` leaf against its own
 * clock, so a leaf that unlocked seconds ago may still be refused.
 */
export type SpendOption = {
  leafIndex: number;
  /**
   * The disclosed leaf. For a legacy NUT-11 lock this is the same shape read off the secret: the
   * main path at index 0, the refund path (if any) as an `after` leaf at index 1; `n: 0` with no
   * keys is NUT-11's anyone-after-expiry, which no nutroot tree can encode, so never serialize it.
   */
  leaf: NutrootLeaf;
  keys: Array<{ keyIndex: number; pubkey: string; blinded: boolean }>;
  satisfiable: boolean;
  /**
   * Why the leaf is not satisfiable from what this wallet holds: an unexpired locktime, then a key
   * shortfall, then `preimage`, meaning a hashlock leaf whose keys are covered and which only needs
   * the caller-supplied preimage.
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
   * True when the wallet can recover a key-path key: a bearer `k`, or a receiver-keyed `E` matched
   * against a supplied private key. Also true for an unlocked legacy proof, which spends with no
   * witness at all.
   */
  keyPath: boolean;
  /**
   * One entry per disclosed leaf, in tree order. Empty when the proof discloses no tree.
   */
  script: SpendOption[];
  /**
   * The key path or some leaf spends it from what this wallet holds.
   */
  spendable: boolean;
  /**
   * Why nothing spends it, when `spendable` is false: `locktime` when a leaf this wallet covers is
   * only waiting (see `availableAt`), then `preimage`, then `threshold` when it holds some but not
   * enough keys, else `not-keyed-to-you`, meaning none of its keys are held.
   */
  blockedBy?: 'not-keyed-to-you' | 'locktime' | 'threshold' | 'preimage';
  /**
   * Unix seconds the earliest waiting leaf unlocks, with `blockedBy: 'locktime'`.
   */
  availableAt?: number;
};
