import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { describe, expect, test } from 'vitest';
import {
  BLS_FR_ORDER,
  BLS_HASH_TO_CURVE_DST,
  hashToCurveBls,
  blindMessageBls,
  unblindSignatureBls,
  createBlindSignatureBls,
  verifyUnblindedSignatureBls,
  batchVerifyUnblindedSignatureBls,
  pointFromHexG2,
} from '../../src/crypto/bls';

// Nutshell PR #999 test vectors (cashu/core/crypto/bls_dhke.py +
// tests/test_crypto.py::test_deterministic_bls_steps).
const NUTSHELL_SECRET = 'test_message';
const NUTSHELL_B_HEX =
  '8e88c5f6a93f653784a66b033a00e52128499e18b095c2a56f080d1c2a937ffc9ef4600804a48d087bbd1f662f6b068f';
const NUTSHELL_C_BLIND_HEX =
  '8d52d7a6cbe5e99858d5c15c092d11a0c387c78917471211082a6e5afc2a79680dfa188fafe5d4a51c5398ce160e7a16';
const NUTSHELL_C_HEX =
  'b7a4881059133fd91a8753600d9a5e524c65d6224f6fe2d5aef9e59f1507fdad90b3b4d48ee46da5c8dfaa0b88e28b69';

const NUTSHELL_G2_HEX =
  '93e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8';

describe('BLS constants', () => {
  test('DST matches Nutshell', () => {
    expect(BLS_HASH_TO_CURVE_DST).toBe('CASHU_BLS12_381_G1_XMD:SHA-256_SSWU_RO_');
  });

  test('Fr order matches Nutshell curve_order', () => {
    expect(BLS_FR_ORDER).toBe(
      52435875175126190479447740508185965837690552500527637822603658699938581184513n,
    );
  });

  test("noble's G2 BASE matches Nutshell hardcoded _G2_HEX", () => {
    expect(bytesToHex(bls12_381.G2.Point.BASE.toBytes(true))).toBe(NUTSHELL_G2_HEX);
  });
});

describe('hashToCurveBls', () => {
  test('matches Nutshell B_ when multiplied by r=3', () => {
    const Y = hashToCurveBls(new TextEncoder().encode(NUTSHELL_SECRET));
    const B_ = Y.multiply(3n);
    expect(bytesToHex(B_.toBytes(true))).toBe(NUTSHELL_B_HEX);
  });
});

describe('BLS deterministic round-trip (Nutshell test_deterministic_bls_steps)', () => {
  const secret = new TextEncoder().encode(NUTSHELL_SECRET);

  test('blindMessageBls (r=3) reproduces B_', () => {
    const { B_, r } = blindMessageBls(secret, 3n);
    expect(r).toBe(3n);
    expect(bytesToHex(B_.toBytes(true))).toBe(NUTSHELL_B_HEX);
  });

  test('createBlindSignatureBls (a=2) reproduces C_', () => {
    const { B_ } = blindMessageBls(secret, 3n);
    const aBytes = hexToBytes('0'.repeat(63) + '2'); // 32-byte BE encoding of 2
    const { C_, id } = createBlindSignatureBls(B_, aBytes, 'test');
    expect(id).toBe('test');
    expect(bytesToHex(C_.toBytes(true))).toBe(NUTSHELL_C_BLIND_HEX);
  });

  test('unblindSignatureBls (r=3) reproduces C', () => {
    const { B_ } = blindMessageBls(secret, 3n);
    const aBytes = hexToBytes('0'.repeat(63) + '2');
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'test');
    const C = unblindSignatureBls(C_, 3n);
    expect(bytesToHex(C.toBytes(true))).toBe(NUTSHELL_C_HEX);
  });

  test('blindMessageBls rejects r=0', () => {
    expect(() => blindMessageBls(secret, 0n)).toThrow();
  });

  test('unblindSignatureBls rejects r=0', () => {
    const Y = hashToCurveBls(secret);
    expect(() => unblindSignatureBls(Y, 0n)).toThrow();
  });
});

describe('verifyUnblindedSignatureBls (single pairing)', () => {
  const secret = new TextEncoder().encode(NUTSHELL_SECRET);
  const aBytes = hexToBytes('0'.repeat(63) + '2');
  const K2 = bls12_381.G2.Point.BASE.multiply(2n);

  test('accepts a valid (C, K2, secret) triple', () => {
    const { B_ } = blindMessageBls(secret, 3n);
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'k');
    const C = unblindSignatureBls(C_, 3n);
    expect(verifyUnblindedSignatureBls(K2, C, secret)).toBe(true);
  });

  test('rejects when secret differs', () => {
    const { B_ } = blindMessageBls(secret, 3n);
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'k');
    const C = unblindSignatureBls(C_, 3n);
    expect(verifyUnblindedSignatureBls(K2, C, new TextEncoder().encode('other'))).toBe(false);
  });

  test('rejects when K2 is wrong', () => {
    const { B_ } = blindMessageBls(secret, 3n);
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'k');
    const C = unblindSignatureBls(C_, 3n);
    const wrongK2 = bls12_381.G2.Point.BASE.multiply(7n);
    expect(verifyUnblindedSignatureBls(wrongK2, C, secret)).toBe(false);
  });

  test('parses K2 from Nutshell hex', () => {
    const K2parsed = pointFromHexG2(bytesToHex(K2.toBytes(true)));
    expect(K2parsed.equals(K2)).toBe(true);
  });
});

describe('batchVerifyUnblindedSignatureBls', () => {
  function makeProof(secretStr: string, r: bigint, aScalar: bigint) {
    const secret = new TextEncoder().encode(secretStr);
    const aBytes = hexToBytes(aScalar.toString(16).padStart(64, '0'));
    const K2 = bls12_381.G2.Point.BASE.multiply(aScalar);
    const { B_ } = blindMessageBls(secret, r);
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'k');
    const C = unblindSignatureBls(C_, r);
    return { K2, C, secret };
  }

  test('accepts a mixed-denomination batch under one mint key', () => {
    const items = [makeProof('s1', 3n, 5n), makeProof('s2', 4n, 5n), makeProof('s3', 7n, 5n)];
    expect(batchVerifyUnblindedSignatureBls(items)).toBe(true);
  });

  test('accepts a batch across multiple mint keys', () => {
    const items = [makeProof('s1', 3n, 5n), makeProof('s2', 4n, 11n), makeProof('s3', 7n, 5n)];
    expect(batchVerifyUnblindedSignatureBls(items)).toBe(true);
  });

  test('rejects when one proof is forged', () => {
    const items = [makeProof('s1', 3n, 5n), makeProof('s2', 4n, 5n)];
    // Swap C between items so secret/C no longer agree.
    const broken = [items[0], { ...items[1], C: items[0].C }];
    expect(batchVerifyUnblindedSignatureBls(broken)).toBe(false);
  });

  test('empty batch is vacuously true', () => {
    expect(batchVerifyUnblindedSignatureBls([])).toBe(true);
  });
});
