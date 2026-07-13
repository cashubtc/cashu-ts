import { test, describe, expect } from 'vitest';

import {
  P2PKBuilder,
  PaymentRequest,
  PaymentRequestBuilder,
  PaymentRequestTransportType,
  p2pkOptionsToPRNut10,
  type P2PKOptions,
} from '../../src/index';

const PUBKEY = '02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2';
const PUBKEY2 = '03e7a51b73e5f2f6b5a6f0d63c6a5e1a3b2c4d5e6f708192a3b4c5d6e7f8091a2b';
const NPROFILE =
  'nprofile1qy28wumn8ghj7un9d3shjtnyv9kh2uewd9hsz9mhwden5te0wfjkccte9curxven9eehqctrv5hszrthwden5te0dehhxtnvdakqqgydaqy7curk439ykptkysv7udhdhu68sucm295akqefdehkf0d495cwunl5';

describe('PaymentRequestBuilder', () => {
  test('builds a full request that round-trips through creqA', () => {
    const pr = PaymentRequest.builder()
      .id('4840f51e')
      .amount(1000, 'sat')
      .description('test')
      .addMint('https://mint.com')
      .mintsPreferred()
      .addNostrTransport(NPROFILE)
      .addHttpPostTransport('https://pay.example/cb')
      .addSupportedMethod('bolt11')
      .addSupportedMethod('onchain', 50)
      .singleUse()
      .build();

    const decoded = PaymentRequest.fromEncodedRequest(pr.toEncodedRequest());
    expect(decoded.id).toBe('4840f51e');
    expect(decoded.amount?.equals(1000)).toBeTruthy();
    expect(decoded.unit).toBe('sat');
    expect(decoded.description).toBe('test');
    expect(decoded.mints).toEqual(['https://mint.com']);
    expect(decoded.mintsPreferred).toBe(true);
    expect(decoded.singleUse).toBe(true);
    expect(decoded.transport).toEqual([
      { type: PaymentRequestTransportType.NOSTR, target: NPROFILE, tags: [['n', '17']] },
      { type: PaymentRequestTransportType.POST, target: 'https://pay.example/cb' },
    ]);
    expect(decoded.supportedMethods?.[0].method).toBe('bolt11');
    expect(decoded.supportedMethods?.[0].fee).toBeUndefined();
    expect(decoded.supportedMethods?.[1].method).toBe('onchain');
    expect(decoded.supportedMethods?.[1].fee?.equals(50)).toBeTruthy();
  });

  test('empty builder produces an empty request', () => {
    const pr = new PaymentRequestBuilder().build();
    expect(pr.toRawRequest()).toEqual({});
  });

  test('amount() sets amount and unit together; unit() alone works for amountless', () => {
    const withAmount = new PaymentRequestBuilder().amount(21, 'usd').build();
    expect(withAmount.amount?.equals(21)).toBeTruthy();
    expect(withAmount.unit).toBe('usd');

    const amountless = new PaymentRequestBuilder().unit('sat').build();
    expect(amountless.amount).toBeUndefined();
    expect(amountless.unit).toBe('sat');
  });

  test('addMint normalizes URLs and dedupes with first-seen order', () => {
    const pr = new PaymentRequestBuilder()
      .addMint(['https://a.mint', 'https://b.mint'])
      .addMint('https://a.mint/') // normalizes to the same URL
      .build();
    expect(pr.mints).toEqual(['https://a.mint', 'https://b.mint']);

    expect(() => new PaymentRequestBuilder().addMint('not a url')).toThrowError(/mint URL/i);
  });

  test('mintsPreferred without mints throws at build(), in any call order', () => {
    expect(() => new PaymentRequestBuilder().mintsPreferred().build()).toThrowError(/mint list/);
    expect(() => new PaymentRequestBuilder().mintsPreferred(false).build()).toThrowError(
      /mint list/,
    );
    // setter order is free; only build() validates
    const pr = new PaymentRequestBuilder().mintsPreferred().addMint('https://a.mint').build();
    expect(pr.mintsPreferred).toBe(true);
  });

  test('amount() rejects an empty unit; addSupportedMethod() rejects an empty method', () => {
    expect(() => new PaymentRequestBuilder().amount(100, '')).toThrowError(/requires a unit/);
    expect(() => new PaymentRequestBuilder().addSupportedMethod('')).toThrowError(/non-empty/);
  });

  test('reusing the builder does not mutate an already-built request', () => {
    const builder = new PaymentRequestBuilder()
      .addMint('https://a.mint')
      .addHttpPostTransport('https://pay.example/cb');
    const first = builder.build();
    builder.addMint('https://b.mint').addHttpPostTransport('https://other.example');
    expect(first.mints).toEqual(['https://a.mint']);
    expect(first.transport).toHaveLength(1);
  });

  test('duplicate supported methods throw at build()', () => {
    expect(() =>
      new PaymentRequestBuilder()
        .addSupportedMethod('bolt11')
        .addSupportedMethod('bolt11', 2)
        .build(),
    ).toThrowError(/duplicate supported method/);
  });

  test('addNostrTransport validates target and nips', () => {
    expect(() => new PaymentRequestBuilder().addNostrTransport('npub1notaprofile')).toThrowError(
      /nprofile/,
    );
    expect(() => new PaymentRequestBuilder().addNostrTransport(NPROFILE, [])).toThrowError(
      /at least one NIP/,
    );
    const pr = new PaymentRequestBuilder().addNostrTransport(NPROFILE, ['17', '04']).build();
    expect(pr.getTransport(PaymentRequestTransportType.NOSTR)?.tags).toEqual([['n', '17', '04']]);
  });

  test('lock() accepts P2PKBuilder output and round-trips via toP2PKOptions()', () => {
    const builder = new P2PKBuilder()
      .addLockPubkey([PUBKEY, PUBKEY2])
      .addRefundPubkey(PUBKEY)
      .lockUntil(2085000000)
      .requireLockSignatures(2);
    const pr = new PaymentRequestBuilder().lock(builder.toOptions()).build();

    expect(pr.nut10?.kind).toBe('P2PK');
    expect(pr.nut10?.data).toBe(PUBKEY);
    expect(pr.nut10?.tags).toContainEqual(['pubkeys', PUBKEY2]);
    expect(pr.nut10?.tags).toContainEqual(['n_sigs', '2']);
    expect(pr.nut10?.tags).toContainEqual(['locktime', '2085000000']);
    expect(pr.nut10?.tags).toContainEqual(['refund', PUBKEY]);

    // the payer-side parser reconstructs the same lock
    const roundTripped = pr.toP2PKOptions();
    expect(roundTripped).toEqual(builder.toOptions());
  });

  test('lock() accepts raw P2PKOptions and validates them', () => {
    const pr = new PaymentRequestBuilder().lock({ kind: 'P2PK', data: PUBKEY }).build();
    expect(pr.nut10).toEqual({ kind: 'P2PK', data: PUBKEY, tags: [] });

    expect(() =>
      new PaymentRequestBuilder().lock({ kind: 'P2PK', data: 'garbage' }),
    ).toThrowError();
  });

  test('lock() rejects blindKeys', () => {
    const blind: P2PKOptions = { kind: 'P2PK', data: PUBKEY, blindKeys: true };
    expect(() => new PaymentRequestBuilder().lock(blind)).toThrowError(/blindKeys/);
  });

  test('nut10() passes arbitrary kinds through verbatim; last lock write wins', () => {
    const custom = { kind: 'DLC', data: 'deadbeef', tags: [['x', 'y']] };
    const pr = new PaymentRequestBuilder()
      .lock({ kind: 'P2PK', data: PUBKEY })
      .nut10(custom)
      .build();
    expect(pr.nut10).toEqual(custom);
  });
});

describe('p2pkOptionsToPRNut10', () => {
  test('HTLC options serialize with the hashlock in data', () => {
    const hashlock = 'ab'.repeat(32);
    const nut10 = p2pkOptionsToPRNut10({ kind: 'HTLC', data: hashlock, pubkeys: [PUBKEY] });
    expect(nut10.kind).toBe('HTLC');
    expect(nut10.data).toBe(hashlock);
    expect(nut10.tags).toEqual([['pubkeys', PUBKEY]]);
  });

  test('additional tags are validated and appended', () => {
    const nut10 = p2pkOptionsToPRNut10({
      kind: 'P2PK',
      data: PUBKEY,
      additionalTags: [['memo', 'hi']],
    });
    expect(nut10.tags).toContainEqual(['memo', 'hi']);
    expect(() =>
      p2pkOptionsToPRNut10({ kind: 'P2PK', data: PUBKEY, additionalTags: [['pubkeys', 'x']] }),
    ).toThrowError(/reserved key/);
  });
});
