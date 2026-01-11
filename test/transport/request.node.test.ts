import { beforeAll, test, describe, expect, afterAll, afterEach, vi } from 'vitest';
import { Wallet, HttpResponseError, NetworkError, MintOperationError } from '../../src';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { setGlobalRequestOptions } from '../../src';
import request from '../../src/transport';
import { MINTCACHE } from '../consts';
import { Nut19Policy } from '../../src/model/types';

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
		const wallet = new Wallet(mintUrl);
		wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
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

		try {
			const wallet = new Wallet(mintUrl);
			wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
			setGlobalRequestOptions({ headers: { 'x-cashu': 'xyz-123-abc' } });

			await wallet.checkMeltQuoteBolt11('test');

			expect(headers!).toBeDefined();
			expect(headers!.get('x-cashu')).toContain('xyz-123-abc');
		} finally {
			setGlobalRequestOptions({});
		}
	});

	test('handles HttpResponseError on non-200 response', async () => {
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
				return new HttpResponse(JSON.stringify({ error: 'Not Found' }), { status: 404 });
			}),
		);

		const wallet = new Wallet(mintUrl);
		wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
		await expect(wallet.checkMeltQuoteBolt11('test')).rejects.toThrowError(HttpResponseError);
	});
	test('handles NetworkError on network failure', async () => {
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
				// This simulates a network failure at the fetch level
				return Response.error();
			}),
		);

		const wallet = new Wallet(mintUrl);
		wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
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

		const wallet = new Wallet(mintUrl);
		wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
		const promise = wallet.checkMeltQuoteBolt11('test');
		await expect(promise).rejects.toThrow(MintOperationError);
		// assert that the error message is set correctly by the code
		await expect(promise).rejects.toThrow('Minting is disabled');
	});

	describe('NUT-19 Cache retry logic', () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});
		test('does not retry for non-cached endpoints', async () => {
			const endpoint = mintUrl + '/v1/mint/quote';

			let requestCount = 0;
			server.use(
				http.get(endpoint, () => {
					requestCount++;
					return Response.error();
				}),
			);

			await expect(
				request({
					endpoint,
					// no cached_endpoints specified - should not retry
				}),
			).rejects.toThrow(NetworkError);

			expect(requestCount).toBe(1);
		});

		test('retries cached endpoints on NetworkError', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const retryPolicy: Nut19Policy = {
				ttl: 10000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};
			let requestCount = 0;
			server.use(
				http.get(endpoint, () => {
					requestCount++;
					return Response.error();
				}),
			);

			await expect(
				request({
					endpoint,
					...retryPolicy,
				}),
			).rejects.toThrow(NetworkError);
			expect(requestCount).toBeGreaterThan(1); // should retry multiple times (exponential backoff)
		}, 10000);

		test('respects TTL limit during retries', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const retryPolicy: Nut19Policy = {
				ttl: 1000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};
			let requestCount = 0;
			server.use(
				http.get(endpoint, () => {
					requestCount++;
					return Response.error();
				}),
			);

			vi.spyOn(Math, 'random').mockReturnValue(1); // jitter off
			await expect(
				request({
					endpoint,
					...retryPolicy,
				}),
			).rejects.toThrow(NetworkError);
			// first request, then after 100 200 and 400ms. next one is after 800ms so it won't happen
			expect(requestCount).toBe(4);
		});

		test('does not retry on non-NetworkError (e.g., HttpResponseError)', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const retryPolicy: Nut19Policy = {
				ttl: 60000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};
			let requestCount = 0;
			server.use(
				http.get(endpoint, () => {
					requestCount++;
					return new HttpResponse(JSON.stringify({ error: 'Not Found' }), { status: 404 });
				}),
			);

			await expect(
				request({
					endpoint,
					...retryPolicy,
				}),
			).rejects.toThrow(HttpResponseError);

			expect(requestCount).toBe(1);
		});

		test('only retries endpoints with matching method', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const retryPolicy: Nut19Policy = {
				ttl: 1000,
				cached_endpoints: [{ method: 'POST', path: '/v1/keys' }],
			};

			let getRequestCount = 0;
			let postRequestCount = 0;

			server.use(
				http.get(endpoint, () => {
					getRequestCount++;
					return Response.error();
				}),
				http.post(endpoint, () => {
					postRequestCount++;
					return Response.error();
				}),
			);

			await expect(
				request({
					endpoint,
					method: 'GET',
					...retryPolicy,
				}),
			).rejects.toThrow(NetworkError);

			await expect(
				request({
					endpoint,
					method: 'POST',
					...retryPolicy,
				}),
			).rejects.toThrow(NetworkError);

			expect(getRequestCount).toBe(1);
			expect(postRequestCount).toBeGreaterThan(1);
		});

		test('succeeds after retry on cached endpoint', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const retryPolicy: Nut19Policy = {
				ttl: 60000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};

			let requestCount = 0;
			server.use(
				http.get(endpoint, () => {
					requestCount++;
					if (requestCount === 1) {
						return Response.error(); // fail only first attempt
					}
					return HttpResponse.json({ keysets: [] });
				}),
			);

			const result = await request({
				endpoint,
				...retryPolicy,
			});

			expect(requestCount).toBe(2); // failed once, succeeded on retry
			expect(result).toEqual({ keysets: [] });
		});

		test('Respects null TTL (mapped to Infinity in MintInfo)', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const retryPolicy: Nut19Policy = {
				ttl: Infinity,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};
			// reduce jitter so we can make more requests in short time
			vi.spyOn(Math, 'random').mockReturnValue(0.1);

			let requestCount = 0;
			server.use(
				http.get(endpoint, () => {
					requestCount++;
					// MAX_CACHED_RETRIES
					return Response.error();
				}),
			);

			await expect(
				request({
					endpoint,
					...retryPolicy,
				}),
			).rejects.toThrow(NetworkError);

			expect(requestCount).toBe(10);
		});

		test('Worst time scenario smaller than 7s', async () => {
			const timer = performance.now();
			const endpoint = mintUrl + '/v1/keys';

			const retryPolicy: Nut19Policy = {
				ttl: Infinity,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};
			// set jitter to 1, so we can get the longest time possible
			vi.spyOn(Math, 'random').mockReturnValue(1);

			let requestCount = 0;
			server.use(
				http.get(endpoint, () => {
					requestCount++;
					return Response.error();
				}),
			);

			await expect(
				request({
					endpoint,
					...retryPolicy,
				}),
			).rejects.toThrow(NetworkError);

			expect(requestCount).toBe(10);
			expect(performance.now() - timer).toBeLessThan(7000);
		});
	});
}, 7500);
