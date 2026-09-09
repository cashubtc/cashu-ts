import { describe, expect, test } from 'vitest';

import { bytesToHex, CTSError, hexToBytes } from '../../src';

describe('hex byte codecs', () => {
  test('round trips bytes through lowercase hex', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);

    expect(bytesToHex(bytes)).toBe('00017f80ff');
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });

  test('accepts empty and uppercase hex', () => {
    expect(hexToBytes('')).toEqual(new Uint8Array());
    expect(hexToBytes('ABCD')).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  test.each(['0', 'gg', '0x00', ' 00 '])('rejects non-strict input %j', (hex) => {
    expect(() => hexToBytes(hex)).toThrow(CTSError);
  });

  test('rejects invalid argument types', () => {
    expect(() => hexToBytes(123 as never)).toThrow(CTSError);
    expect(() => bytesToHex('ab' as never)).toThrow(CTSError);
  });
});
