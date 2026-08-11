import { bytesToHex } from '@noble/hashes/utils.js';
import { HDKey } from '@scure/bip32';
import { describe, expect, test } from 'vitest';

import {
  BLS_FR_ORDER,
  deriveSecretAndBlindingFactor,
  getKeysetIdInt,
  hashToCurveBls,
} from '../../src/crypto';
import { getPubKeyFromPrivKey } from '../../src/crypto/curve_secp';
import { Bytes } from '../../src/utils';
import { nut13_v3 as nut13Vectors } from '../vectors/taproot-v3.json';

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
  const v3KeysetId = '02b7e077d020fabed456a6be138a8e20e9ef40b44d873fa12c005b656eb0cf99f6';

  test('uses HMAC_SHA256 and produces a 32-byte blinding factor below BLS_FR_ORDER', () => {
    for (let counter = 0; counter < 8; counter++) {
      const { blindingFactor, secret, secretKey } = deriveSecretAndBlindingFactor(
        seed,
        v3KeysetId,
        counter,
      );
      expect(blindingFactor).toHaveLength(32);
      // Taproot secrets: the 0x00 branch derives a private key; the secret is K = k*G compressed.
      expect(secret).toHaveLength(33);
      expect([0x02, 0x03]).toContain(secret[0]);
      expect(secretKey).toBeDefined();
      expect(bytesToHex(getPubKeyFromPrivKey(secretKey as Uint8Array))).toBe(bytesToHex(secret));
      const r = Bytes.toBigInt(blindingFactor);
      expect(r).toBeGreaterThan(0n);
      expect(r).toBeLessThan(BLS_FR_ORDER);
    }
  });

  test('matches the shared taproot-v3 nut13 vectors', () => {
    const vseed = new TextEncoder().encode(nut13Vectors.seed_utf8);
    for (const output of nut13Vectors.outputs) {
      const { secret, secretKey, blindingFactor } = deriveSecretAndBlindingFactor(
        vseed,
        nut13Vectors.keyset_id,
        output.counter,
      );
      expect(bytesToHex(secretKey as Uint8Array)).toBe(output.secret_key);
      expect(bytesToHex(secret)).toBe(output.secret);
      expect(bytesToHex(blindingFactor)).toBe(output.blinding_factor);
    }
  });

  test('point secrets hash to curve as raw bytes, pinned by the shared Y vector', () => {
    const output = nut13Vectors.outputs[0];
    // The utf8 hex string and the raw 33 bytes must land on the same Y: JSON carries hex, the
    // hash input is binary (taproot secrets), and legacy non-point secrets still hash as utf8.
    const yFromString = hashToCurveBls(new TextEncoder().encode(output.secret));
    const yFromRaw = hashToCurveBls(Bytes.fromHex(output.secret));
    expect(yFromString.toHex(true)).toBe(output.Y);
    expect(yFromRaw.toHex(true)).toBe(output.Y);
  });

  test('v3 and v2 derivations diverge for the same seed/counter', () => {
    const tail = 'abd02ebc1ff44652153375162407deaf0b30e590844cca0b6e4894a08a8828dd';
    const v2 = '01' + tail.slice(0, 62);
    const v3 = '02' + tail.slice(0, 62);
    const v2r = deriveBlindingFactor(seed, v2, 0);
    const v3r = deriveBlindingFactor(seed, v3, 0);
    expect(bytesToHex(v2r)).not.toBe(bytesToHex(v3r));
  });

  test('blinding factor rejection sampling still matches the pre-taproot pin (attempt=3)', () => {
    // Lock-in from nuts/tests/13-tests.md "Version 3": the (seed, keyset, counter) tuple is chosen
    // so the 0x01 branch rejects attempts 0-2 (x >= BLS_FR_ORDER) and succeeds at attempt=3. The
    // taproot-secrets redefinition of the 0x00 branch must leave this branch untouched.
    const { blindingFactor, secret, secretKey } = deriveSecretAndBlindingFactor(
      seed,
      v3KeysetId,
      0,
    );
    expect(bytesToHex(blindingFactor)).toBe(
      '513d1a0f0f01a09fdad2f7cea1403143fb86a1be2d152969b46b45cdaabd21aa',
    );
    // The 0x00 branch now derives a key (spec 2.4.2): secret is the compressed pubkey of it.
    expect(bytesToHex(secretKey as Uint8Array)).toBe(
      '7a7b3f7eb44f4a943041d936c0e0b2bf1dd0ac9a210bc8f8bc12b65cdbde9bd3',
    );
    expect(bytesToHex(secret)).toBe(
      '0234df38671738d8e9ee205dc364fd4b45df8ed2ff91686e93d02ca1feb3b2f118',
    );
  });
});

describe('HMAC counter range', () => {
  const seed = new TextEncoder().encode('nut13 counter range seed');
  const v2KeysetId = '01abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567';

  test('rejects counters that a uint64 encoding would alias onto a valid one', () => {
    // setBigUint64 wraps, so 2^64 would serialize exactly like 0 and derive its secret.
    expect(() => deriveSecretAndBlindingFactor(seed, v2KeysetId, 2 ** 64)).toThrow(/counter/i);
    expect(() => deriveSecretAndBlindingFactor(seed, v2KeysetId, -1)).toThrow(/counter/i);
    expect(() => deriveSecretAndBlindingFactor(seed, v2KeysetId, 1.5)).toThrow(/counter/i);
    expect(() => deriveSecretAndBlindingFactor(seed, v2KeysetId, NaN)).toThrow(/counter/i);
  });

  test('rejects counters above MAX_SAFE_INTEGER, where +1 no longer yields a distinct value', () => {
    // Number.MAX_SAFE_INTEGER + 2 === Number.MAX_SAFE_INTEGER + 3, so a batch would
    // derive one counter twice and issue duplicate outputs.
    expect(() => deriveSecretAndBlindingFactor(seed, v2KeysetId, 2 ** 53)).toThrow(/counter/i);
    expect(() =>
      deriveSecretAndBlindingFactor(seed, v2KeysetId, Number.MAX_SAFE_INTEGER + 2),
    ).toThrow(/counter/i);
  });

  test('accepts the full safe range', () => {
    expect(() => deriveSecretAndBlindingFactor(seed, v2KeysetId, 0)).not.toThrow();
    expect(() =>
      deriveSecretAndBlindingFactor(seed, v2KeysetId, Number.MAX_SAFE_INTEGER),
    ).not.toThrow();
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

  test('rejects a negative counter on the deprecated BIP-32 path', () => {
    // -1 is the boundary case: HARDENED_OFFSET + (-1) is a valid non-hardened index, so without the
    // guard derivation would silently succeed with the wrong key instead of throwing.
    const base64KeysetId = '0NI3TUAs1Sfa';
    expect(() => deriveSecretAndBlindingFactor(seed, base64KeysetId, -1)).toThrow(
      /Counter must be an integer/,
    );
  });

  test('throws for an unrecognized keyset id version, naming only the version byte', () => {
    // A pure-hex id with an unknown version prefix must throw; the message reports the 2-char
    // version slice exactly (anchored), pinning both the slice bounds and the message text.
    expect(() => deriveSecretAndBlindingFactor(seed, '03ff', 0)).toThrow(
      /^Unrecognized keyset ID version 03$/,
    );
  });
});
