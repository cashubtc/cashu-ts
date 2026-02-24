import { HttpResponseError, NetworkError, MintOperationError } from '../model/Errors';
import { type Logger, NULL_LOGGER } from '../logger';
import { JSONInt } from '../utils/JSONInt';

// Generic request function type so callers can do requestInstance<T>(...)
export type RequestFn = <T = unknown>(args: RequestOptions) => Promise<T>;

export type RequestArgs = {
	endpoint: string;
	requestBody?: Record<string, unknown>;
	headers?: Record<string, string>;
	logger?: Logger;
};

export type RequestOptions = RequestArgs & Omit<RequestInit, 'body' | 'headers'>;

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

async function _request({
	endpoint,
	requestBody,
	headers: requestHeaders,
	...options
}: RequestOptions): Promise<unknown> {
	const body = requestBody ? JSONInt.stringify(requestBody) : undefined;
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
			const errorText = await response.text();
			const parsed = errorText ? JSONInt.parse(errorText) : undefined;
			errorData = isApiError(parsed) ? parsed : { error: 'bad response' };
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

function isApiError(value: unknown): value is ApiError {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const maybe = value as Record<string, unknown>;
	const hasError = !('error' in maybe) || typeof maybe.error === 'string';
	const hasCode = !('code' in maybe) || typeof maybe.code === 'number';
	const hasDetail = !('detail' in maybe) || typeof maybe.detail === 'string';
	return hasError && hasCode && hasDetail;
}

export default async function request<T>(options: RequestOptions): Promise<T> {
	const data = await _request({ ...options, ...globalRequestOptions });
	return data as T;
}
