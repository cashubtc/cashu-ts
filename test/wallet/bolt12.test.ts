import { describe, it, expect, vi } from 'vitest';
import { Amount, Mint, Wallet, type MintKeys, Keyset, Proof } from '../../src';
import { MINTCACHE } from '../consts';

type ReqArgs = {
	endpoint: string;
	method?: string;
	requestBody?: any;
	headers?: Record<string, string>;
};

const makeRequestSpy = <T>(payload: T) => {
	const calls: ReqArgs[] = [];
	const req = async (options: ReqArgs) => {
		if (options.endpoint.endsWith('/v1/info')) {
			return MINTCACHE.mintInfo as any;
		}
		calls.push({
			endpoint: options.endpoint,
			method: options.method,
			requestBody: options.requestBody,
			headers: options.headers,
		});
		return payload as any;
	};
	return { req, calls };
};

const mintUrl = 'https://localhost:3338';

function makeKeysetFromCache(k: MintKeys, active = true) {
	const ks = new Keyset(k.id, k.unit, active, 0, undefined);
	ks.keys = k.keys;
	return ks;
}

describe('Mint (BOLT12) – instance methods via customRequest', () => {
	it('does not force /v1/info lookup before operation request', async () => {
		const offlineMint = new Mint('https://offline.invalid');
		const calls: string[] = [];
		const customRequest = async (options: ReqArgs) => {
			calls.push(options.endpoint);
			return {
				quote: 'q1',
				request: 'lno1offer...',
				amount: 21,
				unit: 'sat',
				pubkey: '02abcd',
				amount_paid: 0,
				amount_issued: 0,
			} as any;
		};

		const result = await offlineMint.createMintQuoteBolt12(
			{ amount: 21, unit: 'sat', pubkey: '02abcd' },
			customRequest,
		);

		expect(result.quote).toBe('q1');
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatch(/\/v1\/mint\/quote\/bolt12$/);
	});

	it('uses per-call customRequest on getLazyMintInfo cache miss', async () => {
		const offlineMint = new Mint('https://offline.invalid');
		const calls: string[] = [];
		const customRequest = async (options: ReqArgs) => {
			calls.push(options.endpoint);
			if (options.endpoint.endsWith('/v1/info')) {
				return MINTCACHE.mintInfo as any;
			}
			throw new Error('unexpected endpoint');
		};

		const info = await offlineMint.getLazyMintInfo(customRequest);

		expect(info.name).toBe(MINTCACHE.mintInfo.name);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatch(/\/v1\/info$/);
	});

	it('createMintQuoteBolt12 posts to /v1/mint/quote/bolt12 with payload incl. pubkey', async () => {
		const response = {
			quote: 'q123',
			request: 'lno1offer...',
			amount: 42,
			unit: 'sat',
			expiry: 123456,
			pubkey: '02abcd',
			amount_paid: 0,
			amount_issued: 0,
		};
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });
		const payload = { amount: 42, unit: 'sat', description: 'test', pubkey: '02abcd' };
		const res = await mint.createMintQuoteBolt12(payload);
		expect(res.quote).toBe(response.quote);
		expect(res.amount).toEqual(Amount.from(response.amount));
		expect(res.amount_paid).toEqual(Amount.from(response.amount_paid));
		expect(res.amount_issued).toEqual(Amount.from(response.amount_issued));
		expect(res.expiry).toBe(response.expiry);
		expect(calls).toHaveLength(1);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/localhost:3338\/v1\/mint\/quote\/bolt12$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual({ ...payload, amount: 42n });
	});

	it('normalizes wire amounts (including bigint) to Amount objects', async () => {
		const response = {
			quote: 'q123',
			request: 'lno1offer...',
			amount: 9007199254740993n,
			unit: 'sat',
			expiry: 123456n,
			pubkey: '02abcd',
			amount_paid: 9007199254740995n,
			amount_issued: 9007199254740997n,
		};
		const { req } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });

		const res = await mint.createMintQuoteBolt12({
			amount: 42,
			unit: 'sat',
			pubkey: '02abcd',
		});

		expect(res.amount).toEqual(Amount.from(response.amount));
		expect(res.expiry).toBe(123456);
		expect(res.amount_paid).toEqual(Amount.from(response.amount_paid));
		expect(res.amount_issued).toEqual(Amount.from(response.amount_issued));
	});

	it('rejects out-of-range bigint mint quote expiry', async () => {
		const response = {
			quote: 'q123',
			request: 'lno1offer...',
			amount: 42,
			unit: 'sat',
			expiry: 9007199254740999n,
			pubkey: '02abcd',
			amount_paid: 0,
			amount_issued: 0,
		};
		const { req } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });

		await expect(
			mint.createMintQuoteBolt12({
				amount: 42,
				unit: 'sat',
				pubkey: '02abcd',
			}),
		).rejects.toThrow('mintQuoteBolt12.expiry');
	});

	it('checkMintQuoteBolt12 requests /v1/mint/quote/bolt12/{quote}', async () => {
		const response = {
			quote: 'q123',
			request: 'lno1offer...',
			amount: 42,
			unit: 'sat',
			expiry: 123456,
			pubkey: '02abcd',
			amount_paid: 42,
			amount_issued: 42,
			state: 'PAID',
		};
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });
		const res = await mint.checkMintQuoteBolt12('q123');
		expect(res.quote).toBe(response.quote);
		expect(res.amount).toEqual(Amount.from(response.amount));
		expect(res.amount_paid).toEqual(Amount.from(response.amount_paid));
		expect(res.amount_issued).toEqual(Amount.from(response.amount_issued));
		expect(calls).toHaveLength(1);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/localhost:3338\/v1\/mint\/quote\/bolt12\/q123$/);
	});

	it('mintBolt12 posts to /v1/mint/bolt12', async () => {
		const response = { signatures: [{ C_: '...', id: 'ks1', amount: 42 }] };
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });
		const mintPayload = { quote: 'q123', outputs: [{ amount: 42, id: 'ks1', B_: '...' }] };
		const res = await mint.mintBolt12(mintPayload as any);
		expect(res.signatures[0].amount).toEqual(Amount.from(response.signatures[0].amount));
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/localhost:3338\/v1\/mint\/bolt12$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual(mintPayload);
	});

	it('normalizes wire signature amounts (including bigint) to Amount objects', async () => {
		const response = {
			signatures: [{ C_: '...', id: 'ks1', amount: 9007199254740993n }],
		};
		const { req } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });

		const res = await mint.mintBolt12({
			quote: 'q123',
			outputs: [{ amount: 42, id: 'ks1', B_: '...' }],
		} as any);

		expect(res.signatures[0].amount).toEqual(Amount.from(response.signatures[0].amount));
	});

	it('createMeltQuoteBolt12 posts to /v1/melt/quote/bolt12', async () => {
		const response = {
			quote: 'm123',
			amount: 100,
			fee_reserve: 3,
			unit: 'sat',
			expiry: 9999999999,
			state: 'UNPAID',
			request: 'lno1offer...',
		};
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });
		const meltQuotePayload = { request: 'lno1offer...', unit: 'sat', amount: 100 };
		const res = await mint.createMeltQuoteBolt12(meltQuotePayload as any);
		expect(res.quote).toBe(response.quote);
		expect(res.amount).toEqual(Amount.from(response.amount));
		expect(res.fee_reserve).toEqual(Amount.from(response.fee_reserve));
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/localhost:3338\/v1\/melt\/quote\/bolt12$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual(meltQuotePayload);
	});

	it('normalizes wire melt quote amounts (including bigint) to Amount objects', async () => {
		const response = {
			quote: 'm123',
			amount: 9007199254740993n,
			fee_reserve: 9007199254740995n,
			unit: 'sat',
			expiry: 123456n,
			state: 'UNPAID',
			request: 'lno1offer...',
		};
		const { req } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });

		const res = await mint.createMeltQuoteBolt12({
			request: 'lno1offer...',
			unit: 'sat',
			amount: 100,
		} as any);

		expect(res.amount).toEqual(Amount.from(response.amount));
		expect(res.expiry).toBe(123456);
		expect(res.fee_reserve).toEqual(Amount.from(response.fee_reserve));
	});

	it('rejects out-of-range bigint melt quote expiry', async () => {
		const response = {
			quote: 'm123',
			amount: 100,
			fee_reserve: 2,
			expiry: 9007199254740997n,
			request: 'lno1offer...',
		};
		const { req } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });

		await expect(
			mint.createMeltQuoteBolt12({
				request: 'lno1offer...',
				unit: 'sat',
				amount: 100,
			} as any),
		).rejects.toThrow('meltQuote.expiry');
	});

	it('checkMeltQuoteBolt12 requests /v1/melt/quote/bolt12/{quote}', async () => {
		const response = {
			quote: 'm123',
			amount: 100,
			fee_reserve: 3,
			unit: 'sat',
			expiry: 9999999999,
			state: 'UNPAID',
			request: 'lno1offer...',
		};
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });
		const res = await mint.checkMeltQuoteBolt12('m123');
		expect(res.quote).toBe(response.quote);
		expect(res.amount).toEqual(Amount.from(response.amount));
		expect(res.fee_reserve).toEqual(Amount.from(response.fee_reserve));
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/localhost:3338\/v1\/melt\/quote\/bolt12\/m123$/);
	});

	it('meltBolt12 posts to /v1/melt/bolt12', async () => {
		const response = {
			quote: 'm123',
			amount: 100,
			fee_reserve: 3,
			unit: 'sat',
			expiry: 9999999999,
			state: 'PAID',
			change: [],
			request: 'lno1offer...',
		};
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });
		const meltPayload = { quote: 'm123', inputs: [], outputs: [] };
		const res = await mint.meltBolt12(meltPayload as any);
		expect(res.quote).toBe(response.quote);
		expect(res.amount).toEqual(Amount.from(response.amount));
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/localhost:3338\/v1\/melt\/bolt12$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual(meltPayload);
	});
});

describe('Mint (BOLT12) – instance methods', () => {
	it('instance.createMintQuoteBolt12 returns response', async () => {
		const response = {
			quote: 'q1',
			request: 'lno1offer...',
			amount: 21,
			unit: 'sat',
			expiry: null,
			pubkey: '02abcd',
			amount_paid: 0,
			amount_issued: 0,
		};
		const mint = new Mint(mintUrl);
		const spy = vi.spyOn(mint, 'createMintQuoteBolt12').mockResolvedValue(response as any);
		const res = await mint.createMintQuoteBolt12({
			amount: 21,
			unit: 'sat',
			pubkey: '02abcd',
		} as any);
		expect(res).toEqual(response);
		expect(spy).toHaveBeenCalledWith({ amount: 21, unit: 'sat', pubkey: '02abcd' });
	});

	it('instance methods for melt/mint/check variants', async () => {
		const mint = new Mint(mintUrl);
		const responses = {
			createMeltQuoteBolt12: { quote: 'm1', amount: 100, fee_reserve: 2, request: 'lno1offer...' },
			checkMintQuoteBolt12: { quote: 'q1', state: 'PAID', amount_issued: 42 },
			checkMeltQuoteBolt12: { quote: 'm1', state: 'UNPAID' },
			mintBolt12: { signatures: [] },
			meltBolt12: { quote: 'm1', change: [] },
		};
		const s1 = vi
			.spyOn(mint, 'createMeltQuoteBolt12')
			.mockResolvedValue(responses.createMeltQuoteBolt12 as any);
		const s2 = vi
			.spyOn(mint, 'checkMintQuoteBolt12')
			.mockResolvedValue(responses.checkMintQuoteBolt12 as any);
		const s3 = vi
			.spyOn(mint, 'checkMeltQuoteBolt12')
			.mockResolvedValue(responses.checkMeltQuoteBolt12 as any);
		const s4 = vi.spyOn(mint, 'mintBolt12').mockResolvedValue(responses.mintBolt12 as any);
		const s5 = vi.spyOn(mint, 'meltBolt12').mockResolvedValue(responses.meltBolt12 as any);
		expect(
			await mint.createMeltQuoteBolt12({
				request: 'lno1offer...',
				unit: 'sat',
				amount: 100,
			} as any),
		).toEqual(responses.createMeltQuoteBolt12);
		expect(await mint.checkMintQuoteBolt12('q1')).toEqual(responses.checkMintQuoteBolt12);
		expect(await mint.checkMeltQuoteBolt12('m1')).toEqual(responses.checkMeltQuoteBolt12);
		expect(await mint.mintBolt12({ quote: 'q1', outputs: [] } as any)).toEqual(
			responses.mintBolt12,
		);
		expect(await mint.meltBolt12({ quote: 'm1', inputs: [], outputs: [] } as any)).toEqual(
			responses.meltBolt12,
		);
		expect(s1).toHaveBeenCalledWith({ request: 'lno1offer...', unit: 'sat', amount: 100 });
		expect(s2).toHaveBeenCalledWith('q1');
		expect(s3).toHaveBeenCalledWith('m1');
		expect(s4).toHaveBeenCalledWith({ quote: 'q1', outputs: [] });
		expect(s5).toHaveBeenCalledWith({ quote: 'm1', inputs: [], outputs: [] });
	});
});

describe('Wallet (BOLT12) – wrappers', () => {
	it('wallet.createMintQuoteBolt12 delegates to mint', async () => {
		const response = {
			quote: 'q1',
			request: 'lno1offer...',
			amount: 21,
			unit: 'sat',
			expiry: null,
			pubkey: '02abcd',
			amount_paid: 0,
			amount_issued: 0,
		};
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });
		const wallet = new Wallet(mint);
		wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
		const res = await wallet.createMintQuoteBolt12('02abcd', { amount: 21, description: 'desc' });
		expect(res.quote).toBe(response.quote);
		expect(res.amount).toEqual(Amount.from(response.amount));
		expect(res.amount_paid).toEqual(Amount.from(response.amount_paid));
		expect(res.amount_issued).toEqual(Amount.from(response.amount_issued));
		expect(calls).toHaveLength(1);
		expect(calls[0].requestBody).toEqual({
			pubkey: '02abcd',
			unit: 'sat',
			amount: 21n,
			description: 'desc',
		});
	});

	it('wallet.checkMintQuoteBolt12 delegates to mint', async () => {
		const response = {
			quote: 'q1',
			state: 'PAID',
			expiry: null,
			amount_paid: 21,
			amount_issued: 21,
		};
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });
		const wallet = new Wallet(mint);
		wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
		const res = await wallet.checkMintQuoteBolt12('q1');
		expect(res.quote).toBe(response.quote);
		expect(res.amount_paid).toEqual(Amount.from(response.amount_paid));
		expect(res.amount_issued).toEqual(Amount.from(response.amount_issued));
		expect(calls).toHaveLength(1);
		expect(calls[0].endpoint).toMatch(/\/v1\/mint\/quote\/bolt12\/q1$/);
	});

	it('wallet.createMeltQuoteBolt12(offer, amountMsat?) delegates to mint', async () => {
		const response = {
			quote: 'm1',
			request: 'lno1offer...',
			amount: 100,
			fee_reserve: 2,
			unit: 'sat',
			expiry: 9999999999,
			state: 'UNPAID',
		};
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });
		const wallet = new Wallet(mint);
		wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
		const res = await wallet.createMeltQuoteBolt12('lno1offer...', 100_000); // 100k msat
		expect(res.quote).toBe(response.quote);
		expect(res.amount).toEqual(Amount.from(response.amount));
		expect(res.fee_reserve).toEqual(Amount.from(response.fee_reserve));
		expect(calls).toHaveLength(1);
		expect(calls[0].requestBody).toEqual({
			unit: 'sat',
			request: 'lno1offer...',
			options: {
				amountless: {
					amount_msat: 100_000n,
				},
			},
		});
	});

	it('wallet.meltProofsBolt12 delegates and returns {quote, change}', async () => {
		const response = {
			quote: 'm1',
			amount: 100,
			fee_reserve: 2,
			unit: 'sat',
			expiry: 9999999999,
			state: 'PAID',
			change: [],
			request: 'lno1offer...',
		};
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });
		const wallet = new Wallet(mint);
		wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
		const ks = makeKeysetFromCache(MINTCACHE.keys[0]);
		vi.spyOn(wallet.keyChain, 'getKeyset').mockReturnValue(ks as any);
		vi.spyOn(wallet as any, 'createOutputData').mockReturnValue([]);
		const meltQuote = {
			quote: 'm1',
			amount: Amount.from(100),
			unit: 'sat',
			request: 'lno1offer...',
		};
		const proof: Proof = { amount: 128n, secret: 'secret1', C: 'C1', id: 'foo' };
		const res = await wallet.meltProofsBolt12(meltQuote as any, [proof]);
		expect(res.quote.quote).toEqual('m1');
		expect(res.change).toEqual([]);
		expect(calls).toHaveLength(1);
		expect(calls[0].requestBody).toMatchObject({
			quote: 'm1',
			inputs: [proof],
			outputs: [],
		});
	});

	it('wallet.mintProofsBolt12 requires privkey and delegates to mint.mintBolt12', async () => {
		const response = {
			signatures: [
				{ C_: 'sig1', id: '009a1f293253e41e', amount: 16 },
				{ C_: 'sig2', id: '009a1f293253e41e', amount: 4 },
				{ C_: 'sig3', id: '009a1f293253e41e', amount: 1 },
			],
		};
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });
		const wallet = new Wallet(mint);
		wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
		const ks = makeKeysetFromCache(MINTCACHE.keys[0]);
		vi.spyOn(wallet.keyChain, 'getKeyset').mockReturnValue(ks as any);
		vi.spyOn(wallet as any, 'createOutputData').mockReturnValue([
			{
				blindedMessage: { amount: 16n, B_: 'B1' },
				toProof: () => ({ amount: 16, secret: 'secret1', C: 'C1' }),
			},
			{
				blindedMessage: { amount: 4n, B_: 'B2' },
				toProof: () => ({ amount: 4, secret: 'secret2', C: 'C2' }),
			},
			{
				blindedMessage: { amount: 1n, B_: 'B3' },
				toProof: () => ({ amount: 1, secret: 'secret3', C: 'C3' }),
			},
		]);
		// Test missing privkey
		await expect(
			wallet.mintProofsBolt12(
				21,
				{ quote: 'q1', request: 'lno1offer...', pubkey: '1234' } as any,
				'',
			),
		).rejects.toThrow('Can not sign locked quote without private key');
		// Test successful path with privkey (valid secp256k1 private key)
		const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
		const proofs = await wallet.mintProofsBolt12(
			21,
			{ quote: 'q1', request: 'lno1offer...', pubkey: '1234' } as any,
			privkey,
		);
		expect(proofs).toHaveLength(3);
		expect(calls).toHaveLength(1);
		expect(calls[0].requestBody).toMatchObject({
			quote: 'q1',
			outputs: expect.any(Array),
			signature: expect.any(String),
		});
	});

	it('wallet.prepareMint and completeMint support locked bolt12 quotes', async () => {
		const response = {
			signatures: [
				{ C_: 'sig1', id: '009a1f293253e41e', amount: 16 },
				{ C_: 'sig2', id: '009a1f293253e41e', amount: 4 },
				{ C_: 'sig3', id: '009a1f293253e41e', amount: 1 },
			],
		};
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, { customRequest: req });
		const wallet = new Wallet(mint);
		wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
		const ks = makeKeysetFromCache(MINTCACHE.keys[0]);
		vi.spyOn(wallet.keyChain, 'getKeyset').mockReturnValue(ks as any);
		vi.spyOn(wallet as any, 'createOutputData').mockReturnValue([
			{
				blindedMessage: { amount: 16n, B_: 'B1' },
				toProof: () => ({ amount: 16, secret: 'secret1', C: 'C1' }),
			},
			{
				blindedMessage: { amount: 4n, B_: 'B2' },
				toProof: () => ({ amount: 4, secret: 'secret2', C: 'C2' }),
			},
			{
				blindedMessage: { amount: 1n, B_: 'B3' },
				toProof: () => ({ amount: 1, secret: 'secret3', C: 'C3' }),
			},
		]);

		const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
		const preview = await wallet.prepareMint(
			'bolt12',
			21,
			{ quote: 'q1', request: 'lno1offer...', pubkey: '1234' } as any,
			{ privkey },
		);

		expect(calls).toHaveLength(0);
		expect(preview.payload).toMatchObject({
			quote: 'q1',
			outputs: expect.any(Array),
			signature: expect.any(String),
		});

		const proofs = await wallet.completeMint(preview);

		expect(proofs).toHaveLength(3);
		expect(calls).toHaveLength(1);
		expect(calls[0].endpoint).toMatch(/^https:\/\/localhost:3338\/v1\/mint\/bolt12$/);
		expect(calls[0].requestBody).toEqual(preview.payload);
	});
});
