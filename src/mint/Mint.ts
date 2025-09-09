/**
 * Cashu Mint "v3"
 *
 * This class is a work-in-progress "alpha" version. It is not yet stable or production-ready and is
 * subject to change.
 *
 * @remarks
 * Not for production use: Continue using the {@link CashuMint} class, which provides the established
 * and tested implementation. This Mint class is experimental and subject to breaking changes during
 * the v3 refactor process.
 * @v3
 */
import type {
	GetInfoResponse,
	PartialMintQuoteResponse,
	MeltQuoteResponse,
	PartialMeltQuoteResponse,
	Bolt12MintQuoteResponse,
	Bolt12MeltQuoteResponse,
	CheckStateResponse,
	PostRestoreResponse,
	SwapResponse,
	CheckStatePayload,
	PostRestorePayload,
	MintResponse,
	ApiError,
} from './types';
import type { MintActiveKeys, MintAllKeysets } from '../model/types/keyset';
import type {
	MintQuotePayload,
	MintPayload,
	MeltQuotePayload,
	MeltPayload,
	SwapPayload,
	Bolt12MintQuotePayload,
} from '../wallet/types';
import { MeltQuoteState } from './types';
import request, {
	ConnectionManager,
	type WSConnection,
	setRequestLogger,
	type RequestFn,
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
import { type Logger, NULL_LOGGER } from '../logger';

/**
 * Class represents Cashu Mint API.
 *
 * @remarks
 * This class contains lower-level functions that are implemented by CashuWallet.
 * @v3
 */
class Mint {
	private ws?: WSConnection;
	private _mintInfo?: MintInfo;
	private _authTokenGetter?: () => Promise<string>;
	private _checkNut22 = false;
	private _logger: Logger;
	private _request: RequestFn;

	/**
	 * @param _mintUrl Requires mint URL to create this object.
	 * @param customRequest Optional, for custom network communication with the mint.
	 * @param authTokenGetter Optional. Function to obtain a NUT-22 BlindedAuthToken (e.g. from a
	 *   database or localstorage)
	 */
	constructor(
		private _mintUrl: string,
		customRequest?: RequestFn,
		authTokenGetter?: () => Promise<string>,
		options?: {
			logger?: Logger;
		},
	) {
		this._mintUrl = sanitizeUrl(_mintUrl);
		this._request = customRequest ?? request;
		if (authTokenGetter) {
			this._checkNut22 = true;
			this._authTokenGetter = authTokenGetter;
		}
		this._logger = options?.logger ?? NULL_LOGGER;
		setRequestLogger(this._logger);
	}

	//TODO: v3 - refactor Mint to take two or less args.

	get mintUrl() {
		return this._mintUrl;
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
	async swap(swapPayload: SwapPayload, customRequest?: RequestFn): Promise<SwapResponse> {
		const blindAuthToken = await this.handleBlindAuth('/v1/swap');
		const requestInstance = customRequest ?? this._request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const data = await requestInstance<SwapResponse>({
			endpoint: joinUrls(this._mintUrl, '/v1/swap'),
			method: 'POST',
			requestBody: swapPayload,
			headers,
		});

		if (!isObj(data) || !Array.isArray(data?.signatures)) {
			const errDetail = isObj(data) && 'detail' in data ? (data as ApiError).detail : undefined;
			throw new Error(errDetail ?? 'bad response');
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
	async createMintQuote(
		mintQuotePayload: MintQuotePayload,
		customRequest?: RequestFn,
	): Promise<PartialMintQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth('/v1/mint/quote/bolt11');
		const requestInstance = customRequest ?? this._request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<
			PartialMintQuoteResponse & MintQuoteResponsePaidDeprecated
		>({
			endpoint: joinUrls(this._mintUrl, '/v1/mint/quote/bolt11'),
			method: 'POST',
			requestBody: mintQuotePayload,
			headers,
		});
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
		mintQuotePayload: Bolt12MintQuotePayload,
		customRequest?: RequestFn,
	): Promise<Bolt12MintQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth('/v1/mint/quote/bolt12');
		const requestInstance = customRequest ?? this._request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<Bolt12MintQuoteResponse>({
			endpoint: joinUrls(this._mintUrl, '/v1/mint/quote/bolt12'),
			method: 'POST',
			requestBody: mintQuotePayload,
			headers,
		});
		return response;
	}

	/**
	 * Gets an existing mint quote from the mint.
	 *
	 * @param quote Quote ID.
	 * @param customRequest Optional override for the request function.
	 * @returns The status of the mint quote, including payment details and state.
	 */
	async checkMintQuote(
		quote: string,
		customRequest?: RequestFn,
	): Promise<PartialMintQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth(`/v1/mint/quote/bolt11/${quote}`);
		const requestInstance = customRequest ?? this._request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<
			PartialMintQuoteResponse & MintQuoteResponsePaidDeprecated
		>({
			endpoint: joinUrls(this._mintUrl, '/v1/mint/quote/bolt11', quote),
			method: 'GET',
			headers,
		});

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
	): Promise<Bolt12MintQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth(`/v1/mint/quote/bolt12/${quote}`);
		const requestInstance = customRequest ?? this._request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<Bolt12MintQuoteResponse>({
			endpoint: joinUrls(this._mintUrl, '/v1/mint/quote/bolt12', quote),
			method: 'GET',
			headers,
		});
		return response;
	}

	/**
	 * Mints new tokens by requesting blind signatures on the provided outputs.
	 *
	 * @param mintPayload Payload containing the outputs to get blind signatures on.
	 * @param customRequest Optional override for the request function.
	 * @returns Serialized blinded signatures.
	 */
	async mint(mintPayload: MintPayload, customRequest?: RequestFn): Promise<MintResponse> {
		const blindAuthToken = await this.handleBlindAuth('/v1/mint/bolt11');
		const requestInstance = customRequest ?? this._request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const data = await requestInstance<MintResponse>({
			endpoint: joinUrls(this._mintUrl, '/v1/mint/bolt11'),
			method: 'POST',
			requestBody: mintPayload,
			headers,
		});

		if (!isObj(data) || !Array.isArray(data?.signatures)) {
			const errDetail = isObj(data) && 'detail' in data ? (data as ApiError).detail : undefined;
			throw new Error(errDetail ?? 'bad response');
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
	async mintBolt12(mintPayload: MintPayload, customRequest?: RequestFn): Promise<MintResponse> {
		const blindAuthToken = await this.handleBlindAuth('/v1/mint/bolt12');
		const requestInstance = customRequest ?? this._request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const data = await requestInstance<MintResponse>({
			endpoint: joinUrls(this._mintUrl, '/v1/mint/bolt12'),
			method: 'POST',
			requestBody: mintPayload,
			headers,
		});

		if (!isObj(data) || !Array.isArray(data?.signatures)) {
			const errDetail = isObj(data) && 'detail' in data ? (data as ApiError).detail : undefined;
			throw new Error(errDetail ?? 'bad response');
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
	async createMeltQuote(
		meltQuotePayload: MeltQuotePayload,
		customRequest?: RequestFn,
	): Promise<PartialMeltQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth('/v1/melt/quote/bolt11');
		const requestInstance = customRequest ?? this._request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<
			PartialMeltQuoteResponse & MeltQuoteResponsePaidDeprecated
		>({
			endpoint: joinUrls(this._mintUrl, '/v1/melt/quote/bolt11'),
			method: 'POST',
			requestBody: meltQuotePayload,
			headers,
		});

		const data = handleMeltQuoteResponseDeprecated(response, this._logger);

		if (
			!isObj(data) ||
			typeof data?.amount !== 'number' ||
			typeof data?.fee_reserve !== 'number' ||
			typeof data?.quote !== 'string'
		) {
			const errDetail = isObj(data) && 'detail' in data ? (data as ApiError).detail : undefined;
			throw new Error(errDetail ?? 'bad response');
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
		meltQuotePayload: MeltQuotePayload,
		customRequest?: RequestFn,
	): Promise<Bolt12MeltQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth('/v1/melt/quote/bolt12');
		const requestInstance = customRequest ?? this._request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<Bolt12MeltQuoteResponse>({
			endpoint: joinUrls(this._mintUrl, '/v1/melt/quote/bolt12'),
			method: 'POST',
			requestBody: meltQuotePayload,
			headers,
		});
		return response;
	}

	/**
	 * Gets an existing melt quote.
	 *
	 * @param quote Quote ID.
	 * @param customRequest Optional override for the request function.
	 * @returns The melt quote response.
	 */
	async checkMeltQuote(
		quote: string,
		customRequest?: RequestFn,
	): Promise<PartialMeltQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth(`/v1/melt/quote/bolt11/${quote}`);
		const requestInstance = customRequest ?? this._request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<MeltQuoteResponse & MeltQuoteResponsePaidDeprecated>({
			endpoint: joinUrls(this._mintUrl, '/v1/melt/quote/bolt11', quote),
			method: 'GET',
			headers,
		});

		const data = handleMeltQuoteResponseDeprecated(response, this._logger);

		if (
			!isObj(data) ||
			typeof data?.amount !== 'number' ||
			typeof data?.fee_reserve !== 'number' ||
			typeof data?.quote !== 'string' ||
			typeof data?.state !== 'string' ||
			!Object.values(MeltQuoteState).includes(data.state)
		) {
			const errDetail = isObj(data) && 'detail' in data ? (data as ApiError).detail : undefined;
			throw new Error(errDetail ?? 'bad response');
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
	): Promise<Bolt12MeltQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth(`/v1/melt/quote/bolt12/${quote}`);
		const requestInstance = customRequest ?? this._request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<Bolt12MeltQuoteResponse>({
			endpoint: joinUrls(this._mintUrl, '/v1/melt/quote/bolt12', quote),
			method: 'GET',
			headers,
		});
		return response;
	}

	/**
	 * Requests the mint to pay for a Bolt11 payment request by providing ecash as inputs to be spent.
	 * The inputs contain the amount and the fee_reserves for a Lightning payment. The payload can
	 * also contain blank outputs in order to receive back overpaid Lightning fees.
	 *
	 * @param meltPayload The melt payload containing inputs and optional outputs.
	 * @param customRequest Optional override for the request function.
	 * @returns The melt response.
	 */
	async melt(
		meltPayload: MeltPayload,
		customRequest?: RequestFn,
	): Promise<PartialMeltQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth('/v1/melt/bolt11');
		const requestInstance = customRequest ?? this._request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const response = await requestInstance<MeltQuoteResponse & MeltQuoteResponsePaidDeprecated>({
			endpoint: joinUrls(this._mintUrl, '/v1/melt/bolt11'),
			method: 'POST',
			requestBody: meltPayload,
			headers,
		});

		const data = handleMeltQuoteResponseDeprecated(response, this._logger);

		if (
			!isObj(data) ||
			typeof data?.state !== 'string' ||
			!Object.values(MeltQuoteState).includes(data.state)
		) {
			const errDetail = isObj(data) && 'detail' in data ? (data as ApiError).detail : undefined;
			throw new Error(errDetail ?? 'bad response');
		}

		return data;
	}

	/**
	 * Requests the mint to pay a BOLT12 offer by providing ecash inputs to be spent. The inputs must
	 * cover the amount plus fee reserves. Optional outputs can be included to receive change for
	 * overpaid Lightning fees.
	 *
	 * @param meltPayload Payload containing quote ID, inputs, and optional outputs for change.
	 * @param customRequest Optional override for the request function.
	 * @returns Payment result with state and optional change signatures.
	 */
	async meltBolt12(
		meltPayload: MeltPayload,
		customRequest?: RequestFn,
	): Promise<Bolt12MeltQuoteResponse> {
		const blindAuthToken = await this.handleBlindAuth('/v1/melt/bolt12');
		const requestInstance = customRequest ?? this._request;
		const headers: Record<string, string> = blindAuthToken ? { 'Blind-auth': blindAuthToken } : {};
		const data = await requestInstance<Bolt12MeltQuoteResponse>({
			endpoint: joinUrls(this._mintUrl, '/v1/melt/bolt12'),
			method: 'POST',
			requestBody: meltPayload,
			headers,
		});
		return data;
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
		const requestInstance = customRequest ?? this._request;
		const data = await requestInstance<CheckStateResponse>({
			endpoint: joinUrls(this._mintUrl, '/v1/checkstate'),
			method: 'POST',
			requestBody: checkPayload,
		});

		if (!isObj(data) || !Array.isArray(data?.states)) {
			const errDetail = isObj(data) && 'detail' in data ? (data as ApiError).detail : undefined;
			throw new Error(errDetail ?? 'bad response');
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
	): Promise<MintActiveKeys> {
		const targetUrl = mintUrl || this._mintUrl;
		// backwards compatibility for base64 encoded keyset ids
		if (keysetId) {
			// make the keysetId url safe
			keysetId = keysetId.replace(/\//g, '_').replace(/\+/g, '-');
		}
		const requestInstance = customRequest ?? this._request;
		const data = await requestInstance<MintActiveKeys>({
			endpoint: keysetId
				? joinUrls(targetUrl, '/v1/keys', keysetId)
				: joinUrls(targetUrl, '/v1/keys'),
		});

		if (!isObj(data) || !Array.isArray(data.keysets)) {
			const errDetail = isObj(data) && 'detail' in data ? (data as ApiError).detail : undefined;
			throw new Error(errDetail ?? 'bad response');
		}

		return data;
	}

	/**
	 * Get the mint's keysets in no specific order.
	 *
	 * @param customRequest Optional override for the request function.
	 * @returns All the mint's past and current keysets.
	 */
	async getKeySets(customRequest?: RequestFn): Promise<MintAllKeysets> {
		const requestInstance = customRequest ?? this._request;
		return requestInstance<MintAllKeysets>({ endpoint: joinUrls(this._mintUrl, '/v1/keysets') });
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
			const errDetail = isObj(data) && 'detail' in data ? (data as ApiError).detail : undefined;
			throw new Error(errDetail ?? 'bad response');
		}

		return data;
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

	/**
	 * Handles blind authentication if required for the given path.
	 *
	 * @param path The API path to check for blind auth requirement.
	 * @returns The blind auth token if required, otherwise undefined.
	 */
	async handleBlindAuth(path: string): Promise<string | undefined> {
		if (!this._checkNut22) {
			return undefined;
		}
		const info = await this.getLazyMintInfo();
		if (info.requiresBlindAuthToken(path)) {
			if (!this._authTokenGetter) {
				throw new Error('Cannot call a protected endpoint without authTokenGetter');
			}
			return this._authTokenGetter();
		}
		return undefined;
	}
}

export { Mint };
