import { HttpResponse, http } from 'msw';
import { test, describe, expect, vi } from 'vitest';

import {
  Wallet,
  type Proof,
  type MeltQuoteBolt11Response,
  type MeltQuoteBaseResponse,
  type MintQuoteBaseResponse,
  MeltQuoteState,
  MintQuoteState,
  MintQuoteBolt11Response,
  Amount,
  AmountLike,
} from '../../src';

import { Bytes, sumProofs } from '../../src/utils';
import { hexToBytes } from '@noble/curves/utils.js';
import { useTestServer, mint, mintUrl, unit, logger, mintInfoResp } from './_setup';

const server = useTestServer();

describe('requestTokens', () => {
  test('test requestTokens', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/bolt11', () => {
        return HttpResponse.json({
          signatures: [
            {
              id: '00bd033559de27d0',
              amount: 1,
              C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
            },
          ],
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const mintQuote: MintQuoteBolt11Response = {
      quote: 'test-quote-id',
      request: 'lnbc...',
      amount: Amount.from(1),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    };
    const proofs = await wallet.mintProofsBolt11(1, mintQuote);

    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({ amount: Amount.from(1), id: '00bd033559de27d0' });
    expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
    expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
  });

  test('prepareMint defers request until completeMint', async () => {
    let mintCalls = 0;
    server.use(
      http.post(mintUrl + '/v1/mint/bolt11', () => {
        mintCalls += 1;
        return HttpResponse.json({
          signatures: [
            {
              id: '00bd033559de27d0',
              amount: 1,
              C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
            },
          ],
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const mintQuote: MintQuoteBolt11Response = {
      quote: 'deferred-quote-id',
      request: 'lnbc...',
      amount: Amount.from(1),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    };
    const preview = await wallet.prepareMint('bolt11', 1, mintQuote);
    expect(mintCalls).toBe(0);
    expect(preview.method).toBe('bolt11');
    expect(preview.payload.quote).toBe('deferred-quote-id');
    expect(preview.outputData).toHaveLength(1);

    const proofs = await wallet.completeMint(preview);

    expect(mintCalls).toBe(1);
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({ amount: Amount.from(1), id: '00bd033559de27d0' });
  });

  test('prepareBatchMint consolidates outputs and completeBatchMint sends batch request', async () => {
    let batchCalls = 0;
    let capturedBody: Record<string, unknown> | undefined;
    server.use(
      http.post(mintUrl + '/v1/mint/bolt11/batch', async ({ request }) => {
        batchCalls += 1;
        capturedBody = (await request.json()) as Record<string, unknown>;
        const body = capturedBody as {
          quotes: string[];
          quote_amounts: unknown[];
          outputs: Array<{ amount: unknown }>;
        };
        expect(body.quotes).toEqual(['quote-a', 'quote-b']);
        expect(body.quote_amounts).toHaveLength(2);
        // Return one signature per output
        return HttpResponse.json({
          signatures: body.outputs.map((o) => ({
            id: '00bd033559de27d0',
            amount: o.amount,
            C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
          })),
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quoteA: MintQuoteBolt11Response = {
      quote: 'quote-a',
      request: 'lnbc...',
      amount: Amount.from(5),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
      pubkey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    };
    const quoteB: MintQuoteBolt11Response = {
      quote: 'quote-b',
      request: 'lnbc...',
      amount: Amount.from(3),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    };

    const dummyPrivkey = '0000000000000000000000000000000000000000000000000000000000000001';
    const batchPreview = await wallet.prepareBatchMint(
      'bolt11',
      [
        { amount: 5, quote: quoteA },
        { amount: 3, quote: quoteB },
      ],
      { privkey: dummyPrivkey },
    );

    expect(batchCalls).toBe(0);
    expect(batchPreview.method).toBe('bolt11');
    expect(batchPreview.quotes).toHaveLength(2);
    // Consolidated outputs: 5+3=8 should produce fewer outputs than separate 5 and 3
    const outputTotal = Amount.sum(batchPreview.outputData.map((o) => o.blindedMessage.amount));
    expect(outputTotal.equals(8)).toBe(true);

    const proofs = await wallet.completeBatchMint(batchPreview);

    expect(batchCalls).toBe(1);
    const totalAmount = sumProofs(proofs);
    expect(totalAmount.equals(8)).toBe(true);
    expect(proofs.every((p) => p.id === '00bd033559de27d0')).toBe(true);

    // Verify NUT-20 signatures: first quote has signature, second is null
    const sentSigs = (capturedBody as { signatures?: Array<string | null> }).signatures;
    expect(sentSigs).toBeDefined();
    expect(sentSigs).toHaveLength(2);
    expect(typeof sentSigs![0]).toBe('string');
    expect(sentSigs![1]).toBeNull();
  });

  test('prepareBatchMint matches privkeys to locked quotes by pubkey', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    server.use(
      http.post(mintUrl + '/v1/mint/bolt11/batch', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        const body = capturedBody as { outputs: Array<{ amount: unknown }> };
        return HttpResponse.json({
          signatures: body.outputs.map((o) => ({
            id: '00bd033559de27d0',
            amount: o.amount,
            C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
          })),
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const privkeyA = '0000000000000000000000000000000000000000000000000000000000000001';
    const pubkeyA = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const privkeyB = '0000000000000000000000000000000000000000000000000000000000000002';
    const pubkeyB = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';

    const quoteA: MintQuoteBolt11Response = {
      quote: 'locked-a',
      request: 'lnbc...',
      amount: Amount.from(3),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
      pubkey: pubkeyA,
    };
    const quoteB: MintQuoteBolt11Response = {
      quote: 'locked-b',
      request: 'lnbc...',
      amount: Amount.from(2),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
      pubkey: pubkeyB,
    };

    const batchPreview = await wallet.prepareBatchMint(
      'bolt11',
      [
        { amount: 3, quote: quoteA },
        { amount: 2, quote: quoteB },
      ],
      { privkey: [privkeyA, privkeyB] },
    );

    // Both quotes are locked, so both should have signatures
    const sentSigs = batchPreview.payload.signatures;
    expect(sentSigs).toBeDefined();
    expect(sentSigs).toHaveLength(2);
    expect(typeof sentSigs![0]).toBe('string');
    expect(typeof sentSigs![1]).toBe('string');
    // Signatures should be different (different quote IDs)
    expect(sentSigs![0]).not.toBe(sentSigs![1]);

    // Complete the batch to verify full round-trip
    const proofs = await wallet.completeBatchMint(batchPreview);
    const totalAmount = sumProofs(proofs);
    expect(totalAmount.equals(5)).toBe(true);
  });

  test('prepareBatchMint omits signatures when all quotes are unlocked', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    server.use(
      http.post(mintUrl + '/v1/mint/bolt11/batch', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        const body = capturedBody as { outputs: Array<{ amount: unknown }> };
        return HttpResponse.json({
          signatures: body.outputs.map((o) => ({
            id: '00bd033559de27d0',
            amount: o.amount,
            C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
          })),
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quoteA: MintQuoteBolt11Response = {
      quote: 'unlocked-a',
      request: 'lnbc...',
      amount: Amount.from(2),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    };
    const quoteB: MintQuoteBolt11Response = {
      quote: 'unlocked-b',
      request: 'lnbc...',
      amount: Amount.from(3),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    };

    const batchPreview = await wallet.prepareBatchMint('bolt11', [
      { amount: 2, quote: quoteA },
      { amount: 3, quote: quoteB },
    ]);

    // No signatures field when all quotes are unlocked
    expect(batchPreview.payload.signatures).toBeUndefined();

    const proofs = await wallet.completeBatchMint(batchPreview);
    expect(sumProofs(proofs).equals(5)).toBe(true);
    expect(capturedBody).not.toHaveProperty('signatures');
  });

  test('prepareBatchMint treats quotes without pubkey as unlocked even when privkey is supplied', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    server.use(
      http.post(mintUrl + '/v1/mint/bolt11/batch', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        const body = capturedBody as { outputs: Array<{ amount: unknown }> };
        return HttpResponse.json({
          signatures: body.outputs.map((o) => ({
            id: '00bd033559de27d0',
            amount: o.amount,
            C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
          })),
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quoteA = { quote: 'stored-a' };
    const quoteB = { quote: 'stored-b' };

    const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
    const batchPreview = await wallet.prepareBatchMint(
      'bolt11',
      [
        { amount: 2, quote: quoteA },
        { amount: 3, quote: quoteB },
      ],
      { privkey },
    );

    expect(batchPreview.payload.signatures).toBeUndefined();

    const proofs = await wallet.completeBatchMint(batchPreview);
    expect(sumProofs(proofs).equals(5)).toBe(true);
    expect(capturedBody).not.toHaveProperty('signatures');
  });

  test('prepareBatchMint fails when locked quotes have no privkey', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quote: MintQuoteBolt11Response = {
      quote: 'locked-no-key',
      request: 'lnbc...',
      amount: Amount.from(1),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
      pubkey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    };

    await expect(wallet.prepareBatchMint('bolt11', [{ amount: 1, quote }])).rejects.toThrow(
      'Can not sign locked quotes without private key',
    );
  });

  test('prepareMint signs with privkey even when quote has no pubkey', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/bolt11', () => {
        return HttpResponse.json({
          signatures: [
            {
              id: '00bd033559de27d0',
              amount: 1,
              C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
            },
          ],
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quote: MintQuoteBolt11Response = {
      quote: 'no-pubkey-quote',
      request: 'lnbc...',
      amount: Amount.from(1),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    };

    const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
    const preview = await wallet.prepareMint('bolt11', 1, quote, { privkey });

    // Should still produce a signature using the provided privkey
    expect(preview.payload.signature).toBeDefined();
    expect(typeof preview.payload.signature).toBe('string');
  });

  test('prepareMint fails when multiple privkeys and no quote pubkey', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quote: MintQuoteBolt11Response = {
      quote: 'locked-mismatch',
      request: 'lnbc...',
      amount: Amount.from(1),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    };

    const pk1 = '0000000000000000000000000000000000000000000000000000000000000001';
    const pk2 = '0000000000000000000000000000000000000000000000000000000000000002';
    await expect(
      wallet.prepareMint('bolt11', 1, quote, {
        privkey: [pk1, pk2],
      }),
    ).rejects.toThrow('multiple privkeys supplied for quote');
  });

  test('prepareBatchMint fails when no privkey matches locked quote pubkey', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quoteA: MintQuoteBolt11Response = {
      quote: 'locked-mismatch',
      request: 'lnbc...',
      amount: Amount.from(1),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
      pubkey: '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
    };

    // privkey for sk=1 won't match sk=2's pubkey
    const wrongPrivkey = '0000000000000000000000000000000000000000000000000000000000000001';
    await expect(
      wallet.prepareBatchMint('bolt11', [{ amount: 1, quote: quoteA }], { privkey: wrongPrivkey }),
    ).rejects.toThrow('No private key matches quote pubkey');
  });

  test('test requestTokens bad response', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/bolt11', () => {
        return HttpResponse.json({});
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const mintQuote: MintQuoteBolt11Response = {
      quote: 'bad-response-quote',
      request: 'lnbc...',
      amount: Amount.from(1),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    };
    await expect(wallet.mintProofsBolt11(1, mintQuote)).rejects.toThrow(
      'Invalid response from mint',
    );
    await expect(wallet.mintProofsBolt11(1, 'badquote')).rejects.toThrow(
      'Invalid response from mint',
    );
  });

  test('prepareMint deterministic counters reserve once and avoid duplicate outputs', async () => {
    server.use(
      http.get(mintUrl + '/v1/keysets', () => {
        return HttpResponse.json({
          keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 0 }],
        });
      }),
    );

    const keysetId = '00bd033559de27d0';
    const seed = hexToBytes(
      'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
    );
    const wallet = new Wallet(mint, { unit, bip39seed: seed, logger });
    await wallet.loadMint();

    const mintQuote: MintQuoteBolt11Response = {
      quote: 'quote123',
      request: 'lnbc...',
      amount: Amount.from(1),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    };

    const preview = await wallet.prepareMint('bolt11', 3, mintQuote, undefined, {
      type: 'deterministic',
      counter: 0,
    });

    expect(preview.outputData.length).toBeGreaterThan(0);
    const secrets = preview.outputData.map((p) => Bytes.toHex(p.secret));
    expect(new Set(secrets).size).toBe(secrets.length);
    expect(await wallet.counters.peekNext(keysetId)).toBe(preview.outputData.length);
  });
});

describe('NUT-29 max_batch_size enforcement', () => {
  function makeBatchHandler() {
    server.use(
      http.post(mintUrl + '/v1/mint/bolt11/batch', async ({ request }) => {
        const body = (await request.json()) as { outputs: Array<{ amount: unknown }> };
        return HttpResponse.json({
          signatures: body.outputs.map((o) => ({
            id: '00bd033559de27d0',
            amount: o.amount,
            C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
          })),
        });
      }),
    );
  }

  function overrideMintInfo(nut29?: Record<string, unknown>) {
    const nuts = { ...mintInfoResp.nuts, ...(nut29 !== undefined ? { 29: nut29 } : {}) };
    server.use(
      http.get(mintUrl + '/v1/info', () => {
        return HttpResponse.json({ ...mintInfoResp, nuts });
      }),
    );
  }

  function makeQuotes(n: number): Array<{ amount: number; quote: { quote: string } }> {
    return Array.from({ length: n }, (_, i) => ({
      amount: 1,
      quote: { quote: `quote-${i}` },
    }));
  }

  test('throws when entries.length exceeds max_batch_size', async () => {
    overrideMintInfo({ max_batch_size: 2 });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();

    await expect(wallet.prepareBatchMint('bolt11', makeQuotes(3))).rejects.toThrow(
      /batch size 3.*limit of 2/,
    );
  });

  test('does not throw when entries.length equals max_batch_size', async () => {
    overrideMintInfo({ max_batch_size: 3 });
    makeBatchHandler();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();

    const preview = await wallet.prepareBatchMint('bolt11', makeQuotes(3));
    expect(preview.payload.quotes).toHaveLength(3);
  });

  test('does not throw when entries.length is below max_batch_size', async () => {
    overrideMintInfo({ max_batch_size: 5 });
    makeBatchHandler();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();

    const preview = await wallet.prepareBatchMint('bolt11', makeQuotes(2));
    expect(preview.payload.quotes).toHaveLength(2);
  });

  test('does not throw when mint does not advertise NUT-29 info', async () => {
    // Default mint info has no nuts['29'] key
    makeBatchHandler();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();

    const preview = await wallet.prepareBatchMint('bolt11', makeQuotes(10));
    expect(preview.payload.quotes).toHaveLength(10);
  });

  function mockLogger() {
    return {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      log: vi.fn(),
    };
  }

  test('logs a warning when method is not in advertised NUT-29 methods', async () => {
    overrideMintInfo({ methods: ['bolt12'] });
    const spyLogger = mockLogger();
    const wallet = new Wallet(mintUrl, { unit, logger: spyLogger });
    await wallet.loadMint();

    await wallet.prepareBatchMint('bolt11', makeQuotes(1));
    expect(spyLogger.warn).toHaveBeenCalledWith(expect.stringContaining("method 'bolt11'"));
  });

  test('does not warn when method IS in advertised NUT-29 methods', async () => {
    overrideMintInfo({ methods: ['bolt11', 'bolt12'] });
    const spyLogger = mockLogger();
    const wallet = new Wallet(mintUrl, { unit, logger: spyLogger });
    await wallet.loadMint();

    await wallet.prepareBatchMint('bolt11', makeQuotes(1));
    expect(spyLogger.warn).not.toHaveBeenCalled();
  });

  test('does not warn when nuts["29"].methods is absent', async () => {
    overrideMintInfo({ max_batch_size: 10 });
    const spyLogger = mockLogger();
    const wallet = new Wallet(mintUrl, { unit, logger: spyLogger });
    await wallet.loadMint();

    await wallet.prepareBatchMint('bolt11', makeQuotes(2));
    expect(spyLogger.warn).not.toHaveBeenCalled();
  });

  test('throws when entries exceed ABSOLUTE_MAX_BATCH_SIZE even without NUT-29 info', async () => {
    // Default mint info has no nuts['29'] key — absolute cap still applies
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();

    await expect(wallet.prepareBatchMint('bolt11', makeQuotes(101))).rejects.toThrow(
      /batch size 101.*internal cap.*100/,
    );
  });

  test('throws when entries exceed ABSOLUTE_MAX_BATCH_SIZE even with higher mint limit', async () => {
    // Mint advertises 500, but normalizeNut29 clamps to 100.
    // Belt-and-suspenders: even if clamping were skipped, the wallet enforces the cap.
    overrideMintInfo({ max_batch_size: 500 });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();

    await expect(wallet.prepareBatchMint('bolt11', makeQuotes(101))).rejects.toThrow(
      /batch size 101.*limit of 100/,
    );
  });
});

describe('generic mint/melt methods', () => {
  describe('wallet.createMintQuote / checkMintQuote', () => {
    test('createMintQuote with custom method hits /v1/mint/quote/{method}', async () => {
      server.use(
        http.post(mintUrl + '/v1/mint/quote/bacs', () =>
          HttpResponse.json({
            quote: 'bacs-quote-1',
            request: 'CASHU-REF-ABC',
            unit: 'gbp',
            amount: 5000,
            reference: 'REF-123',
            state: MintQuoteState.UNPAID,
            expiry: null,
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      type BacsMintQuoteRes = MintQuoteBaseResponse & {
        amount: Amount;
        reference: string;
        state: MintQuoteState;
      };

      const quote = await wallet.createMintQuote<BacsMintQuoteRes>(
        'bacs',
        {
          amount: 5000n,
          sort_code: '12-34-56',
        },
        {
          normalize: (raw) => ({
            ...(raw as BacsMintQuoteRes),
            amount: Amount.from(raw.amount as AmountLike),
          }),
        },
      );

      expect(quote.quote).toBe('bacs-quote-1');
      expect(quote.request).toBe('CASHU-REF-ABC');
      expect(quote.reference).toBe('REF-123');
      expect(quote.amount).toBeInstanceOf(Amount);
      expect(quote.amount.toBigInt()).toBe(5000n);
    });

    test('createMintQuote forces wallet unit over payload unit', async () => {
      server.use(
        http.post(mintUrl + '/v1/mint/quote/bacs', async ({ request }) => {
          const body = (await request.json()) as { unit: string };
          return HttpResponse.json({
            quote: 'bacs-quote-unit',
            request: 'CASHU-REF-UNIT',
            unit: body.unit,
          });
        }),
      );
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      const quote = await wallet.createMintQuote('bacs', {
        amount: 5000n,
        unit: 'usd',
      });

      expect(quote.unit).toBe('sat');
    });

    test('createMintQuote for bolt11 delegates correctly', async () => {
      server.use(
        http.post(mintUrl + '/v1/mint/quote/bolt11', () =>
          HttpResponse.json({
            quote: 'bolt11-quote-1',
            request: 'lnbc1000...',
            unit: 'sat',
            amount: 1000,
            state: MintQuoteState.UNPAID,
            expiry: 3600,
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      const quote = await wallet.createMintQuoteBolt11(1000);

      expect(quote.quote).toBe('bolt11-quote-1');
      expect(quote.amount).toBeInstanceOf(Amount);
      expect(quote.amount.toBigInt()).toBe(1000n);
    });

    test('checkMintQuoteBolt11 does not merge caller fields over mint response', async () => {
      server.use(
        http.get(mintUrl + '/v1/mint/quote/bolt11/bolt11-quote-merge', () =>
          HttpResponse.json({
            quote: 'bolt11-quote-merge',
            request: 'lnbc-remote',
            unit: 'sat',
            amount: 1000,
            state: MintQuoteState.PAID,
            expiry: 3600,
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      const quote = await wallet.checkMintQuoteBolt11({
        quote: 'bolt11-quote-merge',
        request: 'lnbc-local',
        unit: 'usd',
        amount: Amount.from(1),
        state: MintQuoteState.UNPAID,
        expiry: null,
      });

      expect(quote.request).toBe('lnbc-remote');
      expect(quote.unit).toBe('sat');
    });

    test('checkMintQuote with custom method hits /v1/mint/quote/{method}/{id}', async () => {
      server.use(
        http.get(mintUrl + '/v1/mint/quote/bacs/bacs-quote-1', () =>
          HttpResponse.json({
            quote: 'bacs-quote-1',
            request: 'CASHU-REF-ABC',
            unit: 'gbp',
            amount: 5000,
            reference: 'REF-123',
            state: MintQuoteState.PAID,
            expiry: null,
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      type BacsMintQuoteRes = MintQuoteBaseResponse & {
        amount: Amount;
        reference: string;
        state: MintQuoteState;
      };

      const quote = await wallet.checkMintQuote<BacsMintQuoteRes>('bacs', 'bacs-quote-1', {
        normalize: (raw) => ({
          ...(raw as BacsMintQuoteRes),
          amount: Amount.from(raw.amount as AmountLike),
        }),
      });

      expect(quote.quote).toBe('bacs-quote-1');
      expect(quote.state).toBe(MintQuoteState.PAID);
      expect(quote.amount).toBeInstanceOf(Amount);
    });

    test('checkMintQuote accepts quote object', async () => {
      server.use(
        http.get(mintUrl + '/v1/mint/quote/bacs/bacs-quote-2', () =>
          HttpResponse.json({
            quote: 'bacs-quote-2',
            request: 'REF',
            unit: 'gbp',
            state: MintQuoteState.UNPAID,
            expiry: null,
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      const quote = await wallet.checkMintQuote('bacs', { quote: 'bacs-quote-2' });
      expect(quote.quote).toBe('bacs-quote-2');
    });
  });

  describe('wallet.mintProofs', () => {
    test('mintProofs with custom method hits /v1/mint/{method}', async () => {
      server.use(
        http.post(mintUrl + '/v1/mint/bacs', () => {
          return HttpResponse.json({
            signatures: [
              {
                id: '00bd033559de27d0',
                amount: 1,
                C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
              },
            ],
          });
        }),
      );
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      const customQuote = { quote: 'custom-mint-quote' };
      const proofs = await wallet.mintProofs('bacs', 1, customQuote);

      expect(proofs).toHaveLength(1);
      expect(proofs[0]).toMatchObject({ amount: Amount.from(1), id: '00bd033559de27d0' });
    });

    test('mintProofs rejects quote objects in the wrong wallet unit', async () => {
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      await expect(
        wallet.mintProofs('bacs', 1, {
          quote: 'wrong-unit-mint-quote',
          request: 'req',
          unit: 'usd',
        }),
      ).rejects.toThrow("Quote unit 'usd' does not match wallet unit 'sat'");
    });
  });

  describe('wallet.createMeltQuote / checkMeltQuote', () => {
    test('createMeltQuote with custom method hits /v1/melt/quote/{method}', async () => {
      server.use(
        http.post(mintUrl + '/v1/melt/quote/bacs', () =>
          HttpResponse.json({
            quote: 'bacs-melt-1',
            amount: 5000,
            unit: 'gbp',
            state: MeltQuoteState.UNPAID,
            expiry: 3600,
            fee_estimate: 50,
            reference: 'BACS-PAY-REF',
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      type BacsMeltQuoteRes = MeltQuoteBaseResponse & {
        fee_estimate: Amount;
        reference: string;
      };

      const quote = await wallet.createMeltQuote<BacsMeltQuoteRes>(
        'bacs',
        {
          request: 'GB29NWBK60161331926819',
          amount: 5000n,
        },
        {
          normalize: (raw) => ({
            ...(raw as BacsMeltQuoteRes),
            fee_estimate: Amount.from(raw.fee_estimate as AmountLike),
          }),
        },
      );

      expect(quote.quote).toBe('bacs-melt-1');
      expect(quote.amount).toBeInstanceOf(Amount);
      expect(quote.amount.toBigInt()).toBe(5000n);
      expect(quote.fee_estimate).toBeInstanceOf(Amount);
      expect(quote.fee_estimate.toBigInt()).toBe(50n);
      expect(quote.reference).toBe('BACS-PAY-REF');
    });

    test('createMeltQuote forces wallet unit over payload unit', async () => {
      server.use(
        http.post(mintUrl + '/v1/melt/quote/bacs', async ({ request }) => {
          const body = (await request.json()) as { unit: string };
          return HttpResponse.json({
            quote: 'bacs-melt-unit',
            amount: 5000,
            unit: body.unit,
            state: MeltQuoteState.UNPAID,
            expiry: 3600,
          });
        }),
      );
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      const quote = await wallet.createMeltQuote('bacs', {
        request: 'GB29NWBK60161331926819',
        amount: 5000n,
        unit: 'usd',
      });

      expect(quote.unit).toBe('sat');
    });

    test('checkMeltQuote with custom method hits /v1/melt/quote/{method}/{id}', async () => {
      server.use(
        http.get(mintUrl + '/v1/melt/quote/bacs/bacs-melt-1', () =>
          HttpResponse.json({
            quote: 'bacs-melt-1',
            amount: 5000,
            unit: 'gbp',
            state: MeltQuoteState.PAID,
            expiry: 3600,
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      const quote = await wallet.checkMeltQuote('bacs', 'bacs-melt-1');

      expect(quote.quote).toBe('bacs-melt-1');
      expect(quote.state).toBe(MeltQuoteState.PAID);
      expect(quote.amount).toBeInstanceOf(Amount);
    });

    test('checkMeltQuoteBolt11 does not merge caller fields over mint response', async () => {
      server.use(
        http.get(mintUrl + '/v1/melt/quote/bolt11/bolt11-melt-merge', () =>
          HttpResponse.json({
            quote: 'bolt11-melt-merge',
            amount: 5000,
            unit: 'sat',
            state: MeltQuoteState.PAID,
            expiry: 3600,
            fee_reserve: 50,
            request: 'lnbc-remote',
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      const quote = await wallet.checkMeltQuoteBolt11({
        quote: 'bolt11-melt-merge',
        amount: Amount.from(1),
        unit: 'usd',
        state: MeltQuoteState.UNPAID,
        expiry: 1,
        fee_reserve: Amount.from(1),
        request: 'lnbc-local',
        payment_preimage: null,
      });

      expect(quote.request).toBe('lnbc-remote');
      expect(quote.unit).toBe('sat');
    });

    test('checkMeltQuote accepts quote object', async () => {
      server.use(
        http.get(mintUrl + '/v1/melt/quote/bacs/bacs-melt-2', () =>
          HttpResponse.json({
            quote: 'bacs-melt-2',
            amount: 100,
            unit: 'gbp',
            state: MeltQuoteState.UNPAID,
            expiry: 3600,
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      const quote = await wallet.checkMeltQuote('bacs', { quote: 'bacs-melt-2' });
      expect(quote.quote).toBe('bacs-melt-2');
    });
  });

  describe('wallet.meltProofs', () => {
    test('meltProofs with custom method hits /v1/melt/{method}', async () => {
      server.use(
        http.post(mintUrl + '/v1/melt/bacs', () => {
          return HttpResponse.json({
            quote: 'bacs-melt-1',
            amount: 10,
            unit: 'sat',
            state: MeltQuoteState.PAID,
            expiry: 3600,
            change: [
              {
                id: '00bd033559de27d0',
                amount: 1,
                C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
              },
            ],
          });
        }),
      );
      const wallet = new Wallet(mint, { unit, logger });
      await wallet.loadMint();

      const meltQuote: Pick<MeltQuoteBaseResponse, 'amount' | 'quote' | 'state'> = {
        quote: 'bacs-melt-1',
        amount: Amount.from(10),
        state: MeltQuoteState.UNPAID,
      };
      const proofsToSend: Proof[] = [
        { id: '00bd033559de27d0', amount: Amount.from(8), secret: 'secret1', C: 'C1' },
        { id: '00bd033559de27d0', amount: Amount.from(5), secret: 'secret2', C: 'C2' },
      ];

      const response = await wallet.meltProofs('bacs', meltQuote, proofsToSend);

      expect(response.quote.state).toBe(MeltQuoteState.PAID);
      expect(response.change).toHaveLength(1);
      expect(response.change[0]).toMatchObject({ amount: Amount.from(1), id: '00bd033559de27d0' });
    });

    test('meltProofs rejects quote objects in the wrong wallet unit', async () => {
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      await expect(
        wallet.meltProofs(
          'bacs',
          {
            quote: 'wrong-unit-melt-quote',
            amount: Amount.from(10),
            unit: 'usd',
          },
          [{ id: '00bd033559de27d0', amount: Amount.from(10), secret: 'secret1', C: 'C1' }],
        ),
      ).rejects.toThrow("Quote unit 'usd' does not match wallet unit 'sat'");
    });
  });

  describe('invalid method validation', () => {
    test('rejects invalid method strings', async () => {
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      await expect(wallet.createMintQuote('INVALID', { amount: 1n })).rejects.toThrow(
        'Invalid mint quote method',
      );

      await expect(wallet.createMintQuote('has spaces', { amount: 1n })).rejects.toThrow(
        'Invalid mint quote method',
      );

      await expect(wallet.createMeltQuote('has/slash', { request: 'x' })).rejects.toThrow(
        'Invalid melt quote method',
      );
    });
  });

  describe('normalizer stacking', () => {
    test('bolt11 normalization is applied automatically via generic', async () => {
      server.use(
        http.post(mintUrl + '/v1/melt/quote/bolt11', () =>
          HttpResponse.json({
            quote: 'bolt11-melt-via-generic',
            amount: 100,
            unit: 'sat',
            fee_reserve: 5,
            state: MeltQuoteState.UNPAID,
            expiry: 3600,
            payment_preimage: null,
            request: 'lnbc100...',
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      // Use the generic method with bolt11 — should auto-apply bolt normalization
      const quote = await wallet.createMeltQuote<MeltQuoteBolt11Response>('bolt11', {
        request: 'lnbc100...',
      });

      expect(quote.amount).toBeInstanceOf(Amount);
      expect(quote.amount.toBigInt()).toBe(100n);
      expect(quote.fee_reserve).toBeInstanceOf(Amount);
      expect(quote.fee_reserve.toBigInt()).toBe(5n);
      expect(quote.request).toBe('lnbc100...');
    });

    test('custom normalize runs after base normalization', async () => {
      server.use(
        http.post(mintUrl + '/v1/melt/quote/swift', () =>
          HttpResponse.json({
            quote: 'swift-1',
            amount: 200,
            unit: 'usd',
            state: MeltQuoteState.UNPAID,
            expiry: 7200,
            processing_fee: 15,
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      type SwiftRes = MeltQuoteBaseResponse & { processing_fee: Amount };

      const quote = await wallet.createMeltQuote<SwiftRes>(
        'swift',
        {
          request: 'SWIFT-REF',
          amount: 200n,
        },
        {
          normalize: (raw) => ({
            ...(raw as SwiftRes),
            processing_fee: Amount.from(raw.processing_fee as AmountLike),
          }),
        },
      );

      // Base fields normalized automatically
      expect(quote.amount).toBeInstanceOf(Amount);
      expect(quote.amount.toBigInt()).toBe(200n);
      // Custom field normalized by callback
      expect(quote.processing_fee).toBeInstanceOf(Amount);
      expect(quote.processing_fee.toBigInt()).toBe(15n);
    });
  });
});
