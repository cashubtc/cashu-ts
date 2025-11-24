import { beforeAll, test, describe, expect, afterAll, afterEach } from 'vitest';
import { Wallet, HttpResponseError, NetworkError, MintOperationError } from '../../src';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { setGlobalRequestOptions } from '../../src/transport';
import { MINTCACHE } from '../consts';

// Setup mint cache for loadMint()
const mintUrl = 'https://localhost:3338';
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
		let headers: Headers;

		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', ({ request }) => {
				headers = request.headers;
				return HttpResponse.json({
					quote: 'test_melt_quote_id',
					amount: 2000,
					fee_reserve: 20,
					payment_preimage: null,
					state: 'UNPAID',
				});
			}),
		);
		const wallet = new Wallet(mintUrl, MINTCACHE);
		await wallet.loadMint();
		await wallet.checkMeltQuoteBolt11('test');

		expect(headers!).toBeDefined();
		// expect(request!['content-type']).toContain('application/json');
		expect(headers!.get('accept')).toContain('application/json, text/plain, */*');
	});

	test('global custom headers can be set', async () => {
		let headers: Headers;
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', ({ request }) => {
				headers = request.headers;
				return HttpResponse.json({
					quote: 'test_melt_quote_id',
					amount: 2000,
					fee_reserve: 20,
					payment_preimage: null,
					state: 'UNPAID',
				});
			}),
		);

		const wallet = new Wallet(mintUrl, MINTCACHE);
		await wallet.loadMint();
		setGlobalRequestOptions({ headers: { 'x-cashu': 'xyz-123-abc' } });

		await wallet.checkMeltQuoteBolt11('test');

		expect(headers!).toBeDefined();
		expect(headers!.get('x-cashu')).toContain('xyz-123-abc');
	});

	test('handles HttpResponseError on non-200 response', async () => {
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
				return new HttpResponse(JSON.stringify({ error: 'Not Found' }), { status: 404 });
			}),
		);

		const wallet = new Wallet(mintUrl, MINTCACHE);
		await wallet.loadMint();
		await expect(wallet.checkMeltQuoteBolt11('test')).rejects.toThrowError(HttpResponseError);
	});
	test('handles NetworkError on network failure', async () => {
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
				// This simulates a network failure at the fetch level
				return Response.error();
			}),
		);

		const wallet = new Wallet(mintUrl, MINTCACHE);
		await wallet.loadMint();
		await expect(wallet.checkMeltQuoteBolt11('test')).rejects.toThrow(NetworkError);
	});

	test('handles MintOperationError on 400 response with code and detail', async () => {
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
				return new HttpResponse(JSON.stringify({ code: 20003, detail: 'Minting is disabled' }), {
					status: 400,
				});
			}),
		);

		const wallet = new Wallet(mintUrl, MINTCACHE);
		await wallet.loadMint();
		const promise = wallet.checkMeltQuoteBolt11('test');
		await expect(promise).rejects.toThrow(MintOperationError);
		// assert that the error message is set correctly by the code
		await expect(promise).rejects.toThrow('Minting is disabled');
	});
});
