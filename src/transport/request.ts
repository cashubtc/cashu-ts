import { HttpResponseError, NetworkError, MintOperationError } from '../model/Errors';
import { type Logger, NULL_LOGGER } from '../logger';
import { type Nut19Policy } from '../model/types';

// Generic request function type so callers can do requestInstance<T>(...)
export type RequestFn = <T = unknown>(args: RequestOptions) => Promise<T>;

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
 * - Error: Brief error message.
 * - Code: HTTP error code.
 * - Detail: Detailed error message.
 */
export type ApiError = {
	error?: string;
	code?: number;
	detail?: string;
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

/**
 * Internal function that handles retry logic for NUT-19 cached endpoints. Non-cached endpoints are
 * executed directly without retries.
 */
async function requestWithRetry(options: RequestOptions): Promise<unknown> {
	const { ttl, cached_endpoints, endpoint } = options;
	const endpointPathname = getEndpointPathnameSafe(endpoint);

	// there should be at least one cached_endpoint, also ttl is already mapped null->Infinity
	const isCachable =
		endpointPathname !== undefined &&
		cached_endpoints?.some(
			(cached_endpoint) =>
				cached_endpoint.path === endpointPathname &&
				cached_endpoint.method === (options.method?.toUpperCase() ?? 'GET'),
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

	const body = requestBody ? JSON.stringify(requestBody) : undefined;
	const headers = {
		...{ Accept: 'application/json, text/plain, */*' },
		...(body ? { 'Content-Type': 'application/json' } : undefined),
		...requestHeaders,
	};
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
			if (callerSignal.aborted || timeoutController.signal.aborted) {
				forwardAbort();
			} else {
				callerSignal.addEventListener('abort', forwardAbort, { once: true });
				timeoutController.signal.addEventListener('abort', forwardAbort, { once: true });
				cleanupAbortListeners = () => {
					callerSignal.removeEventListener('abort', forwardAbort);
					timeoutController.signal.removeEventListener('abort', forwardAbort);
				};
			}
			signal = combinedController.signal;
		}
	}

	let response: Response;
	try {
		response = await fetch(endpoint, { body, headers, ...fetchOptions, signal });
	} catch (err) {
		const timedOut = !!timeoutController?.signal.aborted;
		const callerAborted = !!callerSignal?.aborted;
		if (timedOut) {
			throw new NetworkError(`Request timed out after ${requestTimeout}ms`);
		}
		if (callerAborted) {
			throw new CallerAbortError(err instanceof Error ? err.message : 'Request aborted by caller');
		}
		if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
			throw new NetworkError(err.message);
		}
		// A fetch() promise only rejects when the request fails,
		// for example, because of a badly-formed request URL or a network error.
		throw new NetworkError(err instanceof Error ? err.message : 'Network request failed');
	} finally {
		clearTimeout(timeoutId);
		cleanupAbortListeners?.();
	}

	if (!response.ok) {
		let errorData: ApiError;
		try {
			errorData = (await response.json()) as ApiError;
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
		return await response.json();
	} catch (err) {
		requestLogger.error('Failed to parse HTTP response', { err });
		throw new HttpResponseError('bad response', response.status);
	}
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
