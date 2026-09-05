/**
 * Internal wallet utilities — not part of the public API.
 */
import { isBlsKeyset } from '../crypto/curves';
import { Amount, type AmountLike } from '../model/Amount';
import { type OutputDataLike } from '../model/OutputData';
import type {
  HasKeysetKeys,
  Keys,
  Proof,
  SerializedBlindedMessage,
  SerializedBlindedSignature,
} from '../model/types';
import { BATCH_POOL_SIZE } from '../transport';
import { splitAmount } from '../utils/core';

import { type OutputType } from './types';

/**
 * Turns a NUT-09 restore response into proofs.
 *
 * @remarks
 * The mint replies only for outputs it has signed, so results are matched back by `B_` rather than
 * by position. `lastIndex` is the highest index in `outputData` that came back signed, or -1 for
 * none; callers map that to a counter, because probed counters need not be contiguous. Zero-value
 * signatures count as used but yield no proof (NUT-08); `keysetFor` resolves the keyset each
 * signature names, which need not be the scanned one.
 */
export function proofsFromRestoreResponse(
  outputData: OutputDataLike[],
  response: { outputs: SerializedBlindedMessage[]; signatures: SerializedBlindedSignature[] },
  keysetFor: (id: string) => HasKeysetKeys,
): { proofs: Proof[]; lastIndex: number } {
  const signatureByB_: { [b: string]: SerializedBlindedSignature } = {};
  response.outputs.forEach((o, i) => (signatureByB_[o.B_] = response.signatures[i]));

  const proofs: Proof[] = [];
  let lastIndex = -1;
  outputData.forEach((data, i) => {
    const signature = signatureByB_[data.blindedMessage.B_];
    if (!signature) return; // counter was never issued into
    lastIndex = i;
    // Signed at zero (a NUT-08 blank the mint did not omit): used counter, but no ecash
    if (signature.amount.isZero()) return;
    // The output stays a blank: toProof takes the amount and keyset from the signature
    proofs.push(data.toProof(signature, keysetFor(signature.id)));
  });
  return { proofs, lastIndex };
}

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
    case 'lock': {
      // Keys and hashes identify the parties: log the shape, not the material.
      const opts = ot.options;
      return JSON.stringify({
        type: 'lock',
        mainKeys: opts.mainKeys?.length ?? 0,
        refundKeys: opts.refundKeys?.length ?? 0,
        ...(opts.hashlock && { hashlock: true }),
        ...(opts.locktime !== undefined && { locktime: opts.locktime }),
        ...(opts.leaves?.length && { leaves: opts.leaves.length }),
        ...(opts.blindKeys && { blindKeys: true }),
        denominations: (ot.denominations ?? []).map((d) => Amount.from(d).toString()),
      });
    }
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
 * input digest before the payload is built (a script path signature collected out of band) must
 * order outputs exactly as the payload will. Two implementations would agree until one was edited;
 * one cannot disagree with itself.
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

/**
 * Scan geometry for a keyset kind: counters per restore batch and batches in flight.
 *
 * @remarks
 * Every scanned counter costs a derivation, a `Y` and, past the frontier, a blinded message, all on
 * the JS thread: about 0.1ms for HMAC (v1), 0.7ms for BIP32 (v0) and 1.1ms for BLS (v3). A batch is
 * sized to roughly one round trip of that work. Width only hides latency, and on the dear kinds two
 * batches already saturate it; wider waves just deepen the overshoot past the frontier.
 * @internal
 */
export function scanProfile(keysetId: string): { batchSize: number; poolSize: number } {
  if (isBlsKeyset(keysetId)) return { batchSize: 100, poolSize: 2 };
  // BIP32 (v0) keysets: base64 ids, or hex ids with a 00 version byte
  const bip32 = keysetId.startsWith('00') || !/^[0-9a-f]+$/i.test(keysetId);
  return bip32 ? { batchSize: 200, poolSize: 2 } : { batchSize: 500, poolSize: BATCH_POOL_SIZE };
}
