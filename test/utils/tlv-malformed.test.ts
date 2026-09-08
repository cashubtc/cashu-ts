/**
 * UTF-8 handling of the NUT-26 TLV codec's length-framed string fields. Payment requests arrive
 * from the wild, so a field must decode to exactly its bytes or fail with a CTSError.
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
const bytes = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat());

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
