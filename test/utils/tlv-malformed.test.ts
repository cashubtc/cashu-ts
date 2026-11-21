/**
 * UTF-8 handling of the NUT-26 TLV codec's length-framed string fields. Payment requests arrive
 * from the wild, so a field must decode to exactly its bytes or fail with a CTSError.
 */

import { bech32 } from '@scure/base';
import { describe, expect, test } from 'vitest';

import { CTSError } from '../../src/model/Errors';
import { decodeTLV, encodeTLV } from '../../src/utils/tlv';
import { PaymentRequestTransportType } from '../../src/wallet/types/payment-requests';

// One TLV record: tag (1 byte) || length (2 bytes BE) || value.
const rec = (tag: number, value: number[]): number[] => [
  tag,
  (value.length >> 8) & 0xff,
  value.length & 0xff,
  ...value,
];
const bytes = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat());
const utf8 = (text: string): number[] => [...new TextEncoder().encode(text)];

describe('decodeTLV rejects a repeat of a singular tag', () => {
  test('singular top-level tags reject a repeat', () => {
    const u64 = (n: number): number[] => [0, 0, 0, 0, 0, 0, 0, n];
    expect(() => decodeTLV(bytes(rec(0x01, utf8('a')), rec(0x01, utf8('b'))))).toThrow(
      /multiple id/,
    );
    expect(() => decodeTLV(bytes(rec(0x02, u64(1)), rec(0x02, u64(9))))).toThrow(/multiple amount/);
    expect(() => decodeTLV(bytes(rec(0x03, [0]), rec(0x03, utf8('usd'))))).toThrow(/multiple unit/);
    expect(() => decodeTLV(bytes(rec(0x04, [0]), rec(0x04, [1])))).toThrow(/multiple single_use/);
    expect(() => decodeTLV(bytes(rec(0x06, utf8('a')), rec(0x06, utf8('b'))))).toThrow(
      /multiple description/,
    );
    // Repeatable tags still accumulate.
    const mints = decodeTLV(
      bytes(rec(0x05, utf8('https://a')), rec(0x05, utf8('https://b'))),
    ).mints;
    expect(mints).toEqual(['https://a', 'https://b']);
  });

  test('transport kind and target are singular within one transport', () => {
    const kind = rec(0x01, [1]);
    const target = rec(0x02, utf8('https://x'));
    expect(() => decodeTLV(bytes(rec(0x07, [...kind, ...kind, ...target])))).toThrow(
      /multiple transport kind/,
    );
    expect(() => decodeTLV(bytes(rec(0x07, [...kind, ...target, ...target])))).toThrow(
      /multiple transport target/,
    );
<<<<<<< HEAD
=======
    // A nostr target is a raw 32-byte pubkey; anything else cannot become an nprofile.
    expect(() => decodeTLV(bytes(rec(0x07, [...rec(0x01, [0]), ...rec(0x02, [0xaa])])))).toThrow(
      /expected 32 bytes/,
    );
    // A tag tuple whose length byte overruns its buffer.
    expect(() =>
      decodeTLV(bytes(rec(0x07, [...rec(0x01, [1]), ...target, ...rec(0x03, [0x05, 0x61])]))),
    ).toThrow(/Tag tuple data too short/);
    // Relays too long in total to rebuild a nostr target as an nprofile.
    const relay = [40, ...utf8('wss://'.padEnd(40, 'a'))];
    const relays = rec(0x03, [1, ...utf8('r'), ...Array.from({ length: 20 }, () => relay).flat()]);
    expect(() =>
      decodeTLV(bytes(rec(0x07, [...rec(0x01, [0]), ...rec(0x02, KEY33.slice(1)), ...relays]))),
    ).toThrow(CTSError);
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
>>>>>>> d5c09c2 (fix(utils): throw CTSError when an nprofile cannot be encoded or decoded (#1526))
  });
});

describe('encodeTLV refuses unencodable requests', () => {
  test('a unit whose encoding is the sat sentinel byte', () => {
    expect(() => encodeTLV({ unit: '\0' })).toThrow(/unit/);
    // sat itself and ordinary units still encode.
    expect(decodeTLV(encodeTLV({ unit: 'sat' })).unit).toBe('sat');
    expect(decodeTLV(encodeTLV({ unit: 'usd' })).unit).toBe('usd');
  });

  test('an nprofile with two identity pubkeys is rejected', () => {
    const nostr = (target: string) => ({
      transports: [{ type: PaymentRequestTransportType.NOSTR, target }],
    });
    const nprofile = (payload: number[]) =>
      bech32.encode('nprofile', bech32.toWords(new Uint8Array(payload)), 1024);
    const key = (fill: number): number[] => [0x00, 0x20, ...Array.from({ length: 32 }, () => fill)];
    expect(() => encodeTLV(nostr(nprofile([...key(0x11), ...key(0x22)])))).toThrow(
      /multiple pubkeys/,
    );
    // Bad checksum, and a valid checksum over words with non-zero padding.
    const good = nprofile(key(0x11));
    const badChecksum = good.slice(0, -1) + (good.endsWith('q') ? 'p' : 'q');
    expect(() => encodeTLV(nostr(badChecksum))).toThrow(CTSError);
    expect(() => encodeTLV(nostr(bech32.encode('nprofile', [0x00, 0x1f], 1024)))).toThrow(CTSError);
  });
});

describe('TLV string fields decode to exactly their bytes', () => {
  test('a leading BOM in a string field is kept as content, not stripped as framing', () => {
    // 'ef bb bf 61 62' is the UTF-8 BOM followed by 'ab'; the TLV length already frames it.
    const decoded = decodeTLV(bytes(rec(0x01, [0xef, 0xbb, 0xbf, 0x61, 0x62])));
    expect(decoded.id).toBe('﻿ab');
  });

  test('a string field that is not valid UTF-8 is rejected', () => {
    expect(() => decodeTLV(bytes(rec(0x01, [0xff])))).toThrow();
  });

  test('an nprofile relay URL that is not valid UTF-8 is rejected', () => {
    // A relay URL is a length-framed string field: same UTF-8 rules as every other one.
    const nprofile = (payload: number[]) =>
      bech32.encode('nprofile', bech32.toWords(new Uint8Array(payload)), 1024);
    const nostr = (target: string) => ({
      transports: [{ type: PaymentRequestTransportType.NOSTR, target }],
    });

    expect(() =>
      encodeTLV(nostr(nprofile([0x00, 0x20, ...new Array(32).fill(0xaa), 0x01, 0x01, 0xff]))),
    ).toThrow(/Malformed UTF-8/);
  });
});
