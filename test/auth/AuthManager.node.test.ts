// tests/auth/AuthManager.node.test.ts

// 1) Mock FIRST, and define everything INSIDE the factory (no outer refs)
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/wallet', () => {
	// Define a constructor-style mock to ensure `new KeyChain(...)` yields an
	// instance with `getCheapestKeyset` on it.
	const KeyChainMock = vi.fn(function (this: any, _mintUrl: string, _unit: string) {
		// Attach as instance method
		this.getCheapestKeyset = vi.fn().mockReturnValue({
			id: '00authkeyset0001',
			unit: 'auth',
			keys: { 1: '02deadbeef', 2: '03cafebabe' },
		});
	});

	return {
		KeyChain: KeyChainMock,
	};
});

// 2) Now import everything else
import * as wallet from '../../src/wallet';
import { AuthManager } from '../../src/auth/AuthManager';
import type { RequestFn } from '../../src/transport';
import type { Proof } from '../../src/model/types';
import * as utils from '../../src/utils';
import { OutputData } from '../../src/model/OutputData';

const mintUrl = 'http://mint.local';

/* --------------------------
 * Helpers
 * -------------------------- */

function decodeBAT(batHeader: string): { id: string; secret: string; C: string } {
	const base64 = batHeader.slice('authA'.length);
	const json = Buffer.from(base64, 'base64').toString('utf8');
	return JSON.parse(json);
}

function stubOutputs(n: number, keysetId = '00authkeyset0001') {
	return vi.spyOn(OutputData, 'createRandomData').mockImplementation((): any[] => {
		return Array.from({ length: n }, (_, i) => ({
			blindedMessage: `BM_${i}`,
			toProof: () => ({
				id: keysetId,
				C: `C_${i}`,
				secret: `SECRET_${i}`,
				dleq: { e: 'e', s: 's' },
				amount: 1,
			}),
		}));
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
	return {
		nuts: { '22': { bat_max_mint: batMax } },
		requiresClearAuthToken: (method: string, path: string) =>
			needCATForMint && method === 'POST' && path === '/v1/auth/blind/mint',
		requiresBlindAuthToken: () => blindProtected,
	} as any;
}

/* --------------------------
 * Per-test state
 * -------------------------- */
let reqSpy: vi.MockedFunction<RequestFn>;
let hasValidDleqSpy: vi.SpyInstance;

beforeEach(() => {
	reqSpy = vi.fn();
	hasValidDleqSpy = vi.spyOn(utils, 'hasValidDleq').mockReturnValue(true);

	const KeyChainMock = (wallet as any).KeyChain as vi.Mock;
	if (vi.isMockFunction(KeyChainMock)) KeyChainMock.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

/* --------------------------
 * CAT lifecycle
 * -------------------------- */
describe('AuthManager: CAT lifecycle', () => {
	test('setCAT/getCAT/hasCAT + clearing refresh & expiry on unset', () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });
		expect(am.getCAT()).toBeUndefined();
		expect(am.hasCAT).toBe(false);

		am.setCAT('cat-token');
		expect(am.getCAT()).toBe('cat-token');
		expect(am.hasCAT).toBe(true);

		am['tokens'].refreshToken = 'r';
		am['tokens'].expiresAt = Date.now() + 10_000;
		am.setCAT(undefined);

		expect(am.getCAT()).toBeUndefined();
		expect(am['tokens'].refreshToken).toBeUndefined();
		expect(am['tokens'].expiresAt).toBeUndefined();
	});

	test('ensureCAT returns CAT when valid, else tries refresh via attached OIDC', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });
		am['tokens'] = {
			accessToken: 'old-cat',
			refreshToken: 'rrr',
			expiresAt: Date.now() + 1_000,
		};

		const refresh = vi.fn().mockResolvedValue({
			access_token: 'new-cat',
			refresh_token: 'new-refresh',
			expires_in: 300,
		});
		am['oidc'] = { refresh } as any;

		const cat = await am.ensureCAT(30);
		expect(refresh).toHaveBeenCalledWith('rrr');
		expect(cat).toBe('new-cat');
	});

	test('ensureCAT returns possibly expired CAT if no OIDC or refresh fails', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy, logger: console as any });
		am['tokens'] = { accessToken: 'old-cat', expiresAt: Date.now() - 1000 };
		const cat = await am.ensureCAT(30);
		expect(cat).toBe('old-cat');
	});
});

test('ensureCAT warns when refresh throws', async () => {
	const am = new AuthManager('http://mint', { request: vi.fn(), logger: console as any });
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
	am['tokens'] = { accessToken: 'stale', refreshToken: 'rrr', expiresAt: Date.now() - 1 };
	const expSec = Math.floor(Date.now() / 1000) + 300;
	const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64');
	const payload = Buffer.from(JSON.stringify({ exp: expSec })).toString('base64');
	const jwt = `${header}.${payload}.sig`;
	const refresh = vi.fn().mockResolvedValue({ access_token: jwt });
	am['oidc'] = { refresh } as any;

	const cat = await am.ensureCAT(30);
	expect(cat).toBe(jwt);
	expect(refresh).toHaveBeenCalledWith('rrr');
});

test('ensureCAT treats token with unknown expiry as valid', async () => {
	const am = new AuthManager('http://mint', { request: vi.fn() });
	am['tokens'] = { accessToken: 'cat-without-expiry' };
	const cat = await am.ensureCAT(9999);
	expect(cat).toBe('cat-without-expiry');
});

test('updateFromOIDC leaves expiresAt undefined on malformed JWT', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	const bad = 'hdr.bad-base64.sig';
	am['updateFromOIDC']({ access_token: bad });
	expect(am['tokens'].expiresAt).toBeUndefined();
});

/* --------------------------
 * BAT pool minting/ensure/topUp
 * -------------------------- */
describe('AuthManager: BAT pool minting/topUp/ensure', () => {
	function seedKeychain(am: AuthManager, keysetId = '00authkeyset0001') {
		am['keychain'] = {
			getCheapestKeyset: vi.fn().mockReturnValue({
				id: keysetId,
				unit: 'auth',
				keys: { 1: '02deadbeef' },
			}),
		} as any;
	}

	test('ensure() mints up to desired target but not beyond bat_max_mint', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy, desiredPoolSize: 5, maxPerMint: 99 });
		am['info'] = fakeInfo({ batMax: 2 });
		seedKeychain(am);

		const outputsSpy = stubOutputs(2);
		reqSpy.mockResolvedValueOnce({ signatures: ['sig0', 'sig1'] });
		await am.ensure(5);

		expect(outputsSpy).toHaveBeenCalled();
		expect(am.poolSize).toBe(2);
	});

	test('topUp/end-to-end: creates proofs, validates DLEQ, pushes to pool', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });
		am['info'] = fakeInfo({ batMax: 3 });
		seedKeychain(am);

		const outputsSpy = stubOutputs(3);
		reqSpy.mockResolvedValueOnce({ signatures: ['a', 'b', 'c'] });
		await am.ensure(3);

		expect(am.poolSize).toBe(3);
		expect(outputsSpy).toHaveBeenCalledWith(3, expect.any(Object));
	});
});

/* --------------------------
 * init behaviour
 * -------------------------- */
describe('AuthManager: init fetches info then builds KeyChain via wallet mock', () => {
	test('init fetches /v1/info, keysets, keys and constructs KeyChain once', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });

		reqSpy
			.mockResolvedValueOnce({
				name: 'mint',
				version: 'x',
				methods: {},
				nuts: { '22': { bat_max_mint: 7 }, '21': { client_id: 'cashu-client' } },
			})
			.mockResolvedValueOnce({
				keysets: [{ id: '00k', unit: 'auth', active: true, input_fee_ppk: 0 }],
			})
			.mockResolvedValueOnce({
				keysets: [{ id: '00k', unit: 'auth', keys: { 1: '02aa' } }],
			});

		await am['init']();

		expect(am['info']).toBeTruthy();

		const KeyChainMock = (wallet as any).KeyChain as vi.Mock;
		expect(vi.isMockFunction(KeyChainMock)).toBe(true);
		expect(KeyChainMock).toHaveBeenCalledTimes(1);
		expect(KeyChainMock).toHaveBeenCalledWith(
			mintUrl,
			'auth',
			[{ id: '00k', unit: 'auth', active: true, input_fee_ppk: 0 }],
			[{ id: '00k', unit: 'auth', keys: { 1: '02aa' } }],
		);

		expect(am.activeAuthKeysetId).toBe('00authkeyset0001');
	});
});

/* --------------------------
 * misc guards
 * -------------------------- */
test('getBatMaxMint returns lower of manager maxPerMint and mint n22.bat_max_mint', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy, maxPerMint: 3 });
	am['info'] = fakeInfo({ batMax: 7 });
	expect(am['getBatMaxMint']()).toBe(3);
});

/* ---------- activeAuthKeysetId error path ---------- */

test('activeAuthKeysetId returns undefined when keychain.getCheapestKeyset throws', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	am['keychain'] = {
		getCheapestKeyset: vi.fn(() => {
			throw new Error('boom');
		}),
	} as any;
	expect(am.activeAuthKeysetId).toBeUndefined();
});

/* ---------- validForAtLeast: no access token ---------- */

test('ensureCAT returns undefined when no CAT and no OIDC, hitting validForAtLeast no-token path', async () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	// no tokens at all
	const cat = await am.ensureCAT(30);
	expect(cat).toBeUndefined();
});

/* ---------- updateFromOIDC early return ---------- */

test('updateFromOIDC early-returns when access_token missing', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	am['tokens'] = { accessToken: 'keep-me', refreshToken: 'r', expiresAt: 123 };
	am['updateFromOIDC']({} as any);
	expect(am.getCAT()).toBe('keep-me');
	expect(am['tokens'].refreshToken).toBe('r');
	expect(am['tokens'].expiresAt).toBe(123);
});

/* ---------- parseJwtExpSec edge cases ---------- */

test('parseJwtExpSec returns undefined when token is undefined', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	expect(am['parseJwtExpSec']()).toBeUndefined();
});

test('parseJwtExpSec returns undefined when JWT has wrong number of parts', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	expect(am['parseJwtExpSec']('abc.def')).toBeUndefined();
});

/* ---------- ensure early return when pool already sufficient ---------- */

test('ensure() returns early when pool already has >= minTokens (no network)', async () => {
	const am = new AuthManager(mintUrl, { request: reqSpy, desiredPoolSize: 10 });
	am['info'] = fakeInfo({ batMax: 10 }); // so init() short-circuits if needed later
	am['keychain'] = {
		getCheapestKeyset: vi.fn().mockReturnValue({ id: 'k', keys: { 1: '02aa' } }),
	} as any;
	am['pool'] = [{ id: 'k', C: 'C', secret: 'S', amount: 1 } as any];

	await am.ensure(1);
	// should not mint
	expect(reqSpy).not.toHaveBeenCalled();
});

/* ---------- getBlindAuthToken: success, warn, and error paths ---------- */

describe('getBlindAuthToken coverage', () => {
	test('success path: mints if needed, serialises without dleq', async () => {
		const am = new AuthManager(mintUrl, {
			request: reqSpy,
			desiredPoolSize: 1,
			logger: console as any,
		});
		am['info'] = fakeInfo({ batMax: 1, blindProtected: true });
		am['keychain'] = {
			getCheapestKeyset: vi
				.fn()
				.mockReturnValue({ id: '00authkeyset0001', unit: 'auth', keys: { 1: '02aa' } }),
		} as any;

		stubOutputs(1);
		reqSpy.mockResolvedValueOnce({ signatures: ['sig'] });

		const bat = await am.getBlindAuthToken({ method: 'POST', path: '/v1/swap' });
		const parsed = decodeBAT(bat);
		expect(parsed).toEqual({ id: '00authkeyset0001', secret: 'SECRET_0', C: 'C_0' });
	});

	test('warn path: endpoint not protected by NUT-22', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const am = new AuthManager(mintUrl, {
			request: reqSpy,
			desiredPoolSize: 1,
			logger: console as any,
		});
		am['info'] = fakeInfo({ batMax: 1, blindProtected: false });
		am['keychain'] = {
			getCheapestKeyset: vi.fn().mockReturnValue({ id: 'k', unit: 'auth', keys: { 1: '02aa' } }),
		} as any;

		// seed pool to avoid mint
		am['pool'] = [{ id: 'k', C: 'C', secret: 'S', amount: 1 } as any];
		await am.getBlindAuthToken({ method: 'POST', path: '/not-protected' });
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	test('error path: ensure completes but pool remains empty', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });
		am['info'] = fakeInfo({ batMax: 1, blindProtected: true });
		am['keychain'] = {
			getCheapestKeyset: vi.fn().mockReturnValue({ id: 'k', keys: { 1: '02aa' } }),
		} as any;

		const ensureSpy = vi.spyOn(am as any, 'ensure').mockResolvedValue(undefined);
		await expect(am.getBlindAuthToken({ method: 'POST', path: '/v1/anything' })).rejects.toThrow(
			'AuthManager: no BATs available and minting failed',
		);
		expect(ensureSpy).toHaveBeenCalledWith(1);
		ensureSpy.mockRestore();
	});
});

/* ---------- importPool / exportPool ---------- */

test('importPool dedupes by secret and exportPool deep-copies and preserves missing dleq', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });

	const a: Proof = { id: 'k', C: 'C1', secret: 'S', dleq: { e: 'e1', s: 's1' }, amount: 1 };
	const b: Proof = { id: 'k', C: 'C2', secret: 'S', dleq: { e: 'e2', s: 's2' }, amount: 1 }; // dup secret
	const c: Proof = { id: 'k', C: 'C3', secret: 'T', amount: 1 } as any; // no dleq

	am.importPool([a, b, c], 'replace');
	const snap = am.exportPool();
	expect(snap).toHaveLength(2);
	expect(snap.find((p) => p.secret === 'T')!.dleq).toBeUndefined();

	// deep copy check
	snap[0].secret = 'mut';
	const snap2 = am.exportPool();
	expect(snap2[0].secret).not.toBe('mut');
});

/* ---------- topUp error branches ---------- */

describe('topUp error branches', () => {
	test('requires CAT when mint endpoint is Clear-auth protected', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });
		am['info'] = fakeInfo({ batMax: 1, needCATForMint: true });
		am['keychain'] = {
			getCheapestKeyset: vi.fn().mockReturnValue({ id: 'k', keys: { 1: '02aa' } }),
		} as any;

		stubOutputs(1);
		await expect(am.ensure(1)).rejects.toThrow('Clear-auth token required');
	});

	test('throws on bad BAT mint response length', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });
		am['info'] = fakeInfo({ batMax: 1 });
		am['keychain'] = {
			getCheapestKeyset: vi.fn().mockReturnValue({ id: 'k', keys: { 1: '02aa' } }),
		} as any;

		stubOutputs(1);
		reqSpy.mockResolvedValueOnce({ signatures: [] });
		await expect(am.ensure(1)).rejects.toThrow('bad BAT mint response');
	});

	test('throws when DLEQ is invalid', async () => {
		const am = new AuthManager(mintUrl, { request: reqSpy });
		am['info'] = fakeInfo({ batMax: 1 });
		am['keychain'] = {
			getCheapestKeyset: vi.fn().mockReturnValue({ id: 'k', keys: { 1: '02aa' } }),
		} as any;

		stubOutputs(1);
		hasValidDleqSpy.mockReturnValue(false);
		reqSpy.mockResolvedValueOnce({ signatures: ['sig'] });

		await expect(am.ensure(1)).rejects.toThrow('invalid DLEQ');
	});
});

/* ---------- getBatMaxMint & getActiveKeys guards ---------- */

test('getBatMaxMint throws if mint info not loaded', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	// @ts-expect-error privat
	expect(() => am['getBatMaxMint']()).toThrow('mint info not loaded');
});

test('getActiveKeys throws if keychain not initialised', () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	expect(() => am['getActiveKeys']()).toThrow('keyset not loaded');
});

/* ---------- withLock via concurrent getBlindAuthToken ---------- */

test('withLock serialises concurrent BAT pops', async () => {
	const am = new AuthManager(mintUrl, { request: reqSpy, logger: console as any });
	am['info'] = fakeInfo({ batMax: 1, blindProtected: true });
	am['keychain'] = {
		getCheapestKeyset: vi.fn().mockReturnValue({ id: 'k', keys: { 1: '02aa' } }),
	} as any;

	// seed pool with two
	am['pool'] = [
		{ id: 'k', C: 'C1', secret: 'S1', amount: 1 } as any,
		{ id: 'k', C: 'C2', secret: 'S2', amount: 1 } as any,
	];

	const [b1, b2] = await Promise.all([
		am.getBlindAuthToken({ method: 'POST', path: '/x' }),
		am.getBlindAuthToken({ method: 'POST', path: '/x' }),
	]);

	const s1 = decodeBAT(b1).secret;
	const s2 = decodeBAT(b2).secret;
	expect(s1).not.toBe(s2);
	expect(am.poolSize).toBe(0);
});

test('topUp sets Clear-auth header when mint endpoint requires CAT', async () => {
	const am = new AuthManager(mintUrl, { request: reqSpy });
	// Mint requires CAT on /v1/auth/blind/mint
	am['info'] = (function () {
		return {
			nuts: { '22': { bat_max_mint: 1 } },
			requiresClearAuthToken: (m: string, p: string) => m === 'POST' && p === '/v1/auth/blind/mint',
			requiresBlindAuthToken: () => true,
		} as any;
	})();

	// Keychain stub
	am['keychain'] = {
		getCheapestKeyset: vi.fn().mockReturnValue({
			id: 'k',
			unit: 'auth',
			keys: { 1: '02aa' },
		}),
	} as any;

	// Have a valid CAT available so ensureCAT succeeds
	am['tokens'] = { accessToken: 'cat123' }; // no expiresAt means treated as valid

	// Mint one BAT
	vi.spyOn(OutputData, 'createRandomData').mockImplementation((): any[] => [
		{
			blindedMessage: 'BM',
			toProof: () => ({
				id: 'k',
				C: 'C',
				secret: 'S',
				amount: 1,
				dleq: { e: 'e', s: 's' },
			}),
		},
	]);
	vi.spyOn(utils, 'hasValidDleq').mockReturnValue(true);
	reqSpy.mockResolvedValueOnce({ signatures: ['sig'] });

	await am.ensure(1);

	// Assert the Clear-auth header was set
	expect(reqSpy).toHaveBeenCalledTimes(1);
	const callArg = reqSpy.mock.calls[0][0] as any;
	expect(callArg.endpoint).toBe('http://mint.local/v1/auth/blind/mint');
	expect(callArg.method).toBe('POST');
	expect(callArg.headers?.['Clear-auth']).toBe('cat123');
});
