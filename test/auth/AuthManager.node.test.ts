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
	expect(cat).toBeUndefined();
	expect(warn).toHaveBeenCalled();
	warn.mockRestore();
});

test('ensureCAT sets expiresAt from JWT exp when expires_in is missing', async () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	// Force a refresh path
	am['tokens'] = {
		accessToken: 'stale',
		refreshToken: 'rrr',
		expiresAt: Date.now() - 1, // expired
	};
	// Build a simple JWT with an exp 5 minutes in the future
	const expSec = Math.floor(Date.now() / 1000) + 300;
	const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64');
	const payload = Buffer.from(JSON.stringify({ exp: expSec })).toString('base64');
	const jwt = `${header}.${payload}.sig`;
	// OIDC returns access_token without expires_in to trigger the JWT-exp fallback
	const refresh = vi.fn().mockResolvedValue({
		access_token: jwt,
		// no expires_in
	});
	am['oidc'] = { refresh } as any;
	const cat = await am.ensureCAT(30);
	// We used the refreshed token
	expect(cat).toBe(jwt);
	expect(refresh).toHaveBeenCalledWith('rrr');
	// And expiresAt was populated from JWT exp (± a tiny tolerance for timing)
	const expiresAt = am['tokens'].expiresAt!;
	expect(typeof expiresAt).toBe('number');
	expect(Math.abs(expiresAt - expSec * 1000)).toBeLessThan(50); // 50 ms slack
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

test('updateFromOIDC leaves expiresAt undefined on malformed JWT', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	// Access token with bad payload part
	const bad = 'hdr.bad-base64.sig';
	// drive through updateFromOIDC
	am['updateFromOIDC']({ access_token: bad });
	expect(am['tokens'].expiresAt).toBeUndefined();
});

test('getBlindAuthToken throws when ensure returns but pool stays empty', async () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	// Minimal info to skip the “not protected” warn path
	am['info'] = fakeInfo({ batMax: 1, blindProtected: true });
	// Ensure pool is empty
	expect(am.poolSize).toBe(0);
	// Stub ensure to succeed without minting anything
	const ensureSpy = vi.spyOn(am as any, 'ensure').mockResolvedValue(undefined);
	await expect(am.getBlindAuthToken({ method: 'POST', path: '/v1/anything' })).rejects.toThrow(
		'AuthManager: no BATs available and minting failed',
	);
	expect(ensureSpy).toHaveBeenCalledWith(1);
	ensureSpy.mockRestore();
});

// --- Branch: withLock finaliser when a later lock supersedes the current one (line 296) ---
test('withLock does not clear a newer lock when superseded by another call', async () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	// Call the private withLock twice so the second call installs a newer lock before the first finishes.
	const first = (am as any).withLock(async () => {
		// small delay so the second call has time to run and set a new lockChain
		await new Promise((r) => setTimeout(r, 10));
	});
	const second = (am as any).withLock(async () => {
		/* no-op */
	});
	await Promise.all([first, second]);
	// After both complete, lockChain should be cleared by the last finisher.
	expect((am as any).lockChain).toBeUndefined();
});

// --- Branch: parseJwtExpSec catch + logger.warn (lines 320-322) ---
test('parseJwtExpSec logs a warn when JWT payload is malformed', () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const am = new AuthManager(mintUrl, { request: reqSpy, logger: console as any });
	// Drive via updateFromOIDC to hit the catch path
	(am as any).updateFromOIDC({ access_token: 'hdr.bad-base64.sig' });
	expect(warn).toHaveBeenCalledWith('JWT access token was malformed.', expect.any(Object));
	warn.mockRestore();
});

// --- Branch: getBatMaxMint throws when info missing (line 341) ---
test('getBatMaxMint throws when mint info not loaded', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	expect(() => (am as any).getBatMaxMint()).toThrow('mint info not loaded');
});

// --- Branch: topUp includes Clear-auth header when CAT is required (lines 360-362) ---
test('topUp sets Clear-auth header when /v1/auth/blind/mint requires CAT', async () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	// Mint requires CAT
	am['info'] = ((): any => fakeInfo({ batMax: 1, needCATForMint: true }))();
	// Valid CAT available so ensureCAT() will return it
	am['tokens'] = { accessToken: 'CAT', expiresAt: Date.now() + 60_000 };
	// Seed keys
	const keysetId = '00authkeyset0001';
	am['activeKeysetId'] = keysetId;
	am['keysById'].set(keysetId, makeKeys(keysetId));
	am['keysets'] = [{ id: keysetId, unit: 'auth', active: true, input_fee_ppk: 0 }] as any;
	// Stub outputs and mint response
	stubOutputs(1);
	reqSpy.mockResolvedValueOnce({ signatures: ['sig'] });
	await am.ensure(1);
	const call = reqSpy.mock.calls[0][0];
	expect(call.endpoint).toContain('/v1/auth/blind/mint');
	expect(call.method).toBe('POST');
	expect(call.headers?.['Clear-auth']).toBe('CAT');
});

// --- Branch: getActiveKeys throws for missing active keyset id (line 370 first throw) ---
test('getActiveKeys throws when active keyset not set', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	expect(() => (am as any).getActiveKeys()).toThrow('active keyset not set');
});

// --- Branch: getActiveKeys throws for missing keys on the active keyset (line 370 second throw) ---
test('getActiveKeys throws when keys for active keyset are not loaded', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	am['activeKeysetId'] = 'k';
	expect(() => (am as any).getActiveKeys()).toThrow('keys not loaded for active keyset');
});

// --- Branch: topUp throws when info not loaded (line 389) ---
test('topUp throws when called without mint info', async () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	// Call the private method directly to avoid init() setting info
	await expect((am as any).topUp(1)).rejects.toThrow('mint info not loaded');
});

// --- updateFromOIDC: early return when no access_token (line 162) ---
test('updateFromOIDC ignores updates when access_token is missing', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	// seed some state to prove it doesn't change
	am['tokens'] = { accessToken: 'keep-cat', refreshToken: 'keep-rr', expiresAt: 1111 };
	(am as any)['updateFromOIDC']({
		/* no access_token */
	});
	expect(am.getCAT()).toBe('keep-cat');
	expect(am['tokens'].refreshToken).toBe('keep-rr');
	expect(am['tokens'].expiresAt).toBe(1111);
});

// --- ensureCAT: no access token and no OIDC => returns undefined (covers validForAtLeast no-token path ~ line 191) ---
test('ensureCAT returns undefined when no CAT is set and no OIDC refresh is possible', async () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	am['tokens'] = {}; // no accessToken, no refreshToken
	const cat = await am.ensureCAT(30);
	expect(cat).toBeUndefined();
});

// --- importPool: ignores malformed entries via shape check (lines 241, 253) ---
test('importPool ignores malformed proofs (missing id/secret/C)', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	// malformed entries mixed with one valid
	const bad1 = {} as any;
	const bad2 = { id: 'k', C: 'C', amount: 1 } as any; // missing secret
	const bad3 = { id: 'k', secret: 'S', amount: 1 } as any; // missing C
	const good: Proof = { id: 'k', C: 'C1', secret: 'S1', amount: 1, dleq: { e: 'e', s: 's' } };
	am.importPool([bad1, bad2, bad3, good], 'replace');
	expect(am.poolSize).toBe(1);
	const snap = am.exportPool();
	expect(snap[0]).toMatchObject({ id: 'k', C: 'C1', secret: 'S1' });
});

// --- parseJwtExpSec: early return on non-JWT string (lines 264-270) ---
test('parseJwtExpSec returns undefined for non-JWT strings (early return)', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	expect((am as any).parseJwtExpSec('not-a-jwt')).toBeUndefined();
});

// --- getBatMaxMint: falls back to maxPerMint when nuts["22"] or bat_max_mint missing (line 323) ---
test('getBatMaxMint falls back to manager maxPerMint when n22 or bat_max_mint is missing', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy, maxPerMint: 5 });
	// info present but no nuts['22'] (or missing bat_max_mint)
	am['info'] = {
		nuts: {}, // no '22'
		requiresClearAuthToken: () => false,
		requiresBlindAuthToken: () => true,
	} as any;
	expect((am as any).getBatMaxMint()).toBe(5);
});

// --- init: skips refreshKeysets when keysets already present and activeKeysetId set (line 342 branch) ---
test('init skips refreshKeysets when keysets are present and activeKeysetId is set', async () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	// Provide minimal info so init() does not fetch it again
	am['info'] = {
		nuts: { '22': { bat_max_mint: 1 } },
		requiresClearAuthToken: () => false,
		requiresBlindAuthToken: () => true,
	} as any;
	// Seed keysets and active keyset so the second branch of init() short-circuits
	const keysetId = '00authkeyset0001';
	am['activeKeysetId'] = keysetId;
	am['keysets'] = [{ id: keysetId, unit: 'auth', active: true, input_fee_ppk: 0 }] as any;
	am['keysById'].set(keysetId, { id: keysetId, unit: 'auth', keys: { 1: '02deadbeef' } });
	const rk = vi.spyOn(am as any, 'refreshKeysets');
	await (am as any).init();
	expect(rk).not.toHaveBeenCalled(); // branch: skip refreshKeysets
});

test('constructor clamps desiredPoolSize and maxPerMint to at least 1', () => {
	const am = new AuthManager(mintUrl, { desiredPoolSize: 0, maxPerMint: 0 });
	expect(am['desiredPoolSize']).toBe(1);
	expect(am['maxPerMint']).toBe(1);
});

test('validForAtLeast returns false when no access token is set', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	am['tokens'] = {}; // no token at all
	expect((am as any).validForAtLeast(30)).toBe(false);
});

test('importPool skips duplicate proofs with same secret', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	const p1: Proof = { id: 'a', C: 'C1', secret: 'SAME', amount: 1, dleq: { e: 'e', s: 's' } };
	const p2: Proof = { id: 'b', C: 'C2', secret: 'SAME', amount: 1, dleq: { e: 'e', s: 's' } };
	am.importPool([p1], 'replace');
	am.importPool([p2], 'merge'); // duplicate should be ignored
	expect(am.poolSize).toBe(1);
});

test('parseJwtExpSec returns undefined when token is undefined', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	expect((am as any).parseJwtExpSec(undefined)).toBeUndefined();
});

test('parseJwtExpSec returns undefined when token has wrong number of parts', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	expect((am as any).parseJwtExpSec('one.two')).toBeUndefined();
});

test('ensure returns early when batch <= 0', async () => {
	const am = new AuthManager(mintUrl, { request: reqSpy, desiredPoolSize: 2, maxPerMint: 5 });
	// Preload minimal info so init() won’t call refreshKeysets()
	am['info'] = {
		nuts: { '22': { bat_max_mint: 10 } },
		requiresClearAuthToken: () => false,
		requiresBlindAuthToken: () => true,
	} as any;

	// Also seed fake keysets so init() is fully satisfied
	am['activeKeysetId'] = '00authkeyset0001';
	am['keysets'] = [{ id: '00authkeyset0001', unit: 'auth', active: true, input_fee_ppk: 0 }] as any;
	am['keysById'].set('00authkeyset0001', makeKeys('00authkeyset0001'));

	// pool already full => batch <= 0
	am['pool'] = [
		{ id: 'k', C: 'C1', secret: 'S1', amount: 1 },
		{ id: 'k', C: 'C2', secret: 'S2', amount: 1 },
	];
	const topUpSpy = vi.spyOn(am as any, 'topUp');
	await am.ensure(1); // should early-return without calling topUp
	expect(topUpSpy).not.toHaveBeenCalled();
});

test('exportPool returns proofs with undefined dleq when none present', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	am['pool'] = [{ id: 'x', C: 'Cx', secret: 'Sx', amount: 1 } as any]; // no dleq field
	const snap = am.exportPool();
	expect(snap[0].dleq).toBeUndefined();
});

test('parseJwtExpSec handles numeric exp encoded as string', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	const exp = Math.floor(Date.now() / 1000) + 100;
	const payload = Buffer.from(JSON.stringify({ exp: String(exp) })).toString('base64');
	const jwt = `hdr.${payload}.sig`;
	const result = (am as any).parseJwtExpSec(jwt);
	expect(result).toBe(exp);
});
