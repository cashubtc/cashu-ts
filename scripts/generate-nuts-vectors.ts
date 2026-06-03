// One-shot generator for nuts repo test vectors (NUT-00 BLS round-trip + batch, NUT-02 V3 keysets).
// Run from repo root: npx tsx scripts/generate-nuts-vectors.ts

import { bls12_381 } from '@noble/curves/bls12-381.js';
import { bytesToHex, numberToBytesBE } from '@noble/curves/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import {
  BLS_FR_ORDER,
  BLS_G2_GENERATOR,
  hashToCurveBls,
  blindMessageBls,
  createBlindSignatureBls,
  unblindSignatureBls,
  verifyUnblindedSignatureBls,
  type G1Point,
  type G2Point,
} from '../src/crypto/curve_bls';
import { deriveKeysetId } from '../src/utils/core';

const G2 = BLS_G2_GENERATOR;

function g2PubFromScalar(a: bigint): G2Point {
  return G2.multiply(a);
}

function hex(p: { toBytes: (compressed: boolean) => Uint8Array }): string {
  return bytesToHex(p.toBytes(true));
}

// ---------------------------------------------------------------------------
// 1. NUT-00 v3 round-trip: existing vector is secret="test_message", r=3, a=2.
// ---------------------------------------------------------------------------
function nut00RoundTrip() {
  const secret = utf8ToBytes('test_message');
  const r = 3n;
  const a = 2n;

  const Y = hashToCurveBls(secret);
  const K = g2PubFromScalar(a);

  const { B_ } = blindMessageBls(secret, r);
  const { C_ } = createBlindSignatureBls(B_, numberToBytesBE(a, 32), 'test');
  const C = unblindSignatureBls(C_, r);

  const ok = verifyUnblindedSignatureBls(K, C, secret);
  if (!ok) throw new Error('round-trip verify failed');

  return {
    secret: 'test_message',
    r: bytesToHex(numberToBytesBE(r, 32)),
    a: bytesToHex(numberToBytesBE(a, 32)),
    Y: hex(Y),
    K: hex(K),
    B_: hex(B_),
    C_: hex(C_),
    C: hex(C),
  };
}

// ---------------------------------------------------------------------------
// 2. NUT-02 V3 keysets: distinct G2 pubkeys per amount.
//    Test vectors exercise keyset ID derivation, not key derivation, so the keys are arbitrary
//    distinct G2 points. Using small prime scalars keeps regeneration reproducible without
//    suggesting any protocol-level relationship between amount and key.
// ---------------------------------------------------------------------------
const KEY_SCALARS = [7n, 13n, 29n, 71n];

function nut02V3Keyset(
  amounts: number[],
  unit: string,
  input_fee_ppk?: number,
  final_expiry?: number,
) {
  if (amounts.length > KEY_SCALARS.length) {
    throw new Error(`extend KEY_SCALARS beyond ${KEY_SCALARS.length} entries`);
  }
  const keys: Record<string, string> = {};
  amounts.forEach((amt, i) => {
    keys[amt.toString()] = hex(g2PubFromScalar(KEY_SCALARS[i]));
  });
  const id = deriveKeysetId(keys, {
    versionByte: 2,
    unit,
    input_fee_ppk,
    expiry: final_expiry,
  });
  return { id, unit, input_fee_ppk, final_expiry, keys };
}

// ---------------------------------------------------------------------------
// 3. Batch verification vector. Uses spec-correct rejection sampling
//    (u32 ctr, reject x >= BLS_FR_ORDER, reject x == 0).
// ---------------------------------------------------------------------------
const BLS_BATCH_DST = utf8ToBytes('Cashu_BLS_Batch_v1');

function deriveBatchWeightsSpec(items: Array<{ K2: G2Point; C: G1Point; secret: Uint8Array }>): {
  weights: bigint[];
  challenge: Uint8Array;
  transcript: Uint8Array;
} {
  const parts: Uint8Array[] = [BLS_BATCH_DST];
  for (const it of items) {
    parts.push(it.C.toBytes(true));
    parts.push(it.K2.toBytes(true));
    parts.push(numberToBytesBE(it.secret.length, 4));
    parts.push(it.secret);
  }
  const transcript = concatBytes(...parts);
  const challenge = sha256(transcript);

  const weights: bigint[] = [];
  for (let i = 0; i < items.length; i++) {
    let ri = 0n;
    for (let ctr = 0; ctr < 1 << 16; ctr++) {
      const h = sha256(concatBytes(challenge, numberToBytesBE(i, 4), numberToBytesBE(ctr, 4)));
      const x = BigInt('0x' + bytesToHex(h));
      if (x === 0n || x >= BLS_FR_ORDER) continue;
      ri = x;
      break;
    }
    if (ri === 0n) throw new Error('weight derivation failed (impossibly)');
    weights.push(ri);
  }
  return { weights, challenge, transcript };
}

function batchVerifySpec(items: Array<{ K2: G2Point; C: G1Point; secret: Uint8Array }>): {
  ok: boolean;
  weights: bigint[];
  challenge: Uint8Array;
} {
  const { weights: rs, challenge } = deriveBatchWeightsSpec(items);

  let sumC = items[0].C.multiply(rs[0]);
  for (let i = 1; i < items.length; i++) sumC = sumC.add(items[i].C.multiply(rs[i]));

  const grouped = new Map<string, { K2: G2Point; sumY: G1Point }>();
  for (let i = 0; i < items.length; i++) {
    const Y = hashToCurveBls(items[i].secret);
    const term = Y.multiply(rs[i]);
    const key = bytesToHex(items[i].K2.toBytes(true));
    const ex = grouped.get(key);
    if (ex) ex.sumY = ex.sumY.add(term);
    else grouped.set(key, { K2: items[i].K2, sumY: term });
  }

  const pairs: Array<{ g1: G1Point; g2: G2Point }> = [{ g1: sumC.negate(), g2: G2 }];
  for (const g of grouped.values()) pairs.push({ g1: g.sumY, g2: g.K2 });

  const acc = bls12_381.pairingBatch(pairs);
  const ok = bls12_381.fields.Fp12.eql(acc, bls12_381.fields.Fp12.ONE);
  return { ok, weights: rs, challenge };
}

function nut00Batch() {
  // Two proofs under the same mint key a=2, two different secrets.
  const a = 2n;
  const K = g2PubFromScalar(a);
  const items: Array<{
    secret: string;
    secretBytes: Uint8Array;
    r: bigint;
    B_: G1Point;
    C_: G1Point;
    C: G1Point;
  }> = [];

  for (const [secStr, r] of [
    ['batch_proof_1', 5n],
    ['batch_proof_2', 7n],
  ] as Array<[string, bigint]>) {
    const secretBytes = utf8ToBytes(secStr);
    const { B_ } = blindMessageBls(secretBytes, r);
    const { C_ } = createBlindSignatureBls(B_, numberToBytesBE(a, 32), 'test');
    const C = unblindSignatureBls(C_, r);
    items.push({ secret: secStr, secretBytes, r, B_, C_, C });
  }

  const inputs = items.map((it) => ({ K2: K, C: it.C, secret: it.secretBytes }));
  const { ok, weights, challenge } = batchVerifySpec(inputs);
  if (!ok) throw new Error('batch verify failed');

  // Also confirm tamper detection: flipping one C makes the batch fail.
  const tampered = inputs.map((x, i) => (i === 0 ? { ...x, C: items[1].C } : x));
  const { ok: ok2 } = batchVerifySpec(tampered);
  if (ok2) throw new Error('batch verify did not reject tampered input');

  return {
    K: hex(K),
    proofs: items.map((it) => ({
      secret: it.secret,
      r: bytesToHex(numberToBytesBE(it.r, 32)),
      C: hex(it.C),
    })),
    challenge: bytesToHex(challenge),
    weights: weights.map((w) => bytesToHex(numberToBytesBE(w, 32))),
    verify: ok,
  };
}

// ---------------------------------------------------------------------------
// 4. NUT-13 V3 deterministic blinding-factor derivation (rejection sampling).
//    Picks a (seed, keyset_id, counter) tuple where attempt=0 is rejected so the
//    vector locks in the retry behavior.
// ---------------------------------------------------------------------------
const KDF_DST = utf8ToBytes('Cashu_KDF_HMAC_SHA256');

function nut13V3Derive(seed: Uint8Array, keysetIdHex: string, counter: number) {
  const keysetIdBytes = new Uint8Array(keysetIdHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const counterBytes = numberToBytesBE(BigInt(counter), 8);
  const base = concatBytes(KDF_DST, keysetIdBytes, counterBytes);
  const secret = hmac(sha256, seed, concatBytes(base, new Uint8Array([0])));
  for (let attempt = 0; attempt < 1 << 16; attempt++) {
    const msg = concatBytes(base, new Uint8Array([1]), numberToBytesBE(attempt, 4));
    const digest = hmac(sha256, seed, msg);
    const x = BigInt('0x' + bytesToHex(digest));
    if (x === 0n || x >= BLS_FR_ORDER) continue;
    return { secret, r: digest, attempt };
  }
  throw new Error('nut13V3Derive: no acceptance');
}

function nut13V3Vector() {
  // Probe counters under a fixed seed/keyset until we find one where attempt=0 is rejected.
  const seed = utf8ToBytes('nut13 v3 test seed');
  const keysetIdHex = '02abd02ebc1ff44652153375162407deaf0b30e590844cca0b6e4894a08a8828dd';
  for (let counter = 0; counter < 200; counter++) {
    const out = nut13V3Derive(seed, keysetIdHex, counter);
    if (out.attempt > 0) {
      return {
        seed_utf8: 'nut13 v3 test seed',
        seed_hex: bytesToHex(seed),
        keyset_id: keysetIdHex,
        counter,
        accepted_attempt: out.attempt,
        secret: bytesToHex(out.secret),
        blinding_factor: bytesToHex(out.r),
      };
    }
  }
  throw new Error('nut13V3Vector: no retrying counter in [0, 200)');
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const out = {
  nut00_round_trip: nut00RoundTrip(),
  nut02_v3: {
    vector_1: nut02V3Keyset([1, 2], 'sat'),
    vector_2: nut02V3Keyset([1, 2, 4, 8], 'sat', 100, 2000000000),
  },
  nut00_batch: nut00Batch(),
  nut13_v3: nut13V3Vector(),
};
console.log(JSON.stringify(out, null, 2));
