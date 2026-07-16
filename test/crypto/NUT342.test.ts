import { describe, expect, test } from 'vitest';

import { decryptDGap, encryptDGap } from '../../src';

const r = BigInt('0x' + '01'.repeat(32));

describe('NUT-342 d_gap encryption', () => {
  test.each([0, 1, 65536, 0xffffffff])('round trip %i', (dGap) => {
    const encrypted = encryptDGap(dGap, r);
    // nonce (12) || ciphertext (4) || tag (16) = 32 bytes hex
    expect(encrypted).toHaveLength(64);
    expect(decryptDGap(encrypted, r)).toBe(dGap);
  });

  test('uses a random nonce', () => {
    expect(encryptDGap(42, r)).not.toBe(encryptDGap(42, r));
  });

  test('rejects the wrong blinding factor', () => {
    const encrypted = encryptDGap(42, r);
    expect(() => decryptDGap(encrypted, r + 1n)).toThrow('d_gap decryption failed');
  });

  test('rejects tampered ciphertext', () => {
    const encrypted = encryptDGap(42, r);
    const i = 26; // inside the 4-byte ciphertext region
    const tampered =
      encrypted.slice(0, i) + (encrypted[i] === '0' ? '1' : '0') + encrypted.slice(i + 1);
    expect(() => decryptDGap(tampered, r)).toThrow('d_gap decryption failed');
  });

  test.each([-1, 0x100000000, 1.5, NaN])('rejects out-of-range gap %s', (dGap) => {
    expect(() => encryptDGap(dGap, r)).toThrow('unsigned 32-bit');
  });

  test('rejects bad payload length and non-hex input', () => {
    expect(() => decryptDGap('00'.repeat(31), r)).toThrow('invalid encrypted d_gap length');
    expect(() => decryptDGap('zz'.repeat(32), r)).toThrow('not valid hex');
  });
});
