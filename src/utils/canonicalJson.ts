import { CTSError } from '../model/Errors';

import { JSONInt } from './JSONInt';

/**
 * Serializes an already-parsed JSON value to its RFC 8785 (JCS) canonical form.
 *
 * @remarks
 * Object keys are sorted by UTF-16 code unit, then serialized with {@link JSONInt}: an integer past
 * the safe range keeps its digits instead of throwing as `JSON.stringify` would. Strict JCS rounds
 * every number through a double, so no peer can sign over such a value and be verified anyway.
 * @throws {@link CTSError} If the value has no JSON form (`undefined`, a function, a symbol).
 */
export function canonicalizeJson(value: unknown): string {
  const json = JSONInt.stringify(sortKeys(value));
  if (json === undefined) {
    throw new CTSError('canonicalizeJson: value has no JSON representation');
  }
  return json;
}

// Only plain objects and arrays are walked; anything else (Amount, Date) stays a leaf for JSONInt
// to serialize. Recursion is bounded by the parser's depth cap upstream (see MAX_PARSE_DEPTH).
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isPlainObject(value)) return value;
  // Null-prototype target: a mint may send `__proto__` as a key, and plain assignment would hit the
  // prototype setter and reparent the object rather than copy the member.
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    out[key] = sortKeys(value[key]);
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
