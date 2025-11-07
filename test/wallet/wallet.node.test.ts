import { setupServer } from 'msw/node';
import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, afterAll, afterEach, test, describe, expect, vi } from 'vitest';

import {
	Mint,
	Wallet,
	CheckStateEnum,
	type Proof,
	type MeltQuoteResponse,
	MeltQuoteState,
	type MintQuoteResponse,
	MintQuoteState,
	type MintKeys,
	MintKeyset,
	deriveKeysetId,
	getDecodedToken,
	injectWebSocketImpl,
	MintInfo,
	OutputData,
	ConsoleLogger,
	OutputConfig,
	MeltProofsConfig,
	MeltBlanks,
	Bolt12MeltQuoteResponse,
	AuthProvider,
} from '../../src';

import { bytesToNumber, sumProofs } from '../../src/utils';
import { Server, WebSocket } from 'mock-socket';
import { hexToBytes } from '@noble/curves/utils';
import { randomBytes } from '@noble/hashes/utils';
import { NULL_LOGGER } from '../../src/logger';

injectWebSocketImpl(WebSocket);

const mintInfoResp = JSON.parse(
	'{"name":"Testnut mint","pubkey":"0296d0aa13b6a31cf0cd974249f28c7b7176d7274712c95a41c7d8066d3f29d679","version":"Nutshell/0.16.3","description":"Mint for testing Cashu wallets","description_long":"This mint usually runs the latest main branch of the nutshell repository. It uses a FakeWallet, all your Lightning invoices will always be marked paid so that you can test minting and melting ecash via Lightning.","contact":[{"method":"email","info":"contact@me.com"},{"method":"twitter","info":"@me"},{"method":"nostr","info":"npub1337"}],"motd":"This is a message of the day field. You should display this field to your users if the content changes!","icon_url":"https://image.nostr.build/46ee47763c345d2cfa3317f042d332003f498ee281fb42808d47a7d3b9585911.png","time":1731684933,"nuts":{"4":{"methods":[{"method":"bolt11","unit":"sat","description":true},{"method":"bolt11","unit":"usd","description":true},{"method":"bolt11","unit":"eur","description":true}],"disabled":false},"5":{"methods":[{"method":"bolt11","unit":"sat"},{"method":"bolt11","unit":"usd"},{"method":"bolt11","unit":"eur"}],"disabled":false},"7":{"supported":true},"8":{"supported":true},"9":{"supported":true},"10":{"supported":true},"11":{"supported":true},"12":{"supported":true},"14":{"supported":true},"17":{"supported":[{"method":"bolt11","unit":"sat","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"usd","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"eur","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]}]}}}',
);
const dummyKeysResp = {
	keysets: [
		{
			id: '00bd033559de27d0',
			unit: 'sat',
			keys: {
				1: '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
				2: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			},
		},
	],
};
const dummyKeysId = deriveKeysetId(
	dummyKeysResp.keysets[0].keys,
	dummyKeysResp.keysets[0].unit,
	1754296607,
	1,
);
console.log(`dummyKeysId = ${dummyKeysId}`);
const dummyKeysetResp = {
	keysets: [
		{
			id: '00bd033559de27d0',
			unit: 'sat',
			active: true,
			input_fee_ppk: 0,
		},
	],
};
const mintUrl = 'http://localhost:3338';
const mint = new Mint(mintUrl);
const unit = 'sat';
const invoice =
	'lnbc20u1p3u27nppp5pm074ffk6m42lvae8c6847z7xuvhyknwgkk7pzdce47grf2ksqwsdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzpgxqyz5vqsp5sw6n7cztudpl5m5jv3z6dtqpt2zhd3q6dwgftey9qxv09w82rgjq9qyyssqhtfl8wv7scwp5flqvmgjjh20nf6utvv5daw5h43h69yqfwjch7wnra3cn94qkscgewa33wvfh7guz76rzsfg9pwlk8mqd27wavf2udsq3yeuju';
const token3sat =
	'cashuBo2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdGF0gaJhaUgAvQM1Wd4n0GFwgqNhYQFhc3hAZTdjMWI3NmQxYjMxZTJiY2EyYjIyOWQxNjBiZGY2MDQ2ZjMzYmM0NTcwMjIyMzA0YjY1MTEwZDkyNmY3YWY4OWFjWCEDic2fT5iOOAp5idTUiKfJHFJ3-5MEfnoswe2OM5a4VP-jYWECYXN4QGRlNTVjMTVmYWVmZGVkN2Y5Yzk5OWMzZDRjNjJmODFiMGM2ZmUyMWE3NTJmZGVmZjZiMDg0Y2YyZGYyZjVjZjNhY1ghAt5AxZ2QODuIU8zzpLIIZKyDunWPzj2VnbuJNhAC6M5H';
const server = setupServer();
const logger = new ConsoleLogger('debug');

beforeAll(() => {
	server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
	server.use(
		http.get(mintUrl + '/v1/info', () => {
			return HttpResponse.json(mintInfoResp);
		}),
	);
	server.use(
		http.get(mintUrl + '/v1/keys', () => {
			return HttpResponse.json(dummyKeysResp);
		}),
	);
	server.use(
		http.get(mintUrl + '/v1/keys/00bd033559de27d0', () => {
			return HttpResponse.json(dummyKeysResp);
		}),
	);
	server.use(
		http.get(mintUrl + '/v1/keysets', () => {
			return HttpResponse.json(dummyKeysetResp);
		}),
	);
});

afterEach(() => {
	server.resetHandlers();
});

afterAll(() => {
	server.close();
});

describe('test wallet init', () => {
	test('should initialize with mint instance and load mint info, keys, and keysets', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		// Verify mint info
		const info = wallet.getMintInfo();
		expect(info.contact).toEqual([
			{ method: 'email', info: 'contact@me.com' },
			{ method: 'twitter', info: '@me' },
			{ method: 'nostr', info: 'npub1337' },
		]);
		expect(info.name).toBe('Testnut mint');
		expect(info.pubkey).toBe('0296d0aa13b6a31cf0cd974249f28c7b7176d7274712c95a41c7d8066d3f29d679');

		// Verify keysets
		const keysets = wallet.keyChain.getKeysets();
		expect(keysets.map((k) => k.toMintKeyset())).toEqual(dummyKeysetResp.keysets);
		expect(keysets).toHaveLength(1);
		expect(keysets[0].toMintKeyset()).toEqual({
			id: '00bd033559de27d0',
			unit: 'sat',
			active: true,
			input_fee_ppk: 0,
			final_expiry: undefined,
		});

		// Verify keys
		const keys = wallet.keyChain.getCache().keys;
		expect(keys).toEqual(dummyKeysResp.keysets);
		expect(keys).toHaveLength(1);
		expect(keys[0]).toEqual({
			id: '00bd033559de27d0',
			unit: 'sat',
			keys: {
				1: '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
				2: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			},
		});

		// Verify active keyset ID
		const keysetId = wallet.keyChain.getCheapestKeyset().id;
		expect(keysetId).toBe('00bd033559de27d0');

		// Verify specific keyset retrieval
		const specificKeys = wallet.keyChain.getKeyset('00bd033559de27d0').keys;
		expect(specificKeys).toEqual(dummyKeysResp.keysets[0].keys);
	});

	test('should initialize with mint URL string and load mint info, keys, and keysets', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();

		// Verify mint info
		const info = wallet.getMintInfo();
		expect(info.contact).toEqual([
			{ method: 'email', info: 'contact@me.com' },
			{ method: 'twitter', info: '@me' },
			{ method: 'nostr', info: 'npub1337' },
		]);
		expect(info.name).toBe('Testnut mint');
		expect(info.pubkey).toBe('0296d0aa13b6a31cf0cd974249f28c7b7176d7274712c95a41c7d8066d3f29d679');

		// Verify keysets
		const keysets = wallet.keyChain.getKeysets();
		expect(keysets.map((k) => k.toMintKeyset())).toEqual(dummyKeysetResp.keysets);
		expect(keysets).toHaveLength(1);
		expect(keysets[0].toMintKeyset()).toEqual({
			id: '00bd033559de27d0',
			unit: 'sat',
			active: true,
			input_fee_ppk: 0,
			final_expiry: undefined,
		});

		// Verify keys
		const keys = wallet.keyChain.getCache().keys;
		expect(keys).toEqual(dummyKeysResp.keysets);
		expect(keys).toHaveLength(1);
		expect(keys[0]).toEqual({
			id: '00bd033559de27d0',
			unit: 'sat',
			keys: {
				1: '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
				2: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			},
		});

		// Verify active keyset ID
		const keysetId = wallet.keyChain.getCheapestKeyset().id;
		expect(keysetId).toBe('00bd033559de27d0');

		// Verify specific keyset retrieval
		const specificKeys = wallet.keyChain.getKeyset('00bd033559de27d0').keys;
		expect(specificKeys).toEqual(dummyKeysResp.keysets[0].keys);
	});

	test('should initialize with preloaded mint info, keys, and keysets without fetching', async () => {
		const wallet = new Wallet(mintUrl, {
			unit,
			mintInfo: mintInfoResp,
			keys: dummyKeysResp.keysets,
			keysets: dummyKeysetResp.keysets,
		});
		const spyMintInfo = vi.spyOn((wallet as any).mint, 'getInfo');
		const spyKeySets = vi.spyOn((wallet as any).mint, 'getKeySets');
		const spyKeys = vi.spyOn((wallet as any).mint, 'getKeys');
		await wallet.loadMint();

		// Verify mint info
		const info = wallet.getMintInfo();
		expect(info.contact).toEqual([
			{ method: 'email', info: 'contact@me.com' },
			{ method: 'twitter', info: '@me' },
			{ method: 'nostr', info: 'npub1337' },
		]);
		expect(info.name).toBe('Testnut mint');
		expect(info.pubkey).toBe('0296d0aa13b6a31cf0cd974249f28c7b7176d7274712c95a41c7d8066d3f29d679');

		// Verify keysets
		const keysets = wallet.keyChain.getKeysets();
		expect(keysets.map((k) => k.toMintKeyset())).toEqual(dummyKeysetResp.keysets);
		expect(keysets).toHaveLength(1);
		expect(keysets[0].toMintKeyset()).toEqual({
			id: '00bd033559de27d0',
			unit: 'sat',
			active: true,
			input_fee_ppk: 0,
			final_expiry: undefined,
		});

		// Verify keys
		const keys = wallet.keyChain.getCache().keys;
		expect(keys).toEqual(dummyKeysResp.keysets);
		expect(keys).toHaveLength(1);
		expect(keys[0]).toEqual({
			id: '00bd033559de27d0',
			unit: 'sat',
			keys: {
				1: '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
				2: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			},
		});

		// Verify active keyset ID
		const keysetId = wallet.keyChain.getCheapestKeyset().id;
		expect(keysetId).toBe('00bd033559de27d0');

		// Verify specific keyset retrieval
		const specificKeys = wallet.keyChain.getKeyset('00bd033559de27d0').keys;
		expect(specificKeys).toEqual(dummyKeysResp.keysets[0].keys);

		// Verify no network calls were made
		expect(spyMintInfo).toHaveBeenCalledTimes(0);
		expect(spyKeySets).toHaveBeenCalledTimes(0);
		expect(spyKeys).toHaveBeenCalledTimes(0);

		spyMintInfo.mockRestore();
		spyKeySets.mockRestore();
		spyKeys.mockRestore();
	});

	test('should throw when retrieving an invalid keyset ID', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();

		expect(() => wallet.keyChain.getKeyset('invalid-keyset-id')).toThrow(
			"Keyset 'invalid-keyset-id' not found",
		);
	});

	test('should throw when accessing getters before loadMint', () => {
		const wallet = new Wallet(mintUrl, { unit });
		expect(() => wallet.getMintInfo()).toThrow('Mint info not initialized; call loadMint first');
		expect(() => wallet.keyChain.getKeysets()).toThrow('KeyChain not initialized');
		expect(() => wallet.keyChain.getCheapestKeyset().id).toThrow('KeyChain not initialized');
	});

	test('should return getters', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		expect(wallet.logger).toBe(NULL_LOGGER);
		expect(wallet.unit).toBe('sat');
	});

	test('should force refresh mint info, keys, and keysets when forceRefresh is true', async () => {
		const wallet = new Wallet(mintUrl, {
			unit,
			mintInfo: mintInfoResp,
			keys: dummyKeysResp.keysets,
			keysets: dummyKeysetResp.keysets,
		});
		const spyMintInfo = vi.spyOn((wallet as any).mint, 'getInfo');
		const spyKeySets = vi.spyOn((wallet as any).mint, 'getKeySets');
		const spyKeys = vi.spyOn((wallet as any).mint, 'getKeys');
		await wallet.loadMint(true); // Force refresh

		// Verify network calls were made despite preloaded data
		expect(spyMintInfo).toHaveBeenCalledTimes(1);
		expect(spyKeySets).toHaveBeenCalledTimes(1);
		expect(spyKeys).toHaveBeenCalledTimes(1);

		// Verify data
		const info = wallet.getMintInfo();
		expect(info.contact).toEqual([
			{ method: 'email', info: 'contact@me.com' },
			{ method: 'twitter', info: '@me' },
			{ method: 'nostr', info: 'npub1337' },
		]);
		const keysets = wallet.keyChain.getKeysets();
		expect(keysets.map((k) => k.toMintKeyset())).toEqual(dummyKeysetResp.keysets);
		const keys = wallet.keyChain.getCache().keys;
		expect(keys).toEqual(dummyKeysResp.keysets);
		const keysetId = wallet.keyChain.getCheapestKeyset().id;
		expect(keysetId).toBe('00bd033559de27d0');

		spyMintInfo.mockRestore();
		spyKeySets.mockRestore();
		spyKeys.mockRestore();
	});
});
describe('test info', () => {
	test('test info', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();
		const info = wallet.getMintInfo();
		expect(info.contact).toEqual([
			{ method: 'email', info: 'contact@me.com' },
			{ method: 'twitter', info: '@me' },
			{ method: 'nostr', info: 'npub1337' },
		]);
		expect(info.isSupported(10)).toEqual({ supported: true });
		expect(info.isSupported(5)).toEqual({
			disabled: false,
			params: [
				{ method: 'bolt11', unit: 'sat' },
				{ method: 'bolt11', unit: 'usd' },
				{ method: 'bolt11', unit: 'eur' },
			],
		});
		expect(info.isSupported(17)).toEqual({
			supported: true,
			params: [
				{
					method: 'bolt11',
					unit: 'sat',
					commands: ['bolt11_melt_quote', 'proof_state', 'bolt11_mint_quote'],
				},
				{
					method: 'bolt11',
					unit: 'usd',
					commands: ['bolt11_melt_quote', 'proof_state', 'bolt11_mint_quote'],
				},
				{
					method: 'bolt11',
					unit: 'eur',
					commands: ['bolt11_melt_quote', 'proof_state', 'bolt11_mint_quote'],
				},
			],
		});
		expect(info).toEqual(new MintInfo(mintInfoResp));
	});
	test('test info with deprecated contact field', async () => {
		// mintInfoRespDeprecated is the same as mintInfoResp but with the contact field in the old format
		const mintInfoRespDeprecated = JSON.parse(
			'{"name":"Testnut mint","pubkey":"0296d0aa13b6a31cf0cd974249f28c7b7176d7274712c95a41c7d8066d3f29d679","version":"Nutshell/0.16.3","description":"Mint for testing Cashu wallets","description_long":"This mint usually runs the latest main branch of the nutshell repository. All your Lightning invoices will always be marked paid so that you can test minting and melting ecash via Lightning.","contact":[["email","contact@me.com"],["twitter","@me"],["nostr","npub1337"]],"motd":"This is a message of the day field. You should display this field to your users if the content changes!","nuts":{"4":{"methods":[{"method":"bolt11","unit":"sat"},{"method":"bolt11","unit":"usd"}],"disabled":false},"5":{"methods":[{"method":"bolt11","unit":"sat"},{"method":"bolt11","unit":"usd"}],"disabled":false},"7":{"supported":true},"8":{"supported":true},"9":{"supported":true},"10":{"supported":true},"11":{"supported":true},"12":{"supported":true},"17":[{"method":"bolt11","unit":"sat","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"usd","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]}]}}',
		);
		server.use(
			http.get(mintUrl + '/v1/info', () => {
				return HttpResponse.json(mintInfoRespDeprecated);
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();
		const info = wallet.getMintInfo();
		expect(info.contact).toEqual([
			{ method: 'email', info: 'contact@me.com' },
			{ method: 'twitter', info: '@me' },
			{ method: 'nostr', info: 'npub1337' },
		]);
	});
	test('supportsNut04Description respects per-unit description support', async () => {
		server.use(
			http.get(mintUrl + '/v1/info', () => {
				return HttpResponse.json(mintInfoResp);
			}),
		);
		const wallet = new Wallet(mint, { unit: 'sat' });
		await wallet.loadMint();
		const info = await wallet.getMintInfo();

		expect(info.supportsNut04Description('bolt11', 'sat')).toBe(true);
		expect(info.supportsNut04Description('bolt11', 'usd')).toBe(true);
		expect(info.supportsNut04Description('bolt12', 'sat')).toBe(false);

		server.use(
			http.post(mintUrl + '/v1/mint/quote/bolt11', () =>
				HttpResponse.json({ quote: 'sat-quote', request: 'lnbc...' }),
			),
		);
		await expect(wallet.createMintQuoteBolt11(1000, 'sat description')).resolves.toHaveProperty(
			'quote',
			'sat-quote',
		);

		// Define a USD keyset for next test
		const mintCache = {
			keysets: [
				{
					id: '00bd033559de27d0',
					unit: 'usd',
					active: true,
					input_fee_ppk: 0,
					final_expiry: undefined,
				},
			] as MintKeyset[],
			keys: [
				{
					id: '00bd033559de27d0',
					unit: 'usd',
					keys: {
						'1': '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
						'2': '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
					},
				},
			] as MintKeys[],
			unit: 'usd',
			mintInfo: mintInfoResp,
		};
		const usdWallet = new Wallet(mint, mintCache);
		await usdWallet.loadMint();
		await expect(usdWallet.createMintQuoteBolt11(1000, 'usd description')).resolves.toBeDefined();
	});
});

describe('test fees', () => {
	test('test melt quote fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
				return HttpResponse.json({
					quote: 'test_melt_quote_id',
					amount: 2000,
					fee_reserve: 20,
					payment_preimage: null,
					state: 'UNPAID',
				} as MeltQuoteResponse);
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const fee = await wallet.checkMeltQuoteBolt11('test');
		const amount = 2000;

		expect(fee.fee_reserve + amount).toEqual(2020);
	});
});

describe('receive', () => {
	const tokenInput =
		'cashuBo2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdGF0gaJhaUgAvQM1Wd4n0GFwgaNhYQFhc3hAMDFmOTEwNmQxNWMwMWI5NDBjOThlYTdlOTY4YTA2ZTNhZjY5NjE4ZWRiOGJlOGU1MWI1MTJkMDhlOTA3OTIxNmFjWCEC-F3YSw-EGENmy2kUYQavfA8m8u4K0oej5fqFJSi7Kd8';

	test('test receive token from wrong mint', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		// Token from http://localhost/Bitcoin:3338
		const foreignToken =
			'cashuBo2FteB1odHRwOi8vbG9jYWxob3N0L0JpdGNvaW46MzMzOGF1Y3NhdGF0gaJhaUgAvQM1Wd4n0GFwgaNhYQFhc3hAMDFmOTEwNmQxNWMwMWI5NDBjOThlYTdlOTY4YTA2ZTNhZjY5NjE4ZWRiOGJlOGU1MWI1MTJkMDhlOTA3OTIxNmFjWCEC-F3YSw-EGENmy2kUYQavfA8m8u4K0oej5fqFJSi7Kd8';
		await expect(wallet.receive(foreignToken)).rejects.toThrow('Token belongs to a different mint');
	});

	test('test receive token with wrong unit', async () => {
		const wallet = new Wallet(mint, { unit, logger });
		await wallet.loadMint();

		// Token in usd
		const foreignToken =
			'cashuBo2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3VzZGF0gaJhaUgAvQM1Wd4n0GFwgaNhYQFhc3hAMDFmOTEwNmQxNWMwMWI5NDBjOThlYTdlOTY4YTA2ZTNhZjY5NjE4ZWRiOGJlOGU1MWI1MTJkMDhlOTA3OTIxNmFjWCEC-F3YSw-EGENmy2kUYQavfA8m8u4K0oej5fqFJSi7Kd8';
		await expect(wallet.receive(foreignToken)).rejects.toThrow('Token is not in wallet unit');
	});

	test('test receive token with unsanitized mint url', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		// Token from http://localhost:3338/ (<-- has trailing slash)
		const unsanitizedToken =
			'cashuBo2Ftdmh0dHA6Ly9sb2NhbGhvc3Q6MzMzOC9hdWNzYXRhdIGiYWlIAL0DNVneJ9BhcIGjYWEBYXN4QDAxZjkxMDZkMTVjMDFiOTQwYzk4ZWE3ZTk2OGEwNmUzYWY2OTYxOGVkYjhiZThlNTFiNTEyZDA4ZTkwNzkyMTZhY1ghAvhd2EsPhBhDZstpFGEGr3wPJvLuCtKHo-X6hSUouynf';
		const proofs = await wallet.receive(unsanitizedToken);

		expect(proofs).toHaveLength(1);
		expect(proofs).toMatchObject([{ amount: 1, id: '00bd033559de27d0' }]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('test receive encoded token', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const proofs = await wallet.receive(tokenInput);

		expect(proofs).toHaveLength(1);
		expect(proofs).toMatchObject([{ amount: 1, id: '00bd033559de27d0' }]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('test receive raw token', async () => {
		const decodedInput = getDecodedToken(tokenInput);
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: 'z32vUtKgNCm1',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);

		const wallet = new Wallet(mint);
		await wallet.loadMint();

		const proofs = await wallet.receive(decodedInput);

		expect(proofs).toHaveLength(1);
		expect(proofs).toMatchObject([{ amount: 1, id: 'z32vUtKgNCm1' }]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});
	test('test receive custom split', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);

		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const proofs = await wallet.receive(
			token3sat,
			{},
			{ type: 'random', denominations: [1, 1, 1] },
		);

		expect(proofs).toHaveLength(3);
		expect(proofs).toMatchObject([
			{ amount: 1, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
		]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});
	test('test receive tokens already spent', async () => {
		const msg = 'tokens already spent. Secret: asdasdasd';
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return new HttpResponse(JSON.stringify({ detail: msg }), { status: 400 });
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.receive(tokenInput).catch((e) => e);
		expect(result).toMatchObject({
			name: 'HttpResponseError',
			message: 'tokens already spent. Secret: asdasdasd',
			status: 400,
		});
	});

	test('test receive could not verify proofs', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return new HttpResponse(JSON.stringify({ code: 0, error: 'could not verify proofs.' }), {
					status: 400,
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.receive(tokenInput).catch((e) => e);
		expect(result).toMatchObject({
			name: 'HttpResponseError',
			message: 'could not verify proofs.',
			status: 400,
		});
	});
	test('test receive deterministic - autocounter', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const seed = hexToBytes(
			'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
		);
		const wallet = new Wallet(mint, { unit, bip39seed: seed });
		await wallet.loadMint();

		const proofs = await wallet.receive(token3sat, {}, { type: 'deterministic', counter: 0 });
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 2, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
		]);
		expect(proofs[0].secret).toBe(
			'8e0ad268631046765b570f85fe0951710c6e0e13c81b3df50ddfee21d235d132', // counter:0
		);
		expect(proofs[1].secret).toBe(
			'0b59dbc968effd7f5ab4649c0d91ab160cbd58e3aa3490d060701f44dd62e52c', // counter:1
		);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);

		// get next secrets too
		const proofs2 = await wallet.receive(token3sat, {}, { type: 'deterministic', counter: 0 });
		expect(proofs2).toHaveLength(2);
		expect(proofs2).toMatchObject([
			{ amount: 2, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
		]);
		expect(proofs2[0].secret).toBe(
			'c756ae91cf316eaa4b845edcca35f04ee9d1732c10e7205b0ef30123bcbbc1b8', // counter:2
		);
		expect(proofs2[1].secret).toBe(
			'7ceefb4d471163bd155649285c140e7647be996d1d38d4b02a9ff92bfb424cbf', // counter:3
		);
		expect(/[0-9a-f]{64}/.test(proofs2[0].C)).toBe(true);

		// get next secrets too
		const proofs3 = await wallet.receive(token3sat, {}, { type: 'deterministic', counter: 0 });
		expect(proofs3).toHaveLength(2);
		expect(proofs3).toMatchObject([
			{ amount: 2, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
		]);
		expect(proofs3[0].secret).toBe(
			'f6305874d89704b77de6fcf94c796cd274154cdbf824d35cbc72bfdc6ed60414', // counter:4
		);
		expect(proofs3[1].secret).toBe(
			'c3cad2ac3da43f84995a7ea362bd5509a992ef3684c151f5f3945b1a1f026efd', // counter:5
		);
		expect(/[0-9a-f]{64}/.test(proofs3[0].C)).toBe(true);
	});
	test('test receive deterministic - defined counter', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const seed = hexToBytes(
			'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
		);
		const wallet = new Wallet(mint, { unit, bip39seed: seed });
		await wallet.loadMint();

		const proofs = await wallet.receive(token3sat, {}, { type: 'deterministic', counter: 5 });
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 2, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
		]);
		expect(proofs[0].secret).toBe(
			'c3cad2ac3da43f84995a7ea362bd5509a992ef3684c151f5f3945b1a1f026efd', // counter:5
		);
		expect(proofs[1].secret).toBe(
			'bd31ac247f79cc72c0c6ba2793a44d006c57fd98ff4a982e357e48c12cf47f02', // counter:6
		);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
	});

	test('test receive p2pk', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const proofs = await wallet.receive(
			token3sat,
			{},
			{
				type: 'p2pk',
				options: { pubkey: '02a9acc1e594c8d2f91fbd5664973aaef2ff2b8c2f6cf5f419c17a35755a6ab5c4' },
			},
		);
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 2, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
		]);
		const allSecrets = proofs.map((d) => JSON.parse(d.secret));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('02a9acc1e594c8d2f91fbd5664973aaef2ff2b8c2f6cf5f419c17a35755a6ab5c4');
		});
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('test receive factory', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const customFactory = (amount: number, keyset: MintKeys): OutputData => {
			return OutputData.createRandomData(amount, keyset)[0];
		};
		const proofs = await wallet.receive(token3sat, {}, { type: 'factory', factory: customFactory });
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 2, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
		]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('test receive custom', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const customData = OutputData.createRandomData(
			3,
			wallet.keyChain.getKeyset('00bd033559de27d0')!,
			[1, 1, 1],
		);
		const proofs = await wallet.receive(token3sat, {}, { type: 'custom', data: customData });
		expect(proofs).toHaveLength(3);
		expect(proofs).toMatchObject([
			{ amount: 1, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
		]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('test receive requireDleq true throws', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		await expect(wallet.receive(token3sat, { requireDleq: true })).rejects.toThrow(
			'Token contains proofs with invalid or missing DLEQ',
		);
		// Try using a receive helper too
		await expect(wallet.receive(token3sat, { requireDleq: true })).rejects.toThrow(
			'Token contains proofs with invalid or missing DLEQ',
		);
	});

	test('test receive proofsWeHave optimization', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', async () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const existingProofs = [
			{ amount: 2, id: '00bd033559de27d0', secret: 'test', C: 'test' },
			{ amount: 2, id: '00bd033559de27d0', secret: 'test', C: 'test' },
			{ amount: 2, id: '00bd033559de27d0', secret: 'test', C: 'test' },
		];
		const tok = {
			mint: 'http://localhost:3338',
			proofs: [
				{
					id: '00bd033559de27d0',
					amount: 1,
					secret: 'e7c1b76d1b31e2bca2b229d160bdf6046f33bc4570222304b65110d926f7af89',
					C: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
				},
				{
					id: '00bd033559de27d0',
					amount: 2,
					secret: 'e7c1b76d1b31e2bca2b229d160bdf6046f33bc4570222304b65110d926f7af89',
					C: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
				},
				{
					id: '00bd033559de27d0',
					amount: 2,
					secret: 'de55c15faefded7f9c999c3d4c62f81b0c6fe21a752fdeff6b084cf2df2f5cf3',
					C: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
				},
			],
			unit: 'sat',
		};
		const proofs = await wallet.receive(tok, { proofsWeHave: existingProofs });
		// receiving 5 with a target count of 3, we expect three 1s, and one 2
		// as we already have the target amount of 2s
		expect(proofs).toHaveLength(4);
		expect(proofs).toMatchObject([
			{ amount: 1, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
			{ amount: 2, id: '00bd033559de27d0' },
		]);
	});

	test('test receive privkey signing', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', async () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const proofs = await wallet.receive(token3sat, {
			privkey: '5d41402abc4b2a76b9719d911017c592',
		});
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 2, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
		]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('test receive keysetId', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const proofs = await wallet.receive(token3sat, {
			keysetId: '00bd033559de27d0',
		});
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 2, id: '00bd033559de27d0' },
			{ amount: 1, id: '00bd033559de27d0' },
		]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});
});

describe('checkProofsStates', () => {
	const proofs = [
		{
			id: '00bd033559de27d0',
			amount: 1,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
		},
	];
	test('test checkProofsStates - get proofs that are NOT spendable', async () => {
		server.use(
			http.post(mintUrl + '/v1/checkstate', () => {
				return HttpResponse.json({
					states: [
						{
							Y: '02d5dd71f59d917da3f73defe997928e9459e9d67d8bdb771e4989c2b5f50b2fff',
							state: 'UNSPENT',
							witness: 'witness-asd',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.checkProofsStates(proofs);
		result.forEach((r) => {
			expect(r.state).toEqual(CheckStateEnum.UNSPENT);
			expect(r.witness).toEqual('witness-asd');
		});
	});
});

describe('groupProofsByState', () => {
	test('test groupProofsByState groups proofs by state', async () => {
		const proofs = [
			{
				id: '00bd033559de27d0',
				amount: 2,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 8,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a14',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 128,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a15',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 4,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a16',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 1,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a17',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 16,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a18',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		server.use(
			http.post(mintUrl + '/v1/checkstate', () => {
				return HttpResponse.json({
					states: [
						{
							Y: '02d5dd71f59d917da3f73defe997928e9459e9d67d8bdb771e4989c2b5f50b2fff',
							state: 'SPENT',
							witness: 'witness-asd',
						},
						{
							Y: '02c2c185f0c66b6de36443623fd83d14c6a4725a98f7d9bf6a07f85356574f9068',
							state: 'UNSPENT',
							witness: 'witness-asd',
						},
						{
							Y: '02c801497e8c184b0b041fcd2aff4cd2f3ad35d88f6788afe1591a4540b37a0567',
							state: 'SPENT',
							witness: 'witness-asd',
						},
						{
							Y: '02120df194276661363da9a2fc558975c45ffefc06b094b228074886cddff59470',
							state: 'UNSPENT',
							witness: 'witness-asd',
						},
						{
							Y: '02e7e7e6b59cb8de7e32a9e43dd4329922ff6c93fd30a0a604f08fd3a0bc820c93',
							state: 'PENDING',
							witness: 'witness-asd',
						},
						{
							Y: '029279de78447f77619b2c6905b9140eb4fff110908359bf9efd06f8e17e354099',
							state: 'SPENT',
							witness: 'witness-asd',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();
		const result = await wallet.groupProofsByState(proofs);
		expect(result.unspent[0].amount).toEqual(8);
		expect(result.unspent[1].amount).toEqual(4);
		expect(result.spent[0].amount).toEqual(2);
		expect(result.spent[1].amount).toEqual(128);
		expect(result.spent[2].amount).toEqual(16);
		expect(result.pending[0].amount).toEqual(1);
	});
});

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

		const proofs = await wallet.mintProofsBolt11(1, '');

		expect(proofs).toHaveLength(1);
		expect(proofs[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});
	test('test requestTokens bad response', async () => {
		server.use(
			http.post(mintUrl + '/v1/mint/bolt11', () => {
				return HttpResponse.json({});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.mintProofsBolt11(1, '').catch((e) => e);

		expect(result).toEqual(new Error('bad response'));
	});
});

describe('send', () => {
	const proofs = [
		{
			id: '00bd033559de27d0',
			amount: 1,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
		},
	];
	test('test send base case', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.send(1, proofs);

		expect(result.keep).toHaveLength(0);
		expect(result.send).toHaveLength(1);
		expect(result.send[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
	});

	test('test send over paying. Should return change', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.send(1, [
			{
				id: '00bd033559de27d0',
				amount: 2,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		]);

		expect(result.send).toHaveLength(1);
		expect(result.send[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(1);
		expect(result.keep[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.keep[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.keep[0].secret)).toBe(true);
	});
	test('test send overpaying with p2pk.', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.send(
			1,
			[
				{
					id: '00bd033559de27d0',
					amount: 2,
					secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
					C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
				},
			],
			{
				// p2pk: { pubkey: 'pk' }
			},
			{
				send: { type: 'p2pk', options: { pubkey: 'pk' } },
			},
		);

		expectNUT10SecretDataToEqual([result.send[0]], 'pk');
		expect(result.keep[0].secret.length).toBe(64);
	});

	test('test send over paying2', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const overpayProofs = [
			{
				id: '00bd033559de27d0',
				amount: 2,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		const result = await wallet.send(1, overpayProofs);

		expect(result.send).toHaveLength(1);
		expect(result.send[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(1);
		expect(result.keep[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.keep[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.keep[0].secret)).toBe(true);
	});
	test('test send preference', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const overpayProofs = [
			{
				id: '00bd033559de27d0',
				amount: 2,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 2,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		const result = await wallet.send(
			4,
			overpayProofs,
			{
				// preference: { sendPreference: [{ amount: 1, count: 4 }] }
				// outputAmounts: { sendAmounts: [1, 1, 1, 1], keepAmounts: [] },
			},
			{
				send: { type: 'random', denominations: [1, 1, 1, 1] },
				keep: { type: 'random', denominations: [] },
			},
		);

		expect(result.send).toHaveLength(4);
		expect(result.send[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(result.send[1]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(result.send[2]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(result.send[3]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(0);
	});

	test('test send preference overpay', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const overpayProofs = [
			{
				id: '00bd033559de27d0',
				amount: 2,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 2,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		const result = await wallet.send(
			3,
			overpayProofs,
			{},
			{
				send: { type: 'random', denominations: [1, 1, 1] },
				keep: { type: 'random', denominations: [1] },
			},
		);

		expect(result.send).toHaveLength(3);
		expect(result.send[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(result.send[1]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(result.send[2]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(1);
		expect(result.keep[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
	});

	test('test send not enough funds', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.send(2, proofs).catch((e) => e);

		expect(result).toEqual(new Error('Not enough funds available to send'));
	});
	test('test send bad response', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({});
			}),
		);
		const wallet = new Wallet(mint, { unit, logger });
		await wallet.loadMint();

		const result = await wallet
			.send(1, [
				{
					id: '00bd033559de27d0',
					amount: 2,
					secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
					C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
				},
			])
			.catch((e) => e);

		expect(result).toEqual(new Error('bad response'));
	});
	test('test send with proofsWeHave', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const overpayProofs = [
			{
				id: '00bd033559de27d0',
				amount: 1,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 8,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		const result = await wallet.send(3, overpayProofs, {
			includeFees: true,
			proofsWeHave: [{ secret: '123', C: '123', amount: 64, id: 'id' }],
		});

		// Swap 8, get 7 back (after 1*600ppk = 1 sat fee).
		// Send 3 [2,1] plus fee (2*600 for send inputs = 1200ppk = 2 sat fee)
		// Total unselected = [1]
		// Total send = [2, 2, 1]  = send 3, total fee = 3*600 = 1800ppk = 2 sats)
		// Total change = [1, 1] because proofs are optimized to target (3)
		// Total keep = [1, 1, 1]
		expect(result.send).toHaveLength(3);
		expect(result.send[0]).toMatchObject({ amount: 2, id: '00bd033559de27d0' });
		expect(result.send[1]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(result.send[2]).toMatchObject({ amount: 2, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(3);
		expect(result.keep[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(result.keep[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(result.keep[1]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
	});

	test('test send preference with fees included', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);
		server.use(
			http.post(mintUrl + '/v1/swap', async () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const overpayProofs = [
			{
				id: '00bd033559de27d0',
				amount: 1,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 8,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		const result = await wallet.send(3, overpayProofs, { includeFees: true });

		// Swap 8, get 7 back (after 1*600ppk = 1 sat fee).
		// Send 3 [2,1] plus fee (2*600 for send inputs = 1200ppk = 2 sat fee)
		// Total unselected = [1]
		// Total send = [2, 2, 1]  = send 3, total fee = 3*600 = 1800ppk = 2 sats)
		// Total change = [2] because proofs are not optimized
		// Total keep = [2, 1]
		expect(result.send).toHaveLength(3);
		expect(result.send[0]).toMatchObject({ amount: 2, id: '00bd033559de27d0' });
		expect(result.send[1]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(result.send[2]).toMatchObject({ amount: 2, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(2);
		expect(result.keep[0]).toMatchObject({ amount: 2, id: '00bd033559de27d0' });
		expect(result.keep[1]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
	});
	test('send with deterministic keep/send auto-offsets counters and fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const seed = hexToBytes(
			'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
		);
		const wallet = new Wallet(mint, { unit, bip39seed: seed });
		await wallet.loadMint();

		const overpayProofs = [
			{
				id: '00bd033559de27d0',
				amount: 1,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 8,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		const outputConfig: OutputConfig = {
			send: { type: 'deterministic', counter: 0 },
			keep: { type: 'deterministic', counter: 0 }, // Should auto-offset to send.length
		};
		const result = await wallet.send(3, overpayProofs, { includeFees: true }, outputConfig);
		// Assert no overlap (e.g., secrets are unique)
		const allSecrets = [...result.keep, ...result.send].map((p) => p.secret);
		expect(new Set(allSecrets).size).toBe(allSecrets.length); // No duplicates
	});
});

describe('deterministic', () => {
	test('no seed', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const result = await wallet
			.send(
				1,
				[
					{
						id: '00bd033559de27d0',
						amount: 2,
						secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
						C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
					},
				],
				{},
				{ send: { type: 'deterministic', counter: 1 } },
			)
			.catch((e) => e);
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('Deterministic outputs require a seed configured in the wallet');
	});
	test.each([
		[
			0,
			'8e0ad268631046765b570f85fe0951710c6e0e13c81b3df50ddfee21d235d132',
			'f63e13f15cfebe03e798acf3f738802c6da03bceb16e762b8169f8107316c0de',
		],
		[
			1,
			'0b59dbc968effd7f5ab4649c0d91ab160cbd58e3aa3490d060701f44dd62e52c',
			'c3db201daaaa59771c7e176ff761f44f37adde86a1e56cbc50627d24d1143f5a',
		],
		[
			2,
			'c756ae91cf316eaa4b845edcca35f04ee9d1732c10e7205b0ef30123bcbbc1b8',
			'6d1e1424bc2c84df6a5ee6295683e152e002891c3c142513eee41d8f3307e8f0',
		],
	])(
		'deterministic OutputData -- Legacy Derivation: counter %i -> secret: %s, r: %s',
		async (counter, secret, r) => {
			const hexSeed =
				'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8';

			const numberR = bytesToNumber(hexToBytes(r));
			const decoder = new TextDecoder();

			const data = OutputData.createSingleDeterministicData(
				0,
				hexToBytes(hexSeed),
				counter,
				'00bd033559de27d0',
			);
			expect(decoder.decode(data.secret)).toBe(secret);
			expect(data.blindingFactor).toBe(numberR);
		},
	);

	test.each([
		[
			0,
			'ba250bf927b1df5dd0a07c543be783a4349a7f99904acd3406548402d3484118',
			'4f8b32a54aed811b692a665ed296b4c1fc2f37a8be4006379e95063a76693745',
		],
		[
			1,
			'3a6423fe56abd5e74ec9d22a91ee110cd2ce45a7039901439d62e5534d3438c1',
			'c4b8412ee644067007423480c9e556385b71ffdff0f340bc16a95c0534fe0e01',
		],
		[
			2,
			'843484a75b78850096fac5b513e62854f11d57491cf775a6fd2edf4e583ae8c0',
			'ceff40983441c40acaf77d2a8ddffd5c1c84391fb9fd0dc4607c186daab1c829',
		],
	])(
		'deterministic OutputData -- New Derivation: counter %i -> secret: %s, r: %s',
		async (counter, secret, r) => {
			const hexSeed =
				'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8';

			const numberR = bytesToNumber(hexToBytes(r));
			const decoder = new TextDecoder();

			const data = OutputData.createSingleDeterministicData(
				0,
				hexToBytes(hexSeed),
				counter,
				'012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30',
			);
			expect(decoder.decode(data.secret)).toBe(secret);
			expect(data.blindingFactor).toBe(numberR);
		},
	);
});

describe('WebSocket Updates', () => {
	test('mint update', async () => {
		const fakeUrl = 'ws://localhost:3338/v1/ws';
		const server = new Server(fakeUrl, { mock: false });
		server.on('connection', (socket) => {
			socket.on('message', (m) => {
				console.log(m);
				try {
					const parsed = JSON.parse(m.toString());
					if (parsed.method === 'subscribe') {
						const message = `{"jsonrpc": "2.0", "result": {"status": "OK", "subId": "${parsed.params.subId}"}, "id": ${parsed.id}}`;
						socket.send(message);
						setTimeout(() => {
							const message = `{"jsonrpc": "2.0", "method": "subscribe", "params": {"subId": "${parsed.params.subId}", "payload": {"quote": "123", "request": "456", "state": "PAID", "paid": true, "expiry": 123}}}`;
							socket.send(message);
						}, 500);
					}
				} catch {
					console.log('Server parsing failed...');
				}
			});
		});
		const wallet = new Wallet(mint);
		await wallet.loadMint();

		const state = await new Promise(async (res, rej) => {
			const callback = (p: MintQuoteResponse) => {
				if (p.state === MintQuoteState.PAID) {
					res(p);
				}
			};
			await wallet.on.mintQuoteUpdates(['123'], callback, () => {
				rej();
				console.log('error');
			});
		});
		expect(state).toMatchObject({ quote: '123' });
		mint.disconnectWebSocket();
		server.close();
	});
	test('melt update', async () => {
		const fakeUrl = 'ws://localhost:3338/v1/ws';
		const server = new Server(fakeUrl, { mock: false });
		server.on('connection', (socket) => {
			socket.on('message', (m) => {
				console.log(m);
				try {
					const parsed = JSON.parse(m.toString());
					if (parsed.method === 'subscribe') {
						const message = `{"jsonrpc": "2.0", "result": {"status": "OK", "subId": "${parsed.params.subId}"}, "id": ${parsed.id}}`;
						socket.send(message);
						setTimeout(() => {
							const message = `{"jsonrpc": "2.0", "method": "subscribe", "params": {"subId": "${parsed.params.subId}", "payload": {"quote": "123", "request": "456", "state": "PAID", "paid": true, "expiry": 123}}}`;
							socket.send(message);
						}, 500);
					}
				} catch {
					console.log('Server parsing failed...');
				}
			});
		});
		const wallet = new Wallet(mint);
		await wallet.loadMint();

		const state = await new Promise(async (res, rej) => {
			const callback = (p: MeltQuoteResponse) => {
				console.log(p);
				if (p.state === MeltQuoteState.PAID) {
					res(p);
				}
			};
			await wallet.on.meltQuoteUpdates(['123'], callback, (e) => {
				console.log(e);
				rej();
				console.log('error');
			});
		});
		expect(state).toMatchObject({ quote: '123' });
		server.close();
	});
});
describe('multi mint', async () => {
	const mintInfo = JSON.parse(
		'{"name":"Cashu mint","pubkey":"023ef9a3cda9945d5e784e478d3bd0c8d39726bcb3ca11098fe685a95d3f889d28","version":"Nutshell/0.16.4","contact":[],"time":1737973290,"nuts":{"4":{"methods":[{"method":"bolt11","unit":"sat","description":true}],"disabled":false},"5":{"methods":[{"method":"bolt11","unit":"sat"}],"disabled":false},"7":{"supported":true},"8":{"supported":true},"9":{"supported":true},"10":{"supported":true},"11":{"supported":true},"12":{"supported":true},"14":{"supported":true},"20":{"supported":true},"15":{"methods":[{"method":"bolt11","unit":"sat"}]},"17":{"supported":[{"method":"bolt11","unit":"sat","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]}]}}}',
	);
	test('multi path melt quotes', async () => {
		server.use(
			http.get(mintUrl + '/v1/info', () => {
				return HttpResponse.json(mintInfo);
			}),
		);
		server.use(
			http.post<any, { options: { mpp: number } }>(
				mintUrl + '/v1/melt/quote/bolt11',
				async ({ request }) => {
					const body = await request.json();
					if (!body?.options.mpp) {
						return new HttpResponse('No MPP', { status: 400 });
					}
					return HttpResponse.json({
						quote: 'K-80Mo7xrtQRgaA1ifrxDKGQGZEGlo7zNDwTtf-D',
						amount: 1,
						fee_reserve: 2,
						paid: false,
						state: 'UNPAID',
						expiry: 1673972705,
						payment_preimage: null,
						change: null,
					});
				},
			),
		);
		const mint = new Mint(mintUrl);
		const wallet = new Wallet(mint);
		await wallet.loadMint();

		const meltQuote = await wallet.createMultiPathMeltQuote(invoice, 1000);
		expect(meltQuote.amount).toBe(1);
		expect(meltQuote.quote).toBe('K-80Mo7xrtQRgaA1ifrxDKGQGZEGlo7zNDwTtf-D');
		await expect(wallet.createMeltQuoteBolt11(invoice)).rejects.toThrow();
	});
});
describe('P2PK BlindingData', () => {
	test('Create BlindingData locked to single pk with locktime and single refund key', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: 'thisisatest', locktime: 212, refundKeys: ['iamarefund'] },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund']);
		});
	});
	test('Create BlindingData locked to single pk with locktime and multiple refund keys', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: 'thisisatest', locktime: 212, refundKeys: ['iamarefund', 'asecondrefund'] },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund', 'asecondrefund']);
		});
	});
	test('Create BlindingData locked to single pk without locktime and no refund keys', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData({ pubkey: 'thisisatest' }, 21, keys);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toEqual([]);
		});
	});
	test('Create BlindingData locked to single pk with unexpected requiredSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: 'thisisatest', requiredSignatures: 5 },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toEqual([]);
		});
	});
	test('Create BlindingData locked to multiple pks with no requiredSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: ['thisisatest', 'asecondpk', 'athirdpk'] },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['pubkeys', 'asecondpk', 'athirdpk']);
			expect(s[1].tags).not.toContainEqual(['n_sigs', '1']);
		});
	});
	test('Create BlindingData locked to multiple pks with 2-of-3 requiredSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: ['thisisatest', 'asecondpk', 'athirdpk'], requiredSignatures: 2 },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['pubkeys', 'asecondpk', 'athirdpk']);
			expect(s[1].tags).toContainEqual(['n_sigs', '2']);
		});
	});
	test('Create BlindingData locked to multiple pks with out of range requiredSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: ['thisisatest', 'asecondpk', 'athirdpk'], requiredSignatures: 5 },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['pubkeys', 'asecondpk', 'athirdpk']);
			expect(s[1].tags).toContainEqual(['n_sigs', '3']);
		});
	});
	test('Create BlindingData locked to single refund key with default requiredRefundSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{
				pubkey: 'thisisatest',
				locktime: 212,
				refundKeys: ['iamarefund'],
				requiredRefundSignatures: 1,
			},
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund']);
			expect(s[1].tags).not.toContainEqual(['n_sigs_refund', '1']); // 1 is default
		});
	});
	test('Create BlindingData locked to multiple refund keys with no requiredRefundSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{ pubkey: 'thisisatest', locktime: 212, refundKeys: ['iamarefund', 'asecondrefund'] },
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund', 'asecondrefund']);
			expect(s[1].tags).not.toContainEqual(['n_sigs_refund', '1']); // 1 is default
		});
	});
	test('Create BlindingData locked to multiple refund keys with 2-of-3 requiredRefundSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{
				pubkey: 'thisisatest',
				locktime: 212,
				refundKeys: ['iamarefund', 'asecondrefund', 'athirdrefund'],
				requiredRefundSignatures: 2,
			},
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund', 'asecondrefund', 'athirdrefund']);
			expect(s[1].tags).toContainEqual(['n_sigs_refund', '2']);
		});
	});
	test('Create BlindingData locked to multiple refund keys with out of range requiredRefundSignatures', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{
				pubkey: 'thisisatest',
				locktime: 212,
				refundKeys: ['iamarefund', 'asecondrefund', 'athirdrefund'],
				requiredRefundSignatures: 5,
			},
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund', 'asecondrefund', 'athirdrefund']);
			expect(s[1].tags).toContainEqual(['n_sigs_refund', '3']);
		});
	});
	test('Create BlindingData locked to multiple refund keys with expired multisig', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createP2PKData(
			{
				pubkey: ['thisisatest', 'asecondpk', 'athirdpk'],
				locktime: 212,
				refundKeys: ['iamarefund', 'asecondrefund'],
				requiredSignatures: 2,
				requiredRefundSignatures: 1,
			},
			21,
			keys,
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', '212']);
			expect(s[1].tags).toContainEqual(['pubkeys', 'asecondpk', 'athirdpk']);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund', 'asecondrefund']);
			expect(s[1].tags).toContainEqual(['n_sigs', '2']);
			expect(s[1].tags).not.toContainEqual(['n_sigs_refund', '1']); // 1 is default
		});
	});
});

describe('Restoring deterministic proofs', () => {
	test('Batch restore', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		let rounds = 0;
		const mockRestore = vi
			.spyOn(wallet, 'restore')
			.mockImplementation(async (): Promise<{ proofs: Array<Proof> }> => {
				if (rounds === 0) {
					rounds++;
					return { proofs: Array(21).fill(1) as Array<Proof> };
				}
				rounds++;
				return { proofs: [] };
			});
		const { proofs: restoredProofs } = await wallet.batchRestore();
		expect(restoredProofs.length).toBe(21);
		expect(mockRestore).toHaveBeenCalledTimes(4);
		mockRestore.mockClear();
	});
	test('Batch restore with custom values', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		let rounds = 0;
		const mockRestore = vi
			.spyOn(wallet, 'restore')
			.mockImplementation(
				async (): Promise<{ proofs: Array<Proof>; lastCounterWithSignature?: number }> => {
					if (rounds === 0) {
						rounds++;
						return { proofs: Array(42).fill(1) as Array<Proof>, lastCounterWithSignature: 41 };
					}
					rounds++;
					return { proofs: [] };
				},
			);
		const { proofs: restoredProofs, lastCounterWithSignature } = await wallet.batchRestore(
			100,
			50,
			0,
		);
		expect(restoredProofs.length).toBe(42);
		expect(mockRestore).toHaveBeenCalledTimes(3);
		expect(lastCounterWithSignature).toBe(41);
		mockRestore.mockClear();
	});
});

describe('restore', () => {
	test('sends zero-amount blanks and maps signatures to proofs', async () => {
		const wallet = new Wallet(mint, { unit, bip39seed: randomBytes(32), logger });
		await wallet.loadMint();
		interface RestoreBody {
			outputs: Array<unknown>;
		}
		let seenBody: RestoreBody = { outputs: [] };

		// valid compressed secp point (any well-formed 33-byte point will do)
		const VALID_POINT = '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422';

		server.use(
			http.post(mintUrl + '/v1/restore', async ({ request }) => {
				const body = (await request.json()) as RestoreBody;
				seenBody = body;

				// echo outputs, return one signature per output
				return HttpResponse.json({
					outputs: body.outputs,
					signatures: body.outputs.map(() => ({
						id: dummyKeysResp.keysets[0].id,
						amount: 1, // any existing key amount is fine (dummyKeysResp has 1 & 2)
						C_: VALID_POINT, // valid point so OutputData.toProof() doesn't choke
					})),
				});
			}),
		);

		const res = await wallet.restore(0, 3);

		// request assertions
		expect(Array.isArray(seenBody.outputs)).toBe(true);
		expect(seenBody.outputs).toHaveLength(3);
		expect(seenBody.outputs.every((o: any) => o.amount === 0)).toBe(true);

		// response shape is OK and produced proofs
		expect(Array.isArray(res.proofs)).toBe(true);
		expect(res.proofs.length).toBeGreaterThan(0);
		// proofs should be of amount 1 because we overprinted 1 in the signatures
		expect(res.proofs.every((p: any) => p.amount === 1)).toBe(true);
	});
});

describe('Blind Authentication', () => {
	test('Mint Info', async () => {
		const mintInfo = JSON.parse(
			'{"name":"Testnut auth mint","pubkey":"020fbbac41bcbd8d9b5353ee137baf45e0b21ccf33c0721a09bc7cbec495b156a2","version":"Nutshell/0.16.4","description":"","description_long":"","contact":[{"method":"email","info":"contact@me.com"},{"method":"twitter","info":"@me"},{"method":"nostr","info":"npub1337"}],"motd":"","icon_url":"","time":1738594208,"nuts":{"4":{"methods":[{"method":"bolt11","unit":"sat","description":true},{"method":"bolt11","unit":"usd","description":true},{"method":"bolt11","unit":"eur","description":true}],"disabled":false},"5":{"methods":[{"method":"bolt11","unit":"sat"},{"method":"bolt11","unit":"usd"},{"method":"bolt11","unit":"eur"}],"disabled":false},"7":{"supported":true},"8":{"supported":true},"9":{"supported":true},"10":{"supported":true},"11":{"supported":true},"12":{"supported":true},"14":{"supported":true},"20":{"supported":true},"17":{"supported":[{"method":"bolt11","unit":"sat","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"usd","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"eur","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]}]},"21":{"openid_discovery":"https://oicd.8333.space/realms/nutshell/.well-known/openid-configuration","client_id":"cashu-client","protected_endpoints":[{"method":"POST","path":"/v1/auth/blind/mint"}]},"22":{"bat_max_mint":100,"protected_endpoints":[{"method":"POST","path":"/v1/swap"},{"method":"POST","path":"/v1/mint/quote/bolt11"},{"method":"POST","path":"/v1/mint/bolt11"},{"method":"POST","path":"/v1/melt/bolt11"}]}}}',
		);
		server.use(
			http.get(mintUrl + '/v1/info', () => {
				return HttpResponse.json(mintInfo);
			}),
		);
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const info = wallet.getMintInfo();
		const mintRequiresAuth = info.requiresBlindAuthToken('POST', '/v1/mint/bolt11');
		const restoreRequiresAuth = info.requiresBlindAuthToken('POST', '/v1/restore');
		expect(mintRequiresAuth).toBeTruthy();
		expect(restoreRequiresAuth).toBeFalsy();
	});
});

describe('melt proofs', () => {
	test('test melt proofs base case', async () => {
		server.use(
			http.post(mintUrl + '/v1/melt/bolt11', () => {
				return HttpResponse.json({
					state: MeltQuoteState.PAID,
					payment_preimage: 'preimage',
					change: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit, logger });
		await wallet.loadMint();

		const meltQuote: MeltQuoteResponse = {
			quote: 'test_melt_quote',
			amount: 10,
			fee_reserve: 3,
			request: 'bolt11request',
			state: MeltQuoteState.UNPAID,
			expiry: 1234567890,
			payment_preimage: null,
			unit: 'sat',
		};
		const proofsToSend: Proof[] = [
			{
				id: '00bd033559de27d0',
				amount: 8,
				secret: 'secret1',
				C: 'C1',
			},
			{
				id: '00bd033559de27d0',
				amount: 5,
				secret: 'secret2',
				C: 'C2',
			},
		]; // sum=13, feeReserve=3, amount=10
		const response = await wallet.meltProofsBolt11(meltQuote, proofsToSend);

		expect(response.quote.state).toBe(MeltQuoteState.PAID);
		expect(response.quote.payment_preimage).toBe('preimage');
		expect(response.change).toHaveLength(2);
		expect(response.change[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(response.change[1]).toMatchObject({ amount: 2, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(response.change[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(response.change[0].secret)).toBe(true);
	});

	test('test melt proofs no change', async () => {
		server.use(
			http.post(mintUrl + '/v1/melt/bolt11', () => {
				return HttpResponse.json({
					state: MeltQuoteState.PAID,
					payment_preimage: 'preimage',
					change: [],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const meltQuote: MeltQuoteResponse = {
			quote: 'test_melt_quote',
			amount: 12,
			fee_reserve: 0,
			request: 'bolt11request',
			state: MeltQuoteState.UNPAID,
			expiry: 1234567890,
			payment_preimage: null,
			unit: 'sat',
		};
		const proofsToSend: Proof[] = [
			{
				id: '00bd033559de27d0',
				amount: 8,
				secret: 'secret1',
				C: 'C1',
			},
			{
				id: '00bd033559de27d0',
				amount: 4,
				secret: 'secret2',
				C: 'C2',
			},
		]; // sum=12, feeReserve=0
		const response = await wallet.meltProofsBolt11(meltQuote, proofsToSend);

		expect(response.quote.state).toBe(MeltQuoteState.PAID);
		expect(response.quote.payment_preimage).toBe('preimage');
		expect(response.change).toHaveLength(0);
	});

	test('test melt proofs pending', async () => {
		server.use(
			http.post(mintUrl + '/v1/melt/bolt11', () => {
				return HttpResponse.json({
					paid: false,
					payment_preimage: null,
					change: null,
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const meltQuote: MeltQuoteResponse = {
			quote: 'test_melt_quote',
			amount: 10,
			fee_reserve: 3,
			request: 'bolt11request',
			state: MeltQuoteState.UNPAID,
			expiry: 1234567890,
			payment_preimage: null,
			unit: 'sat',
		};
		const proofsToSend: Proof[] = [
			{
				id: '00bd033559de27d0',
				amount: 8,
				secret: 'secret1',
				C: 'C1',
			},
			{
				id: '00bd033559de27d0',
				amount: 5,
				secret: 'secret2',
				C: 'C2',
			},
		];
		const response = await wallet.meltProofsBolt11(meltQuote, proofsToSend);

		expect(response.quote.state).toBe(MeltQuoteState.UNPAID);
		expect(response.quote.payment_preimage).toBeNull();
		expect(response.change).toHaveLength(0);
	});

	test('test melt proofs with callback for blanks', async () => {
		server.use(
			http.post(mintUrl + '/v1/melt/bolt11', () => {
				return HttpResponse.json({
					state: MeltQuoteState.PAID,
					payment_preimage: 'preimage',
					change: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const meltQuote: MeltQuoteResponse = {
			quote: 'test_melt_quote',
			amount: 10,
			fee_reserve: 3,
			request: 'bolt11request',
			state: MeltQuoteState.UNPAID,
			expiry: 1234567890,
			payment_preimage: null,
			unit: 'sat',
		};
		const proofsToSend: Proof[] = [
			{
				id: '00bd033559de27d0',
				amount: 8,
				secret: 'secret1',
				C: 'C1',
			},
			{
				id: '00bd033559de27d0',
				amount: 5,
				secret: 'secret2',
				C: 'C2',
			},
		];
		let capturedBlanks: MeltBlanks | undefined;
		const config: MeltProofsConfig = {
			onChangeOutputsCreated: (blanks) => {
				capturedBlanks = blanks;
			},
		};
		const response = await wallet.meltProofsBolt11(meltQuote, proofsToSend, config);

		expect(capturedBlanks).toBeDefined();
		expect(capturedBlanks!.method).toBe('bolt11');
		expect(capturedBlanks!.quote).toMatchObject(meltQuote);
		expect(capturedBlanks!.keyset.id).toBe('00bd033559de27d0');
		expect(capturedBlanks!.outputData).toHaveLength(2); // log2(3)~1.58, ceil=2
		expect(capturedBlanks!.payload.quote).toBe('test_melt_quote');
		expect(capturedBlanks!.payload.inputs).toHaveLength(2);
		expect(capturedBlanks!.payload.outputs).toHaveLength(2);

		// Response still completes sync
		expect(response.change).toHaveLength(2);
	});

	test('test melt proofs pending with callback and completeMelt', async () => {
		let callCount = 0;
		server.use(
			http.post(mintUrl + '/v1/melt/bolt11', () => {
				callCount++;
				if (callCount === 1) {
					return HttpResponse.json({
						state: MeltQuoteState.UNPAID,
						payment_preimage: null,
						change: null,
					});
				}
				return HttpResponse.json({
					state: MeltQuoteState.PAID,
					payment_preimage: 'preimage',
					change: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const meltQuote: MeltQuoteResponse = {
			quote: 'test_melt_quote',
			amount: 10,
			fee_reserve: 3,
			request: 'bolt11request',
			state: MeltQuoteState.UNPAID,
			expiry: 1234567890,
			payment_preimage: null,
			unit: 'sat',
		};
		const proofsToSend: Proof[] = [
			{
				id: '00bd033559de27d0',
				amount: 8,
				secret: 'secret1',
				C: 'C1',
			},
			{
				id: '00bd033559de27d0',
				amount: 5,
				secret: 'secret2',
				C: 'C2',
			},
		];
		let capturedBlanks: MeltBlanks | undefined;
		const config: MeltProofsConfig = {
			onChangeOutputsCreated: (blanks) => {
				capturedBlanks = blanks;
			},
		};
		const initialResponse = await wallet.meltProofsBolt11(meltQuote, proofsToSend, config);

		expect(initialResponse.quote.state).toBe(MeltQuoteState.UNPAID);
		expect(initialResponse.change).toHaveLength(0);
		expect(capturedBlanks).toBeDefined();

		// Simulate completion later
		const completedResponse = await wallet.completeMelt(capturedBlanks!);

		expect(completedResponse.quote.state).toBe(MeltQuoteState.PAID);
		expect(completedResponse.quote.payment_preimage).toBe('preimage');
		expect(completedResponse.change).toHaveLength(2);
		expect(completedResponse.change[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
	});

	describe('melt, NUT-08 blanks', () => {
		test('includes zero-amount blanks covering fee reserve (bolt11)', async () => {
			const wallet = new Wallet(mint, { unit, bip39seed: randomBytes(32) });
			await wallet.loadMint();
			const meltQuote: MeltQuoteResponse = {
				quote: 'test_melt_quote',
				amount: 10,
				fee_reserve: 3, // ceil(log2(3)) = 2 blanks expected
				request: 'bolt11...',
				state: MeltQuoteState.UNPAID,
				expiry: 1234567890,
				payment_preimage: null,
				unit,
			};
			const proofsToSend: Proof[] = [
				{
					id: '00bd033559de27d0',
					amount: 8,
					secret: 'secret1',
					C: 'C1',
				},
				{
					id: '00bd033559de27d0',
					amount: 5,
					secret: 'secret2',
					C: 'C2',
				},
			];
			let seenBody: any | undefined;
			server.use(
				http.post(mintUrl + '/v1/melt/bolt11', async ({ request }) => {
					const body = await request.json();
					seenBody = body;
					return HttpResponse.json({
						quote: meltQuote.quote, // id string
						amount: meltQuote.amount,
						fee_reserve: meltQuote.fee_reserve,
						state: MeltQuoteState.PAID,
						payment_preimage: 'deadbeef', // optional but harmless
						change: [
							{
								id: '00bd033559de27d0',
								amount: 1,
								C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
							},
							{
								id: '00bd033559de27d0',
								amount: 2,
								C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
							},
						],
					});
				}),
			);
			const res = await wallet.meltProofsBolt11(meltQuote, proofsToSend);
			// console.log('MELTres', res);
			// payload assertions
			expect(seenBody.quote).toBe(meltQuote.quote);
			expect(Array.isArray(seenBody.outputs)).toBe(true);
			expect(seenBody.outputs).toHaveLength(2); // ceil(log2(3)) == 2
			expect(seenBody.outputs.every((o: any) => o.amount === 0)).toBe(true);
			// response sanity (v3 contract)
			expect(res.quote.state).toBe(MeltQuoteState.PAID);
		});

		test('includes zero-amount blanks covering fee reserve (bolt12)', async () => {
			const wallet = new Wallet(mint, { unit, bip39seed: randomBytes(32) });
			await wallet.loadMint();
			const meltQuote: Bolt12MeltQuoteResponse = {
				quote: 'test_melt_quote',
				amount: 10,
				fee_reserve: 3,
				request: 'bolt12request',
				state: MeltQuoteState.UNPAID,
				expiry: 1234567890,
				payment_preimage: null,
				unit: 'sat',
			};
			const proofsToSend: Proof[] = [
				{
					id: '00bd033559de27d0',
					amount: 8,
					secret: 'secret1',
					C: 'C1',
				},
				{
					id: '00bd033559de27d0',
					amount: 5,
					secret: 'secret2',
					C: 'C2',
				},
			];
			let seenBody: any | undefined;
			server.use(
				http.post(mintUrl + '/v1/melt/bolt12', async ({ request }) => {
					const body = await request.json();
					seenBody = body;
					return HttpResponse.json({
						state: MeltQuoteState.PAID,
						payment_preimage: 'preimage',
						change: [
							{
								id: '00bd033559de27d0',
								amount: 1,
								C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
							},
							{
								id: '00bd033559de27d0',
								amount: 2,
								C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
							},
						],
					});
				}),
			);
			const res = await wallet.meltProofsBolt12(meltQuote, proofsToSend);
			// payload assertions
			expect(seenBody.quote).toBe(meltQuote.quote);
			expect(Array.isArray(seenBody.outputs)).toBe(true);
			expect(seenBody.outputs).toHaveLength(2); // ceil(log2(3)) == 2
			expect(seenBody.outputs.every((o: any) => o.amount === 0)).toBe(true);

			// response sanity (v3 contract)
			expect(res.quote.state).toBe(MeltQuoteState.PAID);
			expect(res.change).toHaveLength(2);
			expect(res.change[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		});
	});

	test('test melt proofs bolt12 variant', async () => {
		server.use(
			http.post(mintUrl + '/v1/melt/bolt12', () => {
				return HttpResponse.json({
					state: MeltQuoteState.PAID,
					payment_preimage: 'preimage',
					change: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const meltQuote: Bolt12MeltQuoteResponse = {
			quote: 'test_melt_quote',
			amount: 10,
			fee_reserve: 3,
			request: 'bolt12request',
			state: MeltQuoteState.UNPAID,
			expiry: 1234567890,
			payment_preimage: null,
			unit: 'sat',
		};
		const proofsToSend: Proof[] = [
			{
				id: '00bd033559de27d0',
				amount: 8,
				secret: 'secret1',
				C: 'C1',
			},
			{
				id: '00bd033559de27d0',
				amount: 5,
				secret: 'secret2',
				C: 'C2',
			},
		];
		const response = await wallet.meltProofsBolt12(meltQuote, proofsToSend);

		expect(response.quote.state).toBe(MeltQuoteState.PAID);
		expect(response.quote.payment_preimage).toBe('preimage');
		expect(response.change).toHaveLength(2);
		expect(response.change[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
	});

	test('test melt proofs bad response', async () => {
		server.use(
			http.post(mintUrl + '/v1/melt/bolt11', () => {
				return HttpResponse.json({});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const meltQuote: MeltQuoteResponse = {
			quote: 'test_melt_quote',
			amount: 10,
			fee_reserve: 3,
			request: 'bolt11request',
			state: MeltQuoteState.UNPAID,
			expiry: 1234567890,
			payment_preimage: null,
			unit: 'sat',
		};
		const proofsToSend: Proof[] = [
			{
				id: '00bd033559de27d0',
				amount: 8,
				secret: 'secret1',
				C: 'C1',
			},
			{
				id: '00bd033559de27d0',
				amount: 5,
				secret: 'secret2',
				C: 'C2',
			},
		];
		const result = await wallet.meltProofsBolt11(meltQuote, proofsToSend).catch((e) => e);

		expect(result).toEqual(new Error('bad response'));
	});

	test('test melt proofs mismatch signatures', async () => {
		server.use(
			http.post(mintUrl + '/v1/melt/bolt11', () => {
				return HttpResponse.json({
					state: MeltQuoteState.PAID,
					payment_preimage: 'preimage',
					change: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const meltQuote: MeltQuoteResponse = {
			quote: 'test_melt_quote',
			amount: 10,
			fee_reserve: 2,
			request: 'bolt11request',
			state: MeltQuoteState.UNPAID,
			expiry: 1234567890,
			payment_preimage: null,
			unit: 'sat',
		};
		const proofsToSend: Proof[] = [
			{
				id: '00bd033559de27d0',
				amount: 8,
				secret: 'secret1',
				C: 'C1',
			},
			{
				id: '00bd033559de27d0',
				amount: 4,
				secret: 'secret2',
				C: 'C2',
			},
		];
		const result = await wallet.meltProofsBolt11(meltQuote, proofsToSend).catch((e) => e);

		expect(result.message).toContain('Mint returned 3 signatures, but only 1 blanks were provided');
	});
});

describe('bindKeyset & withKeyset', () => {
	function ks(id: string, unitStr = unit, hasKeys = true, fee = 0) {
		return { id, unit: unitStr, hasKeys, fee } as any;
	}

	test('binds to a valid keyset id and updates defaults', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const otherId = '00aa000000000000';
		const spy = vi
			.spyOn(wallet.keyChain, 'getKeyset')
			.mockImplementation((id?: string) => (id === otherId ? ks(otherId) : ks('00bd033559de27d0')));

		wallet.bindKeyset(otherId);

		expect(wallet.keysetId).toBe(otherId);
		expect(wallet.getKeyset().id).toBe(otherId);
		expect(spy).toHaveBeenCalledWith(otherId);
	});

	test('throws if the keyset has no keys', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const badId = '00bb000000000000';
		const spy = vi.spyOn(wallet.keyChain, 'getKeyset').mockReturnValueOnce(ks(badId, unit, false));
		expect(() => wallet.bindKeyset(badId)).toThrow('Keyset has no keys loaded');
		expect(spy).toHaveBeenCalledWith(badId);
	});

	test('throws if the keyset unit differs from the wallet unit', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const eurId = '00cc000000000000';
		const spy = vi.spyOn(wallet.keyChain, 'getKeyset').mockReturnValueOnce(ks(eurId, 'eur', true));
		expect(() => wallet.bindKeyset(eurId)).toThrow('Keyset unit does not match wallet unit');
		expect(spy).toHaveBeenCalledWith(eurId);
	});

	test('withKeyset returns a new wallet without mutating the original', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const current = wallet.keysetId;
		const w2 = wallet.withKeyset(current);
		expect(w2).not.toBe(wallet);
		expect(w2.keysetId).toBe(current);

		// mutate original binding; w2 should remain unchanged
		const otherId = '00dd000000000000';
		vi.spyOn(wallet.keyChain, 'getKeyset').mockReturnValueOnce(ks(otherId));
		wallet.bindKeyset(otherId);

		expect(wallet.keysetId).toBe(otherId);
		expect(w2.keysetId).toBe(current);
	});

	test('getKeyset() without an id returns the bound keyset', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const bound = wallet.keysetId;
		const k = wallet.getKeyset();
		expect(k.id).toBe(bound);
	});

	test('loadMint fails if the bound keyset has no keys after refresh', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const boundId = '00ef000000000000';
		const spy = vi.spyOn(wallet.keyChain, 'getKeyset');

		// First call for bindKeyset -> has keys
		spy.mockReturnValueOnce(ks(boundId, unit, true));
		wallet.bindKeyset(boundId);

		// Next call during loadMint(true) -> loses keys
		spy.mockReturnValueOnce(ks(boundId, unit, false));

		await expect(wallet.loadMint(true)).rejects.toThrow('Wallet keyset has no keys after refresh');
	});
});

describe('async melt preference header', () => {
	test('bolt11: sends Prefer: respond-async when preferAsync is true', async () => {
		// Arrange: quote and proofs with exact match (no change outputs needed)
		const meltQuote = {
			quote: 'q-async-1',
			amount: 1,
			unit: 'sat',
			request: invoice,
			state: 'UNPAID',
			fee_reserve: 0,
		} as MeltQuoteResponse;
		const proofs = [
			{
				id: '00bd033559de27d0',
				amount: 1,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];

		server.use(
			http.post(mintUrl + '/v1/melt/bolt11', async ({ request }) => {
				const prefer = request.headers.get('prefer');
				expect(prefer).toBe('respond-async');
				return HttpResponse.json({
					quote: meltQuote.quote,
					amount: meltQuote.amount,
					state: 'UNPAID',
					change: [],
				});
			}),
		);

		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		// Act: preferAsync -> header should be present
		const res = await wallet.meltProofsBolt11(meltQuote, proofs, {
			onChangeOutputsCreated: (_foo) => {},
		});

		// Assert: got a response and no change outputs
		expect(res.quote.quote).toBe(meltQuote.quote);
		expect(res.change).toHaveLength(0);
	});

	test('bolt11: does not send Prefer when preferAsync is not set', async () => {
		const meltQuote = {
			quote: 'q-async-1b',
			amount: 1,
			unit: 'sat',
			request: invoice,
			state: 'UNPAID',
			fee_reserve: 0,
		} as MeltQuoteResponse;
		const proofs = [
			{
				id: '00bd033559de27d0',
				amount: 1,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];

		server.use(
			http.post(mintUrl + '/v1/melt/bolt11', async ({ request }) => {
				const prefer = request.headers.get('prefer');
				expect(prefer).toBeNull();
				return HttpResponse.json({
					quote: meltQuote.quote,
					amount: meltQuote.amount,
					state: 'UNPAID',
					change: [],
				});
			}),
		);

		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const res = await wallet.meltProofsBolt11(meltQuote, proofs);
		expect(res.quote.quote).toBe(meltQuote.quote);
		expect(res.change).toHaveLength(0);
	});

	test('bolt12: sends Prefer: respond-async when preferAsync is true', async () => {
		const meltQuote = {
			quote: 'q-async-12',
			amount: 1,
			unit: 'sat',
			request: 'lno1offer...',
		} as any; // minimal shape for wallet.meltProofsBolt12
		const proofs = [
			{
				id: '00bd033559de27d0',
				amount: 1,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];

		server.use(
			http.post(mintUrl + '/v1/melt/bolt12', async ({ request }) => {
				const prefer = request.headers.get('prefer');
				expect(prefer).toBe('respond-async');
				return HttpResponse.json({ quote: meltQuote.quote, amount: meltQuote.amount, change: [] });
			}),
		);

		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const res = await wallet.meltProofsBolt12(meltQuote, proofs, {
			onChangeOutputsCreated: (_foo) => {},
		});
		expect(res.quote.quote).toBe(meltQuote.quote);
		expect(res.change).toHaveLength(0);
	});

	test('bolt12: does not send Prefer when preferAsync is not set', async () => {
		const meltQuote = {
			quote: 'q-async-12b',
			amount: 1,
			unit: 'sat',
			request: 'lno1offer...',
		} as any;
		const proofs = [
			{
				id: '00bd033559de27d0',
				amount: 1,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];

		server.use(
			http.post(mintUrl + '/v1/melt/bolt12', async ({ request }) => {
				const prefer = request.headers.get('prefer');
				expect(prefer).toBeNull();
				return HttpResponse.json({ quote: meltQuote.quote, amount: meltQuote.amount, change: [] });
			}),
		);

		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const res = await wallet.meltProofsBolt12(meltQuote, proofs);
		expect(res.quote.quote).toBe(meltQuote.quote);
		expect(res.change).toHaveLength(0);
	});

	test('bolt11: preferAsync with blind auth sends both Prefer and Blind-auth headers', async () => {
		const mintInfo = {
			name: 'Testnut mint',
			pubkey: '02abc',
			version: 'Nutshell/x',
			contact: [],
			time: 0,
			nuts: {
				22: {
					protected_endpoints: [{ method: 'POST', path: '/v1/melt/bolt11' }],
				},
			},
		};
		server.use(http.get(mintUrl + '/v1/info', () => HttpResponse.json(mintInfo)));
		server.use(
			http.post(mintUrl + '/v1/melt/bolt11', async ({ request }) => {
				const prefer = request.headers.get('prefer');
				const blind = request.headers.get('blind-auth');
				expect(prefer).toBe('respond-async');
				expect(blind).toBe('test-token');
				return HttpResponse.json({ quote: 'q-auth-1', amount: 1, state: 'UNPAID', change: [] });
			}),
		);

		const mockAuthProvider: AuthProvider = {
			getBlindAuthToken: vi.fn().mockResolvedValue('test-token'),
			getCAT: vi.fn().mockReturnValue(undefined),
			setCAT: vi.fn(),
		};
		const wallet = new Wallet(mintUrl, { unit, authProvider: mockAuthProvider });
		await wallet.loadMint();

		const meltQuote = {
			quote: 'q-auth-1',
			amount: 1,
			unit: 'sat',
			request: invoice,
			state: 'UNPAID',
			fee_reserve: 0,
		} as MeltQuoteResponse;
		const proofs = [
			{
				id: '00bd033559de27d0',
				amount: 1,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];

		const res = await wallet.meltProofsBolt11(meltQuote, proofs, {
			onChangeOutputsCreated: (_foo) => {},
		});
		expect(res.quote.quote).toBe('q-auth-1');
	});

	test('bolt12: preferAsync with blind auth sends both Prefer and Blind-auth headers', async () => {
		const mintInfo = {
			name: 'Testnut mint',
			pubkey: '02abc',
			version: 'Nutshell/x',
			contact: [],
			time: 0,
			nuts: {
				22: {
					protected_endpoints: [{ method: 'POST', path: '/v1/melt/bolt12' }],
				},
			},
		};
		server.use(http.get(mintUrl + '/v1/info', () => HttpResponse.json(mintInfo)));
		server.use(
			http.post(mintUrl + '/v1/melt/bolt12', async ({ request }) => {
				const prefer = request.headers.get('prefer');
				const blind = request.headers.get('blind-auth');
				expect(prefer).toBe('respond-async');
				expect(blind).toBe('test-token');
				return HttpResponse.json({ quote: 'q-auth-12', amount: 1, change: [] });
			}),
		);

		const mockAuthProvider: AuthProvider = {
			getBlindAuthToken: vi.fn().mockResolvedValue('test-token'),
			getCAT: vi.fn().mockReturnValue(undefined),
			setCAT: vi.fn(),
		};
		const wallet = new Wallet(mintUrl, { unit, authProvider: mockAuthProvider });
		await wallet.loadMint();

		const meltQuote = {
			quote: 'q-auth-12',
			amount: 1,
			unit: 'sat',
			request: 'lno1offer...',
		} as any;
		const proofs = [
			{
				id: '00bd033559de27d0',
				amount: 1,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];

		const res = await wallet.meltProofsBolt12(meltQuote, proofs, {
			onChangeOutputsCreated: (_foo) => {},
		});
		expect(res.quote.quote).toBe('q-auth-12');
	});
});

function expectNUT10SecretDataToEqual(p: Array<Proof>, s: string) {
	p.forEach((p) => {
		const parsedSecret = JSON.parse(p.secret);
		expect(parsedSecret[1].data).toBe(s);
	});
}
