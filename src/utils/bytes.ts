import { numberToVarBytesBE } from '@noble/curves/utils.js';

const utf8Decoder = new TextDecoder('utf-8');

/**
 * Decodes bytes as UTF-8.
 *
 * @remarks
 * The inverse of noble's `utf8ToBytes`, which has no counterpart there.
 * @param bytes Bytes to decode.
 * @returns The decoded string.
 */
export function bytesToUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

/**
 * Lexicographic byte comparison, for sorting canonical encodings.
 *
 * @remarks
 * Not constant time, and not a substitute for `equalBytes`, which is. Shorter sorts first when one
 * is a prefix of the other.
 * @returns Negative, zero or positive, as `Array.prototype.sort` expects.
 */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * Minimal big-endian bytes of a non-negative integer, with zero as no bytes at all.
 *
 * @remarks
 * The empty encoding of zero is the difference from noble's `numberToVarBytesBE`, which emits
 * `0x00`. Length-framed fields (NUT-02 keyset ids) need the empty form.
 * @throws RangeError If `value` is negative.
 */
export function minimalBytesBE(value: bigint): Uint8Array {
  if (value < 0n) throw new RangeError('value must be non-negative');
  return value === 0n ? new Uint8Array(0) : numberToVarBytesBE(value);
}
