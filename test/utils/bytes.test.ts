import { numberToVarBytesBE } from '@noble/curves/utils.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import { bytesToUtf8, compareBytes, minimalBytesBE } from '../../src/utils/bytes';

describe('bytesToUtf8', () => {
  test('round-trips through utf8ToBytes, multi-byte included', () => {
    for (const s of ['', 'sat', 'ünïcode ✓', '🥜']) {
      expect(bytesToUtf8(utf8ToBytes(s))).toBe(s);
    }
  });
});

describe('compareBytes', () => {
  test('orders by first differing byte, unsigned', () => {
    expect(compareBytes(Uint8Array.of(1), Uint8Array.of(2))).toBeLessThan(0);
    expect(compareBytes(Uint8Array.of(2), Uint8Array.of(1))).toBeGreaterThan(0);
    // 0x80 is negative as a signed byte; it must still sort above 0x01.
    expect(compareBytes(Uint8Array.of(0x80), Uint8Array.of(0x01))).toBeGreaterThan(0);
    expect(compareBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(0);
  });

  test('a prefix sorts before what extends it', () => {
    expect(compareBytes(Uint8Array.of(1), Uint8Array.of(1, 0))).toBeLessThan(0);
    expect(compareBytes(new Uint8Array(0), Uint8Array.of(0))).toBeLessThan(0);
  });

  test('sorts an array into canonical order', () => {
    const sorted = [Uint8Array.of(2), Uint8Array.of(1, 9), Uint8Array.of(1)].sort(compareBytes);
    expect(sorted).toEqual([Uint8Array.of(1), Uint8Array.of(1, 9), Uint8Array.of(2)]);
  });
});

describe('minimalBytesBE', () => {
  test('encodes zero as no bytes, unlike numberToVarBytesBE', () => {
    expect(minimalBytesBE(0n)).toEqual(new Uint8Array(0));
    expect(numberToVarBytesBE(0n)).toEqual(Uint8Array.of(0));
  });

  test('drops leading zero bytes', () => {
    expect(minimalBytesBE(1n)).toEqual(Uint8Array.of(1));
    expect(minimalBytesBE(255n)).toEqual(Uint8Array.of(0xff));
    expect(minimalBytesBE(256n)).toEqual(Uint8Array.of(0x01, 0x00));
    expect(minimalBytesBE(0x0100n ** 4n)).toEqual(Uint8Array.of(1, 0, 0, 0, 0)); // 2^32
  });

  test('refuses a negative value', () => {
    expect(() => minimalBytesBE(-1n)).toThrow(RangeError);
  });
});
