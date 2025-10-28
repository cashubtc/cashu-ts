import { describe, it, expect, vi } from 'vitest';
import { CashuMint } from '../src/CashuMint';
import { CashuWallet } from '../src/CashuWallet';

type ReqArgs = {
	endpoint: string;
	method?: string;
	requestBody?: any;
	headers?: Record<string, string>;
};

const makeRequestSpy = <T>(payload: T) => {
	const calls: ReqArgs[] = [];
	const req = async (options: ReqArgs) => {
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

const MINT_URL = 'https://mint.example';

describe('CashuMint (BOLT12) – static methods via customRequest', () => {
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

		const payload = { amount: 42, unit: 'sat', description: 'test', pubkey: '02abcd' };
		const res = await CashuMint.createMintQuoteBolt12(MINT_URL, payload, req as any);

		expect(res).toEqual(response);
		expect(calls).toHaveLength(1);

		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/mint\.example\/v1\/mint\/quote\/bolt12$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual(payload);
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

		const res = await CashuMint.checkMintQuoteBolt12(MINT_URL, 'q123', req as any);

		expect(res).toEqual(response);
		expect(calls).toHaveLength(1);
		const c = calls[0];
		// Method is commonly GET; we don't over-assert here—just ensure URL is correct and contains quote.
		expect(c.endpoint).toMatch(/^https:\/\/mint\.example\/v1\/mint\/quote\/bolt12\/q123$/);
	});

	it('mintBolt12 posts to /v1/mint/bolt12', async () => {
		const response = { signatures: [{ C_: '...', e: '...' }] };
		const { req, calls } = makeRequestSpy(response);

		const mintPayload = { quote: 'q123', outputs: [{ amount: 42, id: 'ks1', B_: '...' }] };
		const res = await CashuMint.mintBolt12(MINT_URL, mintPayload as any, req as any);

		expect(res).toEqual(response);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/mint\.example\/v1\/mint\/bolt12$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual(mintPayload);
	});

	it('createMeltQuoteBolt12 posts to /v1/melt/quote/bolt12', async () => {
		const response = { quote: 'm123', amount: 100, fee_reserve: 3, request: 'lno1offer...' };
		const { req, calls } = makeRequestSpy(response);

		const meltQuotePayload = { request: 'lno1offer...', unit: 'sat', amount: 100 };
		const res = await CashuMint.createMeltQuoteBolt12(
			MINT_URL,
			meltQuotePayload as any,
			req as any,
		);

		expect(res).toEqual(response);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/mint\.example\/v1\/melt\/quote\/bolt12$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual(meltQuotePayload);
	});

	it('checkMeltQuoteBolt12 requests /v1/melt/quote/bolt12/{quote}', async () => {
		const response = { quote: 'm123', amount: 100, fee_reserve: 3, state: 'UNPAID' };
		const { req, calls } = makeRequestSpy(response);

		const res = await CashuMint.checkMeltQuoteBolt12(MINT_URL, 'm123', req as any);

		expect(res).toEqual(response);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/mint\.example\/v1\/melt\/quote\/bolt12\/m123$/);
	});

	it('meltBolt12 posts to /v1/melt/bolt12', async () => {
		const response = { quote: 'm123', amount: 100, change: [] };
		const { req, calls } = makeRequestSpy(response);

		const meltPayload = { quote: 'm123', inputs: [], outputs: [] };
		const res = await CashuMint.meltBolt12(MINT_URL, meltPayload as any, req as any);

		expect(res).toEqual(response);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/mint\.example\/v1\/melt\/bolt12$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual(meltPayload);
	});
});

describe('CashuMint (BOLT12) – instance methods delegate to static', () => {
	it('instance.createMintQuoteBolt12 delegates to static and returns response', async () => {
		const response = {
			quote: 'q1',
			request: 'lno1offer...',
			amount: 21,
			unit: 'sat',
			pubkey: '02abcd',
			amount_paid: 0,
			amount_issued: 0,
		};
		const { req } = makeRequestSpy(response);

		// We create the instance with mintUrl and inject request via static call by stubbing the static method.
		const mint = new CashuMint(MINT_URL);

		const spy = vi.spyOn(CashuMint, 'createMintQuoteBolt12').mockResolvedValue(response as any);

		const res = await mint.createMintQuoteBolt12({
			amount: 21,
			unit: 'sat',
			pubkey: '02abcd',
		} as any);
		expect(res).toEqual(response);
		expect(spy).toHaveBeenCalledWith(
			MINT_URL,
			{ amount: 21, unit: 'sat', pubkey: '02abcd' },
			undefined,
			undefined,
		);
	});

	it('instance methods for melt/mint/check variants call their static counterparts', async () => {
		const mint = new CashuMint(MINT_URL);

		const responses = {
			createMeltQuoteBolt12: { quote: 'm1', amount: 100, fee_reserve: 2, request: 'lno1offer...' },
			checkMintQuoteBolt12: { quote: 'q1', state: 'PAID', amount_issued: 42 },
			checkMeltQuoteBolt12: { quote: 'm1', state: 'UNPAID' },
			mintBolt12: { signatures: [] },
			meltBolt12: { quote: 'm1', change: [] },
		};

		const s1 = vi
			.spyOn(CashuMint, 'createMeltQuoteBolt12')
			.mockResolvedValue(responses.createMeltQuoteBolt12 as any);
		const s2 = vi
			.spyOn(CashuMint, 'checkMintQuoteBolt12')
			.mockResolvedValue(responses.checkMintQuoteBolt12 as any);
		const s3 = vi
			.spyOn(CashuMint, 'checkMeltQuoteBolt12')
			.mockResolvedValue(responses.checkMeltQuoteBolt12 as any);
		const s4 = vi.spyOn(CashuMint, 'mintBolt12').mockResolvedValue(responses.mintBolt12 as any);
		const s5 = vi.spyOn(CashuMint, 'meltBolt12').mockResolvedValue(responses.meltBolt12 as any);

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

		expect(s1).toHaveBeenCalledWith(
			MINT_URL,
			{ request: 'lno1offer...', unit: 'sat', amount: 100 },
			undefined,
			undefined,
		);
		expect(s2).toHaveBeenCalledWith(MINT_URL, 'q1', undefined, undefined);
		expect(s3).toHaveBeenCalledWith(MINT_URL, 'm1', undefined, undefined);
		expect(s4).toHaveBeenCalledWith(MINT_URL, { quote: 'q1', outputs: [] }, undefined, undefined);
		expect(s5).toHaveBeenCalledWith(
			MINT_URL,
			{ quote: 'm1', inputs: [], outputs: [] },
			undefined,
			undefined,
		);
	});
});

describe('CashuWallet (BOLT12) – wrappers', () => {
	it('wallet.createMintQuoteBolt12 delegates to mint', async () => {
		const mockMint = {
			createMintQuoteBolt12: vi.fn(),
			getInfo: vi.fn(),
		};
		const wallet = new CashuWallet(mockMint as any);

		// Mock the getInfo method that's called by createMintQuoteBolt12
		mockMint.getInfo.mockResolvedValue({
			nuts: {
				4: {
					methods: [
						{
							method: 'bolt12',
							unit: 'sat',
							min_amount: 1,
							max_amount: 1000000,
							options: { description: true },
						},
					],
				},
			},
		});

		const response = {
			quote: 'q1',
			request: 'lno1offer...',
			amount: 21,
			unit: 'sat',
			pubkey: '02abcd',
			amount_paid: 0,
			amount_issued: 0,
		};
		mockMint.createMintQuoteBolt12.mockResolvedValue(response);

		const res = await wallet.createMintQuoteBolt12('02abcd', { amount: 21, description: 'desc' });
		expect(res).toEqual(response);
		expect(mockMint.createMintQuoteBolt12).toHaveBeenCalledWith({
			amount: 21,
			unit: 'sat',
			description: 'desc',
			pubkey: '02abcd',
		});
	});

	it('wallet.checkMintQuoteBolt12 delegates to mint', async () => {
		const mockMint = {
			checkMintQuoteBolt12: vi.fn(),
		};
		const wallet = new CashuWallet(mockMint as any);

		const response = { quote: 'q1', state: 'PAID', amount_issued: 21 };
		mockMint.checkMintQuoteBolt12.mockResolvedValue(response);

		const res = await wallet.checkMintQuoteBolt12('q1');
		expect(res).toEqual(response);
		expect(mockMint.checkMintQuoteBolt12).toHaveBeenCalledWith('q1');
	});

	it('wallet.createMeltQuoteBolt12(offer, amountMsat?) delegates to mint', async () => {
		const mockMint = {
			createMeltQuoteBolt12: vi.fn(),
		};
		const wallet = new CashuWallet(mockMint as any);

		const response = { quote: 'm1', request: 'lno1offer...', amount: 100, fee_reserve: 2 };
		mockMint.createMeltQuoteBolt12.mockResolvedValue(response);

		const res = await wallet.createMeltQuoteBolt12('lno1offer...', 100_000); // 100k msat
		expect(res).toEqual(response);
		expect(mockMint.createMeltQuoteBolt12).toHaveBeenCalledWith({
			request: 'lno1offer...',
			unit: 'sat',
			options: {
				amountless: {
					amount_msat: 100_000,
				},
			},
		});
	});

	it('wallet.meltProofsBolt12 delegates and returns {quote, change}', async () => {
		const mockMint = {
			meltBolt12: vi.fn(),
		};
		const mockKeys = { 1: 'pubkey1', 2: 'pubkey2' };
		const wallet = new CashuWallet(mockMint as any);

		// Mock the getKeys method
		vi.spyOn(wallet as any, 'getKeys').mockResolvedValue(mockKeys);
		// Mock the createBlankOutputs method
		vi.spyOn(wallet as any, 'createBlankOutputs').mockReturnValue([]);

		const meltResponse = { quote: 'm1', amount: 100, change: [] };
		mockMint.meltBolt12.mockResolvedValue(meltResponse);

		const meltQuote = { quote: 'm1', amount: 100, unit: 'sat', request: 'lno1offer...' };
		const res = await wallet.meltProofsBolt12(meltQuote as any, [] as any, {});

		expect(res.quote.quote).toEqual('m1');
		expect(mockMint.meltBolt12).toHaveBeenCalled();
	});

	it('wallet.mintProofsBolt12 requires privateKey and delegates to mint.mintBolt12', async () => {
		const mockMint = {
			mintBolt12: vi.fn(),
		};
		const mockKeys = {
			1: '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
			2: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			4: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			8: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			16: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
		};
		const wallet = new CashuWallet(mockMint as any);

		// Mock the getKeys method
		vi.spyOn(wallet as any, 'getKeys').mockResolvedValue(mockKeys);

		// Mock createOutputData instead of createBlankOutputs
		vi.spyOn(wallet as any, 'createOutputData').mockReturnValue([
			{
				blindedMessage: { amount: 16, B_: 'B1' },
				toProof: () => ({ amount: 16, secret: 'secret1', C: 'C1' }),
			},
			{
				blindedMessage: { amount: 4, B_: 'B2' },
				toProof: () => ({ amount: 4, secret: 'secret2', C: 'C2' }),
			},
			{
				blindedMessage: { amount: 1, B_: 'B3' },
				toProof: () => ({ amount: 1, secret: 'secret3', C: 'C3' }),
			},
		]);

		const mintResponse = {
			signatures: [
				{ C_: 'sig1', e: 'e1' },
				{ C_: 'sig2', e: 'e2' },
				{ C_: 'sig3', e: 'e3' },
			],
		};
		mockMint.mintBolt12.mockResolvedValue(mintResponse);

		// Test missing privateKey
		await expect(
			wallet.mintProofsBolt12(21, { quote: 'q1', pubkey: '1234' } as any, undefined as any),
		).rejects.toBeTruthy();

		// Test successful path with privateKey (valid secp256k1 private key)
		const privateKey = '0000000000000000000000000000000000000000000000000000000000000001';
		const proofs = await wallet.mintProofsBolt12(
			21,
			{ quote: 'q1', request: 'lno1offer...' } as any,
			privateKey,
		);
		expect(proofs).toHaveLength(3);
		expect(mockMint.mintBolt12).toHaveBeenCalled();
	});
});
