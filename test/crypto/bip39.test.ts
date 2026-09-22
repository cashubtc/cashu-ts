import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import { mnemonicToSeedSync } from '../../src/crypto/bip39';

const ABANDON =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('mnemonicToSeedSync', () => {
  it('matches the BIP-39 reference vectors', () => {
    expect(bytesToHex(mnemonicToSeedSync(ABANDON, 'TREZOR'))).toBe(
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
    );
    expect(
      bytesToHex(
        mnemonicToSeedSync(
          'legal winner thank year wave sausage worth useful legal winner thank yellow',
          'TREZOR',
        ),
      ),
    ).toBe(
      '2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6fa457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607',
    );
  });

  it('derives the seed the NUT-13 vectors are stated in', () => {
    expect(
      bytesToHex(
        mnemonicToSeedSync(
          'half depart obvious quality work element tank gorilla view sugar picture humble',
        ),
      ),
    ).toBe(
      'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
    );
  });

  it('normalizes the passphrase to NFKD', () => {
    expect(mnemonicToSeedSync(ABANDON, 'café')).toEqual(mnemonicToSeedSync(ABANDON, 'café'));
  });

  it('rejects a wrong word count and non-string input', () => {
    expect(() => mnemonicToSeedSync('abandon about')).toThrow('12, 15, 18, 21 or 24 words');
    expect(() => mnemonicToSeedSync(42 as unknown as string)).toThrow('must be strings');
  });
});
