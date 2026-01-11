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
	Partial<Nut19Policy>;

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

/**
 * Internal function that handles retry logic for NUT-19 cached endpoints. Non-cached endpoints are
 * executed directly without retries.
 */
async function requestWithRetry(options: RequestOptions): Promise<unknown> {
	const { ttl, cached_endpoints, endpoint } = options;

	const url = new URL(endpoint);

	// there should be at least one cached_endpoint, also ttl is already mapped null->Infinity
	const isCachable =
		cached_endpoints?.some(
			(cached_endpoint) =>
				cached_endpoint.path === url.pathname &&
				cached_endpoint.method === (options.method ?? 'GET'),
		) && !!ttl;

	if (!isCachable) {
		return await _request(options);
	}

	let retries = 0;
	const startTime = Date.now();

	const retry = async (): Promise<unknown> => {
		try {
			return await _request(options);
		} catch (e) {
			if (e instanceof NetworkError) {
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
					requestLogger.info(`Network Error: attempting retry ${retries} in {delay}ms`, {
						e,
						retries,
						delay,
					});

					await new Promise((resolve) => setTimeout(resolve, delay));
					return retry();
				}
			}
			requestLogger.error(`Request failed and could not be retried`, { e });
			throw e;
		}
	};
	return retry();
}

async function _request({
	endpoint,
	requestBody,
	headers: requestHeaders,
	...options
}: RequestOptions): Promise<unknown> {
	const body = requestBody ? JSON.stringify(requestBody) : undefined;
	const headers = {
		...{ Accept: 'application/json, text/plain, */*' },
		...(body ? { 'Content-Type': 'application/json' } : undefined),
		...requestHeaders,
	};

	let response: Response;
	try {
		response = await fetch(endpoint, { body, headers, ...options });
	} catch (err) {
		// A fetch() promise only rejects when the request fails,
		// for example, because of a badly-formed request URL or a network error.
		throw new NetworkError(err instanceof Error ? err.message : 'Network request failed');
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
 * Performs HTTP request with exponential backoff retry for NUT-19 cached endpoints. Retries only
 * occur for network errors on endpoints specified in cached_endpoints. Nut19Policy for given
 * endpoint should be provided as Nut19Policy object, fetched with MintInfo Regular requests are
 * made for non-cached endpoints without retry logic.
 */
export default async function request<T>(options: RequestOptions): Promise<T> {
	const data = await requestWithRetry({ ...options, ...globalRequestOptions });
	return data as T;
}
