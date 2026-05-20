import { HttpResponse, http } from 'msw';
import { test, describe, expect, vi } from 'vitest';

import {
  Wallet,
  type Proof,
  type MeltQuoteBolt11Response,
  type MeltQuoteBaseResponse,
  type MeltQuoteOnchainResponse,
  type MintQuoteBaseResponse,
  type MintQuoteBolt12Response,
  type MintQuoteOnchainResponse,
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
const mintInfoRespWithNut12 = {
  ...mintInfoResp,
  nuts: { ...mintInfoResp.nuts, 12: { supported: true } },
};

function normalizeProofsForTest(proofs: Parameters<Wallet['signP2PKProofs']>[0]): Proof[] {
  return proofs.map((proof) => ({ ...proof, amount: Amount.from(proof.amount) }));
}

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

  test('prepareMint accepts expiry: 0 as "no expiry" (CDK quirk)', async () => {
    // Spec says expiry is <int|null> with null meaning "no expiry". CDK emits 0
    // for the same meaning. Treat 0 as null rather than "expired in 1970".
    server.use(
      http.post(mintUrl + '/v1/mint/bolt11', () =>
        HttpResponse.json({
          signatures: [
            {
              id: '00bd033559de27d0',
              amount: 1,
              C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
            },
          ],
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quote = {
      quote: 'no-expiry-quote',
      request: 'lnbc...',
      amount: Amount.from(1),
      unit: 'sat',
      state: MintQuoteState.PAID,
      expiry: 0,
    } as unknown as MintQuoteBolt11Response;

    const preview = await wallet.prepareMint('bolt11', 1, quote);
    const proofs = await wallet.completeMint(preview);
    expect(proofs).toHaveLength(1);
  });

  test('completeMint rejects missing DLEQ when mint advertises NUT-12', async () => {
    server.use(
      http.get(mintUrl + '/v1/info', () => HttpResponse.json(mintInfoRespWithNut12)),
      http.post(mintUrl + '/v1/mint/bolt11', () =>
        HttpResponse.json({
          signatures: [
            {
              id: '00bd033559de27d0',
              amount: 1,
              C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
            },
          ],
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit, requireSigDleq: true });
    await wallet.loadMint();

    const preview = await wallet.prepareMint('bolt11', 1, {
      quote: 'quote-dleq-required',
      request: 'lnbc...',
      amount: Amount.from(1),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    });

    await expect(wallet.completeMint(preview)).rejects.toThrow(
      'Mint supports NUT-12, but returned a signature without DLEQ proof',
    );
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

  test('completeBatchMint rejects missing DLEQ when mint advertises NUT-12', async () => {
    server.use(
      http.get(mintUrl + '/v1/info', () => HttpResponse.json(mintInfoRespWithNut12)),
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
    const wallet = new Wallet(mint, { unit, requireSigDleq: true });
    await wallet.loadMint();

    const batchPreview = await wallet.prepareBatchMint('bolt11', [
      {
        amount: 1,
        quote: {
          quote: 'quote-a',
          request: 'lnbc...',
          amount: Amount.from(1),
          unit: 'sat',
          state: MintQuoteState.UNPAID,
          expiry: null,
        },
      },
    ]);

    await expect(wallet.completeBatchMint(batchPreview)).rejects.toThrow(
      'Mint supports NUT-12, but returned a signature without DLEQ proof',
    );
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

    test('createMintQuoteOnchain returns normalized onchain quote', async () => {
      server.use(
        http.post(mintUrl + '/v1/mint/quote/onchain', async ({ request }) => {
          const body = (await request.json()) as { unit: string; pubkey: string };
          expect(body).toEqual({
            unit: 'sat',
            pubkey: '02f01fd65b16d80f7eff6ef2e0b3c5a8028b745796bbdc06cb503022262b2ebb51',
          });
          return HttpResponse.json({
            quote: 'onchain-mint-1',
            request: 'bc1qdeposit',
            unit: body.unit,
            pubkey: body.pubkey,
            state: MintQuoteState.UNPAID,
            expiry: null,
            amount_paid: 5,
            amount_issued: 3,
          });
        }),
      );
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      const quote = await wallet.createMintQuoteOnchain(
        '02f01fd65b16d80f7eff6ef2e0b3c5a8028b745796bbdc06cb503022262b2ebb51',
      );

      expect(quote.quote).toBe('onchain-mint-1');
      expect(quote.amount_paid).toEqual(Amount.from(5));
      expect(quote.amount_issued).toEqual(Amount.from(3));
    });

    test('checkMintQuoteOnchain returns normalized onchain quote', async () => {
      server.use(
        http.get(mintUrl + '/v1/mint/quote/onchain/onchain-mint-check', () =>
          HttpResponse.json({
            quote: 'onchain-mint-check',
            request: 'bc1qdeposit',
            unit: 'sat',
            pubkey: '02f01fd65b16d80f7eff6ef2e0b3c5a8028b745796bbdc06cb503022262b2ebb51',
            state: MintQuoteState.PAID,
            expiry: null,
            amount_paid: 5,
            amount_issued: 4,
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      const quote = await wallet.checkMintQuoteOnchain('onchain-mint-check');

      expect(quote.quote).toBe('onchain-mint-check');
      expect(quote.amount_paid).toEqual(Amount.from(5));
      expect(quote.amount_issued).toEqual(Amount.from(4));
    });

    test('checkMeltQuoteOnchain returns normalized onchain melt quote', async () => {
      server.use(
        http.get(mintUrl + '/v1/melt/quote/onchain/onchain-melt-check', () =>
          HttpResponse.json({
            quote: 'onchain-melt-check',
            request: 'bc1qrecipient',
            amount: 10,
            unit: 'sat',
            fee_options: [{ fee_index: 0, fee_reserve: 2, estimated_blocks: 6 }],
            selected_fee_index: 0,
            state: MeltQuoteState.PAID,
            expiry: 3600,
            outpoint: 'txid:0',
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      const quote = await wallet.checkMeltQuoteOnchain('onchain-melt-check');

      expect(quote.quote).toBe('onchain-melt-check');
      expect(quote.amount).toEqual(Amount.from(10));
      expect(quote.fee_options[0].fee_reserve).toEqual(Amount.from(2));
      expect(quote.selected_fee_index).toBe(0);
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

    test('prepareMint rejects bolt12 amounts above paid minus issued amount', async () => {
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      const quote: MintQuoteBolt12Response = {
        quote: 'bolt12-partial',
        request: 'lno1...',
        unit: 'sat',
        amount: Amount.from(5),
        pubkey: '02f01fd65b16d80f7eff6ef2e0b3c5a8028b745796bbdc06cb503022262b2ebb51',
        state: MintQuoteState.PAID,
        expiry: null,
        amount_paid: Amount.from(5),
        amount_issued: Amount.from(3),
      };

      await expect(
        wallet.prepareMint('bolt12', 3, quote, {
          privkey: '01'.repeat(32),
        }),
      ).rejects.toThrow('Mint quote bolt12-partial has only 2 available to mint; requested 3');
    });

    test('prepareMint keeps string-only quote support without available amount fields', async () => {
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      const preview = await wallet.prepareMint(
        'bolt12',
        3,
        { quote: 'stored-bolt12' },
        {
          privkey: '01'.repeat(32),
        },
      );

      expect(preview.method).toBe('bolt12');
      expect(preview.payload.quote).toBe('stored-bolt12');
    });

    test('mintProofsOnchain rejects amounts above paid minus issued amount', async () => {
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      const quote: MintQuoteOnchainResponse = {
        quote: 'onchain-partial',
        request: 'bc1qdeposit',
        unit: 'sat',
        pubkey: '02f01fd65b16d80f7eff6ef2e0b3c5a8028b745796bbdc06cb503022262b2ebb51',
        expiry: null,
        amount_paid: Amount.from(5),
        amount_issued: Amount.from(3),
      };

      await expect(wallet.mintProofsOnchain(3, quote, '01'.repeat(32))).rejects.toThrow(
        'Mint quote onchain-partial has only 2 available to mint; requested 3',
      );
    });

    test('mintProofsOnchain signs and mints onchain proofs', async () => {
      const privkey = 'd56ce4e446a85bbdaa547b4ec2b073d40ff802831352b8272b7dd7a4de5a7cac';
      const pubkey = '026f596046564942b7e879ec9c2b2be5bd5072679237eb4e5033eb4b924535d756';
      server.use(
        http.post(mintUrl + '/v1/mint/onchain', async ({ request }) => {
          const body = (await request.json()) as {
            quote: string;
            outputs: Array<{ amount: number }>;
            signature?: string;
          };
          expect(body.quote).toBe('onchain-mint-paid');
          expect(body.outputs).toHaveLength(1);
          expect(body.outputs[0].amount).toBe(1);
          expect(body.signature).toEqual(expect.any(String));
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
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      const quote: MintQuoteOnchainResponse = {
        quote: 'onchain-mint-paid',
        request: 'bc1qdeposit',
        unit: 'sat',
        pubkey,
        expiry: null,
        amount_paid: Amount.from(1),
        amount_issued: Amount.from(0),
      };

      const proofs = await wallet.mintProofsOnchain(1, quote, privkey);

      expect(proofs).toHaveLength(1);
      expect(proofs[0]).toMatchObject({ amount: Amount.from(1), id: '00bd033559de27d0' });
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

    test('createMeltQuoteOnchain returns a single quote with normalized fee options', async () => {
      server.use(
        http.post(mintUrl + '/v1/melt/quote/onchain', async ({ request }) => {
          const body = (await request.json()) as { request: string; unit: string; amount: number };
          expect(body).toEqual({
            request: 'bc1qrecipient',
            unit: 'sat',
            amount: 10,
          });
          return HttpResponse.json({
            quote: 'onchain-melt-1',
            request: body.request,
            amount: body.amount,
            unit: body.unit,
            fee_options: [
              { fee_index: 0, fee_reserve: 5, estimated_blocks: 1 },
              { fee_index: 1, fee_reserve: 2, estimated_blocks: 6 },
            ],
            selected_fee_index: null,
            state: MeltQuoteState.UNPAID,
            expiry: 3600,
            outpoint: null,
          });
        }),
      );
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      const quote = await wallet.createMeltQuoteOnchain('bc1qrecipient', 10);

      expect(quote.quote).toBe('onchain-melt-1');
      expect(quote.amount).toEqual(Amount.from(10));
      expect(quote.fee_options[0].fee_reserve).toEqual(Amount.from(5));
      expect(quote.fee_options[1]).toMatchObject({ fee_index: 1, estimated_blocks: 6 });
    });

    test('createMeltQuoteOnchain accepts response with omitted nullable fields', async () => {
      // CDK and other mints commonly omit nullable fields when they have no value,
      // rather than emitting explicit null. The spec uses `<X | null>` ambiguously,
      // so cashu-ts treats absent as null on the wire (Postel-style).
      server.use(
        http.post(mintUrl + '/v1/melt/quote/onchain', () =>
          HttpResponse.json({
            quote: 'onchain-melt-omitted',
            request: 'bc1qrecipient',
            amount: 10,
            unit: 'sat',
            fee_options: [{ fee_index: 0, fee_reserve: 2, estimated_blocks: 6 }],
            state: MeltQuoteState.UNPAID,
            expiry: 3600,
            // selected_fee_index and outpoint omitted entirely
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      const quote = await wallet.createMeltQuoteOnchain('bc1qrecipient', 10);
      expect(quote.selected_fee_index).toBeNull();
      expect(quote.outpoint).toBeNull();
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

    test('meltProofsOnchain sends selected fee_index with NUT-08 outputs', async () => {
      server.use(
        http.post(mintUrl + '/v1/melt/onchain', async ({ request }) => {
          const body = (await request.json()) as {
            quote: string;
            fee_index: number;
            inputs: Proof[];
            outputs?: unknown;
          };
          expect(body.quote).toBe('onchain-melt-1');
          expect(body.fee_index).toBe(1);
          expect(body.inputs).toHaveLength(2);
          expect(body.outputs).toEqual(expect.any(Array));
          return HttpResponse.json({
            quote: 'onchain-melt-1',
            request: 'bc1qrecipient',
            amount: 10,
            unit: 'sat',
            fee_options: [
              { fee_index: 0, fee_reserve: 5, estimated_blocks: 1 },
              { fee_index: 1, fee_reserve: 2, estimated_blocks: 6 },
            ],
            selected_fee_index: 1,
            state: MeltQuoteState.PAID,
            expiry: 3600,
            outpoint: 'txid:0',
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
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      const meltQuote: MeltQuoteOnchainResponse = {
        quote: 'onchain-melt-1',
        request: 'bc1qrecipient',
        amount: Amount.from(10),
        unit: 'sat',
        fee_options: [
          { fee_index: 0, fee_reserve: Amount.from(5), estimated_blocks: 1 },
          { fee_index: 1, fee_reserve: Amount.from(2), estimated_blocks: 6 },
        ],
        selected_fee_index: null,
        state: MeltQuoteState.UNPAID,
        expiry: 3600,
        outpoint: null,
      };
      const proofsToSend: Proof[] = [
        { id: '00bd033559de27d0', amount: Amount.from(8), secret: 'secret1', C: 'C1' },
        { id: '00bd033559de27d0', amount: Amount.from(4), secret: 'secret2', C: 'C2' },
      ];

      const response = await wallet.meltProofsOnchain(meltQuote, proofsToSend, 1);

      expect(response.quote.state).toBe(MeltQuoteState.PAID);
      expect(response.quote.selected_fee_index).toBe(1);
      expect(response.quote.outpoint).toBe('txid:0');
      expect(response.change).toHaveLength(1);
      expect(response.change[0]).toMatchObject({ amount: Amount.from(1), id: '00bd033559de27d0' });
      // outputData is empty when change came back immediately — no recovery needed.
      expect(response.outputData).toEqual([]);
    });

    test('meltProofsOnchain rejects unknown fee_index option', async () => {
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();
      const meltQuote: MeltQuoteOnchainResponse = {
        quote: 'onchain-melt-unknown-fee',
        request: 'bc1qrecipient',
        amount: Amount.from(10),
        unit: 'sat',
        fee_options: [{ fee_index: 0, fee_reserve: Amount.from(2), estimated_blocks: 6 }],
        selected_fee_index: null,
        state: MeltQuoteState.UNPAID,
        expiry: 3600,
        outpoint: null,
      };
      const proofsToSend: Proof[] = [
        { id: '00bd033559de27d0', amount: Amount.from(12), secret: 'secret1', C: 'C1' },
      ];

      await expect(wallet.meltProofsOnchain(meltQuote, proofsToSend, 7)).rejects.toThrow(
        'feeIndex must match an onchain melt quote fee option',
      );
    });

    test('meltProofsOnchain rejects proofs below amount, selected fee, and input fee', async () => {
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();
      const meltQuote: MeltQuoteOnchainResponse = {
        quote: 'onchain-melt-underfunded',
        request: 'bc1qrecipient',
        amount: Amount.from(10),
        unit: 'sat',
        fee_options: [{ fee_index: 0, fee_reserve: Amount.from(2), estimated_blocks: 6 }],
        selected_fee_index: null,
        state: MeltQuoteState.UNPAID,
        expiry: 3600,
        outpoint: null,
      };
      const proofsToSend: Proof[] = [
        { id: '00bd033559de27d0', amount: Amount.from(11), secret: 'secret1', C: 'C1' },
      ];

      await expect(wallet.meltProofsOnchain(meltQuote, proofsToSend, 0)).rejects.toThrow(
        'Not enough proofs to cover amount + fee',
      );
    });

    test('meltProofsOnchain signs SIG_ALL proofs with outputs and quote id', async () => {
      server.use(
        http.post(mintUrl + '/v1/melt/onchain', async ({ request }) => {
          const body = (await request.json()) as {
            quote: string;
            fee_index: number;
            outputs?: unknown;
          };
          expect(body.outputs).toEqual(expect.any(Array));
          return HttpResponse.json({
            quote: body.quote,
            request: 'bc1qrecipient',
            amount: 10,
            unit: 'sat',
            fee_options: [{ fee_index: body.fee_index, fee_reserve: 2, estimated_blocks: 6 }],
            selected_fee_index: body.fee_index,
            state: MeltQuoteState.PENDING,
            expiry: 3600,
            outpoint: 'txid:0',
          });
        }),
      );
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();
      const signSpy = vi.spyOn(wallet, 'signP2PKProofs');
      signSpy.mockImplementation((proofs) => normalizeProofsForTest(proofs));

      const sigAllSecret =
        '["P2PK",{"nonce":"aa","data":"02f01fd65b16d80f7eff6ef2e0b3c5a8028b745796bbdc06cb503022262b2ebb51","tags":[["sigflag","SIG_ALL"]]}]';
      const meltQuote: MeltQuoteOnchainResponse = {
        quote: 'onchain-melt-sigall',
        request: 'bc1qrecipient',
        amount: Amount.from(10),
        unit: 'sat',
        fee_options: [{ fee_index: 0, fee_reserve: Amount.from(2), estimated_blocks: 6 }],
        selected_fee_index: null,
        state: MeltQuoteState.UNPAID,
        expiry: 3600,
        outpoint: null,
      };
      const proofsToSend: Proof[] = [
        {
          id: '00bd033559de27d0',
          amount: Amount.from(12),
          secret: sigAllSecret,
          C: 'C1',
        },
      ];

      await wallet.meltProofsOnchain(meltQuote, proofsToSend, 0, { privkey: 'privkey' });

      expect(signSpy).toHaveBeenCalledWith(
        expect.any(Array),
        'privkey',
        expect.any(Array),
        'onchain-melt-sigall',
      );
    });

    test('meltProofsOnchain retains outputData for deferred change recovery', async () => {
      let seenBody: { outputs?: unknown[] } | undefined;
      server.use(
        http.post(mintUrl + '/v1/melt/onchain', async ({ request }) => {
          seenBody = (await request.json()) as typeof seenBody;
          return HttpResponse.json({
            quote: 'onchain-melt-async',
            request: 'bc1qrecipient',
            amount: 10,
            unit: 'sat',
            fee_options: [{ fee_index: 0, fee_reserve: 2, estimated_blocks: 6 }],
            selected_fee_index: 0,
            state: MeltQuoteState.PENDING,
            expiry: 3600,
            outpoint: null,
          });
        }),
      );
      const wallet = new Wallet(mint, { unit: 'sat' });
      await wallet.loadMint();
      const meltQuote: MeltQuoteOnchainResponse = {
        quote: 'onchain-melt-async',
        request: 'bc1qrecipient',
        amount: Amount.from(10),
        unit: 'sat',
        fee_options: [{ fee_index: 0, fee_reserve: Amount.from(2), estimated_blocks: 6 }],
        selected_fee_index: null,
        state: MeltQuoteState.UNPAID,
        expiry: 3600,
        outpoint: null,
      };
      const proofsToSend: Proof[] = [
        { id: '00bd033559de27d0', amount: Amount.from(8), secret: 'secret1', C: 'C1' },
        { id: '00bd033559de27d0', amount: Amount.from(4), secret: 'secret2', C: 'C2' },
      ];

      const response = await wallet.meltProofsOnchain(meltQuote, proofsToSend, 0);

      expect(response.quote.state).toBe(MeltQuoteState.PENDING);
      expect(response.change).toHaveLength(0);
      // outputData must match the outputs the mint received for later createMeltChangeProofs().
      expect(response.outputData.length).toBe(seenBody?.outputs?.length);
      expect(response.outputData.length).toBeGreaterThan(0);
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

    test('bolt11 melt quote with omitted payment_preimage is coerced to null', async () => {
      server.use(
        http.post(mintUrl + '/v1/melt/quote/bolt11', () =>
          HttpResponse.json({
            quote: 'bolt11-melt-no-preimage',
            amount: 100,
            unit: 'sat',
            fee_reserve: 5,
            state: MeltQuoteState.UNPAID,
            expiry: 3600,
            request: 'lnbc100...',
            // payment_preimage omitted — spec says `<str | null>`; mints often omit pre-payment
          }),
        ),
      );
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();

      const quote = await wallet.createMeltQuote<MeltQuoteBolt11Response>('bolt11', {
        request: 'lnbc100...',
      });

      expect(quote.payment_preimage).toBeNull();
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
