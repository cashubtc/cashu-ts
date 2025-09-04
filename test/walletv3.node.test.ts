import { setupServer } from 'msw/node';
import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, afterAll, afterEach, test, describe, expect, vi } from 'vitest';

import { Mint } from '../src/Mint';
import { Wallet, DEFAULT_OUTPUT } from '../src/Wallet';
import {
	CheckStateEnum,
	MeltQuoteResponse,
	MeltQuoteState,
	MintQuoteResponse,
	MintQuoteState,
	Proof,
} from '../src/model/types/index';
import { bytesToNumber, deriveKeysetId, getDecodedToken, sumProofs } from '../src/utils';
import { type Logger, ConsoleLogger } from '../src/logger';
import { Server, WebSocket } from 'mock-socket';
import { injectWebSocketImpl } from '../src/ws';
import { MintInfo } from '../src/model/MintInfo';
import { OutputData } from '../src/model/OutputData';
import { hexToBytes } from '@noble/curves/abstract/utils';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';

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
			expiry: 1754296607,
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
const logger = new ConsoleLogger('DEBUG');

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
	it('should initialize with mint instance and load mint info, keys, and keysets', async () => {
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
		const keysets = wallet.getKeySets();
		expect(keysets).toEqual(dummyKeysetResp.keysets);
		expect(keysets).toHaveLength(1);
		expect(keysets[0]).toEqual({
			id: '00bd033559de27d0',
			unit: 'sat',
			active: true,
			input_fee_ppk: 0,
		});

		// Verify keys
		const keys = wallet.getAllKeys();
		expect(keys).toEqual(dummyKeysResp.keysets);
		expect(keys).toHaveLength(1);
		expect(keys[0]).toEqual({
			id: '00bd033559de27d0',
			unit: 'sat',
			keys: {
				1: '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
				2: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			},
			expiry: 1754296607,
		});

		// Verify active keyset ID
		const keysetId = wallet.getKeysetId();
		expect(keysetId).toBe('00bd033559de27d0');

		// Verify specific keyset retrieval
		const specificKeys = wallet.getKeys('00bd033559de27d0');
		expect(specificKeys).toEqual(dummyKeysResp.keysets[0]);
	});

	it('should initialize with mint URL string and load mint info, keys, and keysets', async () => {
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
		const keysets = wallet.getKeySets();
		expect(keysets).toEqual(dummyKeysetResp.keysets);
		expect(keysets).toHaveLength(1);
		expect(keysets[0]).toEqual({
			id: '00bd033559de27d0',
			unit: 'sat',
			active: true,
			input_fee_ppk: 0,
		});

		// Verify keys
		const keys = wallet.getAllKeys();
		expect(keys).toEqual(dummyKeysResp.keysets);
		expect(keys).toHaveLength(1);
		expect(keys[0]).toEqual({
			id: '00bd033559de27d0',
			unit: 'sat',
			keys: {
				1: '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
				2: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			},
			expiry: 1754296607,
		});

		// Verify active keyset ID
		const keysetId = wallet.getKeysetId();
		expect(keysetId).toBe('00bd033559de27d0');

		// Verify specific keyset retrieval
		const specificKeys = wallet.getKeys('00bd033559de27d0');
		expect(specificKeys).toEqual(dummyKeysResp.keysets[0]);
	});

	it('should initialize with preloaded mint info, keys, and keysets without fetching', async () => {
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
		const keysets = wallet.getKeySets();
		expect(keysets).toEqual(dummyKeysetResp.keysets);
		expect(keysets).toHaveLength(1);
		expect(keysets[0]).toEqual({
			id: '00bd033559de27d0',
			unit: 'sat',
			active: true,
			input_fee_ppk: 0,
		});

		// Verify keys
		const keys = wallet.getAllKeys();
		expect(keys).toEqual(dummyKeysResp.keysets);
		expect(keys).toHaveLength(1);
		expect(keys[0]).toEqual({
			id: '00bd033559de27d0',
			unit: 'sat',
			keys: {
				1: '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
				2: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			},
			expiry: 1754296607,
		});

		// Verify active keyset ID
		const keysetId = wallet.getKeysetId();
		expect(keysetId).toBe('00bd033559de27d0');

		// Verify specific keyset retrieval
		const specificKeys = wallet.getKeys('00bd033559de27d0');
		expect(specificKeys).toEqual(dummyKeysResp.keysets[0]);

		// Verify no network calls were made
		expect(spyMintInfo).toHaveBeenCalledTimes(0);
		expect(spyKeySets).toHaveBeenCalledTimes(0);
		expect(spyKeys).toHaveBeenCalledTimes(0);

		spyMintInfo.mockRestore();
		spyKeySets.mockRestore();
		spyKeys.mockRestore();
	});

	it('should throw when retrieving keys for an invalid keyset ID', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();

		expect(() => wallet.getKeys('invalid-keyset-id')).toThrow(
			'No keyset found with ID invalid-keyset-id',
		);
	});

	it('should throw when accessing getters before loadMint', () => {
		const wallet = new Wallet(mintUrl, { unit });
		expect(() => wallet.getMintInfo()).toThrow('Mint info not initialized; call loadMint first');
		expect(() => wallet.getKeySets()).toThrow('Keysets not initialized; call loadMint first');
		expect(() => wallet.getAllKeys()).toThrow('Keys not initialized; call loadMint first');
		expect(() => wallet.getKeysetId()).toThrow('No keyset ID set; call loadMint first');
	});

	it('should force refresh mint info, keys, and keysets when forceRefresh is true', async () => {
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
		const keysets = wallet.getKeySets();
		expect(keysets).toEqual(dummyKeysetResp.keysets);
		const keys = wallet.getAllKeys();
		expect(keys).toEqual(dummyKeysResp.keysets);
		const keysetId = wallet.getKeysetId();
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

		const fee = await wallet.checkMeltQuote('test');
		const amount = 2000;

		expect(fee.fee_reserve + amount).toEqual(2020);
	});
});

describe('receive', () => {
	const tokenInput =
		'cashuBo2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdGF0gaJhaUgAvQM1Wd4n0GFwgaNhYQFhc3hAMDFmOTEwNmQxNWMwMWI5NDBjOThlYTdlOTY4YTA2ZTNhZjY5NjE4ZWRiOGJlOGU1MWI1MTJkMDhlOTA3OTIxNmFjWCEC-F3YSw-EGENmy2kUYQavfA8m8u4K0oej5fqFJSi7Kd8';
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

		const wallet = new Wallet(mint, { unit, logger });
		await wallet.loadMint();

		const proofs = await wallet.receive(token3sat, { type: 'random', splitAmounts: [1, 1, 1] });

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
	test('test receive deterministic', async () => {
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

		const proofs = await wallet.receive(token3sat, { type: 'deterministic', counter: 5 });
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 1, id: '00bd033559de27d0' },
			{ amount: 2, id: '00bd033559de27d0' },
		]);
		expect(proofs[0].secret).toBe(
			'c3cad2ac3da43f84995a7ea362bd5509a992ef3684c151f5f3945b1a1f026efd',
		);
		expect(proofs[1].secret).toBe(
			'bd31ac247f79cc72c0c6ba2793a44d006c57fd98ff4a982e357e48c12cf47f02',
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

		const proofs = await wallet.receive(token3sat, {
			type: 'p2pk',
			options: { pubkey: '02a9acc1e594c8d2f91fbd5664973aaef2ff2b8c2f6cf5f419c17a35755a6ab5c4' },
		});
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 1, id: '00bd033559de27d0' },
			{ amount: 2, id: '00bd033559de27d0' },
		]);
		const decoder = new TextDecoder();
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
		const proofs = await wallet.receive(token3sat, { type: 'factory', factory: customFactory });
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 1, id: '00bd033559de27d0' },
			{ amount: 2, id: '00bd033559de27d0' },
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
			wallet.getKeys('00bd033559de27d0')!,
			[1, 1, 1],
		);
		const proofs = await wallet.receive(token3sat, { type: 'custom', data: customData });
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

		await expect(wallet.receive(token3sat, DEFAULT_OUTPUT, { requireDleq: true })).rejects.toThrow(
			'Token contains proofs with invalid or missing DLEQ',
		);
		// Try using a receive helper too
		await expect(wallet.receiveAsDefault(token3sat, { requireDleq: true })).rejects.toThrow(
			'Token contains proofs with invalid or missing DLEQ',
		);
	});

	test('test receive proofsWeHave optimization', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', async ({ request }) => {
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
		const proofs = await wallet.receive(tok, { type: 'random', proofsWeHave: existingProofs });
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
			http.post(mintUrl + '/v1/swap', async ({ request }) => {
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

		const proofs = await wallet.receive(token3sat, DEFAULT_OUTPUT, {
			privkey: '5d41402abc4b2a76b9719d911017c592',
		});
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 1, id: '00bd033559de27d0' },
			{ amount: 2, id: '00bd033559de27d0' },
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

		const proofs = await wallet.receive(token3sat, DEFAULT_OUTPUT, {
			keysetId: '00bd033559de27d0',
		});
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 1, id: '00bd033559de27d0' },
			{ amount: 2, id: '00bd033559de27d0' },
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

		const proofs = await wallet.mintProofs(1, '');

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

		const result = await wallet.mintProofs(1, '').catch((e) => e);

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
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
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
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
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
				send: { type: 'p2pk', options: { pubkey: 'pk' } },
			},
			{
				// p2pk: { pubkey: 'pk' }
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
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
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
				send: { type: 'random', splitAmounts: [1, 1, 1, 1] },
				keep: { type: 'random', splitAmounts: [] },
			},
			{
				// preference: { sendPreference: [{ amount: 1, count: 4 }] }
				// outputAmounts: { sendAmounts: [1, 1, 1, 1], keepAmounts: [] },
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
			{
				send: { type: 'random', splitAmounts: [1, 1, 1] },
				keep: { type: 'random', splitAmounts: [1] },
			},
			{},
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
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
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
	test('test send preference with fees included', async () => {
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
		const result = await wallet.send(3, overpayProofs, undefined, { includeFees: true });

		// Swap 8, get 7 back (after 1*600ppk = 1 sat fee).
		// Send 3 [1,2] plus fee (2*600 for send inputs = 1200ppk = 2 sat fee)
		// Total send = [1, 2, 2]  = send 3, total fee = 3*600 = 1800ppk = 2 sats)
		expect(result.send).toHaveLength(3);
		expect(result.send[0]).toMatchObject({ amount: 1, id: '00bd033559de27d0' });
		expect(result.send[1]).toMatchObject({ amount: 2, id: '00bd033559de27d0' });
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
		const seed = hexToBytes(
			'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
		);
		const wallet = new Wallet(mint, { unit, bip39seed: seed, logger });
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
		const result = await wallet.send(3, overpayProofs, outputConfig, { includeFees: true });
		// Assert no overlap (e.g., secrets are unique)
		const allSecrets = [...result.keep, ...result.send].map((p) => p.secret);
		expect(new Set(allSecrets).size).toBe(allSecrets.length); // No duplicates
	});
});

describe('deterministic', () => {
	test('no seed', async () => {
		const wallet = new Wallet(mint, logger);
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
				{ send: { type: 'deterministic', counter: 1 } },
			)
			.catch((e) => e);
		expect(result).toEqual(
			new Error('Deterministic outputs require a seed configured in the wallet'),
		);
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
			const test = await wallet.onMintQuoteUpdates(['123'], callback, () => {
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
			const test = await wallet.onMeltQuoteUpdates(['123'], callback, (e) => {
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

		const invoice =
			'lnbc20u1p3u27nppp5pm074ffk6m42lvae8c6847z7xuvhyknwgkk7pzdce47grf2ksqwsdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzpgxqyz5vqsp5sw6n7cztudpl5m5jv3z6dtqpt2zhd3q6dwgftey9qxv09w82rgjq9qyyssqhtfl8wv7scwp5flqvmgjjh20nf6utvv5daw5h43h69yqfwjch7wnra3cn94qkscgewa33wvfh7guz76rzsfg9pwlk8mqd27wavf2udsq3yeuju';
		const meltQuote = await wallet.createMultiPathMeltQuote(invoice, 1000);
		expect(meltQuote.amount).toBe(1);
		expect(meltQuote.quote).toBe('K-80Mo7xrtQRgaA1ifrxDKGQGZEGlo7zNDwTtf-D');
		await expect(wallet.createMeltQuote(invoice)).rejects.toThrow();
	});
});
describe('P2PK BlindingData', () => {
	test('Create BlindingData locked to single pk with locktime and single refund key', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const keys = wallet.getKeys();
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
		const keys = wallet.getKeys();
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
		const keys = wallet.getKeys();
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
		const keys = wallet.getKeys();
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
		const keys = wallet.getKeys();
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
		const keys = wallet.getKeys();
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
		const keys = wallet.getKeys();
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
		const keys = wallet.getKeys();
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
		const keys = wallet.getKeys();
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
		const keys = wallet.getKeys();
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
		const keys = wallet.getKeys();
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
		const keys = wallet.getKeys();
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
			.mockImplementation(async (start, count, options?): Promise<{ proofs: Array<Proof> }> => {
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
				async (
					start,
					count,
					options?,
				): Promise<{ proofs: Array<Proof>; lastCounterWithSignature?: number }> => {
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
		const mintRequiresAuth = info.requiresBlindAuthToken('/v1/mint/bolt11');
		const restoreRequiresAuth = info.requiresBlindAuthToken('v1/restore');
		expect(mintRequiresAuth).toBeTruthy();
		expect(restoreRequiresAuth).toBeFalsy();
	});
});

describe('Test coinselection', () => {
	const notes = [
		{
			id: '00bd033559de27d0',
			amount: 2,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
		},
		{
			id: '00bd033559de27d0',
			amount: 8,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
		},
		{
			id: '00bd033559de27d0',
			amount: 16,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
		},
		{
			id: '00bd033559de27d0',
			amount: 16,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
		},
		{
			id: '00bd033559de27d0',
			amount: 1,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
		},
		{
			id: '00bd033559de27d0',
			amount: 1,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
		},
	];
	test('offline coinselection, zero fee keyset', async () => {
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const targetAmount = 25;
		const { send } = await wallet.sendOffline(targetAmount, notes, { includeFees: false });
		expect(send).toHaveLength(3);
		const amountSend = sumProofs(send);
		expect(amountSend).toBe(25);
		const { send: sendFeesInc } = await wallet.sendOffline(targetAmount, notes, {
			includeFees: true,
		});
		expect(sendFeesInc).toHaveLength(3);
		const amountSendFeesInc = sendFeesInc.reduce((acc, p) => acc + p.amount, 0);
		expect(amountSendFeesInc).toBe(25);
	});
	test('next best match coinselection', async () => {
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const targetAmount = 23;
		const { send } = wallet.selectProofsToSend(
			notes,
			targetAmount,
			true, // includeFees
		);
		console.log(
			'send',
			send.map((p) => p.amount),
		);
		expect(send).toHaveLength(2);
		const amountSend = sumProofs(send);
		expect(amountSend).toBe(24);
	});
	test('offline coinselection with large input fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 1000 }],
				});
			}),
		);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const targetAmount = 31;
		const { send } = await wallet.sendOffline(targetAmount, notes, { includeFees: true });
		const amountSend = sumProofs(send);
		const fee = wallet.getFeesForProofs(send);
		// Fee = ceil(3 * 1000 / 1000) = 3, net = 34 - 3 = 31
		console.log('optimal:>>', [16, 16, 2]);
		expect(send).toHaveLength(3);
		expect(amountSend).toBe(34);
		expect(amountSend - fee).toBe(targetAmount);
	});
	test('offline coinselection with medium input fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const targetAmount = 31;
		const { send } = await wallet.sendOffline(targetAmount, notes, { includeFees: true });
		const amountSend = sumProofs(send);
		const fee = wallet.getFeesForProofs(send);
		// Fee = ceil(3 * 600 / 1000) = 2, net = 33 - 2 = 31
		console.log('optimal:>>', [16, 16, 1]);
		expect(send).toHaveLength(3);
		expect(amountSend).toBe(33);
		expect(amountSend - fee).toBe(targetAmount);
	});
	test('insufficient proofs', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const smallNotes = [
			{ id: '00bd033559de27d0', amount: 1, secret: 'secret1', C: 'C1' },
			{ id: '00bd033559de27d0', amount: 1, secret: 'secret2', C: 'C2' },
			{ id: '00bd033559de27d0', amount: 2, secret: 'secret3', C: 'C3' },
		]; // Total = 4
		const targetAmount = 5;
		// Fee for 3 proofs = ceil(3 * 600 / 1000) = 2, need 5 + 2 = 7, but 4 < 7, so expect throw
		expect(() =>
			wallet.sendOffline(targetAmount, smallNotes, {
				includeFees: true,
			}),
		).toThrow('Not enough funds available to send');
		// try using selectProofsToSend directly
		const { send, keep } = wallet.selectProofsToSend(
			smallNotes,
			targetAmount,
			true, // includeFees
		);
		// Fee = ceil(1 * 1000 / 1000) = 1, need 60 + 1 = 61, 64 >= 61
		expect(send).toHaveLength(0);
		expect(keep).toHaveLength(3);
	});
	test('single proof selection', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 1000 }],
				});
			}),
		);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const largeNote = [
			{ id: '00bd033559de27d0', amount: 64, secret: 'secret1', C: 'C1' },
			{ id: '00bd033559de27d0', amount: 16, secret: 'secret2', C: 'C2' },
			{ id: '00bd033559de27d0', amount: 4, secret: 'secret3', C: 'C3' },
		];
		const targetAmount = 60;
		const { send } = wallet.selectProofsToSend(
			largeNote,
			targetAmount,
			true, // includeFees
		);
		// Fee = ceil(1 * 1000 / 1000) = 1, need 60 + 1 = 61, 64 >= 61
		expect(send).toHaveLength(1);
		expect(send[0].amount).toBe(64);
		const amountSend = sumProofs(send);
		const fee = wallet.getFeesForProofs(send);
		expect(amountSend - fee).toBeGreaterThanOrEqual(targetAmount);
		const { send: sendExact } = wallet.selectProofsToSend(
			largeNote,
			15,
			true, // includeFees
		);
		// Fee = ceil(1 * 1000 / 1000) = 1, need 15 + 1 = 16
		expect(sendExact).toHaveLength(1);
		expect(sendExact[0].amount).toBe(16);
	});
	test('multiple keysets with different fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [
						{ id: '00keyset1', unit: 'sat', active: true, input_fee_ppk: 600 },
						{ id: '00keyset2', unit: 'sat', active: true, input_fee_ppk: 1000 },
					],
				});
			}),
		);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const mixedNotes = [
			{ id: '00keyset1', amount: 16, secret: 'secret1', C: 'C1' },
			{ id: '00keyset2', amount: 16, secret: 'secret2', C: 'C2' },
			{ id: '00keyset1', amount: 1, secret: 'secret3', C: 'C3' },
			{ id: '00keyset2', amount: 10, secret: 'secret4', C: 'C4' },
		];
		const targetAmount = 31;
		const { send } = wallet.selectProofsToSend(
			mixedNotes,
			targetAmount,
			true, // includeFees
		);
		const amountSend = sumProofs(send);
		const fee = wallet.getFeesForProofs(send);
		expect(amountSend - fee).toBeGreaterThanOrEqual(targetAmount);
		// e.g., [16_00keyset1, 16_00keyset2, 10_00keyset2], fee = ceil((600+1000+1000)/1000) = 3, net = 42 - 3 = 39 >= 31
		expect(send).toHaveLength(3);
		expect(amountSend).toBe(42);
	});
	test('zero amount to send', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const targetAmount = 0;
		// Exact match (offline)
		const { send } = await wallet.sendOffline(targetAmount, notes, { includeFees: true });
		// No proofs needed, fee = 0, net = 0 >= 0
		expect(send).toHaveLength(0);
		// try using selectProofsToSend directly
		const { send: send1, keep: keep1 } = wallet.selectProofsToSend(
			notes,
			targetAmount,
			true, // includeFees
		);
		expect(send1).toHaveLength(0);
		expect(keep1).toHaveLength(6);
	});
	test('all proofs smaller than target', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const smallNotes = [
			{ id: '00bd033559de27d0', amount: 8, secret: 'secret1', C: 'C1' },
			{ id: '00bd033559de27d0', amount: 8, secret: 'secret2', C: 'C2' },
			{ id: '00bd033559de27d0', amount: 8, secret: 'secret3', C: 'C3' },
			{ id: '00bd033559de27d0', amount: 1, secret: 'secret4', C: 'C4' },
		];
		const targetAmount = 15;
		// Exact match (offline)
		const { send } = await wallet.sendOffline(targetAmount, smallNotes, {
			includeFees: true,
		});
		const amountSend = sumProofs(send);
		// Fee = ceil(3 * 600 / 1000) = 2, need 15 + 2 = 17
		expect(send).toHaveLength(3);
		expect(amountSend).toBe(17);
		const fee = wallet.getFeesForProofs(send);
		expect(amountSend - fee).toBe(targetAmount);
		// Best match (online)
		const { send: sendOffline } = wallet.selectProofsToSend(
			smallNotes,
			targetAmount + 1, // 16
			true, // includeFees
		);
		console.log('sendOffline', sendOffline);
		const amountSendOffline = sendOffline.reduce((acc, p) => acc + p.amount, 0);
		// Fee = ceil(3 * 600 / 1000) = 2, need 16 + 2 = 18 (24 > 18 = best match)
		expect(sendOffline).toHaveLength(3);
		expect(amountSendOffline).toBe(24);
	});
	test('integration select 10 from 100 minted', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const smallNotes = [
			{ id: '00bd033559de27d0', amount: 64, secret: 'secret1', C: 'C1' },
			{ id: '00bd033559de27d0', amount: 32, secret: 'secret2', C: 'C2' },
			{ id: '00bd033559de27d0', amount: 4, secret: 'secret3', C: 'C3' },
		];
		const targetAmount = 10;
		// best match (online)
		const { send } = wallet.selectProofsToSend(
			smallNotes,
			targetAmount,
			true, // includeFees
		);
		console.log(
			'send',
			send.map((p) => p.amount),
		);
		expect(send).toBeDefined();
		expect(send.length).toBe(1);
		const amountSend = sumProofs(send);
		expect(amountSend).toBe(32);
	});
	test('exact match not possible', async () => {
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const proofs = [
			{ id: '00bd033559de27d0', amount: 2, secret: 's1', C: 'C1' },
			{ id: '00bd033559de27d0', amount: 2, secret: 's2', C: 'C2' },
			{ id: '00bd033559de27d0', amount: 2, secret: 's3', C: 'C3' },
		];
		const targetAmount = 5;
		const { send } = await wallet.sendOffline(targetAmount, proofs, {
			includeFees: true,
			exactMatch: false,
		});
		expect(send).toHaveLength(3);
		const amountSend = sumProofs(send);
		expect(amountSend).toBe(6);
	});
	test('minimal fee selection', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [
						{ id: '00low', unit: 'sat', active: true, input_fee_ppk: 200 },
						{ id: '00high', unit: 'sat', active: true, input_fee_ppk: 1000 },
					],
				});
			}),
		);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const proofs = [
			{ id: '00low', amount: 16, secret: 's1', C: 'C1' },
			{ id: '00high', amount: 16, secret: 's2', C: 'C2' },
			{ id: '00low', amount: 8, secret: 's3', C: 'C3' },
		];
		const targetAmount = 20;
		const { send } = wallet.selectProofsToSend(
			proofs,
			targetAmount,
			true, // includeFees
		);
		const fee = wallet.getFeesForProofs(send);
		console.log(send.map((p) => [p.amount, p.id]));
		expect(send.every((p) => p.id === '00low')).toBe(true); // Prefer low-fee keyset
		expect(send.reduce((a, p) => a + p.amount, 0) - fee).toBeGreaterThanOrEqual(targetAmount);
	});
	test('zero fee scenario', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 0 }],
				});
			}),
		);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const targetAmount = 25;
		const { send } = await wallet.sendOffline(targetAmount, notes, { includeFees: true });
		const amountSend = sumProofs(send);
		expect(amountSend).toBe(25); // No fee adjustment
	});
	test('duplicate proofs exceeding limit', async () => {
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const dupNotes = Array(10).fill({ id: '00bd033559de27d0', amount: 8, secret: 's', C: 'C' });
		const targetAmount = 24;
		const { send } = await wallet.sendOffline(targetAmount, dupNotes, {
			includeFees: false,
		});
		expect(send).toHaveLength(3); // 3 * 8 = 24
	});
	test('non-exact match with zero fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 0 }],
				});
			}),
		);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const targetAmount = 23;
		const { send } = wallet.selectProofsToSend(
			notes,
			targetAmount,
			true, // includeFees
		);
		expect(send.reduce((a, p) => a + p.amount, 0)).toBeGreaterThanOrEqual(targetAmount);
	});
	test('process large proof array (50+ notes)', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 1000 }],
				});
			}),
		);

		// Define 50 additional notes: 128, and 49 others
		const additionalNotes = [
			{
				id: '00bd033559de27d0',
				amount: 128,
				secret: 's255',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			...Array(49)
				.fill(null)
				.map((_, i) => ({
					id: '00bd033559de27d0',
					amount: 2 ** (i % 10), // 1, 2, 4, 8, 16, 32, 64, 128, 256, 512
					secret: `secret${i}`,
					C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
				})),
		];
		const allNotes = [...notes, ...additionalNotes]; // 6 + 50 = 56 notes
		// console.log('allNotes', allNotes.map((p)=>p.amount));
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();

		// Exact Match Test No Fees
		const targetAmountExact = 128;
		console.time('largeProofsNoFees');
		const { send: sendExact } = wallet.selectProofsToSend(
			allNotes,
			targetAmountExact,
			false, // includeFees
		);
		console.timeEnd('largeProofsNoFees');
		if (sendExact.length === 0) {
			throw new Error('No exact match found');
		}
		const amountSendExact = sumProofs(sendExact);
		console.log(
			'largeProofsNoFees:',
			sendExact.map((p) => p.amount),
		);
		expect(amountSendExact).toBe(targetAmountExact);

		// Non-Exact Match Test With Fees
		const targetAmountNonExact = 127;
		console.time('largeProofsWithFees');
		const { send: sendNonExact } = wallet.selectProofsToSend(
			allNotes,
			targetAmountNonExact,
			true, // includeFees
		);
		console.timeEnd('largeProofsWithFees');
		const amountSendNonExact = sendNonExact.reduce((acc, p) => acc + p.amount, 0);
		const feeNonExact = wallet.getFeesForProofs(sendNonExact);
		console.log(
			'largeProofsWithFees send:',
			sendNonExact.map((p) => p.amount),
		);
		expect(amountSendNonExact - feeNonExact).toBeGreaterThanOrEqual(targetAmountNonExact);
	});
	test('select small amount with fees from many small notes', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const smallNotes = [
			...Array(50).fill({ id: '00bd033559de27d0', amount: 1, secret: 's1', C: 'C1' }),
			...Array(50).fill({ id: '00bd033559de27d0', amount: 2, secret: 's2', C: 'C2' }),
		];
		const targetAmount = 15;

		// Non-exact match
		const { send } = wallet.selectProofsToSend(
			smallNotes,
			targetAmount,
			true, // includeFees
		);
		console.log(
			'send:',
			send.map((p) => p.amount),
		);
		const sum = sumProofs(send);
		const fee = wallet.getFeesForProofs(send);
		expect(sum - fee).toBeGreaterThanOrEqual(targetAmount);
		// Check efficiency: should ideally use around 50 proofs or fewer if larger proofs were available
		expect(send.length).toBeLessThanOrEqual(50);
	});
	test('exorbitant input fees (10 sats per proof)', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 10000 }],
				});
			}),
		);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		await wallet.loadMint();
		const targetAmount = 5;
		const { send } = wallet.selectProofsToSend(
			notes,
			targetAmount,
			true, // includeFees
		);
		const fee = wallet.getFeesForProofs(send);
		console.log(
			'send:',
			send.map((p) => p.amount),
		);
		console.log('fee:', fee);
		expect(send.length).toBe(1);
		expect(send[0].amount).toBe(16);
		// 16 - ceil(10000/1000) = 16 - 10 = 6 >= 5
		expect(send.reduce((a, p) => a + p.amount, 0) - fee).toBeGreaterThanOrEqual(targetAmount);
	});
	test('optimal offline coinselection', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();
		const targetAmount = 25;
		const { send } = await wallet.sendOffline(targetAmount, notes);
		expect(send).toHaveLength(3);
		const amountSend = sumProofs(send);
		expect(amountSend).toBe(25);
	});
	test('next optimal offline coinselection', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();
		const targetAmount = 23;
		const { send } = await wallet.sendOffline(targetAmount, notes, { exactMatch: false });
		expect(send).toHaveLength(2);
		const amountSend = sumProofs(send);
		expect(amountSend).toBe(24);
	});

	test('optimal offline coinselection with 1000 ppk input fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [
						{
							id: '00bd033559de27d0',
							unit: 'sat',
							active: true,
							input_fee_ppk: 1000,
						},
					],
				});
			}),
		);
		const mint = new Mint(mintUrl);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		const targetAmount = 31;
		const { send } = await wallet.sendOffline(targetAmount, notes, {
			includeFees: true,
		});
		expect(send).toHaveLength(3);
		const amountSend = sumProofs(send);
		// fee ppk is 1000:
		// * 2 proofs (optimal) would have had fee = 2
		// * next optimal solution is 4 proofs with fee 4.
		expect(amountSend).toBe(34);
	});
	test('optimal offline coinselection with 600 ppk input fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [
						{
							id: '00bd033559de27d0',
							unit: 'sat',
							active: true,
							input_fee_ppk: 600,
						},
					],
				});
			}),
		);
		const mint = new Mint(mintUrl);
		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		const targetAmount = 31;
		const { send } = await wallet.sendOffline(targetAmount, notes, {
			includeFees: true,
		});
		console.log(send.map((p) => p.amount));
		expect(send).toHaveLength(3);
		const amountSend = sumProofs(send);
		expect(amountSend).toBe(33);
	});
	test('bench aggressive coinselection with huge proofsets and fees (with mixed amounts)', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [
						{
							id: '00bd033559de27d0',
							unit: 'sat',
							active: true,
							input_fee_ppk: 600,
						},
					],
				});
			}),
		);
		let numProofs = 50000;
		let proofs: Array<Proof> = [];
		for (let i = 0; i < numProofs; ++i) {
			const amount = new DataView(randomBytes(4).buffer).getUint32(0, false) & ((1 << 19) - 1);
			const proof = {
				id: '00bd033559de27d0',
				amount: amount,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			};
			proofs.push(proof);
		}

		const totalAmount = proofs.reduce((acc, p) => p.amount + acc, 0);

		console.log(`totalAmount: ${totalAmount}`);
		console.log(`N Proofs: ${numProofs}`);

		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		const amountToSend = Math.floor((Math.random() * totalAmount) / 2 + totalAmount / 2);

		// Reusable vars
		let amountSend;
		let amountKeep;
		let send;
		let keep;
		let fee;

		// Close match with fees test
		console.time('selectProofs-fees');
		({ send } = wallet.selectProofsToSend(
			proofs,
			amountToSend,
			true, // includeFees
		));
		console.timeEnd('selectProofs-fees');
		fee = wallet.getFeesForProofs(send);
		amountSend = sumProofs(send);
		expect(amountSend - fee).toBeGreaterThanOrEqual(amountToSend);

		// Exact match test
		console.time('selectProofs-no-fees');
		({ send, keep } = wallet.selectProofsToSend(
			proofs,
			amountToSend,
			true, // includeFees
		));
		console.timeEnd('selectProofs-no-fees');
		amountKeep = sumProofs(keep);
		amountSend = sumProofs(send);

		if (send.length > 0) {
			// Exact match found
			expect(amountSend).toBeGreaterThanOrEqual(amountToSend);
		} else {
			// No exact match possible, all proofs kept
			expect(amountKeep).toEqual(totalAmount);
			expect(send).toHaveLength(0);
		}
	});
	test('bench small coinselection with huge proofsets and fees (with mixed amounts)', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [
						{
							id: '00bd033559de27d0',
							unit: 'sat',
							active: true,
							input_fee_ppk: 600,
						},
					],
				});
			}),
		);
		let numProofs = 50000;
		let proofs: Array<Proof> = [];
		for (let i = 0; i < numProofs; ++i) {
			const amount = new DataView(randomBytes(4).buffer).getUint32(0, false) & ((1 << 19) - 1);
			const proof = {
				id: '00bd033559de27d0',
				amount: amount,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			};
			proofs.push(proof);
		}

		const totalAmount = proofs.reduce((acc, p) => p.amount + acc, 0);

		console.log(`totalAmount: ${totalAmount}`);
		console.log(`N Proofs: ${numProofs}`);

		const keysets = await mint.getKeySets();
		const wallet = new Wallet(mint, { unit, keysets: keysets.keysets });
		const amountToSend = Math.floor((Math.random() * totalAmount) / numProofs);

		// Reusable vars
		let amountSend;
		let amountKeep;
		let send;
		let keep;
		let fee;

		// Close match with fees test
		console.time('selectProofs-fees');
		({ send } = wallet.selectProofsToSend(
			proofs,
			amountToSend,
			true, // includeFees
		));
		console.timeEnd('selectProofs-fees');
		fee = wallet.getFeesForProofs(send);
		amountSend = sumProofs(send);
		expect(amountSend - fee).toBeGreaterThanOrEqual(amountToSend);

		// Close match no fees test
		console.time('selectProofs-no-fees');
		({ send, keep } = wallet.selectProofsToSend(
			proofs,
			amountToSend,
			false, // includeFees
		));
		console.timeEnd('selectProofs-no-fees');
		amountKeep = sumProofs(keep);
		amountSend = sumProofs(send);

		if (send.length > 0) {
			// Exact match found
			expect(amountSend).toBeGreaterThanOrEqual(amountToSend);
		}
	});
	test('test send tokens exact without previous split', async () => {
		const mint = new Mint(mintUrl);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const sendResponse = await wallet.send(64, [
			{
				id: '00bd033559de27d0',
				amount: 64,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		]);
		expect(sendResponse).toBeDefined();
		expect(sendResponse.send).toBeDefined();
		expect(sendResponse.keep).toBeDefined();
		expect(sendResponse.send.length).toBe(1);
		expect(sendResponse.keep.length).toBe(0);
		expect(sumProofs(sendResponse.send)).toBe(64);
	});
});

function expectNUT10SecretDataToEqual(p: Array<Proof>, s: string) {
	p.forEach((p) => {
		const parsedSecret = JSON.parse(p.secret);
		expect(parsedSecret[1].data).toBe(s);
	});
}
