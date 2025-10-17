import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { AuthManager } from '../../src/auth/AuthManager';
import type { RequestFn } from '../../src/transport';
import type { MintKeys, Proof } from '../../src/model/types';
import * as utils from '../../src/utils';
import { OutputData } from '../../src/model/OutputData';

/**
 * Helpers & fakes.
 */

const mintUrl = 'http://mint.local';

function makeKeys(id = '00authkeyset0001'): MintKeys {
	return {
		id,
		unit: 'auth',
		keys: { 1: '02deadbeef', 2: '03cafebabe' },
	};
}

function decodeBAT(batHeader: string): { id: string; secret: string; C: string } {
	// "authA" + base64(JSON)
	const base64 = batHeader.slice('authA'.length);
	const json = Buffer.from(base64, 'base64').toString('utf8');
	return JSON.parse(json);
}

function stubOutputs(n: number, keysetId = '00authkeyset0001') {
	// Spy OutputData.createRandomData to return predictable outputs with a toProof stub
	return vi.spyOn(OutputData, 'createRandomData').mockImplementation((): any[] => {
		const arr = Array.from({ length: n }, (_, i) => {
			const blindedMessage = `BM_${i}`;
			return {
				blindedMessage,
				toProof: (_sig: string, _keys: MintKeys): Proof => ({
					id: keysetId,
					C: `C_${i}`,
					secret: `SECRET_${i}`,
					dleq: { e: 'e', s: 's' },
					amount: 1,
				}),
			};
		});
		return arr;
	});
}

function fakeInfo({
	batMax = 10,
	needCATForMint = false,
	blindProtected = true,
}: {
	batMax?: number;
	needCATForMint?: boolean;
	blindProtected?: boolean;
}) {
	// Minimal object that AuthManager uses: .nuts['22'].bat_max_mint, requiresClearAuthToken, requiresBlindAuthToken
	return {
		nuts: {
			'22': { bat_max_mint: batMax },
		},
		requiresClearAuthToken: (method: string, path: string) =>
			needCATForMint && method === 'POST' && path === '/v1/auth/blind/mint',
		requiresBlindAuthToken: (_m: string, _p: string) => blindProtected,
	} as any;
}

/**
 * Per-test state.
 */
let reqSpy: vi.MockedFunction<RequestFn>;
let hasValidDleqSpy: vi.SpyInstance;

beforeEach(() => {
	reqSpy = vi.fn();
	hasValidDleqSpy = vi.spyOn(utils, 'hasValidDleq').mockReturnValue(true);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('AuthManager: CAT lifecycle', () => {
	test('setCAT/getCAT/hasCAT + clearing refresh & expiry on unset', () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });
		// no CAT yet
		expect(am.getCAT()).toBeUndefined();
		expect(am.hasCAT).toBe(false);

		// set CAT
		am.setCAT('cat-token');
		expect(am.getCAT()).toBe('cat-token');
		expect(am.hasCAT).toBe(true);

		// unset CAT clears refresh & expiry
		am['tokens'].refreshToken = 'r';
		am['tokens'].expiresAt = Date.now() + 10_000;
		am.setCAT(undefined);

		expect(am.getCAT()).toBeUndefined();
		expect(am['tokens'].refreshToken).toBeUndefined();
		expect(am['tokens'].expiresAt).toBeUndefined();
	});

	test('ensureCAT returns CAT when valid, else tries refresh via attached OIDC', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });

		// Seed tokens as expiring now
		am['tokens'] = {
			accessToken: 'old-cat',
			refreshToken: 'rrr',
			expiresAt: Date.now() + 1_000, // ~1s
		};

		// Attach fake OIDC with refresh()
		const refresh = vi.fn().mockResolvedValue({
			access_token: 'new-cat',
			refresh_token: 'new-refresh',
			expires_in: 300,
		});
		am['oidc'] = { refresh } as any;

		const cat = await am.ensureCAT(30); // needs at least 30s, so will refresh
		expect(refresh).toHaveBeenCalledWith('rrr');
		expect(cat).toBe('new-cat');
		expect(am.getCAT()).toBe('new-cat');
	});

	test('ensureCAT returns possibly expired CAT if no OIDC or refresh fails', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy, logger: console as any });

		// expired and no refresh path
		am['tokens'] = {
			accessToken: 'old-cat',
			expiresAt: Date.now() - 1000,
		};
		const cat = await am.ensureCAT(30);
		expect(cat).toBe('old-cat'); // returns whatever it has
	});
});

describe('AuthManager: BAT pool minting/topUp/ensure', () => {
	function seedKeys(am: AuthManager, keysetId = '00authkeyset0001') {
		const keys = makeKeys(keysetId);
		// Seed private internals to avoid network in init()
		am['activeKeysetId'] = keysetId;
		am['keysById'].set(keysetId, keys);
		am['keysets'] = [{ id: keysetId, unit: 'auth', active: true, input_fee_ppk: 0 }] as any;
	}

	test('ensure() mints up to desired target but not beyond bat_max_mint (single topUp call)', async () => {
		const am = new AuthManager(mintUrl, {
			request: reqSpy,
			desiredPoolSize: 5,
			maxPerMint: 99,
		});

		// Fake info & keys to bypass init() network
		am['info'] = fakeInfo({ batMax: 2 }); // Mint limit is 2 per call
		seedKeys(am);

		// Stub OutputData and /v1/auth/blind/mint response
		const outputsSpy = stubOutputs(2);
		reqSpy.mockResolvedValueOnce({ signatures: ['sig0', 'sig1'] }); // topUp(2)

		await am.ensure(5); // target 5, but one call can only mint 2
		expect(outputsSpy).toHaveBeenCalledTimes(1);
		expect(reqSpy).toHaveBeenCalledTimes(1);
		expect(am.poolSize).toBe(2);
	});

	test('topUp/end-to-end: creates proofs, validates DLEQ, pushes to pool', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });

		// Prepare info/keys to skip refreshKeysets()
		am['info'] = fakeInfo({ batMax: 3, needCATForMint: false });
		seedKeys(am);

		const outputsSpy = stubOutputs(3);
		reqSpy.mockResolvedValueOnce({ signatures: ['a', 'b', 'c'] });

		await am.ensure(3);
		expect(am.poolSize).toBe(3);
		expect(outputsSpy).toHaveBeenCalledWith(3, expect.any(Object)); // n, keys
		expect(hasValidDleqSpy).toHaveBeenCalledTimes(3);
	});

	test('topUp: throws on bad BAT mint response length', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });
		am['info'] = fakeInfo({ batMax: 2 });
		seedKeys(am);

		stubOutputs(2);
		reqSpy.mockResolvedValueOnce({ signatures: ['only-one'] });

		await expect(am.ensure(2)).rejects.toThrow('bad BAT mint response');
	});

	test('topUp: throws when DLEQ is invalid', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });
		am['info'] = fakeInfo({ batMax: 1 });
		seedKeys(am);

		stubOutputs(1);
		hasValidDleqSpy.mockReturnValue(false);
		reqSpy.mockResolvedValueOnce({ signatures: ['sig'] });

		await expect(am.ensure(1)).rejects.toThrow('invalid DLEQ');
	});

	test('topUp: requires CAT if /v1/auth/blind/mint is Clear-auth protected', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });

		// info says CAT is required on mint endpoint
		am['info'] = fakeInfo({ batMax: 1, needCATForMint: true });
		seedKeys(am);

		// No CAT available so ensureCAT returns undefined -> error
		am['tokens'] = {};
		stubOutputs(1);

		await expect(am.ensure(1)).rejects.toThrow('Clear-auth token required');
	});

	test('getBlindAuthToken: consumes one proof and serializes without dleq', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy, desiredPoolSize: 1 });
		am['info'] = fakeInfo({ batMax: 1 });
		seedKeys(am);

		stubOutputs(1);
		reqSpy.mockResolvedValueOnce({ signatures: ['sig'] });

		// Fill pool
		await am.ensure(1);
		expect(am.poolSize).toBe(1);

		// Get BAT for some endpoint
		const bat = await am.getBlindAuthToken({ method: 'POST', path: '/v1/swap' });
		const parsed = decodeBAT(bat);
		expect(parsed).toEqual({ id: '00authkeyset0001', secret: 'SECRET_0', C: 'C_0' });

		// Pool decreased by 1
		expect(am.poolSize).toBe(0);
	});

	test('getBlindAuthToken: throws when pool empty and minting fails', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy, desiredPoolSize: 1 });
		am['info'] = fakeInfo({ batMax: 1 });
		seedKeys(am);

		// Make topUp fail: signatures array wrong length
		stubOutputs(1);
		reqSpy.mockResolvedValueOnce({ signatures: [] });

		await expect(am.getBlindAuthToken({ method: 'POST', path: '/x' })).rejects.toThrow(
			'AuthManager: bad BAT mint response',
		);
	});

	test('importPool/ exportPool dedupe & deep copy', () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });

		const a: Proof = { id: 'k', C: 'C1', secret: 'SAME', dleq: { e: 'e1', s: 's1' }, amount: 1 };
		const b: Proof = { id: 'k', C: 'C2', secret: 'SAME', dleq: { e: 'e2', s: 's2' }, amount: 1 }; // duplicate by secret
		const c: Proof = { id: 'k', C: 'C3', secret: 'DIFF', dleq: { e: 'e3', s: 's3' }, amount: 1 };

		am.importPool([a, b, c], 'replace');
		expect(am.poolSize).toBe(2);

		const snap = am.exportPool();
		expect(snap).toHaveLength(2);
		// deep copy check
		snap[0].secret = 'mutated';
		const snap2 = am.exportPool();
		expect(snap2[0].secret).not.toBe('mutated');
	});

	test('withLock: concurrent getBlindAuthToken calls serialize correctly', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });
		// Make init() a no-op
		am['info'] = fakeInfo({ batMax: 1 });
		(function seed() {
			const k = '00authkeyset0001';
			am['activeKeysetId'] = k;
			am['keysById'].set(k, makeKeys(k));
			am['keysets'] = [{ id: k, unit: 'auth', active: true, input_fee_ppk: 0 }] as any;
		})();

		// Seed pool with two proofs to avoid topUp
		am['pool'] = [
			{ id: 'k', C: 'C1', secret: 'S1', amount: 1 },
			{ id: 'k', C: 'C2', secret: 'S2', amount: 1 },
		];

		const p1 = am.getBlindAuthToken({ method: 'POST', path: '/v1/swap' });
		const p2 = am.getBlindAuthToken({ method: 'POST', path: '/v1/swap' });

		const [b1, b2] = await Promise.all([p1, p2]);
		const s1 = decodeBAT(b1).secret;
		const s2 = decodeBAT(b2).secret;

		// both different and pool empty after two pops
		expect(s1).not.toBe(s2);
		expect(am.poolSize).toBe(0);
	});
});

describe('AuthManager: refreshKeysets/init paths', () => {
	test('refreshKeysets picks cheapest active auth keyset and loads keys', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });

		// First call: GET keysets list
		reqSpy.mockResolvedValueOnce({
			keysets: [
				{ id: '00aaa', unit: 'auth', active: true, input_fee_ppk: 2 },
				{ id: '00bbb', unit: 'auth', active: true, input_fee_ppk: 0 }, // cheapest
				{ id: '00ccc', unit: 'sat', active: true, input_fee_ppk: 0 }, // different unit ignored
			],
		});

		// Second call: GET keys for chosen keyset
		reqSpy.mockResolvedValueOnce({
			keysets: [makeKeys('00bbb')],
		});

		await am['refreshKeysets']();

		expect(am['activeKeysetId']).toBe('00bbb');
		expect(am['keysById'].get('00bbb')?.id).toBe('00bbb');
	});

	test('refreshKeysets throws with no active auth keyset', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });
		reqSpy.mockResolvedValueOnce({
			keysets: [{ id: 'x', unit: 'sat', active: true, input_fee_ppk: 0 }],
		});
		await expect(am['refreshKeysets']()).rejects.toThrow('no active auth keyset');
	});

	test('refreshKeysets throws on key fetch mismatch', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });

		reqSpy.mockResolvedValueOnce({
			keysets: [{ id: '00pickme', unit: 'auth', active: true, input_fee_ppk: 0 }],
		});
		// returns a different id than activeKeysetId
		reqSpy.mockResolvedValueOnce({
			keysets: [makeKeys('WRONG')],
		});

		await expect(am['refreshKeysets']()).rejects.toThrow('key fetch mismatch');
	});

	test('init fetches info once then refreshes keysets when needed', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });

		// 1) /v1/info
		reqSpy.mockResolvedValueOnce({
			// minimal shape used by MintInfo ctor
			name: 'mint',
			version: 'x',
			methods: {},
			nuts: { '22': { bat_max_mint: 7 }, '21': { client_id: 'cashu-client' } },
		});

		// 2) keysets list
		reqSpy.mockResolvedValueOnce({
			keysets: [{ id: '00k', unit: 'auth', active: true, input_fee_ppk: 0 }],
		});

		// 3) keys fetch
		reqSpy.mockResolvedValueOnce({ keysets: [makeKeys('00k')] });

		await am['init']();

		expect(am['info']).toBeTruthy();
		expect(am['activeKeysetId']).toBe('00k');
	});
});

test('getBlindAuthToken warns if endpoint is not protected', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const am = new AuthManager(mintUrl, { request: reqSpy, logger: console as any });
	am['info'] = fakeInfo({ batMax: 1, blindProtected: false });
	// make pool already have one
	am['pool'] = [{ id: 'k', C: 'C', secret: 'S', amount: 1 }];
	// init() needs keys present
	am['activeKeysetId'] = 'kset';
	am['keysById'].set('kset', makeKeys('kset'));
	am['keysets'] = [{ id: 'kset', unit: 'auth', active: true, input_fee_ppk: 0 }] as any;

	await am.getBlindAuthToken({ method: 'POST', path: '/not-protected' });
	expect(warn).toHaveBeenCalled(); // or .toHaveBeenCalledWith(...) if you want exact text
});

test('getBatMaxMint returns lower of manager maxPerMint and mint n22.bat_max_mint', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy, maxPerMint: 3 });
	am['info'] = fakeInfo({ batMax: 7 }); // mint says 7, manager says 3 → expect 3
	expect((am as any).getBatMaxMint()).toBe(3);
});

test('ensureCAT warns when refresh throws', async () => {
	const am = new AuthManager('http://mint', { request: vi.fn(), logger: console as any });
	// expired & will try refresh
	am['tokens'] = { accessToken: 'old', refreshToken: 'rr', expiresAt: Date.now() - 1 };
	am['oidc'] = { refresh: vi.fn().mockRejectedValue(new Error('nope')) } as any;
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const cat = await am.ensureCAT(30);
	expect(cat).toBe('old'); // returns whatever it has
	expect(warn).toHaveBeenCalled(); // "CAT refresh failed"
	warn.mockRestore();
});

test('ensureCAT treats token with unknown expiry as valid', async () => {
	const am = new AuthManager('http://mint', { request: vi.fn() });
	am['tokens'] = { accessToken: 'cat-without-expiry' }; // no expiresAt
	const cat = await am.ensureCAT(9999); // large minValidSecs
	expect(cat).toBe('cat-without-expiry'); // passes through
});

// expiresAt undefined => treated as valid (validForAtLeast true)
test('ensureCAT returns CAT when expiresAt is undefined', async () => {
	const am = new AuthManager('http://mint', { request: vi.fn() });
	am['tokens'] = { accessToken: 'cat-without-expiry', expiresAt: undefined };
	const cat = await am.ensureCAT(60);
	expect(cat).toBe('cat-without-expiry');
});

// warn path when endpoint isn’t blind-protected but we still issue a BAT
test('getBlindAuthToken logs warn when endpoint not protected by NUT-22', async () => {
	const req = vi.fn().mockResolvedValueOnce({
		// mint quote signatures for one BAT
		signatures: ['sig'],
	});
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const am = new AuthManager('http://mint', {
		request: req,
		desiredPoolSize: 1,
		logger: console as any,
	});

	// info that says “not protected”
	am['info'] = {
		nuts: { '22': { bat_max_mint: 1 } },
		requiresClearAuthToken: () => false,
		requiresBlindAuthToken: () => false,
	} as any;

	// seed keys so topUp works
	const keysetId = '00authkeyset0001';
	am['activeKeysetId'] = keysetId;
	am['keysets'] = [{ id: keysetId, unit: 'auth', active: true, input_fee_ppk: 0 }] as any;
	am['keysById'].set(keysetId, { id: keysetId, unit: 'auth', keys: { 1: '02deadbeef' } });
	expect(am.activeAuthKeysetId).toBeDefined();
	// stub outputs
	vi.spyOn(OutputData, 'createRandomData').mockImplementation((): any[] => [
		{
			blindedMessage: 'BM',
			toProof: () => ({ id: keysetId, C: 'C', secret: 'S', amount: 1, dleq: { e: 'e', s: 's' } }),
		},
	]);
	vi.spyOn(utils, 'hasValidDleq').mockReturnValue(true);

	const bat = await am.getBlindAuthToken({ method: 'POST', path: '/v1/swap' });
	expect(bat.startsWith('authA')).toBe(true);
	expect(warn).toHaveBeenCalledWith(
		'Endpoint is not marked as protected by NUT-22; still issuing BAT',
		expect.any(Object),
	);

	warn.mockRestore();
});
