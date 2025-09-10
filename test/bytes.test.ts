import { describe, test, expect } from 'vitest';
import { Bytes } from '../src/utils/Bytes';

describe('Bytes utility class', () => {
	describe('fromHex', () => {
		test('should convert valid hex string to Uint8Array', () => {
			const hex = 'deadbeef';
			const result = Bytes.fromHex(hex);
			const expected = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
			expect(result).toEqual(expected);
		});

		test('should handle hex string with 0x prefix', () => {
			const hex = '0xdeadbeef';
			const result = Bytes.fromHex(hex);
			const expected = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
			expect(result).toEqual(expected);
		});

		test('should handle hex string with 0X prefix', () => {
			const hex = '0Xdeadbeef';
			const result = Bytes.fromHex(hex);
			const expected = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
			expect(result).toEqual(expected);
		});

		test('should handle uppercase hex characters', () => {
			const hex = 'DEADBEEF';
			const result = Bytes.fromHex(hex);
			const expected = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
			expect(result).toEqual(expected);
		});

		test('should handle mixed case hex characters', () => {
			const hex = 'DeAdBeEf';
			const result = Bytes.fromHex(hex);
			const expected = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
			expect(result).toEqual(expected);
		});

		test('should handle empty string', () => {
			const hex = '';
			const result = Bytes.fromHex(hex);
			expect(result).toEqual(new Uint8Array(0));
		});

		test('should handle whitespace-only string', () => {
			const hex = '   ';
			const result = Bytes.fromHex(hex);
			expect(result).toEqual(new Uint8Array(0));
		});

		test('should handle hex string with leading/trailing whitespace', () => {
			const hex = '  deadbeef  ';
			const result = Bytes.fromHex(hex);
			const expected = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
			expect(result).toEqual(expected);
		});

		test('should handle single byte hex', () => {
			const hex = 'ff';
			const result = Bytes.fromHex(hex);
			const expected = new Uint8Array([0xff]);
			expect(result).toEqual(expected);
		});

		test('should handle zero bytes', () => {
			const hex = '0000';
			const result = Bytes.fromHex(hex);
			const expected = new Uint8Array([0x00, 0x00]);
			expect(result).toEqual(expected);
		});

		test('should throw error for odd length hex string', () => {
			const hex = 'deadbee';
			expect(() => Bytes.fromHex(hex)).toThrow('Invalid hex string: odd length.');
		});

		test('should throw error for single character', () => {
			const hex = 'f';
			expect(() => Bytes.fromHex(hex)).toThrow('Invalid hex string: odd length.');
		});

		test('should throw error for non-hex characters', () => {
			const hex = 'deadbeeg';
			expect(() => Bytes.fromHex(hex)).toThrow('Invalid hex string: contains non-hex characters');
		});

		test('should throw error for hex with special characters', () => {
			const hex = 'dead-beef';
			expect(() => Bytes.fromHex(hex)).toThrow('Invalid hex string: odd length.');
		});

		test('should throw error for hex with spaces in middle', () => {
			const hex = 'dead beef';
			expect(() => Bytes.fromHex(hex)).toThrow('Invalid hex string: odd length.');
		});
	});

	describe('toHex', () => {
		test('should convert Uint8Array to hex string', () => {
			const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
			const result = Bytes.toHex(bytes);
			expect(result).toBe('deadbeef');
		});

		test('should handle empty Uint8Array', () => {
			const bytes = new Uint8Array(0);
			const result = Bytes.toHex(bytes);
			expect(result).toBe('');
		});

		test('should handle single byte', () => {
			const bytes = new Uint8Array([0xff]);
			const result = Bytes.toHex(bytes);
			expect(result).toBe('ff');
		});

		test('should handle zero bytes', () => {
			const bytes = new Uint8Array([0x00, 0x00]);
			const result = Bytes.toHex(bytes);
			expect(result).toBe('0000');
		});

		test('should pad single digit hex values', () => {
			const bytes = new Uint8Array([0x01, 0x0a, 0x10]);
			const result = Bytes.toHex(bytes);
			expect(result).toBe('010a10');
		});

		test('should be consistent with fromHex', () => {
			const originalHex = 'deadbeef01234567';
			const bytes = Bytes.fromHex(originalHex);
			const resultHex = Bytes.toHex(bytes);
			expect(resultHex).toBe(originalHex);
		});
	});

	describe('fromString', () => {
		test('should convert string to Uint8Array', () => {
			const str = 'hello';
			const result = Bytes.fromString(str);
			const expected = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
			expect(result).toEqual(expected);
		});

		test('should handle empty string', () => {
			const str = '';
			const result = Bytes.fromString(str);
			expect(result).toEqual(new Uint8Array(0));
		});

		test('should handle unicode characters', () => {
			const str = '🚀';
			const result = Bytes.fromString(str);
			// UTF-8 encoding of rocket emoji
			const expected = new Uint8Array([0xf0, 0x9f, 0x9a, 0x80]);
			expect(result).toEqual(expected);
		});

		test('should handle whitespace-only string by trimming to empty', () => {
			const str = ' \t\n';
			const result = Bytes.fromString(str);
			expect(result).toEqual(new Uint8Array(0));
		});

		test('should preserve internal whitespace', () => {
			const str = 'hello world';
			const result = Bytes.fromString(str);
			const expected = new Uint8Array([
				0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64,
			]);
			expect(result).toEqual(expected);
		});

		test('should trim leading/trailing whitespace', () => {
			const str = '  hello  ';
			const result = Bytes.fromString(str);
			const expected = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
			expect(result).toEqual(expected);
		});

		test('should handle special characters', () => {
			const str = 'café';
			const result = Bytes.fromString(str);
			// UTF-8 encoding of café
			const expected = new Uint8Array([0x63, 0x61, 0x66, 0xc3, 0xa9]);
			expect(result).toEqual(expected);
		});
	});

	describe('toString', () => {
		test('should convert Uint8Array to string', () => {
			const bytes = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
			const result = Bytes.toString(bytes);
			expect(result).toBe('hello');
		});

		test('should handle empty Uint8Array', () => {
			const bytes = new Uint8Array(0);
			const result = Bytes.toString(bytes);
			expect(result).toBe('');
		});

		test('should handle unicode characters', () => {
			const bytes = new Uint8Array([0xf0, 0x9f, 0x9a, 0x80]);
			const result = Bytes.toString(bytes);
			expect(result).toBe('🚀');
		});

		test('should handle special characters', () => {
			const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xc3, 0xa9]);
			const result = Bytes.toString(bytes);
			expect(result).toBe('café');
		});

		test('should be consistent with fromString', () => {
			const originalStr = 'Hello, World! 🌍';
			const bytes = Bytes.fromString(originalStr);
			const resultStr = Bytes.toString(bytes);
			expect(resultStr).toBe(originalStr);
		});
	});

	describe('concat', () => {
		test('should concatenate multiple Uint8Arrays', () => {
			const arr1 = new Uint8Array([0x01, 0x02]);
			const arr2 = new Uint8Array([0x03, 0x04]);
			const arr3 = new Uint8Array([0x05, 0x06]);
			const result = Bytes.concat(arr1, arr2, arr3);
			const expected = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
			expect(result).toEqual(expected);
		});

		test('should handle empty arrays', () => {
			const arr1 = new Uint8Array([0x01, 0x02]);
			const arr2 = new Uint8Array(0);
			const arr3 = new Uint8Array([0x03, 0x04]);
			const result = Bytes.concat(arr1, arr2, arr3);
			const expected = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
			expect(result).toEqual(expected);
		});

		test('should handle single array', () => {
			const arr1 = new Uint8Array([0x01, 0x02, 0x03]);
			const result = Bytes.concat(arr1);
			expect(result).toEqual(arr1);
		});

		test('should handle no arrays', () => {
			const result = Bytes.concat();
			expect(result).toEqual(new Uint8Array(0));
		});

		test('should handle all empty arrays', () => {
			const arr1 = new Uint8Array(0);
			const arr2 = new Uint8Array(0);
			const result = Bytes.concat(arr1, arr2);
			expect(result).toEqual(new Uint8Array(0));
		});
	});

	describe('alloc', () => {
		test('should allocate Uint8Array of specified size', () => {
			const size = 10;
			const result = Bytes.alloc(size);
			expect(result).toBeInstanceOf(Uint8Array);
			expect(result.length).toBe(size);
			expect(result).toEqual(new Uint8Array(size));
		});

		test('should allocate zero-length array', () => {
			const result = Bytes.alloc(0);
			expect(result).toEqual(new Uint8Array(0));
		});

		test('should initialize with zeros', () => {
			const result = Bytes.alloc(5);
			const expected = new Uint8Array([0, 0, 0, 0, 0]);
			expect(result).toEqual(expected);
		});
	});

	describe('writeBigUint64BE', () => {
		test('should write bigint as big-endian bytes', () => {
			const value = 0x0123456789abcdefn;
			const result = Bytes.writeBigUint64BE(value);
			const expected = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);
			expect(result).toEqual(expected);
		});

		test('should handle zero value', () => {
			const value = 0n;
			const result = Bytes.writeBigUint64BE(value);
			const expected = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
			expect(result).toEqual(expected);
		});

		test('should handle maximum uint64 value', () => {
			const value = 0xffffffffffffffffn;
			const result = Bytes.writeBigUint64BE(value);
			const expected = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
			expect(result).toEqual(expected);
		});

		test('should handle small values', () => {
			const value = 0x42n;
			const result = Bytes.writeBigUint64BE(value);
			const expected = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x42]);
			expect(result).toEqual(expected);
		});
	});

	describe('toBase64', () => {
		test('should convert Uint8Array to base64', () => {
			const bytes = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
			const result = Bytes.toBase64(bytes);
			expect(result).toBe('aGVsbG8=');
		});

		test('should handle empty array', () => {
			const bytes = new Uint8Array(0);
			const result = Bytes.toBase64(bytes);
			expect(result).toBe('');
		});

		test('should handle single byte', () => {
			const bytes = new Uint8Array([0x61]);
			const result = Bytes.toBase64(bytes);
			expect(result).toBe('YQ==');
		});

		test('should handle binary data', () => {
			const bytes = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
			const result = Bytes.toBase64(bytes);
			expect(result).toBe('AAEC//79');
		});

		test('should handle large arrays (chunk processing)', () => {
			// create array larger than 32768 to test chunking
			const size = 40000;
			const bytes = new Uint8Array(size);
			for (let i = 0; i < size; i++) {
				bytes[i] = i % 256;
			}
			const result = Bytes.toBase64(bytes);
			expect(result).toBeDefined();
			expect(typeof result).toBe('string');
			expect(result.length % 4).toBe(0);
		});
	});

	describe('fromBase64', () => {
		test('should convert base64 to Uint8Array', () => {
			const base64 = 'aGVsbG8=';
			const result = Bytes.fromBase64(base64);
			const expected = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
			expect(result).toEqual(expected);
		});

		test('should handle empty string', () => {
			const base64 = '';
			const result = Bytes.fromBase64(base64);
			expect(result).toEqual(new Uint8Array(0));
		});

		test('should handle whitespace', () => {
			const base64 = '  aGVsbG8=  ';
			const result = Bytes.fromBase64(base64);
			const expected = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
			expect(result).toEqual(expected);
		});

		test('should handle binary data', () => {
			const base64 = 'AAEC//79';
			const result = Bytes.fromBase64(base64);
			const expected = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
			expect(result).toEqual(expected);
		});

		test('should be consistent with toBase64', () => {
			const originalBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x23, 0x45, 0x67]);
			const base64 = Bytes.toBase64(originalBytes);
			const resultBytes = Bytes.fromBase64(base64);
			expect(resultBytes).toEqual(originalBytes);
		});
	});

	describe('equals', () => {
		test('should return true for identical arrays', () => {
			const a = new Uint8Array([0x01, 0x02, 0x03]);
			const b = new Uint8Array([0x01, 0x02, 0x03]);
			expect(Bytes.equals(a, b)).toBe(true);
		});

		test('should return true for empty arrays', () => {
			const a = new Uint8Array(0);
			const b = new Uint8Array(0);
			expect(Bytes.equals(a, b)).toBe(true);
		});

		test('should return false for different content', () => {
			const a = new Uint8Array([0x01, 0x02, 0x03]);
			const b = new Uint8Array([0x01, 0x02, 0x04]);
			expect(Bytes.equals(a, b)).toBe(false);
		});

		test('should return false for different lengths', () => {
			const a = new Uint8Array([0x01, 0x02, 0x03]);
			const b = new Uint8Array([0x01, 0x02]);
			expect(Bytes.equals(a, b)).toBe(false);
		});

		test('should return false for one empty array', () => {
			const a = new Uint8Array([0x01]);
			const b = new Uint8Array(0);
			expect(Bytes.equals(a, b)).toBe(false);
		});

		test('should be symmetric', () => {
			const a = new Uint8Array([0x01, 0x02, 0x03]);
			const b = new Uint8Array([0x04, 0x05, 0x06]);
			expect(Bytes.equals(a, b)).toBe(Bytes.equals(b, a));
		});

		test('should handle single byte arrays', () => {
			const a = new Uint8Array([0xff]);
			const b = new Uint8Array([0xff]);
			const c = new Uint8Array([0x00]);
			expect(Bytes.equals(a, b)).toBe(true);
			expect(Bytes.equals(a, c)).toBe(false);
		});
	});

	describe('compare', () => {
		test('should return 0 for identical arrays', () => {
			const a = new Uint8Array([0x01, 0x02, 0x03]);
			const b = new Uint8Array([0x01, 0x02, 0x03]);
			expect(Bytes.compare(a, b)).toBe(0);
		});

		test('should return 0 for empty arrays', () => {
			const a = new Uint8Array(0);
			const b = new Uint8Array(0);
			expect(Bytes.compare(a, b)).toBe(0);
		});

		test('should return negative for lexicographically smaller first array', () => {
			const a = new Uint8Array([0x01, 0x02, 0x03]);
			const b = new Uint8Array([0x01, 0x02, 0x04]);
			expect(Bytes.compare(a, b)).toBe(-1);
		});

		test('should return positive for lexicographically larger first array', () => {
			const a = new Uint8Array([0x01, 0x02, 0x04]);
			const b = new Uint8Array([0x01, 0x02, 0x03]);
			expect(Bytes.compare(a, b)).toBe(1);
		});

		test('should compare by length when one is prefix of another', () => {
			const a = new Uint8Array([0x01, 0x02]);
			const b = new Uint8Array([0x01, 0x02, 0x03]);
			expect(Bytes.compare(a, b)).toBe(-1);
			expect(Bytes.compare(b, a)).toBe(1);
		});

		test('should handle empty vs non-empty', () => {
			const a = new Uint8Array(0);
			const b = new Uint8Array([0x01]);
			expect(Bytes.compare(a, b)).toBe(-1);
			expect(Bytes.compare(b, a)).toBe(1);
		});

		test('should handle first byte difference', () => {
			const a = new Uint8Array([0x00, 0xff, 0xff]);
			const b = new Uint8Array([0x01, 0x00, 0x00]);
			expect(Bytes.compare(a, b)).toBe(-1);
		});

		test('should be anti-symmetric', () => {
			const a = new Uint8Array([0x01, 0x02, 0x03]);
			const b = new Uint8Array([0x04, 0x05, 0x06]);
			expect(Bytes.compare(a, b)).toBe(-Bytes.compare(b, a));
		});

		test('should be transitive', () => {
			const a = new Uint8Array([0x01]);
			const b = new Uint8Array([0x02]);
			const c = new Uint8Array([0x03]);
			expect(Bytes.compare(a, b)).toBeLessThan(0);
			expect(Bytes.compare(b, c)).toBeLessThan(0);
			expect(Bytes.compare(a, c)).toBeLessThan(0);
		});

		test('should handle single byte arrays', () => {
			const a = new Uint8Array([0x42]);
			const b = new Uint8Array([0x43]);
			expect(Bytes.compare(a, b)).toBe(-1);
			expect(Bytes.compare(b, a)).toBe(1);
		});
	});

	describe('integration tests', () => {
		test('hex roundtrip with various data', () => {
			const testCases = ['', '00', 'ff', 'deadbeef', '0123456789abcdef', 'a0b1c2d3e4f5'];

			testCases.forEach((hex) => {
				if (hex.length > 0) {
					const bytes = Bytes.fromHex(hex);
					const result = Bytes.toHex(bytes);
					expect(result).toBe(hex);
				}
			});
		});

		test('string roundtrip with various encodings', () => {
			const testCases = [
				'',
				'hello',
				'Hello, World!',
				'🚀🌍💻',
				'café naïve résumé',
				'中文测试',
				'Привет мир',
				'العربية',
			];

			testCases.forEach((str) => {
				const bytes = Bytes.fromString(str);
				const result = Bytes.toString(bytes);
				expect(result).toBe(str);
			});
		});

		test('base64 roundtrip with various data', () => {
			const testCases = [
				new Uint8Array([]),
				new Uint8Array([0x00]),
				new Uint8Array([0xff]),
				new Uint8Array([0x00, 0x01, 0x02, 0x03]),
				new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
				new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 256)),
			];

			testCases.forEach((bytes) => {
				const base64 = Bytes.toBase64(bytes);
				const result = Bytes.fromBase64(base64);
				expect(result).toEqual(bytes);
			});
		});

		test('concat and split operations', () => {
			const part1 = Bytes.fromString('Hello, ');
			const part2 = Bytes.fromString('World!');
			const part3 = Bytes.fromHex('deadbeef');

			const combined = Bytes.concat(part1, part2, part3);

			// verify we can extract parts
			const extractedPart1 = combined.slice(0, part1.length);
			const extractedPart2 = combined.slice(part1.length, part1.length + part2.length);
			const extractedPart3 = combined.slice(part1.length + part2.length);

			expect(extractedPart1).toEqual(part1);
			expect(extractedPart2).toEqual(part2);
			expect(extractedPart3).toEqual(part3);
		});

		test('bigint serialization consistency', () => {
			const testValues = [
				0n,
				1n,
				255n,
				256n,
				65535n,
				65536n,
				0xdeadbeefcafebaben,
				0xffffffffffffffffn,
			];

			testValues.forEach((value) => {
				const bytes = Bytes.writeBigUint64BE(value);
				expect(bytes.length).toBe(8);

				// verify we can read it back with DataView
				const view = new DataView(bytes.buffer);
				const result = view.getBigUint64(0, false); // false = big endian
				expect(result).toBe(value);
			});
		});

		test('comparison and equality consistency', () => {
			const arrays = [
				new Uint8Array([]),
				new Uint8Array([0x00]),
				new Uint8Array([0x01]),
				new Uint8Array([0x00, 0x00]),
				new Uint8Array([0x00, 0x01]),
				new Uint8Array([0x01, 0x00]),
				new Uint8Array([0xff, 0xff]),
			];

			for (let i = 0; i < arrays.length; i++) {
				for (let j = 0; j < arrays.length; j++) {
					const a = arrays[i];
					const b = arrays[j];
					const isEqual = Bytes.equals(a, b);
					const comparison = Bytes.compare(a, b);

					if (isEqual) {
						expect(comparison).toBe(0);
					} else {
						expect(comparison).not.toBe(0);
					}
				}
			}
		});
	});
});
