/**
 * Fail-closed behaviour of the NUT-26 TLV codec on malformed input. Payment requests arrive from
 * the wild, so every structural violation must surface as a CTSError, never a crash or a silently
 * wrong decode.
 */

import { bech32 } from '@scure/base';
import { describe, expect, test } from 'vitest';

import { decodeTLV, encodeTLV } from '../../src/utils/tlv';
import { PaymentRequestTransportType } from '../../src/wallet/types/payment-requests';

// One TLV record: tag (1 byte) || length (2 bytes BE) || value.
const rec = (tag: number, value: number[]): number[] => [
  tag,
  (value.length >> 8) & 0xff,
  value.length & 0xff,
  ...value,
];
const utf8 = (s: string): number[] => [...new TextEncoder().encode(s)];
const bytes = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat());
const KEY33 = [0x02, ...Array.from({ length: 32 }, () => 0xab)];

describe('decodeTLV fails closed on malformed streams', () => {
  test('truncated records', () => {
    expect(() => decodeTLV(new Uint8Array([0x01]))).toThrow(/too short/);
    // Declared length overruns the buffer.
    expect(() => decodeTLV(new Uint8Array([0x01, 0x00, 0x05, 0x61]))).toThrow(/too short/);
  });

  test('fixed-width fields reject the wrong width', () => {
    expect(() => decodeTLV(bytes(rec(0x02, [1, 2, 3])))).toThrow(/Invalid u64/);
    expect(() => decodeTLV(bytes(rec(0x04, [1, 1])))).toThrow(/Invalid u8/);
  });

  test('unknown outer tags are ignored for forward compatibility', () => {
    const decoded = decodeTLV(bytes(rec(0x7f, utf8('future')), rec(0x01, utf8('id1'))));
    expect(decoded.id).toBe('id1');
  });

  test('transport structural violations', () => {
    const target = rec(0x02, utf8('https://x'));
    expect(() => decodeTLV(bytes(rec(0x07, [...rec(0x01, [2]), ...target])))).toThrow(
      /Unsupported transport kind: 2/,
    );
    expect(() => decodeTLV(bytes(rec(0x07, target)))).toThrow(/missing required kind/);
    expect(() => decodeTLV(bytes(rec(0x07, rec(0x01, [1]))))).toThrow(/missing required target/);
    // A nostr target is a raw 32-byte pubkey; anything else cannot become an nprofile.
    expect(() => decodeTLV(bytes(rec(0x07, [...rec(0x01, [0]), ...rec(0x02, [0xaa])])))).toThrow(
      /expected 32 bytes/,
    );
    // A tag tuple whose length byte overruns its buffer.
    expect(() =>
      decodeTLV(bytes(rec(0x07, [...rec(0x01, [1]), ...target, ...rec(0x03, [0x05, 0x61])]))),
    ).toThrow(/Tag tuple data too short/);
  });

  test('nut10 structural violations', () => {
    const data = rec(0x02, utf8('02aa'));
    // An unknown kind is not a structural violation: it decodes preserved (NUT-26).
    expect(decodeTLV(bytes(rec(0x08, [...rec(0x01, [9]), ...data]))).nut10?.kind).toBe('9');
    expect(() => decodeTLV(bytes(rec(0x08, data)))).toThrow(/missing required kind/);
    expect(() => decodeTLV(bytes(rec(0x08, rec(0x01, [0]))))).toThrow(/missing required data/);
  });

  test('nutroot option violations', () => {
    const receiver = rec(0x01, KEY33);
    expect(() => decodeTLV(bytes(rec(0x0b, receiver), rec(0x0b, receiver)))).toThrow(
      /multiple nutroot options/,
    );
    expect(() => decodeTLV(bytes(rec(0x0b, [...receiver, ...receiver])))).toThrow(
      /multiple nutroot receiver keys/,
    );
    expect(() => decodeTLV(bytes(rec(0x0b, rec(0x01, [0x02, 0xaa]))))).toThrow(/33 bytes/);
    expect(() => decodeTLV(bytes(rec(0x0b, [...receiver, ...rec(0x03, [0xaa])])))).toThrow(
      /blind_key must be 33 bytes/,
    );
    expect(() => decodeTLV(bytes(rec(0x0b, rec(0x02, [0x00]))))).toThrow(
      /missing required receiver_key/,
    );
  });
});

describe('encodeTLV refuses unencodable requests', () => {
  test('oversized values and strings', () => {
    expect(() => encodeTLV({ description: 'a'.repeat(70000) })).toThrow(/too long/);
    expect(() =>
      encodeTLV({
        transports: [
          {
            type: PaymentRequestTransportType.POST,
            target: 'https://x',
            tags: [['k', 'v'.repeat(300)]],
          },
        ],
      }),
    ).toThrow(/Tag tuple string too long/);
  });

  test('unknown enum values', () => {
    expect(() =>
      encodeTLV({
        transports: [{ type: 'pigeon' as PaymentRequestTransportType, target: 'https://x' }],
      }),
    ).toThrow(/Unsupported transport type/);
    expect(() => encodeTLV({ nut10: { kind: 'WEIRD', data: '02aa' } })).toThrow(
      /Unsupported NUT-10 type/,
    );
  });

  test('nutroot keys must be 33-byte points', () => {
    expect(() => encodeTLV({ nutroot: { receiverKey: 'aabb' } })).toThrow(/33 bytes/);
    expect(() =>
      encodeTLV({
        nutroot: {
          receiverKey: `02${'ab'.repeat(32)}`,
          blindKeys: ['aabb'],
        },
      }),
    ).toThrow(/blind_key must be 33 bytes/);
  });

  test('malformed nprofile targets fail closed', () => {
    const nostr = (target: string) => ({
      transports: [{ type: PaymentRequestTransportType.NOSTR, target }],
    });
    const nprofile = (payload: number[]) =>
      bech32.encode('nprofile', bech32.toWords(new Uint8Array(payload)), 1024);
    expect(() =>
      encodeTLV(nostr(bech32.encode('npub', bech32.toWords(new Uint8Array(32)), 1024))),
    ).toThrow(/expected prefix 'nprofile'/);
    expect(() => encodeTLV(nostr(nprofile([0x00])))).toThrow(/too short/);
    expect(() => encodeTLV(nostr(nprofile([0x00, 0x20, 0xaa])))).toThrow(/too short/);
    expect(() => encodeTLV(nostr(nprofile([0x00, 0x02, 0xaa, 0xbb])))).toThrow(
      /Invalid pubkey length/,
    );
    expect(() => encodeTLV(nostr(nprofile([0x01, 0x01, 0x77])))).toThrow(/missing required pubkey/);
  });
});
