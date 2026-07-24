import { type Logger, NULL_LOGGER, safeCallback } from '../logger';
import {
  CTSError,
  HttpResponseError,
  NetworkError,
  MintOperationError,
  RateLimitError,
} from '../model/Errors';
import { type Nut19Policy } from '../model/types';
import { JSONInt } from '../utils/JSONInt';

/**
 * Pluggable request function used for all mint HTTP calls.
 *
 * @remarks
 * Error contract: on a mint protocol error (JSON body with `code`/`detail`), implementations must
 * throw an error `isMintOperationError` accepts, preferably this package's
 * {@link MintOperationError}, with the NUT error code preserved. Wallet behavior that branches on
 * mint error codes (eg the NUT-20 legacy signature retry) will not engage otherwise.
 */
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

/**
 * Maps a body-read failure that happened under an armed timeout or caller signal to the matching
 * abort error. The body is read via `response.text()`, which cannot be cancelled, so a timeout may
 * leave the native read still consuming the body: it is reported as {@link UncancellableReadError}
 * and not retried, or a second attempt would start another read. Returns `undefined` when neither
 * signal aborted.
 *
 * @internal
 */
function abortError(
  err: unknown,
  timeoutController: AbortController | undefined,
  requestTimeout: number | undefined,
  callerSignal: AbortSignal | undefined,
): NetworkError | undefined {
  if (timeoutController?.signal.aborted) {
    return new UncancellableReadError(`Request timed out after ${requestTimeout}ms`, {
      cause: err,
    });
  }
  if (callerSignal?.aborted) {
    return new CallerAbortError(errorMessage(err, 'Request aborted by caller'));
  }
  return undefined;
}

/**
 * Reads a response body as text, raced against `signal`.
 *
 * @remarks
 * `response.text()` alone only unblocks on abort when the transport propagates the signal to its
 * body stream (undici / browsers do, some native / React Native stacks do not). Racing the read
 * against the signal makes the request timeout and caller abort effective on every transport.
 * @internal
 */
async function readText(response: Response, signal?: AbortSignal): Promise<string> {
  // Check before calling response.text(): arguments evaluate first, so an already-aborted request
  // would otherwise start an uncancellable read before the race could notice.
  if (signal?.aborted) throw new CTSError('response body read aborted');
  const textPromise = response.text();
  if (!signal) return textPromise;
  textPromise.catch(() => undefined); // settles after we abort: keep it from going unhandled
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new CTSError('response body read aborted'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => undefined);
  try {
    return await Promise.race([textPromise, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export type RequestArgs = {
  endpoint: string;
  requestBody?: Record<string, unknown>;
  headers?: Record<string, string>;
  logger?: Logger;
};

/**
 * Metadata extracted from every HTTP response. When `onResponseMeta` is provided in
 * `RequestOptions`, the callback receives one of these on every response (both successes and
 * errors) before the promise resolves or rejects.
 */
export type ResponseMeta = {
  /**
   * The request endpoint URL. Useful for global callbacks to identify which mint the response came
   * from.
   */
  endpoint: string;
  /**
   * HTTP status code of the response.
   */
  status: number;
  /**
   * Parsed `Retry-After` in ms (via `parseRetryAfter`). Present only when the header exists and is
   * parseable.
   */
  retryAfterMs?: number;
  /**
   * Raw value of the `RateLimit` (or Cloudflare `Ratelimit`) header, if present.
   */
  rateLimit?: string;
  /**
   * Raw value of the `RateLimit-Policy` (or Cloudflare `Ratelimit-Policy`) header, if present.
   */
  rateLimitPolicy?: string;
  /**
   * Full raw response headers.
   */
  headers: Headers;
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
    /**
     * Optional callback invoked on every HTTP response with structured rate-limit metadata. Fires
     * before the promise resolves (on success) or rejects (on error), so consumers always receive
     * metadata even when the request fails.
     */
    onResponseMeta?: (meta: ResponseMeta) => void;
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

/**
 * Parses a `Retry-After` header value into milliseconds.
 *
 * Supports both forms defined in RFC 9110 §10.2.3:
 *
 * - **delta-seconds**: an integer number of seconds (e.g. `"30"` → 30 000 ms)
 * - **HTTP-date**: an IMF-fixdate string (e.g. `"Sun, 05 Apr 2026 12:00:00 GMT"`)
 *
 * Returns `undefined` when the header is `null`, empty, or unparseable. Negative delays are clamped
 * to `0`.
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;

  const header_value = header.trim();
  if (header_value === '') return undefined;

  //delta-seconds (non-negative integer)
  if (/^\d+$/.test(header_value)) {
    return Math.max(Number(header_value) * 1000, 0);
  }

  //HTTP-date (must contain at least one letter, e.g. month name / day name)
  if (/[a-zA-Z]/.test(header_value)) {
    const date = new Date(header_value).getTime();
    if (!Number.isNaN(date)) {
      return Math.max(date - Date.now(), 0);
    }
  }

  return undefined;
}

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
 * A timeout that fired while reading a response body that could not be cancelled. The underlying
 * read may still be consuming the body, so this is NOT retried: another attempt would start a
 * second uncancellable read against the same (possibly unbounded) body.
 */
class UncancellableReadError extends NetworkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UncancellableReadError';
    Object.setPrototypeOf(this, UncancellableReadError.prototype);
  }
}

/**
 * Returns true if the error warrants a retry on NUT-19 cached endpoints:
 *
 * - NetworkError: network-level failures (DNS, connection refused, AbortError/timeout)
 * - HttpResponseError with 5xx status: server-side transient errors (503, 502, etc.)
 *
 * 4xx errors (including 429 Too Many Requests) are NOT retried — they are bounced back to the
 * caller immediately. Caller aborts and uncancellable body-read timeouts are never retried.
 */
function isRetryableError(e: unknown): boolean {
  if (e instanceof CallerAbortError || e instanceof UncancellableReadError) return false;
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
    onResponseMeta,
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

  // Keep the timeout and abort wiring armed until the body is read, so requestTimeout
  // covers the whole response rather than only connecting and reading the headers.
  try {
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
        throw new NetworkError(`Request timed out after ${requestTimeout}ms`, { cause: err });
      }
      if (callerAborted) {
        throw new CallerAbortError(errorMessage(err, 'Request aborted by caller'));
      }
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw new NetworkError(err.message, { cause: err });
      }
      // A fetch() promise only rejects when the request fails,
      // for example, because of a badly-formed request URL or a network error.
      throw new NetworkError(errorMessage(err, 'Network request failed'), { cause: err });
    }

    // Parse Retry-After once for reuse in both ResponseMeta and RateLimitError
    const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));

    // Build and fire ResponseMeta callback before any throw or return
    if (onResponseMeta && response.headers) {
      const meta: ResponseMeta = {
        endpoint,
        status: response.status,
        retryAfterMs,
        rateLimit: response.headers.get('RateLimit') ?? undefined,
        rateLimitPolicy: response.headers.get('RateLimit-Policy') ?? undefined,
        headers: response.headers,
      };
      safeCallback(onResponseMeta, meta, requestLogger, {
        op: 'request.onResponseMeta',
        status: response.status,
        endpoint,
      });
    }

    if (!response.ok) {
      let errorData: ApiError;
      let errorDataCause: unknown;
      try {
        errorData = parseErrorBody(await readText(response, signal));
      } catch (err) {
        // A stalled error body is still a timeout / caller abort, not a genuine 4xx/5xx: surface
        // it as such so retry classification matches the success path.
        const aborted = abortError(err, timeoutController, requestTimeout, callerSignal);
        if (aborted) throw aborted;
        errorDataCause = err;
        errorData = { error: 'bad response' };
      }

      if (response.status === 429) {
        throw new RateLimitError('429 Too Many Requests', retryAfterMs);
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

      let httpErrorMessage = 'HTTP request failed';
      if ('error' in errorData && typeof errorData.error === 'string') {
        httpErrorMessage = errorData.error;
      } else if ('detail' in errorData && typeof errorData.detail === 'string') {
        httpErrorMessage = errorData.detail;
      }

      throw new HttpResponseError(httpErrorMessage, response.status, { cause: errorDataCause });
    }

    let responseText: string;
    try {
      responseText = await readText(response, signal);
    } catch (err) {
      // A body-read failure under an armed signal is an abort, not a bad response: classify it
      // like the fetch-level catch so cached-endpoint retry still engages on a timeout.
      const aborted = abortError(err, timeoutController, requestTimeout, callerSignal);
      if (aborted) throw aborted;
      requestLogger.error('Failed to read HTTP response', { err });
      // Keep the stable "bad response" message rather than exposing the transport error, with the
      // original error retained as cause.
      throw new HttpResponseError('bad response', response.status, { cause: err });
    }

    try {
      if (!responseText) {
        throw new CTSError('Empty response body');
      }
      return JSONInt.parse(responseText);
    } catch (err) {
      requestLogger.error('Failed to parse HTTP response', { err });
      throw new HttpResponseError('bad response', response.status, { cause: err });
    }
  } finally {
    clearTimeout(timeoutId);
    cleanupAbortListeners?.();
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
  const perRequest = options.onResponseMeta;
  const globalMeta = globalRequestOptions.onResponseMeta;
  const merged: RequestOptions = { ...options, ...globalRequestOptions };

  // Default: per-request callback only
  if (perRequest) merged.onResponseMeta = perRequest;

  // Both set: wrap in safeCallback so a throw in one doesn't prevent the other from firing.
  if (perRequest && globalMeta && perRequest !== globalMeta) {
    merged.onResponseMeta = (meta) => {
      safeCallback(perRequest, meta, requestLogger, {
        op: 'request.onResponseMeta',
        scope: 'per-request',
        endpoint: options.endpoint,
      });
      safeCallback(globalMeta, meta, requestLogger, {
        op: 'request.onResponseMeta',
        scope: 'global',
        endpoint: options.endpoint,
      });
    };
  }

  const data = await requestWithRetry(merged);
  return data as T;
}
