/**
 * Secp256k1 (v0/v1/v2) vs. BLS12-381 (v3) cost comparison for the two hot wallet-side primitives:
 *
 * 1. Blinding — `blindMessage` vs `blindMessageBls` (per output, no batching either side).
 * 2. Proof checking — wallet-side signature verification:
 *
 *    - Secp: NUT-12 DLEQ re-blind verify (`verifyDLEQProof_reblind`), the path `hasValidDleq` /
 *         `verifyProofsForReceive` take for v0/v1/v2 proofs.
 *    - Bls per-proof: pairing equality (`verifyUnblindedSignatureBls`).
 *    - Bls batch: single multi-pairing (`batchVerifyUnblindedSignatureBls`).
 *
 * Companion to `bench-bls-verify.ts` (which compares only bls per-proof vs bls batch). Re-run after
 * touching the blinding/verify primitives on either curve or upgrading `@noble/curves`.
 *
 * Run: `npx tsx scripts/bench-secp-vs-bls.ts`
 */
import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { hexToBytes, numberToBytesBE } from '@noble/curves/utils.js';

import type { DLEQ } from '../src/crypto/core';
import {
  blindMessage,
  createBlindSignature,
  getPubKeyFromPrivKey,
  pointFromBytes,
  unblindSignature,
} from '../src/crypto/curve_secp';
import {
  type G1Point,
  type G2Point,
  batchVerifyUnblindedSignatureBls,
  blindMessageBls,
  createBlindSignatureBls,
  unblindSignatureBls,
  verifyUnblindedSignatureBls,
} from '../src/crypto/curve_bls';
import { createDLEQProof, verifyDLEQProof_reblind } from '../src/crypto/NUT12';

type SecpItem = {
  secret: Uint8Array;
  C: WeierstrassPoint<bigint>;
  A: WeierstrassPoint<bigint>;
  dleq: DLEQ;
};
type BlsItem = { K2: G2Point; C: G1Point; secret: Uint8Array };

// A quarter of the proofs use the first mint scalar, the rest the second — mimics realistic mixed
// denominations where many amounts share a keyset and there's one key per amount. Both curves take
// the same big-endian 32-byte scalar so the comparison holds the mint key constant.
function mintScalar(i: number): bigint {
  return i % 4 === 0 ? 11n : 5n;
}

function makeSecpItems(n: number): SecpItem[] {
  const items: SecpItem[] = [];
  for (let i = 0; i < n; i++) {
    const secret = new TextEncoder().encode(`secret-${i}`);
    const priv = numberToBytesBE(mintScalar(i), 32);
    const A = pointFromBytes(getPubKeyFromPrivKey(priv));
    const r = BigInt(i + 1) * 3n + 7n;
    const { B_ } = blindMessage(secret, r);
    const { C_ } = createBlindSignature(B_, priv, 'k');
    const C = unblindSignature(C_, r, A);
    // Token-carried DLEQ includes r so the receiver can re-blind (NUT-12).
    const dleq: DLEQ = { ...createDLEQProof(B_, priv), r };
    items.push({ secret, C, A, dleq });
  }
  return items;
}

function makeBlsItems(n: number): BlsItem[] {
  const items: BlsItem[] = [];
  for (let i = 0; i < n; i++) {
    const secret = new TextEncoder().encode(`secret-${i}`);
    const a = mintScalar(i);
    // K2 = a·G2 must be derived from the same scalar createBlindSignatureBls signs with.
    const aBytes = hexToBytes(a.toString(16).padStart(64, '0'));
    const K2 = bls12_381.G2.Point.BASE.multiply(a);
    const r = BigInt(i + 1) * 3n + 7n;
    const { B_ } = blindMessageBls(secret, r);
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'k');
    const C = unblindSignatureBls(C_, r);
    items.push({ K2, C, secret });
  }
  return items;
}

function timeMs(fn: () => void, iters: number): number {
  for (let i = 0; i < 3; i++) fn(); // warm-up
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return (performance.now() - t0) / iters;
}

console.log('Benchmarking secp256k1 (v0/v1/v2) vs BLS12-381 (v3) — pure-JS noble.');
console.log('Runs warm-ups + timed iterations; takes ~20-40s. Results stream below.\n');

// Collected during the run, summarized in the closing explainer.
let blindSecpMs = 0;
let blindBlsMs = 0;
type ProofRow = { n: number; secp: number; blsPerProof: number; blsBatch: number };
const proofRows: ProofRow[] = [];

// ── 1. Blinding ───────────────────────────────────────────────────────────────────────────────
// Single op per output; nothing batches. Blind a fixed pool with a fixed r so we isolate the curve
// math (the per-blind CSPRNG draw for r is equal on both sides and would only add common noise).
{
  const POOL = 64;
  const r = 12345n;
  const secrets = Array.from({ length: POOL }, (_, i) => new TextEncoder().encode(`blind-${i}`));
  const iters = 200;

  console.log(`[1/2] Blinding — timing secp + BLS (${POOL} outputs × ${iters} iters each)...`);
  const secp = timeMs(() => {
    for (const s of secrets) blindMessage(s, r);
  }, iters);
  const bls = timeMs(() => {
    for (const s of secrets) blindMessageBls(s, r);
  }, iters);

  blindSecpMs = secp / POOL; // ms/op
  blindBlsMs = bls / POOL;
  console.log('=== Blinding (per output) ===');
  console.log(`secp256k1 blindMessage:    ${blindSecpMs.toFixed(3)} ms/op`);
  console.log(`BLS12-381 blindMessageBls: ${blindBlsMs.toFixed(3)} ms/op`);
  console.log(`bls / secp:                ${(blindBlsMs / blindSecpMs).toFixed(2)}×`);
  console.log('');
}

// ── 2. Proof checking ─────────────────────────────────────────────────────────────────────────
// Wallet-side verification scaling with batch size N.
{
  const sizes = [1, 4, 8, 16, 32];
  const itersBySize: Record<number, number> = { 1: 50, 4: 30, 8: 20, 16: 10, 32: 5 };

  console.log(
    '[2/2] Proof checking — timing per N (largest N is slowest); rows stream as ready...',
  );
  console.log('=== Proof checking (wallet-side verification, ms for all N) ===');
  // Ratios < 1 ⇒ secp DLEQ cheaper. secp÷bls/proof is the per-op cost; secp÷batch is the real
  // receive comparison (verifyProofsForReceive batches the v3 subset). BLS single-vs-batch is in
  // bench-bls-verify.ts.
  console.log('N\tsecp DLEQ\tbls/proof\tbls batch\tsecp÷bls/proof\tsecp÷batch');
  for (const n of sizes) {
    const secpItems = makeSecpItems(n);
    const blsItems = makeBlsItems(n);
    const iters = itersBySize[n] ?? 5;

    // Sanity: every path must actually verify true, or we'd be timing an early-out, not the work.
    const secpOk = secpItems.every((it) => verifyDLEQProof_reblind(it.secret, it.dleq, it.C, it.A));
    const blsOk = blsItems.every((it) => verifyUnblindedSignatureBls(it.K2, it.C, it.secret));
    const batchOk = batchVerifyUnblindedSignatureBls(blsItems);
    if (!secpOk || !blsOk || !batchOk) {
      console.error(`MISMATCH at N=${n} — secp:${secpOk} bls:${blsOk} batch:${batchOk}`);
      process.exit(1);
    }

    const secp = timeMs(() => {
      for (const it of secpItems) verifyDLEQProof_reblind(it.secret, it.dleq, it.C, it.A);
    }, iters);
    const blsPerProof = timeMs(() => {
      for (const it of blsItems) verifyUnblindedSignatureBls(it.K2, it.C, it.secret);
    }, iters);
    const blsBatch = timeMs(() => {
      batchVerifyUnblindedSignatureBls(blsItems);
    }, iters);

    proofRows.push({ n, secp, blsPerProof, blsBatch });
    const secpVsBls = secp / blsPerProof; // >1 ⇒ secp DLEQ slower than a single pairing
    const secpVsBatch = secp / blsBatch; // >1 ⇒ secp DLEQ slower than the BLS batch path
    console.log(
      `${n}\t${secp.toFixed(2)}\t\t${blsPerProof.toFixed(2)}\t\t${blsBatch.toFixed(2)}\t\t` +
        `${secpVsBls.toFixed(2)}×\t\t${secpVsBatch.toFixed(2)}×`,
    );
  }
}

// ── Explainer ─────────────────────────────────────────────────────────────────────────────────
// Turn the raw table into the read a reviewer would give it, computed from this run's numbers.
{
  const blindRatio = blindBlsMs / blindSecpMs;
  const maxRow = proofRows[proofRows.length - 1];
  const firstBatchWin = proofRows.find((row) => row.blsBatch < row.blsPerProof);
  const pairingVsDleq =
    proofRows.reduce((acc, row) => acc + row.blsPerProof / row.secp, 0) / proofRows.length;
  const batchVsDleqAtMax = maxRow.blsBatch / maxRow.secp;

  console.log('\n' + '─'.repeat(76));
  console.log('What the numbers mean (this run):\n');
  console.log(
    `• Blinding is wallet-side and ~${blindRatio.toFixed(0)}× heavier on BLS ` +
      `(${blindBlsMs.toFixed(2)} vs ${blindSecpMs.toFixed(2)} ms/output) with no batch path`,
  );
  console.log(
    `  — but at ~${blindBlsMs.toFixed(1)} ms each it only becomes significant for large batches.`,
  );
  console.log(
    `• Per op, a single BLS pairing verify costs ~${pairingVsDleq.toFixed(1)}× a secp DLEQ verify.`,
  );
  if (firstBatchWin) {
    console.log(
      `• BLS batch verify overtakes per-proof from N=${firstBatchWin.n}; at N=${maxRow.n} it costs ` +
        `~${batchVsDleqAtMax.toFixed(2)}× secp DLEQ — same ballpark, not ${blindRatio.toFixed(0)}×.`,
    );
  }
  console.log(
    `  Batch is the path verifyProofsForReceive takes, so BLS stays competitive where wallets verify most.`,
  );
  console.log(
    `\nTakeaway: BLS's cost concentrates in wallet-side blinding, not verification. These are pure-JS`,
  );
  console.log(
    `noble timings on one machine — read the ratios, not the milliseconds, as the durable signal.`,
  );
}
