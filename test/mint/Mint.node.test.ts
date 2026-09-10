import { type Client, Server, WebSocket } from 'mock-socket';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  Mint,
  MintInfo,
  MeltQuoteState,
  WSConnection,
  injectWebSocketImpl,
  RateLimitError,
  Amount,
  JSONInt,
} from '../../src';
import type { AuthProvider, Logger, MintQuoteBaseResponse, Proof, RequestFn } from '../../src';
import { MAX_KEYSET_LIST, MAX_MINT_INFO_LIST } from '../../src/utils/limits';
import { MINTINFORESP } from '../consts';

type ReqArgs = {
  endpoint: string;
  method?: string;
  requestBody?: unknown;
  headers?: Record<string, string>;
};

const mintUrl = 'https://localhost:3338';
const fakeWsUrl = 'wss://mint.example/cashu/v1/ws';

// Mint serializes the body before the transport; parse it back to assert on the wire form.
const sentBody = (body: unknown): unknown => JSONInt.parse(body as string);

const makeRequest = <T>(payload: T): RequestFn => {
  return (async (options: ReqArgs): Promise<T> => {
    void options;
    return payload;
  }) as RequestFn;
};

// Minimal wire-shaped fixtures: Mint checks response counts against the request.
const blankOutput = (amount = 1) => ({ amount: Amount.from(amount), id: '00', B_: '02blank' });
const blindSignature = (amount = 1) => ({ amount, C_: '02sig', id: '00' });

function createLogger(): Logger {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    log: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  injectWebSocketImpl(WebSocket);
});

describe('Mint normalization', () => {
  it('caches getLazyMintInfo after the first request', async () => {
    const requestSpy = vi.fn(async () => ({
      name: 'mint',
      pubkey: '02abcd',
      version: 'test',
      contact: [],
      nuts: {
        '4': { disabled: false, methods: [] },
        '5': { disabled: false, methods: [] },
      },
    })) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const info1 = await mint.getLazyMintInfo();
    const info2 = await mint.getLazyMintInfo();

    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(info1).toBe(info2);
  });

  it('setMintInfo accepts raw info objects and seeds the cache', async () => {
    const mint = new Mint(mintUrl);

    mint.setMintInfo({
      name: 'mint',
      pubkey: '02abcd',
      version: 'test',
      contact: [],
      nuts: {
        '4': { disabled: false, methods: [] },
        '5': { disabled: false, methods: [] },
      },
    });

    const cached = await mint.getLazyMintInfo();
    expect(cached).toBeInstanceOf(MintInfo);
    expect(cached.name).toBe('mint');
  });

  it('exposes the sanitized mintUrl', () => {
    const mint = new Mint('https://localhost:3338');
    expect(mint.mintUrl).toBe('https://localhost:3338');
  });

  it('oidcAuth throws when the mint does not advertise NUT-21 discovery metadata', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({
        name: 'mint',
        pubkey: '02abcd',
        version: 'test',
        contact: [],
        nuts: {
          '4': { disabled: false, methods: [] },
          '5': { disabled: false, methods: [] },
        },
      }),
    });

    await expect(mint.oidcAuth()).rejects.toThrow('Mint: no NUT-21 openid_discovery');
  });

  it('passes through AmountLike min/max amounts from getInfo()', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({
        name: 'mint',
        pubkey: '02abcd',
        version: 'test',
        contact: [],
        nuts: {
          '4': {
            disabled: false,
            methods: [
              {
                method: 'bolt11',
                unit: 'sat',
                min_amount: 123n,
                max_amount: 456n,
              },
            ],
          },
          '5': {
            disabled: false,
            methods: [
              {
                method: 'bolt11',
                unit: 'sat',
                min_amount: 789n,
                max_amount: 999n,
              },
            ],
          },
          '19': { ttl: 120n, cached_endpoints: [] },
          '22': { bat_max_mint: 5n, protected_endpoints: [] },
        },
      } as any),
    });

    const info = await mint.getInfo();

    // min/max are AmountLike — wire bigint values pass through unchanged
    expect(info.nuts['4'].methods[0].min_amount).toBe(123n);
    expect(info.nuts['4'].methods[0].max_amount).toBe(456n);
    expect(info.nuts['5'].methods[0].min_amount).toBe(789n);
    expect(info.nuts['5'].methods[0].max_amount).toBe(999n);
    // metadata integers normalized by MintInfo construction
    const mintInfo = await mint.getLazyMintInfo();
    expect(mintInfo.cache.nuts['19']?.ttl).toBe(120);
    expect(mintInfo.cache.nuts['22']?.bat_max_mint).toBe(5);
  });

  it('rejects out-of-range bigint info metadata in getLazyMintInfo()', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({
        name: 'mint',
        pubkey: '02abcd',
        version: 'test',
        contact: [],
        nuts: {
          '4': { disabled: false, methods: [] },
          '5': { disabled: false, methods: [] },
          '19': { ttl: 9007199254740993n, cached_endpoints: [{ method: 'GET', path: '/v1/keys' }] },
        },
      } as any),
    });

    await expect(mint.getLazyMintInfo()).rejects.toThrow('nuts.19.ttl');
  });

  it('normalizes bigint fields in getKeySets()', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({
        keysets: [
          {
            id: '00ks',
            unit: 'sat',
            active: true,
            input_fee_ppk: 250n,
            final_expiry: 1_754_296_607n,
          },
        ],
      } as any),
    });

    const response = await mint.getKeySets();

    expect(response.keysets[0].input_fee_ppk).toBe(250);
    expect(response.keysets[0].final_expiry).toBe(1_754_296_607);
  });

  it('rejects out-of-range bigint keyset metadata in getKeySets()', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({
        keysets: [
          {
            id: '00ks',
            unit: 'sat',
            active: true,
            input_fee_ppk: 9007199254740993n,
          },
        ],
      } as any),
    });

    await expect(mint.getKeySets()).rejects.toThrow('keyset.input_fee_ppk');
  });

  it('normalizes bigint fields in getKeys()', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({
        keysets: [
          {
            id: '00ks',
            unit: 'sat',
            input_fee_ppk: 250n,
            final_expiry: 1_754_296_607n,
            keys: { 1: '02abcd' },
          },
        ],
      } as any),
    });

    const response = await mint.getKeys();

    expect(response.keysets[0].input_fee_ppk).toBe(250);
    expect(response.keysets[0].final_expiry).toBe(1_754_296_607);
  });

  it('rejects out-of-range bigint key metadata in getKeys()', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({
        keysets: [
          {
            id: '00ks',
            unit: 'sat',
            input_fee_ppk: 9007199254740993n,
            keys: { 1: '02abcd' },
          },
        ],
      } as any),
    });

    await expect(mint.getKeys()).rejects.toThrow('keys.input_fee_ppk');
  });

  it('passes auth headers and NUT-19 retry policy through requestWithAuth', async () => {
    const requestSpy = vi.fn(
      async (options: ReqArgs & { ttl?: number; cached_endpoints?: unknown[] }) => {
        expect(options.endpoint).toBe(mintUrl + '/v1/swap');
        expect(options.method).toBe('POST');
        expect(options.headers?.['Blind-auth']).toBe('bat123');
        expect(options.headers?.['Clear-auth']).toBe('cat123');
        // MintInfo maps NUT-19 TTL seconds to request-layer milliseconds.
        expect(options.ttl).toBe(12_000);
        expect(options.cached_endpoints).toEqual([{ method: 'POST', path: '/v1/swap' }]);
        return { signatures: [{ amount: 1, C_: '02sig', id: '00' }] };
      },
    ) as RequestFn;
    const authProvider: AuthProvider = {
      getBlindAuthToken: vi.fn(async () => 'bat123'),
      getCAT: vi.fn(() => 'cat-fallback'),
      setCAT: vi.fn(),
      ensureCAT: vi.fn(async () => 'cat123'),
    };
    const mint = new Mint(mintUrl, { customRequest: requestSpy, authProvider });
    mint.setMintInfo({
      name: 'mint',
      pubkey: '02abcd',
      version: 'test',
      contact: [],
      nuts: {
        '4': { disabled: false, methods: [] },
        '5': { disabled: false, methods: [] },
        '19': { ttl: 12, cached_endpoints: [{ method: 'POST', path: '/v1/swap' }] },
        '21': {
          openid_discovery: 'https://auth.example/.well-known/openid-configuration',
          client_id: 'cashu-client',
          protected_endpoints: [{ method: 'POST', path: '/v1/swap' }],
        },
        '22': {
          bat_max_mint: 5,
          protected_endpoints: [{ method: 'POST', path: '/v1/swap' }],
        },
      },
    });

    const response = await mint.swap({ inputs: [], outputs: [blankOutput()] });

    expect(authProvider.ensureCAT).toHaveBeenCalled();
    expect(authProvider.getCAT).not.toHaveBeenCalled();
    expect(authProvider.getBlindAuthToken).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/swap',
      body: '{"inputs":[],"outputs":[{"amount":1,"id":"00","B_":"02blank"}]}',
    });
    expect(response.signatures[0].amount.toBigInt()).toBe(1n);
  });

  it('falls back to getCAT when ensureCAT is unavailable', async () => {
    const requestSpy = vi.fn(async (options: ReqArgs) => {
      expect(options.headers?.['Clear-auth']).toBe('cat-fallback');
      expect(options.headers?.['Blind-auth']).toBeUndefined();
      return { signatures: [{ amount: 1, C_: '02sig', id: '00' }] };
    }) as RequestFn;
    const authProvider: AuthProvider = {
      getBlindAuthToken: vi.fn(async () => 'unused'),
      getCAT: vi.fn(() => 'cat-fallback'),
      setCAT: vi.fn(),
    };
    const mint = new Mint(mintUrl, { customRequest: requestSpy, authProvider });
    mint.setMintInfo({
      name: 'mint',
      pubkey: '02abcd',
      version: 'test',
      contact: [],
      nuts: {
        '4': { disabled: false, methods: [] },
        '5': { disabled: false, methods: [] },
        '21': {
          openid_discovery: 'https://auth.example/.well-known/openid-configuration',
          client_id: 'cashu-client',
          protected_endpoints: [{ method: 'POST', path: '/v1/swap' }],
        },
      },
    });

    await mint.swap({ inputs: [], outputs: [blankOutput()] });

    expect(authProvider.getCAT).toHaveBeenCalled();
  });

  it('createMintQuoteBolt11 normalizes request and response amounts', async () => {
    const requestSpy = vi.fn(async (options: ReqArgs) => {
      expect(options.endpoint).toBe(mintUrl + '/v1/mint/quote/bolt11');
      expect(options.method).toBe('POST');
      expect(sentBody(options.requestBody)).toMatchObject({
        amount: 21,
        unit: 'sat',
        description: 'mint me',
      });
      return {
        quote: 'q1',
        request: 'lnbc1...',
        unit: 'sat',
        state: 'UNPAID',
        expiry: null,
        amount: 21,
      };
    }) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const response = await mint.createMintQuoteBolt11({
      amount: '21',
      unit: 'sat',
      description: 'mint me',
    });

    expect(response.amount.toBigInt()).toBe(21n);
    expect(response.expiry).toBeNull();
  });

  it('createMintQuoteBolt12 coerces omitted amount to null and normalizes paid and issued amounts', async () => {
    const requestSpy = vi.fn(async (options: ReqArgs) => {
      expect(options.endpoint).toBe(mintUrl + '/v1/mint/quote/bolt12');
      expect(options.method).toBe('POST');
      expect(sentBody(options.requestBody)).toEqual({
        unit: 'sat',
        pubkey: '02abcd',
        description: 'offer',
      });
      return {
        quote: 'q1',
        request: 'lno1...',
        unit: 'sat',
        expiry: 123,
        amount_paid: 5,
        amount_issued: 4,
      };
    }) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const response = await mint.createMintQuoteBolt12({
      unit: 'sat',
      pubkey: '02abcd',
      description: 'offer',
    });

    expect(response.amount).toBeNull();
    expect(response.amount_paid.toBigInt()).toBe(5n);
    expect(response.amount_issued.toBigInt()).toBe(4n);
  });

  it('createMintQuoteBolt12 preserves explicit null amount (NUT-25 amountless)', async () => {
    // Per NUT-25 the amount is <int|null>; CDK emits explicit `null` for
    // amountless offers. The wallet type is `Amount | null`, so null passes
    // through unchanged (no Amount.from(null) coercion).
    const requestSpy = vi.fn(async () => ({
      quote: 'q1',
      request: 'lno1...',
      amount: null,
      unit: 'sat',
      expiry: 0,
      pubkey: '02abcd',
      amount_paid: 0,
      amount_issued: 0,
    })) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const response = await mint.createMintQuoteBolt12({ unit: 'sat', pubkey: '02abcd' });

    expect(response.amount).toBeNull();
    expect(response.amount_paid.toBigInt()).toBe(0n);
    expect(response.amount_issued.toBigInt()).toBe(0n);
  });

  it('mintBolt11 posts to the expected endpoint and normalizes signature amounts', async () => {
    const requestSpy = vi.fn(async (options: ReqArgs) => {
      expect(options.endpoint).toBe(mintUrl + '/v1/mint/bolt11');
      expect(options.method).toBe('POST');
      return {
        signatures: [{ amount: 2, C_: '02sig', id: '00' }],
      };
    }) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const response = await mint.mintBolt11({ quote: 'q1', outputs: [blankOutput()] });

    expect(response.signatures[0].amount.toBigInt()).toBe(2n);
  });

  it.each([
    ['not an array', { amount: 3, C_: '02change', id: '00' }],
    [
      'oversized',
      Array.from({ length: MAX_MINT_INFO_LIST + 1 }, () => ({ amount: 1, C_: '02c', id: '00' })),
    ],
  ])('checkMeltQuoteBolt11 rejects a change list that is %s', async (_label, change) => {
    const requestSpy = vi.fn(async () => ({
      quote: 'q1',
      amount: 12,
      unit: 'sat',
      state: MeltQuoteState.PAID,
      expiry: 123,
      request: 'lnbc1...',
      fee_reserve: 1,
      change,
    })) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    await expect(mint.checkMeltQuoteBolt11('q1')).rejects.toThrow('Invalid response from mint');
  });

  it('checkMeltQuoteBolt11 normalizes amount, fee reserve, and change signatures', async () => {
    const requestSpy = vi.fn(async (options: ReqArgs) => {
      expect(options.endpoint).toBe(mintUrl + '/v1/melt/quote/bolt11/q1');
      expect(options.method).toBe('GET');
      return {
        quote: 'q1',
        amount: 12,
        unit: 'sat',
        state: MeltQuoteState.PAID,
        expiry: 123,
        request: 'lnbc1...',
        fee_reserve: 1,
        change: [{ amount: 3, C_: '02change', id: '00' }],
      };
    }) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const response = await mint.checkMeltQuoteBolt11('q1');

    expect(response.amount.toBigInt()).toBe(12n);
    expect(response.fee_reserve.toBigInt()).toBe(1n);
    expect(response.change?.[0].amount.toBigInt()).toBe(3n);
  });

  it('supports custom quote methods with a normalize callback', async () => {
    const requestSpy = vi.fn(async () => ({
      quote: 'q1',
      request: 'acct:12345',
      unit: 'sat',
      amount_paid: 0,
      amount_issued: 0,
      expiry: 123,
      note: 'custom',
    })) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const mintQuote = await mint.createMintQuote(
      'custom-pay',
      { unit: 'sat' },
      {
        normalize: (raw) => ({ ...raw, tag: 'mint' }) as any,
      },
    );
    const meltQuote = await mint.checkMeltQuote('custom-pay', 'q1', {
      normalize: (raw) => ({ ...raw, tag: 'melt' }) as any,
      customRequest: (async () => ({
        quote: 'q1',
        request: 'acct:12345',
        amount: 1,
        unit: 'sat',
        state: MeltQuoteState.UNPAID,
        expiry: 123,
      })) as RequestFn,
    });

    expect(mintQuote).toMatchObject({ tag: 'mint', note: 'custom' });
    expect(meltQuote).toMatchObject({ tag: 'melt', quote: 'q1' });
  });

  it('checkMintQuoteBatchBolt11 posts to /v1/mint/quote/bolt11/check and normalizes amounts', async () => {
    const requestSpy = vi.fn(async (options: ReqArgs) => {
      expect(options.endpoint).toBe(mintUrl + '/v1/mint/quote/bolt11/check');
      expect(options.method).toBe('POST');
      expect(sentBody(options.requestBody)).toEqual({ quotes: ['q1', 'q2'] });
      return [
        {
          quote: 'q1',
          request: 'lnbc100...',
          unit: 'sat',
          amount: 100,
          state: 'PAID',
          expiry: 123,
        },
        {
          quote: 'q2',
          request: 'lnbc50...',
          unit: 'sat',
          amount: 50,
          state: 'UNPAID',
          expiry: 456,
        },
      ];
    }) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const quotes = await mint.checkMintQuoteBatchBolt11(['q1', 'q2']);

    expect(quotes).toHaveLength(2);
    expect(quotes[0].quote).toBe('q1');
    expect(quotes[0].amount).toBeInstanceOf(Amount);
    expect(quotes[0].amount.toBigInt()).toBe(100n);
    expect(quotes[1].amount.toBigInt()).toBe(50n);
  });

  it('checkMintQuoteBatchBolt12 posts to /v1/mint/quote/bolt12/check and normalizes amounts', async () => {
    const requestSpy = vi.fn(async (options: ReqArgs) => {
      expect(options.endpoint).toBe(mintUrl + '/v1/mint/quote/bolt12/check');
      expect(options.method).toBe('POST');
      expect(sentBody(options.requestBody)).toEqual({ quotes: ['q1'] });
      return [
        {
          quote: 'q1',
          request: 'lno...',
          unit: 'sat',
          amount: null,
          amount_paid: 42,
          amount_issued: 0,
          state: 'PAID',
          expiry: 123,
        },
      ];
    }) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const quotes = await mint.checkMintQuoteBatchBolt12(['q1']);

    expect(quotes[0].amount).toBeNull();
    expect(quotes[0].amount_paid.toBigInt()).toBe(42n);
    expect(quotes[0].amount_issued.toBigInt()).toBe(0n);
  });

  it('checkMintQuoteBatch supports custom quote methods with a normalize callback', async () => {
    const requestSpy = vi.fn(async () => [
      {
        quote: 'q1',
        request: 'REF-1',
        unit: 'gbp',
        amount: 5000,
        amount_paid: 5000,
        amount_issued: 0,
        reference: 'ABC',
      },
    ]) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    type CustomQuote = MintQuoteBaseResponse & {
      amount: Amount;
      reference: string;
    };

    const quotes = await mint.checkMintQuoteBatch<CustomQuote>('custom-pay', ['q1'], {
      normalize: (raw) => ({
        ...(raw as CustomQuote),
        amount: Amount.from(raw.amount as number),
      }),
    });

    expect(quotes[0].reference).toBe('ABC');
    expect(quotes[0].amount.toBigInt()).toBe(5000n);
  });

  it('checkMintQuoteBatch rejects an object envelope response', async () => {
    const logger = createLogger();
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ quotes: [] }),
      logger,
    });

    await expect(mint.checkMintQuoteBatchBolt11(['q1'])).rejects.toThrow(
      'Invalid response from mint',
    );
    expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
      data: { quotes: [] },
      op: 'checkMintQuoteBatch.bolt11',
    });
  });

  it('checkMintQuoteBatch accepts a top-level quote array response', async () => {
    const requestSpy = vi.fn(async () => [
      {
        quote: 'q1',
        request: 'lnbc100...',
        unit: 'sat',
        amount: 100,
        state: 'PAID',
        expiry: 123,
      },
    ]) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const quotes = await mint.checkMintQuoteBatchBolt11(['q1']);

    expect(quotes[0].quote).toBe('q1');
    expect(quotes[0].amount.toBigInt()).toBe(100n);
  });

  it('checkMintQuoteBatch rejects an empty quote list before requesting the mint', async () => {
    const requestSpy = vi.fn(async () => []) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    await expect(mint.checkMintQuoteBatchBolt11([])).rejects.toThrow(
      'checkMintQuoteBatch: no quote ids provided',
    );
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('checkMintQuoteBatch rejects duplicate quote IDs before requesting the mint', async () => {
    const requestSpy = vi.fn(async () => []) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    await expect(mint.checkMintQuoteBatchBolt11(['q1', 'q1'])).rejects.toThrow(
      'checkMintQuoteBatch: duplicate quote ids provided',
    );
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('checkMintQuoteBatch rejects response length mismatches', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest([
        {
          quote: 'q1',
          request: 'lnbc100...',
          unit: 'sat',
          amount: 100,
          state: 'PAID',
          expiry: 123,
        },
      ]),
    });

    await expect(mint.checkMintQuoteBatchBolt11(['q1', 'q2'])).rejects.toThrow(
      'Invalid response from mint',
    );
  });

  it('checkMintQuoteBatch rejects out-of-order quote responses', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest([
        {
          quote: 'q2',
          request: 'lnbc50...',
          unit: 'sat',
          amount: 50,
          state: 'PAID',
          expiry: 123,
        },
        {
          quote: 'q1',
          request: 'lnbc100...',
          unit: 'sat',
          amount: 100,
          state: 'PAID',
          expiry: 123,
        },
      ]),
    });

    await expect(mint.checkMintQuoteBatchBolt11(['q1', 'q2'])).rejects.toThrow(
      'Invalid response from mint',
    );
  });

  it('throws for invalid custom method strings', async () => {
    const mint = new Mint(mintUrl, { customRequest: makeRequest({}) });

    await expect(mint.createMintQuote('bad method', {})).rejects.toThrow(
      'Invalid mint quote method: bad method',
    );
    await expect(mint.checkMintQuote('bad method', 'q1')).rejects.toThrow(
      'Invalid mint quote method: bad method',
    );
    await expect(mint.checkMintQuoteBatch('bad method', ['q1'])).rejects.toThrow(
      'Invalid mint quote method: bad method',
    );
    await expect(mint.mint('bad method', { quote: 'q1', outputs: [] })).rejects.toThrow(
      'Invalid mint method: bad method',
    );
    await expect(mint.createMeltQuote('bad method', {})).rejects.toThrow(
      'Invalid melt quote method: bad method',
    );
    await expect(mint.checkMeltQuote('bad method', 'q1')).rejects.toThrow(
      'Invalid melt quote method: bad method',
    );
    await expect(mint.melt('bad method', { quote: 'q1', inputs: [] })).rejects.toThrow(
      'Invalid melt method: bad method',
    );
  });

  describe('mint quote accounting (NUT-04 amount_paid/amount_issued/updated_at)', () => {
    const baseBolt11 = {
      quote: 'q1',
      request: 'lnbc1...',
      unit: 'sat',
      amount: 21,
      expiry: 123,
    };

    it.each([
      ['UNPAID', 0n, 0n],
      ['PAID', 21n, 0n],
      ['ISSUED', 21n, 21n],
    ])('derives accounting from legacy bolt11 state %s', async (state, paid, issued) => {
      const mint = new Mint(mintUrl, { customRequest: makeRequest({ ...baseBolt11, state }) });

      const response = await mint.checkMintQuoteBolt11('q1');

      expect(response.amount_paid.toBigInt()).toBe(paid);
      expect(response.amount_issued.toBigInt()).toBe(issued);
      expect(response.updated_at).toBeNull();
      expect(response.state).toBe(state);
    });

    it.each([
      [21, 0, 'PAID'],
      [21, 10, 'PAID'],
      [21, 21, 'ISSUED'],
      [0, 0, 'UNPAID'],
    ])(
      'derives bolt11 state from accounting fields paid=%d issued=%d -> %s',
      async (paid, issued, state) => {
        const mint = new Mint(mintUrl, {
          customRequest: makeRequest({
            ...baseBolt11,
            amount_paid: paid,
            amount_issued: issued,
            updated_at: 1750000000,
          }),
        });

        const response = await mint.checkMintQuoteBolt11('q1');

        expect(response.state).toBe(state);
        expect(response.amount_paid.toBigInt()).toBe(BigInt(paid));
        expect(response.amount_issued.toBigInt()).toBe(BigInt(issued));
        expect(response.updated_at).toBe(1750000000);
      },
    );

    it('keeps the mint-provided state when both state and accounting fields are present', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          ...baseBolt11,
          state: 'PAID',
          amount_paid: 21,
          amount_issued: 0,
        }),
      });

      const response = await mint.checkMintQuoteBolt11('q1');

      expect(response.state).toBe('PAID');
    });

    it('normalizes updated_at on bolt12 responses and defaults it to null', async () => {
      const bolt12 = {
        quote: 'q1',
        request: 'lno1...',
        unit: 'sat',
        amount: null,
        expiry: 123,
        pubkey: '02abcd',
        amount_paid: 5,
        amount_issued: 4,
      };
      const withTimestamp = new Mint(mintUrl, {
        customRequest: makeRequest({ ...bolt12, updated_at: 1750000001 }),
      });
      const without = new Mint(mintUrl, { customRequest: makeRequest(bolt12) });

      expect((await withTimestamp.checkMintQuoteBolt12('q1')).updated_at).toBe(1750000001);
      expect((await without.checkMintQuoteBolt12('q1')).updated_at).toBeNull();
    });

    it('normalizes base accounting for custom methods and preserves unknown fields', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          quote: 'q1',
          request: 'acct:12345',
          unit: 'usd',
          amount_paid: 100,
          amount_issued: 40,
          updated_at: 1750000002,
          processor_ref: 'px-77',
        }),
      });

      const response = await mint.checkMintQuote('paypal', 'q1');

      expect(response.amount_paid.toBigInt()).toBe(100n);
      expect(response.amount_issued.toBigInt()).toBe(40n);
      expect(response.updated_at).toBe(1750000002);
      expect((response as Record<string, unknown>).processor_ref).toBe('px-77');
    });

    it('throws when accounting fields are missing and underivable', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({ quote: 'q1', request: 'acct:12345', unit: 'usd' }),
        logger,
      });

      await expect(mint.checkMintQuote('paypal', 'q1')).rejects.toThrow(
        'Invalid response from mint',
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it('throws when a mint quote response lacks base fields', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({ quote: 'q1', amount_paid: 1, amount_issued: 0 }),
      });

      await expect(mint.checkMintQuote('paypal', 'q1')).rejects.toThrow(
        'Invalid response from mint',
      );
    });
  });

  describe('method field on quote responses', () => {
    const mintQuote = {
      quote: 'q1',
      request: 'lnbc1...',
      unit: 'sat',
      state: 'UNPAID',
      expiry: 123,
      amount: 21,
    };
    const meltQuote = {
      quote: 'm1',
      request: 'lnbc1...',
      amount: 9,
      unit: 'sat',
      state: 'UNPAID',
      expiry: 123,
      fee_reserve: 1,
    };

    it('injects method from the endpoint when the mint omits it', async () => {
      const mint = new Mint(mintUrl, { customRequest: makeRequest(mintQuote) });

      expect((await mint.checkMintQuoteBolt11('q1')).method).toBe('bolt11');
    });

    it('injects method on custom quotes and passes a matching method through', async () => {
      const custom = {
        quote: 'q1',
        request: 'acct:12345',
        unit: 'usd',
        amount_paid: 0,
        amount_issued: 0,
      };
      const omitted = new Mint(mintUrl, { customRequest: makeRequest(custom) });
      const matching = new Mint(mintUrl, {
        customRequest: makeRequest({ ...custom, method: 'paypal' }),
      });

      expect((await omitted.checkMintQuote('paypal', 'q1')).method).toBe('paypal');
      expect((await matching.checkMintQuote('paypal', 'q1')).method).toBe('paypal');
    });

    it('injects method on melt quotes when the mint omits it', async () => {
      const mint = new Mint(mintUrl, { customRequest: makeRequest(meltQuote) });

      expect((await mint.checkMeltQuoteBolt11('m1')).method).toBe('bolt11');
    });

    it('throws when the reported method disagrees with the endpoint', async () => {
      const logger = createLogger();
      const wrongMint = new Mint(mintUrl, {
        customRequest: makeRequest({ ...mintQuote, method: 'bolt12' }),
        logger,
      });
      const wrongMelt = new Mint(mintUrl, {
        customRequest: makeRequest({ ...meltQuote, method: 'bolt12' }),
        logger,
      });

      await expect(wrongMint.checkMintQuoteBolt11('q1')).rejects.toThrow(
        'Invalid response from mint',
      );
      await expect(wrongMelt.checkMeltQuoteBolt11('m1')).rejects.toThrow(
        'Invalid response from mint',
      );
      expect(logger.error).toHaveBeenCalledTimes(2);
    });
  });

  describe('custom payment method base normalization (NUT-04/05 common formats)', () => {
    it('normalizes expiry on custom mint quotes and defaults it to null', async () => {
      const base = {
        quote: 'q1',
        request: 'acct:12345',
        unit: 'usd',
        amount_paid: 0,
        amount_issued: 0,
      };
      const withExpiry = new Mint(mintUrl, {
        customRequest: makeRequest({ ...base, expiry: 456 }),
      });
      const without = new Mint(mintUrl, { customRequest: makeRequest(base) });

      expect((await withExpiry.checkMintQuote('paypal', 'q1')).expiry).toBe(456);
      expect((await without.checkMintQuote('paypal', 'q1')).expiry).toBeNull();
    });

    it('normalizes melt base fields for custom methods and preserves unknown fields', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          quote: 'm1',
          request: 'acct:12345',
          amount: 9,
          unit: 'usd',
          state: 'UNPAID',
          expiry: 123,
          fee_reserve: 2,
          processor_ref: 'px-77',
        }),
      });

      const response = await mint.checkMeltQuote('paypal', 'm1');

      expect(response.request).toBe('acct:12345');
      expect(response.fee_reserve?.toBigInt()).toBe(2n);
      expect((response as Record<string, unknown>).processor_ref).toBe('px-77');
    });

    it('leaves fee_reserve undefined for custom melt quotes when not provided', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          quote: 'm1',
          request: 'acct:12345',
          amount: 9,
          unit: 'usd',
          state: 'UNPAID',
          expiry: 123,
        }),
      });

      const response = await mint.checkMeltQuote('paypal', 'm1');

      expect(response.fee_reserve).toBeUndefined();
    });

    it('throws when a custom melt quote lacks the payment request', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          quote: 'm1',
          amount: 9,
          unit: 'usd',
          state: 'UNPAID',
          expiry: 123,
        }),
        logger,
      });

      await expect(mint.checkMeltQuote('paypal', 'm1')).rejects.toThrow(
        'Invalid response from mint',
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('mint payloads (NUT-03/05 inputs)', () => {
    const makeProof = (): Proof => ({
      id: '00keyset',
      amount: Amount.from(1),
      secret: 'proof-secret',
      C: '02signature',
      witness: '{"signatures":["ff"]}',
      dleq: { e: 'dleq-challenge', s: 'dleq-response', r: 'blinding-factor' },
      p2pk_e: 'ephemeral-key',
      spend_info: { k: 'leaf-key', tree: { root: 'r' } } as unknown as Proof['spend_info'],
    });

    const captureInputs = (
      sink: { inputs?: Array<Record<string, unknown>> },
      response: unknown,
    ): RequestFn =>
      (async (options: ReqArgs) => {
        sink.inputs = (
          sentBody(options.requestBody) as { inputs: Array<Record<string, unknown>> }
        ).inputs;
        return response;
      }) as RequestFn;

    it('sends swap inputs without dleq and leaves the caller proofs alone', async () => {
      const sink: { inputs?: Array<Record<string, unknown>> } = {};
      const mint = new Mint(mintUrl, {
        customRequest: captureInputs(sink, { signatures: [] }),
      });
      const proof = makeProof();

      await mint.swap({ inputs: [proof], outputs: [] });

      expect(sink.inputs?.[0]).not.toHaveProperty('dleq');
      expect(sink.inputs?.[0]).not.toHaveProperty('p2pk_e');
      expect(sink.inputs?.[0]).not.toHaveProperty('spend_info');
      expect(sink.inputs?.[0]).toMatchObject({
        id: '00keyset',
        secret: 'proof-secret',
        C: '02signature',
        witness: '{"signatures":["ff"]}',
      });
      expect(sink.inputs?.[0].amount).toBeDefined();
      expect(proof.dleq).toBeDefined();
      expect(proof.p2pk_e).toBeDefined();
      expect(proof.spend_info).toBeDefined();
    });

    it('sends melt inputs without dleq and leaves the caller proofs alone', async () => {
      const sink: { inputs?: Array<Record<string, unknown>> } = {};
      const mint = new Mint(mintUrl, {
        customRequest: captureInputs(sink, {
          quote: 'q1',
          amount: 1,
          unit: 'sat',
          state: MeltQuoteState.PAID,
          expiry: 123,
          request: 'lnbc1...',
          fee_reserve: 0,
        }),
      });
      const proof = makeProof();

      await mint.meltBolt11({ quote: 'q1', inputs: [proof], outputs: [] });

      expect(sink.inputs?.[0]).not.toHaveProperty('dleq');
      expect(sink.inputs?.[0]).not.toHaveProperty('p2pk_e');
      expect(sink.inputs?.[0]).not.toHaveProperty('spend_info');
      expect(sink.inputs?.[0]).toMatchObject({
        id: '00keyset',
        secret: 'proof-secret',
        C: '02signature',
        witness: '{"signatures":["ff"]}',
      });
      expect(proof.dleq).toBeDefined();
      expect(proof.p2pk_e).toBeDefined();
      expect(proof.spend_info).toBeDefined();
    });

    it('throws when swap inputs are not an array', async () => {
      const mint = new Mint(mintUrl, { customRequest: makeRequest({ signatures: [] }) });

      await expect(
        mint.swap({ outputs: [] } as unknown as Parameters<Mint['swap']>[0]),
      ).rejects.toThrow('swap: inputs must be an array of proofs');
      await expect(mint.swap(undefined as unknown as Parameters<Mint['swap']>[0])).rejects.toThrow(
        'swap: inputs must be an array of proofs',
      );
    });

    it('throws when melt inputs are not an array', async () => {
      const mint = new Mint(mintUrl, { customRequest: makeRequest({ quote: 'q1' }) });

      await expect(
        mint.melt('bolt11', { quote: 'q1' } as unknown as Parameters<Mint['melt']>[1]),
      ).rejects.toThrow('melt: inputs must be an array of proofs');
      await expect(
        mint.melt('bolt11', undefined as unknown as Parameters<Mint['melt']>[1]),
      ).rejects.toThrow('melt: inputs must be an array of proofs');
    });
  });

  describe('melt responses (NUT-05 quote binding)', () => {
    const meltResponse = (quote: string) => ({
      quote,
      amount: 12,
      unit: 'sat',
      state: MeltQuoteState.UNPAID,
      expiry: 123,
      request: 'lnbc1...',
      fee_reserve: 1,
      payment_preimage: null,
    });

    it('throws when a checked melt quote reports a different quote id', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest(meltResponse('other-quote')),
        logger,
      });

      await expect(mint.checkMeltQuoteBolt11('my-quote')).rejects.toThrow(/different quote/);
      expect(logger.error).toHaveBeenCalled();
    });

    it('keeps the requested quote id when a melt reports a different one', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest(meltResponse('other-quote')),
        logger,
      });

      const response = await mint.meltBolt11({ quote: 'my-quote', inputs: [], outputs: [] });

      expect(response.quote).toBe('my-quote');
      expect(logger.warn).toHaveBeenCalledWith('Melt response reports a different quote id', {
        op: 'melt.bolt11',
        expected: 'my-quote',
        received: 'other-quote',
      });
    });

    it('returns the request and fee reserve a melt response does carry', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest(meltResponse('q1')),
        logger,
      });

      const response = await mint.meltBolt11({ quote: 'q1', inputs: [], outputs: [] });

      expect(response.request).toBe('lnbc1...');
      expect(response.fee_reserve.toBigInt()).toBe(1n);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('accepts a melt response that omits the request and fee reserve', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          quote: 'q1',
          amount: 1,
          unit: 'sat',
          method: 'bolt11',
          state: MeltQuoteState.PENDING,
          expiry: 123,
        }),
      });

      const response = await mint.meltBolt11({ quote: 'q1', inputs: [], outputs: [] });

      expect(response.state).toBe(MeltQuoteState.PENDING);
      expect(response.amount.toBigInt()).toBe(1n);
      expect(response).not.toHaveProperty('request');
      expect(response).not.toHaveProperty('fee_reserve');
    });

    it('drops an empty request from a melt response', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          quote: 'q1',
          amount: 1,
          unit: 'sat',
          state: MeltQuoteState.PENDING,
          expiry: 123,
          request: '',
          fee_reserve: 0,
        }),
      });

      const response = await mint.meltBolt11({ quote: 'q1', inputs: [], outputs: [] });

      expect(response).not.toHaveProperty('request');
      expect(response.fee_reserve.toBigInt()).toBe(0n);
    });

    it('drops a null request and fee reserve from a melt response', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          quote: 'q1',
          amount: 1,
          unit: 'sat',
          state: MeltQuoteState.PENDING,
          expiry: 123,
          request: null,
          fee_reserve: null,
        }),
      });

      const response = await mint.meltBolt11({ quote: 'q1', inputs: [], outputs: [] });

      expect(response).not.toHaveProperty('request');
      expect(response).not.toHaveProperty('fee_reserve');
    });

    it('throws when a melt response carries a non-string request', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          quote: 'q1',
          amount: 1,
          unit: 'sat',
          state: MeltQuoteState.PENDING,
          expiry: 123,
          request: 42,
          fee_reserve: 1,
        }),
        logger,
      });

      await expect(mint.meltBolt11({ quote: 'q1', inputs: [], outputs: [] })).rejects.toThrow(
        'Invalid response from mint',
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it('still requires the fee reserve when a bolt melt quote is checked', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          quote: 'q1',
          amount: 1,
          unit: 'sat',
          state: MeltQuoteState.PENDING,
          expiry: 123,
          request: 'lnbc1...',
        }),
      });

      await expect(mint.checkMeltQuoteBolt11('q1')).rejects.toThrow('Invalid response from mint');
    });

    it('still requires the request when a melt quote is checked', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          quote: 'q1',
          amount: 1,
          unit: 'sat',
          state: MeltQuoteState.PENDING,
          expiry: 123,
        }),
      });

      await expect(mint.checkMeltQuoteBolt11('q1')).rejects.toThrow('Invalid response from mint');
    });
  });

  describe('createMeltQuoteBolt11 invoice binding', () => {
    const quoteResponse = (request: string) => ({
      quote: 'q1',
      amount: 12,
      unit: 'sat',
      state: MeltQuoteState.UNPAID,
      expiry: 123,
      request,
      fee_reserve: 1,
      payment_preimage: null,
    });

    it('throws when the quote names a different invoice', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest(quoteResponse('lnbc1other')),
      });

      await expect(
        mint.createMeltQuoteBolt11({ request: 'lnbc1mine', unit: 'sat' }),
      ).rejects.toThrow('Melt quote is for a different payment request');
    });

    it('accepts a quote that echoes the invoice in a different case', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest(quoteResponse('LNBC1MINE')),
      });

      const response = await mint.createMeltQuoteBolt11({ request: 'lnbc1mine', unit: 'sat' });

      expect(response.quote).toBe('q1');
    });

    it('accepts a quote that echoes no invoice', async () => {
      const mint = new Mint(mintUrl, { customRequest: makeRequest(quoteResponse('')) });

      const response = await mint.createMeltQuoteBolt11({ request: 'lnbc1mine', unit: 'sat' });

      expect(response.request).toBe('');
    });
  });

  it('throws on invalid swap responses', async () => {
    const logger = createLogger();
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ not_signatures: true }),
      logger,
    });

    await expect(mint.swap({ inputs: [], outputs: [] })).rejects.toThrow(
      'Invalid response from mint',
    );
    expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
      data: { not_signatures: true },
      op: 'swap',
    });
  });

  it('checkMintQuoteBatch throws on invalid response (not an array)', async () => {
    const logger = createLogger();
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ not_quotes: true }),
      logger,
    });

    await expect(mint.checkMintQuoteBatch('bolt11', ['q1'])).rejects.toThrow(
      'Invalid response from mint',
    );
    expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
      data: { not_quotes: true },
      op: 'checkMintQuoteBatch.bolt11',
    });
  });

  it('throws on invalid restore responses', async () => {
    const logger = createLogger();
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ outputs: [] }),
      logger,
    });

    await expect(mint.restore({ outputs: [] })).rejects.toThrow('Invalid response from mint');
    expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
      data: { outputs: [] },
      op: 'restore',
    });
  });

  it('throws on invalid check responses', async () => {
    const logger = createLogger();
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ invalid: true }),
      logger,
    });

    await expect(mint.check({ Ys: [] })).rejects.toThrow('Invalid response from mint');
    expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
      data: { invalid: true },
      op: 'check',
    });
  });

  it('sanitizes base64 keyset ids and honors an alternate mint URL in getKeys', async () => {
    const requestSpy = vi.fn(async (options: ReqArgs) => {
      expect(options.endpoint).toBe('https://alt.example/v1/keys/ab_c-d');
      return { keysets: [] };
    }) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const response = await mint.getKeys('ab/c+d', 'https://alt.example');

    expect(response).toEqual({ keysets: [] });
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it('throws on invalid getKeySets responses', async () => {
    const logger = createLogger();
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ invalid: true }),
      logger,
    });

    await expect(mint.getKeySets()).rejects.toThrow('Invalid response from mint');
    expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
      data: { invalid: true },
      op: 'getKeySets',
    });
  });

  it('normalizes melt quote request options for amountless and mpp values', async () => {
    const requestSpy = vi.fn(async (options: ReqArgs) => {
      expect(sentBody(options.requestBody)).toMatchObject({
        request: 'ln-offer',
        unit: 'sat',
        options: {
          amountless: { amount_msat: 5000 },
        },
      });
      return {
        quote: 'q1',
        amount: 21,
        unit: 'sat',
        state: MeltQuoteState.UNPAID,
        expiry: 123,
        request: 'ln-offer',
        fee_reserve: 1,
      };
    }) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const response = await mint.createMeltQuoteBolt12({
      request: 'ln-offer',
      unit: 'sat',
      options: {
        amountless: { amount_msat: '5000' },
      },
    });

    expect(response.amount.toBigInt()).toBe(21n);
    expect(response.fee_reserve.toBigInt()).toBe(1n);
  });

  it('throws on invalid melt base responses', async () => {
    const logger = createLogger();
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({
        quote: 'q1',
        amount: 1,
        unit: 'sat',
        state: 'BROKEN',
        expiry: 123,
      }),
      logger,
    });

    await expect(mint.checkMeltQuoteBolt12('q1')).rejects.toThrow('Invalid response from mint');
    expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
      data: expect.objectContaining({ quote: 'q1', state: 'BROKEN' }),
      op: 'bolt12 melt quote',
    });
  });

  it('throws on invalid bolt melt fields', async () => {
    const logger = createLogger();
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({
        quote: 'q1',
        amount: 1,
        unit: 'sat',
        state: MeltQuoteState.UNPAID,
        expiry: 123,
        fee_reserve: 1,
      }),
      logger,
    });

    await expect(mint.checkMeltQuoteBolt12('q1')).rejects.toThrow('Invalid response from mint');
    expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
      data: expect.objectContaining({ quote: 'q1' }),
      op: 'bolt12 melt quote',
    });
  });

  describe('normalizeMeltOnchainFields', () => {
    const baseOnchainQuote = {
      quote: 'q1',
      amount: 10,
      unit: 'sat',
      state: MeltQuoteState.UNPAID,
      expiry: 123,
      request: 'bc1qrecipient',
      selected_fee_index: null,
      outpoint: null,
    };

    it('normalizes a valid onchain melt quote response', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          ...baseOnchainQuote,
          fee_options: [
            { fee_index: 0, fee_reserve: 5, estimated_blocks: 1 },
            { fee_index: 1, fee_reserve: 2, estimated_blocks: 6 },
          ],
        }),
      });

      const response = await mint.checkMeltQuoteOnchain('q1');

      expect(response.fee_options[0].fee_index).toBe(0);
      expect(response.fee_options[0].fee_reserve.toBigInt()).toBe(5n);
      expect(response.fee_options[0].estimated_blocks).toBe(1);
      expect(response.fee_options[1].fee_index).toBe(1);
      expect(response.fee_options[1].fee_reserve.toBigInt()).toBe(2n);
      expect(response.fee_options[1].estimated_blocks).toBe(6);
      expect(response.selected_fee_index).toBeNull();
      expect(response.outpoint).toBeNull();
    });

    it('accepts a string outpoint and a numeric selected_fee_index', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          ...baseOnchainQuote,
          state: MeltQuoteState.PAID,
          fee_options: [{ fee_index: 0, fee_reserve: 2, estimated_blocks: 6 }],
          selected_fee_index: 0,
          outpoint: 'txid:0',
        }),
      });

      const response = await mint.checkMeltQuoteOnchain('q1');
      expect(response.selected_fee_index).toBe(0);
      expect(response.outpoint).toBe('txid:0');
    });

    it('treats absent selected_fee_index and outpoint as null', async () => {
      // CDK omits nullable fields when they have no value; we accept that as null.
      const { selected_fee_index: _s, outpoint: _o, ...withoutNullables } = baseOnchainQuote;
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          ...withoutNullables,
          fee_options: [{ fee_index: 0, fee_reserve: 2, estimated_blocks: 6 }],
        }),
      });
      const response = await mint.checkMeltQuoteOnchain('q1');
      expect(response.selected_fee_index).toBeNull();
      expect(response.outpoint).toBeNull();
    });

    it('throws when fee_options is not an array', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({ ...baseOnchainQuote, fee_options: 'nope' }),
        logger,
      });

      await expect(mint.checkMeltQuoteOnchain('q1')).rejects.toThrow('Invalid response from mint');
      expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
        data: expect.objectContaining({ quote: 'q1' }),
        op: 'onchain melt quote',
      });
    });

    it('throws when fee_options is empty', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({ ...baseOnchainQuote, fee_options: [] }),
        logger,
      });

      await expect(mint.checkMeltQuoteOnchain('q1')).rejects.toThrow('Invalid response from mint');
      expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
        data: expect.objectContaining({ quote: 'q1' }),
        op: 'onchain melt quote',
      });
    });

    it.each([
      ['missing', { fee_reserve: 2, estimated_blocks: 6 }],
      ['a non-integer', { fee_index: 1.5, fee_reserve: 2, estimated_blocks: 6 }],
      [
        'an unsafe integer',
        { fee_index: Number.MAX_SAFE_INTEGER + 1, fee_reserve: 2, estimated_blocks: 6 },
      ],
      ['a string', { fee_index: '0', fee_reserve: 2, estimated_blocks: 6 }],
    ])('throws when a fee_options entry has %s fee_index', async (_label, badOption) => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({ ...baseOnchainQuote, fee_options: [badOption] }),
        logger,
      });

      await expect(mint.checkMeltQuoteOnchain('q1')).rejects.toThrow('Invalid response from mint');
      expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
        data: expect.objectContaining({ quote: 'q1' }),
        op: 'onchain melt quote',
      });
    });

    it('throws when request is not a string', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          ...baseOnchainQuote,
          request: 42,
          fee_options: [{ fee_index: 0, fee_reserve: 2, estimated_blocks: 6 }],
        }),
        logger,
      });

      await expect(mint.checkMeltQuoteOnchain('q1')).rejects.toThrow('Invalid response from mint');
      expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
        data: expect.objectContaining({ quote: 'q1' }),
        op: 'onchain melt quote',
      });
    });

    it('throws when selected_fee_index is non-null and not a safe integer', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          ...baseOnchainQuote,
          fee_options: [{ fee_index: 0, fee_reserve: 2, estimated_blocks: 6 }],
          selected_fee_index: 1.5,
        }),
        logger,
      });

      await expect(mint.checkMeltQuoteOnchain('q1')).rejects.toThrow('Invalid response from mint');
      expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
        data: expect.objectContaining({ quote: 'q1' }),
        op: 'onchain melt quote',
      });
    });

    it('throws when outpoint is non-null and not a string', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({
          ...baseOnchainQuote,
          fee_options: [{ fee_index: 0, fee_reserve: 2, estimated_blocks: 6 }],
          outpoint: 12345,
        }),
        logger,
      });

      await expect(mint.checkMeltQuoteOnchain('q1')).rejects.toThrow('Invalid response from mint');
      expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
        data: expect.objectContaining({ quote: 'q1' }),
        op: 'onchain melt quote',
      });
    });
  });

  it('mintOnchain posts to /v1/mint/onchain', async () => {
    const requestSpy = vi.fn(async (options: ReqArgs) => {
      expect(options.endpoint).toBe(mintUrl + '/v1/mint/onchain');
      expect(options.method).toBe('POST');
      return { signatures: [{ amount: 4, C_: '02sig', id: '00' }] };
    }) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const response = await mint.mintOnchain({ quote: 'q1', outputs: [blankOutput()] });

    expect(response.signatures).toHaveLength(1);
    expect(response.signatures[0].amount.toBigInt()).toBe(4n);
  });

  it('meltOnchain accepts an execution response without fee_options', async () => {
    const requestSpy = vi.fn(async () => ({
      quote: 'q1',
      amount: 10,
      unit: 'sat',
      state: MeltQuoteState.PENDING,
      expiry: 123,
    })) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const response = await mint.meltOnchain({ quote: 'q1', inputs: [], outputs: [] });

    expect(response.quote).toBe('q1');
    expect(response.state).toBe(MeltQuoteState.PENDING);
    expect(response.fee_options).toBeUndefined();
    expect(response.selected_fee_index).toBeNull();
    expect(response.outpoint).toBeNull();
  });

  it('meltOnchain posts to /v1/melt/onchain and normalizes onchain fields', async () => {
    const requestSpy = vi.fn(async (options: ReqArgs) => {
      expect(options.endpoint).toBe(mintUrl + '/v1/melt/onchain');
      expect(options.method).toBe('POST');
      return {
        quote: 'q1',
        amount: 10,
        unit: 'sat',
        state: MeltQuoteState.PAID,
        expiry: 123,
        request: 'bc1qrecipient',
        fee_options: [{ fee_index: 0, fee_reserve: 2, estimated_blocks: 6 }],
        selected_fee_index: 0,
        outpoint: 'txid:0',
      };
    }) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const response = await mint.meltOnchain({ quote: 'q1', inputs: [], outputs: [] });

    expect(response.amount.toBigInt()).toBe(10n);
    expect(response.fee_options[0].fee_reserve.toBigInt()).toBe(2n);
    expect(response.selected_fee_index).toBe(0);
    expect(response.outpoint).toBe('txid:0');
  });

  it('mintBatchBolt11 posts to /v1/mint/bolt11/batch and normalizes signature amounts', async () => {
    const requestSpy = vi.fn(async (options: ReqArgs) => {
      expect(options.endpoint).toBe(mintUrl + '/v1/mint/bolt11/batch');
      expect(options.method).toBe('POST');
      return {
        signatures: [
          { amount: 1, C_: '02sig1', id: '00' },
          { amount: 2, C_: '02sig2', id: '00' },
        ],
      };
    }) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const response = await mint.mintBatchBolt11({
      quotes: ['q1', 'q2'],
      quote_amounts: [Amount.from(1), Amount.from(2)],
      outputs: [blankOutput(1), blankOutput(2)],
    });

    expect(response.signatures).toHaveLength(2);
    expect(response.signatures[0].amount.toBigInt()).toBe(1n);
    expect(response.signatures[1].amount.toBigInt()).toBe(2n);
  });

  it('mintBatchBolt12 posts to /v1/mint/bolt12/batch and normalizes signature amounts', async () => {
    const requestSpy = vi.fn(async (options: ReqArgs) => {
      expect(options.endpoint).toBe(mintUrl + '/v1/mint/bolt12/batch');
      expect(options.method).toBe('POST');
      return {
        signatures: [{ amount: 4, C_: '02sig', id: '00' }],
      };
    }) as RequestFn;
    const mint = new Mint(mintUrl, { customRequest: requestSpy });

    const response = await mint.mintBatchBolt12({
      quotes: ['q1'],
      quote_amounts: [Amount.from(4)],
      outputs: [blankOutput(4)],
    });

    expect(response.signatures).toHaveLength(1);
    expect(response.signatures[0].amount.toBigInt()).toBe(4n);
  });

  it('mintBatch throws on invalid method string', async () => {
    const mint = new Mint(mintUrl, { customRequest: makeRequest({}) });

    await expect(
      mint.mintBatch('bad method', { quotes: [], quote_amounts: [], outputs: [] }),
    ).rejects.toThrow('Invalid mint method: bad method');
  });

  it('mintBatch throws on invalid response (missing signatures array)', async () => {
    const logger = createLogger();
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ not_signatures: true }),
      logger,
    });

    await expect(
      mint.mintBatch('bolt11', {
        quotes: ['q1'],
        quote_amounts: [Amount.from(1)] as any,
        outputs: [],
      }),
    ).rejects.toThrow('Invalid response from mint');
    expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
      data: { not_signatures: true },
      op: 'mintBatch.bolt11',
    });
  });

  it('mintBatch throws on invalid response (signatures is not an array)', async () => {
    const logger = createLogger();
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ signatures: {} }),
      logger,
    });

    await expect(
      mint.mintBatch('bolt11', {
        quotes: ['q1'],
        quote_amounts: [Amount.from(1)] as any,
        outputs: [],
      }),
    ).rejects.toThrow('Invalid response from mint');
    expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
      data: { signatures: {} },
      op: 'mintBatch.bolt11',
    });
  });

  it('throws on invalid minted signatures responses', async () => {
    const logger = createLogger();
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ signatures: {} }),
      logger,
    });

    await expect(mint.mintBolt12({ quote: 'q1', outputs: [] })).rejects.toThrow(
      'Invalid response from mint',
    );
    expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
      data: { signatures: {} },
      op: 'mint.bolt12',
    });
  });

  it('connectWebSocket builds the expected URL and disconnectWebSocket closes the connection', async () => {
    injectWebSocketImpl(WebSocket);
    const server = new Server(fakeWsUrl, { mock: false });
    const mint = new Mint('https://mint.example/cashu');
    let serverSocket!: Client;

    try {
      await new Promise<void>((res) => {
        server.on('connection', (socket) => {
          serverSocket = socket;
          res();
        });
        void mint.connectWebSocket();
      });

      expect(mint.webSocketConnection?.url.toString()).toBe(fakeWsUrl);

      await new Promise<void>((res) => {
        mint.webSocketConnection?.onClose(() => res());
        mint.disconnectWebSocket();
      });

      expect(serverSocket.readyState).not.toBe(WebSocket.OPEN);
    } finally {
      server.close();
    }
  });

  it('connectWebSocket appends /v1/ws when mintUrl has no path suffix', async () => {
    injectWebSocketImpl(WebSocket);
    const wsUrl = 'ws://mint.example/v1/ws';
    const server = new Server(wsUrl, { mock: false });
    const mint = new Mint('http://mint.example');

    try {
      await new Promise<void>((res) => {
        server.on('connection', () => res());
        void mint.connectWebSocket();
      });
      expect(mint.webSocketConnection?.url.toString()).toBe(wsUrl);
    } finally {
      mint.disconnectWebSocket();
      server.close();
    }
  });

  it('connectWebSocket resets the connection when ensureConnection fails', async () => {
    injectWebSocketImpl(WebSocket);
    const ensureSpy = vi
      .spyOn(WSConnection.prototype, 'ensureConnection')
      .mockRejectedValue(new Error('boom'));
    const logger = createLogger();
    const mint = new Mint('https://mint.example/cashu', { logger });

    await expect(mint.connectWebSocket()).rejects.toThrow('Failed to connect to WebSocket...');
    expect(ensureSpy).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('Failed to connect to WebSocket...', {
      e: expect.any(Error),
    });
    expect(mint.webSocketConnection).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// msw-based tests for lastResponseMetadata
// ---------------------------------------------------------------------------
const mswMintUrl = 'https://meta-test-mint.localhost:4444';
const mswServer = setupServer();

beforeAll(() => {
  mswServer.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  mswServer.resetHandlers();
});

afterAll(() => {
  mswServer.close();
});

describe('Mint.lastResponseMetadata', () => {
  it('is undefined before any request', () => {
    const mint = new Mint(mswMintUrl);
    expect(mint.lastResponseMetadata).toBeUndefined();
  });

  it('is populated after a successful request — status 200', async () => {
    mswServer.use(
      http.get(mswMintUrl + '/v1/info', () => {
        return HttpResponse.json(MINTINFORESP);
      }),
    );
    const mint = new Mint(mswMintUrl);
    await mint.getInfo();

    expect(mint.lastResponseMetadata).toBeDefined();
    expect(mint.lastResponseMetadata!.status).toBe(200);
  });

  it('updates to reflect the most recent response after multiple requests', async () => {
    mswServer.use(
      http.get(mswMintUrl + '/v1/info', () => {
        return HttpResponse.json(MINTINFORESP);
      }),
      http.get(mswMintUrl + '/v1/keys', () => {
        return HttpResponse.json(
          { keysets: [] },
          { headers: { RateLimit: 'limit=100, remaining=50, reset=30' } },
        );
      }),
    );
    const mint = new Mint(mswMintUrl);

    await mint.getInfo();
    expect(mint.lastResponseMetadata!.rateLimit).toBeUndefined();

    await mint.getKeys();
    expect(mint.lastResponseMetadata!.rateLimit).toBe('limit=100, remaining=50, reset=30');
  });

  it('rateLimit is populated when the RateLimit header is present', async () => {
    mswServer.use(
      http.get(mswMintUrl + '/v1/info', () => {
        return HttpResponse.json(MINTINFORESP, {
          headers: {
            RateLimit: 'limit=200, remaining=199, reset=60',
            'RateLimit-Policy': '200;w=60',
          },
        });
      }),
    );
    const mint = new Mint(mswMintUrl);
    await mint.getInfo();

    expect(mint.lastResponseMetadata).toBeDefined();
    expect(mint.lastResponseMetadata!.rateLimit).toBe('limit=200, remaining=199, reset=60');
    expect(mint.lastResponseMetadata!.rateLimitPolicy).toBe('200;w=60');
  });

  it('after a 429, lastResponseMetadata has status 429 and retryAfterMs even though RateLimitError was thrown', async () => {
    mswServer.use(
      http.get(mswMintUrl + '/v1/keys', () => {
        return new HttpResponse(JSON.stringify({ error: 'Too Many Requests' }), {
          status: 429,
          headers: { 'Retry-After': '30' },
        });
      }),
    );
    const mint = new Mint(mswMintUrl);

    await expect(mint.getKeys()).rejects.toThrow(RateLimitError);
    expect(mint.lastResponseMetadata).toBeDefined();
    expect(mint.lastResponseMetadata!.status).toBe(429);
    expect(mint.lastResponseMetadata!.retryAfterMs).toBe(30_000);
  });

  it('two separate Mint instances have independent lastResponseMetadata', async () => {
    const mintUrl2 = 'https://meta-test-mint2.localhost:5555';
    mswServer.use(
      http.get(mswMintUrl + '/v1/info', () => {
        return HttpResponse.json(MINTINFORESP, {
          headers: { RateLimit: 'limit=100, remaining=99, reset=60' },
        });
      }),
      http.get(mintUrl2 + '/v1/info', () => {
        return HttpResponse.json(MINTINFORESP, {
          headers: { RateLimit: 'limit=50, remaining=10, reset=30' },
        });
      }),
    );

    const mint1 = new Mint(mswMintUrl);
    const mint2 = new Mint(mintUrl2);

    await mint1.getInfo();
    await mint2.getInfo();

    expect(mint1.lastResponseMetadata!.rateLimit).toBe('limit=100, remaining=99, reset=60');
    expect(mint2.lastResponseMetadata!.rateLimit).toBe('limit=50, remaining=10, reset=30');
  });
});

describe('Mint response shape and cardinality', () => {
  // A response element the transport hands back may be any JSON value; a Proxy makes it observable
  // whether it is copied before the shape is checked.
  const watchedArray = (seen: { enumerated: boolean }) =>
    new Proxy([] as unknown[], {
      ownKeys(target) {
        seen.enumerated = true;
        return Reflect.ownKeys(target);
      },
    });

  it('rejects a mint quote response that is not a record', async () => {
    const seen = { enumerated: false };
    const mint = new Mint(mintUrl, { customRequest: makeRequest(watchedArray(seen)) });

    await expect(mint.checkMintQuote('bolt11', 'q1')).rejects.toThrow('Invalid response from mint');
    expect(seen.enumerated).toBe(false);
  });

  it('rejects a scalar mint quote response', async () => {
    const mint = new Mint(mintUrl, { customRequest: makeRequest('x'.repeat(64)) });

    await expect(mint.checkMintQuote('bolt11', 'q1')).rejects.toThrow('Invalid response from mint');
  });

  it('rejects a melt quote response that is not a record', async () => {
    const seen = { enumerated: false };
    const mint = new Mint(mintUrl, { customRequest: makeRequest(watchedArray(seen)) });

    await expect(mint.checkMeltQuote('bolt11', 'q1')).rejects.toThrow('Invalid response from mint');
    expect(seen.enumerated).toBe(false);
  });

  it('rejects a signature entry that is not a record', async () => {
    const seen = { enumerated: false };
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ signatures: [watchedArray(seen)] }),
    });

    await expect(mint.mintBolt11({ quote: 'q1', outputs: [blankOutput(1)] })).rejects.toThrow(
      'Invalid response from mint',
    );
    expect(seen.enumerated).toBe(false);
  });

  it('rejects a restored output entry that is not a record', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ outputs: ['not-an-output'], signatures: [blindSignature(1)] }),
    });

    await expect(mint.restore({ outputs: [blankOutput(1)] })).rejects.toThrow(
      'Invalid response from mint',
    );
  });

  it('rejects a keyset entry that is not a record in getKeys', async () => {
    const seen = { enumerated: false };
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ keysets: [watchedArray(seen)] }),
    });

    await expect(mint.getKeys()).rejects.toThrow('Invalid response from mint');
    expect(seen.enumerated).toBe(false);
  });

  it('rejects a keyset entry that is not a record in getKeySets', async () => {
    const mint = new Mint(mintUrl, { customRequest: makeRequest({ keysets: ['00'] }) });

    await expect(mint.getKeySets()).rejects.toThrow('Invalid response from mint');
  });

  it.each([
    ['getKeys', (mint: Mint) => mint.getKeys()],
    ['getKeySets', (mint: Mint) => mint.getKeySets()],
  ])('rejects an oversized keyset list in %s', async (_label, call) => {
    const keysets = Array.from({ length: MAX_KEYSET_LIST + 1 }, () => ({
      id: '00',
      unit: 'sat',
      active: true,
    }));
    const mint = new Mint(mintUrl, { customRequest: makeRequest({ keysets }) });

    await expect(call(mint)).rejects.toThrow('Invalid response from mint');
  });

  it('accepts a keyset list far larger than the mint info list cap', async () => {
    const keysets = Array.from({ length: MAX_MINT_INFO_LIST + 1 }, (_, i) => ({
      id: `00${i}`,
      unit: 'sat',
      active: false,
    }));
    const mint = new Mint(mintUrl, { customRequest: makeRequest({ keysets }) });

    const response = await mint.getKeySets();

    expect(response.keysets).toHaveLength(MAX_MINT_INFO_LIST + 1);
  });

  it('rejects an oversized onchain fee option list', async () => {
    const fee_options = Array.from({ length: MAX_MINT_INFO_LIST + 1 }, (_, i) => ({
      fee_index: i,
      fee_reserve: 2,
      estimated_blocks: 6,
    }));
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({
        quote: 'q1',
        amount: 10,
        unit: 'sat',
        state: MeltQuoteState.UNPAID,
        expiry: 123,
        request: 'bc1qrecipient',
        fee_options,
      }),
    });

    await expect(mint.checkMeltQuoteOnchain('q1')).rejects.toThrow('Invalid response from mint');
  });

  it('rejects more swap signatures than outputs and points at recovery', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ signatures: [blindSignature(1), blindSignature(2)] }),
    });

    await expect(mint.swap({ inputs: [], outputs: [blankOutput(1)] })).rejects.toThrow(
      /Invalid response from mint: 2 signatures, expected 1\..*NUT-09/,
    );
  });

  it('rejects more mint signatures than outputs', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ signatures: [blindSignature(1), blindSignature(2)] }),
    });

    await expect(mint.mintBolt11({ quote: 'q1', outputs: [blankOutput(1)] })).rejects.toThrow(
      'Invalid response from mint',
    );
  });

  it('rejects more batch mint signatures than outputs', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ signatures: [blindSignature(1), blindSignature(2)] }),
    });

    await expect(
      mint.mintBatchBolt11({
        quotes: ['q1'],
        quote_amounts: [Amount.from(1)],
        outputs: [blankOutput(1)],
      }),
    ).rejects.toThrow('Invalid response from mint');
  });

  it('returns restored outputs paired with their signatures', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ outputs: [blankOutput(1)], signatures: [blindSignature(1)] }),
    });

    const response = await mint.restore({ outputs: [blankOutput(1), blankOutput(2)] });

    expect(response.outputs).toHaveLength(1);
    expect(response.signatures[0].amount.toBigInt()).toBe(1n);
  });

  it('rejects a restore response whose outputs and signatures do not pair up', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ outputs: [blankOutput(1)], signatures: [] }),
    });

    await expect(mint.restore({ outputs: [blankOutput(1)] })).rejects.toThrow(
      'Invalid response from mint',
    );
  });

  it('rejects a restore response with more entries than were requested', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({
        outputs: [blankOutput(1), blankOutput(2)],
        signatures: [blindSignature(1), blindSignature(2)],
      }),
    });

    await expect(mint.restore({ outputs: [blankOutput(1)] })).rejects.toThrow(
      'Invalid response from mint',
    );
  });

  it('rejects a proof state entry that is not a record', async () => {
    const mint = new Mint(mintUrl, { customRequest: makeRequest({ states: ['UNSPENT'] }) });

    await expect(mint.check({ Ys: ['02y'] })).rejects.toThrow('Invalid response from mint');
  });

  it('rejects more proof states than identifiers checked', async () => {
    const mint = new Mint(mintUrl, {
      customRequest: makeRequest({ states: [{ Y: '02y', state: 'UNSPENT' }] }),
    });

    await expect(mint.check({ Ys: [] })).rejects.toThrow('Invalid response from mint');
  });

  it('accepts fewer proof states than identifiers checked', async () => {
    const mint = new Mint(mintUrl, { customRequest: makeRequest({ states: [] }) });

    const response = await mint.check({ Ys: ['02y'] });

    expect(response.states).toHaveLength(0);
  });
});
