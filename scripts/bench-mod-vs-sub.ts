/**
 * Compare `x % FR` vs. up-to-two conditional subtracts for reducing a 256-bit value mod Fr.
 *
 * Run: `npx tsx scripts/bench-mod-vs-sub.ts`
 */
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { bytesToNumberBE, randomBytes } from '@noble/curves/utils.js';

const FR = bls12_381.fields.Fr.ORDER;

// Pre-generate 100k 256-bit inputs (uniform over [0, 2^256)).
const N = 100_000;
const inputs: bigint[] = [];
for (let i = 0; i < N; i++) inputs.push(bytesToNumberBE(randomBytes(32)));

function reduceMod(): bigint {
  let acc = 0n;
  for (const x of inputs) acc ^= x % FR;
  return acc;
}

function reduceSub(): bigint {
  let acc = 0n;
  for (let x of inputs) {
    if (x >= FR) x -= FR;
    if (x >= FR) x -= FR; // SHA-256 max < 3·Fr, so at most two subs are ever needed.
    acc ^= x;
  }
  return acc;
}

function reduceSubWhile(): bigint {
  let acc = 0n;
  for (let x of inputs) {
    while (x >= FR) x -= FR;
    acc ^= x;
  }
  return acc;
}

function time(fn: () => bigint, iters: number): { ms: number; result: bigint } {
  for (let i = 0; i < 3; i++) fn(); // warmup
  let result = 0n;
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) result = fn();
  return { ms: (performance.now() - t0) / iters, result };
}

const iters = 10;
const mod = time(reduceMod, iters);
const sub = time(reduceSub, iters);
const subWhile = time(reduceSubWhile, iters);

// Sanity: all three must produce the same XOR-fold (equivalence check).
if (mod.result !== sub.result || mod.result !== subWhile.result) {
  console.error('MISMATCH — reductions disagree.');
  process.exit(1);
}

// Per-element nanoseconds.
console.log(`Inputs:                ${N.toLocaleString()}`);
console.log(`% FR:                  ${((mod.ms * 1e6) / N).toFixed(1)} ns/reduce`);
console.log(`if/if subtract:        ${((sub.ms * 1e6) / N).toFixed(1)} ns/reduce`);
console.log(`while subtract:        ${((subWhile.ms * 1e6) / N).toFixed(1)} ns/reduce`);
console.log(`Speedup if/if vs %:    ${(mod.ms / sub.ms).toFixed(2)}×`);
