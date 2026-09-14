import { HttpResponse, http } from 'msw';
import { describe, expect, test, vi } from 'vitest';

import { Wallet, MintQuoteState, MeltQuoteState } from '../../src';

import {
  useTestServer,
  mint,
  mintUrl,
  unit,
  invoice,
  mintInfoResp,
  dummyKeysetResp,
  dummyKeysResp,
} from './_setup';

const server = useTestServer();

// The invoice in _setup asks for 2000 sat.
const INVOICE_SAT = 2000;
const PUBKEY = '02abcd';

function spyLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    log: vi.fn(),
  };
}

async function makeWallet(logger: ReturnType<typeof spyLogger>) {
  const wallet = new Wallet(mint, { unit, logger });
  await wallet.loadMint();
  return wallet;
}

const warnedWith = (logger: ReturnType<typeof spyLogger>, fragment: string) =>
  logger.warn.mock.calls.some(([message]) => String(message).includes(fragment));

describe('quote unit warnings', () => {
  test('createMintQuoteBolt11 warns when the mint quotes another unit', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt11', () =>
        HttpResponse.json({
          quote: 'q1',
          request: invoice,
          amount: INVOICE_SAT,
          unit: 'usd',
          state: MintQuoteState.UNPAID,
          expiry: 3600,
          amount_paid: 0,
          amount_issued: 0,
        }),
      ),
    );
    const logger = spyLogger();
    const wallet = await makeWallet(logger);

    const quote = await wallet.createMintQuoteBolt11(INVOICE_SAT);

    expect(quote.quote).toBe('q1');
    expect(warnedWith(logger, "quoted unit 'usd'")).toBe(true);
  });

  test('createMeltQuoteBolt11 warns when the mint quotes another unit', async () => {
    server.use(
      http.post(mintUrl + '/v1/melt/quote/bolt11', () =>
        HttpResponse.json({
          quote: 'm1',
          request: invoice,
          amount: INVOICE_SAT,
          unit: 'usd',
          fee_reserve: 0,
          state: MeltQuoteState.UNPAID,
          expiry: 3600,
        }),
      ),
    );
    const logger = spyLogger();
    const wallet = await makeWallet(logger);

    const quote = await wallet.createMeltQuoteBolt11(invoice);

    expect(quote.quote).toBe('m1');
    expect(warnedWith(logger, "quoted unit 'usd'")).toBe(true);
  });

  test('a matching unit warns about nothing', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt11', () =>
        HttpResponse.json({
          quote: 'q2',
          request: invoice,
          amount: INVOICE_SAT,
          unit: 'sat',
          state: MintQuoteState.UNPAID,
          expiry: 3600,
          amount_paid: 0,
          amount_issued: 0,
        }),
      ),
    );
    const logger = spyLogger();
    const wallet = await makeWallet(logger);

    await wallet.createMintQuoteBolt11(INVOICE_SAT);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('quote amount warnings', () => {
  const bolt12MintQuote = (amount: number | null) => ({
    quote: 'b12',
    request: 'lno1offer',
    amount,
    unit: 'sat',
    pubkey: PUBKEY,
    state: MintQuoteState.UNPAID,
    expiry: 3600,
    amount_paid: 0,
    amount_issued: 0,
  });

  test('createMintQuoteBolt12 warns when an amountless offer comes back with an amount', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt12', () => HttpResponse.json(bolt12MintQuote(500))),
    );
    const logger = spyLogger();
    const wallet = await makeWallet(logger);

    const quote = await wallet.createMintQuoteBolt12(PUBKEY);

    expect(quote.quote).toBe('b12');
    expect(warnedWith(logger, 'no amount was requested')).toBe(true);
  });

  test('createMintQuoteBolt12 warns when the requested amount is not quoted back', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt12', () => HttpResponse.json(bolt12MintQuote(null))),
    );
    const logger = spyLogger();
    const wallet = await makeWallet(logger);

    await wallet.createMintQuoteBolt12(PUBKEY, { amount: 500 });

    expect(warnedWith(logger, 'the mint quoted no amount but 500 was requested')).toBe(true);
  });

  test('createMeltQuoteBolt12 warns when the quote exceeds the amount asked for', async () => {
    server.use(
      http.post(mintUrl + '/v1/melt/quote/bolt12', () =>
        HttpResponse.json({
          quote: 'b12m',
          request: 'lno1offer',
          amount: INVOICE_SAT,
          unit: 'sat',
          fee_reserve: 0,
          state: MeltQuoteState.UNPAID,
          expiry: 3600,
        }),
      ),
    );
    const logger = spyLogger();
    const wallet = await makeWallet(logger);

    const quote = await wallet.createMeltQuoteBolt12('lno1offer', 1_000_000);

    expect(quote.quote).toBe('b12m');
    expect(warnedWith(logger, 'at most 1000000 msat')).toBe(true);
  });

  test('createMeltQuoteOnchain warns when the quoted amount differs', async () => {
    server.use(
      http.post(mintUrl + '/v1/melt/quote/onchain', () =>
        HttpResponse.json({
          quote: 'onchain-1',
          request: 'bc1qrecipient',
          amount: 900,
          unit: 'sat',
          fee_options: [{ fee_index: 0, fee_reserve: 2, estimated_blocks: 6 }],
          state: MeltQuoteState.UNPAID,
          expiry: 3600,
        }),
      ),
    );
    const logger = spyLogger();
    const wallet = await makeWallet(logger);

    const quote = await wallet.createMeltQuoteOnchain('bc1qrecipient', 1000);

    expect(quote.quote).toBe('onchain-1');
    expect(warnedWith(logger, 'the mint quoted 900 but 1000 was requested')).toBe(true);
  });
});

describe('msat quote bounds', () => {
  // An msat wallet compares the invoice amount directly; no sub-sat rounding applies.
  function useMsatMint() {
    server.use(
      http.get(mintUrl + '/v1/info', () =>
        HttpResponse.json({
          ...mintInfoResp,
          nuts: {
            ...mintInfoResp.nuts,
            4: { methods: [{ method: 'bolt11', unit: 'msat' }], disabled: false },
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
    );
  }

  async function makeMsatWallet(logger: ReturnType<typeof spyLogger>) {
    const wallet = new Wallet(mint, { unit: 'msat', logger });
    await wallet.loadMint();
    return wallet;
  }

  test.each(['bolt11', 'bolt11-check'])(
    '%s melt quotes accept the exact principal and reject one msat more',
    async (method) => {
      let amount = 1500;
      const request = 'lnbc15n1pfake'; // 1,500 msat
      const response = () =>
        HttpResponse.json({
          quote: 'stored',
          request,
          amount,
          unit: 'msat',
          fee_reserve: 0,
          state: MeltQuoteState.UNPAID,
          expiry: 3600,
        });
      useMsatMint();
      server.use(
        http.post(mintUrl + '/v1/melt/quote/bolt11', response),
        http.get(mintUrl + '/v1/melt/quote/bolt11/stored', response),
      );
      const wallet = await makeMsatWallet(spyLogger());
      const create = () =>
        method === 'bolt11-check'
          ? wallet.checkMeltQuoteBolt11('stored')
          : wallet.createMeltQuoteBolt11(request);

      expect((await create()).amount.equals(1500)).toBe(true);
      amount = 1501;
      await expect(create()).rejects.toThrow(/exceeds the invoice/i);
    },
  );

  test('createMeltQuoteBolt12 warns one msat above the amount asked for', async () => {
    let amount = 1500;
    useMsatMint();
    server.use(
      http.post(mintUrl + '/v1/melt/quote/bolt12', () =>
        HttpResponse.json({
          quote: 'b12m',
          request: 'lno1offer',
          amount,
          unit: 'msat',
          fee_reserve: 0,
          state: MeltQuoteState.UNPAID,
          expiry: 3600,
        }),
      ),
    );
    const logger = spyLogger();
    const wallet = await makeMsatWallet(logger);

    await wallet.createMeltQuoteBolt12('lno1offer', 1500);
    expect(logger.warn).not.toHaveBeenCalled();
    amount = 1501;
    await wallet.createMeltQuoteBolt12('lno1offer', 1500);
    expect(warnedWith(logger, 'at most 1500 msat')).toBe(true);
  });

  test.each(['create', 'check'])(
    '%s binds an msat mint quote to the exact invoice amount',
    async (operation) => {
      let request = 'lnbc15n1pfake'; // 1,500 msat
      const response = () =>
        HttpResponse.json({
          quote: 'stored',
          request,
          amount: 1500,
          unit: 'msat',
          state: MintQuoteState.UNPAID,
          expiry: 3600,
        });
      useMsatMint();
      server.use(
        http.post(mintUrl + '/v1/mint/quote/bolt11', response),
        http.get(mintUrl + '/v1/mint/quote/bolt11/stored', response),
      );
      const wallet = await makeMsatWallet(spyLogger());
      const getQuote = () =>
        operation === 'create'
          ? wallet.createMintQuoteBolt11(1500)
          : wallet.checkMintQuoteBolt11('stored');

      expect((await getQuote()).amount.equals(1500)).toBe(true);
      for (const invalid of ['lnbc14n1pfake', 'lnbc16n1pfake', 'unreadable']) {
        request = invalid;
        await expect(getQuote()).rejects.toThrow(/invoice amount/i);
      }
    },
  );
});
