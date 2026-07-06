import { hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import { type Bip32KeyPurpose, createKeyPairDeriver, deriveKeyPair } from '../../src/crypto';

// BIP39 seed (no passphrase) for the mnemonic in the NUT-11 / NUT-20 test vectors:
// "half depart obvious quality work element tank gorilla view sugar picture humble"
const SEED = hexToBytes(
  'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25' +
    '780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
);

// Expected compressed (02/03-prefixed) public keys from the PR test vectors.
const VECTORS: Record<Bip32KeyPurpose, string[]> = {
  P2PK: [
    '021693d45f4fdf610ae641fedb0944fb460fbb8264f21c19d2626c3da755fcbbcb',
    '0395461ab678058c0ed6aa39f38dda490eaa163e9ad27070b23ec3d06b41e07535',
    '02a05e4e593a633e9b4405f01c9632c8afde24cb613017a1aee56fd76291ad26d1',
    '033addea25c3873b93d67d536c61c9d9c993f6efd8b9dfa657951b66b5001e51dd',
    '03c964bdf42fc82b6c574615746eeca37527a24f1fdfc1b34a732c53843b5744a5',
  ],
  QuoteLock: [
    '03062837166e56114b59a4d1fd3a5a812bf7aadc1dde758428cf943d80acd41539',
    '02b47d9d41725f5ce6f08c874835cef25376cb1e95f6cb073fef52ca8fd986cf15',
    '029acbd3a46fd75bc05ba0226d0b4d909b2fb6e96c80544a094a1a3567737e44d3',
    '0373e4a42fbe0a4e18aadb57cf500b655f2446b4071ee579121d2ed8905bcc49c2',
    '02b8709bfce17c10f1864f5218844533ae60930d52089669b317d8b5f474eec071',
  ],
};

describe('deterministic P2PK / quote-lock key derivation (NUT-11, NUT-20)', () => {
  test.each(['P2PK', 'QuoteLock'] as const)(
    '%s matches spec test vectors for counters 0-4',
    (purpose) => {
      const expected = VECTORS[purpose];
      const derive = createKeyPairDeriver(SEED, purpose);
      for (let counter = 0; counter < expected.length; counter++) {
        const pair = deriveKeyPair(SEED, purpose, counter);
        expect(pair.privkey).toHaveLength(64); // 32 bytes, hex
        expect(pair.pubkey).toBe(expected[counter]);
        // cached factory must agree with the one-shot keypair
        expect(derive(counter)).toEqual(pair);
      }
    },
  );

  test('P2PK and QuoteLock purposes diverge for the same seed/counter', () => {
    expect(deriveKeyPair(SEED, 'P2PK', 0).pubkey).not.toBe(
      deriveKeyPair(SEED, 'QuoteLock', 0).pubkey,
    );
  });

  // deriveChild would silently harden indices >= 2^31, breaking xpub watch-only derivation
  test.each([0x80000000, -1, 1.5, Number.NaN])('rejects invalid counter %s', (counter) => {
    expect(() => deriveKeyPair(SEED, 'P2PK', counter)).toThrow('non-hardened');
  });

  test('accepts the maximum non-hardened counter', () => {
    expect(deriveKeyPair(SEED, 'P2PK', 0x7fffffff).pubkey).toMatch(/^0[23][0-9a-f]{64}$/);
  });
});
