import { beforeAll, beforeEach, test, describe, expect, afterAll, afterEach } from 'vitest';
import { CashuMint } from '../src/CashuMint.js';
import { CashuWallet } from '../src/CashuWallet.js';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { setGlobalRequestOptions } from '../src/request.js';

const mintUrl = 'https://localhost:3338';
const unit = 'sats';

const server = setupServer();

beforeAll(() => {
	server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
	server.resetHandlers();
});

afterAll(() => {
	server.close();
});

describe('requests', () => {
	test('request with body contains the correct headers', async () => {
		const mint = new CashuMint(mintUrl);
		let headers: Headers;

		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', ({ request }) => {
				headers = request.headers;
				return HttpResponse.json({
					quote: 'test_melt_quote_id',
					amount: 2000,
					fee_reserve: 20,
					payment_preimage: null,
					state: 'UNPAID'
				});
			})
		);
		const wallet = new CashuWallet(mint, { unit });
		await wallet.checkMeltQuote('test');

		expect(headers!).toBeDefined();
		// expect(request!['content-type']).toContain('application/json');
		expect(headers!.get('accept')).toContain('application/json, text/plain, */*');
	});
	test('global custom headers can be set', async () => {
		let headers: Headers;
		const mint = new CashuMint(mintUrl);
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', ({ request }) => {
				headers = request.headers;
				return HttpResponse.json({
					quote: 'test_melt_quote_id',
					amount: 2000,
					fee_reserve: 20,
					payment_preimage: null,
					state: 'UNPAID'
				});
			})
		);

		const wallet = new CashuWallet(mint, { unit });
		setGlobalRequestOptions({ headers: { 'x-cashu': 'xyz-123-abc' } });

		await wallet.checkMeltQuote('test');

		expect(headers!).toBeDefined();
		expect(headers!.get('x-cashu')).toContain('xyz-123-abc');
	});
});
