import { describe, expect, it } from 'vitest';

import { CTSError } from '../../src/model/Errors';
import { canonicalizeJson } from '../../src/utils/canonicalJson';
import { JSONInt } from '../../src/utils/JSONInt';

describe('canonicalizeJson', () => {
  it('sorts object keys by UTF-16 code unit, at every level', () => {
    // 'A' (0x41) < 'a' (0x61) < 'z' (0x7a) < 'é' (0xe9)
    const input = { é: 1, z: 2, a: { b: 1, A: 2 }, A: 3 };
    expect(canonicalizeJson(input)).toBe('{"A":3,"a":{"A":2,"b":1},"z":2,"é":1}');
  });

  it('sorts integer-like keys lexicographically, not numerically', () => {
    // JS object enumeration puts integer-like keys in numeric order; JCS must not.
    const nuts = { '4': 'a', '10': 'b', '17': 'c', '5': 'd' };
    expect(canonicalizeJson(nuts)).toBe('{"10":"b","17":"c","4":"a","5":"d"}');
  });

  it('keeps array order', () => {
    expect(canonicalizeJson([3, 1, { b: 1, a: 2 }])).toBe('[3,1,{"a":2,"b":1}]');
  });

  it('serializes numbers per ECMAScript, as RFC 8785 requires', () => {
    expect(canonicalizeJson([4.5, 1e30, 2e-3, 1e-27, 0, -0])).toBe('[4.5,1e+30,0.002,1e-27,0,0]');
  });

  it('keeps the digits of an integer past the safe range', () => {
    const parsed = JSONInt.parse('{"max_amount":18446744073709551615}');
    expect(canonicalizeJson(parsed)).toBe('{"max_amount":18446744073709551615}');
  });

  it('escapes strings per JSON', () => {
    expect(canonicalizeJson({ s: '\u20ac\u000f\n"\\/' })).toBe('{"s":"\u20ac\\u000f\\n\\"\\\\/"}');
  });

  it('copies a __proto__ member instead of reparenting the object', () => {
    const parsed = JSONInt.parse('{"a":1,"__proto__":{"polluted":true}}');
    expect(canonicalizeJson(parsed)).toBe('{"__proto__":{"polluted":true},"a":1}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('treats a null-prototype object as plain data', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { b: 1, a: 2 });
    expect(canonicalizeJson(bare)).toBe('{"a":2,"b":1}');
  });

  it('drops undefined members, matching JSON', () => {
    expect(canonicalizeJson({ b: undefined, a: 1 })).toBe('{"a":1}');
  });

  it('throws on a value with no JSON form', () => {
    expect(() => canonicalizeJson(undefined)).toThrow(CTSError);
  });
});
