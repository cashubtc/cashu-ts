import { beforeAll, beforeEach, test, describe, expect, afterAll, afterEach, vi } from 'vitest';
import { Wallet, HttpResponseError, NetworkError, MintOperationError } from '../../src';
import { HttpResponse, http, delay } from 'msw';
import { setupServer } from 'msw/node';
import { setGlobalRequestOptions } from '../../src';
import request, { setRequestLogger } from '../../src/transport';
import { MINTCACHE } from '../consts';
import { Nut19Policy } from '../../src';
import { NULL_LOGGER, type Logger } from '../../src/logger';

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

beforeEach(() => {
	server.use(
		http.get(mintUrl + '/v1/info', () => {
			return HttpResponse.json(MINTCACHE.mintInfo);
		}),
	);
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
					unit: 'sat',
					expiry: 9999999999,
					request: 'bolt11invoice...',
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
					unit: 'sat',
					expiry: 9999999999,
					request: 'bolt11invoice...',
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

		test('handles relative endpoints with normal request behavior', async () => {
			const endpoint = '/v1/keys';
			const responseBody = { keysets: [] };
			const fetchMock = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify(responseBody), { status: 200 }));

			const result = await request<typeof responseBody>({
				endpoint,
				ttl: 1000,
				cached_endpoints: [{ method: 'GET', path: '/not-matching' }],
			});

			expect(result).toEqual(responseBody);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(fetchMock).toHaveBeenCalledWith(
				endpoint,
				expect.objectContaining({
					headers: expect.objectContaining({ Accept: 'application/json, text/plain, */*' }),
				}),
			);
		});

		test('matches relative endpoint with query and retries when path is cached', async () => {
			const endpoint = '/v1/keys?token=abc';
			const retryPolicy: Nut19Policy = {
				ttl: 1000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};

			let requestCount = 0;
			const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
				requestCount++;
				if (requestCount === 1) {
					throw new TypeError('Network request failed');
				}
				return new Response(JSON.stringify({ keysets: [] }), { status: 200 });
			});

			const result = await request({ endpoint, ...retryPolicy });

			expect(result).toEqual({ keysets: [] });
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		test('matches cached API path when endpoint includes mint URL subpath', async () => {
			const endpoint = 'https://mint.example/cashu/v1/keys';
			const retryPolicy: Nut19Policy = {
				ttl: 1000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};

			let requestCount = 0;
			const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
				requestCount++;
				if (requestCount === 1) {
					throw new TypeError('Network request failed');
				}
				return new Response(JSON.stringify({ keysets: [] }), { status: 200 });
			});

			const result = await request({ endpoint, ...retryPolicy });

			expect(result).toEqual({ keysets: [] });
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		test('skips retry matching when endpoint path cannot be derived', async () => {
			const endpoint = 'v1/keys';
			const retryPolicy: Nut19Policy = {
				ttl: 1000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};
			vi.spyOn(Math, 'random').mockReturnValue(0);
			const fetchMock = vi
				.spyOn(globalThis, 'fetch')
				.mockRejectedValue(new TypeError('Failed to parse URL from v1/keys'));

			await expect(request({ endpoint, ...retryPolicy })).rejects.toThrow(NetworkError);
			expect(fetchMock).toHaveBeenCalledTimes(1);
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

		test('includes concrete delay value in retry log message', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const retryPolicy: Nut19Policy = {
				ttl: 5000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};
			const logger: Logger = {
				error: vi.fn(),
				warn: vi.fn(),
				info: vi.fn(),
				debug: vi.fn(),
				trace: vi.fn(),
				log: vi.fn(),
			};
			let requestCount = 0;
			server.use(
				http.get(endpoint, () => {
					requestCount++;
					return Response.error();
				}),
			);

			setRequestLogger(logger);
			const mockedRandom = 0.12345;
			const expectedDelay = mockedRandom * 100;
			vi.spyOn(Math, 'random').mockReturnValue(mockedRandom);

			try {
				await expect(request({ endpoint, ...retryPolicy })).rejects.toThrow(NetworkError);
				expect(requestCount).toBeGreaterThan(1);
				expect(logger.info).toHaveBeenCalledWith(
					`Network Error: attempting retry 1 in ${expectedDelay}ms`,
					expect.objectContaining({ retries: 1, delay: expectedDelay }),
				);
			} finally {
				setRequestLogger(NULL_LOGGER);
			}
		});

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

		test('does not retry on 4xx HttpResponseError (e.g., 404 Not Found)', async () => {
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

		test('does not retry on 429 Too Many Requests', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const retryPolicy: Nut19Policy = {
				ttl: 60000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};
			let requestCount = 0;
			server.use(
				http.get(endpoint, () => {
					requestCount++;
					return new HttpResponse(JSON.stringify({ error: 'Too Many Requests' }), { status: 429 });
				}),
			);

			await expect(request({ endpoint, ...retryPolicy })).rejects.toThrow(HttpResponseError);
			expect(requestCount).toBe(1);
		});

		test('retries cached endpoints on 5xx HttpResponseError', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const retryPolicy: Nut19Policy = {
				ttl: 60000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};
			let requestCount = 0;
			server.use(
				http.get(endpoint, () => {
					requestCount++;
					if (requestCount < 3) {
						return new HttpResponse(JSON.stringify({ error: 'Service Unavailable' }), {
							status: 503,
						});
					}
					return HttpResponse.json({ keysets: [] });
				}),
			);

			const result = await request({ endpoint, ...retryPolicy });
			expect(requestCount).toBe(3);
			expect(result).toEqual({ keysets: [] });
		});

		test('aborts hung request after requestTimeout and retries', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const retryPolicy: Nut19Policy = {
				ttl: 60000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};
			let requestCount = 0;
			server.use(
				http.get(endpoint, async () => {
					requestCount++;
					if (requestCount === 1) {
						await delay(5000); // hang longer than requestTimeout
					}
					return HttpResponse.json({ keysets: [] });
				}),
			);

			const result = await request({ endpoint, ...retryPolicy, requestTimeout: 100 });
			expect(requestCount).toBe(2); // first hung + aborted, second succeeded
			expect(result).toEqual({ keysets: [] });
		}, 5000);

		test('composes requestTimeout with already-aborted external signal', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const ac = new AbortController();
			ac.abort();

			const startedAt = Date.now();
			let thrown: unknown;
			try {
				await request({ endpoint, signal: ac.signal, requestTimeout: 5000 });
			} catch (err) {
				thrown = err;
			}

			expect(thrown).toBeInstanceOf(NetworkError);
			expect((thrown as Error).message).not.toContain('Request timed out');
			expect(Date.now() - startedAt).toBeLessThan(250);
		});

		test('composes already-aborted external signal with cached retry policy', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const ac = new AbortController();
			ac.abort();
			const retryPolicy: Nut19Policy = {
				ttl: 60000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};

			let requestCount = 0;
			server.use(
				http.get(endpoint, () => {
					requestCount++;
					return HttpResponse.json({ keysets: [] });
				}),
			);

			const startedAt = Date.now();
			let thrown: unknown;
			try {
				await request({ endpoint, signal: ac.signal, requestTimeout: 5000, ...retryPolicy });
			} catch (err) {
				thrown = err;
			}

			expect(thrown).toBeInstanceOf(NetworkError);
			expect((thrown as Error).name).toBe('CallerAbortError');
			expect((thrown as Error).message).not.toContain('Request timed out');
			expect(Date.now() - startedAt).toBeLessThan(250);
			expect(requestCount).toBe(0);
		});

		test('composes requestTimeout with external signal aborted in-flight', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const ac = new AbortController();

			server.use(
				http.get(endpoint, async () => {
					await delay(5000);
					return HttpResponse.json({ keysets: [] });
				}),
			);

			setTimeout(() => ac.abort(), 25);

			let thrown: unknown;
			try {
				await request({ endpoint, signal: ac.signal, requestTimeout: 1000 });
			} catch (err) {
				thrown = err;
			}

			expect(thrown).toBeInstanceOf(NetworkError);
			expect((thrown as Error).message).not.toContain('Request timed out');
		});

		test('does not retry cached endpoint when caller aborts in-flight', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const ac = new AbortController();
			const retryPolicy: Nut19Policy = {
				ttl: 60000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};

			let requestCount = 0;
			server.use(
				http.get(endpoint, async () => {
					requestCount++;
					await delay(5000);
					return HttpResponse.json({ keysets: [] });
				}),
			);

			setTimeout(() => ac.abort(), 25);

			await expect(
				request({ endpoint, signal: ac.signal, requestTimeout: 1000, ...retryPolicy }),
			).rejects.toThrow(NetworkError);

			expect(requestCount).toBe(1);
		}, 5000);

		test('aborts retry backoff delay when caller aborts', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const ac = new AbortController();
			const retryPolicy: Nut19Policy = {
				ttl: 60000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};

			let requestCount = 0;
			vi.spyOn(Math, 'random').mockReturnValue(1); // first delay: 100ms
			vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
				requestCount++;
				throw new TypeError('Network request failed');
			});

			const startedAt = Date.now();
			const req = request({ endpoint, signal: ac.signal, ...retryPolicy });
			setTimeout(() => ac.abort(), 10);

			let thrown: unknown;
			try {
				await req;
			} catch (err) {
				thrown = err;
			}

			expect(thrown).toBeInstanceOf(NetworkError);
			expect((thrown as Error).name).toBe('CallerAbortError');
			expect(Date.now() - startedAt).toBeLessThan(90);
			expect(requestCount).toBe(1);
		});

		test('caller abort during retry backoff rejects promptly and does not schedule another attempt', async () => {
			vi.useFakeTimers();
			try {
				const endpoint = mintUrl + '/v1/keys';
				const ac = new AbortController();
				const retryPolicy: Nut19Policy = {
					ttl: 60000,
					cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
				};

				let requestCount = 0;
				vi.spyOn(Math, 'random').mockReturnValue(1); // first delay: 100ms
				vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
					requestCount++;
					throw new TypeError('Network request failed');
				});

				const req = request({ endpoint, signal: ac.signal, ...retryPolicy });
				const rejection = req.catch((err) => err);
				setTimeout(() => ac.abort(), 10);

				await vi.advanceTimersByTimeAsync(10);
				const thrown = await rejection;
				expect(thrown).toMatchObject({ name: 'CallerAbortError' });

				expect(requestCount).toBe(1);
				expect(vi.getTimerCount()).toBe(0);

				await vi.advanceTimersByTimeAsync(500);
				expect(requestCount).toBe(1);
			} finally {
				vi.useRealTimers();
			}
		});

		test('preserves caller-abort classification before fetch when signal is pre-aborted', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const ac = new AbortController();
			ac.abort();
			const retryPolicy: Nut19Policy = {
				ttl: 60000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			};

			const fetchMock = vi.spyOn(globalThis, 'fetch');

			let thrown: unknown;
			try {
				await request({ endpoint, signal: ac.signal, ...retryPolicy });
			} catch (err) {
				thrown = err;
			}

			expect(thrown).toBeInstanceOf(NetworkError);
			expect((thrown as Error).name).toBe('CallerAbortError');
			expect(fetchMock).not.toHaveBeenCalled();
		});

		test('keeps timeout abort mapped to NetworkError when both signals abort', async () => {
			const endpoint = mintUrl + '/v1/keys';
			const ac = new AbortController();
			const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
				await delay(30);
				const abortError = new Error('The operation was aborted');
				abortError.name = 'AbortError';
				throw abortError;
			});

			setTimeout(() => ac.abort(), 20);

			let thrown: unknown;
			try {
				await request({ endpoint, signal: ac.signal, requestTimeout: 10 });
			} catch (err) {
				thrown = err;
			} finally {
				fetchMock.mockRestore();
			}

			expect(thrown).toBeInstanceOf(NetworkError);
			expect((thrown as Error).message).toContain('Request timed out after 10ms');
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
