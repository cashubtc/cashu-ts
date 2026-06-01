import { randomBytes } from '@noble/hashes/utils.js';

/**
 * Generates a UUID v7 string.
 *
 * Layout (RFC 9562 §5.7):
 *
 * - Bits 0–47: Unix timestamp in milliseconds (big-endian)
 * - Bits 48–51: version = 0b0111 (7)
 * - Bits 52–63: rand_a — 12 bits, CSPRNG.
 * - Bits 64–65: variant = 0b10.
 * - Bits 66–127: rand_b — 62 bits, CSPRNG.
 *
 * All 74 variable bits (rand_a + rand_b) are filled by randomBytes(), which uses the platform
 * CSPRNG (crypto.getRandomValues / node:crypto) — no monotonic counter, no predictable suffix.
 */
export function generateUuidV7(): string {
  const buf = randomBytes(16);

  const tsMs = BigInt(Date.now());

  // Bytes 0–5: 48-bit timestamp
  buf[0] = Number((tsMs >> 40n) & 0xffn);
  buf[1] = Number((tsMs >> 32n) & 0xffn);
  buf[2] = Number((tsMs >> 24n) & 0xffn);
  buf[3] = Number((tsMs >> 16n) & 0xffn);
  buf[4] = Number((tsMs >> 8n) & 0xffn);
  buf[5] = Number(tsMs & 0xffn);

  // Byte 6: version nibble (0x7) in the high nibble, keep low nibble random (rand_a[0:4])
  buf[6] = 0x70 | (buf[6] & 0x0f);

  // Byte 8: variant bits 0b10 in the two high bits, keep lower 6 bits random (rand_b[0:6])
  buf[8] = 0x80 | (buf[8] & 0x3f);

  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
