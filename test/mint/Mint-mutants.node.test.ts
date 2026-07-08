import { WebSocket } from 'mock-socket';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  Amount,
  MeltQuoteState,
  Mint,
  WSConnection,
  injectWebSocketImpl,
  type Logger,
  type AuthProvider,
  type RequestFn,
} from '../../src';

type ReqArgs = {
  endpoint: string;
  method?: string;
  requestBody?: unknown;
  headers?: Record<string, string>;
  ttl?: number;
  cached_endpoints?: unknown;
};

const mintUrl = 'https://localhost:3338';

const makeRequest = <T>(payload: T): RequestFn => {
  return (async (options: ReqArgs): Promise<T> => {
    void options;
    return payload;
  }) as RequestFn;
};

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

const baseInfo = {
  name: 'mint',
  pubkey: '02abcd',
  version: 'test',
  contact: [],
};

const infoWithN21 = (client_id?: string) => ({
  ...baseInfo,
  nuts: {
    '4': { disabled: false, methods: [] },
    '5': { disabled: false, methods: [] },
    '21': {
      openid_discovery: 'https://auth.example/.well-known/openid-configuration',
      ...(client_id ? { client_id } : {}),
      protected_endpoints: [],
    },
  },
});

const clientIdOf = (oidc: object): string | undefined => (oidc as { clientId?: string }).clientId;

const meltBaseResp = {
  quote: 'q1',
  request: 'pay-me',
  amount: 2,
  unit: 'sat',
  state: MeltQuoteState.UNPAID,
  expiry: 3,
};

const meltBoltResp = { ...meltBaseResp, request: 'lnbc1...', fee_reserve: 1 };

const meltOnchainResp = {
  ...meltBaseResp,
  request: 'bc1qrecipient',
  fee_options: [{ fee_index: 0, fee_reserve: 2, estimated_blocks: 6 }],
  selected_fee_index: null,
  outpoint: null,
};

const mintQuoteBolt11Resp = {
  quote: 'q1',
  request: 'lnbc1...',
  unit: 'sat',
  state: 'UNPAID',
  amount: 1,
  expiry: 1,
};

const mintQuoteBolt12Resp = {
  quote: 'q1',
  request: 'lno1...',
  unit: 'sat',
  state: 'UNPAID',
  amount: null,
  expiry: 1,
  amount_paid: 0,
  amount_issued: 0,
};

const mintQuoteOnchainResp = {
  quote: 'q1',
  request: 'bc1qdeposit',
  unit: 'sat',
  state: 'UNPAID',
  expiry: 1,
  pubkey: '02abcd',
  amount_paid: 0,
  amount_issued: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  injectWebSocketImpl(WebSocket);
});

describe('Mint mutation coverage', () => {
  describe('oidcAuth clientId resolution', () => {
    it('prefers the caller clientId over mint metadata', async () => {
      const mint = new Mint(mintUrl, { customRequest: makeRequest(infoWithN21('mint-client')) });

      const oidc = await mint.oidcAuth({ clientId: 'my-client' });

      expect(clientIdOf(oidc)).toBe('my-client');
    });

    it('falls back to the mint client_id when no opts are given', async () => {
      const mint = new Mint(mintUrl, { customRequest: makeRequest(infoWithN21('mint-client')) });

      const oidc = await mint.oidcAuth();

      expect(clientIdOf(oidc)).toBe('mint-client');
    });

    it('defaults to cashu-client when neither caller nor mint supply one', async () => {
      const mint = new Mint(mintUrl, { customRequest: makeRequest(infoWithN21()) });

      const oidc = await mint.oidcAuth();

      expect(clientIdOf(oidc)).toBe('cashu-client');
    });
  });

  describe('generic quote methods without options', () => {
    it('createMintQuote works without an options argument', async () => {
      const requestSpy = vi.fn(async (options: ReqArgs) => {
        expect(options.endpoint).toBe(mintUrl + '/v1/mint/quote/custom-pay');
        expect(options.method).toBe('POST');
        expect(options.requestBody).toEqual({ unit: 'sat' });
        return { quote: 'q1', request: 'pay-req', unit: 'sat', state: 'UNPAID', expiry: 1 };
      }) as RequestFn;
      const mint = new Mint(mintUrl, { customRequest: requestSpy });

      const res = await mint.createMintQuote('custom-pay', { unit: 'sat' });

      expect(res.quote).toBe('q1');
      expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it('checkMintQuote works without an options argument and issues a GET', async () => {
      const requestSpy = vi.fn(async (options: ReqArgs) => {
        expect(options.endpoint).toBe(mintUrl + '/v1/mint/quote/custom-pay/q1');
        expect(options.method).toBe('GET');
        return { quote: 'q1', request: 'pay-req', unit: 'sat', state: 'UNPAID', expiry: 1 };
      }) as RequestFn;
      const mint = new Mint(mintUrl, { customRequest: requestSpy });

      const res = await mint.checkMintQuote('custom-pay', 'q1');

      expect(res.quote).toBe('q1');
      expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it('createMeltQuote works without an options argument', async () => {
      const requestSpy = vi.fn(async (options: ReqArgs) => {
        expect(options.endpoint).toBe(mintUrl + '/v1/melt/quote/custom-pay');
        expect(options.method).toBe('POST');
        return meltBaseResp;
      }) as RequestFn;
      const mint = new Mint(mintUrl, { customRequest: requestSpy });

      const res = await mint.createMeltQuote('custom-pay', { unit: 'sat', request: 'pay-me' });

      expect(res.quote).toBe('q1');
      expect(res.amount.toBigInt()).toBe(2n);
    });

    it('checkMeltQuote works without an options argument and issues a GET', async () => {
      const requestSpy = vi.fn(async (options: ReqArgs) => {
        expect(options.endpoint).toBe(mintUrl + '/v1/melt/quote/custom-pay/q1');
        expect(options.method).toBe('GET');
        return meltBaseResp;
      }) as RequestFn;
      const mint = new Mint(mintUrl, { customRequest: requestSpy });

      const res = await mint.checkMeltQuote('custom-pay', 'q1');

      expect(res.quote).toBe('q1');
      expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects non-string methods at runtime', async () => {
      const mint = new Mint(mintUrl, { customRequest: makeRequest({}) });

      await expect(mint.createMintQuote(123 as any, {})).rejects.toThrow(
        'Invalid mint quote method: 123',
      );
    });
  });

  describe('wrapper methods forward their customRequest argument', () => {
    it.each([
      {
        name: 'createMintQuoteBolt11',
        response: mintQuoteBolt11Resp,
        invoke: (m: Mint, cr: RequestFn) => m.createMintQuoteBolt11({ amount: 1, unit: 'sat' }, cr),
      },
      {
        name: 'createMintQuoteOnchain',
        response: mintQuoteOnchainResp,
        invoke: (m: Mint, cr: RequestFn) =>
          m.createMintQuoteOnchain({ unit: 'sat', pubkey: '02abcd' }, cr),
      },
      {
        name: 'checkMintQuoteBolt11',
        response: mintQuoteBolt11Resp,
        invoke: (m: Mint, cr: RequestFn) => m.checkMintQuoteBolt11('q1', cr),
      },
      {
        name: 'checkMintQuoteBolt12',
        response: mintQuoteBolt12Resp,
        invoke: (m: Mint, cr: RequestFn) => m.checkMintQuoteBolt12('q1', cr),
      },
      {
        name: 'checkMintQuoteOnchain',
        response: mintQuoteOnchainResp,
        invoke: (m: Mint, cr: RequestFn) => m.checkMintQuoteOnchain('q1', cr),
      },
      {
        name: 'mintBolt11',
        response: { signatures: [] },
        invoke: (m: Mint, cr: RequestFn) => m.mintBolt11({ quote: 'q1', outputs: [] }, cr),
      },
      {
        name: 'mintBolt12',
        response: { signatures: [] },
        invoke: (m: Mint, cr: RequestFn) => m.mintBolt12({ quote: 'q1', outputs: [] }, cr),
      },
      {
        name: 'mintOnchain',
        response: { signatures: [] },
        invoke: (m: Mint, cr: RequestFn) => m.mintOnchain({ quote: 'q1', outputs: [] }, cr),
      },
      {
        name: 'mintBatchBolt11',
        response: { signatures: [] },
        invoke: (m: Mint, cr: RequestFn) =>
          m.mintBatchBolt11({ quotes: ['q1'], quote_amounts: [Amount.from(1)], outputs: [] }, cr),
      },
      {
        name: 'mintBatchBolt12',
        response: { signatures: [] },
        invoke: (m: Mint, cr: RequestFn) =>
          m.mintBatchBolt12({ quotes: ['q1'], quote_amounts: [Amount.from(1)], outputs: [] }, cr),
      },
      {
        name: 'createMeltQuoteBolt11',
        response: meltBoltResp,
        invoke: (m: Mint, cr: RequestFn) =>
          m.createMeltQuoteBolt11({ request: 'lnbc1...', unit: 'sat' }, cr),
      },
      {
        name: 'createMeltQuoteBolt12',
        response: meltBoltResp,
        invoke: (m: Mint, cr: RequestFn) =>
          m.createMeltQuoteBolt12({ request: 'lno1...', unit: 'sat' }, cr),
      },
      {
        name: 'createMeltQuoteOnchain',
        response: meltOnchainResp,
        invoke: (m: Mint, cr: RequestFn) =>
          m.createMeltQuoteOnchain({ request: 'bc1qrecipient', unit: 'sat', amount: 10 }, cr),
      },
      {
        name: 'checkMeltQuoteBolt11',
        response: meltBoltResp,
        invoke: (m: Mint, cr: RequestFn) => m.checkMeltQuoteBolt11('q1', cr),
      },
      {
        name: 'checkMeltQuoteBolt12',
        response: meltBoltResp,
        invoke: (m: Mint, cr: RequestFn) => m.checkMeltQuoteBolt12('q1', cr),
      },
      {
        name: 'checkMeltQuoteOnchain',
        response: meltOnchainResp,
        invoke: (m: Mint, cr: RequestFn) => m.checkMeltQuoteOnchain('q1', cr),
      },
    ])('$name uses the passed customRequest, not the default', async ({ response, invoke }) => {
      const defaultSpy = vi.fn(async () => {
        throw new Error('default request used');
      }) as RequestFn;
      const override = vi.fn(async () => response) as RequestFn;
      const mint = new Mint(mintUrl, { customRequest: defaultSpy });

      await invoke(mint, override);

      expect(override).toHaveBeenCalledTimes(1);
      expect(defaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('request payload shapes', () => {
    it('mintBatch serializes quote_amounts as bigints', async () => {
      const requestSpy = vi.fn(async (options: ReqArgs) => {
        expect(options.endpoint).toBe(mintUrl + '/v1/mint/custom-pay/batch');
        expect((options.requestBody as { quote_amounts: unknown }).quote_amounts).toEqual([1n, 2n]);
        return { signatures: [] };
      }) as RequestFn;
      const mint = new Mint(mintUrl, { customRequest: requestSpy });

      await mint.mintBatch('custom-pay', {
        quotes: ['q1', 'q2'],
        quote_amounts: [Amount.from(1), Amount.from(2)],
        outputs: [],
      });

      expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it('check posts the payload to /v1/checkstate and coerces missing witness to null', async () => {
      const requestSpy = vi.fn(async (options: ReqArgs) => {
        expect(options.endpoint).toBe(mintUrl + '/v1/checkstate');
        expect(options.method).toBe('POST');
        expect(options.requestBody).toEqual({ Ys: ['02y'] });
        return { states: [{ Y: '02y', state: 'UNSPENT' }] };
      }) as RequestFn;
      const mint = new Mint(mintUrl, { customRequest: requestSpy });

      const res = await mint.check({ Ys: ['02y'] });

      expect(res.states[0].witness).toBeNull();
    });

    it('forwards unknown melt quote option fields untouched', async () => {
      const requestSpy = vi.fn(async (options: ReqArgs) => {
        const body = options.requestBody as { options: Record<string, unknown> };
        expect(body.options.amountless).toEqual({ amount_msat: 1000n });
        expect(body.options.custom_hint).toBe('keep-me');
        return meltBoltResp;
      }) as RequestFn;
      const mint = new Mint(mintUrl, { customRequest: requestSpy });

      await mint.createMeltQuoteBolt11({
        request: 'lnbc1...',
        unit: 'sat',
        options: { amountless: { amount_msat: '1000' }, custom_hint: 'keep-me' } as any,
      });

      expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it('normalizes mpp amounts to bigints in melt quote requests', async () => {
      const requestSpy = vi.fn(async (options: ReqArgs) => {
        const body = options.requestBody as { options: { mpp: unknown } };
        expect(body.options.mpp).toEqual({ amount: 5000n });
        return meltBoltResp;
      }) as RequestFn;
      const mint = new Mint(mintUrl, { customRequest: requestSpy });

      await mint.createMeltQuoteBolt11({
        request: 'lnbc1...',
        unit: 'sat',
        options: { mpp: { amount: '5000' } },
      });

      expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it('tolerates an explicitly undefined mpp option', async () => {
      const requestSpy = vi.fn(async (options: ReqArgs) => {
        const body = options.requestBody as { options: { mpp?: unknown } };
        expect(body.options.mpp).toBeUndefined();
        return meltBoltResp;
      }) as RequestFn;
      const mint = new Mint(mintUrl, { customRequest: requestSpy });

      const res = await mint.createMeltQuoteBolt11({
        request: 'lnbc1...',
        unit: 'sat',
        options: { mpp: undefined },
      });

      expect(res.quote).toBe('q1');
    });
  });

  describe('response validation', () => {
    it('throws on invalid getKeys responses', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({ invalid: true }),
        logger,
      });

      await expect(mint.getKeys()).rejects.toThrow('Invalid response from mint');
      expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
        data: { invalid: true },
        op: 'getKeys',
      });
    });

    it('throws on restore responses that lack outputs', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({ signatures: [] }),
        logger,
      });

      await expect(mint.restore({ outputs: [] })).rejects.toThrow('Invalid response from mint');
      expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
        data: { signatures: [] },
        op: 'restore',
      });
    });

    it('rejects melt quote responses whose quote is not a string', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({ ...meltBaseResp, quote: 123 }),
        logger,
      });

      await expect(mint.checkMeltQuote('custom-pay', 'q1')).rejects.toThrow(
        'Invalid response from mint',
      );
      expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
        data: expect.objectContaining({ quote: 123 }),
        op: 'custom-pay melt quote',
      });
    });

    it('rejects melt quote responses whose unit is not a string', async () => {
      const logger = createLogger();
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({ ...meltBaseResp, unit: 42 }),
        logger,
      });

      await expect(mint.checkMeltQuote('custom-pay', 'q1')).rejects.toThrow(
        'Invalid response from mint',
      );
      expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
        data: expect.objectContaining({ unit: 42 }),
        op: 'custom-pay melt quote',
      });
    });

    it('rejects melt quote responses whose expiry is not a number', async () => {
      const logger = createLogger();
      // A null expiry normalizes to undefined (not a throw), so the typeof guard is the
      // only thing that rejects it: the mint must supply a numeric expiry.
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({ ...meltBaseResp, expiry: null }),
        logger,
      });

      await expect(mint.checkMeltQuote('custom-pay', 'q1')).rejects.toThrow(
        'Invalid response from mint',
      );
      expect(logger.error).toHaveBeenCalledWith('Invalid response from mint...', {
        data: expect.objectContaining({ expiry: undefined }),
        op: 'custom-pay melt quote',
      });
    });

    it('reports the mint quote expiry field when a bolt11 expiry is out of range', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({ ...mintQuoteBolt11Resp, expiry: 9007199254740993n }),
      });

      await expect(mint.checkMintQuoteBolt11('q1')).rejects.toThrow('mintQuote.expiry');
    });

    it('reports the mint quote expiry field when an onchain expiry is out of range', async () => {
      const mint = new Mint(mintUrl, {
        customRequest: makeRequest({ ...mintQuoteOnchainResp, expiry: 9007199254740993n }),
      });

      await expect(mint.checkMintQuoteOnchain('q1')).rejects.toThrow('mintQuote.expiry');
    });
  });

  describe('requestWithAuth', () => {
    it('applies NUT-19 params when mint info is fetched during an authed request', async () => {
      const infoResp = {
        ...baseInfo,
        nuts: {
          '4': { disabled: false, methods: [] },
          '5': { disabled: false, methods: [] },
          '19': { ttl: 12, cached_endpoints: [{ method: 'POST', path: '/v1/swap' }] },
        },
      };
      const requestSpy = vi.fn(async (options: ReqArgs) => {
        if (options.endpoint.endsWith('/v1/info')) return infoResp;
        expect(options.endpoint).toBe(mintUrl + '/v1/swap');
        // MintInfo maps NUT-19 TTL seconds to request-layer milliseconds.
        expect(options.ttl).toBe(12_000);
        expect(options.cached_endpoints).toEqual([{ method: 'POST', path: '/v1/swap' }]);
        return { signatures: [] };
      }) as RequestFn;
      const authProvider: AuthProvider = {
        getBlindAuthToken: vi.fn(async () => 'unused'),
        getCAT: vi.fn(() => 'unused'),
        setCAT: vi.fn(),
      };
      const mint = new Mint(mintUrl, { customRequest: requestSpy, authProvider });

      const res = await mint.swap({ inputs: [], outputs: [] });

      expect(res.signatures).toEqual([]);
      expect(requestSpy).toHaveBeenCalledTimes(2);
    });

    it('does not attach Clear-auth when the endpoint is not clear-protected', async () => {
      const requestSpy = vi.fn(async (options: ReqArgs) => {
        expect(options.headers?.['Clear-auth']).toBeUndefined();
        expect(options.headers?.['Blind-auth']).toBeUndefined();
        return { signatures: [] };
      }) as RequestFn;
      const authProvider: AuthProvider = {
        getBlindAuthToken: vi.fn(async () => 'bat123'),
        getCAT: vi.fn(() => 'cat123'),
        setCAT: vi.fn(),
        ensureCAT: vi.fn(async () => 'cat123'),
      };
      const mint = new Mint(mintUrl, { customRequest: requestSpy, authProvider });
      mint.setMintInfo({
        ...baseInfo,
        nuts: {
          '4': { disabled: false, methods: [] },
          '5': { disabled: false, methods: [] },
          '21': {
            openid_discovery: 'https://auth.example/.well-known/openid-configuration',
            client_id: 'cashu-client',
            protected_endpoints: [{ method: 'POST', path: '/v1/mint/bolt11' }],
          },
        },
      });

      await mint.swap({ inputs: [], outputs: [] });

      expect(authProvider.ensureCAT).not.toHaveBeenCalled();
      expect(authProvider.getCAT).not.toHaveBeenCalled();
    });
  });

  describe('websocket lifecycle', () => {
    it('reuses the existing WSConnection across connect calls', async () => {
      injectWebSocketImpl(WebSocket);
      vi.spyOn(WSConnection.prototype, 'ensureConnection').mockResolvedValue(undefined);
      const mint = new Mint('https://mint.example/cashu');

      await mint.connectWebSocket();
      const first = mint.webSocketConnection;
      await mint.connectWebSocket();

      expect(first).toBeDefined();
      expect(mint.webSocketConnection).toBe(first);
    });

    it('closes and clears the socket when connection setup fails, keeping the cause', async () => {
      injectWebSocketImpl(WebSocket);
      const boom = new Error('boom');
      vi.spyOn(WSConnection.prototype, 'ensureConnection').mockRejectedValue(boom);
      const closeSpy = vi.spyOn(WSConnection.prototype, 'close').mockImplementation(() => {});
      const mint = new Mint('https://mint.example/cashu');

      await expect(mint.connectWebSocket()).rejects.toMatchObject({
        message: 'Failed to connect to WebSocket...',
        cause: boom,
      });

      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(mint.webSocketConnection).toBeUndefined();
    });

    it('disconnectWebSocket is a no-op when never connected', () => {
      const mint = new Mint(mintUrl);

      expect(() => mint.disconnectWebSocket()).not.toThrow();
    });
  });
});
