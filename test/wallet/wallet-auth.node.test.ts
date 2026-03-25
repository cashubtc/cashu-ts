import { HttpResponse, http } from 'msw';
import { test, describe, expect, vi } from 'vitest';
import { Wallet, Mint, AuthProvider } from '../../src';
import { mint, mintUrl, useTestServer } from './_setup';

const server = useTestServer();

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

describe('Clear Authentication', () => {
	test('handleClearAuth calls ensureCAT (not getCAT) and sends Clear-auth header', async () => {
		const mintInfo = {
			name: 'Testnut mint',
			pubkey: '02abc',
			version: 'Nutshell/x',
			contact: [],
			time: 0,
			nuts: {
				21: {
					openid_discovery: 'https://auth.example.com/.well-known/openid-configuration',
					client_id: 'cashu-client',
					protected_endpoints: [{ method: 'POST', path: '/v1/swap' }],
				},
			},
		};
		server.use(http.get(mintUrl + '/v1/info', () => HttpResponse.json(mintInfo)));

		let receivedClearAuth: string | null = null;
		server.use(
			http.post(mintUrl + '/v1/swap', async ({ request }) => {
				receivedClearAuth = request.headers.get('clear-auth');
				return HttpResponse.json({ signatures: [] });
			}),
		);
		const freshToken = 'refreshed-cat-token';
		const mockAuthProvider: AuthProvider = {
			getBlindAuthToken: vi.fn().mockResolvedValue(''),
			getCAT: vi.fn().mockReturnValue('expired-cat-token'),
			setCAT: vi.fn(),
			ensureCAT: vi.fn().mockResolvedValue(freshToken),
		};
		const mintClient = new Mint(mintUrl, { authProvider: mockAuthProvider });
		await mintClient.swap({ inputs: [], outputs: [] });

		// ensureCAT must be called — not getCAT — so refresh logic can run
		expect(mockAuthProvider.ensureCAT).toHaveBeenCalled();
		expect(mockAuthProvider.getCAT).not.toHaveBeenCalled();

		// The refreshed token must appear in the Clear-auth header
		expect(receivedClearAuth).toBe(freshToken);
	});
});
