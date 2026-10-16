import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha512 } from '@noble/hashes/sha2.js';

import { CTSError } from '../model/Errors';

const MNEMONIC_WORD_COUNTS = [12, 15, 18, 21, 24];

/**
 * Derives the 64-byte BIP-39 seed from a mnemonic and optional passphrase.
 *
 * @remarks
 * Normalizes (NFKD) and checks the word count only; wordlist membership and the checksum are not
 * verified, so validate the phrase first if it came from a user. Same name and semantics as
 * `@scure/bip39`.
 */
export function mnemonicToSeedSync(mnemonic: string, passphrase = ''): Uint8Array {
  if (typeof mnemonic !== 'string' || typeof passphrase !== 'string') {
    throw new CTSError('mnemonicToSeedSync: mnemonic and passphrase must be strings');
  }
  const phrase = mnemonic.normalize('NFKD');
  if (!MNEMONIC_WORD_COUNTS.includes(phrase.split(' ').length)) {
    throw new CTSError('mnemonicToSeedSync: a mnemonic has 12, 15, 18, 21 or 24 words');
  }
  return pbkdf2(sha512, phrase, ('mnemonic' + passphrase).normalize('NFKD'), {
    c: 2048,
    dkLen: 64,
  });
}
