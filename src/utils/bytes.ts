import { numberToVarBytesBE } from '@noble/curves/utils.js';

import { CTSError } from '../model/Errors';

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

const fieldUtf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

/**
 * Decodes bytes as UTF-8 for a length-delimited wire field.
 *
 * @remarks
 * Unlike {@link bytesToUtf8}, a leading BOM is kept as content rather than stripped (the field's
 * length already frames it) and malformed sequences are rejected rather than replaced.
 * @throws CTSError If the bytes are not valid UTF-8.
 */
export function decodeUtf8Field(bytes: Uint8Array): string {
  try {
    return fieldUtf8Decoder.decode(bytes);
  } catch (cause) {
    throw new CTSError('Malformed UTF-8 sequence', { cause });
  }
}

const documentUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Decodes bytes as UTF-8 for a whole serialized document (eg a JSON payload).
 *
 * @remarks
 * Unlike {@link decodeUtf8Field}, a leading BOM is envelope framing here, not content, so it is
 * stripped like {@link bytesToUtf8} does; malformed sequences are still rejected rather than
 * replaced.
 * @throws CTSError If the bytes are not valid UTF-8.
 */
export function decodeUtf8Document(bytes: Uint8Array): string {
  let text: string;
  try {
    text = documentUtf8Decoder.decode(bytes);
  } catch (cause) {
    throw new CTSError('Malformed UTF-8 sequence', { cause });
  }
  // Strip the BOM ourselves: a reused decoder does not do it consistently across engines.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const LONE_SURROGATE_RE = /[\uD800-\uDFFF]/u;

/**
 * Reports whether a string contains an unpaired UTF-16 surrogate.
 *
 * @remarks
 * With the `u` flag a valid surrogate pair combines into one code point and no longer falls in the
 * surrogate range, so only an ill-formed one matches. Such a string has no UTF-8 representation:
 * encoding it replaces the surrogate with U+FFFD, which aliases it with other strings.
 */
export function hasLoneSurrogate(text: string): boolean {
  return LONE_SURROGATE_RE.test(text);
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
