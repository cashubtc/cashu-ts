import { HttpResponseError, MintOperationError, NetworkError } from './model/Errors';
import { type Logger, NULL_LOGGER } from './logger';
import { Nut19Policy } from './model/types';

type RequestArgs = {
	endpoint: string;
	requestBody?: Record<string, unknown>;
	headers?: Record<string, string>;
};

const MAX_CACHED_RETRIES = 10;
const MAX_RETRY_DELAY = 60000;

type RequestOptions = RequestArgs & Omit<RequestInit, 'body' | 'headers'> & Partial<Nut19Policy>;

let globalRequestOptions: Partial<RequestOptions> = {};
let requestLogger = NULL_LOGGER;

/**
 * An object containing any custom settings that you want to apply to the global fetch method.
 * @param options See possible options here: https://developer.mozilla.org/en-US/docs/Web/API/fetch#options
 */
export function setGlobalRequestOptions(options: Partial<RequestOptions>): void {
	globalRequestOptions = options;
}

/**
 * Allows a logger to be set
 * @param {Logger} logger The logger instance to use
 */
export function setRequestLogger(logger: Logger): void {
	requestLogger = logger;
}

/**
 * Internal function that handles retry logic for NUT-19 cached endpoints.
 * Non-cached endpoints are executed directly without retries.
 */
async function requestWithRetry(options: RequestOptions): Promise<unknown> {
	const { ttl, cached_endpoints, endpoint } = options;

	const url = new URL(endpoint);

	// there should be at least one cached_endpoint, also ttl is already mapped null->Infinity
	const isCachable =
		cached_endpoints?.some(
			(cached_endpoint) =>
				cached_endpoint.path === url.pathname &&
				cached_endpoint.method === (options.method ?? 'GET')
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
					const cappedDelay = Math.min(Math.pow(2, retries) * 1000, MAX_RETRY_DELAY);
					const delay = Math.random() * cappedDelay;

					if (totalElapsedTime + delay > ttl) {
						requestLogger.error('Network Error: request abandoned after #{retries} retries', {
							e,
							retries
						});
						throw e;
					}
					retries++;
					requestLogger.info('Network Error: attempting retry #{retries} in {delay}ms', {
						e,
						retries,
						delay
					});

					await new Promise((resolve) => setTimeout(resolve, delay));
					return retry();
				}
			}
			requestLogger.error('Request failed and could not be retried', { e });
			throw e;
		}
	};
	return retry();
}

async function _request(options: RequestOptions): Promise<unknown> {
	const { endpoint, requestBody, headers: requestHeaders, ...rest } = options;
	const body = requestBody ? JSON.stringify(requestBody) : undefined;
	const headers = {
		...{ Accept: 'application/json, text/plain, */*' },
		...(body ? { 'Content-Type': 'application/json' } : undefined),
		...requestHeaders
	};

	let response: Response;
	try {
		response = await fetch(endpoint, { body, headers, ...rest });
	} catch (err) {
		// A fetch() promise only rejects when the request fails,
		// for example, because of a badly-formed request URL or a network error.
		throw new NetworkError(err instanceof Error ? err.message : 'Network request failed');
	}

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ error: 'bad response' }));

		if (response.status === 400 && 'code' in errorData && 'detail' in errorData) {
			throw new MintOperationError(errorData.code, errorData.detail);
		}

		throw new HttpResponseError(
			'error' in errorData ? errorData.error : errorData.detail || 'HTTP request failed',
			response.status
		);
	}

	try {
		return await response.json();
	} catch (err) {
		requestLogger.error('Failed to parse HTTP response', { err });
		throw new HttpResponseError('bad response', response.status);
	}
}

/**
 * Performs HTTP request with exponential backoff retry for NUT-19 cached endpoints.
 * Retries only occur for network errors on endpoints specified in cached_endpoints.
 * Nut19Policy for given endpoint should be provided as Nut19Policy object, fetched with MintInfo
 * Regular requests are made for non-cached endpoints without retry logic.
 */
export default async function request<T>(options: RequestOptions): Promise<T> {
	const data = await requestWithRetry({ ...options, ...globalRequestOptions });
	return data as T;
}
