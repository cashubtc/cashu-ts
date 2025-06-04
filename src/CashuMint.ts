import { ConnectionManager, type WSConnection } from './WSConnection';
import type {
	CheckStatePayload,
	CheckStateResponse,
	GetInfoResponse,
	MeltPayload,
	MintActiveKeys,
	MintAllKeysets,
	PostRestoreResponse,
	SerializedBlindedMessage,
	SwapPayload,
	SwapResponse,
	MintQuotePayload,
	MintPayload,
	MintResponse,
	PostRestorePayload,
	MeltQuotePayload,
	MeltQuoteResponse,
	PartialMintQuoteResponse,
	PartialMeltQuoteResponse,
	GetFilterResponse,
} from './model/types/index';
import { MeltQuoteState } from './model/types/index';
import request, { setRequestLogger } from './request';
import { isObj, joinUrls, sanitizeUrl } from './utils';
import {
	type MeltQuoteResponsePaidDeprecated,
	handleMeltQuoteResponseDeprecated,
} from './legacy/nut-05';
import {
	type MintQuoteResponsePaidDeprecated,
	handleMintQuoteResponseDeprecated,
} from './legacy/nut-04';
import { handleMintInfoContactFieldDeprecated } from './legacy/nut-06';
import { MintInfo } from './model/MintInfo';
import { type Logger, NULL_LOGGER } from './logger';
/**
 * Class represents Cashu Mint API. This class contains Lower level functions that are implemented
 * by CashuWallet.
 */
class CashuMint {
	private ws?: WSConnection;
	private _mintInfo?: MintInfo;
	private _authTokenGetter?: () => Promise<string>;
	private _checkNut22 = false;
	private _logger: Logger;
	/**
	 * @param _mintUrl Requires mint URL to create this object.
	 * @param _customRequest If passed, use custom request implementation for network communication
	 *   with the mint.
	 * @param [authTokenGetter] A function that is called by the CashuMint instance to obtain a NUT-22
	 *   BlindedAuthToken (e.g. from a database or localstorage)
	 */
	constructor(
		private _mintUrl: string,
		private _customRequest?: typeof request,
		authTokenGetter?: () => Promise<string>,
		options?: {
			logger?: Logger;
		},
	) {
		this._mintUrl = sanitizeUrl(_mintUrl);
		this._customRequest = _customRequest;
		if (authTokenGetter) {
			this._checkNut22 = true;
			this._authTokenGetter = authTokenGetter;
		}
		this._logger = options?.logger ?? NULL_LOGGER;
		setRequestLogger(this._logger);
	}

	//TODO: v3 - refactor CashuMint to take two or less args.

	get mintUrl() {
		return this._mintUrl;
	}

	/**
	 * Fetches mints info at the /info endpoint.
	 *
	 * @param mintUrl
	 * @param customRequest
	 */
	public static async getInfo(
		mintUrl: string,
		customRequest?: typeof request,
		logger?: Logger,
	): Promise<GetInfoResponse> {
		const mintLogger = logger ?? NULL_LOGGER;
		const requestInstance = customRequest || request;
		const response = await requestInstance<GetInfoResponse>({
			endpoint: joinUrls(mintUrl, '/v1/info'),
		});
		const data = handleMintInfoContactFieldDeprecated(response, mintLogger);
		return data;
	}
	/**
	 * Fetches mints info at the /info endpoint.
	 */
	async getInfo(): Promise<GetInfoResponse> {
		return CashuMint.getInfo(this._mintUrl, this._customRequest, this._logger);
	}

	async getLazyMintInfo(): Promise<MintInfo> {
		if (this._mintInfo) {
			return this._mintInfo;
		}
		const data = await CashuMint.getInfo(this._mintUrl, this._customRequest);
		this._mintInfo = new MintInfo(data);
		return this._mintInfo;
	}

	/**
	 * Performs a swap operation with ecash inputs and outputs.
	 *
	 * @param mintUrl
	 * @param swapPayload Payload containing inputs and outputs.
	 * @param customRequest
	 * @returns Signed outputs.
	 */
	public static async swap(
		mintUrl: string,
		swapPayload: SwapPayload,
		customRequest?: typeof request,
		blindAuthToken?: string,
	): Promise<SwapResponse> {
		const requestInstance = customRequest || request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const data = await requestInstance<SwapResponse>({
			endpoint: joinUrls(mintUrl, '/v1/swap'),
			method: 'POST',
			requestBody: swapPayload,
			headers,
		});

		if (!isObj(data) || !Array.isArray(data?.signatures)) {
			throw new Error(data.detail ?? 'bad response');
		}

		return data;
	}
	/**
	 * Performs a swap operation with ecash inputs and outputs.
	 *
	 * @param swapPayload Payload containing inputs and outputs.
	 * @returns Signed outputs.
	 */
	async swap(swapPayload: SwapPayload): Promise<SwapResponse> {
		const blindAuthToken = await this.handleBlindAuth('/v1/swap');
		return CashuMint.swap(this._mintUrl, swapPayload, this._customRequest, blindAuthToken);
	}

	/**
	 * Requests a new mint quote from the mint.
	 *
	 * @param mintUrl
	 * @param mintQuotePayload Payload for creating a new mint quote.
	 * @param customRequest
	 * @returns The mint will create and return a new mint quote containing a payment request for the
	 *   specified amount and unit.
	 */
	public static async createMintQuote(
		mintUrl: string,
		mintQuotePayload: MintQuotePayload,
		customRequest?: typeof request,
		blindAuthToken?: string,
		logger?: Logger,
	): Promise<PartialMintQuoteResponse> {
		const mintLogger = logger ?? NULL_LOGGER;
		const requestInstance = customRequest || request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<
			PartialMintQuoteResponse & MintQuoteResponsePaidDeprecated
		>({
			endpoint: joinUrls(mintUrl, '/v1/mint/quote/bolt11'),
			method: 'POST',
			requestBody: mintQuotePayload,
			headers,
		});
		const data = handleMintQuoteResponseDeprecated(response, mintLogger);
		return data;
	}
	/**
	 * Requests a new mint quote from the mint.
	 *
	 * @param mintQuotePayload Payload for creating a new mint quote.
	 * @returns The mint will create and return a new mint quote containing a payment request for the
	 *   specified amount and unit.
	 */
	async createMintQuote(mintQuotePayload: MintQuotePayload): Promise<PartialMintQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth('/v1/mint/quote/bolt11');
		return CashuMint.createMintQuote(
			this._mintUrl,
			mintQuotePayload,
			this._customRequest,
			blindAuthToken,
		);
	}

	/**
	 * Gets an existing mint quote from the mint.
	 *
	 * @param mintUrl
	 * @param quote Quote ID.
	 * @param customRequest
	 * @returns The mint will create and return a Lightning invoice for the specified amount.
	 */
	public static async checkMintQuote(
		mintUrl: string,
		quote: string,
		customRequest?: typeof request,
		blindAuthToken?: string,
		logger?: Logger,
	): Promise<PartialMintQuoteResponse> {
		const mintLogger = logger ?? NULL_LOGGER;
		const requestInstance = customRequest || request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<
			PartialMintQuoteResponse & MintQuoteResponsePaidDeprecated
		>({
			endpoint: joinUrls(mintUrl, '/v1/mint/quote/bolt11', quote),
			method: 'GET',
			headers,
		});

		const data = handleMintQuoteResponseDeprecated(response, mintLogger);
		return data;
	}
	/**
	 * Gets an existing mint quote from the mint.
	 *
	 * @param quote Quote ID.
	 * @returns The mint will create and return a Lightning invoice for the specified amount.
	 */
	async checkMintQuote(quote: string): Promise<PartialMintQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth(`/v1/mint/quote/bolt11/${quote}`);
		return CashuMint.checkMintQuote(this._mintUrl, quote, this._customRequest, blindAuthToken);
	}

	/**
	 * Mints new tokens by requesting blind signatures on the provided outputs.
	 *
	 * @param mintUrl
	 * @param mintPayload Payload containing the outputs to get blind signatures on.
	 * @param customRequest
	 * @returns Serialized blinded signatures.
	 */
	public static async mint(
		mintUrl: string,
		mintPayload: MintPayload,
		customRequest?: typeof request,
		blindAuthToken?: string,
	) {
		const requestInstance = customRequest || request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const data = await requestInstance<MintResponse>({
			endpoint: joinUrls(mintUrl, '/v1/mint/bolt11'),
			method: 'POST',
			requestBody: mintPayload,
			headers,
		});

		if (!isObj(data) || !Array.isArray(data?.signatures)) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Mints new tokens by requesting blind signatures on the provided outputs.
	 *
	 * @param mintPayload Payload containing the outputs to get blind signatures on.
	 * @returns Serialized blinded signatures.
	 */
	async mint(mintPayload: MintPayload) {
		const blindAuthToken = await this.handleBlindAuth('/v1/mint/bolt11');
		return CashuMint.mint(this._mintUrl, mintPayload, this._customRequest, blindAuthToken);
	}

	/**
	 * Requests a new melt quote from the mint.
	 *
	 * @param mintUrl
	 * @param MeltQuotePayload
	 * @returns
	 */
	public static async createMeltQuote(
		mintUrl: string,
		meltQuotePayload: MeltQuotePayload,
		customRequest?: typeof request,
		blindAuthToken?: string,
		logger?: Logger,
	): Promise<PartialMeltQuoteResponse> {
		const mintLogger = logger ?? NULL_LOGGER;
		const requestInstance = customRequest || request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<
			PartialMeltQuoteResponse & MeltQuoteResponsePaidDeprecated
		>({
			endpoint: joinUrls(mintUrl, '/v1/melt/quote/bolt11'),
			method: 'POST',
			requestBody: meltQuotePayload,
			headers,
		});

		const data = handleMeltQuoteResponseDeprecated(response, mintLogger);

		if (
			!isObj(data) ||
			typeof data?.amount !== 'number' ||
			typeof data?.fee_reserve !== 'number' ||
			typeof data?.quote !== 'string'
		) {
			throw new Error('bad response');
		}
		return data;
	}
	/**
	 * Requests a new melt quote from the mint.
	 *
	 * @param MeltQuotePayload
	 * @returns
	 */
	async createMeltQuote(meltQuotePayload: MeltQuotePayload): Promise<PartialMeltQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth('/v1/melt/quote/bolt11');
		return CashuMint.createMeltQuote(
			this._mintUrl,
			meltQuotePayload,
			this._customRequest,
			blindAuthToken,
		);
	}

	/**
	 * Gets an existing melt quote.
	 *
	 * @param mintUrl
	 * @param quote Quote ID.
	 * @returns
	 */
	public static async checkMeltQuote(
		mintUrl: string,
		quote: string,
		customRequest?: typeof request,
		blindAuthToken?: string,
		logger?: Logger,
	): Promise<PartialMeltQuoteResponse> {
		const mintLogger = logger ?? NULL_LOGGER;
		const requestInstance = customRequest || request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<MeltQuoteResponse & MeltQuoteResponsePaidDeprecated>({
			endpoint: joinUrls(mintUrl, '/v1/melt/quote/bolt11', quote),
			method: 'GET',
			headers,
		});

		const data = handleMeltQuoteResponseDeprecated(response, mintLogger);

		if (
			!isObj(data) ||
			typeof data?.amount !== 'number' ||
			typeof data?.fee_reserve !== 'number' ||
			typeof data?.quote !== 'string' ||
			typeof data?.state !== 'string' ||
			!Object.values(MeltQuoteState).includes(data.state)
		) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Gets an existing melt quote.
	 *
	 * @param quote Quote ID.
	 * @returns
	 */
	async checkMeltQuote(quote: string): Promise<PartialMeltQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth(`/v1/melt/quote/bolt11/${quote}`);
		return CashuMint.checkMeltQuote(this._mintUrl, quote, this._customRequest, blindAuthToken);
	}

	/**
	 * Requests the mint to pay for a Bolt11 payment request by providing ecash as inputs to be spent.
	 * The inputs contain the amount and the fee_reserves for a Lightning payment. The payload can
	 * also contain blank outputs in order to receive back overpaid Lightning fees.
	 *
	 * @param mintUrl
	 * @param meltPayload
	 * @param customRequest
	 * @returns
	 */
	public static async melt(
		mintUrl: string,
		meltPayload: MeltPayload,
		customRequest?: typeof request,
		blindAuthToken?: string,
		logger?: Logger,
	): Promise<PartialMeltQuoteResponse> {
		const mintLogger = logger ?? NULL_LOGGER;
		const requestInstance = customRequest || request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<MeltQuoteResponse & MeltQuoteResponsePaidDeprecated>({
			endpoint: joinUrls(mintUrl, '/v1/melt/bolt11'),
			method: 'POST',
			requestBody: meltPayload,
			headers,
		});

		const data = handleMeltQuoteResponseDeprecated(response, mintLogger);

		if (
			!isObj(data) ||
			typeof data?.state !== 'string' ||
			!Object.values(MeltQuoteState).includes(data.state)
		) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Ask mint to perform a melt operation. This pays a lightning invoice and destroys tokens
	 * matching its amount + fees.
	 *
	 * @param meltPayload
	 * @returns
	 */
	async melt(meltPayload: MeltPayload): Promise<PartialMeltQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth('/v1/melt/bolt11');
		return CashuMint.melt(this._mintUrl, meltPayload, this._customRequest, blindAuthToken);
	}
	/**
	 * Checks if specific proofs have already been redeemed.
	 *
	 * @param mintUrl
	 * @param checkPayload
	 * @param customRequest
	 * @returns Redeemed and unredeemed ordered list of booleans.
	 */
	public static async check(
		mintUrl: string,
		checkPayload: CheckStatePayload,
		customRequest?: typeof request,
	): Promise<CheckStateResponse> {
		const requestInstance = customRequest || request;
		const data = await requestInstance<CheckStateResponse>({
			endpoint: joinUrls(mintUrl, '/v1/checkstate'),
			method: 'POST',
			requestBody: checkPayload,
		});

		if (!isObj(data) || !Array.isArray(data?.states)) {
			throw new Error('bad response');
		}

		return data;
	}

	/**
	 * Get the mints public keys.
	 *
	 * @param mintUrl
	 * @param keysetId Optional param to get the keys for a specific keyset. If not specified, the
	 *   keys from all active keysets are fetched.
	 * @param customRequest
	 * @returns
	 */
	public static async getKeys(
		mintUrl: string,
		keysetId?: string,
		customRequest?: typeof request,
	): Promise<MintActiveKeys> {
		// backwards compatibility for base64 encoded keyset ids
		if (keysetId) {
			// make the keysetId url safe
			keysetId = keysetId.replace(/\//g, '_').replace(/\+/g, '-');
		}
		const requestInstance = customRequest || request;
		const data = await requestInstance<MintActiveKeys>({
			endpoint: keysetId ? joinUrls(mintUrl, '/v1/keys', keysetId) : joinUrls(mintUrl, '/v1/keys'),
		});

		if (!isObj(data) || !Array.isArray(data.keysets)) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Get the mints public keys.
	 *
	 * @param keysetId Optional param to get the keys for a specific keyset. If not specified, the
	 *   keys from all active keysets are fetched.
	 * @returns The mints public keys.
	 */
	async getKeys(keysetId?: string, mintUrl?: string): Promise<MintActiveKeys> {
		const allKeys = await CashuMint.getKeys(
			mintUrl || this._mintUrl,
			keysetId,
			this._customRequest,
		);
		return allKeys;
	}
	/**
	 * Get the mints keysets in no specific order.
	 *
	 * @param mintUrl
	 * @param customRequest
	 * @returns All the mints past and current keysets.
	 */
	public static async getKeySets(
		mintUrl: string,
		customRequest?: typeof request,
	): Promise<MintAllKeysets> {
		const requestInstance = customRequest || request;
		return requestInstance<MintAllKeysets>({ endpoint: joinUrls(mintUrl, '/v1/keysets') });
	}

	/**
	 * Get the mints keysets in no specific order.
	 *
	 * @returns All the mints past and current keysets.
	 */
	async getKeySets(): Promise<MintAllKeysets> {
		return CashuMint.getKeySets(this._mintUrl, this._customRequest);
	}

	/**
	 * Checks if specific proofs have already been redeemed.
	 *
	 * @param checkPayload
	 * @returns Redeemed and unredeemed ordered list of booleans.
	 */
	async check(checkPayload: CheckStatePayload): Promise<CheckStateResponse> {
		return CashuMint.check(this._mintUrl, checkPayload, this._customRequest);
	}

	public static async restore(
		mintUrl: string,
		restorePayload: PostRestorePayload,
		customRequest?: typeof request,
	): Promise<PostRestoreResponse> {
		const requestInstance = customRequest || request;
		const data = await requestInstance<PostRestoreResponse>({
			endpoint: joinUrls(mintUrl, '/v1/restore'),
			method: 'POST',
			requestBody: restorePayload,
		});

		if (!isObj(data) || !Array.isArray(data?.outputs) || !Array.isArray(data?.signatures)) {
			throw new Error('bad response');
		}

		return data;
	}

	async restore(restorePayload: {
		outputs: SerializedBlindedMessage[];
	}): Promise<PostRestoreResponse> {
		return CashuMint.restore(this._mintUrl, restorePayload, this._customRequest);
	}

	public static async getSpentFilter(
		mintUrl: string,
		keysetId: string,
		customRequest?: typeof request
	): Promise<GetFilterResponse> {
		const requestInstance = customRequest || request;
		const data = await requestInstance<GetFilterResponse>({
			endpoint: joinUrls(mintUrl, `/v1/filter/spent/${keysetId}`),
			method: 'GET'
		});

		if (!isObj(data) || !data?.content) {
			throw new Error('bad response');
		}

		return data;
	}

	public static async getIssuedFilter(
		mintUrl: string,
		keysetId: string,
		customRequest?: typeof request
	): Promise<GetFilterResponse> {
		const requestInstance = customRequest || request;
		const data = await requestInstance<GetFilterResponse>({
			endpoint: joinUrls(mintUrl, `/v1/filter/issued/${keysetId}`),
			method: 'GET'
		});

		if (!isObj(data) || !data?.content) {
			throw new Error('bad response');
		}

		return data;
	}

	/**
	 * Gets the GCS spent ecash filter for the specific keyset
	 * @param keysetId the keyset ID
	 * @returns response containing the compressed set and its parameters
	 */
	async getSpentFilter(keysetId: string): Promise<GetFilterResponse> {
		return CashuMint.getSpentFilter(this._mintUrl, keysetId, this._customRequest);
	}

	/**
	 * Gets the GCS issued blind messages for the specific keyset
	 * @param keysetId the keyset ID
	 * @returns response containing the compressed set and its parameters
	 */
	async getIssuedFilter(keysetId: string): Promise<GetFilterResponse> {
		return CashuMint.getIssuedFilter(this._mintUrl, keysetId, this._customRequest);
	}

	/**
	 * Tries to establish a websocket connection with the websocket mint url according to NUT-17.
	 */
	async connectWebSocket() {
		if (this.ws) {
			await this.ws.ensureConnection();
		} else {
			const mintUrl = new URL(this._mintUrl);
			const wsSegment = 'v1/ws';
			if (mintUrl.pathname) {
				if (mintUrl.pathname.endsWith('/')) {
					mintUrl.pathname += wsSegment;
				} else {
					mintUrl.pathname += '/' + wsSegment;
				}
			}
			this.ws = ConnectionManager.getInstance().getConnection(
				`${mintUrl.protocol === 'https:' ? 'wss' : 'ws'}://${mintUrl.host}${mintUrl.pathname}`,
			);
			try {
				await this.ws.connect();
			} catch (e) {
				this._logger.error('Failed to connect to WebSocket...', { e });
				throw new Error('Failed to connect to WebSocket...');
			}
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

	async handleBlindAuth(path: string) {
		if (!this._checkNut22) {
			return;
		}
		const info = await this.getLazyMintInfo();
		if (info.requiresBlindAuthToken(path)) {
			if (!this._authTokenGetter) {
				throw new Error('Can not call a protected endpoint without authProofGetter');
			}
			return this._authTokenGetter();
		}
		return undefined;
	}
}

export { CashuMint };
