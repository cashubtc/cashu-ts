import { HttpResponse, http } from 'msw';
import { test, describe, expect, vi } from 'vitest';

import {
	Mint,
	Wallet,
	KeyChain,
	CheckStateEnum,
	type MeltQuoteBolt11Response,
	MintQuoteState,
	MintInfo,
	Amount,
	setGlobalRequestOptions,
} from '../../src';

import { NULL_LOGGER } from '../../src/logger';
import { MINTCACHE } from '../consts';
import {
	mintUrl,
	mint,
	unit,
	invoice,
	mintInfoResp,
	dummyKeysResp,
	dummyKeysetResp,
	useTestServer,
} from './_setup';

const server = useTestServer();

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
		expect(keysets[0].toMintKeyset()).toEqual(dummyKeysetResp.keysets[0]);

		// Verify keys
		const keys = wallet.keyChain.getAllKeys();
		expect(keys).toEqual(dummyKeysResp.keysets);
		expect(keys).toHaveLength(1);
		expect(keys[0]).toEqual(dummyKeysResp.keysets[0]);

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
			final_expiry: 1754296607,
		});

		// Verify keys
		const keys = wallet.keyChain.getAllKeys();
		expect(keys).toEqual(dummyKeysResp.keysets);
		expect(keys).toHaveLength(1);
		expect(keys[0]).toEqual(dummyKeysResp.keysets[0]);

		// Verify active keyset ID
		const keysetId = wallet.keyChain.getCheapestKeyset().id;
		expect(keysetId).toBe('00bd033559de27d0');

		// Verify specific keyset retrieval
		const specificKeys = wallet.keyChain.getKeyset('00bd033559de27d0').keys;
		expect(specificKeys).toEqual(dummyKeysResp.keysets[0].keys);
	});

	test('should resolve NUT-19 support lazily from mint info when unsupported', async () => {
		const wallet = new Wallet(new Mint(mintUrl), { unit });
		await wallet.loadMint();

		const mintInfo = await wallet.mint.getLazyMintInfo();
		expect(mintInfo.isSupported(19)).toEqual({ supported: false });
	});

	test('should wire NUT-19 policy from mint info during init', async () => {
		const mintInfoWithNut19 = JSON.parse(JSON.stringify(mintInfoResp));
		mintInfoWithNut19.nuts[19] = {
			ttl: 30,
			cached_endpoints: [{ method: 'POST', path: '/v1/checkstate' }],
		};

		server.use(
			http.get(mintUrl + '/v1/info', () => {
				return HttpResponse.json(mintInfoWithNut19);
			}),
		);

		const wallet = new Wallet(new Mint(mintUrl), { unit });
		await wallet.loadMint();

		const mintInfo = await wallet.mint.getLazyMintInfo();
		expect(mintInfo.isSupported(19)).toEqual({
			supported: true,
			params: {
				ttl: 30000,
				cached_endpoints: [{ method: 'POST', path: '/v1/checkstate' }],
			},
		});
	});

	test('should retry timed out NUT-19 cached endpoint through wallet API', async () => {
		const mintInfoWithNut19 = JSON.parse(JSON.stringify(mintInfoResp));
		mintInfoWithNut19.nuts[19] = {
			ttl: 60,
			cached_endpoints: [{ method: 'POST', path: '/v1/checkstate' }],
		};

		server.use(
			http.get(mintUrl + '/v1/info', () => {
				return HttpResponse.json(mintInfoWithNut19);
			}),
		);

		let requestCount = 0;
		server.use(
			http.post(mintUrl + '/v1/checkstate', async () => {
				requestCount++;
				if (requestCount === 1) {
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
				return HttpResponse.json({
					states: [
						{
							Y: '02d5dd71f59d917da3f73defe997928e9459e9d67d8bdb771e4989c2b5f50b2fff',
							state: 'UNSPENT',
						},
					],
				});
			}),
		);

		setGlobalRequestOptions({ requestTimeout: 10 });
		try {
			const wallet = new Wallet(new Mint(mintUrl), { unit });
			await wallet.loadMint();
			const states = await wallet.checkProofsStates([
				{
					secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				},
			]);

			expect(requestCount).toBe(2);
			expect(states).toHaveLength(1);
			expect(states[0].state).toBe(CheckStateEnum.UNSPENT);
		} finally {
			setGlobalRequestOptions({});
		}
	});

	test('should initialize with preloaded mint info, keys, and keysets without fetching', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		const cache = KeyChain.mintToCacheDTO(mintUrl, dummyKeysetResp.keysets, dummyKeysResp.keysets);
		wallet.loadMintFromCache(mintInfoResp, cache);
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
			final_expiry: 1754296607,
		});

		// Verify keys
		const keys = wallet.keyChain.getAllKeys();
		expect(keys).toEqual(dummyKeysResp.keysets);
		expect(keys).toHaveLength(1);
		expect(keys[0]).toEqual(dummyKeysResp.keysets[0]);

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
		await expect(wallet.loadMint()).resolves.toBeUndefined(); // no throw on load

		expect(() => wallet.keyChain.getKeyset('invalid-keyset-id')).toThrow(
			"Keyset 'invalid-keyset-id' not found",
		);
	});

	test('should throw when accessing getters before loadMint', () => {
		const wallet = new Wallet(mintUrl, { unit });
		expect(() => wallet.getMintInfo()).toThrow(/Mint info not initialized; call loadMint/);
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
		const wallet = new Wallet(mintUrl, { unit });
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
		const keys = wallet.keyChain.getAllKeys();
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
		expect(info.cache).toEqual(mintInfoResp);
		expect(info.contact).toEqual(mintInfoResp.contact);
		expect(info.description).toEqual(mintInfoResp.description);
		expect(info.description_long).toEqual(mintInfoResp.description_long);
		expect(info.name).toEqual(mintInfoResp.name);
		expect(info.pubkey).toEqual(mintInfoResp.pubkey);
		expect(info.nuts).toEqual(mintInfoResp.nuts);
		expect(info.version).toEqual(mintInfoResp.version);
		expect(info.motd).toEqual(mintInfoResp.motd);
		expect(info.supportsNut04Description('bolt12', 'sat')).toBeFalsy();
		expect(() => {
			info.isSupported(1 as any);
		}).toThrow(/nut is not supported/);
	});
	test('test info with deprecated contact field (passed through as-is in v4)', async () => {
		// mintInfoRespDeprecated uses the old array-of-arrays contact format
		// v4 no longer normalizes this — it is passed through from the wire
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
		// Wire format array-of-arrays is passed through unchanged in v4
		expect(info.contact).toEqual([
			['email', 'contact@me.com'],
			['twitter', '@me'],
			['nostr', 'npub1337'],
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
		const info = wallet.getMintInfo();

		expect(info.supportsNut04Description('bolt11', 'sat')).toBe(true);
		expect(info.supportsNut04Description('bolt11', 'usd')).toBe(true);
		expect(info.supportsNut04Description('bolt12', 'sat')).toBe(false);

		server.use(
			http.post(mintUrl + '/v1/mint/quote/bolt11', () =>
				HttpResponse.json({
					quote: 'sat-quote',
					request: 'lnbc...',
					unit: 'sat',
					amount: 1000,
					state: MintQuoteState.UNPAID,
					expiry: null,
				}),
			),
		);
		await expect(wallet.createMintQuoteBolt11(1000, 'sat description')).resolves.toHaveProperty(
			'quote',
			'sat-quote',
		);

		const usdWallet = new Wallet(mint, { unit: 'usd' });
		const usdKeychainCache = { ...MINTCACHE.keychainCache, unit: 'usd' };
		usdWallet.loadMintFromCache(MINTCACHE.mintInfo, usdKeychainCache);
		// console.log('usdWallet', usdWallet.keyChain.cache);
		await expect(usdWallet.createMintQuoteBolt11(1000, 'usd description')).resolves.toBeDefined();
	});
	test('supportsAmountless() correctly detects amountless option in melt methods', async () => {
		const info = new MintInfo({
			name: 'Test Mint',
			pubkey: '0296d0aa13b6a31cf0cd974249f28c7b7176d7274712c95a41c7d8066d3f29d679',
			version: 'Nutshell/0.16.3',
			contact: [
				{ method: 'email', info: 'contact@me.com' },
				{ method: 'twitter', info: '@me' },
				{ method: 'nostr', info: 'npub1337' },
			],
			nuts: {
				4: {
					disabled: false,
					methods: [
						{
							method: 'bolt11',
							unit: 'sat',
							min_amount: 0,
							max_amount: 0,
						},
					],
				},
				5: {
					disabled: false,
					methods: [
						{
							method: 'bolt11',
							unit: 'sat',
							min_amount: 100,
							max_amount: 10000,
							options: { amountless: true },
						},
						{
							method: 'bolt11',
							unit: 'sat',
							min_amount: 100,
							max_amount: 10000,
							options: { description: true },
						},
					],
				},
			},
		});

		expect(info.supportsAmountless('bolt11', 'sat')).toBe(true);

		// method/unit not matching any amountless option → false
		expect(info.supportsAmountless('onchain', 'sat')).toBe(false);

		// same method/unit but missing options.amountless → false
		const info2 = new MintInfo({
			name: 'Test Mint',
			pubkey: '0296d0aa13b6a31cf0cd974249f28c7b7176d7274712c95a41c7d8066d3f29d679',
			version: 'Nutshell/0.16.3',
			contact: [
				{ method: 'email', info: 'contact@me.com' },
				{ method: 'twitter', info: '@me' },
				{ method: 'nostr', info: 'npub1337' },
			],
			nuts: {
				4: {
					disabled: false,
					methods: [{ method: 'bolt11', unit: 'sat', min_amount: 0, max_amount: 0 }],
				},
				5: {
					disabled: false,
					methods: [
						{ method: 'bolt11', unit: 'sat', min_amount: 0, max_amount: 0 }, // no options.amountless
					],
				},
			},
		});

		expect(info2.supportsAmountless('bolt11', 'sat')).toBe(false);
	});
});

describe('test fees', () => {
	test('test melt quote fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
				return HttpResponse.json({
					quote: 'test_melt_quote_id',
					amount: Amount.from(2000),
					unit: 'sat',
					request: '',
					fee_reserve: Amount.from(20),
					payment_preimage: null,
					state: 'UNPAID',
					expiry: 123,
				} as MeltQuoteBolt11Response);
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const fee = await wallet.checkMeltQuoteBolt11('test');
		const amount = 2000;

		expect(fee.fee_reserve.add(amount).toNumber()).toEqual(2020);
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
		expect(w2).not.toBe(wallet); // new instance
		expect(w2.keysetId).toBe(current);
		expect(w2.getMintInfo()).toStrictEqual(wallet.getMintInfo()); // same mintinfo
		expect(w2.keyChain).toStrictEqual(wallet.keyChain); // same keychain data
		expect(() => {
			w2.keyChain.getCheapestKeyset();
		}).not.toThrow(); // smoke test

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
						unit: 'sat',
						request: invoice,
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
		expect(meltQuote.amount).toEqual(Amount.from(1));
		expect(meltQuote.quote).toBe('K-80Mo7xrtQRgaA1ifrxDKGQGZEGlo7zNDwTtf-D');
		await expect(wallet.createMeltQuoteBolt11(invoice)).rejects.toThrow();
	});
});
