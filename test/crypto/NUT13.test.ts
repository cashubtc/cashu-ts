import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { HDKey } from '@scure/bip32';
import { describe, expect, test } from 'vitest';

import {
  BLS_FR_ORDER,
  deriveSecretAndBlindingFactor,
  getKeysetIdInt,
  hashToCurveBls,
} from '../../src/crypto';
import { getPubKeyFromPrivKey } from '../../src/crypto/curve_secp';
import {
  deriveLeafKey,
  deriveNumsOffset,
  deriveQuoteLockKey,
  recoverV3LeafKeys,
} from '../../src/crypto/NUT13';
import { CTSError } from '../../src/model/Errors';
import { Bytes } from '../../src/utils';
import { nut13_v3 as nut13Vectors } from '../vectors/nutroot-v3.json';

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
      // Nutroot secrets: the 0x00 branch derives a private key; the secret is K = k*G compressed.
      expect(secret).toHaveLength(33);
      expect([0x02, 0x03]).toContain(secret[0]);
      expect(secretKey).toBeDefined();
      expect(bytesToHex(getPubKeyFromPrivKey(secretKey as Uint8Array))).toBe(bytesToHex(secret));
      const r = Bytes.toBigInt(blindingFactor);
      expect(r).toBeGreaterThan(0n);
      expect(r).toBeLessThan(BLS_FR_ORDER);
    }
  });

  test('matches the shared nutroot-v3 nut13 vectors', () => {
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
    // hash input is binary (nutroot secrets), and legacy non-point secrets still hash as utf8.
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

  test('the framed v3 message pins these values (nuts tests/13-tests.md "Version 3")', () => {
    // Lock-in for the framed message: the (seed, keyset, counter) tuple is chosen so the 0x01
    // branch rejects several attempts before succeeding, exercising the rejection loop.
    const { blindingFactor, secret, secretKey } = deriveSecretAndBlindingFactor(
      seed,
      v3KeysetId,
      0,
    );
    expect(bytesToHex(blindingFactor)).toBe(
      '156857a0bce1b2788895f1885a21c56cf000df0de1e855608c7ccb6d9e2d7728',
    );
    expect(bytesToHex(secretKey as Uint8Array)).toBe(
      '47196dc081150ce13fd0e478b8b71831b825be389211c9c56a8062a61af70347',
    );
    expect(bytesToHex(secret)).toBe(
      '02e6e7cfa7b82d4b3b449fa6466c893469a727d0214d48db4956a6054b8022a29b',
    );
  });

  test('the other derivation types match the shared vectors', () => {
    const vseed = new TextEncoder().encode(nut13Vectors.seed_utf8);
    const id = nut13Vectors.keyset_id;
    for (const output of nut13Vectors.outputs) {
      expect(bytesToHex(deriveNumsOffset(vseed, id, output.counter))).toBe(output.nums_offset);
    }
    for (const leaf of nut13Vectors.leaf_keys) {
      const key = deriveLeafKey(vseed, id, leaf.counter, leaf.index);
      expect(bytesToHex(key)).toBe(leaf.privkey);
      expect(bytesToHex(getPubKeyFromPrivKey(key))).toBe(leaf.pubkey);
    }
    for (const lock of nut13Vectors.quote_locks) {
      const key = deriveQuoteLockKey(vseed, lock.counter);
      expect(bytesToHex(key)).toBe(lock.privkey);
      expect(bytesToHex(getPubKeyFromPrivKey(key))).toBe(lock.pubkey);
    }
  });

  test('each type derives its own scalar at one counter', () => {
    // One counter describes one proof completely, so the components must not collide: a quote lock
    // may be handed over and a leaf key is published, while the secret key must stay secret.
    const derived = [
      deriveSecretAndBlindingFactor(seed, v3KeysetId, 4).secretKey as Uint8Array,
      deriveSecretAndBlindingFactor(seed, v3KeysetId, 4).blindingFactor,
      deriveNumsOffset(seed, v3KeysetId, 4),
      deriveLeafKey(seed, v3KeysetId, 4, 0),
      deriveQuoteLockKey(seed, 4),
    ].map(bytesToHex);
    expect(new Set(derived).size).toBe(derived.length);
    // The leaf index is in the message, not just the caller's bookkeeping.
    expect(bytesToHex(deriveLeafKey(seed, v3KeysetId, 4, 1))).not.toBe(derived[3]);
  });

  test('leaf keys recover by value, whatever the tree order', () => {
    const own = [0, 1, 2].map((i) => deriveLeafKey(seed, v3KeysetId, 9, i));
    const ownPubs = own.map((k) => bytesToHex(getPubKeyFromPrivKey(k)));
    const foreign = '02'.padEnd(66, 'a');
    // Shuffled, and mixed with a key the wallet does not own: position tells you nothing.
    const found = recoverV3LeafKeys(seed, v3KeysetId, 9, [ownPubs[2], foreign, ownPubs[0]]);
    expect(found.size).toBe(2);
    expect(bytesToHex(found.get(ownPubs[0]) as Uint8Array)).toBe(bytesToHex(own[0]));
    expect(bytesToHex(found.get(ownPubs[2]) as Uint8Array)).toBe(bytesToHex(own[2]));
    expect(found.has(foreign)).toBe(false);
    // A different counter is a different proof allocation, so nothing matches.
    expect(recoverV3LeafKeys(seed, v3KeysetId, 10, ownPubs).size).toBe(0);
  });

  test('the new types are v3 only', () => {
    const v2KeysetId = '01abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567';
    expect(() => deriveNumsOffset(seed, v2KeysetId, 0)).toThrow(/v3 keyset/);
    expect(() => deriveLeafKey(seed, v2KeysetId, 0, 0)).toThrow(/v3 keyset/);
    expect(() => deriveLeafKey(seed, v3KeysetId, 0, -1)).toThrow(/index/);
  });

  test('framing is v3 only: the deployed v2 message is byte-for-byte unchanged', () => {
    // Reframing v2 would silently re-derive every deployed secret, and a wallet restoring from
    // seed would find nothing rather than error. These are the pre-nutroot v2 values.
    const v2KeysetId = '01b7e077d020fabed456a6be138a8e20e9ef40b44d873fa12c005b656eb0cf99f6';
    const { secret, blindingFactor } = deriveSecretAndBlindingFactor(seed, v2KeysetId, 0);
    expect(bytesToHex(secret)).toBe(
      'd3c8abcd88c04e6e635604448ec8e1b2f5a5e51a8773f313e32284db78a5cb9b',
    );
    expect(bytesToHex(blindingFactor)).toBe(
      'ceae166b8ba3bf3f8c175b6d4fbbe87a67746ee42dd6bbad587786b5772f28c3',
    );
  });
});

describe('v2 derivation spec vectors', () => {
  // Lock-in for nuts/tests/13-tests.md "Version 2: Secret derivation". cashu-ts works in seed
  // space, so the spec's mnemonic ("half depart obvious quality work element tank gorilla view
  // sugar picture humble") is pre-derived to its BIP39 seed here.
  const seed = hexToBytes(
    'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25' +
      '780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
  );
  const v2KeysetId = '015ba18a8adcd02e715a58358eb618da4a4b3791151a4bee5e968bb88406ccf76a';
  const secrets = [
    'db5561a07a6e6490f8dadeef5be4e92f7cebaecf2f245356b5b2a4ec40687298',
    'b70e7b10683da3bf1cdf0411206f8180c463faa16014663f39f2529b2fda922e',
    '78a7ac32ccecc6b83311c6081b89d84bb4128f5a0d0c5e1af081f301c7a513f5',
    '094a2b6c63bfa7970bc09cda0e1cfc9cd3d7c619b8e98fabcfc60aea9e4963e5',
    '5e89fc5d30d0bf307ddf0a3ac34aa7a8ee3702169dafa3d3fe1d0cae70ecd5ef',
  ];
  const blindingFactors = [
    '6d26181a3695e32e9f88b80f039ba1ae2ab5a200ad4ce9dbc72c6d3769f2b035',
    'bde4354cee75545bea1a2eee035a34f2d524cee2bb01613823636e998386952e',
    'f40cc1218f085b395c8e1e5aaa25dccc851be3c6c7526a0f4e57108f12d6dac4',
    '099ed70fc2f7ac769bc20b2a75cb662e80779827b7cc358981318643030577d0',
    '5550337312d223ba62e3f75cfe2ab70477b046d98e3e71804eade3956c7b98cf',
  ];

  test('matches NUT-13 V2 spec vectors for counters 0-4', () => {
    for (let counter = 0; counter < secrets.length; counter++) {
      const { secret, blindingFactor } = deriveSecretAndBlindingFactor(seed, v2KeysetId, counter);
      expect(bytesToHex(secret)).toBe(secrets[counter]);
      expect(bytesToHex(blindingFactor)).toBe(blindingFactors[counter]);
    }
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
  const seed = hexToBytes(
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

  test('rejects an odd-length known-version keyset id as a CTSError', () => {
    expect(() => deriveSecretAndBlindingFactor(seed, '01f', 0)).toThrow(CTSError);
  });
});
