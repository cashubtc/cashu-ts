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
	WSConnection,
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
	type MintQuoteBaseResponse,
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
		return MintInfo.normalizeInfo(response);
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

	// -----------------------------------------------------------------
	// Section: Swap
	// -----------------------------------------------------------------

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

	// -----------------------------------------------------------------
	// Section: Create Mint Quote
	// -----------------------------------------------------------------

	/**
	 * Creates a mint quote for any payment method.
	 *
	 * @remarks
	 * Uses `/v1/mint/quote/{method}` and validates method format. Base normalization is applied
	 * automatically. For first-class methods (bolt11/bolt12), method-specific normalization is
	 * stacked on top. Custom methods can supply an optional `normalize` callback for their own
	 * fields.
	 * @param method The payment method (e.g., 'bolt11', 'bolt12', or custom method name).
	 * @param payload The request body to POST (method-specific fields).
	 * @param options.customRequest Optional override for the request function.
	 * @param options.normalize Optional callback to normalize method-specific response fields.
	 * @returns The mint quote response.
	 */
	async createMintQuote<TRes extends MintQuoteBaseResponse = MintQuoteBaseResponse>(
		method: string,
		payload: Record<string, unknown>,
		options?: { customRequest?: RequestFn; normalize?: (raw: Record<string, unknown>) => TRes },
	): Promise<TRes> {
		failIf(!this.isValidMethodString(method), `Invalid mint quote method: ${method}`, this._logger);
		const response = await this.requestWithAuth<TRes>(
			'POST',
			`/v1/mint/quote/${method}`,
			{ requestBody: payload },
			options?.customRequest,
		);
		return this.normalizeMintQuoteResponse(method, response, options?.normalize);
	}

	/**
	 * Requests a new mint quote from the mint.
	 *
	 * @remarks
	 * Thin wrapper around createMintQuote('bolt11', ...).
	 * @param mintQuotePayload Payload for creating a new mint quote.
	 * @param customRequest Optional override for the request function.
	 * @returns A new mint quote containing a payment request for the specified amount and unit.
	 */
	async createMintQuoteBolt11(
		mintQuotePayload: MintQuoteBolt11Request,
		customRequest?: RequestFn,
	): Promise<MintQuoteBolt11Response> {
		return this.createMintQuote<MintQuoteBolt11Response>(
			'bolt11',
			{
				...mintQuotePayload,
				amount: Amount.from(mintQuotePayload.amount).toBigInt(),
			},
			{ customRequest },
		);
	}

	/**
	 * Requests a new BOLT12 mint quote from the mint using Lightning Network offers.
	 *
	 * @remarks
	 * Thin wrapper around createMintQuote('bolt12', ...).
	 * @param mintQuotePayload Payload containing amount, unit, optional description, and required
	 *   pubkey.
	 * @param customRequest Optional override for the request function.
	 * @returns A mint quote containing a BOLT12 offer.
	 */
	async createMintQuoteBolt12(
		mintQuotePayload: MintQuoteBolt12Request,
		customRequest?: RequestFn,
	): Promise<MintQuoteBolt12Response> {
		const body: Record<string, unknown> = { ...mintQuotePayload };
		if (mintQuotePayload.amount !== undefined) {
			body.amount = Amount.from(mintQuotePayload.amount).toBigInt();
		}
		return this.createMintQuote<MintQuoteBolt12Response>('bolt12', body, { customRequest });
	}

	// -----------------------------------------------------------------
	// Section: Check Mint Quote
	// -----------------------------------------------------------------

	/**
	 * Checks an existing mint quote for any payment method.
	 *
	 * @remarks
	 * Uses `/v1/mint/quote/{method}/{quote}` and validates method format. Normalization follows the
	 * same stacking pattern as {@link Mint.createMintQuote}.
	 * @param method The payment method (e.g., 'bolt11', 'bolt12', or custom method name).
	 * @param quote Quote ID.
	 * @param options.customRequest Optional override for the request function.
	 * @param options.normalize Optional callback to normalize method-specific response fields.
	 * @returns The mint quote response.
	 */
	async checkMintQuote<TRes extends MintQuoteBaseResponse = MintQuoteBaseResponse>(
		method: string,
		quote: string,
		options?: { customRequest?: RequestFn; normalize?: (raw: Record<string, unknown>) => TRes },
	): Promise<TRes> {
		failIf(!this.isValidMethodString(method), `Invalid mint quote method: ${method}`, this._logger);
		const response = await this.requestWithAuth<TRes>(
			'GET',
			`/v1/mint/quote/${method}/${quote}`,
			{},
			options?.customRequest,
		);
		return this.normalizeMintQuoteResponse(method, response, options?.normalize);
	}

	/**
	 * Gets an existing mint quote from the mint.
	 *
	 * @remarks
	 * Thin wrapper around checkMintQuote('bolt11', ...).
	 * @param quote Quote ID.
	 * @param customRequest Optional override for the request function.
	 * @returns The status of the mint quote, including payment details and state.
	 */
	async checkMintQuoteBolt11(
		quote: string,
		customRequest?: RequestFn,
	): Promise<MintQuoteBolt11Response> {
		return this.checkMintQuote<MintQuoteBolt11Response>('bolt11', quote, { customRequest });
	}

	/**
	 * Gets an existing BOLT12 mint quote from the mint.
	 *
	 * @remarks
	 * Thin wrapper around checkMintQuote('bolt12', ...).
	 * @param quote Quote ID to check.
	 * @param customRequest Optional override for the request function.
	 * @returns Updated quote with current payment and issuance amounts.
	 */
	async checkMintQuoteBolt12(
		quote: string,
		customRequest?: RequestFn,
	): Promise<MintQuoteBolt12Response> {
		return this.checkMintQuote<MintQuoteBolt12Response>('bolt12', quote, { customRequest });
	}

	// -----------------------------------------------------------------
	// Section: Mint Proofs
	// -----------------------------------------------------------------

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
	 * Uses `/v1/mint/{method}` and validates method format. Signature amounts are always normalized.
	 * Custom methods can supply an optional `normalize` callback for any additional response fields.
	 * @param method The minting method (e.g., 'bolt11', 'bolt12', or custom method name).
	 * @param mintPayload Payload containing the quote ID and outputs to get blind signatures on.
	 * @param options.customRequest Optional override for the request function.
	 * @param options.normalize Optional callback to normalize method-specific response fields.
	 * @returns Serialized blinded signatures for the requested outputs.
	 */
	async mint<TRes extends Record<string, unknown> = Record<string, unknown>>(
		method: string,
		mintPayload: MintRequest,
		options?: {
			customRequest?: RequestFn;
			normalize?: (raw: Record<string, unknown>) => MintResponse & TRes;
		},
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
		return options?.normalize ? options.normalize(data) : data;
	}

	// -----------------------------------------------------------------
	// Section: Create Melt Quote
	// -----------------------------------------------------------------

	/**
	 * Creates a melt quote for any payment method.
	 *
	 * @remarks
	 * Uses `/v1/melt/quote/{method}` and validates method format. Base normalization (amount, expiry,
	 * change) is always applied. For first-class methods (bolt11/bolt12), bolt-specific normalization
	 * (fee_reserve, request) is stacked on top. Custom methods can supply an optional `normalize`
	 * callback for their own fields.
	 * @param method The payment method (e.g., 'bolt11', 'bolt12', or custom method name).
	 * @param payload The request body to POST (method-specific fields).
	 * @param options.customRequest Optional override for the request function.
	 * @param options.normalize Optional callback to normalize method-specific response fields.
	 * @returns The melt quote response.
	 */
	async createMeltQuote<TRes extends MeltQuoteBaseResponse = MeltQuoteBaseResponse>(
		method: string,
		payload: Record<string, unknown>,
		options?: { customRequest?: RequestFn; normalize?: (raw: Record<string, unknown>) => TRes },
	): Promise<TRes> {
		failIf(!this.isValidMethodString(method), `Invalid melt quote method: ${method}`, this._logger);
		const response = await this.requestWithAuth<TRes>(
			'POST',
			`/v1/melt/quote/${method}`,
			{ requestBody: payload },
			options?.customRequest,
		);
		return this.normalizeMeltQuoteResponse(method, response, options?.normalize);
	}

	/**
	 * Requests a new melt quote from the mint.
	 *
	 * @remarks
	 * Thin wrapper around createMeltQuote('bolt11', ...).
	 * @param meltQuotePayload Payload for creating a new melt quote.
	 * @param customRequest Optional override for the request function.
	 * @returns The melt quote response.
	 */
	async createMeltQuoteBolt11(
		meltQuotePayload: MeltQuoteBolt11Request,
		customRequest?: RequestFn,
	): Promise<MeltQuoteBolt11Response> {
		return this.createMeltQuote<MeltQuoteBolt11Response>(
			'bolt11',
			this.normalizeMeltQuoteRequestOptions(meltQuotePayload),
			{ customRequest },
		);
	}

	/**
	 * Requests a new BOLT12 melt quote from the mint for paying a Lightning Network offer. For
	 * amount-less offers, specify the amount in options.amountless.amount_msat.
	 *
	 * @remarks
	 * Thin wrapper around createMeltQuote('bolt12', ...).
	 * @param meltQuotePayload Payload containing the BOLT12 offer to pay and unit.
	 * @param customRequest Optional override for the request function.
	 * @returns Melt quote with amount, fee reserve, and payment state.
	 */
	async createMeltQuoteBolt12(
		meltQuotePayload: MeltQuoteBolt12Request,
		customRequest?: RequestFn,
	): Promise<MeltQuoteBolt12Response> {
		return this.createMeltQuote<MeltQuoteBolt12Response>(
			'bolt12',
			this.normalizeMeltQuoteRequestOptions(meltQuotePayload),
			{ customRequest },
		);
	}

	// -----------------------------------------------------------------
	// Section: Check Melt Quote
	// -----------------------------------------------------------------

	/**
	 * Checks an existing melt quote for any payment method.
	 *
	 * @remarks
	 * Uses `/v1/melt/quote/{method}/{quote}` and validates method format. Normalization follows the
	 * same stacking pattern as {@link Mint.createMeltQuote}.
	 * @param method The payment method (e.g., 'bolt11', 'bolt12', or custom method name).
	 * @param quote Quote ID.
	 * @param options.customRequest Optional override for the request function.
	 * @param options.normalize Optional callback to normalize method-specific response fields.
	 * @returns The melt quote response.
	 */
	async checkMeltQuote<TRes extends MeltQuoteBaseResponse = MeltQuoteBaseResponse>(
		method: string,
		quote: string,
		options?: { customRequest?: RequestFn; normalize?: (raw: Record<string, unknown>) => TRes },
	): Promise<TRes> {
		failIf(!this.isValidMethodString(method), `Invalid melt quote method: ${method}`, this._logger);
		const response = await this.requestWithAuth<TRes>(
			'GET',
			`/v1/melt/quote/${method}/${quote}`,
			{},
			options?.customRequest,
		);
		return this.normalizeMeltQuoteResponse(method, response, options?.normalize);
	}

	/**
	 * Gets an existing melt quote.
	 *
	 * @remarks
	 * Thin wrapper around checkMeltQuote('bolt11', ...).
	 * @param quote Quote ID.
	 * @param customRequest Optional override for the request function.
	 * @returns The melt quote response.
	 */
	async checkMeltQuoteBolt11(
		quote: string,
		customRequest?: RequestFn,
	): Promise<MeltQuoteBolt11Response> {
		return this.checkMeltQuote<MeltQuoteBolt11Response>('bolt11', quote, { customRequest });
	}

	/**
	 * Gets an existing BOLT12 melt quote from the mint. Returns current payment state (UNPAID,
	 * PENDING, or PAID) and payment preimage if paid.
	 *
	 * @remarks
	 * Thin wrapper around checkMeltQuote('bolt12', ...).
	 * @param quote Quote ID to check.
	 * @param customRequest Optional override for the request function.
	 * @returns Updated quote with current payment state and preimage if available.
	 */
	async checkMeltQuoteBolt12(
		quote: string,
		customRequest?: RequestFn,
	): Promise<MeltQuoteBolt12Response> {
		return this.checkMeltQuote<MeltQuoteBolt12Response>('bolt12', quote, { customRequest });
	}

	// -----------------------------------------------------------------
	// Section: Melt Proofs
	// -----------------------------------------------------------------

	/**
	 * Generic method to melt tokens using any payment method endpoint.
	 *
	 * @remarks
	 * This method enables support for custom payment methods without modifying the Mint class. It
	 * constructs the endpoint as `/v1/melt/{method}` and POSTs the payload. The response must contain
	 * the common fields: quote, amount, state, expiry. Method-specific fields (e.g. `fee_reserve` for
	 * bolt11/bolt12) are normalised when present. Custom methods can supply an optional `normalize`
	 * callback for their own fields.
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
	 * @param options.normalize Optional callback to normalize method-specific response fields.
	 * @returns A response object with at least the required melt quote fields.
	 */
	async melt<TRes extends Record<string, unknown> = Record<string, unknown>>(
		method: string,
		meltPayload: MeltRequest,
		options?: {
			customRequest?: RequestFn;
			normalize?: (raw: Record<string, unknown>) => MeltQuoteBaseResponse & TRes;
		},
	): Promise<MeltQuoteBaseResponse & TRes> {
		failIf(!this.isValidMethodString(method), `Invalid melt method: ${method}`, this._logger);
		const response = await this.requestWithAuth<MeltQuoteBaseResponse & TRes>(
			'POST',
			`/v1/melt/${method}`,
			{ requestBody: meltPayload },
			options?.customRequest,
		);
		return this.normalizeMeltQuoteResponse(method, response, options?.normalize);
	}

	/**
	 * Requests the mint to pay for a Bolt11 payment request by providing ecash as inputs to be spent.
	 * The inputs contain the amount and the fee_reserves for a Lightning payment. The payload can
	 * also contain blank outputs in order to receive back overpaid Lightning fees.
	 *
	 * @remarks
	 * Thin wrapper around melt('bolt11', ...).
	 * @param meltPayload The melt payload containing inputs and optional outputs.
	 * @param options.customRequest Optional override for the request function.
	 * @returns The melt response.
	 */
	async meltBolt11(
		meltPayload: MeltRequest,
		options?: {
			customRequest?: RequestFn;
		},
	): Promise<MeltQuoteBolt11Response> {
		return this.melt<MeltQuoteBolt11Response>('bolt11', meltPayload, options);
	}

	/**
	 * Requests the mint to pay a BOLT12 offer by providing ecash inputs to be spent. The inputs must
	 * cover the amount plus fee reserves. Optional outputs can be included to receive change for
	 * overpaid Lightning fees.
	 *
	 * @remarks
	 * Thin wrapper around melt('bolt12', ...).
	 * @param meltPayload Payload containing quote ID, inputs, and optional outputs for change.
	 * @param options.customRequest Optional override for the request function.
	 * @returns Payment result with state and optional change signatures.
	 */
	async meltBolt12(
		meltPayload: MeltRequest,
		options?: {
			customRequest?: RequestFn;
		},
	): Promise<MeltQuoteBolt12Response> {
		return this.melt<MeltQuoteBolt12Response>('bolt12', meltPayload, options);
	}

	// -----------------------------------------------------------------
	// Section: Public Utilities
	// -----------------------------------------------------------------

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

	// -----------------------------------------------------------------
	// Section: Websockets
	// -----------------------------------------------------------------

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
				this.ws = new WSConnection(wsUrl, this._logger);
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

	// -----------------------------------------------------------------
	// Section: AUTH
	// -----------------------------------------------------------------

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

	// -----------------------------------------------------------------
	// Section: Normalizers / Helpers
	// -----------------------------------------------------------------

	/**
	 * Normalizes AmountLike fields inside melt quote request options so they are serialized as JSON
	 * number tokens (not strings) when forwarded to the mint.
	 */
	private normalizeMeltQuoteRequestOptions(
		payload: MeltQuoteBolt11Request | MeltQuoteBolt12Request,
	): Record<string, unknown> {
		if (!payload.options) return payload as Record<string, unknown>;
		const opts: Record<string, unknown> = { ...payload.options };
		if (payload.options.amountless) {
			opts.amountless = {
				amount_msat: Amount.from(payload.options.amountless.amount_msat).toBigInt(),
			};
		}
		if ('mpp' in payload.options && payload.options.mpp) {
			opts.mpp = { amount: Amount.from(payload.options.mpp.amount).toBigInt() };
		}
		return { ...payload, options: opts };
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
			amount: Amount.from(message.amount).toBigInt(),
		}));
	}

	/**
	 * Stacks normalizers for mint quote responses: first-class (bolt11/bolt12) normalization is
	 * applied for known methods, then any custom normalize callback. Works on untyped wire data
	 * internally — the caller casts the result to the desired TRes.
	 */
	private normalizeMintQuoteResponse<TRes extends MintQuoteBaseResponse>(
		method: string,
		response: TRes,
		normalize?: (raw: Record<string, unknown>) => TRes,
	): TRes {
		// MintQuoteBaseResponse has no Amount fields to normalize at the base level.
		// Stack first-class normalization for known methods.
		const data: Record<string, unknown> = { ...response };
		if (method === 'bolt11') {
			this.normalizeMintQuoteBolt11Fields(data);
		} else if (method === 'bolt12') {
			this.normalizeMintQuoteBolt12Fields(data);
		}
		return normalize ? normalize(data) : (data as TRes);
	}

	/**
	 * Mutates `data` in place, normalizing bolt11 mint-quote fields.
	 */
	private normalizeMintQuoteBolt11Fields(data: Record<string, unknown>): void {
		data.amount = Amount.from(data.amount as Amount);
		data.expiry = normalizeSafeIntegerMetadata(
			data.expiry as number,
			'mintQuoteBolt11.expiry',
			null,
		);
	}

	/**
	 * Mutates `data` in place, normalizing bolt12 mint-quote fields.
	 */
	private normalizeMintQuoteBolt12Fields(data: Record<string, unknown>): void {
		data.amount = data.amount === undefined ? undefined : Amount.from(data.amount as Amount);
		data.expiry = normalizeSafeIntegerMetadata(
			data.expiry as number,
			'mintQuoteBolt12.expiry',
			null,
		);
		data.amount_paid = Amount.from(data.amount_paid as Amount);
		data.amount_issued = Amount.from(data.amount_issued as Amount);
	}

	/**
	 * Stacks normalizers for melt quote responses: base normalization (amount, expiry, change) is
	 * always applied, then first-class bolt normalization for known methods, then any custom
	 * normalize callback.
	 */
	private normalizeMeltQuoteResponse<TRes extends MeltQuoteBaseResponse>(
		method: string,
		response: TRes,
		normalize?: (raw: Record<string, unknown>) => TRes,
	): TRes {
		const op = `${method} melt quote`;
		const data: Record<string, unknown> = { ...response };
		this.normalizeMeltBaseFields(data, op);
		if (method === 'bolt11' || method === 'bolt12') {
			this.normalizeMeltBoltFields(data, op);
		}
		return normalize ? normalize(data) : (data as TRes);
	}

	/**
	 * Mutates `data` in place, normalizing protocol-mandatory melt base fields.
	 */
	private normalizeMeltBaseFields(data: Record<string, unknown>, op: string): void {
		data.amount = Amount.from(data.amount as Amount);
		data.expiry = normalizeSafeIntegerMetadata(
			data.expiry as number,
			'meltQuote.expiry',
			undefined,
		);
		if (data.change) {
			data.change = this.normalizeSignatureAmounts(data.change as SerializedBlindedSignature[]);
		}
		if (
			!isObj(data) ||
			typeof data.quote !== 'string' ||
			!(data.amount instanceof Amount) ||
			typeof data.unit !== 'string' ||
			typeof data.state !== 'string' ||
			typeof data.expiry !== 'number' ||
			!Object.values(MeltQuoteState).includes(data.state as MeltQuoteState)
		) {
			this._logger.error('Invalid response from mint...', { data, op });
			throw new Error('Invalid response from mint');
		}
	}

	/**
	 * Mutates `data` in place, normalizing bolt11/bolt12-specific melt fields.
	 */
	private normalizeMeltBoltFields(data: Record<string, unknown>, op: string): void {
		data.fee_reserve = Amount.from(data.fee_reserve as Amount);
		if (typeof data.request !== 'string' || !(data.fee_reserve instanceof Amount)) {
			this._logger.error('Invalid response from mint...', { data, op });
			throw new Error('Invalid response from mint');
		}
	}
}

export { Mint };
