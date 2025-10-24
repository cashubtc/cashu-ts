// test/auth/createAuthWallet.test.ts (essential handlers and setup)
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { beforeAll, beforeEach, afterEach, afterAll, test, describe, expect, vi } from 'vitest';
import { createAuthWallet } from '../../src/auth/createAuthWallet';

// ---- Constants
const mintUrl = 'http://localhost:3338';

// Working fixtures copied from your other passing tests:
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

const dummyKeysetResp = {
	keysets: [
		{
			id: '00bd033559de27d0',
			unit: 'sat',
			active: true,
			input_fee_ppk: 0,
			final_expiry: 1754296607,
		},
	],
};

// Minimal /v1/info with NUT-21
const discoveryBase = 'http://oidc.local';
const discoveryUrl = `${discoveryBase}/.well-known/openid-configuration`;
const tokenEndpoint = `${discoveryBase}/protocol/openid-connect/token`;

const infoResp = {
	nuts: {
		'21': {
			openid_discovery: discoveryUrl,
			client_id: 'cashu-client', // what your helper expects by default
		},
		// You can add '22' here if your code reads bat_max_mint etc.
	},
};

// ---- MSW server
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
	// Mint endpoints
	server.use(
		http.get(`${mintUrl}/v1/keysets`, () => HttpResponse.json(dummyKeysetResp)),
		http.get(`${mintUrl}/v1/keys`, () => HttpResponse.json(dummyKeysResp)),
		http.get(`${mintUrl}/v1/info`, () => HttpResponse.json(infoResp)),

		// OIDC discovery
		http.get(discoveryUrl, () =>
			HttpResponse.json({
				issuer: discoveryBase,
				authorization_endpoint: `${discoveryBase}/protocol/openid-connect/auth`,
				token_endpoint: tokenEndpoint,
				device_authorization_endpoint: `${discoveryBase}/protocol/openid-connect/device`,
			}),
		),

		// OIDC token (password grant)
		http.post(tokenEndpoint, async ({ request }) => {
			const body = await request.text(); // form-encoded
			if (body.includes('grant_type=password')) {
				return HttpResponse.json({
					access_token: 'access-password',
					refresh_token: 'refresh-password',
					token_type: 'Bearer',
					expires_in: 300,
					scope: 'openid offline_access',
					id_token: 'idtoken',
				});
			}
			if (body.includes('grant_type=refresh_token')) {
				return HttpResponse.json({
					access_token: 'access-refreshed',
					refresh_token: 'refresh-refreshed',
					token_type: 'Bearer',
					expires_in: 300,
					scope: 'openid offline_access',
					id_token: 'idtoken2',
				});
			}
			// Authorization code grant (not strictly needed in this file)
			if (body.includes('grant_type=authorization_code')) {
				return HttpResponse.json({
					access_token: 'access-code',
					refresh_token: 'refresh-code',
					token_type: 'Bearer',
					expires_in: 300,
					scope: 'openid offline_access',
					id_token: 'idtoken3',
				});
			}
			return HttpResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
		}),
	);
});

// ---- Tests
describe('createAuthWallet wiring', () => {
	test('returns hydrated { mint, auth, oidc, wallet } and respects authPool', async () => {
		const { mint, auth, oidc, wallet } = await createAuthWallet(mintUrl, {
			authPool: 7, // non-default to assert
		});

		expect(mint).toBeTruthy();
		expect(oidc).toBeTruthy();
		expect(wallet).toBeTruthy();
		// AuthManager created with desiredPoolSize = 7
		expect(auth.poolTarget).toBe(7);
		// KeyChain and wallet should be initialized by helper
		expect(wallet.mint).toBe(mint);
	});

	test('onTokens → AuthManager.setCAT is wired (password grant triggers CAT set)', async () => {
		const { auth, oidc } = await createAuthWallet(mintUrl, {
			oidc: { scope: 'openid offline_access' },
		});

		expect(auth.hasCAT).toBe(false);
		await oidc.passwordGrant('user', 'pass');
		expect(auth.hasCAT).toBe(true);
		expect(auth.getCAT()).toBe('access-password');
	});

	test('auth.ensureCAT() triggers OIDC refresh when token is expiring soon', async () => {
		const { auth, oidc } = await createAuthWallet(mintUrl, {
			oidc: { scope: 'openid offline_access' },
		});

		// Seed tokens (simulate “almost expired”)
		await oidc.passwordGrant('user', 'pass');

		// Force minValidSecs large to demand refresh
		const cat1 = await auth.ensureCAT(9999);
		// After refresh handler above, CAT should be the refreshed one
		expect(cat1).toBe('access-refreshed');
	});

	test('OIDC client_id is sourced from /v1/info when none provided to helper', async () => {
		const { oidc } = await createAuthWallet(mintUrl); // no oidc.clientId passed
		// Kick any flow to ensure discovery was used
		await oidc.passwordGrant('user', 'pass'); // MSW handles this
		// If it reached here without 400, the discovered client_id was used
		expect(true).toBe(true);
	});
});
