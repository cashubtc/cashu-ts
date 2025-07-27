import { HttpResponseError, NetworkError, MintOperationError } from './model/Errors';
import { type Logger, NULL_LOGGER } from './logger';
import { type ApiError } from './model/types/mint/responses';

type RequestArgs = {
	endpoint: string;
	requestBody?: Record<string, unknown>;
	headers?: Record<string, string>;
};

type RequestOptions = RequestArgs & Omit<RequestInit, 'body' | 'headers'>;

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
		...requestHeaders
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

export default async function request<T>(options: RequestOptions): Promise<T> {
	const data = await _request({ ...options, ...globalRequestOptions });
	return data as T;
}
