import { hexToBytes } from '@noble/hashes/utils.js';
import { describe, test, expect } from 'vitest';

import { Bytes } from '../src/utils/Bytes';

describe('Bytes utility class', () => {
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

    test('large arrays produce valid base64 on the btoa fallback path (no Buffer)', () => {
      // Force the chunked btoa path that browsers use; harmless where Buffer
      // is already absent.
      const g = globalThis as unknown as { Buffer?: unknown };
      const originalBuffer = g.Buffer;
      try {
        g.Buffer = undefined;
        const size = 40000;
        const bytes = new Uint8Array(size);
        for (let i = 0; i < size; i++) {
          bytes[i] = i % 256;
        }
        const result = Bytes.toBase64(bytes);
        // '=' is only valid as trailing padding
        expect(result.replace(/=+$/, '')).not.toContain('=');
        // strict atob round-trip must reproduce the input
        expect(Bytes.fromBase64(result)).toEqual(bytes);
      } finally {
        g.Buffer = originalBuffer;
      }
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

  describe('integration tests', () => {
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
      const part3 = hexToBytes('deadbeef');

      const combined = Bytes.concat(part1, part2, part3);

      // verify we can extract parts
      const extractedPart1 = combined.slice(0, part1.length);
      const extractedPart2 = combined.slice(part1.length, part1.length + part2.length);
      const extractedPart3 = combined.slice(part1.length + part2.length);

      expect(extractedPart1).toEqual(part1);
      expect(extractedPart2).toEqual(part2);
      expect(extractedPart3).toEqual(part3);
    });
  });
});
