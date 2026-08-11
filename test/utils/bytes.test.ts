import { numberToVarBytesBE } from '@noble/curves/utils.js';
import { describe, expect, test } from 'vitest';

import { minimalBytesBE } from '../../src/utils/bytes';

describe('minimalBytesBE', () => {
  test('encodes zero as zero bytes, unlike numberToVarBytesBE', () => {
    expect(minimalBytesBE(0n)).toEqual(new Uint8Array(0));
    expect(numberToVarBytesBE(0n)).toEqual(new Uint8Array([0]));
  });

  test('encodes positive integers minimally', () => {
    expect(minimalBytesBE(1n)).toEqual(new Uint8Array([0x01]));
    expect(minimalBytesBE(256n)).toEqual(new Uint8Array([0x01, 0x00]));
    expect(minimalBytesBE(65535n)).toEqual(new Uint8Array([0xff, 0xff]));
  });

  test('throws for negative integers', () => {
    expect(() => minimalBytesBE(-1n)).toThrow(RangeError);
  });
});
