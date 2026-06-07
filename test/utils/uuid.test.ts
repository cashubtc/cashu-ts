import { describe, expect, test } from 'vitest';

import { generateUuidV7 } from '../../src/utils/uuid';

describe('generateUuidV7', () => {
  test('has version 7 and variant 10 bits', () => {
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let i = 0; i < 100; i++) {
      expect(generateUuidV7()).toMatch(re);
    }
  });

  test('encodes current timestamp into bytes 0-5 in big-endian order', () => {
    const before = Date.now();
    const u = generateUuidV7();
    const after = Date.now();
    const tsHex = u.slice(0, 8) + u.slice(9, 13);
    const ts = Number('0x' + tsHex);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
