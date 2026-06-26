import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { CTSError } from '../model/Errors';
import { Bytes } from '../utils';

/**
 * NIP-78 addressable event kind used for the mint-list backup (NUT-27).
 */
export const MINT_BACKUP_KIND = 30078;

/**
 * Addressable-event `d` tag identifying the mint-list backup.
 */
export const MINT_BACKUP_D_TAG = 'mint-list';

const BACKUP_DOMAIN_SEPARATOR = utf8ToBytes('cashu-mint-backup');

/**
 * Plaintext shape that gets NIP-44-encrypted into the event `content`.
 */
export interface MintBackupPayload {
  mints: string[];
  timestamp: number;
}

/**
 * Derive the deterministic NUT-27 mint-backup keypair from a BIP-39 seed.
 *
 * @remarks
 * `privkey = SHA256(seed ‖ "cashu-mint-backup")`; `pubkey` is the 32-byte x-only Nostr public key.
 * Takes the 64-byte seed (not a mnemonic) to match the rest of cashu-ts, which never handles
 * mnemonics. Returns hex strings, the form nostr-tools/NDK consume. The same keypair encrypts and
 * decrypts (self-addressed conversation key).
 * @param seed BIP-39 seed, e.g. from `mnemonicToSeedSync(mnemonic)`.
 * @returns `{ privkey, pubkey }` as lowercase hex strings.
 */
export function deriveMintBackupKeys(seed: Uint8Array): { privkey: string; pubkey: string } {
  if (!(seed instanceof Uint8Array) || seed.length === 0) {
    throw new CTSError('seed must be a non-empty Uint8Array');
  }
  const privkey = sha256(Bytes.concat(seed, BACKUP_DOMAIN_SEPARATOR));
  const pubkey = schnorr.getPublicKey(privkey); // 32-byte x-only
  return { privkey: bytesToHex(privkey), pubkey: bytesToHex(pubkey) };
}

/**
 * Build the canonical backup payload JSON (the plaintext to NIP-44-encrypt).
 *
 * @param mints Mint URLs to back up.
 * @param timestamp Unix seconds; reuse as the event `created_at`.
 */
export function buildMintBackupPayload(mints: string[], timestamp: number): string {
  if (!Array.isArray(mints) || !mints.every((m) => typeof m === 'string')) {
    throw new CTSError('mints must be an array of strings');
  }
  if (!Number.isInteger(timestamp)) {
    throw new CTSError('timestamp must be an integer (unix seconds)');
  }
  const payload: MintBackupPayload = { mints, timestamp };
  return JSON.stringify(payload);
}

/**
 * Parse and validate decrypted backup content.
 *
 * @remarks
 * Defensive decode of untrusted relay data — verifies `mints` is a `string[]` and `timestamp` an
 * integer, rather than trusting the JSON shape.
 */
export function parseMintBackupPayload(json: string): MintBackupPayload {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (cause) {
    throw new CTSError('backup content is not valid JSON', { cause });
  }
  if (typeof data !== 'object' || data === null) {
    throw new CTSError('backup payload must be an object');
  }
  const { mints, timestamp } = data as Record<string, unknown>;
  if (!Array.isArray(mints) || !mints.every((m) => typeof m === 'string')) {
    throw new CTSError('backup payload `mints` must be an array of strings');
  }
  if (!Number.isInteger(timestamp)) {
    throw new CTSError('backup payload `timestamp` must be an integer');
  }
  return { mints: mints, timestamp: timestamp as number };
}
