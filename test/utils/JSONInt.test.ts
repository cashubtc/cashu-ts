import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parse, stringify } from '../../src/utils/JSONInt';

describe('bigint support baseline', () => {
	const input = '{"big":9223372036854775807,"small":123}';

	test('classic JSON.parse lacks bigint precision', () => {
		const obj = JSON.parse(input) as { big: number; small: number };
		expect(obj.small.toString()).toBe('123');
		expect(obj.big.toString()).not.toBe('9223372036854775807');

		const output = JSON.stringify(obj);
		expect(output).not.toBe(input);
	});
});

describe('native BigInt support: parse', () => {
	const input = '{"big":92233720368547758070,"small":123}';

	test('parses oversized integer tokens as bigint', () => {
		const obj = parse(input) as { big: bigint; small: number };
		expect(obj.small).toBe(123);
		expect(obj.big.toString()).toBe('92233720368547758070');
		expect(typeof obj.big).toBe('bigint');
	});

	test('supports parse/stringify roundtrip', () => {
		const obj = parse(input);
		const output = stringify(obj);
		expect(output).toBe(input);
	});

	test('supports long floats', () => {
		const obj = parse('{"float":0.333333333333333333333333333333333333333333333333}') as {
			float: number;
		};
		expect(obj.float).toBe(0.3333333333333333);
	});
});

describe('native BigInt support: stringify', () => {
	test('stringifies native BigInt values as JSON number tokens', () => {
		const obj = {
			big: BigInt('123456789012345678901234567890'),
			small: -42,
			bigConstructed: BigInt(1),
			smallConstructed: Number(2),
		};

		expect(obj.small.toString()).toBe('-42');
		expect(obj.big.toString()).toBe('123456789012345678901234567890');
		expect(typeof obj.big).toBe('bigint');

		const output = stringify(obj);
		expect(output).toBe(
			'{"big":123456789012345678901234567890,"small":-42,"bigConstructed":1,"smallConstructed":2}',
		);
	});

	test('stringifies arrays with undefined as null', () => {
		const output = stringify([1, undefined, 3]);
		expect(output).toBe('[1,null,3]');
	});

	test('stringifies objects dropping undefined values', () => {
		const output = stringify({ a: 1, b: undefined, c: 3 });
		expect(output).toBe('{"a":1,"c":3}');
	});

	test('respects toJSON output', () => {
		const output = stringify({ value: { toJSON: () => 'ok' } });
		expect(output).toBe('{"value":"ok"}');
	});

	test('supports replacer array and pretty spacing', () => {
		const output = stringify({ a: 1, b: 2, c: 3 }, ['b', 'c'], 2);
		expect(output).toBe('{\n  "b": 2,\n  "c": 3\n}');
	});

	test('supports replacer function for filtering', () => {
		const output = stringify({ a: 1, b: 2 }, (key, value) => (key === 'b' ? undefined : value));
		expect(output).toBe('{"a":1}');
	});

	test('throws TypeError on circular references', () => {
		const obj: { self?: unknown } = {};
		obj.self = obj;

		expect(() => stringify(obj)).toThrow(TypeError);
		expect(() => stringify(obj)).toThrow('Converting circular structure to JSON');
	});
});

describe('parse option: strict', () => {
	const dupkeys = '{ "dupkey": "value 1", "dupkey": "value 2"}';

	test('duplicate keys overwrite by default', () => {
		let result: unknown = 'before';
		const tryParse = () => {
			result = parse(dupkeys);
		};
		expect(tryParse).not.toThrow();
		expect((result as { dupkey: string }).dupkey).toBe('value 2');
	});

	test('strict=true fails fast on duplicate keys', () => {
		let result: unknown = 'before';
		const tryParse = () => {
			result = parse(dupkeys, undefined, { strict: true });
		};

		expect(tryParse).toThrow('Duplicate key "dupkey"');
		expect(result).toBe('before');
	});
});

describe('parse option: fallbackTo', () => {
	const input = '{ "key": 12345678901234567 }';
	const originalBigInt = globalThis.BigInt;

	beforeAll(() => {
		Object.defineProperty(globalThis, 'BigInt', {
			configurable: true,
			writable: true,
			value: undefined,
		});
	});

	afterAll(() => {
		Object.defineProperty(globalThis, 'BigInt', {
			configurable: true,
			writable: true,
			value: originalBigInt,
		});
	});

	test('defaults to number when BigInt is unavailable', () => {
		const result = parse(input) as { key: number };
		expect(typeof result.key).toBe('number');
		expect(result.key).toBe(12345678901234567);
	});

	test('returns string when fallbackTo=string', () => {
		const result = parse(input, undefined, { fallbackTo: 'string' }) as {
			key: string;
		};
		expect(typeof result.key).toBe('string');
		expect(result.key).toBe('12345678901234567');
	});

	test('throws when fallbackTo=error', () => {
		expect(() => {
			parse(input, undefined, { fallbackTo: 'error' });
		}).toThrow();
	});

	test('throws when fallbackTo has invalid value', () => {
		expect(() => {
			parse(input, undefined, { fallbackTo: 'nope' as never });
		}).toThrow('Incorrect value for fallbackTo option');
	});
});

describe('__proto__ and constructor assignment', () => {
	test('sets __proto__ property without changing object prototype', () => {
		const obj1 = parse('{ "__proto__": 1000000000000000 }') as Record<string, unknown>;
		expect(Object.getPrototypeOf(obj1)).toBe(Object.prototype);

		const obj2 = parse('{ "__proto__": { "admin": true } }') as {
			admin?: boolean;
		};
		expect(obj2.admin).not.toBe(true);
	});
});

describe('parse errors', () => {
	test('rejects invalid escape sequences', () => {
		expect(() => parse('"\\x"')).toThrow('Invalid escape');
	});

	test('rejects invalid unicode escapes', () => {
		expect(() => parse('"\\u12G4"')).toThrow('Invalid unicode escape');
	});

	test('rejects unterminated strings', () => {
		expect(() => parse('"unterminated')).toThrow('Unterminated string');
	});

	test('rejects unterminated arrays', () => {
		expect(() => parse('[1, 2')).toThrow("Expected ','");
	});

	test('rejects unterminated objects', () => {
		expect(() => parse('{"a": 1')).toThrow("Expected ','");
	});

	test('rejects bad number tokens', () => {
		expect(() => parse('-')).toThrow('Bad number');
		expect(() => parse('1e+')).toThrow('Bad number');
	});

	test('rejects trailing input', () => {
		expect(() => parse('true false')).toThrow('Unexpected trailing input');
	});
});

describe('reviver behavior', () => {
	test('reviver can drop object properties', () => {
		const out = parse('{"a":1,"b":2}', (key, value) => (key === 'b' ? undefined : value));
		expect(out).toEqual({ a: 1 });
	});

	test('reviver can transform array entries', () => {
		const out = parse('[1,2,3]', (key, value) => (key === '1' ? 20 : value));
		expect(out).toEqual([1, 20, 3]);
	});

	test('reviver can delete array entries', () => {
		const out = parse('[1,2,3]', (key, value) => (key === '1' ? undefined : value)) as number[];
		expect(out.length).toBe(3);
		expect(1 in out).toBe(false);
	});
});
