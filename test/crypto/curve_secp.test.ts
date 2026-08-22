import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, test, expect, vi } from 'vitest';

import {
  normalizeSecpPubkey,
  isValidSecpPubkey,
  normalizeXOnlySecretKey,
  getPubKeyFromPrivKey,
} from '../../src';

// A valid compressed secp256k1 point (the generator).
const VALID = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

describe('normalizeSecpPubkey', () => {
  test('validates and lowercases a compressed pubkey to canonical form', () => {
    expect(normalizeSecpPubkey(VALID.toUpperCase())).toBe(VALID);
    expect(normalizeSecpPubkey(VALID)).toBe(VALID);
  });

  test('rejects malformed input (whitespace, empty, wrong length, x-only, non-hex)', () => {
    for (const bad of [' ', '', 'hello', '02', VALID.slice(2) /* 64-hex x-only */]) {
      expect(() => normalizeSecpPubkey(bad)).toThrow(/Invalid pubkey/);
    }
  });

  test('rejects a well-formed hex value that is not on the curve', () => {
    expect(() => normalizeSecpPubkey('02' + 'f'.repeat(64))).toThrow(/not a valid secp256k1 point/);
  });

  test('rejects a non-string input as a CTSError, not a TypeError', () => {
    for (const bad of [null, undefined, 123, {}, []]) {
      expect(() => normalizeSecpPubkey(bad as string)).toThrow(/Invalid pubkey/);
    }
    expect(isValidSecpPubkey(null as unknown as string)).toBe(false);
  });

  test('rejects an oversized input on length, before lowercasing the whole string', () => {
    const big = 'a'.repeat(1_000_000);
    const spy = vi.spyOn(String.prototype, 'toLowerCase');
    let threw = false;
    try {
      normalizeSecpPubkey(big);
    } catch {
      threw = true;
    }
    const lowercased = spy.mock.calls.length;
    spy.mockRestore();
    expect(threw).toBe(true);
    expect(lowercased).toBe(0);
  });
});

describe('isValidSecpPubkey', () => {
  test('mirrors normalizeSecpPubkey without throwing', () => {
    expect(isValidSecpPubkey(VALID)).toBe(true);
    expect(isValidSecpPubkey(VALID.toUpperCase())).toBe(true);
    expect(isValidSecpPubkey(' ')).toBe(false);
    expect(isValidSecpPubkey('02' + 'f'.repeat(64))).toBe(false);
  });
});

describe('normalizeXOnlySecretKey', () => {
  // An x-only pubkey names a point without its parity and is read as even-Y, so a key imported
  // that way must be the even-Y scalar or every tweak-based derivation lands on the negation.
  const evenYKey = (): Uint8Array => {
    for (let i = 1; i < 64; i++) {
      const d = hexToBytes(i.toString(16).padStart(64, '0'));
      if (getPubKeyFromPrivKey(d)[0] === 0x02) return d;
    }
    throw new Error('no even-Y key found');
  };

  test('leaves an even-Y key alone', () => {
    const d = evenYKey();
    expect(bytesToHex(normalizeXOnlySecretKey(d))).toBe(bytesToHex(d));
  });

  test('negates an odd-Y key so its pubkey becomes even-Y', () => {
    const d = evenYKey();
    const odd = secp256k1.Point.Fn.ORDER - BigInt('0x' + bytesToHex(d));
    const oddBytes = hexToBytes(odd.toString(16).padStart(64, '0'));
    expect(getPubKeyFromPrivKey(oddBytes)[0]).toBe(0x03);
    const normalized = normalizeXOnlySecretKey(oddBytes);
    expect(getPubKeyFromPrivKey(normalized)[0]).toBe(0x02);
    // Same x coordinate either way: only the parity changes.
    expect(bytesToHex(getPubKeyFromPrivKey(normalized)).slice(2)).toBe(
      bytesToHex(getPubKeyFromPrivKey(oddBytes)).slice(2),
    );
  });
});
