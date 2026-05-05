import { beforeAll, beforeEach, test, describe, expect, afterAll, afterEach, vi } from 'vitest';
import {
  Wallet,
  HttpResponseError,
  NetworkError,
  MintOperationError,
  RateLimitError,
  type ResponseMeta,
} from '../../src';
import { HttpResponse, http, delay } from 'msw';
import { setupServer } from 'msw/node';
import { setGlobalRequestOptions } from '../../src';
import request, { setRequestLogger } from '../../src/transport';
import {
  parseRetryAfter,
  detectBrowserLike,
  buildRequestHeaders,
  errorMessage,
} from '../../src/transport/request';
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
  setRequestLogger(NULL_LOGGER);
  setGlobalRequestOptions({});
});

afterAll(() => {
  server.close();
  setRequestLogger(NULL_LOGGER);
  setGlobalRequestOptions({});
});

beforeEach(() => {
  server.use(
    http.get(mintUrl + '/v1/info', () => {
      return HttpResponse.json(MINTCACHE.mintInfo);
    }),
  );
});

describe('requests', { timeout: 7500 }, () => {
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
    await expect(wallet.checkMeltQuoteBolt11('test')).rejects.toThrow(HttpResponseError);
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

  test('uses raw text response as HttpResponseError message', async () => {
    server.use(
      http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
        return new HttpResponse('plain text failure', { status: 404 });
      }),
    );

    const wallet = new Wallet(mintUrl);
    wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
    await expect(wallet.checkMeltQuoteBolt11('test')).rejects.toThrow('plain text failure');
  });

  test('uses string detail field as HttpResponseError message', async () => {
    server.use(
      http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
        return new HttpResponse(JSON.stringify({ detail: 'mint detail error' }), { status: 404 });
      }),
    );

    const wallet = new Wallet(mintUrl);
    wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
    await expect(wallet.checkMeltQuoteBolt11('test')).rejects.toThrow('mint detail error');
  });

  test('uses primitive JSON error body as HttpResponseError message', async () => {
    server.use(
      http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
        return new HttpResponse(JSON.stringify('primitive failure'), { status: 404 });
      }),
    );

    const wallet = new Wallet(mintUrl);
    wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
    await expect(wallet.checkMeltQuoteBolt11('test')).rejects.toThrow('primitive failure');
  });

  test('maps empty error response body to bad response', async () => {
    server.use(
      http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
        return new HttpResponse('', { status: 400 });
      }),
    );

    const wallet = new Wallet(mintUrl);
    wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
    await expect(wallet.checkMeltQuoteBolt11('test')).rejects.toThrow('bad response');
  });

  test('maps empty success response body to bad response', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return new HttpResponse('', { status: 200 });
      }),
    );

    await expect(request({ endpoint })).rejects.toThrow(new HttpResponseError('bad response', 200));
  });

  test('maps malformed success JSON to bad response and logs parsing failure', async () => {
    const endpoint = mintUrl + '/v1/keys';
    const logger: Logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      log: vi.fn(),
    };

    server.use(
      http.get(endpoint, () => {
        return new HttpResponse('{not-valid-json', { status: 200 });
      }),
    );

    setRequestLogger(logger);
    try {
      await expect(request({ endpoint })).rejects.toThrow('bad response');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to parse HTTP response',
        expect.objectContaining({ err: expect.any(Error) }),
      );
    } finally {
      setRequestLogger(NULL_LOGGER);
    }
  });

  test('maps AbortError fetch failures to NetworkError without timeout policy', async () => {
    const endpoint = mintUrl + '/v1/keys';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const abortError = new Error('aborted by runtime');
      abortError.name = 'AbortError';
      throw abortError;
    });

    try {
      await expect(request({ endpoint })).rejects.toThrow('aborted by runtime');
    } finally {
      fetchMock.mockRestore();
    }
  });

  test('falls back to bad response when reading error body throws', async () => {
    const endpoint = mintUrl + '/v1/keys';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers(),
      text: vi.fn(async () => {
        throw new Error('body read failed');
      }),
    } as unknown as Response);

    try {
      await expect(request({ endpoint })).rejects.toThrow('bad response');
    } finally {
      fetchMock.mockRestore();
    }
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

      await expect(request({ endpoint, ...retryPolicy })).rejects.toThrow(RateLimitError);
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

    test('handles already-aborted signal before retry delay starts', async () => {
      const endpoint = mintUrl + '/v1/keys';
      const ac = new AbortController();
      const retryPolicy: Nut19Policy = {
        ttl: 60000,
        cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
      };
      const logger: Logger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(() => ac.abort()),
        debug: vi.fn(),
        trace: vi.fn(),
        log: vi.fn(),
      };

      vi.spyOn(Math, 'random').mockReturnValue(1);
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        throw new TypeError('Network request failed');
      });

      setRequestLogger(logger);
      try {
        await expect(
          request({ endpoint, signal: ac.signal, ...retryPolicy }),
        ).rejects.toMatchObject({
          name: 'CallerAbortError',
        });
      } finally {
        setRequestLogger(NULL_LOGGER);
      }
    });

    test('waits through retry delay when caller signal remains active', async () => {
      const endpoint = mintUrl + '/v1/keys';
      const ac = new AbortController();
      const retryPolicy: Nut19Policy = {
        ttl: 5000,
        cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
      };
      let requestCount = 0;

      vi.spyOn(Math, 'random').mockReturnValue(0.01);
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        requestCount++;
        if (requestCount === 1) {
          throw new TypeError('Network request failed');
        }
        return new Response(JSON.stringify({ keysets: [] }), { status: 200 });
      });

      const result = await request({ endpoint, signal: ac.signal, ...retryPolicy });
      expect(result).toEqual({ keysets: [] });
      expect(requestCount).toBe(2);
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

    test('Worst time scenario stays within the capped backoff budget', async () => {
      vi.useFakeTimers();
      try {
        const endpoint = mintUrl + '/v1/keys';

        const retryPolicy: Nut19Policy = {
          ttl: Infinity,
          cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
        };
        // Maximum jitter yields the worst-case delay sequence:
        // 100 + 200 + 400 + 800 + 1000 * 5 = 6500ms total.
        vi.spyOn(Math, 'random').mockReturnValue(1);

        let requestCount = 0;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
          requestCount++;
          throw new TypeError('Network request failed');
        });

        const req = request({
          endpoint,
          ...retryPolicy,
        });
        const rejection = req.catch((err) => err);

        await vi.advanceTimersByTimeAsync(6499);
        expect(requestCount).toBeLessThan(10);

        await vi.advanceTimersByTimeAsync(1);
        const thrown = await rejection;
        expect(thrown).toBeInstanceOf(NetworkError);
        expect(requestCount).toBe(10);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('parseRetryAfter', () => {
  test('returns undefined for null', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  test('returns undefined for empty string', () => {
    expect(parseRetryAfter('')).toBeUndefined();
  });

  test('parses delta-seconds to milliseconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });

  test('parses zero delta-seconds', () => {
    expect(parseRetryAfter('0')).toBe(0);
  });

  test('returns undefined for non-integer delta-seconds', () => {
    expect(parseRetryAfter('3.5')).toBeUndefined();
  });

  test('returns undefined for negative delta-seconds string', () => {
    // Negative values like "-1" don't match /^\d+$/ and contain no letters so bypass HTTP-date parsing too, returning undefined directly
    expect(parseRetryAfter('-1')).toBeUndefined();
  });

  test('parses HTTP-date in the future', () => {
    const futureDate = new Date(Date.now() + 60_000).toUTCString();
    const result = parseRetryAfter(futureDate);
    expect(result).toBeGreaterThan(55_000);
    expect(result).toBeLessThanOrEqual(60_000);
  });

  test('clamps HTTP-date in the past to 0', () => {
    const pastDate = new Date(Date.now() - 10_000).toUTCString();
    expect(parseRetryAfter(pastDate)).toBe(0);
  });

  test('returns undefined for garbage string', () => {
    expect(parseRetryAfter('not-a-date-or-number')).toBeUndefined();
  });
});

describe('detectBrowserLike', () => {
  test('true: browser main thread (window + document)', () => {
    expect(detectBrowserLike({ window: { document: {} } })).toBe(true);
  });

  test('true: classic worker (self instanceof WorkerGlobalScope)', () => {
    class WorkerGlobalScope {}
    const self = new WorkerGlobalScope();
    expect(detectBrowserLike({ self, WorkerGlobalScope })).toBe(true);
  });

  test('true: module worker (no importScripts, but WorkerGlobalScope present)', () => {
    // Module workers omit importScripts; the WorkerGlobalScope check still catches them.
    class WorkerGlobalScope {}
    const self = new WorkerGlobalScope();
    expect(detectBrowserLike({ self, WorkerGlobalScope })).toBe(true);
  });

  test('true: service worker (subclass of WorkerGlobalScope)', () => {
    class WorkerGlobalScope {}
    class ServiceWorkerGlobalScope extends WorkerGlobalScope {}
    const self = new ServiceWorkerGlobalScope();
    expect(detectBrowserLike({ self, WorkerGlobalScope })).toBe(true);
  });

  test('false: Node-like (no window, no WorkerGlobalScope)', () => {
    expect(detectBrowserLike({})).toBe(false);
  });

  test('false: self present but WorkerGlobalScope undefined (RN/Bun shape)', () => {
    expect(detectBrowserLike({ self: {} })).toBe(false);
  });

  test('false: window present but document undefined (partial polyfill)', () => {
    expect(detectBrowserLike({ window: {} })).toBe(false);
  });

  test('false: WorkerGlobalScope present but self is not an instance of it', () => {
    class WorkerGlobalScope {}
    expect(detectBrowserLike({ self: {}, WorkerGlobalScope })).toBe(false);
  });
});

describe('buildRequestHeaders', () => {
  test('non-browser runtimes get the Mozilla/5.0 User-Agent override', () => {
    expect(buildRequestHeaders(undefined, undefined, false)['User-Agent']).toBe('Mozilla/5.0');
  });

  test('browser-like runtimes omit the User-Agent override', () => {
    expect(buildRequestHeaders(undefined, undefined, true)['User-Agent']).toBeUndefined();
  });

  test('caller-supplied User-Agent always wins', () => {
    expect(buildRequestHeaders(undefined, { 'User-Agent': 'X' }, false)['User-Agent']).toBe('X');
    expect(buildRequestHeaders(undefined, { 'User-Agent': 'X' }, true)['User-Agent']).toBe('X');
  });

  test('Content-Type is added only when body is present', () => {
    expect(buildRequestHeaders('{"x":1}', undefined, false)['Content-Type']).toBe(
      'application/json',
    );
    expect(buildRequestHeaders(undefined, undefined, false)['Content-Type']).toBeUndefined();
  });

  test('Accept is always present', () => {
    expect(buildRequestHeaders(undefined, undefined, true).Accept).toBe(
      'application/json, text/plain, */*',
    );
  });
});

describe('errorMessage', () => {
  test('returns err.message when err is an Error', () => {
    expect(errorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  test('returns fallback when err is not an Error (string, null, undefined, plain object)', () => {
    expect(errorMessage('not an error', 'fallback')).toBe('fallback');
    expect(errorMessage(null, 'fallback')).toBe('fallback');
    expect(errorMessage(undefined, 'fallback')).toBe('fallback');
    expect(errorMessage({ message: 'looks like an error' }, 'fallback')).toBe('fallback');
  });
});

describe('RateLimitError', () => {
  test('is an instance of HttpResponseError', () => {
    const err = new RateLimitError('rate limited');
    expect(err).toBeInstanceOf(HttpResponseError);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err).toBeInstanceOf(Error);
  });

  test('has status 429', () => {
    const err = new RateLimitError('rate limited');
    expect(err.status).toBe(429);
  });

  test('has name RateLimitError', () => {
    const err = new RateLimitError('rate limited');
    expect(err.name).toBe('RateLimitError');
  });

  test('stores retryAfterMs when provided', () => {
    const err = new RateLimitError('rate limited', 5000);
    expect(err.retryAfterMs).toBe(5000);
  });

  test('retryAfterMs is undefined when omitted', () => {
    const err = new RateLimitError('rate limited');
    expect(err.retryAfterMs).toBeUndefined();
  });

  test('thrown on 429 with Retry-After header parsed', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return new HttpResponse(JSON.stringify({ error: 'Too Many Requests' }), {
          status: 429,
          headers: { 'Retry-After': '60' },
        });
      }),
    );

    try {
      await request({ endpoint });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      const err = e as InstanceType<typeof RateLimitError>;
      expect(err.message).toBe('429 Too Many Requests');
      expect(err.status).toBe(429);
      expect(err.retryAfterMs).toBe(60_000);
    }
  });

  test('thrown on 429 without Retry-After header', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return new HttpResponse(JSON.stringify({ error: 'Too Many Requests' }), {
          status: 429,
        });
      }),
    );

    try {
      await request({ endpoint });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      const err = e as InstanceType<typeof RateLimitError>;
      expect(err.retryAfterMs).toBeUndefined();
    }
  });
});

describe('onResponseMeta callback', () => {
  test('fires on 200 response with full meta', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return HttpResponse.json(
          { keysets: [] },
          {
            headers: {
              RateLimit: 'limit=100, remaining=99, reset=60',
              'RateLimit-Policy': '100;w=60',
            },
          },
        );
      }),
    );

    let captured: ResponseMeta | undefined;
    await request({ endpoint, onResponseMeta: (m) => (captured = m) });

    expect(captured).toBeDefined();
    expect(captured!.endpoint).toBe(endpoint);
    expect(captured!.status).toBe(200);
    expect(captured!.rateLimit).toBe('limit=100, remaining=99, reset=60');
    expect(captured!.rateLimitPolicy).toBe('100;w=60');
    expect(captured!.retryAfterMs).toBeUndefined();
    expect(captured!.headers).toBeInstanceOf(Headers);
  });

  test('fires on 429 BEFORE RateLimitError is thrown', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return new HttpResponse(JSON.stringify({ error: 'Too Many Requests' }), {
          status: 429,
          headers: { 'Retry-After': '30' },
        });
      }),
    );

    let captured: ResponseMeta | undefined;
    try {
      await request({ endpoint, onResponseMeta: (m) => (captured = m) });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
    }
    expect(captured).toBeDefined();
    expect(captured!.endpoint).toBe(endpoint);
    expect(captured!.status).toBe(429);
    expect(captured!.retryAfterMs).toBe(30_000);
  });

  test('fires on other 4xx BEFORE HttpResponseError is thrown', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return new HttpResponse(JSON.stringify({ error: 'Not Found' }), { status: 404 });
      }),
    );

    let captured: ResponseMeta | undefined;
    try {
      await request({ endpoint, onResponseMeta: (m) => (captured = m) });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpResponseError);
    }
    expect(captured).toBeDefined();
    expect(captured!.endpoint).toBe(endpoint);
    expect(captured!.status).toBe(404);
  });

  test('fires on 5xx BEFORE HttpResponseError is thrown', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return new HttpResponse(JSON.stringify({ error: 'Internal Server Error' }), {
          status: 500,
        });
      }),
    );

    let captured: ResponseMeta | undefined;
    try {
      await request({ endpoint, onResponseMeta: (m) => (captured = m) });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpResponseError);
    }
    expect(captured).toBeDefined();
    expect(captured!.endpoint).toBe(endpoint);
    expect(captured!.status).toBe(500);
  });

  test('reads Cloudflare lowercase Ratelimit header variant', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return HttpResponse.json(
          { keysets: [] },
          {
            headers: {
              Ratelimit: 'limit=50, remaining=49, reset=30',
              'Ratelimit-Policy': '50;w=30',
            },
          },
        );
      }),
    );

    let captured: ResponseMeta | undefined;
    await request({ endpoint, onResponseMeta: (m) => (captured = m) });

    expect(captured).toBeDefined();
    expect(captured!.endpoint).toBe(endpoint);
    expect(captured!.rateLimit).toBe('limit=50, remaining=49, reset=30');
    expect(captured!.rateLimitPolicy).toBe('50;w=30');
  });

  test('no callback means no error and identical behaviour', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return HttpResponse.json({ keysets: [] });
      }),
    );

    // No onResponseMeta — should not throw
    const result = await request({ endpoint });
    expect(result).toEqual({ keysets: [] });
  });

  test('rateLimit and rateLimitPolicy are undefined when headers absent', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return HttpResponse.json({ keysets: [] });
      }),
    );

    let captured: ResponseMeta | undefined;
    await request({ endpoint, onResponseMeta: (m) => (captured = m) });

    expect(captured).toBeDefined();
    expect(captured!.endpoint).toBe(endpoint);
    expect(captured!.rateLimit).toBeUndefined();
    expect(captured!.rateLimitPolicy).toBeUndefined();
  });

  test('throwing callback is swallowed via safeCallback', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return HttpResponse.json({ keysets: [] });
      }),
    );

    const warnSpy = vi.fn();
    setRequestLogger({ ...NULL_LOGGER, warn: warnSpy });

    const result = await request({
      endpoint,
      onResponseMeta: () => {
        throw new Error('boom');
      },
    });

    setRequestLogger(NULL_LOGGER);

    expect(result).toEqual({ keysets: [] });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      'callback failed',
      expect.objectContaining({
        op: 'request.onResponseMeta',
        endpoint,
        error: expect.any(Error),
      }),
    );
  });

  test('async rejection in callback does not produce unhandled rejection', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return HttpResponse.json({ keysets: [] });
      }),
    );

    const warnSpy = vi.fn();
    setRequestLogger({ ...NULL_LOGGER, warn: warnSpy });

    const result = await request({
      endpoint,
      onResponseMeta: async () => {
        throw new Error('async boom');
      },
    });

    // Give microtask queue time to flush so the .catch handler fires
    await new Promise((r) => setTimeout(r, 10));

    setRequestLogger(NULL_LOGGER);

    expect(result).toEqual({ keysets: [] });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      'callback failed',
      expect.objectContaining({
        op: 'request.onResponseMeta',
        endpoint,
        error: expect.any(Error),
      }),
    );
  });

  test('composes per-request and global callbacks', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return HttpResponse.json({ keysets: [] });
      }),
    );

    const perRequestSpy = vi.fn();
    const globalSpy = vi.fn();

    setGlobalRequestOptions({ onResponseMeta: globalSpy });

    await request({ endpoint, onResponseMeta: perRequestSpy });

    setGlobalRequestOptions({});

    expect(perRequestSpy).toHaveBeenCalledOnce();
    expect(globalSpy).toHaveBeenCalledOnce();
    expect(perRequestSpy.mock.calls[0][0].endpoint).toBe(endpoint);
    expect(globalSpy.mock.calls[0][0].endpoint).toBe(endpoint);
  });

  test('global callback fires even when per-request callback throws sync', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return HttpResponse.json({ keysets: [] });
      }),
    );

    const globalSpy = vi.fn();
    const warnSpy = vi.fn();
    setRequestLogger({ ...NULL_LOGGER, warn: warnSpy });
    setGlobalRequestOptions({ onResponseMeta: globalSpy });

    const result = await request({
      endpoint,
      onResponseMeta: () => {
        throw new Error('per-request boom');
      },
    });

    setGlobalRequestOptions({});
    setRequestLogger(NULL_LOGGER);

    expect(result).toEqual({ keysets: [] });
    expect(globalSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      'callback failed',
      expect.objectContaining({ scope: 'per-request' }),
    );
  });

  test('global callback fires even when per-request callback rejects async', async () => {
    const endpoint = mintUrl + '/v1/keys';
    server.use(
      http.get(endpoint, () => {
        return HttpResponse.json({ keysets: [] });
      }),
    );

    const globalSpy = vi.fn();
    const warnSpy = vi.fn();
    setRequestLogger({ ...NULL_LOGGER, warn: warnSpy });
    setGlobalRequestOptions({ onResponseMeta: globalSpy });

    const result = await request({
      endpoint,
      onResponseMeta: async () => {
        throw new Error('per-request async boom');
      },
    });

    // flush microtask queue for async .catch handler
    await new Promise((r) => setTimeout(r, 10));

    setGlobalRequestOptions({});
    setRequestLogger(NULL_LOGGER);

    expect(result).toEqual({ keysets: [] });
    expect(globalSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      'callback failed',
      expect.objectContaining({ scope: 'per-request' }),
    );
  });
});
