import { test, describe, expect } from 'vitest';

import {
  decodePaymentRequest,
  OutputData,
  PaymentRequest,
  PaymentRequestTransportType,
  type NUT10Option,
} from '../../src/index';
import { encodeBech32m } from '../../src/utils/bech32m';
import { encodeTLV } from '../../src/utils/tlv';

describe('payment requests', () => {
  test('encode payment requests', async () => {
    const request = new PaymentRequest(
      [
        {
          type: PaymentRequestTransportType.NOSTR,
          target: 'asd',
          tags: [['n', '17']],
        },
      ],
      '4840f51e',
      1000,
      'sat',
      ['https://mint.com'],
      'test',
      true, // single use
      {
        kind: 'P2PK',
        data: 'pubkey',
        tags: [['tag', 'tag-value']],
      },
    );
    const pr = request.toEncodedRequest();
    expect(pr).toBeDefined();
    const decodedRequest = decodePaymentRequest(pr);
    expect(decodedRequest).toBeDefined();
    expect(decodedRequest.id).toBe('4840f51e');
    expect(decodedRequest.amount?.equals(1000)).toBeTruthy();
    expect(decodedRequest.unit).toBe('sat');
    expect(decodedRequest.mints).toStrictEqual(['https://mint.com']);
    expect(decodedRequest.description).toBe('test');
    expect(decodedRequest.transport).toBeDefined();
    expect(decodedRequest.transport?.length).toBe(1);
    expect(decodedRequest.singleUse).toBe(true);
    expect(decodedRequest.transport?.[0].type).toBe(PaymentRequestTransportType.NOSTR);
    expect(decodedRequest.transport?.[0].target).toBe('asd');
    expect(decodedRequest.transport?.[0].tags).toStrictEqual([['n', '17']]);
    expect(decodedRequest.nut10).toBeDefined();
    expect(decodedRequest.nut10?.kind).toBe('P2PK');
    expect(decodedRequest.nut10?.data).toBe('pubkey');
    expect(decodedRequest.nut10?.tags).toStrictEqual([['tag', 'tag-value']]);

    const decodedRequestClassConstructor = PaymentRequest.fromEncodedRequest(pr);
    expect(decodedRequestClassConstructor).toStrictEqual(decodedRequest);

    // Handle no transport fromRawRequest
    decodedRequest.transport = undefined;
    const raw = decodedRequest.toRawRequest();
    const req = PaymentRequest.fromRawRequest(raw);
    expect(req).toStrictEqual(decodedRequest);
  });
  test('test decoding payment requests with no amount', async () => {
    const prWithoutAmount =
      'creqApGF0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OW1od2RlbjV0ZTB3ZmprY2N0ZTljdXJ4dmVuOWVlaHFjdHJ2NWhzenJ0aHdkZW41dGUwZGVoaHh0bnZkYWtxcWd5bWRleDNndmZzZnVqcDN4eW43ZTdxcnM4eXlxOWQ4enN1MnpxdWp4dXhjYXBmcXZ6YzhncnFka3RzYWeBgmFuYjE3YWloNDg0MGY1MWVhdWNzYXRhbYFwaHR0cHM6Ly9taW50LmNvbQ==';
    const request: PaymentRequest = decodePaymentRequest(prWithoutAmount);
    expect(request).toBeDefined();
    expect(request.id).toBe('4840f51e');
    expect(request.amount).toBeUndefined();
    expect(request.unit).toBe('sat');
    expect(request.mints).toStrictEqual(['https://mint.com']);
    expect(request.description).toBeUndefined();
    expect(request.transport).toBeDefined();
    expect(request.transport?.length).toBe(1);
    expect(request.transport?.[0].type).toBe(PaymentRequestTransportType.NOSTR);
    expect(request.getTransport(PaymentRequestTransportType.NOSTR)?.target).toBe(
      'nprofile1qy28wumn8ghj7un9d3shjtnyv9kh2uewd9hsz9mhwden5te0wfjkccte9curxven9eehqctrv5hszrthwden5te0dehhxtnvdakqqgymdex3gvfsfujp3xyn7e7qrs8yyq9d8zsu2zqujxuxcapfqvzc8grqdkts',
    );
    expect(request.transport?.[0].target).toBe(
      'nprofile1qy28wumn8ghj7un9d3shjtnyv9kh2uewd9hsz9mhwden5te0wfjkccte9curxven9eehqctrv5hszrthwden5te0dehhxtnvdakqqgymdex3gvfsfujp3xyn7e7qrs8yyq9d8zsu2zqujxuxcapfqvzc8grqdkts',
    );
  });
  test('encode and decode payment request with bigint amount (uint64)', async () => {
    const largeAmount = 2n ** 53n + 1n; // exceeds Number.MAX_SAFE_INTEGER
    const request = new PaymentRequest(
      [
        {
          type: PaymentRequestTransportType.POST,
          target: 'https://example.com/pay',
        },
      ],
      'bigint_test',
      largeAmount,
      'sat',
      ['https://mint.com'],
    );
    const pr = request.toEncodedRequest();
    expect(pr).toBeDefined();
    const decoded = decodePaymentRequest(pr);
    expect(decoded.amount?.toBigInt()).toBe(largeAmount);
    expect(decoded.id).toBe('bigint_test');
  });

  test('test unsupported prefix/version', async () => {
    const prWithInvalidPrefix =
      'croqApGF0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OW1od2RlbjV0ZTB3ZmprY2N0ZTljdXJ4dmVuOWVlaHFjdHJ2NWhzenJ0aHdkZW41dGUwZGVoaHh0bnZkYWtxcWd5bWRleDNndmZzZnVqcDN4eW43ZTdxcnM4eXlxOWQ4enN1MnpxdWp4dXhjYXBmcXZ6YzhncnFka3RzYWeBgmFuYjE3YWloNDg0MGY1MWVhdWNzYXRhbYFwaHR0cHM6Ly9taW50LmNvbQ==';
    const prWithInvalidVersion =
      'creqZpGF0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OW1od2RlbjV0ZTB3ZmprY2N0ZTljdXJ4dmVuOWVlaHFjdHJ2NWhzenJ0aHdkZW41dGUwZGVoaHh0bnZkYWtxcWd5bWRleDNndmZzZnVqcDN4eW43ZTdxcnM4eXlxOWQ4enN1MnpxdWp4dXhjYXBmcXZ6YzhncnFka3RzYWeBgmFuYjE3YWloNDg0MGY1MWVhdWNzYXRhbYFwaHR0cHM6Ly9taW50LmNvbQ==';
    expect(() => decodePaymentRequest(prWithInvalidPrefix)).toThrow(
      'unsupported pr: invalid prefix',
    );
    expect(() => decodePaymentRequest(prWithInvalidVersion)).toThrow('unsupported pr version');
  });

  describe('toRawRequest', () => {
    test('omits every optional field and defaults singleUse to false', () => {
      // A request built with no arguments carries no optional fields; toStrictEqual
      // distinguishes an absent key from one explicitly set to undefined, so this
      // pins each `if (this.field)` guard as well as the singleUse default.
      const request = new PaymentRequest();
      expect(request.singleUse).toBe(false);
      expect(request.toRawRequest()).toStrictEqual({});
    });

    test('emits only the fields that are set', () => {
      const request = new PaymentRequest(undefined, 'the-id', 1000, 'sat', undefined, undefined);
      expect(request.toRawRequest()).toStrictEqual({ i: 'the-id', a: 1000n, u: 'sat' });
    });
  });

  describe('toEncodedCreqA', () => {
    test('produces the creqA (CBOR) encoding, identical to toEncodedRequest', () => {
      const request = new PaymentRequest(
        [{ type: PaymentRequestTransportType.POST, target: 'https://pay.example' }],
        'creqa-id',
        1000,
        'sat',
      );
      const encoded = request.toEncodedCreqA();
      expect(encoded.startsWith('creqA')).toBe(true);
      expect(encoded).toBe(request.toEncodedRequest());

      const decoded = decodePaymentRequest(encoded);
      expect(decoded.id).toBe('creqa-id');
      expect(decoded.amount?.equals(1000)).toBeTruthy();
    });
  });

  describe('getTransport', () => {
    test('returns undefined when the request has no transports', () => {
      const request = new PaymentRequest(undefined, 'id');
      expect(request.getTransport(PaymentRequestTransportType.NOSTR)).toBeUndefined();
    });

    test('matches on transport type and returns undefined for an absent type', () => {
      const request = new PaymentRequest(
        [{ type: PaymentRequestTransportType.POST, target: 'https://pay.example' }],
        'id',
      );
      expect(request.getTransport(PaymentRequestTransportType.NOSTR)).toBeUndefined();
      expect(request.getTransport(PaymentRequestTransportType.POST)?.target).toBe(
        'https://pay.example',
      );
    });
  });

  describe('toEncodedCreqB - creqB format (TLV + bech32m)', () => {
    test('encode and decode basic payment request with nostr transport', () => {
      const pr = new PaymentRequest(
        [
          {
            type: PaymentRequestTransportType.NOSTR,
            target: 'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8g2lcy6q',
            tags: [['n', '17']],
          },
        ],
        'test_id_123',
        500,
        'sat',
        ['https://mint.example.com'],
        'Test payment request',
        true,
      );

      const encoded = pr.toEncodedCreqB();

      // Verify it starts with CREQB (uppercase)
      expect(encoded.startsWith('CREQB')).toBe(true);

      // Decode and verify all fields
      const decoded = PaymentRequest.fromEncodedRequest(encoded);
      expect(decoded.id).toBe('test_id_123');
      expect(decoded.amount?.equals(500)).toBeTruthy();
      expect(decoded.unit).toBe('sat');
      expect(decoded.mints).toEqual(['https://mint.example.com']);
      expect(decoded.description).toBe('Test payment request');
      expect(decoded.singleUse).toBe(true);
      expect(decoded.transport).toHaveLength(1);
      expect(decoded.transport![0].type).toBe(PaymentRequestTransportType.NOSTR);
    });

    test('encode and decode payment request with POST transport', () => {
      const pr = new PaymentRequest(
        [
          {
            type: PaymentRequestTransportType.POST,
            target: 'https://api.example.com/payment',
            tags: [
              ['auth', 'bearer'],
              ['priority', 'high'],
            ],
          },
        ],
        'http_test',
        250,
        'sat',
        ['https://mint.example.com'],
        undefined,
        false,
      );

      const encoded = pr.toEncodedCreqB();
      const decoded = PaymentRequest.fromEncodedRequest(encoded);

      expect(decoded.id).toBe('http_test');
      expect(decoded.amount?.equals(250)).toBeTruthy();
      expect(decoded.transport![0].type).toBe(PaymentRequestTransportType.POST);
      expect(decoded.transport![0].target).toBe('https://api.example.com/payment');
      expect(decoded.transport![0].tags).toEqual([
        ['auth', 'bearer'],
        ['priority', 'high'],
      ]);
    });

    test('encode and decode minimal payment request', () => {
      const pr = new PaymentRequest(undefined, 'minimal_id', undefined, 'sat', [
        'https://mint.example.com',
      ]);

      const encoded = pr.toEncodedCreqB();
      const decoded = PaymentRequest.fromEncodedRequest(encoded);

      expect(decoded.id).toBe('minimal_id');
      expect(decoded.amount).toBeUndefined();
      expect(decoded.unit).toBe('sat');
      expect(decoded.mints).toEqual(['https://mint.example.com']);
      expect(decoded.transport).toBeUndefined();
    });

    test('encode and decode payment request with NUT-10', () => {
      const pr = new PaymentRequest(
        undefined,
        'p2pk_test',
        1000,
        'sat',
        ['https://mint.example.com'],
        'Locked payment',
        false,
        {
          kind: 'P2PK',
          data: '02abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
          tags: [
            ['timeout', '7200'],
            ['refund', '03abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890cd'],
          ],
        },
      );

      const encoded = pr.toEncodedCreqB();
      const decoded = PaymentRequest.fromEncodedRequest(encoded);

      expect(decoded.id).toBe('p2pk_test');
      expect(decoded.amount?.equals(1000)).toBeTruthy();
      expect(decoded.unit).toBe('sat');
      expect(decoded.description).toBe('Locked payment');
      // nut10 roundtrips on creqB decode (only the first entry is stored)
      expect(decoded.nut10?.kind).toBe('P2PK');
      expect(decoded.nut10?.data).toBe(
        '02abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
      );
      expect(decoded.nut10?.tags).toStrictEqual([
        ['timeout', '7200'],
        ['refund', '03abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890cd'],
      ]);
    });

    test('encode and decode payment request with tagless NUT-10', () => {
      const pr = new PaymentRequest(
        undefined,
        'p2pk_test',
        1000,
        'sat',
        undefined,
        undefined,
        false,
        {
          kind: 'P2PK',
          data: '02abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
          tags: [],
        },
      );

      const decoded = PaymentRequest.fromEncodedRequest(pr.toEncodedCreqB());

      // Empty tags decode to undefined and fall back to [] on construction.
      expect(decoded.nut10?.kind).toBe('P2PK');
      expect(decoded.nut10?.tags).toStrictEqual([]);
    });

    test('a creqB without a single_use tag defaults singleUse to false', () => {
      // Our encoder always writes the single_use tag, so craft a TLV that omits it
      // (singleUse undefined => tag skipped) to exercise the decode-side default.
      const tlv = encodeTLV({ id: 'noflag', unit: 'sat', mints: ['https://mint.example.com'] });
      const encoded = encodeBech32m('creqb', tlv).toUpperCase();

      const decoded = PaymentRequest.fromEncodedRequest(encoded);
      expect(decoded.id).toBe('noflag');
      expect(decoded.singleUse).toBe(false);
    });

    test('roundtrip from creqB test vector', () => {
      // Use an existing test vector
      const originalEncoded =
        'CREQB1QYQQSC3HVYUNQVFHXCPQQZQQQQQQQQQQQQ9QXQQPQQZSQ9MGW368QUE69UHNSVENXVH8XURPVDJN5VENXVUQWQREQYQQZQQZQQSGM6QFA3C8DTZ2FVZHVFQEACMWM0E50PE3K5TFMVPJJMN0VJ7M2TGRQQZSZMSZXYMSXQQHQ9EPGAMNWVAZ7TMJV4KXZ7FWV3SK6ATN9E5K7QCQRGQHY9MHWDEN5TE0WFJKCCTE9CURXVEN9EEHQCTRV5HSXQQSQ9EQ6AMNWVAZ7TMWDAEJUMR0DSRYDPGF';

      const pr = PaymentRequest.fromEncodedRequest(originalEncoded);
      const reEncoded = pr.toEncodedCreqB();
      const decoded = PaymentRequest.fromEncodedRequest(reEncoded);

      // Verify all fields preserved
      expect(decoded.id).toBe(pr.id);
      expect(decoded.amount?.equals(pr.amount!)).toBeTruthy();
      expect(decoded.unit).toBe(pr.unit);
      expect(decoded.mints).toEqual(pr.mints);
      expect(decoded.transport![0].type).toBe(pr.transport![0].type);
      expect(decoded.transport![0].target).toBe(pr.transport![0].target);
    });
  });

  describe('toP2PKOptions', () => {
    const PUBKEY = '03a16e8557f5a4229212f4df093791c8615c864a387d66fd990e9cdca5dcb5c9aa';
    const PUBKEY_2 = '02000000000000000000000000000000000000000000000000000000000000000a';
    const REFUND = '020000000000000000000000000000000000000000000000000000000000000b0b';
    const HASH = '5d3f2c1b0a99887766554433221100ffeeddccbbaa99887766554433221100ff';

    const prWithNut10 = (nut10?: NUT10Option) =>
      new PaymentRequest(undefined, 'id', 1, 'sat', undefined, undefined, false, nut10);

    test('returns undefined when there is no nut10 option', () => {
      expect(prWithNut10(undefined).toP2PKOptions()).toBeUndefined();
    });

    test('maps a bare P2PK option to a single pubkey', () => {
      const nut10: NUT10Option = { kind: 'P2PK', data: PUBKEY, tags: [] };
      expect(prWithNut10(nut10).toP2PKOptions()).toEqual({ kind: 'P2PK', data: PUBKEY });
    });

    test('maps standard NUT-11 tags onto structured P2PK fields', () => {
      const nut10: NUT10Option = {
        kind: 'P2PK',
        data: PUBKEY,
        tags: [
          ['pubkeys', PUBKEY_2],
          ['locktime', '1700000000'],
          ['n_sigs', '2'],
          ['refund', REFUND],
          ['n_sigs_refund', '1'],
          ['sigflag', 'SIG_ALL'],
        ],
      };
      expect(prWithNut10(nut10).toP2PKOptions()).toEqual({
        kind: 'P2PK',
        data: PUBKEY,
        pubkeys: [PUBKEY_2],
        locktime: 1700000000,
        requiredSignatures: 2,
        refundKeys: [REFUND],
        requiredRefundSignatures: 1,
        sigFlag: 'SIG_ALL',
      });
    });

    test('treats an absent tags field as no tags', () => {
      // NUT10Option types `tags` as required, but a decoded/hand-built option can
      // arrive without it; the parser must see an empty tag list, not a poison value.
      const nut10 = { kind: 'P2PK', data: PUBKEY } as unknown as NUT10Option;
      expect(prWithNut10(nut10).toP2PKOptions()).toEqual({ kind: 'P2PK', data: PUBKEY });
    });

    test('preserves non-standard tags as additionalTags', () => {
      const nut10: NUT10Option = { kind: 'P2PK', data: PUBKEY, tags: [['custom', 'value']] };
      expect(prWithNut10(nut10).toP2PKOptions()).toEqual({
        kind: 'P2PK',
        data: PUBKEY,
        additionalTags: [['custom', 'value']],
      });
    });

    test('rejects malformed tags rather than dropping invalid lock semantics', () => {
      // An empty-string tag value is invalid per NUT-10; silently ignoring it
      // would produce a lock weaker than the payee requested, so it must throw.
      const nut10: NUT10Option = { kind: 'P2PK', data: PUBKEY, tags: [['locktime', '']] };
      expect(() => prWithNut10(nut10).toP2PKOptions()).toThrow(/Invalid NUT-10 tag/);
    });

    test('rejects duplicate tag keys (NUT-11 unspendable lock)', () => {
      // A repeated tag key makes the proof unspendable per NUT-11, so building
      // the lock must fail rather than silently first-winning one value.
      const nut10: NUT10Option = {
        kind: 'P2PK',
        data: PUBKEY,
        tags: [
          ['locktime', '100'],
          ['locktime', '200'],
        ],
      };
      expect(() => prWithNut10(nut10).toP2PKOptions()).toThrow(/Duplicate P2PK tag "locktime"/);
    });

    test('maps an HTLC option to a hashlock with signing keys', () => {
      const nut10: NUT10Option = {
        kind: 'HTLC',
        data: HASH,
        tags: [
          ['pubkeys', PUBKEY],
          ['locktime', '1700000000'],
          ['refund', REFUND],
        ],
      };
      expect(prWithNut10(nut10).toP2PKOptions()).toEqual({
        kind: 'HTLC',
        data: HASH,
        pubkeys: [PUBKEY],
        locktime: 1700000000,
        refundKeys: [REFUND],
      });
    });

    test('maps a pubkey-less HTLC option to a hashlock-only lock', () => {
      // NUT-14 allows an HTLC with no `pubkeys` tag: anyone with the preimage
      // can spend. This must produce a buildable lock, not a poison-pill option.
      const nut10: NUT10Option = { kind: 'HTLC', data: HASH, tags: [] };
      const options = prWithNut10(nut10).toP2PKOptions()!;
      expect(options).toEqual({ kind: 'HTLC', data: HASH });
      const od = OutputData.createSingleP2PKData(options, 1, '00ad268c4d1f5826');
      const secret = JSON.parse(new TextDecoder().decode(od.secret));
      expect(secret[0]).toBe('HTLC');
      expect(secret[1].data).toBe(HASH);
      expect(secret[1].tags.find((t: string[]) => t[0] === 'pubkeys')).toBeUndefined();
    });

    test('ignores unknown/future kinds by returning undefined', () => {
      const nut10: NUT10Option = { kind: 'FUTURE', data: 'abc', tags: [] };
      expect(prWithNut10(nut10).toP2PKOptions()).toBeUndefined();
    });

    test('throws when a P2PK/HTLC option is missing its data field', () => {
      expect(() => prWithNut10({ kind: 'P2PK', data: '', tags: [] }).toP2PKOptions()).toThrow(
        /missing its data field/,
      );
      expect(() => prWithNut10({ kind: 'HTLC', data: '', tags: [] }).toP2PKOptions()).toThrow(
        /missing its data field/,
      );
    });

    test('produced options build a secret locked to exactly the requested condition', () => {
      const nut10: NUT10Option = { kind: 'P2PK', data: PUBKEY, tags: [] };
      const options = prWithNut10(nut10).toP2PKOptions()!;
      const od = OutputData.createSingleP2PKData(options, 1, '00ad268c4d1f5826');
      const secret = JSON.parse(new TextDecoder().decode(od.secret));
      expect(secret[0]).toBe('P2PK');
      expect(secret[1].data).toBe(PUBKEY);
      expect(secret[1].tags).toEqual([]);
    });
  });
});
