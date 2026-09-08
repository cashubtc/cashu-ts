import { describe, expect, test } from 'vitest';

import { decodeUtf8Document, decodeUtf8Field } from '../../src/utils/bytes';

describe('decodeUtf8Field', () => {
  test('keeps a leading BOM as content instead of stripping it', () => {
    // ef bb bf is the UTF-8 BOM, followed by 'a'.
    const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0x61);
    expect(decodeUtf8Field(bytes)).toBe('﻿a');
  });

  test('rejects a byte sequence that is not valid UTF-8', () => {
    expect(() => decodeUtf8Field(Uint8Array.of(0xff))).toThrow();
  });
});

describe('decodeUtf8Document', () => {
  test('strips a leading BOM instead of keeping it as content', () => {
    // ef bb bf is the UTF-8 BOM, followed by '{"a":1}'.
    const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}'));
    expect(decodeUtf8Document(bytes)).toBe('{"a":1}');
  });

  test('rejects a byte sequence that is not valid UTF-8', () => {
    expect(() => decodeUtf8Document(Uint8Array.of(0xff))).toThrow();
  });
});
