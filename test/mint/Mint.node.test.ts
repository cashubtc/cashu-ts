import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client, Server, WebSocket } from 'mock-socket';
import {
	Mint,
	MintInfo,
	MeltQuoteState,
	WSConnection,
	injectWebSocketImpl,
	RateLimitError,
} from '../../src';
import type { AuthProvider, Logger, RequestFn } from '../../src';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { MINTINFORESP } from '../consts';

type ReqArgs = {
	endpoint: string;
	method?: string;
	requestBody?: unknown;
	headers?: Record<string, string>;
};

const mintUrl = 'https://localhost:3338';
const fakeWsUrl = 'wss://mint.example/cashu/v1/ws?token=abc';

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

		const response = await mint.swap({ inputs: [], outputs: [] });

		expect(authProvider.ensureCAT).toHaveBeenCalled();
		expect(authProvider.getCAT).not.toHaveBeenCalled();
		expect(authProvider.getBlindAuthToken).toHaveBeenCalledWith({
			method: 'POST',
			path: '/v1/swap',
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

		await mint.swap({ inputs: [], outputs: [] });

		expect(authProvider.getCAT).toHaveBeenCalled();
	});

	it('createMintQuoteBolt11 normalizes request and response amounts', async () => {
		const requestSpy = vi.fn(async (options: ReqArgs) => {
			expect(options.endpoint).toBe(mintUrl + '/v1/mint/quote/bolt11');
			expect(options.method).toBe('POST');
			expect(options.requestBody).toMatchObject({
				amount: 21n,
				unit: 'sat',
				description: 'mint me',
			});
			return {
				quote: 'q1',
				request: 'lnbc1...',
				paid: false,
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

	it('createMintQuoteBolt12 omits undefined amount and normalizes paid and issued amounts', async () => {
		const requestSpy = vi.fn(async (options: ReqArgs) => {
			expect(options.endpoint).toBe(mintUrl + '/v1/mint/quote/bolt12');
			expect(options.method).toBe('POST');
			expect(options.requestBody).toEqual({ unit: 'sat', pubkey: '02abcd', description: 'offer' });
			return {
				quote: 'q1',
				request: 'lno1...',
				paid: true,
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

		expect(response.amount).toBeUndefined();
		expect(response.amount_paid.toBigInt()).toBe(5n);
		expect(response.amount_issued.toBigInt()).toBe(4n);
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

		const response = await mint.mintBolt11({ quote: 'q1', outputs: [] });

		expect(response.signatures[0].amount.toBigInt()).toBe(2n);
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
			paid: false,
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
				amount: 1,
				unit: 'sat',
				state: MeltQuoteState.UNPAID,
				expiry: 123,
			})) as RequestFn,
		});

		expect(mintQuote).toMatchObject({ tag: 'mint', note: 'custom' });
		expect(meltQuote).toMatchObject({ tag: 'melt', quote: 'q1' });
	});

	it('throws for invalid custom method strings', async () => {
		const mint = new Mint(mintUrl, { customRequest: makeRequest({}) });

		await expect(mint.createMintQuote('bad method', {})).rejects.toThrow(
			'Invalid mint quote method: bad method',
		);
		await expect(mint.checkMintQuote('bad method', 'q1')).rejects.toThrow(
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
			expect(options.requestBody).toMatchObject({
				request: 'ln-offer',
				unit: 'sat',
				options: {
					amountless: { amount_msat: 5000n },
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
		});
		const mint = new Mint(mintUrl, { customRequest: requestSpy });

		const response = await mint.mintBatchBolt11({
			quotes: ['q1', 'q2'],
			quote_amounts: [1n, 2n] as any,
			outputs: [],
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
		});
		const mint = new Mint(mintUrl, { customRequest: requestSpy });

		const response = await mint.mintBatchBolt12({
			quotes: ['q1'],
			quote_amounts: [4n] as any,
			outputs: [],
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
			mint.mintBatch('bolt11', { quotes: ['q1'], quote_amounts: [1n] as any, outputs: [] }),
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
			mint.mintBatch('bolt11', { quotes: ['q1'], quote_amounts: [1n] as any, outputs: [] }),
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
		const mint = new Mint('https://mint.example/cashu?token=abc');
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
