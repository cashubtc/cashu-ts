import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import { deriveBlindingFactor } from '../../src/crypto';

describe('deriveBlindingFactor', () => {
  test('preserves 32-byte encoding when reduced scalar has leading zeros', () => {
    const seed = new TextEncoder().encode('test seed for regression');
    const keysetId = '01abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567';

    const r = deriveBlindingFactor(seed, keysetId, 197);

    expect(r).toHaveLength(32);
    expect(bytesToHex(r)).toBe('008464578dd0553eda2793249681ca2996587a6118b0974bf295fc946b4e5911');
  });

  test('rejects a negative counter on the deprecated BIP-32 path', () => {
    // -1 is the boundary case: HARDENED_OFFSET + (-1) is a valid non-hardened index, so without the
    // guard derivation would silently succeed with the wrong key instead of throwing.
    const seed = new TextEncoder().encode('test seed for regression');
    expect(() => deriveBlindingFactor(seed, '0NI3TUAs1Sfa', -1)).toThrow(
      /Counter must be an integer/,
    );
  });
});
