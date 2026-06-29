import { type Fp2 } from '@noble/curves/abstract/tower.js';
import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import {
  randomBytes,
  bytesToHex,
  bytesToNumberBE,
  hexToBytes,
  numberToBytesBE,
} from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import { CTSError } from '../model/Errors';

import type { BlindSignature, RawBlindedMessage, UnblindedSignature } from './core';

export type G1Point = WeierstrassPoint<bigint>;
export type G2Point = WeierstrassPoint<Fp2>;

/**
 * Domain-separation tag for `hashToCurveG1` on v3 keysets.
 *
 * RFC 9380 random-oracle suite for BLS12-381 G1 (`BLS12381G1_XMD:SHA-256_SSWU_RO_`) with a
 * Cashu-specific prefix so a v3 wallet's `Y = hashToCurveG1(secret)` matches the mint's exactly.
 *
 * Source: Nutshell PR #999 (`cashu/core/crypto/bls.py`).
 */
export const BLS_HASH_TO_CURVE_DST = 'CASHU_BLS12_381_G1_XMD:SHA-256_SSWU_RO_';

/**
 * BLS12-381 scalar field order (Fr). Distinct from secp256k1's `n`.
 *
 * Used for the NUT-13 HMAC reduction on v3 keysets and for the modular inverse of `r` during
 * wallet-side unblinding. Sourced from `@noble/curves/bls12-381` so it tracks the library; verified
 * equal to the locked constant in Nutshell PR #999 / RFC 9380:
 * `52435875175126190479447740508185965837690552500527637822603658699938581184513`.
 */
export const BLS_FR_ORDER = bls12_381.fields.Fr.ORDER;

/**
 * G2 generator used for the pairing equality `e(C, G2_gen) == e(Y, K2)`.
 *
 * Sourced from `@noble/curves/bls12-381` (`bls12_381.G2.Point.BASE`); verified byte-for-byte equal
 * to Nutshell PR #999's hardcoded `_G2_HEX` (compressed, 96 bytes / 192 hex chars).
 */
export const BLS_G2_GENERATOR = bls12_381.G2.Point.BASE;

/**
 * Domain-separation tag for the Fiat-Shamir transcript used to derive batch-verification weights in
 * {@link batchVerifyUnblindedSignatureBls}. See that function's doc comment for the rationale; see
 * {@link deriveDLEQNonce} in `NUT12.ts` for the analogous secp-side pattern.
 */
const BLS_BATCH_DST = utf8ToBytes('Cashu_BLS_Batch_v1');

const Fr = bls12_381.fields.Fr;
const Fp_ORDER = bls12_381.fields.Fp.ORDER;

export function hashToCurveBls(secret: Uint8Array): G1Point {
  return bls12_381.G1.hashToCurve(secret, { DST: BLS_HASH_TO_CURVE_DST });
}

/**
 * Reject encodings whose field-coordinate value (with flag bits cleared) is `>= p`.
 *
 * @remarks
 * @noble/curves silently reduces field coordinates modulo `p` rather than rejecting non-canonical
 * encodings ("`fromBytes()` reduces modulo q instead of rejecting non-canonical encodings"). The
 * BLS12-381 Pairing-Friendly Curves draft and the BLS Signatures draft both require a strict `< p`
 * check, and NUT-00 Point Validation makes it MUST for v3. Without this, two distinct byte strings
 * can decode to the same point (fine for pairing equality, but breaks canonicality for anything
 * that hashes over compressed bytes such as Fiat-Shamir transcripts or future byte-level commits).
 */
function assertCanonicalCoordinates(
  bytes: Uint8Array,
  width: number,
  coordCount: 1 | 2,
  label: string,
): void {
  if (bytes.length !== width) return; // wrong length is noble's job to flag
  const cleared = new Uint8Array(bytes);
  cleared[0] &= 0b0001_1111; // strip the three top flag bits
  const coordWidth = width / coordCount;
  for (let i = 0; i < coordCount; i++) {
    const v = bytesToNumberBE(cleared.subarray(i * coordWidth, (i + 1) * coordWidth));
    if (v >= Fp_ORDER) {
      throw new CTSError(`${label} point non-canonical: coordinate >= p`);
    }
  }
}

export function pointFromHexG1(hex: string): G1Point {
  // Spec NUT-00 Point Validation: enforce canonical field-coordinate range before noble's decoder
  // silently mod-reduces. See `assertCanonicalCoordinates` for the rationale.
  assertCanonicalCoordinates(hexToBytes(hex), 48, 1, 'G1');
  // @noble/curves permits parsing the identity; never valid as a Cashu signature or commitment.
  const p = bls12_381.G1.Point.fromHex(hex);
  if (p.is0()) throw new CTSError('G1 point at infinity');
  // Spec NUT-00 Point Validation: reject non-prime-order-subgroup points. fromHex/assertValidity
  // confirm the encoding is canonical and on-curve, but BLS12-381 G1 has cofactor h_1, so an
  // attacker can craft on-curve points outside the q-order subgroup. Without this guard, a
  // malicious B_ submitted to the mint would let it sign a small-subgroup component.
  if (!p.isTorsionFree()) throw new CTSError('G1 point not in prime-order subgroup');
  return p;
}

export function pointFromHexG2(hex: string): G2Point {
  // G2 compressed: c1 || c0, 48 bytes each. Both must be in [0, p).
  assertCanonicalCoordinates(hexToBytes(hex), 96, 2, 'G2');
  // @noble/curves permits parsing the identity; never valid as a Cashu mint pubkey.
  const p = bls12_381.G2.Point.fromHex(hex);
  if (p.is0()) throw new CTSError('G2 point at infinity');
  // Spec NUT-00 Point Validation: reject non-prime-order-subgroup mint pubkeys.
  if (!p.isTorsionFree()) throw new CTSError('G2 point not in prime-order subgroup');
  return p;
}

/**
 * V3 (BLS) mint pubkey: K2 = a · G2_gen, compressed to 96 bytes.
 *
 * The 32-byte private key is interpreted as a big-endian scalar and reduced mod the BLS Fr order
 * (same convention as the mint-side blind signer for v3).
 */
export function getG2PubKeyFromPrivKey(privKey: Uint8Array): Uint8Array<ArrayBufferLike> {
  const a = Fr.fromBytes(privKey);
  /* c8 ignore next 3 — defensive guard; a==0 requires all-zero privKey bytes (impossible in practice). */
  if (a === 0n) {
    throw new CTSError('Mint scalar must be non-zero');
  }
  return BLS_G2_GENERATOR.multiply(a).toBytes(true);
}

function randomScalar(): bigint {
  // Rejection-sample, not Fr.fromBytes' mod-reduction, which biases small scalars (BLS_FR_ORDER ~ 0.45·2^256).
  for (let ctr = 0; ctr < 1 << 16; ctr++) {
    const x = bytesToNumberBE(randomBytes(32));
    if (x === 0n || x >= BLS_FR_ORDER) continue;
    return x;
  }
  /* c8 ignore next */
  throw new CTSError('BLS random scalar generation failed');
}

/**
 * Multiplicative blinding for BLS12-381 v3 keysets. Y = hashToCurveG1(secret) B_ = Y * r.
 *
 * @param secret UTF-8 byte encoded secret (matches Nutshell `msg`).
 * @param r Optional deterministic blinding scalar.
 */
export function blindMessageBls(secret: Uint8Array, r?: bigint): RawBlindedMessage {
  const Y = hashToCurveBls(secret);
  if (r === undefined) {
    r = randomScalar();
  } else if (r === 0n) {
    throw new CTSError('Blinding factor r must be non-zero');
  }
  const B_ = Y.multiply(r);
  return { B_, r, secret };
}

/**
 * Wallet-side multiplicative unblinding: C = C_ * r⁻¹. Note: unlike secp additive blinding, the
 * mint pubkey is not needed here.
 */
export function unblindSignatureBls(C_: G1Point, r: bigint): G1Point {
  if (r === 0n) {
    throw new CTSError('Blinding factor r must be non-zero');
  }
  return C_.multiply(Fr.inv(r));
}

export function constructUnblindedSignatureBls(
  blindSig: BlindSignature,
  r: bigint,
  secret: Uint8Array,
): UnblindedSignature {
  const C = unblindSignatureBls(blindSig.C_, r);
  return { id: blindSig.id, secret, C };
}

/**
 * Mint-side blind signing: C_ = B_ * a where `a` is the mint's per-amount secret.
 *
 * @param privateKey 32-byte mint secret (big-endian); reduced mod Fr.
 */
export function createBlindSignatureBls(
  B_: G1Point,
  privateKey: Uint8Array,
  id: string,
): BlindSignature {
  const a = Fr.fromBytes(privateKey);
  if (a === 0n) {
    throw new CTSError('Mint scalar must be non-zero');
  }
  const C_ = B_.multiply(a);
  return { C_, id };
}

/**
 * Wallet-side verification via pairing equality: e(C, G2_gen) == e(Y, K2).
 *
 * @remarks
 * Implemented as `e(-C, G2_gen) · e(Y, K2) == 1` and evaluated through `pairingBatch`, which
 * accumulates both Miller loops and applies a single final exponentiation. That saves one final
 * exponentiation versus two separate `pairing(...)` calls — material on low-power devices since
 * final exp is ~60% of the cost of a BLS12-381 pairing.
 * @param K2 Mint pubkey in G2 for this amount.
 * @param C Unblinded signature (G1).
 * @param secret UTF-8 byte encoded secret.
 */
export function verifyUnblindedSignatureBls(K2: G2Point, C: G1Point, secret: Uint8Array): boolean {
  // pairingBatch throws a generic Error on identity inputs; reject as invalid instead.
  if (C.is0() || K2.is0()) return false;
  const Y = hashToCurveBls(secret);
  const acc = bls12_381.pairingBatch([
    { g1: C.negate(), g2: BLS_G2_GENERATOR },
    { g1: Y, g2: K2 },
  ]);
  return bls12_381.fields.Fp12.eql(acc, bls12_381.fields.Fp12.ONE);
}

/**
 * Derive deterministic per-proof batch-verification weights.
 *
 * @remarks
 * Non-zero scalars in `Fr*`, derived via Fiat-Shamir over the batch (no CSPRNG). The transcript is
 * length-prefixed (injective) and collapsed to a 32-byte challenge once so the per-item derivation
 * stays O(1) — re-hashing the full transcript inside the loop would be O(n²) and a DoS lever.
 *
 * Exposed for test-time determinism / transcript-coverage assertions; not part of the public API.
 * @internal
 */
export function deriveBatchWeights(
  items: Array<{ K2: G2Point; C: G1Point; secret: Uint8Array }>,
): bigint[] {
  // Stream into the digest rather than concat-then-hash: `concatBytes(...parts)` would spread an
  // array of 4n+1 chunks as function args and hit V8's argument-count limit on large batches.
  // Transcript shape: BLS_BATCH_DST || (C || K2 || len32(secret) || secret) per item.
  const transcript = sha256.create();
  transcript.update(BLS_BATCH_DST);
  for (const it of items) {
    transcript.update(it.C.toBytes(true));
    transcript.update(it.K2.toBytes(true));
    transcript.update(numberToBytesBE(it.secret.length, 4));
    transcript.update(it.secret);
  }
  // 32-byte challenge collapses the transcript so per-item derivation below is O(1), not O(n).
  const challenge = transcript.digest();

  const rs: bigint[] = [];
  for (let i = 0; i < items.length; i++) {
    const iBytes = numberToBytesBE(i, 4);
    let ri = 0n;
    // Per NUT-00: true rejection sampling, not modular reduction. Accept the first hash that
    // falls in [1, BLS_FR_ORDER); mod-reduction would bias r_i because BLS_FR_ORDER ~ 0.45·2^256
    // (some residues have three preimages in [0, 2^256), others two). u32 counter keeps the
    // ceiling effectively unbounded; with ~45% acceptance the failure probability after 16 tries
    // is 2^-17, after 256 tries 2^-265. The inner cap is a defensive bound, not a real ceiling.
    for (let ctr = 0; ctr < 1 << 16; ctr++) {
      const h = sha256(concatBytes(challenge, iBytes, numberToBytesBE(ctr, 4)));
      const x = bytesToNumberBE(h);
      if (x === 0n || x >= BLS_FR_ORDER) continue;
      ri = x;
      break;
    }
    /* c8 ignore next */
    if (ri === 0n) throw new CTSError('BLS batch weight derivation failed');
    rs.push(ri);
  }
  return rs;
}

/**
 * Batch verify many proofs via a single multi-pairing.
 *
 * Equation: `e(Σ rᵢ·Cᵢ, G2) == Π_{k2} e(Σ_{i:K2ᵢ=k2} rᵢ·Yᵢ, k2)`.
 *
 * @remarks
 * The per-proof weights `rᵢ` are what makes this safe: without them, an attacker holding one signed
 * `C' = a·(Y₁+Y₂)` can pick any C₁ and present `(C₁, secret₁), (C' − C₁, secret₂)` as two valid
 * proofs from a single signature. Independent weights reduce that attack to needing `C₁ = a·Y₁`
 * (i.e. a real signature) unless `r₁ = r₂` (≈ 2⁻²⁵⁵).
 *
 * The weights are public and deterministically derived (security does not rely on secrecy). The
 * Fiat-Shamir transcript binds each `rᵢ` to `(Cᵢ, K2ᵢ, secretᵢ)` for the whole batch, so an
 * attacker cannot choose proofs in adversarial relation to the weights without first fixing the
 * proofs (which in turn fixes the weights). Knowing the derivation does not help.
 *
 * Returns true iff every individual `e(Cᵢ, G2) == e(Yᵢ, K2ᵢ)` holds.
 */
export function batchVerifyUnblindedSignatureBls(
  items: Array<{ K2: G2Point; C: G1Point; secret: Uint8Array }>,
): boolean {
  if (items.length === 0) return true;
  // pairingBatch throws a generic Error on identity inputs; reject as invalid instead.
  for (const it of items) {
    if (it.C.is0() || it.K2.is0()) return false;
  }
  const G2 = BLS_G2_GENERATOR;

  const rs = deriveBatchWeights(items);

  // Left: Σ rᵢ·Cᵢ , then pair against G2.
  let sumC = items[0].C.multiply(rs[0]);
  for (let i = 1; i < items.length; i++) {
    sumC = sumC.add(items[i].C.multiply(rs[i]));
  }

  // Right: group rᵢ·Yᵢ by mint pubkey K2.
  const grouped = new Map<string, { K2: G2Point; sumY: G1Point }>();
  for (let i = 0; i < items.length; i++) {
    const Y = hashToCurveBls(items[i].secret);
    const term = Y.multiply(rs[i]);
    const key = bytesToHex(items[i].K2.toBytes(true));
    const existing = grouped.get(key);
    if (existing) {
      existing.sumY = existing.sumY.add(term);
    } else {
      grouped.set(key, { K2: items[i].K2, sumY: term });
    }
  }

  const pairs: Array<{ g1: G1Point; g2: G2Point }> = [{ g1: sumC.negate(), g2: G2 }];
  for (const { K2, sumY } of grouped.values()) {
    pairs.push({ g1: sumY, g2: K2 });
  }

  // Pair all at once: e(-ΣrC, G2) * Π e(ΣrY, K2) == 1
  const acc = bls12_381.pairingBatch(pairs);
  return bls12_381.fields.Fp12.eql(acc, bls12_381.fields.Fp12.ONE);
}
