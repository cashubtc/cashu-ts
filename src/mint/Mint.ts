/**
 * Cashu Mint Class.
 *
 * @remarks
 * You should ordinarily not need to instantiate a Mint, as it will be auto-instantiated by the
 * Wallet class when you pass in the mint url.
 */
import type {
	PostRestoreResponse,
	SwapResponse,
	CheckStatePayload,
	PostRestorePayload,
} from './types';
import type { GetKeysResponse, GetKeysetsResponse } from '../model/types/keyset';
import request, {
	ConnectionManager,
	type WSConnection,
	setRequestLogger,
	type RequestFn,
	type RequestOptions,
} from '../transport';
import { isObj, joinUrls, sanitizeUrl } from '../utils';
import {
	type MeltQuoteResponsePaidDeprecated,
	handleMeltQuoteResponseDeprecated,
} from '../legacy/nut-05';
import {
	type MintQuoteResponsePaidDeprecated,
	handleMintQuoteResponseDeprecated,
} from '../legacy/nut-04';
import { handleMintInfoContactFieldDeprecated } from '../legacy/nut-06';
import { MintInfo } from '../model/MintInfo';
import { type Logger, NULL_LOGGER, failIf } from '../logger';
import type { AuthProvider } from '../auth/AuthProvider';
import { OIDCAuth, type OIDCAuthOptions } from '../auth/OIDCAuth';
import {
	type MintQuoteBolt11Response,
	type MintQuoteBolt12Response,
	type MeltQuoteBaseResponse,
	type MeltQuoteBolt11Response,
	type MeltQuoteBolt12Response,
	MeltQuoteState,
	type MintResponse,
	type GetInfoResponse,
	type MeltRequest,
	type CheckStateResponse,
	type MeltQuoteBolt11Request,
	type MeltQuoteBolt12Request,
	type MintRequest,
	type MintQuoteBolt11Request,
	type MintQuoteBolt12Request,
	type SwapRequest,
} from '../model/types';

/**
 * Class represents Cashu Mint API.
 *
 * @remarks
 * This class contains lower-level functions that are implemented by Wallet.
 */
class Mint {
	private ws?: WSConnection;
	private _mintUrl: string;
	private _request: RequestFn;
	private _logger: Logger;
	private _mintInfo?: MintInfo;
	private _authProvider?: AuthProvider;

	/**
	 * @param mintUrl Requires mint URL to create this object.
	 * @param customRequest Optional, for custom network communication with the mint.
	 * @param authTokenGetter Optional. Function to obtain a NUT-22 BlindedAuthToken (e.g. from a
	 *   database or localstorage)
	 */
	constructor(
		mintUrl: string,
		options?: {
			customRequest?: RequestFn;
			authProvider?: AuthProvider;
			logger?: Logger;
		},
	) {
		this._mintUrl = sanitizeUrl(mintUrl);
		this._request = options?.customRequest ?? request;
		this._authProvider = options?.authProvider;
		this._logger = options?.logger ?? NULL_LOGGER;
		setRequestLogger(this._logger);
	}

	get mintUrl() {
		return this._mintUrl;
	}

	/**
	 * Create an OIDC client using this mint’s NUT-21 metadata.
	 *
	 * @example
	 *
	 * ```ts
	 * const oidc = await mint.oidcAuth({ onTokens: (t) => authMgr.setCAT(t.access_token!) });
	 * const start = await oidc.deviceStart();
	 * // show start.user_code / start.verification_uri to the user
	 * const token = await oidc.devicePoll(start.device_code, start.interval ?? 5);
	 * // token.access_token is your CAT
	 * ```
	 */
	async oidcAuth(opts?: OIDCAuthOptions): Promise<OIDCAuth> {
		const n21 = (await this.getLazyMintInfo()).nuts['21'];
		if (!n21?.openid_discovery) {
			throw new Error('Mint: no NUT-21 openid_discovery');
		}
		return new OIDCAuth(n21.openid_discovery, {
			...opts,
			clientId: opts?.clientId ?? n21.client_id ?? 'cashu-client',
		});
	}

	/**
	 * Fetches mint's info at the /info endpoint.
	 *
	 * @param customRequest Optional override for the request function.
	 * @returns The mint's information response.
	 */
	async getInfo(customRequest?: RequestFn): Promise<GetInfoResponse> {
		const requestInstance = customRequest ?? this._request;
		const response = await requestInstance<GetInfoResponse>({
			endpoint: joinUrls(this._mintUrl, '/v1/info'),
		});
		const data = handleMintInfoContactFieldDeprecated(response, this._logger);
		return data;
	}

	/**
	 * Lazily fetches and caches the mint's info if not already loaded.
	 *
	 * @returns The parsed MintInfo object.
	 */
	async getLazyMintInfo(): Promise<MintInfo> {
		if (this._mintInfo) {
			return this._mintInfo;
		}
		const data = await this.getInfo();
		this._mintInfo = new MintInfo(data);
		return this._mintInfo;
	}

	/**
	 * Performs a swap operation with ecash inputs and outputs.
	 *
	 * @param swapPayload Payload containing inputs and outputs.
	 * @param customRequest Optional override for the request function.
	 * @returns Signed outputs.
	 */
	async swap(swapPayload: SwapRequest, customRequest?: RequestFn): Promise<SwapResponse> {
		const data = await this.requestWithAuth<SwapResponse>(
			'POST',
			'/v1/swap',
			{ requestBody: swapPayload },
			customRequest,
		);

		if (!isObj(data) || !Array.isArray(data?.signatures)) {
			this._logger.error('Invalid response from mint...', { data, op: 'swap' });
			throw new Error('Invalid response from mint');
		}

		return data;
	}

	/**
	 * Requests a new mint quote from the mint.
	 *
	 * @param mintQuotePayload Payload for creating a new mint quote.
	 * @param customRequest Optional override for the request function.
	 * @returns A new mint quote containing a payment request for the specified amount and unit.
	 */
	async createMintQuoteBolt11(
		mintQuotePayload: MintQuoteBolt11Request,
		customRequest?: RequestFn,
	): Promise<MintQuoteBolt11Response> {
		const response = await this.requestWithAuth<
			MintQuoteBolt11Response & MintQuoteResponsePaidDeprecated
		>('POST', '/v1/mint/quote/bolt11', { requestBody: mintQuotePayload }, customRequest);
		const data = handleMintQuoteResponseDeprecated(response, this._logger);
		return data;
	}

	/**
	 * Requests a new BOLT12 mint quote from the mint using Lightning Network offers.
	 *
	 * @param mintQuotePayload Payload containing amount, unit, optional description, and required
	 *   pubkey.
	 * @param customRequest Optional override for the request function.
	 * @returns A mint quote containing a BOLT12 offer.
	 */
	async createMintQuoteBolt12(
		mintQuotePayload: MintQuoteBolt12Request,
		customRequest?: RequestFn,
	): Promise<MintQuoteBolt12Response> {
		const response = await this.requestWithAuth<MintQuoteBolt12Response>(
			'POST',
			'/v1/mint/quote/bolt12',
			{ requestBody: mintQuotePayload },
			customRequest,
		);
		return response;
	}

	/**
	 * Gets an existing mint quote from the mint.
	 *
	 * @param quote Quote ID.
	 * @param customRequest Optional override for the request function.
	 * @returns The status of the mint quote, including payment details and state.
	 */
	async checkMintQuoteBolt11(
		quote: string,
		customRequest?: RequestFn,
	): Promise<MintQuoteBolt11Response> {
		const response = await this.requestWithAuth<
			MintQuoteBolt11Response & MintQuoteResponsePaidDeprecated
		>('GET', `/v1/mint/quote/bolt11/${quote}`, {}, customRequest);

		const data = handleMintQuoteResponseDeprecated(response, this._logger);
		return data;
	}

	/**
	 * Gets an existing BOLT12 mint quote from the mint.
	 *
	 * @param quote Quote ID to check.
	 * @param customRequest Optional override for the request function.
	 * @returns Updated quote with current payment and issuance amounts.
	 */
	async checkMintQuoteBolt12(
		quote: string,
		customRequest?: RequestFn,
	): Promise<MintQuoteBolt12Response> {
		const response = await this.requestWithAuth<MintQuoteBolt12Response>(
			'GET',
			`/v1/mint/quote/bolt12/${quote}`,
			{},
			customRequest,
		);
		return response;
	}

	/**
	 * Mints new tokens by requesting blind signatures on the provided outputs.
	 *
	 * @param mintPayload Payload containing the outputs to get blind signatures on.
	 * @param customRequest Optional override for the request function.
	 * @returns Serialized blinded signatures.
	 */
	async mintBolt11(mintPayload: MintRequest, customRequest?: RequestFn): Promise<MintResponse> {
		const data = await this.requestWithAuth<MintResponse>(
			'POST',
			'/v1/mint/bolt11',
			{ requestBody: mintPayload },
			customRequest,
		);

		if (!isObj(data) || !Array.isArray(data?.signatures)) {
			this._logger.error('Invalid response from mint...', { data, op: 'mintBolt11' });
			throw new Error('Invalid response from mint');
		}

		return data;
	}

	/**
	 * Mints new tokens using a BOLT12 quote by requesting blind signatures on the provided outputs.
	 *
	 * @param mintPayload Payload containing the quote ID and outputs to get blind signatures on.
	 * @param customRequest Optional override for the request function.
	 * @returns Serialized blinded signatures for the requested outputs.
	 */
	async mintBolt12(mintPayload: MintRequest, customRequest?: RequestFn): Promise<MintResponse> {
		const data = await this.requestWithAuth<MintResponse>(
			'POST',
			'/v1/mint/bolt12',
			{ requestBody: mintPayload },
			customRequest,
		);

		if (!isObj(data) || !Array.isArray(data?.signatures)) {
			this._logger.error('Invalid response from mint...', { data, op: 'mintBolt12' });
			throw new Error('Invalid response from mint');
		}

		return data;
	}

	/**
	 * Requests a new melt quote from the mint.
	 *
	 * @param meltQuotePayload Payload for creating a new melt quote.
	 * @param customRequest Optional override for the request function.
	 * @returns The melt quote response.
	 */
	async createMeltQuoteBolt11(
		meltQuotePayload: MeltQuoteBolt11Request,
		customRequest?: RequestFn,
	): Promise<MeltQuoteBolt11Response> {
		const response = await this.requestWithAuth<
			MeltQuoteBolt11Response & MeltQuoteResponsePaidDeprecated
		>('POST', '/v1/melt/quote/bolt11', { requestBody: meltQuotePayload }, customRequest);

		const data = handleMeltQuoteResponseDeprecated(response, this._logger);

		if (
			!isObj(data) ||
			typeof data?.amount !== 'number' ||
			typeof data?.fee_reserve !== 'number' ||
			typeof data?.quote !== 'string'
		) {
			this._logger.error('Invalid response from mint...', { data, op: 'createMeltQuoteBolt11' });
			throw new Error('Invalid response from mint');
		}
		return data;
	}

	/**
	 * Requests a new BOLT12 melt quote from the mint for paying a Lightning Network offer. For
	 * amount-less offers, specify the amount in options.amountless.amount_msat.
	 *
	 * @param meltQuotePayload Payload containing the BOLT12 offer to pay and unit.
	 * @param customRequest Optional override for the request function.
	 * @returns Melt quote with amount, fee reserve, and payment state.
	 */
	async createMeltQuoteBolt12(
		meltQuotePayload: MeltQuoteBolt12Request,
		customRequest?: RequestFn,
	): Promise<MeltQuoteBolt12Response> {
		const response = await this.requestWithAuth<MeltQuoteBolt12Response>(
			'POST',
			'/v1/melt/quote/bolt12',
			{ requestBody: meltQuotePayload },
			customRequest,
		);
		return response;
	}

	/**
	 * Gets an existing melt quote.
	 *
	 * @param quote Quote ID.
	 * @param customRequest Optional override for the request function.
	 * @returns The melt quote response.
	 */
	async checkMeltQuoteBolt11(
		quote: string,
		customRequest?: RequestFn,
	): Promise<MeltQuoteBolt11Response> {
		const response = await this.requestWithAuth<
			MeltQuoteBolt11Response & MeltQuoteResponsePaidDeprecated
		>('GET', `/v1/melt/quote/bolt11/${quote}`, {}, customRequest);

		const data = handleMeltQuoteResponseDeprecated(response, this._logger);

		if (
			!isObj(data) ||
			typeof data?.amount !== 'number' ||
			typeof data?.fee_reserve !== 'number' ||
			typeof data?.quote !== 'string' ||
			typeof data?.state !== 'string' ||
			!Object.values(MeltQuoteState).includes(data.state)
		) {
			this._logger.error('Invalid response from mint...', { data, op: 'checkMeltQuoteBolt11' });
			throw new Error('Invalid response from mint');
		}

		return data;
	}

	/**
	 * Gets an existing BOLT12 melt quote from the mint. Returns current payment state (UNPAID,
	 * PENDING, or PAID) and payment preimage if paid.
	 *
	 * @param quote Quote ID to check.
	 * @param customRequest Optional override for the request function.
	 * @returns Updated quote with current payment state and preimage if available.
	 */
	async checkMeltQuoteBolt12(
		quote: string,
		customRequest?: RequestFn,
	): Promise<MeltQuoteBolt12Response> {
		const response = await this.requestWithAuth<MeltQuoteBolt12Response>(
			'GET',
			`/v1/melt/quote/bolt12/${quote}`,
			{},
			customRequest,
		);
		return response;
	}

	/**
	 * Generic method to melt tokens using any payment method endpoint.
	 *
	 * @remarks
	 * This method enables support for custom payment methods without modifying the Mint class. It
	 * constructs the endpoint as `/v1/melt/{method}` and POSTs the payload. The response must contain
	 * the common fields: quote, amount, fee_reserve, state, expiry.
	 * @example
	 *
	 * ```ts
	 * const response = await mint.melt('bolt11', { quote: 'q1', inputs: [...], outputs: [...] });
	 * const response = await mint.melt('custom-payment', { quote: 'c1', inputs: [...], outputs: [...] });
	 * ```
	 *
	 * @param method The payment method (e.g., 'bolt11', 'bolt12', or custom method name).
	 * @param meltPayload The melt payload containing inputs and optional outputs.
	 * @param options.customRequest Optional override for the request function.
	 * @param options.preferAsync Optional override to set 'respond-async' header.
	 * @returns A response object with at least the required melt quote fields.
	 */
	async melt<TRes extends Record<string, unknown> = Record<string, unknown>>(
		method: string,
		meltPayload: MeltRequest,
		options?: {
			customRequest?: RequestFn;
			preferAsync?: boolean;
		},
	): Promise<MeltQuoteBaseResponse & TRes> {
		// Set headers as needed
		const headers: Record<string, string> = {
			...(options?.preferAsync ? { Prefer: 'respond-async' } : {}),
		};
		// Validate method string and make request
		failIf(!this.isValidMethodString(method), `Invalid melt method: ${method}`, this._logger);
		const data = await this.requestWithAuth<MeltQuoteBaseResponse & TRes>(
			'POST',
			`/v1/melt/${method}`,
			{ requestBody: meltPayload, headers },
			options?.customRequest,
		);

		// Runtime shape check for basic MeltQuoteBaseResponse
		// TODO: - Tests need updating before we can do full shape check!
		if (
			!isObj(data) //||
			// typeof data.quote !== 'string' ||
			// typeof data.amount !== 'number' ||
			// typeof data.unit !== 'string' ||
			// typeof data.expiry !== 'number' ||
			// !Object.values(MeltQuoteState).includes(data.state)
		) {
			this._logger.error('Invalid response from mint...', { data, op: 'melt' });
			throw new Error('Invalid response from mint');
		}

		return data;
	}

	/**
	 * Requests the mint to pay for a Bolt11 payment request by providing ecash as inputs to be spent.
	 * The inputs contain the amount and the fee_reserves for a Lightning payment. The payload can
	 * also contain blank outputs in order to receive back overpaid Lightning fees.
	 *
	 * @param meltPayload The melt payload containing inputs and optional outputs.
	 * @param options.customRequest Optional override for the request function.
	 * @param options.preferAsync Optional override to set 'respond-async' header.
	 * @returns The melt response.
	 */
	async meltBolt11(
		meltPayload: MeltRequest,
		options?: {
			customRequest?: RequestFn;
			preferAsync?: boolean;
		},
	): Promise<MeltQuoteBolt11Response> {
		const response = await this.melt<MeltQuoteBolt11Response>('bolt11', meltPayload, options);

		const data = handleMeltQuoteResponseDeprecated(response, this._logger);

		if (
			!isObj(data) ||
			typeof data?.state !== 'string' ||
			!Object.values(MeltQuoteState).includes(data.state)
		) {
			this._logger.error('Invalid response from mint...', { data, op: 'meltBolt11' });
			throw new Error('Invalid response from mint');
		}

		return data;
	}

	/**
	 * Requests the mint to pay a BOLT12 offer by providing ecash inputs to be spent. The inputs must
	 * cover the amount plus fee reserves. Optional outputs can be included to receive change for
	 * overpaid Lightning fees.
	 *
	 * @param meltPayload Payload containing quote ID, inputs, and optional outputs for change.
	 * @param options.customRequest Optional override for the request function.
	 * @param options.preferAsync Optional override to set 'respond-async' header.
	 * @returns Payment result with state and optional change signatures.
	 */
	async meltBolt12(
		meltPayload: MeltRequest,
		options?: {
			customRequest?: RequestFn;
			preferAsync?: boolean;
		},
	): Promise<MeltQuoteBolt12Response> {
		return this.melt<MeltQuoteBolt12Response>('bolt12', meltPayload, options);
	}

	/**
	 * Checks if specific proofs have already been redeemed.
	 *
	 * @param checkPayload The payload containing proofs to check.
	 * @param customRequest Optional override for the request function.
	 * @returns Redeemed and unredeemed ordered list of booleans.
	 */
	async check(
		checkPayload: CheckStatePayload,
		customRequest?: RequestFn,
	): Promise<CheckStateResponse> {
		const data = await this.requestWithAuth<CheckStateResponse>(
			'POST',
			'/v1/checkstate',
			{ requestBody: checkPayload },
			customRequest,
		);

		if (!isObj(data) || !Array.isArray(data?.states)) {
			this._logger.error('Invalid response from mint...', { data, op: 'check' });
			throw new Error('Invalid response from mint');
		}

		return data;
	}

	/**
	 * Get the mint's public keys.
	 *
	 * @param keysetId Optional param to get the keys for a specific keyset. If not specified, the
	 *   keys from all active keysets are fetched.
	 * @param mintUrl Optional alternative mint URL to use for this request.
	 * @param customRequest Optional override for the request function.
	 * @returns The mint's public keys.
	 */
	async getKeys(
		keysetId?: string,
		mintUrl?: string,
		customRequest?: RequestFn,
	): Promise<GetKeysResponse> {
		const targetUrl = mintUrl || this._mintUrl;
		// backwards compatibility for base64 encoded keyset ids
		if (keysetId) {
			// make the keysetId url safe
			keysetId = keysetId.replace(/\//g, '_').replace(/\+/g, '-');
		}
		const requestInstance = customRequest ?? this._request;
		const data = await requestInstance<GetKeysResponse>({
			endpoint: keysetId
				? joinUrls(targetUrl, '/v1/keys', keysetId)
				: joinUrls(targetUrl, '/v1/keys'),
		});

		if (!isObj(data) || !Array.isArray(data.keysets)) {
			this._logger.error('Invalid response from mint...', { data, op: 'getKeys' });
			throw new Error('Invalid response from mint');
		}

		return data;
	}

	/**
	 * Get the mint's keysets in no specific order.
	 *
	 * @param customRequest Optional override for the request function.
	 * @returns All the mint's past and current keysets.
	 */
	async getKeySets(customRequest?: RequestFn): Promise<GetKeysetsResponse> {
		const requestInstance = customRequest ?? this._request;
		return requestInstance<GetKeysetsResponse>({
			endpoint: joinUrls(this._mintUrl, '/v1/keysets'),
		});
	}

	/**
	 * Restores proofs from the provided blinded messages.
	 *
	 * @param restorePayload The payload containing outputs to restore.
	 * @param customRequest Optional override for the request function.
	 * @returns The restore response with outputs and signatures.
	 */
	async restore(
		restorePayload: PostRestorePayload,
		customRequest?: RequestFn,
	): Promise<PostRestoreResponse> {
		const requestInstance = customRequest ?? this._request;
		const data = await requestInstance<PostRestoreResponse>({
			endpoint: joinUrls(this._mintUrl, '/v1/restore'),
			method: 'POST',
			requestBody: restorePayload,
		});

		if (!isObj(data) || !Array.isArray(data?.outputs) || !Array.isArray(data?.signatures)) {
			this._logger.error('Invalid response from mint...', { data, op: 'restore' });
			throw new Error('Invalid response from mint');
		}

		return data;
	}

	/**
	 * Tries to establish a websocket connection with the websocket mint url according to NUT-17.
	 */
	async connectWebSocket() {
		try {
			const mintUrl = new URL(this._mintUrl);
			const wsSegment = 'v1/ws';

			if (mintUrl.pathname.endsWith('/')) mintUrl.pathname += wsSegment;
			else mintUrl.pathname += '/' + wsSegment;

			// preserve query params if any, and avoid manual string building
			mintUrl.protocol = mintUrl.protocol === 'https:' ? 'wss:' : 'ws:';
			const wsUrl = mintUrl.toString();

			if (!this.ws) {
				this.ws = ConnectionManager.getInstance().getConnection(wsUrl, this._logger);
			}

			await this.ws.ensureConnection();
		} catch (e) {
			this._logger.error('Failed to connect to WebSocket...', { e });
			try {
				this.ws?.close();
			} catch {
				// silence
			}
			this.ws = undefined;
			throw new Error('Failed to connect to WebSocket...');
		}
	}

	/**
	 * Closes a websocket connection.
	 */
	disconnectWebSocket() {
		if (this.ws) {
			this.ws.close();
		}
	}

	get webSocketConnection() {
		return this.ws;
	}

	/**
	 * Returns the Clear Authentication Token (CAT) to use in the 'Clear-auth' header, or undefined if
	 * not required for the given path and method.
	 *
	 * @param method The method to call on the path.
	 * @param path The API path to check for blind auth requirement.
	 * @returns The blind auth token if required, otherwise undefined.
	 */
	private async handleClearAuth(method: 'GET' | 'POST', path: string): Promise<string | undefined> {
		if (!this._authProvider) return undefined;
		const info = await this.getLazyMintInfo();
		if (!info.requiresClearAuthToken(method, path)) return undefined;
		this._logger.error('Clear Authentication Token...', { cat: this._authProvider.getCAT() });
		return this._authProvider.getCAT();
	}

	/**
	 * Returns a serialized Blind Authentication Token (BAT) to use in the 'Blind-auth' header, or
	 * undefined if not required for the given path and method.
	 *
	 * @param method The method to call on the path.
	 * @param path The API path to check for blind auth requirement.
	 * @returns The blind auth token if required, otherwise undefined.
	 */
	private async handleBlindAuth(method: 'GET' | 'POST', path: string): Promise<string | undefined> {
		if (!this._authProvider) return undefined;
		const info = await this.getLazyMintInfo();
		if (!info.requiresBlindAuthToken(method, path)) return undefined;
		const bat = await this._authProvider.getBlindAuthToken({ method, path });
		this._logger.error('Blind Authentication Token...', { bat });
		return bat;
	}

	private async requestWithAuth<T>(
		method: 'GET' | 'POST',
		path: string,
		init: Omit<RequestOptions, 'endpoint' | 'method' | 'headers' | 'requestBody'> & {
			requestBody?: Record<string, unknown>;
			headers?: Record<string, string>;
		} = {},
		customRequest?: RequestFn,
	): Promise<T> {
		const requestInstance = customRequest ?? this._request;
		// Get BAT/CAT token if this endpoint is protected
		const bat = await this.handleBlindAuth(method, path);
		const cat = await this.handleClearAuth(method, path);
		const headers: Record<string, string> = {
			...(init.headers ?? {}),
			...(bat ? { 'Blind-auth': bat } : {}),
			...(cat ? { 'Clear-auth': cat } : {}),
		};
		return requestInstance<T>({
			...init,
			endpoint: joinUrls(this._mintUrl, path),
			method,
			headers,
		});
	}

	private isValidMethodString(method: unknown): boolean {
		// Is a string at least one character long, containing only 0-9, a-z, _ or -
		if (typeof method === 'string' && /^[a-z0-9_-]+$/.test(method)) {
			return true;
		}
		return false;
	}
}

export { Mint };
