import { hexToBytes } from '@noble/hashes/utils.js';
import {
  blindMessage,
  createBlindSignature,
  createNewMintKeys,
  serializeMintKeys,
  deserializeMintKeys,
  SerializedMintKeys,
} from '../../src/crypto';
import { PUBKEYS, TEST_PRIV_KEY_PUBS } from '../consts';
import { describe, expect, test } from 'vitest';
import { hexToNumber } from '../../src/utils';

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
    const { pubKeys, keysetId } = createNewMintKeys(
      4,
      new TextEncoder().encode('TEST_PRIVATE_KEY'),
      { versionByte: 2 },
    );
    expect(keysetId.startsWith('02')).toBe(true);
    for (const amount of Object.keys(pubKeys)) {
      // G2 compressed = 96 bytes
      expect(pubKeys[amount].length).toBe(96);
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

    expect(keysetId).toBe('029b80063a8a37c49c1d9e9d20eda8c5f4f7fecd0502c900061618c589fe5bd460');

    const expected: Record<string, string> = {
      '1':
        '88e1aa1182ccb440c6ff6ba3faa5a3da0d0093a463a119b23d739b6b22488b318262da951f23fd6d4a11e4fc0515d53f' +
        '0ee3d76f8f952e0c5f7475a57e633edb2233d77ef10378379a354c5004bd9155664d090a0f52e0f6b5a1ecaecd144ee6',
      '2':
        'ab6276b680267e379cf2f715a76fa80a871bdcb11e92d384d3842f9ed8ad326d0c1c8c13d7a40928fdc648b3bece85d6' +
        '0c1874376d7d45887637b4e46c7b27ec248a0e04eb26bb3e11606e8d3fd90c82f2a9f87f17b696e4161d27c72f57d694',
      '4':
        'a1af6bd271971d71d56d244b9dd2849eac47c9edc3fa82bf8f388961efc928f10d1b417f5db2fc2f3c6a809e28a111c7' +
        '0f23bb08231897ba74e44ef33c9e0f9e579bf8cbe3594bee5ad3372e9640047c52f3bd54db86f1c5289e34255dd15d06',
      '8':
        '8b69dd1aaeb16c2417e8f7977c1d53f812a771fd24d0d5e30e93298f677056f4c0229d1899fc2338224d956738b3485e' +
        '0627a92a264615a710a6666c75f30e221254deb6c1d0c81b87fd617d383ff0c8cfd50d8bcdb7a7b809dab3e3df35fbe8',
    };

    const serialized = serializeMintKeys(pubKeys);
    expect(serialized).toEqual(expected);
  });
});
