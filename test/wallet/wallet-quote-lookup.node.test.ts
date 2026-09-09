import { HttpResponse, http } from 'msw';
import { describe, expect, test } from 'vitest';

import { Wallet } from '../../src';
import { verifyMintQuoteLookupSignature } from '../../src/crypto';

import { mint, mintInfoResp, mintUrl, unit, useTestServer } from './_setup';

const server = useTestServer();

const PRIVKEY = '0000000000000000000000000000000000000000000000000000000000000001';
const PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const PRIVKEY2 = '0000000000000000000000000000000000000000000000000000000000000002';
const PUBKEY2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const MINT_PUBKEY = mintInfoResp.pubkey as string;

type LookupBody = { pubkeys: string[]; pubkey_signatures: string[] };

describe('Wallet.getMintQuotesByPubkey', () => {
  test('derives the pubkey, signs with the mint info pubkey, and normalizes quotes', async () => {
    let body: LookupBody | undefined;
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt11/pubkey', async ({ request }) => {
        body = (await request.json()) as LookupBody;
        return HttpResponse.json({
          quotes: [
            {
              quote: 'q1',
              request: 'lnbc100...',
              unit: 'sat',
              method: 'bolt11',
              amount: 100,
              amount_paid: 100,
              amount_issued: 0,
              updated_at: 1,
              state: 'PAID',
              expiry: null,
              pubkey: PUBKEY,
            },
          ],
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quotes = await wallet.getMintQuotesByPubkey(PRIVKEY);

    expect(body?.pubkeys).toEqual([PUBKEY]);
    expect(body?.pubkey_signatures).toHaveLength(1);
    expect(verifyMintQuoteLookupSignature(PUBKEY, MINT_PUBKEY, body!.pubkey_signatures[0])).toBe(
      true,
    );
    expect(quotes).toHaveLength(1);
    expect(quotes[0].quote).toBe('q1');
    expect(quotes[0].amount_paid.toBigInt()).toBe(100n);
  });

  test('accepts multiple privkeys and preserves order', async () => {
    let body: LookupBody | undefined;
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt11/pubkey', async ({ request }) => {
        body = (await request.json()) as LookupBody;
        return HttpResponse.json({ quotes: [] });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quotes = await wallet.getMintQuotesByPubkey([PRIVKEY, PRIVKEY2]);

    expect(quotes).toEqual([]);
    expect(body?.pubkeys).toEqual([PUBKEY, PUBKEY2]);
    expect(verifyMintQuoteLookupSignature(PUBKEY, MINT_PUBKEY, body!.pubkey_signatures[0])).toBe(
      true,
    );
    expect(verifyMintQuoteLookupSignature(PUBKEY2, MINT_PUBKEY, body!.pubkey_signatures[1])).toBe(
      true,
    );
  });

  test('routes the method into the request path', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt12/pubkey', () => HttpResponse.json({ quotes: [] })),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(wallet.getMintQuotesByPubkey(PRIVKEY, 'bolt12')).resolves.toEqual([]);
  });

  test('rejects when the mint publishes no usable pubkey', async () => {
    const { pubkey: _drop, ...noPubkeyInfo } = mintInfoResp as Record<string, unknown>;
    server.use(http.get(mintUrl + '/v1/info', () => HttpResponse.json(noPubkeyInfo)));
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(wallet.getMintQuotesByPubkey(PRIVKEY)).rejects.toThrow(
      'Mint does not publish a usable pubkey',
    );
  });
});
