import {
  bytesToHex as nobleBytesToHex,
  hexToBytes as nobleHexToBytes,
} from '@noble/hashes/utils.js';

import { CTSError } from '../model/Errors';

/**
 * Converts bytes to a lowercase hex string.
 *
 * @param bytes Bytes to encode.
 * @returns The unprefixed hex encoding.
 * @throws CTSError If `bytes` is not a `Uint8Array`.
 */
export function bytesToHex(bytes: Uint8Array): string {
  try {
    return nobleBytesToHex(bytes);
  } catch (cause) {
    throw new CTSError('bytesToHex: expected bytes to be a Uint8Array', { cause });
  }
}

/**
 * Converts an unprefixed, even-length hex string to bytes.
 *
 * @remarks
 * Input is not trimmed; prefixes, whitespace, odd lengths, and non-hex characters are rejected.
 * @param hex Hex string to decode.
 * @returns The decoded bytes.
 * @throws CTSError If `hex` is not an unprefixed, even-length hex string.
 */
export function hexToBytes(hex: string): Uint8Array {
  try {
    return nobleHexToBytes(hex);
  } catch (cause) {
    throw new CTSError('hexToBytes: expected an unprefixed, even-length hex string', { cause });
  }
}
