/**
 * Per-proof vs batch BLS pairing verification regression bench.
 *
 * Originally Phase 8 (wire-or-not decision); batch is now wired in `verifyProofsForReceive`. Kept
 * as a regression check — re-run after touching `verifyUnblindedSignatureBls`,
 * `batchVerifyUnblindedSignatureBls`, or upgrading `@noble/curves`.
 *
 * Run: `npx tsx scripts/bench-bls-verify.ts`
 */
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { hexToBytes } from '@noble/curves/utils.js';

import {
  type G1Point,
  type G2Point,
  blindMessageBls,
  createBlindSignatureBls,
  unblindSignatureBls,
  verifyUnblindedSignatureBls,
  batchVerifyUnblindedSignatureBls,
} from '../src/crypto/bls';

type Item = { K2: G2Point; C: G1Point; secret: Uint8Array };

function makeItems(n: number): Item[] {
  const items: Item[] = [];
  // Half the proofs share one mint key, the other half another — mimics realistic mixed denominations
  // where many amounts come from the same keyset and one mint key per amount index.
  for (let i = 0; i < n; i++) {
    const secret = new TextEncoder().encode(`secret-${i}`);
    const r = BigInt(i + 1) * 3n + 7n;
    const a = i % 4 === 0 ? 11n : 5n;
    const aBytes = hexToBytes(a.toString(16).padStart(64, '0'));
    const K2 = bls12_381.G2.Point.BASE.multiply(a);
    const { B_ } = blindMessageBls(secret, r);
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'k');
    const C = unblindSignatureBls(C_, r);
    items.push({ K2, C, secret });
  }
  return items;
}

function timeMs(fn: () => void, iters: number): number {
  // Warm-up
  for (let i = 0; i < 3; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return (performance.now() - t0) / iters;
}

const sizes = [1, 4, 8, 16, 32];
const itersBySize: Record<number, number> = { 1: 50, 4: 30, 8: 20, 16: 10, 32: 5 };

console.log('N\tper-proof (ms)\tbatch (ms)\tspeedup');
for (const n of sizes) {
  const items = makeItems(n);
  const iters = itersBySize[n] ?? 5;

  const perProof = timeMs(() => {
    for (const it of items) verifyUnblindedSignatureBls(it.K2, it.C, it.secret);
  }, iters);

  const batch = timeMs(() => {
    batchVerifyUnblindedSignatureBls(items);
  }, iters);

  const speedup = perProof / batch;
  console.log(`${n}\t${perProof.toFixed(2)}\t\t${batch.toFixed(2)}\t\t${speedup.toFixed(2)}x`);
}
