import { bytesToHex } from '@noble/hashes/utils.js';
import { HDKey } from '@scure/bip32';
import { describe, expect, test } from 'vitest';

import {
  deriveBlindingFactor,
  deriveSecretAndBlindingFactor,
  getKeysetIdInt,
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

  test('rejects a negative counter on the deprecated BIP-32 path', () => {
    // -1 is the boundary case: HARDENED_OFFSET + (-1) is a valid non-hardened index, so without the
    // guard derivation would silently succeed with the wrong key instead of throwing.
    const seed = new TextEncoder().encode('test seed for regression');
    expect(() => deriveBlindingFactor(seed, '0NI3TUAs1Sfa', -1)).toThrow(
      /Counter must be an integer/,
    );
  });
});

describe('derivation kind selection', () => {
  // Known BIP-32 seed (NUT-13 spec / NUT-09 fixtures).
  const seed = Bytes.fromHex(
    'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
  );

  test('legacy base64 keyset id ending in a hex char uses the deprecated BIP-32 path', () => {
    // Guards the `^` anchor on the hex regex: without it, a base64 id whose tail is hex would be
    // misclassified as a modern hex id and rejected instead of taking the deprecated path.
    const base64KeysetId = '0NI3TUAs1Sfa'; // not pure hex, but ends in `a`
    const counter = 2;

    const hdkey = HDKey.fromMasterSeed(seed);
    const path = `m/129372'/0'/${getKeysetIdInt(base64KeysetId)}'/${counter}'`;
    const expectedSecret = hdkey.derive(`${path}/0`).privateKey;
    const expectedR = hdkey.derive(`${path}/1`).privateKey;
    expect(expectedSecret).not.toBeNull();
    expect(expectedR).not.toBeNull();

    const { secret, blindingFactor } = deriveSecretAndBlindingFactor(seed, base64KeysetId, counter);
    expect(bytesToHex(secret)).toBe(bytesToHex(expectedSecret as Uint8Array));
    expect(bytesToHex(blindingFactor)).toBe(bytesToHex(expectedR as Uint8Array));
  });

  test('throws for an unrecognized keyset id version, naming only the version byte', () => {
    // A pure-hex id with an unknown version prefix must throw; the message reports the 2-char
    // version slice exactly (anchored), pinning both the slice bounds and the message text.
    expect(() => deriveSecretAndBlindingFactor(seed, '03ff', 0)).toThrow(
      /^Unrecognized keyset ID version 03$/,
    );
  });
});
