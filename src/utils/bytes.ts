import { CTSError } from '../model/Errors';

const fieldUtf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

/**
 * Decodes bytes as UTF-8 for a length-delimited wire field.
 *
 * @remarks
 * A leading BOM is kept as content rather than stripped (the field's length already frames it) and
 * malformed sequences are rejected rather than replaced.
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
 * stripped; malformed sequences are still rejected rather than replaced.
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
