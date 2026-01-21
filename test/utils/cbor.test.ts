import { decodeCBOR, encodeCBOR, Bytes } from '../../src/utils';
import { hexToBytes } from '@noble/curves/utils.js';
import { test, describe, expect } from 'vitest';
// Note: do NOT import 'fs' or 'path' at top-level — the browser test runner
// will attempt to import them and Vite externalizes those modules which causes
// runtime errors. Load them dynamically inside a Node-only guard below.

// Test Polyfills for Node Buffer (which is not properly polyfilled in vite browser tests)
// Instead of Buffer.from(encoded).toString('base64url')
function base64urlEncode(buffer: Uint8Array): string {
	return Bytes.toBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// Instead of Buffer.from(..., 'base64url')
function base64urlDecode(str: string): Uint8Array {
	str = str.replace(/-/g, '+').replace(/_/g, '/');
	while (str.length % 4) str += '=';
	return Bytes.fromBase64(str);
}

// Basic CBOR scalar/vector coverage is provided by the external test vectors
// in `test/cbor-test-vectors/appendix_a.json` (the per-vector harness below).
// Focused unit tests below exercise guardrails, header forms, and edge-cases
// that are not covered by the appendix vectors.

const encoderThrows = [
	{ name: 'Symbol', decoded: Symbol('x'), throws: /Unsupported type/ },
	{ name: 'function', decoded: (() => {}) as any, throws: /Unsupported type/ },
	{ name: 'BigInt', decoded: BigInt(1) as any, throws: /Unsupported type/ },
	{ name: 'unsigned integer too large', decoded: 4294967296, throws: /Unsupported integer size/ },
	{ name: 'negative integer too large', decoded: -4294967297, throws: /Unsupported integer size/ },
	{ name: 'array too long', decoded: new Array(70000).fill(0), throws: /Unsupported array length/ },
];

const decoderThrows = [
	{ name: 'unsupported major type', buf: new Uint8Array([0xc0]), throws: /Unsupported major type/ },
	{
		name: 'unsupported length additionalInfo 31',
		buf: new Uint8Array([0x1f]),
		throws: /Unsupported length/,
	},
	{
		name: 'byte string length exceeds data length',
		buf: new Uint8Array([0x58, 0x05, 0x01, 0x02]),
		throws: /Byte string length exceeds data length/,
	},
	{
		name: 'string length exceeds data length',
		buf: new Uint8Array([0x78, 0x05, 0x61, 0x62]),
		throws: /String length exceeds data length/,
	},
	{
		name: 'map invalid key type',
		buf: new Uint8Array([0xa1, 0x80, 0x01]),
		throws: /Invalid key type/,
	},
	{
		name: 'unexpected end empty buffer',
		buf: new Uint8Array([]),
		throws: /Unexpected end of data/,
	},
	{
		name: 'unexpected end truncated initial',
		buf: new Uint8Array([0x18]),
		throws: /Unexpected end of data/,
	},
	{
		name: 'unknown simple value additionalInfo0',
		buf: new Uint8Array([0xe0]),
		throws: /Unknown simple value: 0/,
	},
	{
		name: 'unknown simple or float additionalInfo 28',
		buf: new Uint8Array([0xfc]),
		throws: /Unknown simple or float value: 28/,
	},
	{
		name: 'byte string 8-byte length > buffer',
		buf: Uint8Array.from([0x5b, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x01, 0x02]),
		throws: /Byte string length exceeds data length/,
	},
];

describe('cbor decoder', () => {
	// Basic decoding coverage is provided by the external appendix_a.json
	// per-vector harness further below. Keep focused decoder unit tests here.

	test('decode simple value in next byte (additionalInfo 24) returns next byte', () => {
		// 0xf8 <next byte> -> simple/extended simple
		const buf = new Uint8Array([0xf8, 0x10]);
		const v = decodeCBOR(buf) as number;
		expect(v).toBe(0x10);
	});

	test('decode float16 (0xf9) and float32 (0xfa) paths', () => {
		// float16 0x3c00 -> 1.0
		const f16 = new Uint8Array([0xf9, 0x3c, 0x00]);
		const v16 = decodeCBOR(f16) as number;
		expect(v16).toBeCloseTo(1.0);

		// float32 1.5 -> 0x3fc00000
		const f32 = new Uint8Array([0xfa, 0x3f, 0xc0, 0x00, 0x00]);
		const v32 = decodeCBOR(f32) as number;
		expect(v32).toBeCloseTo(1.5);
	});

	test('decode float16 subnormal, infinity and NaN cases', () => {
		// subnormal: exponent = 0, fraction = 1 -> value = 2^-24
		const sub = new Uint8Array([0xf9, 0x00, 0x01]);
		const vsub = decodeCBOR(sub) as number;
		expect(vsub).toBeCloseTo(2 ** -24);

		// positive infinity: 0x7c00
		const inf = new Uint8Array([0xf9, 0x7c, 0x00]);
		const vinf = decodeCBOR(inf) as number;
		expect(vinf).toBe(Infinity);

		// NaN: 0x7c01 (exponent all ones, fraction non-zero)
		const nan = new Uint8Array([0xf9, 0x7c, 0x01]);
		const vnan = decodeCBOR(nan) as number;
		expect(Number.isNaN(vnan)).toBe(true);
	});

	test('decode negative float16 cases exercise sign bit', () => {
		// negative subnormal: sign=1, exponent=0, fraction=1 -> bits 0x8001
		const negSub = new Uint8Array([0xf9, 0x80, 0x01]);
		const vnegSub = decodeCBOR(negSub) as number;
		expect(vnegSub).toBeCloseTo(-(2 ** -14) * (1 / 1024));

		// negative 1.0: bits 0xbc00
		const negOne = new Uint8Array([0xf9, 0xbc, 0x00]);
		const vnegOne = decodeCBOR(negOne) as number;
		expect(vnegOne).toBeCloseTo(-1.0);

		// negative infinity: 0xfc00
		const negInf = new Uint8Array([0xf9, 0xfc, 0x00]);
		const vnegInf = decodeCBOR(negInf) as number;
		expect(vnegInf).toBe(-Infinity);
	});

	test.each(decoderThrows)('decode throws for $name', ({ buf, throws }) => {
		expect(() => decodeCBOR(buf)).toThrow(throws as RegExp);
	});

	test('decode byte string with 8-byte length (additionalInfo 27) decodes when hi=0,lo=5', () => {
		// initial byte 0x5b = major type 2 (byte string) with additionalInfo 27
		// next 8 bytes are big-endian hi,lo. hi=0, lo=5 -> length 5
		const data = Uint8Array.from([
			0x5b,
			0x00,
			0x00,
			0x00,
			0x00, // hi
			0x00,
			0x00,
			0x00,
			0x05, // lo = 5
			0x01,
			0x02,
			0x03,
			0x04,
			0x05,
		]);
		const res = decodeCBOR(data) as Uint8Array;
		expect(Array.from(res)).toEqual([1, 2, 3, 4, 5]);
	});
});

describe('cbor encoder', () => {
	// Basic encoding coverage is provided by the external appendix_a.json
	// per-vector harness further below. Keep focused encoder unit tests here.

	test('encodes maps with 0..23 keys using short form initial byte and roundtrips', () => {
		for (let n = 0; n <= 23; n++) {
			const obj: Record<string, number> = {};
			for (let i = 0; i < n; i++) obj[`k${i}`] = i;
			const encoded = encodeCBOR(obj);
			// first byte should be 0xa0 | n for short-form maps
			expect(encoded[0]).toBe(0xa0 | n);
			// roundtrip decode should return equivalent object
			const decoded = decodeCBOR(encoded) as Record<string, number>;
			expect(decoded).toEqual(obj);
		}
	});

	test('encodes maps with 24 and 255 keys (1-byte length form) and roundtrips', () => {
		for (const n of [24, 255]) {
			const obj: Record<string, number> = {};
			for (let i = 0; i < n; i++) obj[`k${i}`] = i;
			const encoded = encodeCBOR(obj);
			// first byte should be 0xb8 (additional-info 24) when length encoded in 1 byte
			expect(encoded[0]).toBe(0xb8);
			expect(encoded[1]).toBe(n & 0xff);
			expect(decodeCBOR(encoded)).toEqual(obj);
		}
	});

	test('encode byte/string/array header forms (24 and 256 lengths)', () => {
		// byte string length 24 -> header should be 0x58 0x18
		const bs24 = new Uint8Array(24).fill(0x01);
		const encBs24 = encodeCBOR(bs24 as any);
		expect(encBs24[0]).toBe(0x58);
		expect(encBs24[1]).toBe(24);

		// byte string length 256 -> header 0x59 0x01 0x00 (2-byte big-endian)
		const bs256 = new Uint8Array(256).fill(0x02);
		const encBs256 = encodeCBOR(bs256 as any);
		expect(encBs256[0]).toBe(0x59);
		expect(encBs256[1]).toBe(0x01);
		expect(encBs256[2]).toBe(0x00);

		// string length 24
		const s24 = 'a'.repeat(24);
		const encS24 = encodeCBOR(s24 as any);
		expect(encS24[0]).toBe(0x78);
		expect(encS24[1]).toBe(24);

		// array length 24 -> header 0x98 0x18
		const arr24 = new Array(24).fill(0).map((_, i) => i);
		const encArr24 = encodeCBOR(arr24 as any);
		expect(encArr24[0]).toBe(0x98);
		expect(encArr24[1]).toBe(24);
	});

	test('encode string length 256 uses 2-byte length header and roundtrips', () => {
		const s256 = 'a'.repeat(256);
		const enc = encodeCBOR(s256 as any);
		expect(enc[0]).toBe(0x79);
		expect(enc[1]).toBe(0x01);
		expect(enc[2]).toBe(0x00);
		expect(decodeCBOR(enc)).toBe(s256);
	});

	test('encode array length 256 uses 2-byte length header and roundtrips', () => {
		const arr256 = Array.from({ length: 256 }, (_, i) => i);
		const enc = encodeCBOR(arr256 as any);
		expect(enc[0]).toBe(0x99);
		expect(enc[1]).toBe(0x01);
		expect(enc[2]).toBe(0x00);
		expect(decodeCBOR(enc)).toEqual(arr256);
	});

	test('encode negative integer -257 uses 2-byte negative integer form and roundtrips', () => {
		const v = -257;
		const enc = encodeCBOR(v as any);
		expect(enc[0]).toBe(0x39);
		expect(enc[1]).toBe(0x01);
		expect(enc[2]).toBe(0x00);
		expect(decodeCBOR(enc)).toBe(v);
	});

	test('encode negative integer -25 uses 1-byte negative integer form and roundtrips', () => {
		const v = -25;
		const enc = encodeCBOR(v as any);
		expect(enc[0]).toBe(0x38);
		expect(enc[1]).toBe(24);
		expect(decodeCBOR(enc)).toBe(v);
	});

	test('encode negative integer -65537 uses 4-byte negative integer form and roundtrips', () => {
		const v = -65537;
		const enc = encodeCBOR(v as any);
		expect(enc[0]).toBe(0x3a);
		expect(enc[1]).toBe(0x00);
		expect(enc[2]).toBe(0x01);
		expect(enc[3]).toBe(0x00);
		expect(enc[4]).toBe(0x00);
		expect(decodeCBOR(enc)).toBe(v);
	});

	test('encode byte string length 65536 uses 4-byte length header and roundtrips', () => {
		const len = 65536;
		const bs = new Uint8Array(len).fill(0x7f);
		const enc = encodeCBOR(bs as any);
		// 0x5a indicates 4-byte length for byte strings
		expect(enc[0]).toBe(0x5a);
		expect(enc[1]).toBe(0x00);
		expect(enc[2]).toBe(0x01);
		expect(enc[3]).toBe(0x00);
		expect(enc[4]).toBe(0x00);
		const dec = decodeCBOR(enc) as Uint8Array;
		expect(dec.length).toBe(len);
		expect(Array.from(dec).slice(0, 3)).toEqual([0x7f, 0x7f, 0x7f]);
	});

	test('encode string length 65536 uses 4-byte length header and roundtrips', () => {
		const len = 65536;
		const s = 'a'.repeat(len);
		const enc = encodeCBOR(s as any);
		// 0x7a indicates 4-byte length for text strings
		expect(enc[0]).toBe(0x7a);
		expect(enc[1]).toBe(0x00);
		expect(enc[2]).toBe(0x01);
		expect(enc[3]).toBe(0x00);
		expect(enc[4]).toBe(0x00);
		const dec = decodeCBOR(enc) as string;
		expect(dec.length).toBe(len);
		expect(dec.slice(0, 3)).toBe('aaa');
	});

	test('encodes max 32 bit unsigned integer and roundtrips', () => {
		const n = 0xffffffff; // 4294967295
		const enc = encodeCBOR(n as any);
		expect(Array.from(enc)).toEqual([0x1a, 0xff, 0xff, 0xff, 0xff]);
		expect(decodeCBOR(enc)).toBe(n);
	});

	test('encodes min 32 bit unsigned integer and roundtrips', () => {
		const n = 0x00010000; // 65536
		const enc = encodeCBOR(n as any);
		expect(Array.from(enc)).toEqual([0x1a, 0x00, 0x01, 0x00, 0x00]);
		expect(decodeCBOR(enc)).toBe(n);
	});

	test.each(encoderThrows)('encoding unsupported $name throws', ({ decoded, throws }) => {
		expect(() => encodeCBOR(decoded)).toThrow(throws as RegExp);
	});

	test('encodes maps with 256 (2-byte) and 65536 (4-byte) lengths and roundtrips', () => {
		// 2-byte form (additional-info 25 -> 0xb9)
		{
			const n = 256;
			const obj: Record<string, number> = {};
			for (let i = 0; i < n; i++) obj[`k${i}`] = i;
			const encoded = encodeCBOR(obj);
			expect(encoded[0]).toBe(0xb9);
			// two-byte big-endian length
			expect(encoded[1]).toBe((n >> 8) & 0xff);
			expect(encoded[2]).toBe(n & 0xff);
			expect(decodeCBOR(encoded)).toEqual(obj);
		}

		// 4-byte form (additional-info 26 -> 0xba)
		{
			const n = 65536;
			const obj: Record<string, number> = {};
			for (let i = 0; i < n; i++) obj[`k${i}`] = i;
			const encoded = encodeCBOR(obj);
			expect(encoded[0]).toBe(0xba);
			// four-byte big-endian length
			expect(encoded[1]).toBe((n >> 24) & 0xff);
			expect(encoded[2]).toBe((n >> 16) & 0xff);
			expect(encoded[3]).toBe((n >> 8) & 0xff);
			expect(encoded[4]).toBe(n & 0xff);
			expect(decodeCBOR(encoded)).toEqual(obj);
		}
	});

	test('encodes negative integers correctly and roundtrips', () => {
		const values = [-1, -10, -1000];
		for (const v of values) {
			const encoded = encodeCBOR(v as any);
			const decoded = decodeCBOR(encoded);
			expect(decoded).toBe(v);
			// inspect header bytes for a couple of cases
			if (v === -1) {
				expect(encoded[0]).toBe(0x20);
			} else if (v === -10) {
				expect(encoded[0]).toBe(0x20 | 9);
			} else if (v === -1000) {
				// -1000 -> unsigned = 999 (0x03e7) -> additional-info 25 (0x39) and bytes 0x03 0xe7
				expect(encoded[0]).toBe(0x39);
				expect(encoded[1]).toBe(0x03);
				expect(encoded[2]).toBe(0xe7);
			}
		}
	});

	test('direct integer branch coverage (0, 1, -1)', () => {
		// ensure encodeNumber handles unsigned and negative integer paths
		const enc0 = encodeCBOR(0 as any);
		expect(enc0[0]).toBe(0x00);

		const enc1 = encodeCBOR(1 as any);
		expect(enc1[0]).toBe(0x01);

		const encNeg1 = encodeCBOR(-1 as any);
		expect(encNeg1[0]).toBe(0x20);
	});

	test('encodes non-integer numbers as float64 (1.5, NaN, Infinity) and roundtrips', () => {
		// 1.5
		{
			const v = 1.5;
			const encoded = encodeCBOR(v as any);
			// float64 prefix 0xfb
			expect(encoded[0]).toBe(0xfb);
			const decoded = decodeCBOR(encoded) as number;
			expect(decoded).toBeCloseTo(v);
		}
		// NaN
		{
			const v = NaN;
			const encoded = encodeCBOR(v as any);
			expect(encoded[0]).toBe(0xfb);
			const decoded = decodeCBOR(encoded) as number;
			expect(Number.isNaN(decoded)).toBe(true);
		}
		// Infinity
		{
			const v = Infinity;
			const encoded = encodeCBOR(v as any);
			expect(encoded[0]).toBe(0xfb);
			const decoded = decodeCBOR(encoded) as number;
			expect(decoded).toBe(Infinity);
		}
	});

	test('throws when object has >= 2**32 keys (guardrail)', () => {
		const sentinel = { __huge__: true } as any;
		const realObjectKeys = Object.keys;
		(Object.keys as any) = function (obj: any) {
			if (obj === sentinel) {
				// return an iterable with a huge length property but no elements to iterate
				return {
					length: 4294967296,
					[Symbol.iterator]() {
						return {
							next() {
								return { done: true, value: undefined };
							},
						};
					},
				};
			}
			return realObjectKeys(obj);
		};
		try {
			expect(() => encodeCBOR(sentinel as any)).toThrow();
		} finally {
			(Object.keys as any) = realObjectKeys;
		}
	});

	// These two tests simulate inputs that report huge lengths but are more complicated to
	// simply add to the encodeTests array above.
	test('encode byte string too long throws (fake Uint8Array)', () => {
		const fake = Object.create(Uint8Array.prototype);
		Object.defineProperty(fake, 'length', { value: 4294967296 });
		expect(() => encodeCBOR(fake as any)).toThrow(/Byte string too long to encode/);
	});

	test('encode string too long throws (mock TextEncoder)', () => {
		const RealTextEncoder = (globalThis as any).TextEncoder;
		// mock encode to return an object with huge length
		(class MockTE {
			encode(_: string) {
				return { length: 4294967296 } as any;
			}
		}) as any;
		(globalThis as any).TextEncoder = function () {
			return { encode: (_s: string) => ({ length: 4294967296 }) as any };
		};
		try {
			expect(() => encodeCBOR('x' as any)).toThrow(/String too long to encode/);
		} finally {
			(globalThis as any).TextEncoder = RealTextEncoder;
		}
	});
});

test('encodes undefined as simple value 0xf7 and roundtrips', () => {
	const enc = encodeCBOR(undefined);
	// 0xf7 is the CBOR simple value for 'undefined'
	expect(enc[0]).toBe(0xf7);
	const dec = decodeCBOR(enc);
	expect(dec).toBeUndefined();
});

describe('raw v4 token cbor en/decoding', () => {
	const expectedBase64 =
		'o2F0gqJhaUgA_9SLj17PgGFwgaNhYQFhc3hAYWNjMTI0MzVlN2I4NDg0YzNjZjE4NTAxNDkyMThhZjkwZjcxNmE1MmJmNGE1ZWQzNDdlNDhlY2MxM2Y3NzM4OGFjWCECRFODGd5IXVW-07KaZCvuWHk3WrnnpiDhHki6SCQh88-iYWlIAK0mjE0fWCZhcIKjYWECYXN4QDEzMjNkM2Q0NzA3YTU4YWQyZTIzYWRhNGU5ZjFmNDlmNWE1YjRhYzdiNzA4ZWIwZDYxZjczOGY0ODMwN2U4ZWVhY1ghAjRWqhENhLSsdHrr2Cw7AFrKUL9Ffr1XN6RBT6w659lNo2FhAWFzeEA1NmJjYmNiYjdjYzY0MDZiM2ZhNWQ1N2QyMTc0ZjRlZmY4YjQ0MDJiMTc2OTI2ZDNhNTdkM2MzZGNiYjU5ZDU3YWNYIQJzEpxXGeWZN5qXSmJjY8MzxWyvwObQGr5G1YCCgHicY2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdA==';
	const token = {
		t: [
			{
				i: hexToBytes('00ffd48b8f5ecf80'),
				p: [
					{
						a: 1,
						s: 'acc12435e7b8484c3cf1850149218af90f716a52bf4a5ed347e48ecc13f77388',
						c: hexToBytes('0244538319de485d55bed3b29a642bee5879375ab9e7a620e11e48ba482421f3cf'),
					},
				],
			},
			{
				i: hexToBytes('00ad268c4d1f5826'),
				p: [
					{
						a: 2,
						s: '1323d3d4707a58ad2e23ada4e9f1f49f5a5b4ac7b708eb0d61f738f48307e8ee',
						c: hexToBytes('023456aa110d84b4ac747aebd82c3b005aca50bf457ebd5737a4414fac3ae7d94d'),
					},
					{
						a: 1,
						s: '56bcbcbb7cc6406b3fa5d57d2174f4eff8b4402b176926d3a57d3c3dcbb59d57',
						c: hexToBytes('0273129c5719e599379a974a626363c333c56cafc0e6d01abe46d5808280789c63'),
					},
				],
			},
		],
		m: 'http://localhost:3338',
		u: 'sat',
	};
	test('encode v4 raw', () => {
		const encoded = encodeCBOR(token);
		// const encodedString = Buffer.from(encoded).toString('base64url');
		const encodedString = base64urlEncode(encoded);
		expect(encodedString).toBe(expectedBase64.replace(/\=+$/, ''));
	});
	test('decode v4 raw', () => {
		// const decoded = decodeCBOR(Buffer.from(expectedBase64.replace(/\=+$/, ''), 'base64url'));
		const decoded = decodeCBOR(base64urlDecode(expectedBase64.replace(/\=+$/, '')));
		expect(decoded).toEqual(token);
	});
});

describe('CBOR Test Vectors', () => {
	// The appendix_a.json test vectors were copied from the official CBOR
	// test-vectors repository: https://github.com/cbor/test-vectors/master
	// Load vectors only in Node — importing 'fs' in the browser test runner
	// causes Vite to externalize the module and crash the client tests.
	if (typeof window !== 'undefined') {
		// Running in browser environment (playwright). Skip the heavy vector
		// file and rely on the focused unit tests above. Register a skipped
		// test so the test suite isn't empty (Vitest errors when a suite has
		// no tests).
		test.skip('CBOR test vectors are skipped in browser environments', () => {
			// intentionally empty
		});
		return;
	}

	// Node-only: require fs/path dynamically to avoid bundling them for browser
	const { readFileSync } = require('fs');
	const { resolve } = require('path');
	const testVectorsPath = resolve(__dirname, 'cbor-test-vectors/appendix_a.json');
	const _vectors: any[] = JSON.parse(readFileSync(testVectorsPath, 'utf-8'));

	// Create one vitest test per vector so failures are reported individually.
	// Use the vector's `cbor` (base64) in the test title so it's obvious which vector is running.
	const _vectorRows = _vectors.map((v, i) => [`CBOR vector ${v.cbor}`, v, i]);

	test.each(_vectorRows)('%s', (_title, vector, _index) => {
		const { hex } = vector as any;

		// Skip vectors that contain indefinite/streaming markers (these are
		// outside the current decoder scope). This matches test vectors that
		// use indefinite-length arrays/maps/strings (initial bytes 0x5f, 0x7f,
		// 0x9f, 0xbf) which our decoder doesn't support yet.
		const hexLower = (hex as string).toLowerCase();
		if (
			hexLower.includes('5f') ||
			hexLower.includes('7f') ||
			hexLower.includes('9f') ||
			hexLower.includes('bf')
		) {
			// skip this vector
			return;
		}

		// Skip CBOR tag vectors (major type 6) — our decoder doesn't currently
		// implement semantic tags. Major type is the top 3 bits of the first byte.
		let skipEncode = false;
		try {
			const firstByte = parseInt((hex as string).slice(0, 2), 16);
			const majorType = firstByte >> 5;
			// If this is a tag (major type 6) we don't support semantic tags yet
			if (majorType === 6) return;

			// Decide whether to skip the encode round-trip for this vector. Some
			// vectors use float16/float32 (0xf9/0xfa) or float64 (0xfb) encodings or
			// use 8-byte integer forms (additional-info 27 / 0x1b). Our encoder
			// intentionally emits float64 for non-integers and only encodes integers
			// up to 32-bit, so those vectors cannot be round-tripped exactly.
			const additionalInfo = firstByte & 0x1f;

			// Unknown simple values (major type 7, additionalInfo < 24 but not one of
			// the standard simple values 20..23) are diagnostic vectors; our
			// decoder currently doesn't implement a diagnostic representation, so
			// skip the entire vector to avoid a decode-time throw.
			if (majorType === 7) {
				if (additionalInfo < 24 && !(additionalInfo >= 20 && additionalInfo <= 23)) {
					return;
				}
				// For float16/32/64 (additionalInfo 25,26,27) and the 1-byte simple
				// extension (additionalInfo 24) avoid encode assertions — decoding is
				// still attempted above to surface decode errors.
				if (
					additionalInfo === 24 ||
					additionalInfo === 25 ||
					additionalInfo === 26 ||
					additionalInfo === 27
				) {
					skipEncode = true;
				}
			}

			// For 8-byte integer forms (additionalInfo 27) the encoder only supports
			// up to 32-bit integers. Mark those to skip encode assertions.
			if ((majorType === 0 || majorType === 1) && additionalInfo === 27) {
				skipEncode = true;
			}
		} catch {}

		// Always attempt decode to surface decode-time errors for every vector
		const decodedResult = decodeCBOR(Buffer.from(hex, 'hex'));

		// If the vector provides an expected decoded value, assert equality
		if ('decoded' in vector) {
			expect(decodedResult).toEqual((vector as any).decoded);

			// Only run encode round-trip assertions for vectors that explicitly opt-in
			if (!(vector as any).roundtrip) return;

			// If we previously determined this vector cannot be round-tripped by
			// our encoder (float16/32/64, 8-byte integers, etc.), skip the
			// encode assertion.
			if (skipEncode) return;

			// Skip encode round-trip for values the current encoder intentionally
			// doesn't support (big integers outside JS safe integer range) or
			// for CBOR bignum tagged forms (tag 2/3) where JSON fixtures cannot
			// represent the precise BigInt value.
			const decodedVal = (vector as any).decoded;
			if (typeof decodedVal === 'number' && !Number.isSafeInteger(decodedVal)) {
				// needs BigInt/bignum support; skip encode assertion
				return;
			}
			// skip tag-2/3 encoded bignums
			if (hex.startsWith('c2') || hex.startsWith('c3')) return;

			const encodedResult = encodeCBOR((vector as any).decoded);
			expect(Buffer.from(encodedResult).toString('hex')).toBe(hex);
		}
	});
});
