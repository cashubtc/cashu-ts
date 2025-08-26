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

describe('CashuMint (Onchain) – static methods via customRequest', () => {
	it('createMintQuoteOnchain posts to /v1/mint/quote/onchain with payload incl. pubkey', async () => {
		const response = {
			quote: 'q123',
			request: 'bc1qexample123...',
			amount: null,
			unit: 'sat',
			expiry: 123456,
			pubkey: '02abcd',
			amount_paid: 0,
			amount_issued: 0,
			amount_unconfirmed: 0,
		};
		const { req, calls } = makeRequestSpy(response);

		const payload = { unit: 'sat', pubkey: '02abcd' };
		const res = await CashuMint.createMintQuoteOnchain(MINT_URL, payload, req as any);

		expect(res).toEqual(response);
		expect(calls).toHaveLength(1);

		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/mint\.example\/v1\/mint\/quote\/onchain$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual(payload);
	});

	it('checkMintQuoteOnchain requests /v1/mint/quote/onchain/{quote}', async () => {
		const response = {
			quote: 'q123',
			request: 'bc1qexample123...',
			amount: null,
			unit: 'sat',
			expiry: 123456,
			pubkey: '02abcd',
			amount_paid: 5000,
			amount_issued: 0,
			amount_unconfirmed: 0,
			state: 'PAID',
		};
		const { req, calls } = makeRequestSpy(response);

		const res = await CashuMint.checkMintQuoteOnchain(MINT_URL, 'q123', req as any);

		expect(res).toEqual(response);
		expect(calls).toHaveLength(1);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/mint\.example\/v1\/mint\/quote\/onchain\/q123$/);
	});

	it('mintOnchain posts to /v1/mint/onchain', async () => {
		const response = { signatures: [{ C_: '...', e: '...' }] };
		const { req, calls } = makeRequestSpy(response);

		const mintPayload = { quote: 'q123', outputs: [{ amount: 42, id: 'ks1', B_: '...' }] };
		const res = await CashuMint.mintOnchain(MINT_URL, mintPayload as any, req as any);

		expect(res).toEqual(response);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/mint\.example\/v1\/mint\/onchain$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual(mintPayload);
	});

	it('createMeltQuoteOnchain posts to /v1/melt/quote/onchain', async () => {
		const response = {
			quote: 'm123',
			amount: 100,
			fee_reserve: 3,
			request: 'bc1qexample123...',
			unit: 'sat',
		};
		const { req, calls } = makeRequestSpy(response);

		const meltQuotePayload = { request: 'bc1qexample123...', unit: 'sat', amount: 100 };
		const res = await CashuMint.createMeltQuoteOnchain(
			MINT_URL,
			meltQuotePayload as any,
			req as any,
		);

		expect(res).toEqual(response);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/mint\.example\/v1\/melt\/quote\/onchain$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual(meltQuotePayload);
	});

	it('checkMeltQuoteOnchain requests /v1/melt/quote/onchain/{quote}', async () => {
		const response = {
			quote: 'm123',
			amount: 100,
			fee_reserve: 3,
			request: 'bc1qexample123...',
			unit: 'sat',
			state: 'UNPAID',
		};
		const { req, calls } = makeRequestSpy(response);

		const res = await CashuMint.checkMeltQuoteOnchain(MINT_URL, 'm123', req as any);

		expect(res).toEqual(response);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/mint\.example\/v1\/melt\/quote\/onchain\/m123$/);
	});

	it('meltOnchain posts to /v1/melt/onchain', async () => {
		const response = {
			quote: 'm123',
			amount: 100,
			change: [],
			txid: 'abcd1234...',
		};
		const { req, calls } = makeRequestSpy(response);

		const meltPayload = { quote: 'm123', inputs: [], outputs: [] };
		const res = await CashuMint.meltOnchain(MINT_URL, meltPayload as any, req as any);

		expect(res).toEqual(response);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/mint\.example\/v1\/melt\/onchain$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual(meltPayload);
	});
});

describe('CashuMint (Onchain) – instance methods delegate to static', () => {
	it('instance.createMintQuoteOnchain delegates to static and returns response', async () => {
		const response = {
			quote: 'q1',
			request: 'bc1qexample123...',
			amount: null,
			unit: 'sat',
			pubkey: '02abcd',
			amount_paid: 0,
			amount_issued: 0,
			amount_unconfirmed: 0,
		};
		const { req } = makeRequestSpy(response);

		const mint = new CashuMint(MINT_URL);

		const spy = vi.spyOn(CashuMint, 'createMintQuoteOnchain').mockResolvedValue(response as any);

		const res = await mint.createMintQuoteOnchain({
			unit: 'sat',
			pubkey: '02abcd',
		} as any);
		expect(res).toEqual(response);
		expect(spy).toHaveBeenCalledWith(
			MINT_URL,
			{ unit: 'sat', pubkey: '02abcd' },
			undefined,
			undefined,
		);
	});

	it('instance methods for melt/mint/check variants call their static counterparts', async () => {
		const mint = new CashuMint(MINT_URL);

		const responses = {
			createMeltQuoteOnchain: {
				quote: 'm1',
				amount: 100,
				fee_reserve: 2,
				request: 'bc1qexample123...',
				unit: 'sat',
			},
			checkMintQuoteOnchain: {
				quote: 'q1',
				state: 'PAID',
				amount_paid: 5000,
				amount_issued: 0,
				amount_unconfirmed: 0,
			},
			checkMeltQuoteOnchain: { quote: 'm1', state: 'UNPAID' },
			mintOnchain: { signatures: [] },
			meltOnchain: { quote: 'm1', change: [], txid: 'abcd1234...' },
		};

		const s1 = vi
			.spyOn(CashuMint, 'createMeltQuoteOnchain')
			.mockResolvedValue(responses.createMeltQuoteOnchain as any);
		const s2 = vi
			.spyOn(CashuMint, 'checkMintQuoteOnchain')
			.mockResolvedValue(responses.checkMintQuoteOnchain as any);
		const s3 = vi
			.spyOn(CashuMint, 'checkMeltQuoteOnchain')
			.mockResolvedValue(responses.checkMeltQuoteOnchain as any);
		const s4 = vi.spyOn(CashuMint, 'mintOnchain').mockResolvedValue(responses.mintOnchain as any);
		const s5 = vi.spyOn(CashuMint, 'meltOnchain').mockResolvedValue(responses.meltOnchain as any);

		expect(
			await mint.createMeltQuoteOnchain({
				request: 'bc1qexample123...',
				unit: 'sat',
				amount: 100,
			} as any),
		).toEqual(responses.createMeltQuoteOnchain);
		expect(await mint.checkMintQuoteOnchain('q1')).toEqual(responses.checkMintQuoteOnchain);
		expect(await mint.checkMeltQuoteOnchain('m1')).toEqual(responses.checkMeltQuoteOnchain);
		expect(await mint.mintOnchain({ quote: 'q1', outputs: [] } as any)).toEqual(
			responses.mintOnchain,
		);
		expect(await mint.meltOnchain({ quote: 'm1', inputs: [], outputs: [] } as any)).toEqual(
			responses.meltOnchain,
		);

		expect(s1).toHaveBeenCalledWith(
			MINT_URL,
			{ request: 'bc1qexample123...', unit: 'sat', amount: 100 },
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

describe('CashuWallet (Onchain) – wrappers', () => {
	it('wallet.createMintQuoteOnchain delegates to mint', async () => {
		const mockMint = {
			createMintQuoteOnchain: vi.fn(),
		};
		const wallet = new CashuWallet(mockMint as any);

		const response = {
			quote: 'q1',
			request: 'bc1qexample123...',
			amount: null,
			unit: 'sat',
			pubkey: '02abcd',
			amount_paid: 0,
			amount_issued: 0,
			amount_unconfirmed: 0,
		};
		mockMint.createMintQuoteOnchain.mockResolvedValue(response);

		const res = await wallet.createMintQuoteOnchain('02abcd');
		expect(res).toEqual(response);
		expect(mockMint.createMintQuoteOnchain).toHaveBeenCalledWith({
			unit: 'sat',
			pubkey: '02abcd',
		});
	});

	it('wallet.checkMintQuoteOnchain delegates to mint', async () => {
		const mockMint = {
			checkMintQuoteOnchain: vi.fn(),
		};
		const wallet = new CashuWallet(mockMint as any);

		const response = {
			quote: 'q1',
			state: 'PAID',
			amount_paid: 5000,
			amount_issued: 0,
			amount_unconfirmed: 0,
		};
		mockMint.checkMintQuoteOnchain.mockResolvedValue(response);

		const res = await wallet.checkMintQuoteOnchain('q1');
		expect(res).toEqual(response);
		expect(mockMint.checkMintQuoteOnchain).toHaveBeenCalledWith('q1');
	});

	it('wallet.createMeltQuoteOnchain delegates to mint', async () => {
		const mockMint = {
			createMeltQuoteOnchain: vi.fn(),
		};
		const wallet = new CashuWallet(mockMint as any);

		const response = {
			quote: 'm1',
			request: 'bc1qexample123...',
			amount: 100,
			fee_reserve: 2,
			unit: 'sat',
		};
		mockMint.createMeltQuoteOnchain.mockResolvedValue(response);

		const res = await wallet.createMeltQuoteOnchain('bc1qexample123...', 100);
		expect(res).toEqual(response);
		expect(mockMint.createMeltQuoteOnchain).toHaveBeenCalledWith({
			request: 'bc1qexample123...',
			unit: 'sat',
			amount: 100,
		});
	});

	it('wallet.checkMeltQuoteOnchain delegates to mint', async () => {
		const mockMint = {
			checkMeltQuoteOnchain: vi.fn(),
		};
		const wallet = new CashuWallet(mockMint as any);

		const response = {
			quote: 'm1',
			state: 'UNPAID',
			amount: 100,
			fee_reserve: 2,
		};
		mockMint.checkMeltQuoteOnchain.mockResolvedValue(response);

		const res = await wallet.checkMeltQuoteOnchain('m1');
		expect(res).toEqual(response);
		expect(mockMint.checkMeltQuoteOnchain).toHaveBeenCalledWith('m1');
	});

	it('wallet.meltProofsOnchain delegates and returns {quote, change}', async () => {
		const mockMint = {
			meltOnchain: vi.fn(),
		};
		const mockKeys = { 1: 'pubkey1', 2: 'pubkey2' };
		const wallet = new CashuWallet(mockMint as any);

		// Mock the getKeys method
		vi.spyOn(wallet as any, 'getKeys').mockResolvedValue(mockKeys);
		// Mock the createBlankOutputs method
		vi.spyOn(wallet as any, 'createBlankOutputs').mockReturnValue([]);

		const meltResponse = {
			quote: 'm1',
			amount: 100,
			change: [],
			txid: 'abcd1234...',
		};
		mockMint.meltOnchain.mockResolvedValue(meltResponse);

		const meltQuote = {
			quote: 'm1',
			amount: 100,
			unit: 'sat',
			request: 'bc1qexample123...',
		};
		const res = await wallet.meltProofsOnchain(meltQuote as any, [] as any, {});

		expect(res.quote.quote).toEqual('m1');
		expect(mockMint.meltOnchain).toHaveBeenCalled();
	});

	it('wallet.mintProofsOnchain requires privateKey and delegates to mint.mintOnchain', async () => {
		const mockMint = {
			mintOnchain: vi.fn(),
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
		mockMint.mintOnchain.mockResolvedValue(mintResponse);

		// Test missing privateKey
		await expect(
			wallet.mintProofsOnchain(21, { quote: 'q1' } as any, undefined as any),
		).rejects.toBeTruthy();

		// Test successful path with privateKey (valid secp256k1 private key)
		const privateKey = '0000000000000000000000000000000000000000000000000000000000000001';
		const proofs = await wallet.mintProofsOnchain(
			21,
			{ quote: 'q1', request: 'bc1qexample123...' } as any,
			privateKey,
		);
		expect(proofs).toHaveLength(3);
		expect(mockMint.mintOnchain).toHaveBeenCalled();
	});
});
