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
		...requestHeaders,
	};

	let response: Response;
	try {
		requestLogger.debug?.('HTTP request', {
			method: options.method ?? 'GET',
			url: endpoint,
			bodyLength: body?.length ?? 0,
			headers,
		});
		response = await fetch(endpoint, { body, headers, ...options });
	} catch (err) {
		throw new NetworkError(err instanceof Error ? err.message : 'Network request failed');
	}

	const contentType = response.headers.get('content-type') ?? '';
	const rawText = await response.text().catch(() => undefined);

	if (!response.ok) {
		let errorMessage = 'HTTP request failed';
		let parsed: unknown;
		if (contentType.includes('application/json') && rawText) {
			try {
				parsed = JSON.parse(rawText);
			} catch {
				// ignore
			}
		} else if (rawText && rawText.trim().startsWith('{')) {
			try {
				parsed = JSON.parse(rawText);
			} catch {
				// ignore
			}
		}

		let errorData: ApiError | undefined =
			parsed && typeof parsed === 'object' ? (parsed as ApiError) : undefined;
		if (
			response.status === 400 &&
			errorData &&
			'code' in errorData &&
			typeof (errorData as any).code === 'number' &&
			'detail' in errorData &&
			typeof (errorData as any).detail === 'string'
		) {
			// Specific mint operation error
			throw new MintOperationError((errorData as any).code, (errorData as any).detail);
		}

		if (errorData) {
			if ('error' in errorData && typeof errorData.error === 'string') {
				errorMessage = errorData.error;
			} else if ('detail' in errorData && typeof errorData.detail === 'string') {
				errorMessage = errorData.detail;
			}
		} else if (rawText && rawText.trim().length > 0) {
			errorMessage = rawText.trim();
		} else {
			errorMessage = 'bad response';
		}
		requestLogger.error?.('HTTP error response', {
			method: options.method ?? 'GET',
			url: endpoint,
			status: response.status,
			statusText: response.statusText,
			contentType,
			bodySnippet: rawText ? rawText.slice(0, 2000) : undefined,
		});

		throw new HttpResponseError(errorMessage, response.status);
	}

	try {
		if (rawText && rawText.length > 0) {
			return JSON.parse(rawText);
		}
		// empty 204/205
		return null;
	} catch (err) {
		requestLogger.error?.('Failed to parse HTTP response', {
			err: err instanceof Error ? err.message : String(err),
			url: endpoint,
			status: response.status,
			contentType,
			bodySnippet: rawText ? rawText.slice(0, 2000) : undefined,
		});
		throw new HttpResponseError('bad response', response.status);
	}
}

export default async function request<T>(options: RequestOptions): Promise<T> {
	const data = await _request({ ...options, ...globalRequestOptions });
	return data as T;
}
