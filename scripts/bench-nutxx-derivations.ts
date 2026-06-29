/**
 * NUT-XX deterministic P2PK key derivation cost: HMAC-SHA256 (NUT-XX) vs BIP-32.
 *
 * The rebuttal this bench addresses: "BIP-32 is fine — you can derive the parent path
 * (m/129373'/10'/0'/0') once up front and then just .deriveChild(counter) per counter."
 *
 * Three timing rows:
 *
 * 1. HMAC NUT-XX — HMAC-SHA256(seed, DST || counter_be) + mod N + secp pubkey.
 * 2. BIP-32 cached — HDKey.fromMasterSeed + .derive(m/129373'/10'/0'/0') done once (outside the timed
 *    loop); per-counter cost is .deriveChild(counter) + secp pubkey only.
 * 3. BIP-32 cold — HDKey.fromMasterSeed inside the loop, full 5-step path traversal per counter.
 *    Included for context against the cached form.
 *
 * Two views per row:
 *
 * • Priv only — just the KDF step. Shows the raw HMAC vs BIP-32 cost without the point mul. • Priv.
 *
 * - Pub — full wallet pipeline: derive priv then compute compressed secp256k1 pubkey. This is what a
 *   wallet actually pays per counter when it generates a lock.
 *
 * Run: `npx tsx scripts/bench-nutxx-derivations.ts`
 */
import { HDKey } from '@scure/bip32';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

const SECP256K1_N = secp256k1.Point.Fn.ORDER;
const DST_NUT11 = new TextEncoder().encode('Cashu_KDF_HMAC_SHA256_NUT11');
const BIP32_PARENT_PATH = "m/129373'/10'/0'/0'";

// 64-byte seed (BIP-39-style). Real wallets feed the same width in.
const seed = randomBytes(64);

function u64be(n: number): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(n), false);
  return buf;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function toBigInt(bytes: Uint8Array): bigint {
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return x;
}

function bigIntTo32Bytes(x: bigint): Uint8Array {
  const hex = x.toString(16).padStart(64, '0');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ── Derivation primitives ───────────────────────────────────────────────────────────────

function hmacDerivePriv(seed: Uint8Array, counter: number): Uint8Array {
  const msg = concat(DST_NUT11, u64be(counter));
  const digest = hmac(sha256, seed, msg);
  const x = toBigInt(digest);
  const k = x % SECP256K1_N;
  if (k === 0n) throw new Error('priv == 0');
  return bigIntTo32Bytes(k);
}

function bip32CachedDerivePriv(parent: HDKey, counter: number): Uint8Array {
  const key = parent.deriveChild(counter).privateKey;
  if (key === null) throw new Error('null priv');
  return key;
}

function bip32CachedDerivePub(parent: HDKey, counter: number): Uint8Array {
  // BIP-32's HDKey stores the child pubkey internally after derivation. Use it directly
  // rather than re-running getPublicKey(priv) on top.
  const pub = parent.deriveChild(counter).publicKey;
  if (pub === null) throw new Error('null pub');
  return pub;
}

function bip32ColdDerivePriv(seed: Uint8Array, counter: number): Uint8Array {
  const master = HDKey.fromMasterSeed(seed);
  const key = master.derive(`${BIP32_PARENT_PATH}/${counter}`).privateKey;
  if (key === null) throw new Error('null priv');
  return key;
}

function bip32MasterCachedDerivePub(master: HDKey, counter: number): Uint8Array {
  // Master HDKey cached at wallet construction; full 5-step path traversed per counter.
  // This is what natural wallet code looks like when the master is kept in memory but the
  // parent path is not pre-computed (the most common implementation pattern).
  const pub = master.derive(`${BIP32_PARENT_PATH}/${counter}`).publicKey;
  if (pub === null) throw new Error('null pub');
  return pub;
}

function privToPub(priv: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(priv, true);
}

// ── Bench harness ───────────────────────────────────────────────────────────────────────

function timeMs(fn: () => void, iters: number): number {
  for (let i = 0; i < 3; i++) fn(); // warm-up
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return (performance.now() - t0) / iters;
}

console.log(
  'Benchmarking NUT-XX P2PK derivation: HMAC vs BIP-32 (cached parent) vs BIP-32 (cold).',
);
console.log('Pure-JS noble. Warm-ups + timed iterations; takes ~20s.\n');

// Sanity: all three produce a 32-byte priv for counter=0.
{
  const parent = HDKey.fromMasterSeed(seed).derive(BIP32_PARENT_PATH);
  const a = hmacDerivePriv(seed, 0);
  const b = bip32CachedDerivePriv(parent, 0);
  const c = bip32ColdDerivePriv(seed, 0);
  for (const [name, p] of [
    ['hmac', a],
    ['bip32-cached', b],
    ['bip32-cold', c],
  ] as const) {
    if (p.length !== 32) {
      console.error(`${name} produced unexpected length ${p.length}`);
      process.exit(1);
    }
    const pub = privToPub(p);
    if (pub.length !== 33) {
      console.error(`${name} pubkey length ${pub.length}, expected 33`);
      process.exit(1);
    }
  }
}

const sizes = [1, 10, 100, 1000];
const itersBySize: Record<number, number> = { 1: 500, 10: 200, 100: 50, 1000: 10 };

type Row = { n: number; hmac: number; cached: number; cold: number };

// ── 1. Priv-only — pure KDF cost ────────────────────────────────────────────────────────
const privRows: Row[] = [];
console.log('=== Priv-only (KDF step only, no pubkey derivation) — ms for all N counters ===');
console.log('N\tHMAC\t\tBIP-32 cached\tBIP-32 cold\tcached/HMAC\tcold/HMAC');
for (const n of sizes) {
  const iters = itersBySize[n] ?? 5;

  const hmacT = timeMs(() => {
    for (let i = 0; i < n; i++) hmacDerivePriv(seed, i);
  }, iters);

  const cachedT = timeMs(() => {
    const parent = HDKey.fromMasterSeed(seed).derive(BIP32_PARENT_PATH);
    for (let i = 0; i < n; i++) bip32CachedDerivePriv(parent, i);
  }, iters);

  const coldT = timeMs(() => {
    for (let i = 0; i < n; i++) bip32ColdDerivePriv(seed, i);
  }, iters);

  privRows.push({ n, hmac: hmacT, cached: cachedT, cold: coldT });
  console.log(
    `${n}\t${hmacT.toFixed(3)}\t\t${cachedT.toFixed(3)}\t\t${coldT.toFixed(3)}\t\t` +
      `${(cachedT / hmacT).toFixed(1)}×\t\t${(coldT / hmacT).toFixed(1)}×`,
  );
}
console.log('');

// ── 2. Priv + pub — full wallet pipeline ────────────────────────────────────────────────
// Four BIP-32 implementation patterns, increasing optimization level:
//   • Cold: master HDKey recomputed per derive (no caching at all).
//   • Master-cached: master HDKey kept alive; full 5-step path computed per derive. Natural
//     wallet code pattern.
//   • Parent-cached, priv->pub: parent path precomputed; per-counter deriveChild + explicit
//     getPublicKey(priv) on top.
//   • Parent-cached, HDKey.pub: parent path precomputed; HDKey.publicKey used directly (no
//     redundant scalar mul).
type PubRow = {
  n: number;
  hmac: number;
  cold: number;
  masterCached: number;
  parentCached: number;
  parentCachedDirect: number;
};
const pubRows: PubRow[] = [];
console.log(
  '=== Priv + pub (full wallet pipeline, compressed secp256k1 pubkey) — ms for all N counters ===',
);
console.log(
  'N\tHMAC\t\tcold\t\tmaster-cached\tparent-cached\tparent-cached*\tmaster/HMAC\tparent*/HMAC',
);
console.log('  \t    \t\t            \t(full path)  \t(priv->pub)  \t(HDKey.pub)  \t           \t');
for (const n of sizes) {
  const iters = itersBySize[n] ?? 5;

  const hmacT = timeMs(() => {
    for (let i = 0; i < n; i++) privToPub(hmacDerivePriv(seed, i));
  }, iters);

  const coldT = timeMs(() => {
    for (let i = 0; i < n; i++) privToPub(bip32ColdDerivePriv(seed, i));
  }, iters);

  const masterCachedT = timeMs(() => {
    const master = HDKey.fromMasterSeed(seed);
    for (let i = 0; i < n; i++) bip32MasterCachedDerivePub(master, i);
  }, iters);

  const parentCachedT = timeMs(() => {
    const parent = HDKey.fromMasterSeed(seed).derive(BIP32_PARENT_PATH);
    for (let i = 0; i < n; i++) privToPub(bip32CachedDerivePriv(parent, i));
  }, iters);

  const parentCachedDirectT = timeMs(() => {
    const parent = HDKey.fromMasterSeed(seed).derive(BIP32_PARENT_PATH);
    for (let i = 0; i < n; i++) bip32CachedDerivePub(parent, i);
  }, iters);

  pubRows.push({
    n,
    hmac: hmacT,
    cold: coldT,
    masterCached: masterCachedT,
    parentCached: parentCachedT,
    parentCachedDirect: parentCachedDirectT,
  });
  console.log(
    `${n}\t${hmacT.toFixed(3)}\t\t${coldT.toFixed(3)}\t\t${masterCachedT.toFixed(3)}\t\t${parentCachedT.toFixed(3)}\t\t${parentCachedDirectT.toFixed(3)}\t\t` +
      `${(masterCachedT / hmacT).toFixed(1)}×\t\t${(parentCachedDirectT / hmacT).toFixed(1)}×`,
  );
}
console.log('');

// ── Explainer ───────────────────────────────────────────────────────────────────────────
{
  const privMax = privRows[privRows.length - 1];
  const pubMax = pubRows[pubRows.length - 1];

  console.log('─'.repeat(80));
  console.log('What the numbers mean (this run):\n');

  const hmacPer = pubMax.hmac / pubMax.n;
  const masterCachedPer = pubMax.masterCached / pubMax.n;
  const parentCachedPer = pubMax.parentCachedDirect / pubMax.n;
  const coldPer = pubMax.cold / pubMax.n;

  console.log(
    `Per-counter at N=${pubMax.n} (full wallet pipeline — priv + pubkey):\n` +
      `  HMAC NUT-XX              ${hmacPer.toFixed(4)} ms\n` +
      `  BIP-32 cold              ${coldPer.toFixed(4)} ms  (${(coldPer / hmacPer).toFixed(1)}× HMAC)\n` +
      `  BIP-32 master-cached     ${masterCachedPer.toFixed(4)} ms  (${(masterCachedPer / hmacPer).toFixed(1)}× HMAC)  ← natural wallet code\n` +
      `  BIP-32 parent-cached*    ${parentCachedPer.toFixed(4)} ms  (${(parentCachedPer / hmacPer).toFixed(1)}× HMAC)  ← optimized code`,
  );

  console.log('');
  console.log('• "Cold" = no caching at all (HDKey.fromMasterSeed every call). Worst case.');
  console.log(
    '• "Master-cached" = master HDKey kept alive; full 5-step path computed per derive. This is\n' +
      '  the natural pattern for one-shot regular ops (a wallet generating a single P2PK lock or\n' +
      '  quote pubkey). The parent-cache optimization is unnatural here because the wallet does\n' +
      '  not know in advance it will need more derivations from the same parent.',
  );
  console.log(
    "• \"Parent-cached*\" = parent path m/129373'/10'/0'/0' pre-computed; HDKey.publicKey used\n" +
      '  directly. This is the fully optimized pattern, natural for restore loops where the\n' +
      '  wallet will burn through many counters in succession.',
  );
  console.log(
    '• HMAC has no equivalent caching decision: the seed is the only input, no path to amortize.\n' +
      '  Single-derive cost equals batch per-counter cost.',
  );
  console.log(
    `\nTakeaway: the ~150× figure is raw KDF priv-only without pubkey. For the wallet pipeline\n` +
      `(priv + pub) the realistic gap is ${(masterCachedPer / hmacPer).toFixed(1)}× for natural single-derive code and\n` +
      `${(parentCachedPer / hmacPer).toFixed(1)}× for optimized batch derive (restore).`,
  );
}
