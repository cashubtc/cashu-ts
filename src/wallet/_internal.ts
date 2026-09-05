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
 * none; callers map that to a counter, because probed counters need not be contiguous.
 */
export function proofsFromRestoreResponse(
  outputData: OutputDataLike[],
  response: { outputs: SerializedBlindedMessage[]; signatures: SerializedBlindedSignature[] },
  keyset: HasKeysetKeys,
): { proofs: Proof[]; lastIndex: number } {
  const signatureByB_: { [b: string]: SerializedBlindedSignature } = {};
  response.outputs.forEach((o, i) => (signatureByB_[o.B_] = response.signatures[i]));

  const proofs: Proof[] = [];
  let lastIndex = -1;
  outputData.forEach((data, i) => {
    const signature = signatureByB_[data.blindedMessage.B_];
    if (!signature) return; // counter was never issued into
    lastIndex = i;
    // restore outputs are blanks (amount 0), so the mint's amount is authoritative
    data.blindedMessage.amount = signature.amount;
    proofs.push(data.toProof(signature, keyset));
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
