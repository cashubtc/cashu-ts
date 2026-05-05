import { type Logger, NULL_LOGGER } from '../logger';
import { HttpResponseError, NetworkError, MintOperationError } from '../model/Errors';
import { type Nut19Policy } from '../model/types';
import { JSONInt } from '../utils/JSONInt';

// Generic request function type so callers can do requestInstance<T>(...)
export type RequestFn = <T = unknown>(args: RequestOptions) => Promise<T>;

/**
 * Subset of globalThis used by {@link detectBrowserLike}; loosened for unit tests.
 *
 * @internal
 */
export type GlobalLike = {
  window?: { document?: unknown };
  self?: unknown;
  WorkerGlobalScope?: { new (): unknown };
};

/**
 * True in browser main thread + any Worker scope (classic/module/shared/service via
 * `WorkerGlobalScope`).
 *
 * @internal
 */
export function detectBrowserLike(g: GlobalLike): boolean {
  if (g.window !== undefined && g.window.document !== undefined) return true;
  return (
    g.WorkerGlobalScope !== undefined &&
    g.self !== undefined &&
    g.self instanceof g.WorkerGlobalScope
  );
}

const IS_BROWSER_LIKE = detectBrowserLike(globalThis);

/**
 * Builds the outgoing request headers.
 *
 * @remarks
 * Overrides the default User-Agent in non-browser runtimes (Node, Deno, Bun, React Native) where
 * native HTTP stacks otherwise leak fingerprintable identifiers (undici, NSURLSession, OkHttp).
 * Skipped in browsers + workers because Firefox/WebKit can promote it to a CORS preflight even
 * though the Fetch spec lists it as a forbidden header. Caller-supplied `requestHeaders` always
 * wins.
 * @internal
 */
export function buildRequestHeaders(
  body: string | undefined,
  requestHeaders: Record<string, string> | undefined,
  isBrowserLike: boolean = IS_BROWSER_LIKE,
): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    ...(body ? { 'Content-Type': 'application/json' } : undefined),
    ...(isBrowserLike ? undefined : { 'User-Agent': 'Mozilla/5.0' }),
    ...requestHeaders,
  };
}

/**
 * Returns `err.message` when `err` is an Error, otherwise `fallback`.
 *
 * @remarks
 * Real fetch implementations always reject with an Error subclass, but `err` is typed `unknown`
 * inside `catch`, so the fallback protects against pathological polyfills.
 * @internal
 */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export type RequestArgs = {
  endpoint: string;
  requestBody?: Record<string, unknown>;
  headers?: Record<string, string>;
  logger?: Logger;
};

export type RequestOptions = RequestArgs &
  Omit<RequestInit, 'body' | 'headers'> &
  Partial<Nut19Policy> & {
    /**
     * Per-request timeout in milliseconds. If a single fetch hangs longer than this, it is aborted
     * and treated as a NetworkError (triggering retry on cached endpoints). Without this, a hung
     * connection can consume the entire TTL retry window.
     */
    requestTimeout?: number;
  };

/**
 * Cashu api error.
 *
 * - Code: Mint error code.
 * - Detail: Error message or mint-specific payload.
 * - Error: HTTP error message (non NUT-00 response)
 */
export type ApiError = {
  code?: number;
  detail?: unknown;
  error?: string;
};

let globalRequestOptions: Partial<RequestOptions> = {};
let requestLogger = NULL_LOGGER;

/**
 * An object containing any custom settings that you want to apply to the global fetch method.
 *
 * @param options See possible options here:
 *   https://developer.mozilla.org/en-US/docs/Web/API/fetch#options.
 */
export function setGlobalRequestOptions(options: Partial<RequestOptions>): void {
  globalRequestOptions = options;
}

/**
 * Allows a logger to be set.
 *
 * @param {Logger} logger The logger instance to use.
 */
export function setRequestLogger(logger: Logger): void {
  requestLogger = logger;
}

const MAX_CACHED_RETRIES = 9; // 10 requests total
const MAX_DELAY = 1000; // 1 sec
const BASE_DELAY = 100; // 100 ms

class CallerAbortError extends NetworkError {
  constructor(message: string) {
    super(message);
    this.name = 'CallerAbortError';
    Object.setPrototypeOf(this, CallerAbortError.prototype);
  }
}

/**
 * Returns true if the error warrants a retry on NUT-19 cached endpoints:
 *
 * - NetworkError: network-level failures (DNS, connection refused, AbortError/timeout)
 * - HttpResponseError with 5xx status: server-side transient errors (503, 502, etc.)
 *
 * 4xx errors (including 429 Too Many Requests) are NOT retried — they are bounced back to the
 * caller immediately.
 */
function isRetryableError(e: unknown): boolean {
  if (e instanceof CallerAbortError) return false;
  if (e instanceof NetworkError) return true;
  return e instanceof HttpResponseError && e.status >= 500;
}

function waitWithAbort(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CallerAbortError('Request aborted by caller'));
      return;
    }

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
      reject(new CallerAbortError('Request aborted by caller'));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
  });
}

function getEndpointPathnameSafe(endpoint: string): string | undefined {
  try {
    return new URL(endpoint).pathname;
  } catch {
    if (endpoint.startsWith('/')) {
      return endpoint.split(/[?#]/, 1)[0];
    }
    return undefined;
  }
}

function endpointPathMatchesCachedPath(endpointPath: string, cachedPath: string): boolean {
  if (endpointPath === cachedPath) return true;
  return endpointPath.endsWith(cachedPath);
}

/**
 * Internal function that handles retry logic for NUT-19 cached endpoints. Non-cached endpoints are
 * executed directly without retries.
 */
async function requestWithRetry(options: RequestOptions): Promise<unknown> {
  const { ttl, cached_endpoints, endpoint } = options;
  const endpointPathname = getEndpointPathnameSafe(endpoint);
  const requestMethod = options.method?.toUpperCase() ?? 'GET';

  // there should be at least one cached_endpoint, also ttl is already mapped null->Infinity
  const isCachable =
    endpointPathname !== undefined &&
    cached_endpoints?.some(
      (cached_endpoint) =>
        endpointPathMatchesCachedPath(endpointPathname, cached_endpoint.path) &&
        cached_endpoint.method === requestMethod,
    ) &&
    !!ttl;

  if (!isCachable) {
    return await _request(options);
  }

  let retries = 0;
  const startTime = Date.now();

  const retry = async (): Promise<unknown> => {
    try {
      return await _request(options);
    } catch (e) {
      if (isRetryableError(e)) {
        const totalElapsedTime = Date.now() - startTime;
        const shouldRetry = retries < MAX_CACHED_RETRIES && (!ttl || totalElapsedTime < ttl);

        if (shouldRetry) {
          const cappedDelay = Math.min(2 ** retries * BASE_DELAY, MAX_DELAY);

          const delay = Math.random() * cappedDelay;

          if (totalElapsedTime + delay > ttl) {
            requestLogger.error(`Network Error: request abandoned after ${retries} retries`, {
              e,
              retries,
            });
            throw e;
          }
          retries++;
          requestLogger.info(`Network Error: attempting retry ${retries} in ${delay}ms`, {
            e,
            retries,
            delay,
          });

          await waitWithAbort(delay, options.signal);
          return retry();
        }
      }
      requestLogger.error(`Request failed and could not be retried`, { e });
      throw e;
    }
  };
  return retry();
}

/**
 * Anti-fingerprinting: sets fetch RequestInit and privacy-hardened request headers to prevent a
 * mint from tracking clients via browser-managed state (ETags, cookies, referrer).
 *
 * **Mobile (React Native / native HTTP clients):** Mobile runtimes use platform HTTP stacks
 * (NSURLSession on iOS, OkHttp on Android) that manage their own caches independently. Mobile
 * consumers MUST disable HTTP caching at the native layer or provide a `customRequest`
 * implementation (via the Mint constructor) that uses a cache-disabled HTTP client.
 */
async function _request(options: RequestOptions): Promise<unknown> {
  const {
    endpoint,
    requestBody,
    headers: requestHeaders,
    requestTimeout,
    // consumed by requestWithRetry, excluded from raw fetch options
    cached_endpoints,
    ttl,
    logger,
    ...fetchOptions
  } = options;

  // Intentionally unused vars (extracted from fetchOptions)
  void cached_endpoints;
  void ttl;
  void logger;

  const body = requestBody ? JSONInt.stringify(requestBody) : undefined;
  const headers = buildRequestHeaders(body, requestHeaders);
  const callerSignal = options.signal ?? undefined;
  if (callerSignal?.aborted) {
    throw new CallerAbortError('Request aborted by caller');
  }

  // Construct an AbortController based on timeout, user signal, or both!
  const timeoutController = requestTimeout !== undefined ? new AbortController() : undefined;
  let signal: AbortSignal | undefined = callerSignal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let cleanupAbortListeners: (() => void) | undefined;

  if (timeoutController) {
    timeoutId = setTimeout(() => timeoutController.abort(), requestTimeout);

    if (!callerSignal) {
      signal = timeoutController.signal;
    } else {
      const combinedController = new AbortController();
      const forwardAbort = () => combinedController.abort();
      callerSignal.addEventListener('abort', forwardAbort, { once: true });
      timeoutController.signal.addEventListener('abort', forwardAbort, { once: true });
      cleanupAbortListeners = () => {
        callerSignal.removeEventListener('abort', forwardAbort);
        timeoutController.signal.removeEventListener('abort', forwardAbort);
      };
      signal = combinedController.signal;
    }
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      body,
      headers,
      // Anti-fingerprinting fetch options.
      cache: 'no-store', // prevent cache tracking (eg ETag)
      credentials: 'omit', // prevent cookie-based tracking
      referrer: '', // prevent leaking the embedding page URL
      referrerPolicy: 'no-referrer', // belt-and-braces for referrer across all contexts
      ...fetchOptions, // allows override of above options
      signal, // not overridable (includes caller signal)
    });
  } catch (err) {
    const timedOut = !!timeoutController?.signal.aborted;
    const callerAborted = !!callerSignal?.aborted;
    if (timedOut) {
      throw new NetworkError(`Request timed out after ${requestTimeout}ms`);
    }
    if (callerAborted) {
      throw new CallerAbortError(errorMessage(err, 'Request aborted by caller'));
    }
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new NetworkError(err.message);
    }
    // A fetch() promise only rejects when the request fails,
    // for example, because of a badly-formed request URL or a network error.
    throw new NetworkError(errorMessage(err, 'Network request failed'));
  } finally {
    clearTimeout(timeoutId);
    cleanupAbortListeners?.();
  }

  if (!response.ok) {
    let errorData: ApiError;
    try {
      errorData = parseErrorBody(await response.text());
    } catch {
      errorData = { error: 'bad response' };
    }

    if (
      response.status === 400 &&
      'code' in errorData &&
      typeof errorData.code === 'number' &&
      'detail' in errorData &&
      typeof errorData.detail === 'string'
    ) {
      throw new MintOperationError(errorData.code, errorData.detail);
    }

    let errorMessage = 'HTTP request failed';
    if ('error' in errorData && typeof errorData.error === 'string') {
      errorMessage = errorData.error;
    } else if ('detail' in errorData && typeof errorData.detail === 'string') {
      errorMessage = errorData.detail;
    }

    throw new HttpResponseError(errorMessage, response.status);
  }

  try {
    const responseText = await response.text();
    if (!responseText) {
      throw new Error('Empty response body');
    }
    return JSONInt.parse(responseText);
  } catch (err) {
    requestLogger.error('Failed to parse HTTP response', { err });
    throw new HttpResponseError('bad response', response.status);
  }
}

/**
 * Try extract a normalized error message.
 */
function parseErrorBody(errorText: string): ApiError {
  if (!errorText) return { detail: 'bad response' };
  let parsed: unknown;
  try {
    parsed = JSONInt.parse(errorText);
  } catch {
    return { detail: errorText };
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    ('detail' in parsed || 'code' in parsed || 'error' in parsed)
  ) {
    return parsed as ApiError;
  }
  return { detail: parsed };
}

/**
 * Performs HTTP request with exponential backoff retry for NUT-19 cached endpoints. Retries occur
 * for network errors and 5xx responses on endpoints specified in cached_endpoints. 4xx errors
 * (including 429 Too Many Requests) are not retried. Nut19Policy for a given endpoint should be
 * provided as Nut19Policy object fetched from MintInfo. Regular requests are made for non-cached
 * endpoints without retry logic.
 */
export default async function request<T>(options: RequestOptions): Promise<T> {
  const data = await requestWithRetry({ ...options, ...globalRequestOptions });
  return data as T;
}
