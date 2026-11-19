import { bytesToNumberBE } from '@noble/curves/utils.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { HDKey } from '@scure/bip32';
import { describe, expect, test } from 'vitest';

import {
  createSecretAndBlindingFactorDeriver,
  deriveBlindingFactor,
  deriveSecret,
  deriveSecretAndBlindingFactor,
  findLegacyDerivationCollisions,
  getKeysetIdInt,
  mnemonicToSeedSync,
} from '../../src/crypto';
import { CTSError } from '../../src/model/Errors';
import { decodeBase64ToUint8Legacy } from '../../src/utils';

describe('createSecretAndBlindingFactorDeriver', () => {
  const seed64 = (label: string): Uint8Array => {
    const seed = new Uint8Array(64);
    seed.set(new TextEncoder().encode(label));
    return seed;
  };

  test.each(['01abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567'])(
    'keeps its own copy of the seed for keyset %s',
    (keysetId) => {
      const caller = seed64('deriver seed');
      const derive = createSecretAndBlindingFactorDeriver(caller, keysetId);
      caller.fill(0);
      expect(derive(3)).toEqual(
        createSecretAndBlindingFactorDeriver(seed64('deriver seed'), keysetId)(3),
      );
    },
  );
});

describe('findLegacyDerivationCollisions', () => {
  test('returns no groups for empty, unique or repeated identical IDs', () => {
    expect(findLegacyDerivationCollisions([])).toEqual([]);
    expect(findLegacyDerivationCollisions(['0000000000000001', '0000000000000002'])).toEqual([]);
    expect(findLegacyDerivationCollisions(['0000000000000001', '0000000000000001'])).toEqual([]);
  });

  test('groups distinct hex 00 IDs and omits duplicates and singletons', () => {
    const ids = Object.freeze([
      '0000000000000001',
      '0000000000000002',
      '0000000080000000',
      '0000000000000003',
      '0000000080000001',
      '00000000ffffffff',
      '0000000080000000',
    ]);
    expect(findLegacyDerivationCollisions(ids)).toEqual([
      ['0000000000000001', '0000000080000000', '00000000ffffffff'],
      ['0000000000000002', '0000000080000001'],
    ]);
  });

  test('groups base64 IDs with each other and with hex 00 IDs', () => {
    expect(
      findLegacyDerivationCollisions(['AAAAAIAAAAA=', '0000000000000001', 'AAAAAP////8=']),
    ).toEqual([['AAAAAIAAAAA=', '0000000000000001', 'AAAAAP////8=']]);
  });

  test('hex casing differences do not form a collision', () => {
    expect(findLegacyDerivationCollisions(['00000000ABCDEF01', '00000000abcdef01'])).toEqual([]);
  });

  test.each(['00000000ABCDEF01', '00000000abcdef01'])(
    'preserves the first hex spelling %s in a collision group',
    (firstId) => {
      expect(
        findLegacyDerivationCollisions([
          firstId,
          '00000000ABCDEF01',
          '000000012bcdef00',
          '00000000abcdef01',
        ]),
      ).toEqual([[firstId, '000000012bcdef00']]);
    },
  );

  test('keeps all-hex legacy base64 IDs case-sensitive', () => {
    const firstId = 'd9f0F7F2875b';
    const secondId = firstId.toLowerCase();
    const firstHexId = '00' + getKeysetIdInt(firstId).toString(16).padStart(14, '0');
    const secondHexId = '00' + getKeysetIdInt(secondId).toString(16).padStart(14, '0');
    expect(firstHexId).not.toBe(secondHexId);
    expect(findLegacyDerivationCollisions([firstId, secondId, firstHexId, secondHexId])).toEqual([
      [firstId, firstHexId],
      [secondId, secondHexId],
    ]);
  });

  test('accepts standard and URL-safe legacy base64', () => {
    expect(findLegacyDerivationCollisions(['+//wAAAAAAAA', '000000007fe003ef'])).toEqual([
      ['+//wAAAAAAAA', '000000007fe003ef'],
    ]);
    expect(findLegacyDerivationCollisions(['-__wAAAAAAAA', '000000007fe003ef'])).toEqual([
      ['-__wAAAAAAAA', '000000007fe003ef'],
    ]);
  });

  test('URL-safe and standard spellings of one base64 ID do not form a collision', () => {
    expect(findLegacyDerivationCollisions(['+//wAAAAAAAA', '-__wAAAAAAAA'])).toEqual([]);
    expect(
      findLegacyDerivationCollisions(['-__wAAAAAAAA', '+//wAAAAAAAA', '000000007fe003ef']),
    ).toEqual([['-__wAAAAAAAA', '000000007fe003ef']]);
  });

  test.each([
    ['d9f0F7F2875b', '0000000026dbef9d'],
    ['010000000000', '000000006f3cf71b'],
    ['00abcdefabcd', '000000002ca09e19'],
  ])('treats the 12-character all-hex ID %s as legacy base64', (legacyId, hexId) => {
    expect(findLegacyDerivationCollisions([legacyId, hexId])).toEqual([[legacyId, hexId]]);
  });

  test.each(['01', '02', '03', 'ff'])(
    'ignores hex version %s even with matching integers',
    (version) => {
      const modernId = version + '00000000000000';
      const legacyId = '00' + getKeysetIdInt(modernId).toString(16).padStart(14, '0');
      expect(findLegacyDerivationCollisions([modernId, legacyId])).toEqual([]);
    },
  );

  test('skips unrecognized forms and malformed hex without throwing', () => {
    expect(
      findLegacyDerivationCollisions([
        '',
        'not-a-keyset!',
        '!'.repeat(12),
        '00f',
        '01f',
        '03ff00',
        'AA=A',
        '+__wAAAAAAAA',
        '0000000000000001',
        '0000000080000000',
      ]),
    ).toEqual([['0000000000000001', '0000000080000000']]);
  });
});

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

describe('v2 derivation spec vectors', () => {
  // Lock-in for nuts/tests/13-tests.md "Version 2: Secret derivation", from the spec's mnemonic.
  const seed = mnemonicToSeedSync(
    'half depart obvious quality work element tank gorilla view sugar picture humble',
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

describe('seed length', () => {
  const v2KeysetId = '01abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567';
  const legacyKeysetId = '0NI3TUAs1Sfa';
  const bad = /seed must be a 16 to 64 byte Uint8Array/;

  test('every seeded derivation takes 16 to 64 bytes and nothing else', () => {
    for (const length of [16, 32, 64]) {
      const seed = new Uint8Array(length).fill(7);
      expect(() => deriveSecretAndBlindingFactor(seed, v2KeysetId, 0)).not.toThrow();
      expect(() => deriveSecretAndBlindingFactor(seed, legacyKeysetId, 0)).not.toThrow();
    }
    for (const length of [0, 15, 65]) {
      const seed = new Uint8Array(length);
      expect(() => deriveSecretAndBlindingFactor(seed, v2KeysetId, 0)).toThrow(bad);
      expect(() => deriveSecretAndBlindingFactor(seed, legacyKeysetId, 0)).toThrow(bad);
      expect(() => createSecretAndBlindingFactorDeriver(seed, v2KeysetId)).toThrow(bad);
      expect(() => deriveSecret(seed, v2KeysetId, 0)).toThrow(bad);
      expect(() => deriveBlindingFactor(seed, v2KeysetId, 0)).toThrow(bad);
    }
  });

  test('a seed that is not a Uint8Array is rejected the same way', () => {
    const notBytes = 'dd44ee516b0647e80b488e8dcc56d736' as unknown as Uint8Array;
    expect(() => deriveSecretAndBlindingFactor(notBytes, v2KeysetId, 0)).toThrow(bad);
    expect(() => deriveSecret(notBytes, v2KeysetId, 0)).toThrow(bad);
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

  test('a 12-character all-hex keyset id still takes the deprecated BIP-32 path', () => {
    // Legacy ids predate the version byte and their base64 alphabet overlaps hex, so length
    // is what separates them from a modern id.
    const legacyKeysetId = 'd9f0F7F2875b';
    const counter = 2;
    const keysetIdInt =
      bytesToNumberBE(decodeBase64ToUint8Legacy(legacyKeysetId)) % BigInt(2 ** 31 - 1);
    expect(getKeysetIdInt(legacyKeysetId)).toBe(keysetIdInt);

    const hdkey = HDKey.fromMasterSeed(seed);
    const path = `m/129372'/0'/${keysetIdInt}'/${counter}'`;
    const expectedSecret = hdkey.derive(`${path}/0`).privateKey;
    const expectedR = hdkey.derive(`${path}/1`).privateKey;
    expect(expectedSecret).not.toBeNull();

    const { secret, blindingFactor } = deriveSecretAndBlindingFactor(seed, legacyKeysetId, counter);
    expect(bytesToHex(secret)).toBe(bytesToHex(expectedSecret as Uint8Array));
    expect(bytesToHex(blindingFactor)).toBe(bytesToHex(expectedR as Uint8Array));

    // Length alone is not enough: a 12-character id outside both alphabets is still rejected.
    expect(() => deriveSecretAndBlindingFactor(seed, '!'.repeat(12), 0)).toThrow(
      /Unrecognized keyset ID version/,
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

describe('keyset id validation', () => {
  test('an odd-length hmac keyset id throws CTSError, not a noble RangeError', () => {
    expect(() => deriveSecretAndBlindingFactor(new Uint8Array(64), '01f', 0)).toThrow(CTSError);
  });
});
