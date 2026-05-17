import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';
import {
  BLS_FR_ORDER,
  deriveBlindingFactor,
  deriveSecretAndBlindingFactor,
} from '../../src/crypto';
import { Bytes } from '../../src/utils';

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
  const seed = new TextEncoder().encode('test seed v3 reduction');
  const v3KeysetId = '02ce4c47836fd0e64f37a08254777b7fd0dedb95fc1ddd0acadf5600674c743c5d';

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
    // Identical 64-hex tail across both ids; only the version prefix differs (01 vs 02).
    const tail = 'ce4c47836fd0e64f37a08254777b7fd0dedb95fc1ddd0acadf5600674c743c5d';
    const v2 = '01' + tail.slice(0, 62);
    const v3 = '02' + tail.slice(0, 62);
    // The keyset id is mixed into the HMAC message, so different prefixes give different outputs.
    const v2r = deriveBlindingFactor(seed, v2, 0);
    const v3r = deriveBlindingFactor(seed, v3, 0);
    expect(bytesToHex(v2r)).not.toBe(bytesToHex(v3r));
  });

  test('matches Nutshell vector at a counter where Fr-order reduction is non-trivial', () => {
    // Cross-checked against Nutshell's `_derive_secret_hmac_sha256` for (seed, v3KeysetId, 2).
    // Counter=2 was chosen because the raw HMAC exceeds BLS_FR_ORDER, so the mod reduction
    // produces bytes that differ from the raw digest — making this a regression vector for
    // the v3 mod-Fr_ORDER branch in deriveHmac.
    const { blindingFactor, secret } = deriveSecretAndBlindingFactor(seed, v3KeysetId, 2);
    expect(bytesToHex(secret)).toBe(
      '4729fe85ab3886ce03259ac658735ff534c9cd41b2b364d202ff497e4ee48809',
    );
    expect(bytesToHex(blindingFactor)).toBe(
      '08bb237d625b73022cd50f6fedfb660c6125b676a4819474241c264903259d2f',
    );
  });
});
