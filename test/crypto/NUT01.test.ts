import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import {
  BLS_FR_ORDER,
  blindMessage,
  createBlindSignature,
  createNewMintKeys,
  serializeMintKeys,
  deserializeMintKeys,
  type SerializedMintKeys,
} from '../../src/crypto';
import { hexToNumber } from '../../src/utils';
import { PUBKEYS, TEST_PRIV_KEY_PUBS } from '../consts';

describe('test blind sig', () => {
  test('blind sig', async () => {
    const privKey = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
    const { B_ } = blindMessage(
      new TextEncoder().encode('test_message'),
      hexToNumber('0000000000000000000000000000000000000000000000000000000000000001'),
    );
    const { C_ } = createBlindSignature(B_, privKey, '0000000');
    expect(C_.toHex(true)).toBe(
      '025cc16fe33b953e2ace39653efb3e7a7049711ae1d8a2f7a9108753f1cdea742b',
    );
  });
});
describe('new mint keys', () => {
  test('mint keys from seed', async () => {
    const keys = createNewMintKeys(64, new TextEncoder().encode('TEST_PRIVATE_KEY'));
    const serialized = serializeMintKeys(keys.pubKeys);
    // console.log(serialized);
    expect(keys.keysetId).toBe(
      '01b705798f95060bade4eb73f65aa3020fc51be05ba85dcb74b97b93c03b9c65f9',
    );
    expect(serialized).toEqual(TEST_PRIV_KEY_PUBS);

    const randomkeys = createNewMintKeys(64);
    const serializedRandom = serializeMintKeys(randomkeys.pubKeys);
    expect(serializedRandom).not.toEqual(PUBKEYS);
    expect(serializedRandom).toHaveProperty('288230376151711744');
  });

  test('rejects an out-of-range or non-integer pow2height before generating keys', () => {
    // Type is erased at runtime; a JS/JSON caller can pass anything.
    for (const bad of [65, 1e6, Infinity, -1, 1.5, NaN]) {
      expect(() => createNewMintKeys(bad as Parameters<typeof createNewMintKeys>[0])).toThrow(
        /pow2height/i,
      );
    }
  });
});
describe('serialize mint keys', () => {
  test('derive', () => {
    const keys: SerializedMintKeys = PUBKEYS;
    const deserializedKeys = deserializeMintKeys(keys);
    const serializedKeys = serializeMintKeys(deserializedKeys);
    expect(serializedKeys).toEqual(keys);
  });
});

describe('v3 (BLS) mint keys', () => {
  test('versionByte=2 produces 96-byte G2 pubkeys and a 02-prefixed id', () => {
    const { pubKeys, privKeys, keysetId } = createNewMintKeys(
      4,
      new TextEncoder().encode('TEST_PRIVATE_KEY'),
      { versionByte: 2 },
    );
    expect(keysetId.startsWith('02')).toBe(true);
    for (const amount of Object.keys(pubKeys)) {
      // G2 compressed = 96 bytes
      expect(pubKeys[amount].length).toBe(96);
      const scalar = BigInt(`0x${bytesToHex(privKeys[amount])}`);
      expect(scalar > 0n && scalar < BLS_FR_ORDER).toBe(true);
    }
  });

  test('random v3 mint keys rejection-sample into Fr', () => {
    const { privKeys } = createNewMintKeys(8, undefined, { versionByte: 2 });
    for (const key of Object.values(privKeys)) {
      const scalar = BigInt(`0x${bytesToHex(key)}`);
      expect(scalar > 0n && scalar < BLS_FR_ORDER).toBe(true);
    }
  });

  // Locked Nutshell parity vector — regenerate via:
  //   /Users/robw/Library/Caches/pypoetry/virtualenvs/cashu-Ekz2CEo7-py3.10/bin/python -c "..."
  // (see PR description). Inputs: mnemonic='TEST_PRIVATE_KEY', path m/0'/0'/0', amounts [1,2,4,8], unit 'sat'.
  test('v3 mint keys match Nutshell derive_keys_v3 byte-for-byte', () => {
    const { pubKeys, keysetId } = createNewMintKeys(
      4,
      new TextEncoder().encode('TEST_PRIVATE_KEY'),
      { versionByte: 2, unit: 'sat' },
    );

    expect(keysetId).toBe('022e079d1620ca63ba9d659907716f5feb941715ad29bd4616f89f71ac00070547');

    const expected: Record<string, string> = {
      '1':
        'b8df0ca950067cb9c29002aa9d6a2218660f774dd36728bae916400b63d8d24bca8abe24c66581adc4a849ab8c4b2fe5' +
        '12334c6beeca1d05548d1663e7e04f6ed6c845eb3017030292e9779a9ee43bcb587b511afd0329a0faa927f50ec74ac4',
      '2':
        '82cf4f6979ae88f9d43e4fa8e62555bfff649266aab51dd912b70fede20058f005e210c84e89ae3fe0c456934698e7dc' +
        '05d40c2967535b4bc2a1a97149becbcb7ae33789d15ff1022d1821b3674988e72f1262e53d99211f9de6f33917df05c2',
      '4':
        '80f99027461b75d15a498628557919bd927a0db22455b586c429080c19dba400a982a30516393146d803d4234dd2763b0' +
        '8f82ae93acba168dd62a42def6117e2589bd2d6c206cd6f01943f070abc3371fdb04d054a2baefa93dd484471454362',
      '8':
        'a1640f644c494ce7988efb342b3a0efa7e63cda47c9fb6ceafb6c292e499289762468c444f6815e525dd637527db3779' +
        '0d1964339cba94375d46f80409a9c6203c8d9b891f5e18bd02c47706a6c2878282846095f3b1c36199fca9e77ed523db',
    };

    const serialized = serializeMintKeys(pubKeys);
    expect(serialized).toEqual(expected);
  });
});
