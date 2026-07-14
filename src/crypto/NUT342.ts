import { gcm } from '@noble/ciphers/aes.js';
import { numberToBytesBE } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';

import { CTSError } from '../model/Errors';
import { Bytes, numberToHexPadded64 } from '../utils';

const NONCE_SIZE = 12;
const GAP_SIZE = 4;
const TAG_SIZE = 16;
const MAX_GAP = 0xffffffff;

// AES-128-GCM key from the output's blinding factor: SHA256(r)[0:16].
function deriveKey(blindingFactor: bigint): Uint8Array {
  return sha256(hexToBytes(numberToHexPadded64(blindingFactor))).slice(0, 16);
}

/**
 * Encrypts a NUT-342 (draft) recovery gap with the output's blinding factor.
 *
 * @remarks
 * Returns hex `nonce || ciphertext || tag` (32 bytes) for the `d_gap` field.
 * @throws {@link CTSError} If `dGap` is not an unsigned 32-bit integer.
 */
export function encryptDGap(dGap: number, blindingFactor: bigint): string {
  if (!Number.isInteger(dGap) || dGap < 0 || dGap > MAX_GAP) {
    throw new CTSError('d_gap must be an unsigned 32-bit integer');
  }
  const nonce = randomBytes(NONCE_SIZE);
  const encrypted = gcm(deriveKey(blindingFactor), nonce).encrypt(numberToBytesBE(dGap, GAP_SIZE));
  return bytesToHex(Bytes.concat(nonce, encrypted));
}

/**
 * Decrypts and authenticates a NUT-342 (draft) `d_gap` value.
 *
 * @throws {@link CTSError} If the payload is malformed or fails authentication.
 */
export function decryptDGap(encryptedDGap: string, blindingFactor: bigint): number {
  let payload: Uint8Array;
  try {
    payload = hexToBytes(encryptedDGap);
  } catch (e) {
    throw new CTSError('encrypted d_gap is not valid hex', { cause: e });
  }
  if (payload.length !== NONCE_SIZE + GAP_SIZE + TAG_SIZE) {
    throw new CTSError('invalid encrypted d_gap length');
  }
  try {
    const plaintext = gcm(deriveKey(blindingFactor), payload.subarray(0, NONCE_SIZE)).decrypt(
      payload.subarray(NONCE_SIZE),
    );
    return Number(Bytes.toBigInt(plaintext));
  } catch (e) {
    throw new CTSError('d_gap decryption failed', { cause: e });
  }
}
