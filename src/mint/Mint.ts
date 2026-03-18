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
import {
	isObj,
	joinUrls,
	normalizeMintKeys,
	normalizeMintKeyset,
	normalizeSafeIntegerMetadata,
	sanitizeUrl,
} from '../utils';
import { Amount } from '../model/Amount';
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
	type SerializedBlindedMessage,
	type SerializedBlindedSignature,
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
		return response;
	}

	/**
	 * Lazily fetches and caches the mint's info if not already loaded.
	 *
	 * @returns The parsed MintInfo object.
	 */
	async getLazyMintInfo(customRequest?: RequestFn): Promise<MintInfo> {
		if (this._mintInfo) {
			return this._mintInfo;
		}
		const data = await this.getInfo(customRequest);
		this._mintInfo = new MintInfo(data);
		return this._mintInfo;
	}

	/**
	 * Seeds the mint-info cache from already-fetched data.
	 */
	setMintInfo(mintInfo: MintInfo | GetInfoResponse): void {
		this._mintInfo = mintInfo instanceof MintInfo ? mintInfo : new MintInfo(mintInfo);
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
		data.signatures = this.normalizeSignatureAmounts(data.signatures);

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
		const response = await this.requestWithAuth<MintQuoteBolt11Response>(
			'POST',
			'/v1/mint/quote/bolt11',
			{ requestBody: mintQuotePayload },
			customRequest,
		);
		return this.normalizeMintQuoteBolt11Response(response);
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
		return this.normalizeMintQuoteBolt12Response(response);
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
		const response = await this.requestWithAuth<MintQuoteBolt11Response>(
			'GET',
			`/v1/mint/quote/bolt11/${quote}`,
			{},
			customRequest,
		);
		return this.normalizeMintQuoteBolt11Response(response);
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
		return this.normalizeMintQuoteBolt12Response(response);
	}

	/**
	 * Mints new tokens by requesting blind signatures on the provided outputs.
	 *
	 * @remarks
	 * Thin wrapper around mint('bolt11', ...).
	 * @param mintPayload Payload containing the outputs to get blind signatures on.
	 * @param customRequest Optional override for the request function.
	 * @returns Serialized blinded signatures.
	 */
	async mintBolt11(mintPayload: MintRequest, customRequest?: RequestFn): Promise<MintResponse> {
		return this.mint('bolt11', mintPayload, { customRequest });
	}

	/**
	 * Mints new tokens using a BOLT12 quote by requesting blind signatures on the provided outputs.
	 *
	 * @remarks
	 * Thin wrapper around mint('bolt12', ...).
	 * @param mintPayload Payload containing the quote ID and outputs to get blind signatures on.
	 * @param customRequest Optional override for the request function.
	 * @returns Serialized blinded signatures for the requested outputs.
	 */
	async mintBolt12(mintPayload: MintRequest, customRequest?: RequestFn): Promise<MintResponse> {
		return this.mint('bolt12', mintPayload, { customRequest });
	}

	/**
	 * Mints new tokens for a given payment method.
	 *
	 * @remarks
	 * Uses `/v1/mint/{method}` and validates method format.
	 * @param method The minting method (e.g., 'bolt11', 'bolt12', or custom method name).
	 * @param mintPayload Payload containing the quote ID and outputs to get blind signatures on.
	 * @param options.customRequest Optional override for the request function.
	 * @returns Serialized blinded signatures for the requested outputs.
	 */
	async mint<TRes extends Record<string, unknown> = Record<string, unknown>>(
		method: string,
		mintPayload: MintRequest,
		options?: { customRequest?: RequestFn },
	): Promise<MintResponse & TRes> {
		failIf(!this.isValidMethodString(method), `Invalid mint method: ${method}`, this._logger);
		const data = await this.requestWithAuth<MintResponse & TRes>(
			'POST',
			`/v1/mint/${method}`,
			{ requestBody: mintPayload },
			options?.customRequest,
		);

		if (!isObj(data) || !Array.isArray(data?.signatures)) {
			this._logger.error('Invalid response from mint...', { data, op: `mint.${method}` });
			throw new Error('Invalid response from mint');
		}
		data.signatures = this.normalizeSignatureAmounts(data.signatures);
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
		const response = await this.requestWithAuth<MeltQuoteBolt11Response>(
			'POST',
			'/v1/melt/quote/bolt11',
			{ requestBody: meltQuotePayload },
			customRequest,
		);
		const data = this.normalizeMeltQuoteBolt11Response(response);

		if (
			!isObj(data) ||
			!(data?.amount instanceof Amount) ||
			!(data?.fee_reserve instanceof Amount) ||
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
		return this.normalizeMeltQuoteBolt11Response(response);
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
		const response = await this.requestWithAuth<MeltQuoteBolt11Response>(
			'GET',
			`/v1/melt/quote/bolt11/${quote}`,
			{},
			customRequest,
		);
		const data = this.normalizeMeltQuoteBolt11Response(response);

		if (
			!isObj(data) ||
			!(data?.amount instanceof Amount) ||
			!(data?.fee_reserve instanceof Amount) ||
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
		return this.normalizeMeltQuoteBolt11Response(response);
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
	 * @param options.preferAsync DEPRECATED Set `prefer_async: true` in the meltPayload.
	 * @returns A response object with at least the required melt quote fields.
	 */
	async melt<TRes extends Record<string, unknown> = Record<string, unknown>>(
		method: string,
		meltPayload: MeltRequest,
		options?: {
			customRequest?: RequestFn;
			/**
			 * @deprecated Set `prefer_async: true` directly in the meltPayload.
			 */
			preferAsync?: boolean;
		},
	): Promise<MeltQuoteBaseResponse & TRes> {
		// TODO: remove with deprecated preferAsync option
		const requestBody: MeltRequest = {
			...meltPayload,
			...(options?.preferAsync ? { prefer_async: true } : {}),
		};
		// Validate method string and make request
		failIf(!this.isValidMethodString(method), `Invalid melt method: ${method}`, this._logger);
		const data = await this.requestWithAuth<MeltQuoteBaseResponse & TRes>(
			'POST',
			`/v1/melt/${method}`,
			{ requestBody },
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

		return this.normalizeMeltBaseResponse(data);
	}

	/**
	 * Requests the mint to pay for a Bolt11 payment request by providing ecash as inputs to be spent.
	 * The inputs contain the amount and the fee_reserves for a Lightning payment. The payload can
	 * also contain blank outputs in order to receive back overpaid Lightning fees.
	 *
	 * @param meltPayload The melt payload containing inputs and optional outputs.
	 * @param options.customRequest Optional override for the request function.
	 * @param options.preferAsync DEPRECATED Set `prefer_async: true` in the meltPayload.
	 * @returns The melt response.
	 */
	async meltBolt11(
		meltPayload: MeltRequest,
		options?: {
			customRequest?: RequestFn;
			/**
			 * @deprecated Set `prefer_async: true` directly in the meltPayload.
			 */
			preferAsync?: boolean;
		},
	): Promise<MeltQuoteBolt11Response> {
		const response = await this.melt<MeltQuoteBolt11Response>('bolt11', meltPayload, options);

		const data = this.normalizeMeltQuoteBolt11Response(response);

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
	 * @param options.preferAsync DEPRECATED Set `prefer_async: true` in the meltPayload.
	 * @returns Payment result with state and optional change signatures.
	 */
	async meltBolt12(
		meltPayload: MeltRequest,
		options?: {
			customRequest?: RequestFn;
			/**
			 * @deprecated Set `prefer_async: true` directly in the meltPayload.
			 */
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

		return {
			...data,
			keysets: data.keysets.map((keyset) => normalizeMintKeys(keyset)),
		};
	}

	/**
	 * Get the mint's keysets in no specific order.
	 *
	 * @param customRequest Optional override for the request function.
	 * @returns All the mint's past and current keysets.
	 */
	async getKeySets(customRequest?: RequestFn): Promise<GetKeysetsResponse> {
		const requestInstance = customRequest ?? this._request;
		const data = await requestInstance<GetKeysetsResponse>({
			endpoint: joinUrls(this._mintUrl, '/v1/keysets'),
		});
		if (!isObj(data) || !Array.isArray(data.keysets)) {
			this._logger.error('Invalid response from mint...', { data, op: 'getKeySets' });
			throw new Error('Invalid response from mint');
		}
		return {
			...data,
			keysets: data.keysets.map((keyset) => normalizeMintKeyset(keyset)),
		};
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

		data.outputs = this.normalizeMessageAmounts(data.outputs);
		data.signatures = this.normalizeSignatureAmounts(data.signatures);
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
	private async handleClearAuth(
		method: 'GET' | 'POST',
		path: string,
		mintInfo?: MintInfo,
	): Promise<string | undefined> {
		if (!this._authProvider) return undefined;
		const info = mintInfo ?? (await this.getLazyMintInfo());
		if (!info.requiresClearAuthToken(method, path)) return undefined;
		if (this._authProvider.ensureCAT) {
			return this._authProvider.ensureCAT(); // optional
		}
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
	private async handleBlindAuth(
		method: 'GET' | 'POST',
		path: string,
		mintInfo?: MintInfo,
	): Promise<string | undefined> {
		if (!this._authProvider) return undefined;
		const info = mintInfo ?? (await this.getLazyMintInfo());
		if (!info.requiresBlindAuthToken(method, path)) return undefined;
		const bat = await this._authProvider.getBlindAuthToken({ method, path });
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
		let mintInfo = this._mintInfo;
		if (this._authProvider) {
			mintInfo = await this.getLazyMintInfo(customRequest);
		}
		// Get BAT/CAT token if this endpoint is protected
		const bat = await this.handleBlindAuth(method, path, mintInfo);
		const cat = await this.handleClearAuth(method, path, mintInfo);
		const headers: Record<string, string> = {
			...(init.headers ?? {}),
			...(bat ? { 'Blind-auth': bat } : {}),
			...(cat ? { 'Clear-auth': cat } : {}),
		};
		const nut19 = mintInfo?.isSupported(19);
		return requestInstance<T>({
			...init,
			endpoint: joinUrls(this._mintUrl, path),
			method,
			headers,
			...(nut19?.supported && nut19.params ? nut19.params : {}),
		});
	}

	private isValidMethodString(method: unknown): boolean {
		// Is a string at least one character long, containing only 0-9, a-z, _ or -
		if (typeof method === 'string' && /^[a-z0-9_-]+$/.test(method)) {
			return true;
		}
		return false;
	}

	/**
	 * Wraps raw `amount` values from JSON into `Amount` objects.
	 *
	 * `SerializedBlindedSignature.amount` is typed as `Amount`, but JSONInt.parse produces `number |
	 * bigint` at the wire boundary. Any code path that receives signatures directly from HTTP (i.e.
	 * without going through this class) must apply the same normalization — see AuthManager.topUp for
	 * an example.
	 */
	private normalizeSignatureAmounts(
		signatures: SerializedBlindedSignature[],
	): SerializedBlindedSignature[] {
		return signatures.map((signature) => ({
			...signature,
			amount: Amount.from(signature.amount),
		}));
	}

	private normalizeMessageAmounts(
		messages: SerializedBlindedMessage[],
	): SerializedBlindedMessage[] {
		return messages.map((message) => ({
			...message,
			amount: Amount.from(message.amount),
		}));
	}

	private normalizeMintQuoteBolt11Response(
		response: MintQuoteBolt11Response,
	): MintQuoteBolt11Response {
		return {
			...response,
			amount: Amount.from(response.amount),
			expiry: normalizeSafeIntegerMetadata(response.expiry, 'mintQuoteBolt11.expiry', null),
		};
	}

	private normalizeMintQuoteBolt12Response(
		response: MintQuoteBolt12Response,
	): MintQuoteBolt12Response {
		return {
			...response,
			amount: response.amount === undefined ? undefined : Amount.from(response.amount),
			expiry: normalizeSafeIntegerMetadata(response.expiry, 'mintQuoteBolt12.expiry', null),
			amount_paid: Amount.from(response.amount_paid),
			amount_issued: Amount.from(response.amount_issued),
		};
	}

	private normalizeMeltBaseResponse<T extends MeltQuoteBaseResponse>(response: T): T {
		return {
			...response,
			amount: Amount.from(response.amount),
			expiry: normalizeSafeIntegerMetadata(response.expiry, 'meltQuote.expiry', undefined),
			change: response.change ? this.normalizeSignatureAmounts(response.change) : undefined,
		};
	}

	private normalizeMeltQuoteBolt11Response(
		response: MeltQuoteBolt11Response,
	): MeltQuoteBolt11Response {
		return {
			...this.normalizeMeltBaseResponse(response),
			fee_reserve: Amount.from(response.fee_reserve),
		};
	}
}

export { Mint };
