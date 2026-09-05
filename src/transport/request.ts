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
 * mint error codes (eg the NUT-20 legacy signature retry) will not engage otherwise. A string
 * `requestBody` must be transmitted byte-verbatim: blind auth (NUT-22) signs those exact bytes, so
 * re-serializing breaks the witness. If you only need a custom transport, prefer the `requestFetch`
 * option ({@link RequestFetch}): the default pipeline then keeps this contract for you.
 */
export type RequestFn = <T = unknown>(args: RequestOptions) => Promise<T>;

/**
 * Fetch-compatible function used by the default request implementation.
 */
export type RequestFetch = typeof fetch;

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
 * Reads a response body as text, failing once it exceeds `maxBytes`.
 *
 * @remarks
 * With a readable stream (`response.body`) the read is bounded as it arrives (the cap rejects
 * before over-allocating) and an abort cancels the reader, unblocking a pending read. The fallback
 * (`response.text()`, eg React Native / custom transports with no stream) reads the whole body
 * raced against `signal`, then size-checks the decoded text, so strict pre-allocation enforcement
 * needs a streaming transport.
 * @internal
 */
export async function readBodyText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const body = response.body;
  const contentLength = Number(response.headers.get('Content-Length') ?? '');
  if (contentLength > maxBytes) {
    if (body && typeof body.cancel === 'function') {
      body.cancel().catch(() => undefined);
    }
    throw new CTSError(`response body exceeds ${maxBytes} bytes`);
  }

  if (!body || typeof body.getReader !== 'function') {
    // No stream to cancel (eg React Native): race the whole-body read against the signal once,
    // then size-check (utf8 bytes >= string length, so the cheap length check catches gross
    // oversize without re-encoding).
    if (signal?.aborted) throw new CTSError('response body read aborted');
    const text = await raceAbort(response.text(), signal);
    if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) {
      throw new CTSError(`response body exceeds ${maxBytes} bytes`);
    }
    return text;
  }

  // Wire the signal to cancel the reader once, rather than racing every read() against a
  // never-settling abort promise (which piles a reaction onto it per chunk). Cancelling unblocks a
  // pending read; real fetch streams also reject the read on abort directly.
  const reader = body.getReader();
  let aborted = false;
  let onAbort: (() => void) | undefined;
  if (signal) {
    onAbort = () => {
      aborted = true;
      reader.cancel().catch(() => undefined);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const result = await reader.read();
      if (aborted) throw new CTSError('response body read aborted');
      if (result.done) break;
      received += result.value.byteLength;
      if (received > maxBytes) {
        throw new CTSError(`response body exceeds ${maxBytes} bytes`);
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8').decode(bytes);
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    reader.cancel().catch(() => undefined); // release the connection; no-op if already closed
  }
}

/**
 * Awaits `promise`, rejecting early if `signal` aborts. For whole-body reads that cannot be
 * cancelled (the no-stream fallback); a single race, not one per chunk.
 *
 * @internal
 */
function raceAbort(promise: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) return promise;
  promise.catch(() => undefined); // settles after we abort: keep it from going unhandled
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    // A whole-body read has no reader to cancel: mark it so a timeout is not retried (the native
    // read may still be consuming the body).
    onAbort = () => reject(new UncancellableReadError('response body read aborted'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => undefined);
  return Promise.race([promise, aborted]).finally(() => {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

/**
 * Maps a body-read failure that happened under an armed timeout or caller signal to the matching
 * abort error. A cancellable (streaming) read retries like a stalled connection; a read that could
 * not be cancelled ({@link UncancellableReadError} from the no-stream fallback) does not, so retry
 * cannot start a second read against a body the first is still consuming. Returns `undefined` when
 * neither signal aborted.
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
    const message = `Request timed out after ${requestTimeout}ms`;
    return err instanceof UncancellableReadError
      ? new UncancellableReadError(message, { cause: err })
      : new NetworkError(message, { cause: err });
  }
  if (callerSignal?.aborted) {
    return new CallerAbortError(errorMessage(err, 'Request aborted by caller'));
  }
  return undefined;
}

export type RequestArgs = {
  endpoint: string;
  /**
   * A string is sent byte-verbatim (it is what blind auth signed); an object is JSON-serialized by
   * the transport.
   */
  requestBody?: Record<string, unknown> | string;
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
     * Per-request timeout in milliseconds. If a single fetch hangs longer than this (connecting,
     * waiting, or reading the body), it is aborted and treated as a NetworkError (triggering retry
     * on cached endpoints). Without this, a hung connection can consume the entire TTL retry
     * window.
     */
    requestTimeout?: number;
    /**
     * Maximum response body size in bytes (default 8_388_608 = 8 MiB). Bodies over the cap fail the
     * request; reads are streamed and stop at the cap where the runtime supports it.
     */
    maxResponseBytes?: number;
    /**
     * Marks the request as safe to replay (read-only, no side effects). Idempotent requests retry
     * once on a network-level failure, recovering from dropped keep-alive sockets. GET requests
     * default to `true`; POSTs must opt in.
     */
    idempotent?: boolean;
    /**
     * Optional callback invoked on every HTTP response with structured rate-limit metadata. Fires
     * before the promise resolves (on success) or rejects (on error), so consumers always receive
     * metadata even when the request fails.
     */
    onResponseMeta?: (meta: ResponseMeta) => void;
    /**
     * Optional fetch-compatible transport for the default request implementation. Use this to route
     * mint HTTP requests through transports such as OHTTP, Tor, native HTTP clients, or proxies
     * while preserving cashu-ts JSON parsing, timeout handling, errors, and NUT-19 retry logic.
     */
    fetch?: RequestFetch;
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

/**
 * The options that are library semantics rather than fetch transport config.
 *
 * @remarks
 * Precedence differs by class: a global value for these is only a default and the per-call value
 * wins, while `RequestInit` fields go the other way (global is an embedder override). Adding an
 * option to {@link RequestOptions} outside `RequestInit` will not compile until it is listed below.
 * @internal
 */
type PerCallOption = Exclude<keyof RequestOptions, keyof RequestInit>;

const PER_CALL_OPTIONS = {
  endpoint: true,
  requestBody: true,
  logger: true,
  ttl: true,
  cached_endpoints: true,
  requestTimeout: true,
  maxResponseBytes: true,
  idempotent: true,
  onResponseMeta: true,
  fetch: true,
} satisfies Record<PerCallOption, true>;

let globalRequestOptions: Partial<RequestOptions> = {};
let requestLogger = NULL_LOGGER;

/**
 * An object containing any custom settings that you want to apply to every mint request.
 *
 * @remarks
 * `RequestInit` fields (`cache`, `credentials`, `mode` etc) override the per-call value: they are
 * process-wide transport policy. Library options (`requestTimeout`, `fetch`, `maxResponseBytes`,
 * `idempotent`, NUT-19 policy) are defaults a per-call value overrides. `headers` merge, per-call
 * wins per key; `redirect` defaults to `error` on requests with a body, and is forced to `error` on
 * requests carrying auth headers.
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
const DEFAULT_MAX_RESPONSE_BYTES = 8_388_608; // 8 MiB; >10x any realistic mint response
const AUTH_HEADERS = ['blind-auth', 'clear-auth']; // NUT-21/22 tokens, lowercased for comparison

class CallerAbortError extends NetworkError {
  constructor(message: string) {
    super(message);
    this.name = 'CallerAbortError';
    Object.setPrototypeOf(this, CallerAbortError.prototype);
  }
}

/**
 * A timeout that fired while reading a response body that could not be cancelled (the no-stream
 * fallback). The underlying read may still be consuming the body, so this is NOT retried: another
 * attempt would start a second uncancellable read against the same (possibly unbounded) body.
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
    const idempotent = options.idempotent ?? requestMethod === 'GET';
    if (!idempotent) {
      return await _request(options);
    }
    try {
      return await _request(options);
    } catch (e) {
      // One immediate retry on a connection-level failure (a dropped keep-alive socket is the
      // common case); HTTP errors mean the server answered and are never retried here.
      if (
        e instanceof CallerAbortError ||
        e instanceof UncancellableReadError ||
        !(e instanceof NetworkError)
      ) {
        throw e;
      }
      requestLogger.info('Network error on an idempotent request, retrying once', { e });
      return await _request(options);
    }
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
    maxResponseBytes,
    fetch: fetchImpl,
    // consumed by requestWithRetry, excluded from raw fetch options
    cached_endpoints,
    ttl,
    idempotent,
    logger,
    ...fetchOptions
  } = options;

  // Intentionally unused vars (extracted from fetchOptions)
  void cached_endpoints;
  void ttl;
  void idempotent;
  void logger;

  if (
    maxResponseBytes !== undefined &&
    (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0)
  ) {
    throw new CTSError('maxResponseBytes must be a positive integer');
  }
  const responseByteCap = maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  const requestFetch = fetchImpl ?? fetch;
  const body =
    typeof requestBody === 'string'
      ? requestBody
      : requestBody
        ? JSONInt.stringify(requestBody)
        : undefined;
  const headers = buildRequestHeaders(body, requestHeaders);
  const carriesAuth = Object.keys(headers).some((name) =>
    AUTH_HEADERS.includes(name.toLowerCase()),
  );
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

  // Signals stay armed until the body is fully consumed: both the timeout and a caller abort
  // must be able to stop a body that streams slowly or never ends, not just the initial fetch.
  try {
    let response: Response;
    try {
      response = await requestFetch(endpoint, {
        body,
        headers,
        // Anti-fingerprinting fetch options.
        cache: 'no-store', // prevent cache tracking (eg ETag)
        credentials: 'omit', // prevent cookie-based tracking
        referrer: '', // prevent leaking the embedding page URL
        referrerPolicy: 'no-referrer', // belt-and-braces for referrer across all contexts
        // A 307/308 re-sends the body to the redirect target, so any request carrying one fails
        // rather than follows. Overridable for deployments that legitimately redirect.
        ...(body !== undefined ? { redirect: 'error' as const } : undefined),
        ...fetchOptions, // allows override of above options
        ...(carriesAuth ? { redirect: 'error' as const } : undefined), // not overridable on auth requests
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
        errorData = parseErrorBody(await readBodyText(response, responseByteCap, signal));
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
      responseText = await readBodyText(response, responseByteCap, signal);
    } catch (err) {
      // A body-read failure under an armed signal is an abort, not a bad response: classify it
      // like the fetch-level catch so cached-endpoint retry still engages on a timeout.
      const aborted = abortError(err, timeoutController, requestTimeout, callerSignal);
      if (aborted) throw aborted;
      requestLogger.error('Failed to read HTTP response', { err });
      // Surface our own reason (eg the size cap), but keep a foreign transport error behind the
      // stable "bad response" message rather than exposing it.
      const message = err instanceof CTSError ? err.message : 'bad response';
      throw new HttpResponseError(message, response.status, { cause: err });
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
  for (const key of Object.keys(PER_CALL_OPTIONS) as PerCallOption[]) {
    if (options[key] !== undefined) (merged as Record<string, unknown>)[key] = options[key];
  }
  // Neither side owns the header bag: a global adds app-wide headers, per-call carries auth.
  merged.headers = { ...globalRequestOptions.headers, ...options.headers };

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
