import { describe, test, expect } from 'vitest';

import { normalizeSecpPubkey, isValidSecpPubkey } from '../../src';

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
});

describe('isValidSecpPubkey', () => {
  test('mirrors normalizeSecpPubkey without throwing', () => {
    expect(isValidSecpPubkey(VALID)).toBe(true);
    expect(isValidSecpPubkey(VALID.toUpperCase())).toBe(true);
    expect(isValidSecpPubkey(' ')).toBe(false);
    expect(isValidSecpPubkey('02' + 'f'.repeat(64))).toBe(false);
  });
});
