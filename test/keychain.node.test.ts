import { setupServer } from 'msw/node';
import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, afterAll, afterEach, test, describe, expect, vi } from 'vitest';

import { Mint } from '../src/Mint';
import { KeyChain } from '../src/model/KeyChain';
import { type MintKeyset, type MintKeys } from '../src/types';
import { isValidHex } from '../src/utils';

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
			id: '00abc12345678901',
			unit: 'sat',
			keys: {
				1: '03anotherpubkey1',
				2: '03anotherpubkey2',
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
			id: '00abc12345678901',
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
		const keysets = keyChain.getKeysetList();
		expect(keysets).toHaveLength(4); // All from dummy, assuming same unit
		expect(keysets.map((k) => k.id)).toEqual(dummyKeysetResp.keysets.map((ks) => ks.id));

		// Verify keys assigned
		const keysForFirst = keyChain.getKeys('00bd033559de27d0');
		expect(keysForFirst).toEqual(dummyKeysResp.keysets[0]);

		// Verify active keyset (lowest fee, active, hex ID)
		const active = keyChain.getActiveKeyset();
		expect(active.id).toBe('00bd033559de27d0'); // Fee 0, hex ID
		expect(active.fee).toBe(0);
		expect(active.hasHexId).toBe(true);
		expect(isValidHex(active.id)).toBe(true);

		// Verify final_expiry assigned
		expect(active.final_expiry).toBe(1754296607);
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

	test('should throw if no active keyset found after init', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({ keysets: [] }); // Empty keysets
			}),
		);

		const keyChain = new KeyChain(mint, unit);
		await expect(keyChain.init()).rejects.toThrow('KeyChain not initialized; call init() first');
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
		expect(keyset.hasKeyPairs).toBe(true);
		expect(keyset.keyPairs).toEqual(dummyKeysResp.keysets[0].keys);
	});

	test('should throw on invalid keyset ID', () => {
		expect(() => keyChain.getKeyset('invalid')).toThrow("Keyset 'invalid' not found");
	});

	test('should throw if no keys loaded for keyset', async () => {
		// Simulate no keys from mint
		server.use(
			http.get(mintUrl + '/v1/keys', () => {
				return HttpResponse.json({ keysets: [] }); // No keys
			}),
		);
		const tempKeyChain = new KeyChain(mint, unit);
		await tempKeyChain.init();
		expect(() => tempKeyChain.getKeys('00bd033559de27d0')).toThrow(
			"No keys loaded for keyset '00bd033559de27d0'",
		);
	});

	test('should get active keyset correctly', () => {
		const active = keyChain.getActiveKeyset();
		expect(active.id).toBe('00bd033559de27d0'); // Lowest fee 0
		expect(active.fee).toBe(0);
	});

	test('should get keyset list', () => {
		const list = keyChain.getKeysetList();
		expect(list).toHaveLength(4);
		expect(list.map((k) => k.id).sort()).toEqual(dummyKeysetResp.keysets.map((ks) => ks.id).sort());
	});

	test('should get keys for specific or active keyset', () => {
		const activeKeys = keyChain.getKeys();
		expect(activeKeys.id).toBe('00bd033559de27d0');
		expect(activeKeys.unit).toBe('sat');
		expect(activeKeys.keys).toEqual(dummyKeysResp.keysets[0].keys);

		const specificKeys = keyChain.getKeys('00abc12345678901');
		expect(specificKeys.id).toBe('00abc12345678901');
		expect(specificKeys.keys).toEqual(dummyKeysResp.keysets[1].keys);
	});

	test('should throw getters if not initialized', () => {
		const uninitChain = new KeyChain(mint, unit);
		expect(() => uninitChain.getKeyset('any')).toThrow("Keyset 'any' not found");
		expect(() => uninitChain.getActiveKeyset()).toThrow(
			'KeyChain not initialized; call init() first',
		);
		expect(() => uninitChain.getKeysetList()).toThrow(
			'KeyChain not initialized; call init() first',
		);
		expect(() => uninitChain.getKeys()).toThrow('KeyChain not initialized; call init() first');
	});
});
