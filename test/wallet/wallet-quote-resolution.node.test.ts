import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';

import { Amount, MeltQuoteState, MintQuoteState, Wallet } from '../../src';
import { schnorrVerifyDigest } from '../../src/crypto/core';
import { inputsForPayload } from '../../src/crypto/transcript';
import { NUT02_V3_VECTOR1_KEYS, NUT02_V3_VECTOR1_KEYSET } from '../consts';

import {
  dummyKeysResp,
  dummyKeysetResp,
  mint,
  mintInfoResp,
  mintUrl,
  unit,
  useTestServer,
} from './_setup';

const server = useTestServer();
const pubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const privkey = '0'.repeat(63) + '1';
const quote = {
  quote: 'stored',
  request: 'lnbc10n1pfake',
  amount: 1,
  unit,
  amount_paid: 1,
  amount_issued: 0,
  expiry: null,
  state: MintQuoteState.PAID,
};
const meltQuote = { ...quote, fee_reserve: 0, expiry: 1234567890, state: MeltQuoteState.UNPAID };
const proofs = [{ amount: Amount.from(1), id: '00bd033559de27d0', secret: 'test', C: pubkey }];

async function loadWallet(walletUnit = unit) {
  const wallet = new Wallet(mint, { unit: walletUnit });
  await wallet.loadMint();
  return wallet;
}

test('an explicit null clears a stale pubkey and expiry while caller-only fields survive', async () => {
  server.use(
    http.get(mintUrl + '/v1/mint/quote/bolt11/stored', () =>
      HttpResponse.json({ ...quote, pubkey: null }),
    ),
  );
  const wallet = await loadWallet();
  const preview = await wallet.prepareMint('bolt11', 1, {
    quote: 'stored',
    pubkey,
    expiry: 123,
    localRef: 'keep',
  });
  expect(preview.quote).toMatchObject({ pubkey: null, expiry: null, localRef: 'keep' });
  expect(preview.signature).toBeUndefined();
});

test.each(['single', 'batch'])(
  'resolved amountless BOLT12 quote supplies the %s v3 signing amount',
  async (mode) => {
    const response = { ...quote, request: 'lno1offer', amount: null, pubkey };
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({ keysets: [NUT02_V3_VECTOR1_KEYSET] }),
      ),
      http.get(mintUrl + '/v1/keys', () => HttpResponse.json({ keysets: [NUT02_V3_VECTOR1_KEYS] })),
      http.get(mintUrl + '/v1/mint/quote/bolt12/stored', () => HttpResponse.json(response)),
      http.post(mintUrl + '/v1/mint/quote/bolt12/check', () => HttpResponse.json([response])),
    );
    const wallet = await loadWallet();
    const stale = { quote: 'stored', amount: Amount.from(10), localRef: 'keep' };
    const preview =
      mode === 'single'
        ? await wallet.prepareMint('bolt12', 1, stale, { privkey })
        : await wallet.prepareBatchMint('bolt12', [{ amount: 1, quote: stale }], { privkey });
    const resolved = 'quote' in preview ? preview.quote : preview.quotes[0];
    expect(resolved).toMatchObject({ amount: null, localRef: 'keep' });
    const signature = 'quote' in preview ? preview.signature : preview.signatures?.[0];
    expect(signature).toBeTruthy();
    const tx = inputsForPayload({
      mintQuotes: [{ quoteId: 'stored', amount: 0 }],
      outputs: preview.outputData.map((d) => d.blindedMessage),
    });
    expect(schnorrVerifyDigest(signature!, tx.quotes.get('stored')!.digest, pubkey)).toBe(true);
  },
);

test('an unpaid melt clears a stale payment preimage', async () => {
  server.use(
    http.get(mintUrl + '/v1/melt/quote/bolt11/stored', () =>
      HttpResponse.json({ ...meltQuote, payment_preimage: null }),
    ),
  );
  const wallet = await loadWallet();
  const preview = await wallet.prepareMelt(
    'bolt11',
    { quote: 'stored', amount: Amount.from(1), payment_preimage: 'stale' },
    proofs,
  );
  expect(preview.quote.payment_preimage).toBe(null);
});

test.each(['single', 'batch'])(
  '%s mint resolves a missing unit even when accounting is present',
  async (mode) => {
    let lookups = 0;
    server.use(
      http.get(mintUrl + '/v1/mint/quote/bolt11/stored', () => {
        lookups++;
        return HttpResponse.json(quote);
      }),
      http.post(mintUrl + '/v1/mint/quote/bolt11/check', () => {
        lookups++;
        return HttpResponse.json([quote]);
      }),
    );
    const wallet = await loadWallet();
    const partial = { quote: 'stored', amount_paid: Amount.from(1), amount_issued: Amount.from(0) };
    const preview =
      mode === 'single'
        ? await wallet.prepareMint('bolt11', 1, partial)
        : await wallet.prepareBatchMint('bolt11', [{ amount: 1, quote: partial }]);
    expect('quote' in preview ? preview.quote : preview.quotes[0]).toHaveProperty('unit', 'sat');
    expect(lookups).toBe(1);
  },
);

test('a melt resolves a missing unit even when state is present', async () => {
  let lookups = 0;
  server.use(
    http.get(mintUrl + '/v1/melt/quote/bolt11/stored', () => {
      lookups++;
      return HttpResponse.json(meltQuote);
    }),
  );
  const wallet = await loadWallet();
  const preview = await wallet.prepareMelt(
    'bolt11',
    { quote: 'stored', amount: Amount.from(1), state: MeltQuoteState.UNPAID },
    proofs,
  );
  expect(preview.quote).toHaveProperty('unit', 'sat');
  expect(lookups).toBe(1);
});

test.each([1, 1n, '1'])(
  'stored accounting (%s) works through direct, generic and batch mint APIs',
  async (paid) => {
    const wallet = await loadWallet();
    const stored = { ...quote, amount_paid: paid };
    vi.spyOn(wallet, 'completeMint').mockResolvedValue([]);
    await expect(wallet.prepareMint('bolt11', 1, stored)).resolves.toHaveProperty(
      'quote.quote',
      'stored',
    );
    await expect(wallet.mintProofs('bolt11', 1, stored)).resolves.toEqual([]);
    await expect(
      wallet.prepareBatchMint('bolt11', [{ amount: 1, quote: stored }]),
    ).resolves.toHaveProperty('quotes.0.quote', 'stored');
  },
);

test.each([false, true])(
  'batch accounting bounds every draw (resolved: %s) before reserving counters',
  async (resolve) => {
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt11/check', () => HttpResponse.json([quote])),
    );
    const wallet = await loadWallet();
    const onCountersReserved = vi.fn();
    const entry = resolve ? { quote: 'stored' } : quote;
    await expect(
      wallet.prepareBatchMint('bolt11', [{ amount: 2, quote: entry }], { onCountersReserved }),
    ).rejects.toThrow('has only 1 available to mint; requested 2');
    expect(onCountersReserved).not.toHaveBeenCalled();
  },
);

test('complete responses add no lookups and partial batch entries use one request', async () => {
  let singles = 0,
    batches = 0;
  server.use(
    http.get(mintUrl + '/v1/mint/quote/bolt11/stored', () => {
      singles++;
      return HttpResponse.json(quote);
    }),
    http.post(mintUrl + '/v1/mint/quote/bolt11/check', async ({ request }) => {
      batches++;
      expect(await request.json()).toEqual({ quotes: ['second', 'third'] });
      return HttpResponse.json([
        { ...quote, quote: 'second' },
        { ...quote, quote: 'third' },
      ]);
    }),
  );
  const wallet = await loadWallet();
  const response = await wallet.checkMintQuote('bolt11', 'stored');
  singles = 0;
  await wallet.prepareMint('bolt11', 1, response);
  expect(singles).toBe(0);
  await wallet.prepareMint('bolt11', 1, { quote: 'stored' });
  expect(singles).toBe(1);
  await wallet.prepareBatchMint<{ quote: string }>('bolt11', [
    { amount: 1, quote: response },
    { amount: 1, quote: { quote: 'second' } },
    { amount: 1, quote: { quote: 'third' } },
  ]);
  expect(batches).toBe(1);
  expect(singles).toBe(1);
});

test.each(['bolt11', 'bolt12', 'bolt11-check'])(
  '%s msat quotes accept the exact principal and reject one msat more',
  async (method) => {
    let amount = 1500;
    const request = method === 'bolt12' ? 'lno1offer' : 'lnbc15n1pfake';
    const response = () => HttpResponse.json({ ...meltQuote, request, amount, unit: 'msat' });
    server.use(
      http.get(mintUrl + '/v1/info', () =>
        HttpResponse.json({
          ...mintInfoResp,
          nuts: {
            ...mintInfoResp.nuts,
            5: {
              methods: [
                { method: 'bolt11', unit: 'msat' },
                { method: 'bolt12', unit: 'msat' },
              ],
              disabled: false,
            },
          },
        }),
      ),
      http.post(mintUrl + '/v1/melt/quote/bolt11', response),
      http.post(mintUrl + '/v1/melt/quote/bolt12', response),
      http.get(mintUrl + '/v1/melt/quote/bolt11/stored', response),
    );
    const wallet = await loadWallet('msat');
    const create = () =>
      method === 'bolt12'
        ? wallet.createMeltQuoteBolt12(request, 1500)
        : method === 'bolt11-check'
          ? wallet.checkMeltQuoteBolt11('stored')
          : wallet.createMeltQuoteBolt11(request);
    expect((await create()).amount.equals(1500)).toBe(true);
    amount = 1499;
    expect((await create()).amount.equals(1499)).toBe(true);
    amount = 1501;
    await expect(create()).rejects.toThrow('Melt quote amount exceeds the requested amount');
  },
);

test.each(['create', 'check', 'batch-check'])(
  '%s binds msat mint quotes to the exact invoice amount',
  async (operation) => {
    let request = 'lnbc15n1pfake'; // 1,500 msat, including a fractional sat.
    const response = () => ({
      ...quote,
      request,
      amount: 1500,
      amount_paid: 1500,
      unit: 'msat',
      pubkey,
    });
    server.use(
      http.get(mintUrl + '/v1/info', () =>
        HttpResponse.json({
          ...mintInfoResp,
          nuts: {
            ...mintInfoResp.nuts,
            4: { methods: [{ method: 'bolt11', unit: 'msat' }], disabled: false },
          },
        }),
      ),
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({
          keysets: dummyKeysetResp.keysets.map((keyset) => ({ ...keyset, unit: 'msat' })),
        }),
      ),
      http.get(mintUrl + '/v1/keys', () =>
        HttpResponse.json({
          keysets: dummyKeysResp.keysets.map((keyset) => ({ ...keyset, unit: 'msat' })),
        }),
      ),
      http.post(mintUrl + '/v1/mint/quote/bolt11', () => HttpResponse.json(response())),
      http.get(mintUrl + '/v1/mint/quote/bolt11/stored', () => HttpResponse.json(response())),
      http.post(mintUrl + '/v1/mint/quote/bolt11/check', () => HttpResponse.json([response()])),
    );
    const wallet = await loadWallet('msat');
    const getQuote = async () =>
      operation === 'create'
        ? wallet.createMintQuoteBolt11(1500, pubkey)
        : operation === 'check'
          ? wallet.checkMintQuoteBolt11('stored')
          : (await wallet.checkMintQuoteBatchBolt11(['stored']))[0];
    expect((await getQuote()).amount.equals(1500)).toBe(true);
    for (const invalid of ['lnbc14n1pfake', 'lnbc16n1pfake', 'lnbc1pfake', 'unreadable']) {
      request = invalid;
      await expect(getQuote()).rejects.toThrow(
        'Mint quote invoice amount does not match the quote',
      );
    }
  },
);
