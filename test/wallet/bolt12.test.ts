import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mint, Wallet, type MintKeys, type MintKeyset, Keyset, Proof } from '../../src';

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

const mintUrl = 'https://localhost:3338';
const unit = 'sat';

const mintInfoResp = JSON.parse(
	'{"name":"Testnut mint","pubkey":"0296d0aa13b6a31cf0cd974249f28c7b7176d7274712c95a41c7d8066d3f29d679","version":"Nutshell/0.16.3","description":"Mint for testing Cashu wallets","description_long":"This mint usually runs the latest main branch of the nutshell repository. It uses a FakeWallet, all your Lightning invoices will always be marked paid so that you can test minting and melting ecash via Lightning.","contact":[{"method":"email","info":"contact@me.com"},{"method":"twitter","info":"@me"},{"method":"nostr","info":"npub1337"}],"motd":"This is a message of the day field. You should display this field to your users if the content changes!","icon_url":"https://image.nostr.build/46ee47763c345d2cfa3317f042d332003f498ee281fb42808d47a7d3b9585911.png","time":1731684933,"nuts":{"4":{"methods":[{"method":"bolt11","unit":"sat","options":{"description":true}},{"method":"bolt11","unit":"usd","options":{"description":true}},{"method":"bolt11","unit":"eur","options":{"description":true}},{"method":"bolt12","unit":"sat","options":{"description":true}},{"method":"bolt12","unit":"usd","options":{"description":true}},{"method":"bolt12","unit":"eur","options":{"description":true}}],"disabled":false},"5":{"methods":[{"method":"bolt11","unit":"sat"},{"method":"bolt11","unit":"usd"},{"method":"bolt11","unit":"eur"},{"method":"bolt12","unit":"sat"},{"method":"bolt12","unit":"usd"},{"method":"bolt12","unit":"eur"}],"disabled":false},"7":{"supported":true},"8":{"supported":true},"9":{"supported":true},"10":{"supported":true},"11":{"supported":true},"12":{"supported":true},"14":{"supported":true},"17":{"supported":[{"method":"bolt11","unit":"sat","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"usd","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"eur","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt12","unit":"sat","commands":["bolt12_melt_quote","proof_state","bolt12_mint_quote"]},{"method":"bolt12","unit":"usd","commands":["bolt12_melt_quote","proof_state","bolt12_mint_quote"]},{"method":"bolt12","unit":"eur","commands":["bolt12_melt_quote","proof_state","bolt12_mint_quote"]}]}}}',
);

const mintCache = {
	keysets: [
		{
			id: '00bd033559de27d0',
			unit: 'sat',
			active: true,
			input_fee_ppk: 0,
			final_expiry: undefined,
		},
	] as MintKeyset[],
	keys: [
		{
			id: '00bd033559de27d0',
			unit: 'sat',
			keys: {
				'1': '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
				'2': '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			},
		},
	] as MintKeys[],
	unit: unit,
	mintInfo: mintInfoResp,
};

function makeKeysetFromCache(k: MintKeys, active = true) {
	const ks = new Keyset(k.id, k.unit, active, 0, undefined);
	ks.keys = k.keys;
	return ks;
}

describe('Mint (BOLT12) – instance methods via customRequest', () => {
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
		const mint = new Mint(mintUrl, req);
		const payload = { amount: 42, unit: 'sat', description: 'test', pubkey: '02abcd' };
		const res = await mint.createMintQuoteBolt12(payload);
		expect(res).toEqual(response);
		expect(calls).toHaveLength(1);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/localhost:3338\/v1\/mint\/quote\/bolt12$/);
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
		const mint = new Mint(mintUrl, req);
		const res = await mint.checkMintQuoteBolt12('q123');
		expect(res).toEqual(response);
		expect(calls).toHaveLength(1);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/localhost:3338\/v1\/mint\/quote\/bolt12\/q123$/);
	});

	it('mintBolt12 posts to /v1/mint/bolt12', async () => {
		const response = { signatures: [{ C_: '...', e: '...' }] };
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, req);
		const mintPayload = { quote: 'q123', outputs: [{ amount: 42, id: 'ks1', B_: '...' }] };
		const res = await mint.mintBolt12(mintPayload as any);
		expect(res).toEqual(response);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/localhost:3338\/v1\/mint\/bolt12$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual(mintPayload);
	});

	it('createMeltQuoteBolt12 posts to /v1/melt/quote/bolt12', async () => {
		const response = { quote: 'm123', amount: 100, fee_reserve: 3, request: 'lno1offer...' };
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, req);
		const meltQuotePayload = { request: 'lno1offer...', unit: 'sat', amount: 100 };
		const res = await mint.createMeltQuoteBolt12(meltQuotePayload as any);
		expect(res).toEqual(response);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/localhost:3338\/v1\/melt\/quote\/bolt12$/);
		expect(c.method?.toUpperCase()).toBe('POST');
		expect(c.requestBody).toEqual(meltQuotePayload);
	});

	it('checkMeltQuoteBolt12 requests /v1/melt/quote/bolt12/{quote}', async () => {
		const response = { quote: 'm123', amount: 100, fee_reserve: 3, state: 'UNPAID' };
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, req);
		const res = await mint.checkMeltQuoteBolt12('m123');
		expect(res).toEqual(response);
		const c = calls[0];
		expect(c.endpoint).toMatch(/^https:\/\/localhost:3338\/v1\/melt\/quote\/bolt12\/m123$/);
	});

	it('meltBolt12 posts to /v1/melt/bolt12', async () => {
		const response = { quote: 'm123', amount: 100, change: [] };
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, req);
		const meltPayload = { quote: 'm123', inputs: [], outputs: [] };
		const res = await mint.meltBolt12(meltPayload as any);
		expect(res).toEqual(response);
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
	beforeEach(async () => {
		// Setup wallet with cached data
		const { req: reqInfo } = makeRequestSpy(mintInfoResp);
		const mint = new Mint(mintUrl, reqInfo);
		const wallet = new Wallet(mint, mintCache);
		await wallet.loadMint();
	});

	it('wallet.createMintQuoteBolt12 delegates to mint', async () => {
		const response = {
			quote: 'q1',
			request: 'lno1offer...',
			amount: 21,
			unit: 'sat',
			pubkey: '02abcd',
			amount_paid: 0,
			amount_issued: 0,
		};
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, req);
		const wallet = new Wallet(mint, mintCache);
		await wallet.loadMint();
		const res = await wallet.createMintQuoteBolt12('02abcd', { amount: 21, description: 'desc' });
		expect(res).toEqual(response);
		expect(calls).toHaveLength(1);
		expect(calls[0].requestBody).toEqual({
			pubkey: '02abcd',
			unit: 'sat',
			amount: 21,
			description: 'desc',
		});
	});

	it('wallet.checkMintQuoteBolt12 delegates to mint', async () => {
		const response = { quote: 'q1', state: 'PAID', amount_issued: 21 };
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, req);
		const wallet = new Wallet(mint, mintCache);
		await wallet.loadMint();
		const res = await wallet.checkMintQuoteBolt12('q1');
		expect(res).toEqual(response);
		expect(calls).toHaveLength(1);
		expect(calls[0].endpoint).toMatch(/\/v1\/mint\/quote\/bolt12\/q1$/);
	});

	it('wallet.createMeltQuoteBolt12(offer, amountMsat?) delegates to mint', async () => {
		const response = { quote: 'm1', request: 'lno1offer...', amount: 100, fee_reserve: 2 };
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, req);
		const wallet = new Wallet(mint, mintCache);
		await wallet.loadMint();
		const res = await wallet.createMeltQuoteBolt12('lno1offer...', 100_000); // 100k msat
		expect(res).toEqual(response);
		expect(calls).toHaveLength(1);
		expect(calls[0].requestBody).toEqual({
			unit: 'sat',
			request: 'lno1offer...',
			options: {
				amountless: {
					amount_msat: 100_000,
				},
			},
		});
	});

	it('wallet.meltProofsBolt12 delegates and returns {quote, change}', async () => {
		const response = { quote: 'm1', amount: 100, change: [] };
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, req);
		const wallet = new Wallet(mint, mintCache);
		await wallet.loadMint();
		const ks = makeKeysetFromCache(mintCache.keys[0]);
		vi.spyOn(wallet.keyChain, 'getKeyset').mockReturnValue(ks as any);
		vi.spyOn(wallet as any, 'createOutputData').mockReturnValue([]);
		const meltQuote = { quote: 'm1', amount: 100, unit: 'sat', request: 'lno1offer...' };
		const proof: Proof = { amount: 128, secret: 'secret1', C: 'C1', id: 'foo' };
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
				{ C_: 'sig1', e: 'e1' },
				{ C_: 'sig2', e: 'e2' },
				{ C_: 'sig3', e: 'e3' },
			],
		};
		const { req, calls } = makeRequestSpy(response);
		const mint = new Mint(mintUrl, req);
		const wallet = new Wallet(mint, mintCache);
		await wallet.loadMint();
		const ks = makeKeysetFromCache(mintCache.keys[0]);
		vi.spyOn(wallet.keyChain, 'getKeyset').mockReturnValue(ks as any);
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
		// Test missing privkey
		await expect(
			wallet.mintProofsBolt12(21, { quote: 'q1', request: 'lno1offer...' } as any, ''),
		).rejects.toThrow('Can not sign locked quote without private key');
		// Test successful path with privkey (valid secp256k1 private key)
		const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
		const proofs = await wallet.mintProofsBolt12(
			21,
			{ quote: 'q1', request: 'lno1offer...' } as any,
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
});
