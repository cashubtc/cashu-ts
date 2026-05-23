import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';
import { BLS_FR_ORDER, deriveSecretAndBlindingFactor } from '../../src/crypto';
import { Bytes } from '../../src/utils';

// The standalone deriveBlindingFactor() helper was removed in v5; derive it locally for these tests.
const deriveBlindingFactor = (seed: Uint8Array, keysetId: string, counter: number): Uint8Array =>
  deriveSecretAndBlindingFactor(seed, keysetId, counter).blindingFactor;

describe('deriveBlindingFactor', () => {
  test('preserves 32-byte encoding when reduced scalar has leading zeros', () => {
    const seed = new TextEncoder().encode('test seed for regression');
    const keysetId = '01abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567';

    const r = deriveBlindingFactor(seed, keysetId, 197);

    expect(r).toHaveLength(32);
    expect(bytesToHex(r)).toBe('008464578dd0553eda2793249681ca2996587a6118b0974bf295fc946b4e5911');
  });
});

describe('v3 (BLS) derivation', () => {
  const seed = new TextEncoder().encode('nut13 v3 test seed');
  const v3KeysetId = '02abd02ebc1ff44652153375162407deaf0b30e590844cca0b6e4894a08a8828dd';

  test('uses HMAC_SHA256 and produces a 32-byte blinding factor below BLS_FR_ORDER', () => {
    for (let counter = 0; counter < 8; counter++) {
      const { blindingFactor, secret } = deriveSecretAndBlindingFactor(seed, v3KeysetId, counter);
      expect(blindingFactor).toHaveLength(32);
      expect(secret).toHaveLength(32);
      const r = Bytes.toBigInt(blindingFactor);
      expect(r).toBeGreaterThan(0n);
      expect(r).toBeLessThan(BLS_FR_ORDER);
    }
  });

  test('v3 and v2 derivations diverge for the same seed/counter', () => {
    const tail = 'abd02ebc1ff44652153375162407deaf0b30e590844cca0b6e4894a08a8828dd';
    const v2 = '01' + tail.slice(0, 62);
    const v3 = '02' + tail.slice(0, 62);
    const v2r = deriveBlindingFactor(seed, v2, 0);
    const v3r = deriveBlindingFactor(seed, v3, 0);
    expect(bytesToHex(v2r)).not.toBe(bytesToHex(v3r));
  });

  test('matches NUT-13 V3 spec vector (rejection sampling, attempt=1)', () => {
    // Lock-in for nuts/tests/13-tests.md "Version 3: Secret derivation". The (seed, keyset, counter)
    // tuple is chosen so attempt=0 produces x >= BLS_FR_ORDER and is rejected; attempt=1 succeeds.
    // Implementations that omit the rejection loop will compute a different blinding_factor.
    const { blindingFactor, secret } = deriveSecretAndBlindingFactor(seed, v3KeysetId, 3);
    expect(bytesToHex(secret)).toBe(
      '7a45e04943504b25273e9569ab7019ab62f814dade23998c12f5f4cb1bb7978a',
    );
    expect(bytesToHex(blindingFactor)).toBe(
      '236dbcb12fc064ceeae6c5e2de7f79258374dccbf23ac0afdf72cf9eb53540c9',
    );
  });
});
