import { HttpResponseError } from './model/Errors';

let globalRequestOptions: Partial<RequestOptions> = {};
let verbose = false;

type RequestArgs = {
	endpoint: string;
	requestBody?: Record<string, unknown>;
	headers?: Record<string, string>;
};

type RequestOptions = RequestArgs & Omit<RequestInit, 'body' | 'headers'>;

/**
 * Set global request options that will be used for all requests
 * @param options
 */
export function setGlobalRequestOptions(options: Partial<RequestOptions>): void {
	globalRequestOptions = options;
}

/**
 * Set verbose mode for request logging
 * @param isVerbose Whether to enable verbose logging
 */
export function setRequestVerbose(isVerbose: boolean): void {
	verbose = isVerbose;
}

/**
 * Internal method for logging errors when verbose mode is enabled
 * @param message Error message to log
 * @param optionalParams Additional parameters to log
 */
function logError(message: string, ...optionalParams: Array<any>): void {
	if (verbose) {
		console.error(message, ...optionalParams);
	}
}

async function _request({
	endpoint,
	requestBody,
	headers: requestHeaders,
	...options
}: RequestOptions): Promise<unknown> {
	const headers = {
		'Content-Type': 'application/json',
		...requestHeaders
	};

	const response = await fetch(endpoint, {
		method: 'POST',
		body: requestBody ? JSON.stringify(requestBody) : undefined,
		headers,
		...options
	});

	if (!response.ok) {
		const { error, detail } = await response.json().catch(() => ({}));
		throw new HttpResponseError(error || detail || 'bad response', response.status);
	}

	try {
		return await response.json();
	} catch (err) {
		logError('Failed to parse HTTP response', err);
		throw new HttpResponseError('bad response', response.status);
	}
}

export default async function request<T>(options: RequestOptions): Promise<T> {
	const data = await _request({ ...options, ...globalRequestOptions });
	return data as T;
}
