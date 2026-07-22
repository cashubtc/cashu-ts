import { hexToBytes } from '@noble/curves/utils.js';
import { HttpResponse, http } from 'msw';
import { test, describe, expect, vi } from 'vitest';

import {
  Wallet,
  KeyChain,
  OutputData,
  Amount,
  MintQuoteState,
  MeltQuoteState,
  createEphemeralCounterSource,
  type Proof,
  type OutputType,
  type MintQuoteBolt11Response,
  type MintQuoteBolt12Response,
  type MeltQuoteBolt11Response,
  type MintQuoteBaseResponse,
} from '../../src';

import {
  useTestServer,
  mint,
  mintUrl,
  unit,
  invoice,
  mintInfoResp,
  dummyKeysResp,
  dummyKeysetResp,
} from './_setup';

const server = useTestServer();

const KEYSET_ID = '00bd033559de27d0';
const SIG_C = '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625';
const SEED = hexToBytes(
  'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
);

// Minimal Keyset-shaped stub for spying keyChain.getKeyset.
function ks(id: string, unitStr = unit, hasKeys = true, fee = 0) {
  return { id, unit: unitStr, hasKeys, fee, isActive: true, hasHexId: true } as never;
}

// Mint info with a single active keyset that charges input fees.
function useFeeKeyset(feePPK: number) {
  server.use(
    http.get(mintUrl + '/v1/keysets', () =>
      HttpResponse.json({
        keysets: [{ id: KEYSET_ID, unit: 'sat', active: true, input_fee_ppk: feePPK }],
      }),
    ),
  );
}

describe('constructor mutants', () => {
  test('rejects a bip39seed that is not a Uint8Array', () => {
    expect(() => new Wallet(mint, { unit, bip39seed: 'not-bytes' as never })).toThrow(
      'bip39seed must be a valid Uint8Array',
    );
  });

  test('secretsPolicy overrides the default rather than being ANDed with it', () => {
    // `options.secretsPolicy ?? this._secretsPolicy`: an explicit 'random' must win even
    // when a seed is present (a `&&` mutant would collapse to the 'auto' default).
    const wallet = new Wallet(mint, { unit, secretsPolicy: 'random', bip39seed: SEED });
    expect(wallet.defaultOutputType().type).toBe('random');
  });

  test('uses a supplied counterSource instead of a fresh ephemeral one', async () => {
    const source = createEphemeralCounterSource({ [KEYSET_ID]: 7 });
    const wallet = new Wallet(mint, { unit, counterSource: source });
    // A mutant that ignores the supplied source starts a new source seeded at 0.
    expect(await wallet.counters.peekNext(KEYSET_ID)).toBe(7);
  });
});

describe('finishInit / getKeyset mutants', () => {
  test('a constructor-bound keyset with a mismatched unit is rejected on load', () => {
    const wallet = new Wallet(mint, { unit, keysetId: '00ffffffffffffff' });
    const cache = KeyChain.mintToCacheDTO(mintUrl, dummyKeysetResp.keysets, dummyKeysResp.keysets);
    vi.spyOn(wallet.keyChain, 'getKeyset').mockReturnValue(ks('00ffffffffffffff', 'eur'));
    expect(() => wallet.loadMintFromCache(mintInfoResp, cache)).toThrow(
      'Keyset unit does not match wallet unit',
    );
  });

  test('getKeyset rejects a keyset whose unit differs from the wallet', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    vi.spyOn(wallet.keyChain, 'getKeyset').mockReturnValue(ks('00cc000000000000', 'eur'));
    expect(() => wallet.getKeyset('00cc000000000000')).toThrow(
      'Keyset unit does not match wallet unit',
    );
  });

  test('getKeyset rejects a keyset with no keys loaded', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    vi.spyOn(wallet.keyChain, 'getKeyset').mockReturnValue(ks('00dd000000000000', unit, false));
    expect(() => wallet.getKeyset('00dd000000000000')).toThrow('Keyset has no keys loaded');
  });
});

describe('_prepareInputsForMint mutants', () => {
  test('completeMelt strips dleq and p2pk_e from the inputs sent to the mint', async () => {
    let sentInputs: Array<Record<string, unknown>> = [];
    server.use(
      http.post(mintUrl + '/v1/melt/bolt11', async ({ request }) => {
        const body = (await request.json()) as { inputs: Array<Record<string, unknown>> };
        sentInputs = body.inputs;
        return HttpResponse.json({
          quote: 'melt-strip',
          amount: 10,
          unit: 'sat',
          fee_reserve: 0,
          state: MeltQuoteState.PAID,
          expiry: 1234567890,
          payment_preimage: 'preimage',
          request: 'bolt11request',
          change: [],
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'melt-strip',
      amount: Amount.from(10),
      fee_reserve: Amount.from(0),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend = [
      {
        id: KEYSET_ID,
        amount: Amount.from(12),
        secret: 'secret1',
        C: 'C1',
        dleq: { s: 'aa', e: 'bb', r: 'cc' },
        p2pk_e: 'deadbeef',
      },
    ] as unknown as Proof[];

    await wallet.meltProofsBolt11(meltQuote, proofsToSend, { nut08Change: false });

    expect(sentInputs).toHaveLength(1);
    expect(sentInputs[0]).not.toHaveProperty('dleq');
    expect(sentInputs[0]).not.toHaveProperty('p2pk_e');
  });

  test('sendOffline with requireDleq retains the dleq on the sent proofs', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const proofs = [
      { id: KEYSET_ID, amount: Amount.from(4), secret: 's4', C: 'C4', dleq: { s: 'a', e: 'b' } },
    ] as unknown as Proof[];

    const { send } = wallet.sendOffline(4, proofs, { requireDleq: true });
    expect(send).toHaveLength(1);
    expect(send[0].dleq).toBeDefined();
  });
});

describe('restore mutants', () => {
  test('restore requires a seed', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    await expect(wallet.restore(0, 3)).rejects.toThrow(
      'Cashu Wallet must be initialized with a seed to use restore',
    );
  });

  test('lastCounterWithSignature is start + index, not start - index', async () => {
    const wallet = new Wallet(mint, { unit, bip39seed: SEED });
    await wallet.loadMint();
    const VALID_POINT = '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422';
    server.use(
      http.post(mintUrl + '/v1/restore', async ({ request }) => {
        const body = (await request.json()) as { outputs: Array<{ B_: string }> };
        return HttpResponse.json({
          outputs: body.outputs,
          signatures: body.outputs.map(() => ({ id: KEYSET_ID, amount: 1, C_: VALID_POINT })),
        });
      }),
    );

    const res = await wallet.restore(5, 3);
    // 3 matching signatures starting at counter 5 → last is 5 + 2 = 7.
    expect(res.lastCounterWithSignature).toBe(7);
  });
});

describe('createMintQuoteBolt11 mutants', () => {
  test('forwards the description and fills the wallet unit when the mint omits it', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt11', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          quote: 'q-desc',
          request: 'lnbc...',
          unit: '', // empty → wallet must substitute its own unit
          amount: 1000,
          state: MintQuoteState.UNPAID,
          expiry: null,
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quote = await wallet.createMintQuoteBolt11(1000, 'a description');
    expect(body.description).toBe('a description');
    expect(quote.unit).toBe('sat');
  });

  test('rejects a description when the mint does not advertise bolt11 description support', async () => {
    server.use(
      http.get(mintUrl + '/v1/info', () =>
        HttpResponse.json({
          ...mintInfoResp,
          nuts: {
            ...mintInfoResp.nuts,
            4: { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
          },
        }),
      ),
      http.post(mintUrl + '/v1/mint/quote/bolt11', () =>
        HttpResponse.json({
          quote: 'q-nodesc',
          request: 'lnbc...',
          unit: 'sat',
          amount: 1000,
          state: MintQuoteState.UNPAID,
          expiry: null,
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(wallet.createMintQuoteBolt11(1000, 'desc')).rejects.toThrow(
      'Mint does not support description for bolt11',
    );
    // No description → the support check must be skipped, so this succeeds.
    await expect(wallet.createMintQuoteBolt11(1000)).resolves.toHaveProperty('quote', 'q-nodesc');
  });
});

describe('createMintQuoteBolt12 mutants', () => {
  test('rejects a description when bolt12 description is unsupported', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    // Default fixture advertises bolt12 mint for sat but not description.
    await expect(wallet.createMintQuoteBolt12('02abcd', { description: 'x' })).rejects.toThrow(
      'Mint does not support description for bolt12',
    );
  });

  test('omits amount and description when called with no options', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt12', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          quote: 'q-bolt12',
          request: 'lno1offer...',
          unit: 'sat',
          pubkey: '02abcd',
          state: MintQuoteState.UNPAID,
          expiry: null,
          amount_paid: 0,
          amount_issued: 0,
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quote = await wallet.createMintQuoteBolt12('02abcd');
    expect(quote.quote).toBe('q-bolt12');
    expect(body.pubkey).toBe('02abcd');
    expect(body.amount).toBeUndefined();
    expect(body.description).toBeUndefined();
  });

  test('rejects when the mint returns a quote locked to a different pubkey', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt12', () =>
        HttpResponse.json({
          quote: 'q-bolt12-other',
          request: 'lno1offer...',
          unit: 'sat',
          pubkey: '02dcba',
          state: MintQuoteState.UNPAID,
          expiry: null,
          amount_paid: 0,
          amount_issued: 0,
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(wallet.createMintQuoteBolt12('02abcd')).rejects.toThrow(
      'Mint quote is not locked to the requested pubkey',
    );
  });

  test('rejects a missing pubkey with a clear error, not a TypeError', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    // A loosely-typed JS caller can omit the required pubkey; fail fast, not on `.toLowerCase()`.
    await expect(wallet.createMintQuoteBolt12(undefined as unknown as string)).rejects.toThrow(
      'A pubkey is required to lock the mint quote',
    );
  });
});

describe('createMintQuoteOnchain mutants', () => {
  test('fills the wallet unit when the mint response omits it', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/quote/onchain', () =>
        HttpResponse.json({
          quote: 'onchain-q',
          request: 'bc1qdeposit',
          unit: '', // empty → wallet fills its unit
          pubkey: '02abcd',
          state: MintQuoteState.UNPAID,
          expiry: null,
          amount_paid: 0,
          amount_issued: 0,
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quote = await wallet.createMintQuoteOnchain('02abcd');
    expect(quote.unit).toBe('sat');
  });

  test('rejects when the mint returns a quote locked to a different pubkey', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/quote/onchain', () =>
        HttpResponse.json({
          quote: 'onchain-q-other',
          request: 'bc1qdeposit',
          unit: 'sat',
          pubkey: '02dcba',
          state: MintQuoteState.UNPAID,
          expiry: null,
          amount_paid: 0,
          amount_issued: 0,
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(wallet.createMintQuoteOnchain('02abcd')).rejects.toThrow(
      'Mint quote is not locked to the requested pubkey',
    );
  });

  test('rejects a missing pubkey with a clear error, not a TypeError', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(wallet.createMintQuoteOnchain(undefined as unknown as string)).rejects.toThrow(
      'A pubkey is required to lock the mint quote',
    );
  });
});

describe('validateMintQuote mutants', () => {
  test('unit handling: mismatched string throws, non-string is ignored', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    expect(() => wallet.validateMintQuote({ quote: 'q', unit: 'usd' })).toThrow(
      "Quote unit 'usd' does not match wallet unit 'sat'",
    );
    // A non-string unit must be ignored (an `||` mutant would wrongly throw).
    expect(() =>
      wallet.validateMintQuote({ quote: 'q', unit: 5 } as unknown as MintQuoteBaseResponse),
    ).not.toThrow();
  });

  test('expiry handling: past throws, zero and future are treated as valid', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const nowSec = Math.floor(Date.now() / 1000);

    expect(() => wallet.validateMintQuote({ quote: 'q', expiry: nowSec - 100 })).toThrow(
      'Mint quote q has expired',
    );
    // 0 means "no expiry" (CDK quirk); a future expiry is still valid.
    expect(() => wallet.validateMintQuote({ quote: 'q', expiry: 0 })).not.toThrow();
    expect(() => wallet.validateMintQuote({ quote: 'q', expiry: nowSec + 3600 })).not.toThrow();
  });
});

describe('validateMintQuoteAvailableAmount mutants', () => {
  test('bolt11 enforces the paid-minus-issued check once a payment event is reported', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    // Accounting applies to every method: a non-zero snapshot caps what can be minted.
    const quote = {
      quote: 'q-bolt11-capped',
      amount_paid: 1,
      amount_issued: 0,
    } as unknown as MintQuoteBolt11Response;
    await expect(wallet.prepareMint('bolt11', 100, quote)).rejects.toThrow(
      'has only 1 available to mint; requested 100',
    );
    // A 0/0 snapshot is indistinguishable from a stale pre-payment quote: defer to the mint.
    const staleQuote = {
      quote: 'q-bolt11-stale',
      amount_paid: 0,
      amount_issued: 0,
    } as unknown as MintQuoteBolt11Response;
    await expect(wallet.prepareMint('bolt11', 100, staleQuote)).resolves.toBeDefined();
  });

  test('bolt12 with amount_paid but no amount_issued returns early', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    // Only one of the two fields present → the guard must return before doing arithmetic.
    const quote = {
      quote: 'q-bolt12-partial',
      amount_paid: 5,
    } as unknown as MintQuoteBolt12Response;
    // The real signal is that prepareMint resolves (the guard early-returns); .method is
    // just the echoed argument.
    await expect(wallet.prepareMint('bolt12', 3, quote)).resolves.toBeDefined();
    const preview = await wallet.prepareMint('bolt12', 3, quote);
    expect(preview.method).toBe('bolt12');
  });
});

describe('createMeltQuoteBolt11 mutants', () => {
  test('sends no amountless options and fills unit and request from the wallet/invoice', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(mintUrl + '/v1/melt/quote/bolt11', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          quote: 'melt-basic',
          amount: 10,
          unit: '', // empty → wallet fills its unit
          fee_reserve: 1,
          state: MeltQuoteState.UNPAID,
          expiry: 3600,
          payment_preimage: null,
          request: '', // empty → wallet echoes the invoice
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quote = await wallet.createMeltQuoteBolt11('lnbc-plain');
    expect(body.unit).toBe('sat');
    expect(body.request).toBe('lnbc-plain');
    expect(body.options).toBeUndefined();
    expect(quote.unit).toBe('sat');
    expect(quote.request).toBe('lnbc-plain');
  });

  test('rejects amountMsat when the invoice already encodes an amount', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    await expect(wallet.createMeltQuoteBolt11(invoice, 5000)).rejects.toThrow(
      'amountMsat supplied but invoice already contains an amount',
    );
  });

  test('attaches amountless options for an amountless invoice on a supporting mint', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.get(mintUrl + '/v1/info', () =>
        HttpResponse.json({
          ...mintInfoResp,
          nuts: {
            ...mintInfoResp.nuts,
            5: {
              methods: [{ method: 'bolt11', unit: 'sat', options: { amountless: true } }],
              disabled: false,
            },
          },
        }),
      ),
      http.post(mintUrl + '/v1/melt/quote/bolt11', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          quote: 'melt-amountless',
          amount: 5,
          unit: 'sat',
          fee_reserve: 1,
          state: MeltQuoteState.UNPAID,
          expiry: 3600,
          payment_preimage: null,
          request: 'lnbc1pvjluezz',
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await wallet.createMeltQuoteBolt11('lnbc1pvjluezz', 5000);
    const options = body.options as { amountless?: { amount_msat?: unknown } } | undefined;
    expect(options?.amountless).toBeDefined();
    expect(Number(options?.amountless?.amount_msat)).toBe(5000);
  });
});

describe('createMultiPathMeltQuote mutants', () => {
  test('throws when the mint does not advertise NUT-15', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    await expect(wallet.createMultiPathMeltQuote(invoice, 1000)).rejects.toThrow(
      'Mint does not support NUT-15',
    );
  });

  test('throws when NUT-15 is advertised for a different unit', async () => {
    server.use(
      http.get(mintUrl + '/v1/info', () =>
        HttpResponse.json({
          ...mintInfoResp,
          nuts: { ...mintInfoResp.nuts, 15: { methods: [{ method: 'bolt11', unit: 'usd' }] } },
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    // method matches but unit does not: an `||` mutant would wrongly accept this.
    await expect(wallet.createMultiPathMeltQuote(invoice, 1000)).rejects.toThrow(
      'Mint does not support MPP for bolt11 and sat',
    );
  });
});

describe('prepareMint mutants', () => {
  test('rejects a string quote id', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    await expect(
      wallet.prepareMint('bolt11', 1, 'just-an-id' as unknown as { quote: string }),
    ).rejects.toThrow('expected a quote object, not a string ID');
  });

  test('does not add fee outputs when minting (includeFees is false)', async () => {
    useFeeKeyset(1000);
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const quote: MintQuoteBolt11Response = {
      quote: 'q-fee',
      request: 'lnbc...',
      amount: Amount.from(8),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    };
    const preview = await wallet.prepareMint('bolt11', 8, quote);
    const total = Amount.sum(preview.outputData.map((o) => o.blindedMessage.amount));
    // Received proofs must sum to exactly the requested amount, no fee padding.
    expect(total.equals(8)).toBe(true);
  });

  test('fires the onCountersReserved callback for deterministic outputs', async () => {
    const wallet = new Wallet(mint, { unit, bip39seed: SEED });
    await wallet.loadMint();
    const onCountersReserved = vi.fn();
    const quote: MintQuoteBolt11Response = {
      quote: 'q-counter',
      request: 'lnbc...',
      amount: Amount.from(3),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    };
    await wallet.prepareMint('bolt11', 3, quote, { onCountersReserved });
    // amount 3 -> outputs [1,2]: start 0, count 2, next 2
    expect(onCountersReserved).toHaveBeenCalledWith(
      expect.objectContaining({ keysetId: KEYSET_ID, start: 0, count: 2, next: 2 }),
    );
  });

  test('an empty pubkey field does not force a locked-quote signature', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    // 'pubkey' is present but falsy → the quote is unlocked; no privkey should be required.
    const quote = {
      quote: 'q-empty-pubkey',
      request: 'lnbc...',
      amount: Amount.from(1),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
      pubkey: '',
    } as unknown as MintQuoteBolt11Response;
    const preview = await wallet.prepareMint('bolt11', 1, quote);
    expect(preview.payload.signature).toBeUndefined();
  });
});

describe('completeMint mutants', () => {
  test('rejects a signature count that does not match the outputs', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/bolt11', () =>
        HttpResponse.json({ signatures: [{ id: KEYSET_ID, amount: 1, C_: SIG_C }] }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const quote: MintQuoteBolt11Response = {
      quote: 'q-mismatch',
      request: 'lnbc...',
      amount: Amount.from(3),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    };
    // amount 3 → outputs [1,2]; the mint returns only 1 signature.
    const preview = await wallet.prepareMint('bolt11', 3, quote);
    await expect(wallet.completeMint(preview)).rejects.toThrow(
      'Mint returned 1 signatures, expected 2',
    );
  });
});

describe('prepareBatchMint / completeBatchMint mutants', () => {
  test('rejects an empty entries array', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    await expect(wallet.prepareBatchMint('bolt11', [])).rejects.toThrow('no entries provided');
  });

  test('rejects a string quote id in an entry', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    await expect(
      wallet.prepareBatchMint('bolt11', [
        { amount: 1, quote: 'string-id' as unknown as { quote: string } },
      ]),
    ).rejects.toThrow('expected a quote object, not a string ID');
  });

  test('validates each entry quote (rejects a wrong-unit entry)', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    await expect(
      wallet.prepareBatchMint('bolt11', [
        {
          amount: 1,
          quote: { quote: 'wrong-unit', unit: 'usd' } as unknown as { quote: string },
        },
      ]),
    ).rejects.toThrow("Quote unit 'usd' does not match wallet unit 'sat'");
  });

  test('requires a privkey when any entry is locked', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const locked = {
      quote: 'locked',
      pubkey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    } as unknown as { quote: string; pubkey?: string };
    const unlocked = { quote: 'unlocked' } as unknown as { quote: string; pubkey?: string };
    await expect(
      wallet.prepareBatchMint('bolt11', [
        { amount: 1, quote: locked },
        { amount: 1, quote: unlocked },
      ]),
    ).rejects.toThrow('Can not sign locked quotes without private key');
  });

  test('signs a locked entry when a matching privkey is supplied', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const quote = {
      quote: 'locked-signed',
      pubkey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    } as unknown as { quote: string; pubkey?: string };
    const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
    const preview = await wallet.prepareBatchMint('bolt11', [{ amount: 1, quote }], { privkey });
    expect(preview.payload.signatures).toHaveLength(1);
    expect(typeof preview.payload.signatures![0]).toBe('string');
  });

  test('preview.quotes returns the entry quote objects', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareBatchMint('bolt11', [
      { amount: 2, quote: { quote: 'qa' } },
      { amount: 3, quote: { quote: 'qb' } },
    ]);
    expect(preview.quotes.map((q) => q.quote)).toEqual(['qa', 'qb']);
  });

  test('does not add fee outputs to a batch (includeFees is false)', async () => {
    useFeeKeyset(1000);
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareBatchMint('bolt11', [
      { amount: 8, quote: { quote: 'q8' } },
    ]);
    const total = Amount.sum(preview.outputData.map((o) => o.blindedMessage.amount));
    expect(total.equals(8)).toBe(true);
  });

  test('completeBatchMint rejects a signature count that does not match the outputs', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/bolt11/batch', () =>
        HttpResponse.json({ signatures: [{ id: KEYSET_ID, amount: 1, C_: SIG_C }] }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    // amount 3 → outputs [1,2]; the mint returns only 1 signature.
    const preview = await wallet.prepareBatchMint('bolt11', [
      { amount: 3, quote: { quote: 'qb3' } },
    ]);
    await expect(wallet.completeBatchMint(preview)).rejects.toThrow(
      'Mint returned 1 signatures, expected 2',
    );
  });
});

describe('prepareMelt mutants', () => {
  test('rejects proofs that do not cover the quote amount', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'melt-short',
      amount: Amount.from(10),
      fee_reserve: Amount.from(0),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend: Proof[] = [
      { id: KEYSET_ID, amount: Amount.from(5), secret: 's1', C: 'C1' },
    ];
    await expect(wallet.prepareMelt('bolt11', meltQuote, proofsToSend)).rejects.toThrow(
      'Not enough proofs to cover amount + fee reserve',
    );
  });

  test('a custom OutputType is used verbatim, ignoring NUT-08 blank generation', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const data = [
      OutputData.createSingleRandomData(0, KEYSET_ID),
      OutputData.createSingleRandomData(0, KEYSET_ID),
    ];
    const customOutputType: OutputType = { type: 'custom', data };
    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'melt-custom',
      amount: Amount.from(10),
      fee_reserve: Amount.from(1),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    // sum 11, feeReserve 1 → the non-custom path would create a single blank.
    const proofsToSend: Proof[] = [
      { id: KEYSET_ID, amount: Amount.from(11), secret: 's1', C: 'C1' },
    ];
    const meltTxn = await wallet.prepareMelt(
      'bolt11',
      meltQuote,
      proofsToSend,
      undefined,
      customOutputType,
    );
    expect(meltTxn.outputData).toHaveLength(2);
    expect(meltTxn.outputData[0].blindedMessage.B_).toBe(data[0].blindedMessage.B_);
  });

  test('fires the onCountersReserved callback for deterministic NUT-08 blanks', async () => {
    const wallet = new Wallet(mint, { unit, bip39seed: SEED });
    await wallet.loadMint();
    const onCountersReserved = vi.fn();
    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'melt-counter',
      amount: Amount.from(10),
      fee_reserve: Amount.from(3),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend: Proof[] = [
      { id: KEYSET_ID, amount: Amount.from(8), secret: 's1', C: 'C1' },
      { id: KEYSET_ID, amount: Amount.from(5), secret: 's2', C: 'C2' },
    ];
    await wallet.prepareMelt('bolt11', meltQuote, proofsToSend, { onCountersReserved });
    // feeReserve 3 -> ceil(log2(3)) = 2 NUT-08 blanks: start 0, count 2, next 2
    expect(onCountersReserved).toHaveBeenCalledWith(
      expect.objectContaining({ keysetId: KEYSET_ID, start: 0, count: 2, next: 2 }),
    );
  });

  test('random-policy wallet does not reserve counters (no onCountersReserved)', async () => {
    // No seed → random outputs need no deterministic counters; the reservation callback
    // must not fire (an always-call mutant would invoke it with an undefined payload).
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const onCountersReserved = vi.fn();
    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'melt-random',
      amount: Amount.from(10),
      fee_reserve: Amount.from(3),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend: Proof[] = [
      { id: KEYSET_ID, amount: Amount.from(13), secret: 's1', C: 'C1' },
    ];
    await wallet.prepareMelt('bolt11', meltQuote, proofsToSend, { onCountersReserved });
    expect(onCountersReserved).not.toHaveBeenCalled();
  });
});

describe('keysetId getter mutants', () => {
  test('an uninitialised wallet has no bound keyset', () => {
    // Never loaded → still PENDING; the getter must throw rather than leak the sentinel.
    const wallet = new Wallet(mint, { unit });
    expect(() => wallet.keysetId).toThrow('Wallet has no bound keyset');
  });
});

describe('withKeyset mutants', () => {
  test('carries the seed and shares the parent counter source', async () => {
    // counterInit seeds the shared ephemeral source at 9 for this keyset.
    const parent = new Wallet(mint, {
      unit,
      bip39seed: SEED,
      counterInit: { [KEYSET_ID]: 9 },
    });
    await parent.loadMint();

    const child = parent.withKeyset(KEYSET_ID);
    expect(child.keysetId).toBe(KEYSET_ID);
    // Seed carried → deterministic default (a dropped-options mutant would be random).
    expect(child.defaultOutputType().type).toBe('deterministic');
    // Shared source → the child sees the parent's reserved position (a `&&` mutant would
    // hand the child a fresh source starting at 0).
    expect(await child.counters.peekNext(KEYSET_ID)).toBe(9);
  });
});

describe('createMintQuote (generic) mutants', () => {
  test('posts the payload plus wallet unit and fills a missing response unit', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt11', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          quote: 'gen-mint',
          request: 'lnbc...',
          unit: '', // empty → wallet substitutes its own unit
          amount: 1000,
          state: MintQuoteState.UNPAID,
          expiry: null,
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quote = await wallet.createMintQuote('bolt11', { amount: 1000 });
    expect(body.amount).toBe(1000);
    expect(body.unit).toBe('sat');
    expect(quote.unit).toBe('sat');
  });
});

describe('createLockedMintQuote mutants', () => {
  const PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

  function useNut20() {
    server.use(
      http.get(mintUrl + '/v1/info', () =>
        HttpResponse.json({
          ...mintInfoResp,
          nuts: { ...mintInfoResp.nuts, 20: { supported: true } },
        }),
      ),
    );
  }

  test('rejects when the mint does not advertise NUT-20', async () => {
    // Default fixture omits NUT-20.
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    await expect(wallet.createLockedMintQuote(100, PUBKEY)).rejects.toThrow(
      'Mint does not support NUT-20',
    );
  });

  test('sends the pubkey, amount, description and unit, and fills a missing response unit', async () => {
    useNut20();
    let body: Record<string, unknown> = {};
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt11', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          quote: 'locked-q',
          request: 'lnbc...',
          unit: '', // empty → wallet substitutes its own unit
          amount: 100,
          state: MintQuoteState.UNPAID,
          expiry: null,
          pubkey: PUBKEY,
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quote = await wallet.createLockedMintQuote(100, PUBKEY, 'a description');
    expect(body.pubkey).toBe(PUBKEY);
    expect(body.amount).toBe(100);
    expect(body.unit).toBe('sat');
    expect(body.description).toBe('a description');
    expect(quote.pubkey).toBe(PUBKEY);
    expect(quote.unit).toBe('sat');
  });

  test('rejects when the mint returns an unlocked quote (no pubkey)', async () => {
    useNut20();
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt11', () =>
        HttpResponse.json({
          quote: 'locked-but-unlocked',
          request: 'lnbc...',
          unit: 'sat',
          amount: 100,
          state: MintQuoteState.UNPAID,
          expiry: null,
          // pubkey omitted → mint failed to lock the quote
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(wallet.createLockedMintQuote(100, PUBKEY)).rejects.toThrow(
      'Mint returned unlocked mint quote',
    );
  });

  test('rejects when the mint returns a quote locked to a different pubkey', async () => {
    useNut20();
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt11', () =>
        HttpResponse.json({
          quote: 'locked-elsewhere',
          request: 'lnbc...',
          unit: 'sat',
          amount: 100,
          state: MintQuoteState.UNPAID,
          expiry: null,
          pubkey: '03' + PUBKEY.slice(2),
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(wallet.createLockedMintQuote(100, PUBKEY)).rejects.toThrow(
      'Mint quote is not locked to the requested pubkey',
    );
  });

  test('accepts a case-variant echo of the requested pubkey', async () => {
    useNut20();
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt11', () =>
        HttpResponse.json({
          quote: 'locked-upper',
          request: 'lnbc...',
          unit: 'sat',
          amount: 100,
          state: MintQuoteState.UNPAID,
          expiry: null,
          pubkey: PUBKEY.toUpperCase(),
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quote = await wallet.createLockedMintQuote(100, PUBKEY);
    expect(quote.pubkey.toLowerCase()).toBe(PUBKEY);
  });

  test('rejects a missing pubkey with a clear error, not a TypeError', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(wallet.createLockedMintQuote(100, undefined as unknown as string)).rejects.toThrow(
      'A pubkey is required to lock the mint quote',
    );
  });
});

describe('checkMintQuoteBolt11 mutants', () => {
  test('forwards the id from a string and from a quote object', async () => {
    const seen: string[] = [];
    server.use(
      http.get(mintUrl + '/v1/mint/quote/bolt11/:quoteId', ({ params }) => {
        seen.push(params.quoteId as string);
        return HttpResponse.json({
          quote: params.quoteId,
          request: 'lnbc...',
          unit: 'sat',
          amount: 1,
          state: MintQuoteState.UNPAID,
          expiry: null,
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await wallet.checkMintQuoteBolt11('str-id');
    await wallet.checkMintQuoteBolt11({ quote: 'obj-id' } as MintQuoteBolt11Response);
    expect(seen).toEqual(['str-id', 'obj-id']);
  });
});

describe('validateMintQuote expiry boundary mutants', () => {
  test('an expiry equal to the current second is not expired', () => {
    const wallet = new Wallet(mint, { unit });
    const FIXED_MS = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(FIXED_MS);
    try {
      const nowSec = Math.floor(FIXED_MS / 1000);
      // Spec: expired means strictly in the past. Equal-to-now must pass (a `<=` mutant throws).
      expect(() => wallet.validateMintQuote({ quote: 'q', expiry: nowSec })).not.toThrow();
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('a non-number expiry is ignored even if it looks past', () => {
    const wallet = new Wallet(mint, { unit });
    // A stringified past expiry must be ignored (a `typeof === 'number'` -> true mutant throws).
    expect(() =>
      wallet.validateMintQuote({ quote: 'q', expiry: '100' as unknown as number }),
    ).not.toThrow();
  });
});

describe('prepareMint signing / policy mutants', () => {
  test('signs a locked quote using an array privkey selected by pubkey', async () => {
    const PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const PRIVKEY = '0000000000000000000000000000000000000000000000000000000000000001';
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const quote = {
      quote: 'locked-mint',
      pubkey: PUBKEY,
    } as unknown as MintQuoteBolt11Response;
    // pubkey drives findSigningKey over the array. A `'pubkey'` -> `''` mutant drops the
    // pubkey, hits the "multiple privkeys without pubkey" guard, and throws instead.
    const preview = await wallet.prepareMint('bolt11', 1, quote, { privkey: [PRIVKEY] });
    expect(typeof preview.payload.signature).toBe('string');
  });

  test('random-policy prepareMint does not fire onCountersReserved', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const onCountersReserved = vi.fn();
    const quote: MintQuoteBolt11Response = {
      quote: 'q-random',
      request: 'lnbc...',
      amount: Amount.from(3),
      unit: 'sat',
      state: MintQuoteState.UNPAID,
      expiry: null,
    };
    await wallet.prepareMint('bolt11', 3, quote, { onCountersReserved });
    expect(onCountersReserved).not.toHaveBeenCalled();
  });
});

describe('mintProofsBolt11 mutants', () => {
  test('validates a quote object rather than treating it as a string id', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    // A wrong-unit quote object must be rejected by validateMintQuote. A mutant that always
    // takes the string-id branch would skip validation and fail later with a different error.
    await expect(
      wallet.mintProofsBolt11(1, { quote: 'x', unit: 'usd' } as MintQuoteBolt11Response, []),
    ).rejects.toThrow("Quote unit 'usd' does not match wallet unit 'sat'");
  });
});

describe('createMeltQuote (generic) mutants', () => {
  test('posts the wallet unit and fills a missing response unit', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(mintUrl + '/v1/melt/quote/bolt11', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          quote: 'gen-melt',
          amount: 10,
          unit: '', // empty → wallet substitutes its own unit
          fee_reserve: 1,
          state: MeltQuoteState.UNPAID,
          expiry: 3600,
          payment_preimage: null,
          request: 'lnbc-x',
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quote = await wallet.createMeltQuote('bolt11', { request: 'lnbc-x' });
    expect(body.unit).toBe('sat');
    expect(quote.unit).toBe('sat');
  });
});

describe('createMeltQuoteBolt11 amount-invoice mutants', () => {
  test('an amount-encoding invoice without amountMsat skips the amountless guard', async () => {
    server.use(
      http.post(mintUrl + '/v1/melt/quote/bolt11', () =>
        HttpResponse.json({
          quote: 'melt-amt-invoice',
          amount: 2000,
          unit: 'sat',
          fee_reserve: 1,
          state: MeltQuoteState.UNPAID,
          expiry: 3600,
          payment_preimage: null,
          request: invoice,
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    // No amountMsat → the invoice-already-has-amount check must be skipped. A mutant that
    // always runs it would throw "amountMsat supplied but invoice already contains an amount".
    const quote = await wallet.createMeltQuoteBolt11(invoice);
    expect(quote.quote).toBe('melt-amt-invoice');
  });
});

describe('createMeltQuoteBolt12 mutants', () => {
  test('omits options when no amountMsat is supplied', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(mintUrl + '/v1/melt/quote/bolt12', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          quote: 'melt-bolt12',
          amount: 100,
          unit: 'sat',
          fee_reserve: 2,
          state: MeltQuoteState.UNPAID,
          expiry: 9999999999,
          payment_preimage: null,
          request: 'lno1offer...',
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    // No amountMsat → the parseAmount ternary must not run (a `-> true` mutant would call
    // parseAmount(undefined) and throw); options stay undefined.
    const quote = await wallet.createMeltQuoteBolt12('lno1offer...');
    expect(quote.quote).toBe('melt-bolt12');
    expect(body.options).toBeUndefined();
  });
});

describe('createMeltQuoteOnchain mutants', () => {
  test('fills a missing response unit from the wallet', async () => {
    server.use(
      http.post(mintUrl + '/v1/melt/quote/onchain', () =>
        HttpResponse.json({
          quote: 'onchain-melt',
          request: 'bc1qrecipient',
          amount: 10,
          unit: '', // empty → wallet substitutes its own unit
          fee_options: [{ fee_index: 0, fee_reserve: 2, estimated_blocks: 6 }],
          state: MeltQuoteState.UNPAID,
          expiry: 3600,
          selected_fee_index: null,
          outpoint: null,
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const quote = await wallet.createMeltQuoteOnchain('bc1qrecipient', 10);
    expect(quote.unit).toBe('sat');
  });
});

describe('createMultiPathMeltQuote mutants', () => {
  test('accepts when the wallet unit is among several NUT-15 methods', async () => {
    server.use(
      http.get(mintUrl + '/v1/info', () =>
        HttpResponse.json({
          ...mintInfoResp,
          nuts: {
            ...mintInfoResp.nuts,
            15: {
              methods: [
                { method: 'bolt11', unit: 'sat' },
                { method: 'bolt11', unit: 'usd' },
              ],
            },
          },
        }),
      ),
      http.post(mintUrl + '/v1/melt/quote/bolt11', () =>
        HttpResponse.json({
          quote: 'mpp-quote',
          amount: 5,
          unit: 'sat',
          fee_reserve: 1,
          state: MeltQuoteState.UNPAID,
          expiry: 3600,
          payment_preimage: null,
          request: invoice,
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    // `some` must match the sat entry among the two methods. An `every` mutant would reject
    // because the usd entry does not match.
    const quote = await wallet.createMultiPathMeltQuote(invoice, 1000);
    expect(quote.quote).toBe('mpp-quote');
  });
});

describe('batchRestore mutants', () => {
  test('advances the counter forwards and forwards the keysetId to restore', async () => {
    const wallet = new Wallet(mint, { unit, bip39seed: SEED });
    await wallet.loadMint();
    const fakeProof = {
      id: KEYSET_ID,
      amount: Amount.from(1),
      secret: 's',
      C: 'C',
    } as unknown as Proof;
    const restoreSpy = vi
      .spyOn(wallet, 'restore')
      .mockResolvedValueOnce({ proofs: [fakeProof], lastCounterWithSignature: 0 })
      .mockResolvedValueOnce({ proofs: [fakeProof], lastCounterWithSignature: 1 })
      .mockResolvedValueOnce({ proofs: [fakeProof], lastCounterWithSignature: 2 })
      .mockResolvedValueOnce({ proofs: [fakeProof], lastCounterWithSignature: 3 })
      .mockResolvedValue({ proofs: [] });

    await wallet.batchRestore({
      gapLimit: 1,
      batchSize: 1,
      keysetId: KEYSET_ID,
      filterSpent: false,
    });

    // Wave 1 probes counters 0-3 in order (a `-` mutant in the start math would probe -1).
    expect(restoreSpy).toHaveBeenNthCalledWith(1, 0, 1, { keysetId: KEYSET_ID });
    expect(restoreSpy).toHaveBeenNthCalledWith(2, 1, 1, { keysetId: KEYSET_ID });
    // Wave 1 was all non-empty, so wave 2 must start at counter 4 (a `-=` advance mutant goes negative).
    expect(restoreSpy).toHaveBeenNthCalledWith(5, 4, 1, { keysetId: KEYSET_ID });
  });
});
