import { type Fp2 } from '@noble/curves/abstract/tower.js';
import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { randomBytes, bytesToHex } from '@noble/curves/utils.js';

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

const Fr = bls12_381.fields.Fr;

export function hashToCurveBls(secret: Uint8Array): G1Point {
  return bls12_381.G1.hashToCurve(secret, { DST: BLS_HASH_TO_CURVE_DST });
}

export function pointFromHexG1(hex: string): G1Point {
  return bls12_381.G1.Point.fromHex(hex);
}

export function pointFromHexG2(hex: string): G2Point {
  return bls12_381.G2.Point.fromHex(hex);
}

function randomScalar(): bigint {
  // bls12_381's Fr.fromBytes accepts 32 bytes BE and reduces mod ORDER.
  return Fr.fromBytes(randomBytes(32));
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
 * Wallet-side verification via single pairing: e(C, G2_gen) == e(Y, K2).
 *
 * @param K2 Mint pubkey in G2 for this amount.
 * @param C Unblinded signature (G1).
 * @param secret UTF-8 byte encoded secret.
 */
export function verifyUnblindedSignatureBls(K2: G2Point, C: G1Point, secret: Uint8Array): boolean {
  const Y = hashToCurveBls(secret);
  const left = bls12_381.pairing(C, BLS_G2_GENERATOR);
  const right = bls12_381.pairing(Y, K2);
  return bls12_381.fields.Fp12.eql(left, right);
}

/**
 * Batch verification across many proofs (one multi-pairing).
 *
 * Uses random scalars per proof to prevent cancellation attacks (per Nutshell): e( Σ rᵢ·Cᵢ , G2 )
 * ?= Π_{k2} e( Σ_{i:K2_i=k2} rᵢ·Yᵢ , k2 )
 *
 * Returns true iff every individual `e(Cᵢ, G2) == e(Yᵢ, K2_i)` holds.
 */
export function batchVerifyUnblindedSignatureBls(
  items: Array<{ K2: G2Point; C: G1Point; secret: Uint8Array }>,
): boolean {
  if (items.length === 0) return true;
  const G2 = BLS_G2_GENERATOR;

  // Random 32-byte scalars per proof (reduced mod Fr).
  const rs = items.map(() => Fr.fromBytes(randomBytes(32)));

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
