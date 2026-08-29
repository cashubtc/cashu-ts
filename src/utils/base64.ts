import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base64, base64nopad, base64url, base64urlnopad } from '@scure/base';

import { CTSError } from '../model/Errors';

import { JSONInt } from './JSONInt';

/**
 * Normalizes the presentation of an encoded payload before decoding.
 *
 * @remarks
 * Payloads are pasted from anywhere, so line wrapping is common, and NUT-00 requires padded and
 * unpadded forms to decode alike. Content is still validated by the codec.
 */
function normalizeEncodedInput(str: string): string {
  return str
    .trim()
    .replace(/[\t\n\f\r ]+/g, '')
    .replace(/={1,2}$/, '');
}

function encodeUint8toBase64(bytes: Uint8Array): string {
  return base64.encode(bytes);
}

function encodeUint8toBase64Url(bytes: Uint8Array): string {
  return base64urlnopad.encode(bytes);
}

/**
 * Encode bytes as URL-safe base64 **with** padding (RFC 4648 §5, padded variant).
 *
 * Use this when the receiver requires padded URL-safe base64, e.g. CDK mint's
 * `general_purpose::URL_SAFE` decoder for the `Blind-auth` header (NUT-22). Use
 * `encodeUint8toBase64Url` instead when the spec explicitly forbids padding (e.g. PKCE code
 * verifier / challenge per RFC 7636).
 */
function encodeUint8toBase64UrlPadded(bytes: Uint8Array): string {
  return base64url.encode(bytes);
}

/**
 * Decodes a `base64_urlsafe` payload, the alphabet NUT-00 mandates for tokens and payment requests.
 * Padding is optional, matching the spec and CDK's `DecodePaddingMode::Indifferent`.
 */
function encodeBase64UrltoUint8(base64String: string): Uint8Array {
  try {
    return base64urlnopad.decode(normalizeEncodedInput(base64String));
  } catch (cause) {
    throw new CTSError('Invalid base64url string', { cause });
  }
}

/**
 * Decodes a standard-alphabet payload. Current formats are base64url, so this is for the two things
 * that predate it: deprecated keyset IDs (e.g. `+//wAAAAAAAA`), and payment requests emitted before
 * this library encoded them url-safe. Use {@link encodeBase64UrltoUint8} otherwise.
 */
function encodeBase64toUint8Legacy(base64String: string): Uint8Array {
  try {
    return base64nopad.decode(normalizeEncodedInput(base64String));
  } catch (cause) {
    throw new CTSError('Invalid base64 string', { cause });
  }
}

/**
 * Serializes an object to base64url-encoded JSON using {@link JSONInt.stringify}.
 *
 * `bigint` values are emitted as raw JSON number tokens (no quotes, no `n` suffix), which is
 * required for the v3 cashu token wire format. Callers must use {@link encodeBase64ToJson} to
 * decode, as standard `JSON.parse` will lose precision on integers above `MAX_SAFE_INTEGER`.
 */
function encodeJsonToBase64(jsonObj: unknown): string {
  const jsonString = JSONInt.stringify(jsonObj) ?? '';
  return base64urlnopad.encode(utf8ToBytes(jsonString));
}

/**
 * Deserializes a base64url-encoded JSON string using {@link JSONInt.parse}.
 *
 * Integers within `±MAX_SAFE_INTEGER` are returned as `number`; integers outside that range are
 * returned as `bigint`. This preserves precision for large amounts encoded by
 * {@link encodeJsonToBase64}.
 */
function encodeBase64ToJson<T extends object>(base64String: string): T {
  const jsonString = new TextDecoder('utf-8').decode(encodeBase64UrltoUint8(base64String));
  return JSONInt.parse(jsonString) as T;
}

/**
 * Reports whether a string is a well-formed base64 payload in either alphabet.
 *
 * @remarks
 * Used to spot deprecated keyset IDs, which are standard base64 where current ones are hex. The two
 * alphabets are checked separately, so a string mixing `-_` with `+/` is rejected rather than
 * silently decoded.
 */
function isBase64String(s: string): boolean {
  if (typeof s !== 'string' || s.length === 0) return false;
  const normalized = normalizeEncodedInput(s);
  if (normalized.length === 0) return false;
  const codec = /[-_]/.test(normalized) ? base64urlnopad : base64nopad;
  try {
    return codec.encode(codec.decode(normalized)) === normalized;
  } catch {
    return false;
  }
}

export {
  encodeUint8toBase64,
  encodeUint8toBase64Url,
  encodeUint8toBase64UrlPadded,
  encodeBase64UrltoUint8,
  encodeBase64toUint8Legacy,
  encodeJsonToBase64,
  encodeBase64ToJson,
  isBase64String,
};
