import { CTSError } from '../model/Errors';

import { JSONInt } from './JSONInt';

/**
 * Serializes an already-parsed JSON value to its RFC 8785 (JCS) canonical form.
 *
 * @remarks
 * Escaping and number formatting come from {@link JSONInt}, so an integer past the safe range keeps
 * its digits instead of throwing as `JSON.stringify` would. Strict JCS rounds every number through
 * a double, so no peer can sign over such a value and be verified anyway.
 * @throws {@link CTSError} If the value has no JSON form (`undefined`, a function, a symbol) or
 *   contains a circular reference.
 */
export function canonicalizeJson(value: unknown): string {
  const json = serialize(value, new WeakSet());
  if (json === undefined) {
    throw new CTSError('canonicalizeJson: value has no JSON representation');
  }
  return json;
}

// Serializes members straight from the sorted key list rather than rebuilding a sorted object:
// JS enumerates integer-like keys (NUT numbers: '4', '10', ...) numerically regardless of
// insertion order, which silently breaks JCS's UTF-16 ordering. Only plain objects and arrays are
// walked; anything else (Amount, Date) stays a leaf for JSONInt to serialize.
function serialize(value: unknown, seen: WeakSet<object>): string | undefined {
  if (Array.isArray(value)) {
    guardCircular(seen, value);
    const out = '[' + value.map((v) => serialize(v, seen) ?? 'null').join(',') + ']';
    seen.delete(value);
    return out;
  }
  if (isPlainObject(value)) {
    guardCircular(seen, value);
    const parts: string[] = [];
    // Default sort() compares UTF-16 code units, exactly the JCS member order.
    for (const key of Object.keys(value).sort()) {
      const member = serialize(value[key], seen);
      if (member !== undefined) parts.push(`${JSONInt.stringify(key)}:${member}`);
    }
    seen.delete(value);
    return '{' + parts.join(',') + '}';
  }
  return JSONInt.stringify(value);
}

function guardCircular(seen: WeakSet<object>, value: object): void {
  if (seen.has(value)) throw new CTSError('canonicalizeJson: circular reference');
  seen.add(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
