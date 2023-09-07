import { checkResponse } from './utils';

type RequestArgs = {
	endpoint: string;
	requestBody?: Record<string, unknown>;
};

type RequestOptions = RequestArgs & Omit<RequestInit, 'body'>;

let globalRequestOptions: Partial<RequestOptions> = {};

/**
 * An object containing any custom settings that you want to apply to the global fetch method.
 * @param options See possible options here: https://developer.mozilla.org/en-US/docs/Web/API/fetch#options
 */
export function setGlobalRequestOptions(options: Partial<RequestOptions>): void {
	globalRequestOptions = options;
}

async function _request({ endpoint, requestBody, ...options }: RequestOptions): Promise<Response> {
	const body = requestBody ? JSON.stringify(requestBody) : undefined;
	const response = await fetch(endpoint, { body, ...options });

	if (!response.ok) {
		const { error, detail } = await response.json();
		const message = error || detail || 'bad response';
		throw new Error(message);
	}

	return response;
}

export default async function request<T>(options: RequestOptions): Promise<T> {
	options.headers = { 'Content-Type': 'application/json', ...options.headers };
	options.headers = { 'Accept': 'application/json', ...options.headers };
	const response = await _request({ ...options, ...globalRequestOptions });
	const data = await response.json().catch(() => ({ error: 'bad response' }));
	checkResponse(data);
	return data;
}
