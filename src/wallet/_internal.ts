/**
 * Internal wallet utilities — not part of the public API.
 */
import { Amount, type AmountLike } from '../model/Amount';
import { type OutputDataLike } from '../model/OutputData';
import type { Keys, Proof } from '../model/types';
import { splitAmount } from '../utils/core';

import { type OutputType } from './types';

/**
 * Exact `ceil(log2(n))` for n >= 1, computed on bigint so u64-scale inputs never lose precision.
 * Returns 0 for n <= 1. Used for NUT-08 blank output counts.
 */
export function ceilLog2(n: bigint): number {
  return n <= 1n ? 0 : (n - 1n).toString(2).length;
}

function getKeysetAmountsAsc(keys: Keys): Amount[] {
  const amounts = Object.keys(keys).map((k) => Amount.from(k));
  amounts.sort((a, b) => a.compareTo(b));
  return amounts;
}

/**
 * Creates a list of amounts to keep based on the proofs we have and the proofs we want to reach.
 *
 * @param proofsWeHave Proofs stored (from current mint) — only `.amount` is read.
 * @param amountToKeep Amount to keep.
 * @param keys Keys of current keyset.
 * @param targetCount The target number of proofs to reach.
 * @returns An array of amounts to keep.
 */
export function getKeepAmounts(
  proofsWeHave: Array<Pick<Proof, 'amount'>>,
  amountToKeep: AmountLike,
  keys: Keys,
  targetCount: number,
): Amount[] {
  const normalizedAmountToKeep = Amount.from(amountToKeep);
  const amountsWeWant: Amount[] = [];
  let runningTotal = Amount.zero();
  const amountsWeHave = proofsWeHave.map((p) => p.amount);
  for (const amt of getKeysetAmountsAsc(keys)) {
    const countWeHave = amountsWeHave.filter((a) => amt.equals(a)).length;
    const countWeWant = Math.max(targetCount - countWeHave, 0);
    for (let i = 0; i < countWeWant; ++i) {
      const nextTotal = runningTotal.add(amt);
      if (nextTotal.greaterThan(normalizedAmountToKeep)) {
        break;
      }
      amountsWeWant.push(amt);
      runningTotal = nextTotal;
    }
  }
  const amountDiff = normalizedAmountToKeep.subtract(runningTotal);
  if (!amountDiff.isZero()) {
    for (const amt of splitAmount(amountDiff, keys)) {
      amountsWeWant.push(amt);
      runningTotal = runningTotal.add(amt);
    }
  }
  return amountsWeWant.sort((a, b) => a.compareTo(b));
}

/**
 * Helper to properly format OutputTypes for logs.
 */
export function stringifyOutputTypeForLog(ot: OutputType): string {
  switch (ot.type) {
    case 'custom':
      return JSON.stringify({
        type: 'custom',
        outputs: ot.data.length,
        amounts: ot.data.map((d) => d.blindedMessage.amount.toString()),
      });
    case 'factory':
      return JSON.stringify({
        type: 'factory',
        denominations: (ot.denominations ?? []).map((d) => Amount.from(d).toString()),
      });
    case 'deterministic':
      return JSON.stringify({
        type: 'deterministic',
        counter: ot.counter,
        denominations: (ot.denominations ?? []).map((d) => Amount.from(d).toString()),
      });
    case 'p2pk': {
      // P2BK: the natural keys are only blinded later, so log placeholders instead
      const opts = ot.options;
      const options = opts.blindKeys
        ? {
            ...opts,
            data: opts.kind === 'P2PK' ? '[redacted]' : opts.data,
            pubkeys: opts.pubkeys?.map(() => '[redacted]'),
            refundKeys: opts.refundKeys?.map(() => '[redacted]'),
          }
        : opts;
      return JSON.stringify({
        type: 'p2pk',
        options,
        denominations: (ot.denominations ?? []).map((d) => Amount.from(d).toString()),
      });
    }
    case 'taproot':
      // The receiver key and its tree identify the payee: log the shape, not the keys.
      return JSON.stringify({
        type: 'taproot',
        leaves: ot.options.leaves?.length ?? 0,
        blindKeys: ot.options.blindKeys?.length ?? 0,
        denominations: (ot.denominations ?? []).map((d) => Amount.from(d).toString()),
      });
    case 'random':
      return JSON.stringify({
        type: 'random',
        denominations: (ot.denominations ?? []).map((d) => Amount.from(d).toString()),
      });
    default:
      return 'Unknown';
  }
}

/**
 * The order outputs take in a swap payload: ascending by amount, so the mint cannot read the
 * keep/send split off their position.
 *
 * @remarks
 * Exported and shared rather than inlined at the one call site, because anything that needs the
 * transaction digest before the payload is built (a script path signature collected out of band)
 * must order outputs exactly as the payload will. Two implementations would agree until one was
 * edited; one cannot disagree with itself.
 *
 * Ties keep their original order, so equal-amount outputs still leak their keep/send split by
 * position. Fixing that means randomizing within a tie, which is a separate change: it would make
 * the order unreproducible from the preview unless the choice is carried with it.
 * @param keepOutputs Outputs the wallet keeps.
 * @param sendOutputs Outputs being sent.
 * @param sorted Set false to leave construction order alone (SIG_ALL fixes order for signing).
 * @returns The ordered output data, a parallel vector marking which are keeps, and the source
 *   indices so callers can map results back to construction order.
 */
export function orderOutputsForPayload(
  keepOutputs: OutputDataLike[],
  sendOutputs: OutputDataLike[] = [],
  sorted = true,
): { outputData: OutputDataLike[]; keepVector: boolean[]; indices: number[] } {
  const merged = [...keepOutputs, ...sendOutputs];
  const indices = merged.map((_, i) => i);
  if (sorted) {
    indices.sort((a, b) =>
      merged[a].blindedMessage.amount.compareTo(merged[b].blindedMessage.amount),
    );
  }
  const keeps: boolean[] = [
    ...Array.from({ length: keepOutputs.length }, () => true),
    ...Array.from({ length: sendOutputs.length }, () => false),
  ];
  return {
    outputData: indices.map((i) => merged[i]),
    keepVector: indices.map((i) => keeps[i]),
    indices,
  };
}
