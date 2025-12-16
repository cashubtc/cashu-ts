import { setupServer } from 'msw/node';
import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, afterAll, afterEach, test, describe, expect, vi } from 'vitest';

import { Mint, KeyChain, Keyset, type MintKeyset, type MintKeys } from '../../src';
import { isValidHex } from '../../src/utils';
import { PUBKEYS } from '../consts';

const mintUrl = 'http://localhost:3338';
const mint = new Mint(mintUrl);
const unit = 'sat';

const dummyKeysResp: { keysets: MintKeys[] } = {
	keysets: [
		{
			id: '00bd033559de27d0',
			unit: 'sat',
			keys: {
				1: '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
				2: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			},
		},
		{
			id: '009a1f293253e41e',
			unit: 'sat',
			keys: PUBKEYS,
		},
		{
			id: 'invalidbase64',
			unit: 'sat',
			keys: {
				1: '03pubkey1invalid',
				2: '03pubkey2invalid',
			},
		},
		{
			id: '00inactive',
			unit: 'sat',
			keys: {
				1: '03pubkey1inactive',
				2: '03pubkey2inactive',
			},
		},
	],
};

const dummyKeysetResp: { keysets: MintKeyset[] } = {
	keysets: [
		{
			id: '00bd033559de27d0',
			unit: 'sat',
			active: true,
			input_fee_ppk: 0,
			final_expiry: 1754296607,
		},
		{
			id: '009a1f293253e41e',
			unit: 'sat',
			active: true,
			input_fee_ppk: 2,
			final_expiry: undefined,
		},
		{
			id: 'invalidbase64',
			unit: 'sat',
			active: true,
			input_fee_ppk: 1,
		},
		{
			id: '00inactive',
			unit: 'sat',
			active: false,
			input_fee_ppk: 0,
		},
	],
};

const server = setupServer();

beforeAll(() => {
	server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
	server.use(
		http.get(mintUrl + '/v1/keys', () => {
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

describe('KeyChain initialization', () => {
	test('should initialize with mint instance and load keys and keysets', async () => {
		const keyChain = new KeyChain(mint, unit);
		await keyChain.init();

		// Verify keysets loaded and filtered by unit
		const keysets = keyChain.getKeysets();
		expect(keysets).toHaveLength(4); // All from dummy, assuming same unit
		expect(keysets.map((k) => k.id)).toEqual(dummyKeysetResp.keysets.map((ks) => ks.id));

		// Verify keys assigned
		const keysForFirst = keyChain.getKeyset('00bd033559de27d0').toMintKeys();
		expect(keysForFirst).toEqual(dummyKeysResp.keysets[0]);

		// Verify active keyset (lowest fee, active, hex ID)
		const active = keyChain.getCheapestKeyset();
		expect(active.id).toBe('00bd033559de27d0'); // Fee 0, hex ID
		expect(active.fee).toBe(0);
		expect(active.hasHexId).toBe(true);
		expect(isValidHex(active.id)).toBe(true);

		// Verify final_expiry assigned
		expect(active.expiry).toBe(1754296607);
	});

	test('should initialize with mintUrl and load keys and keysets', async () => {
		const keyChain = new KeyChain('http://localhost:3338', unit);
		await keyChain.init();

		// Verify keysets loaded and filtered by unit
		const keysets = keyChain.getKeysets();
		expect(keysets).toHaveLength(4); // All from dummy, assuming same unit
		expect(keysets.map((k) => k.id)).toEqual(dummyKeysetResp.keysets.map((ks) => ks.id));

		// Verify keys assigned
		const keysForFirst = keyChain.getKeyset('00bd033559de27d0').toMintKeys();
		expect(keysForFirst).toEqual(dummyKeysResp.keysets[0]);

		// Verify active keyset (lowest fee, active, hex ID)
		const active = keyChain.getCheapestKeyset();
		expect(active.id).toBe('00bd033559de27d0'); // Fee 0, hex ID
		expect(active.fee).toBe(0);
		expect(active.hasHexId).toBe(true);
		expect(isValidHex(active.id)).toBe(true);

		// Verify final_expiry assigned
		expect(active.expiry).toBe(1754296607);
	});

	test('should skip loading if already initialized unless forceRefresh', async () => {
		const keyChain = new KeyChain(mint, unit);
		const spyGetKeySets = vi.spyOn(mint, 'getKeySets');
		const spyGetKeys = vi.spyOn(mint, 'getKeys');

		await keyChain.init(); // First load
		expect(spyGetKeySets).toHaveBeenCalledTimes(1);
		expect(spyGetKeys).toHaveBeenCalledTimes(1);

		await keyChain.init(); // Second, should skip
		expect(spyGetKeySets).toHaveBeenCalledTimes(1);
		expect(spyGetKeys).toHaveBeenCalledTimes(1);

		await keyChain.init(true); // Force refresh
		expect(spyGetKeySets).toHaveBeenCalledTimes(2);
		expect(spyGetKeys).toHaveBeenCalledTimes(2);
	});

	test('should throw if no active hex keyset found', async () => {
		// Only include inactive and non-hex keysets
		const limitedKeysetResp = { keysets: dummyKeysetResp.keysets.slice(2) }; // 'invalidbase64' and '00inactive'
		const limitedKeysResp = { keysets: dummyKeysResp.keysets.slice(2) };

		server.use(
			http.get(mintUrl + '/v1/keys', () => {
				return HttpResponse.json(limitedKeysResp);
			}),
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json(limitedKeysetResp);
			}),
		);

		const keyChain = new KeyChain(mint, unit);
		await expect(keyChain.init()).rejects.toThrow('No active keyset found');
	});

	test('should throw if keyset verification fails', async () => {
		// Create mismatched data by changing ID but keeping keys the same (derived ID won't match)
		const mismatchedKeysetResp = JSON.parse(JSON.stringify(dummyKeysetResp));
		const mismatchedKeysResp = JSON.parse(JSON.stringify(dummyKeysResp));

		// Change ID of first keyset and corresponding keys entry
		const newId = '00bd033559de27d1'; // Mismatched by changing last character
		mismatchedKeysetResp.keysets[0].id = newId;
		mismatchedKeysResp.keysets[0].id = newId;

		server.use(
			http.get(mintUrl + '/v1/keys', () => {
				return HttpResponse.json(mismatchedKeysResp);
			}),
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json(mismatchedKeysetResp);
			}),
		);

		const keyChain = new KeyChain(mint, unit);
		await expect(keyChain.init()).rejects.toThrow(`Keyset verification failed for ID ${newId}`);
	});

	test('should throw if no active keyset found after init', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({ keysets: [] }); // Empty keysets
			}),
		);

		const keyChain = new KeyChain(mint, unit);
		await expect(keyChain.init()).rejects.toThrow(/No Keysets found for unit/);
	});

	test('should preload from cache and match original cache', async () => {
		const originalChain = new KeyChain(mint, unit);
		await originalChain.init();

		// New consolidated cache shape
		const originalCache = originalChain.cache;
		// console.log('originalCache', originalCache);

		// Instantiate new KeyChain from consolidated cache
		const cachedChain = KeyChain.fromCache(mint, originalCache);

		// Verify preloaded without calling init()
		const cachedActive = cachedChain.getCheapestKeyset();
		expect(cachedActive.id).toBe(originalChain.getCheapestKeyset().id);
		expect(cachedActive.fee).toBe(0);
		expect(cachedChain.getKeysets().length).toBe(originalChain.getKeysets().length);

		// Round-trip cache check
		const newCache = cachedChain.cache;
		expect(newCache).toEqual(originalCache);
	});

	test('should throw if keychain unit does not match cache unit', async () => {
		const originalChain = new KeyChain(mint, unit);
		await originalChain.init();

		// New consolidated cache shape
		const originalCache = originalChain.cache;
		// console.log('originalCache', originalCache);

		// Instantiate new KeyChain from consolidated cache
		const cachedChain = new KeyChain(mint, 'usd');
		expect(() => cachedChain.loadFromCache(originalCache)).toThrow(
			/KeyChain unit mismatch in cache/,
		);
	});

	test('should preload from single cached keys object (legacy constructor cache)', async () => {
		const originalChain = new KeyChain(mint, unit);
		await originalChain.init();

		// Legacy Mint DTO cache shape
		const legacyCache = originalChain.getCache();

		// Use only the first keys object as single MintKeys
		const singleKeys = legacyCache.keys[0];

		// Filter keysets to match the single keys' ID for consistency
		const matchingKeysets = legacyCache.keysets.filter((ks) => ks.id === singleKeys.id);

		// Deprecated constructor path using Mint DTOs
		const cachedChain = new KeyChain(mint, unit, matchingKeysets, singleKeys); // single value
		const cachedChain2 = new KeyChain(mint, unit, matchingKeysets, [singleKeys]); // array already

		// Verify preloaded
		const cachedActive = cachedChain.getCheapestKeyset();
		expect(cachedActive.id).toBe(singleKeys.id);
		expect(cachedChain.getKeysets().length).toBe(1);
		const cachedActive2 = cachedChain2.getCheapestKeyset();
		expect(cachedActive2.id).toBe(singleKeys.id);
		expect(cachedChain2.getKeysets().length).toBe(1);
	});
});

describe('KeyChain getters', () => {
	let keyChain: KeyChain;

	beforeEach(async () => {
		keyChain = new KeyChain(mint, unit);
		await keyChain.init();
	});

	test('should get keyset by ID', () => {
		const keyset = keyChain.getKeyset('00bd033559de27d0');
		expect(keyset.id).toBe('00bd033559de27d0');
		expect(keyset.unit).toBe('sat');
		expect(keyset.isActive).toBe(true);
		expect(keyset.fee).toBe(0);
		expect(keyset.expiry).toBe(1754296607);
		expect(keyset.hasKeys).toBe(true);
		expect(keyset.hasHexId).toBe(true);
		expect(keyset.keys).toEqual(dummyKeysResp.keysets[0].keys);
		// v2 compat items
		expect(keyset.active).toBe(true);
		expect(keyset.input_fee_ppk).toBe(0);
		expect(keyset.final_expiry).toBe(1754296607);
	});

	test('should handle keyset without keys', () => {
		const keyset = keyChain.getKeyset('00inactive');
		expect(keyset.id).toBe('00inactive');
		expect(keyset.isActive).toBe(false);
		expect(keyset.hasKeys).toBe(false);
		expect(keyset.hasHexId).toBe(false);
		expect(keyset.toMintKeys()).toBe(null);
		expect(keyset.verify()).toBe(false);

		// Also test non-hex
		const nonHexKeyset = keyChain.getKeyset('invalidbase64');
		expect(nonHexKeyset.hasHexId).toBe(false);
		expect(nonHexKeyset.hasKeys).toBe(false);
		expect(nonHexKeyset.toMintKeys()).toBe(null);
		expect(nonHexKeyset.verify()).toBe(false);
	});

	test('should throw on invalid keyset ID', () => {
		expect(() => keyChain.getKeyset('invalid')).toThrow("Keyset 'invalid' not found");
	});

	test('should get active keyset correctly', () => {
		const active = keyChain.getCheapestKeyset();
		expect(active.id).toBe('00bd033559de27d0'); // Lowest fee 0
		expect(active.fee).toBe(0);
	});

	test('should get keyset list', () => {
		const list = keyChain.getKeysets();
		expect(list).toHaveLength(4);
		expect(list.map((k) => k.id).sort()).toEqual(dummyKeysetResp.keysets.map((ks) => ks.id).sort());
	});

	test('should get keyset IDs', () => {
		const list = keyChain.getAllKeysetIds();
		expect(list).toHaveLength(4);
		expect(list.sort()).toEqual(dummyKeysetResp.keysets.map((ks) => ks.id).sort());
	});

	test('should throw getters if not initialized', () => {
		const uninitChain = new KeyChain(mint, unit);
		expect(() => uninitChain.getKeyset('any')).toThrow("Keyset 'any' not found");
		expect(() => uninitChain.getCheapestKeyset()).toThrow('KeyChain not initialized');
		expect(() => uninitChain.getKeysets()).toThrow('KeyChain not initialized');
	});
});

describe('Keyset', () => {
	test('should default fee to 0 if input_fee_ppk undefined', () => {
		const keyset = new Keyset('testid', 'sat', true, undefined, undefined);
		expect(keyset.fee).toBe(0);
		expect(keyset.input_fee_ppk).toBe(0);
	});
	test('verifyKeysetId should return false if verifying keyset with no keys', () => {
		const badKeyset = { ...dummyKeysResp.keysets[0], keys: {} };
		const verify = Keyset.verifyKeysetId(badKeyset);
		expect(verify).toBeFalsy();
	});
	test('fromMintApi should load if keys / meta match', () => {
		const keyset = Keyset.fromMintApi(dummyKeysetResp.keysets[0], dummyKeysResp.keysets[0]);
		expect(keyset.id).toBe(dummyKeysetResp.keysets[0].id);
	});
	test('fromMintApi should throw if keys / meta mismatched unit', () => {
		const badKeys = { ...dummyKeysResp.keysets[0], unit: 'usd' };
		expect(() => Keyset.fromMintApi(dummyKeysetResp.keysets[0], badKeys)).toThrow(
			/Mismatched keyset units/,
		);
	});
	test('fromMintApi should throw if keys / meta mismatched ID', () => {
		const badKeys = { ...dummyKeysResp.keysets[0], id: '00bad' };
		expect(() => Keyset.fromMintApi(dummyKeysetResp.keysets[0], badKeys)).toThrow(
			/Mismatched keyset ids/,
		);
	});
	test('fromMintApi should throw if keys / meta mismatched final_expiry', () => {
		const badKeys = { ...dummyKeysResp.keysets[0], final_expiry: 123 };
		expect(() => Keyset.fromMintApi(dummyKeysetResp.keysets[0], badKeys)).toThrow(
			/Mismatched keyset expiry/,
		);
	});
});
