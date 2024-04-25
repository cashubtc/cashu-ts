import type {
	CheckStatePayload,
	CheckStateResponse,
	GetInfoResponse,
	MeltPayload,
	MeltResponse,
	MintActiveKeys,
	MintAllKeysets,
	PostRestoreResponse,
	RequestMintResponse,
	SerializedBlindedMessage,
	SplitPayload,
	SplitResponse,
	RequestMintPayload,
	PostMintPayload,
	PostMintResponse,
	PostRestorePayload,
	MeltQuotePayload,
	MeltQuoteResponse
} from './model/types/index.js';
import request from './request.js';
import { isObj, joinUrls, sanitizeUrl } from './utils.js';

/**
 * Class represents Cashu Mint API. This class contains Lower level functions that are implemented by CashuWallet.
 */
class CashuMint {
	/**
	 * @param _mintUrl requires mint URL to create this object
	 * @param _customRequest if passed, use custom request implementation for network communication with the mint
	 */
	constructor(private _mintUrl: string, private _customRequest?: typeof request) {}

	get mintUrl() {
		return sanitizeUrl(this._mintUrl);
	}

	/**
	 * fetches mints info at the /info endpoint
	 * @param mintUrl
	 * @param customRequest
	 */
	public static async getInfo(
		mintUrl: string,
		customRequest?: typeof request
	): Promise<GetInfoResponse> {
		const requestInstance = customRequest || request;
		return requestInstance<GetInfoResponse>({ endpoint: joinUrls(mintUrl, '/v1/info') });
	}
	/**
	 * fetches mints info at the /info endpoint
	 */
	async getInfo(): Promise<GetInfoResponse> {
		return CashuMint.getInfo(this._mintUrl, this._customRequest);
	}
	/**
	 * Starts a minting process by requesting an invoice from the mint
	 * @param mintUrl
	 * @param amount Amount requesting for mint.
	 * @param customRequest
	 * @returns the mint will create and return a Lightning invoice for the specified amount
	 */
	public static async mintQuote(
		mintUrl: string,
		requestMintPayload: RequestMintPayload,
		customRequest?: typeof request
	): Promise<RequestMintResponse> {
		const requestInstance = customRequest || request;
		return requestInstance<RequestMintResponse>({
			endpoint: joinUrls(mintUrl, '/v1/mint/quote/bolt11'),
			method: 'POST',
			requestBody: requestMintPayload
		});
	}

	/**
	 * Starts a minting process by requesting an invoice from the mint
	 * @param amount Amount requesting for mint.
	 * @returns the mint will create and return a Lightning invoice for the specified amount
	 */
	async mintQuote(requestMintPayload: RequestMintPayload): Promise<RequestMintResponse> {
		return CashuMint.mintQuote(this._mintUrl, requestMintPayload, this._customRequest);
	}
	/**
	 * Requests the mint to perform token minting after the LN invoice has been paid
	 * @param mintUrl
	 * @param payloads outputs (Blinded messages) that can be written
	 * @param hash hash (id) used for by the mint to keep track of wether the invoice has been paid yet
	 * @param customRequest
	 * @returns serialized blinded signatures
	 */
	public static async mint(
		mintUrl: string,
		mintPayload: PostMintPayload,
		customRequest?: typeof request
	) {
		const requestInstance = customRequest || request;
		const data = await requestInstance<PostMintResponse>({
			endpoint: joinUrls(mintUrl, '/v1/mint/bolt11'),
			method: 'POST',
			requestBody: mintPayload
		});

		if (!isObj(data) || !Array.isArray(data?.signatures)) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Requests the mint to perform token minting after the LN invoice has been paid
	 * @param payloads outputs (Blinded messages) that can be written
	 * @param hash hash (id) used for by the mint to keep track of wether the invoice has been paid yet
	 * @returns serialized blinded signatures
	 */
	async mint(mintPayload: PostMintPayload) {
		return CashuMint.mint(this._mintUrl, mintPayload, this._customRequest);
	}
	/**
	 * Get the mints public keys
	 * @param mintUrl
	 * @param keysetId optional param to get the keys for a specific keyset. If not specified, the keys from the active keyset are fetched
	 * @param customRequest
	 * @returns
	 */
	public static async getKeys(
		mintUrl: string,
		keysetId?: string,
		customRequest?: typeof request
	): Promise<MintActiveKeys> {
		// backwards compatibility for base64 encoded keyset ids
		if (keysetId) {
			// make the keysetId url safe
			keysetId = keysetId.replace(/\//g, '_').replace(/\+/g, '-');
		}
		const requestInstance = customRequest || request;
		const data = await requestInstance<MintActiveKeys>({
			endpoint: keysetId ? joinUrls(mintUrl, '/v1/keys', keysetId) : joinUrls(mintUrl, '/v1/keys')
		});

		if (!isObj(data) || !Array.isArray(data.keysets)) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Get the mints public keys
	 * @param keysetId optional param to get the keys for a specific keyset. If not specified, the keys from the active keyset are fetched
	 * @returns the mints public keys
	 */
	async getKeys(keysetId?: string, mintUrl?: string): Promise<MintActiveKeys> {
		const allKeys = await CashuMint.getKeys(
			mintUrl || this._mintUrl,
			keysetId,
			this._customRequest
		);
		return allKeys;
	}
	/**
	 * Get the mints keysets in no specific order
	 * @param mintUrl
	 * @param customRequest
	 * @returns all the mints past and current keysets.
	 */
	public static async getKeySets(
		mintUrl: string,
		customRequest?: typeof request
	): Promise<MintAllKeysets> {
		const requestInstance = customRequest || request;
		return requestInstance<MintAllKeysets>({ endpoint: joinUrls(mintUrl, '/v1/keysets') });
	}

	/**
	 * Get the mints keysets in no specific order
	 * @returns all the mints past and current keysets.
	 */
	async getKeySets(): Promise<MintAllKeysets> {
		return CashuMint.getKeySets(this._mintUrl, this._customRequest);
	}

	/**
	 * Ask mint to perform a split operation
	 * @param mintUrl
	 * @param splitPayload data needed for performing a token split
	 * @param customRequest
	 * @returns split tokens
	 */
	public static async split(
		mintUrl: string,
		splitPayload: SplitPayload,
		customRequest?: typeof request
	): Promise<SplitResponse> {
		const requestInstance = customRequest || request;
		const data = await requestInstance<SplitResponse>({
			endpoint: joinUrls(mintUrl, '/v1/swap'),
			method: 'POST',
			requestBody: splitPayload
		});

		if (!isObj(data) || !Array.isArray(data?.signatures)) {
			throw new Error(data.detail ?? 'bad response');
		}

		return data;
	}
	/**
	 * Ask mint to perform a split operation
	 * @param splitPayload data needed for performing a token split
	 * @returns split tokens
	 */
	async split(splitPayload: SplitPayload): Promise<SplitResponse> {
		return CashuMint.split(this._mintUrl, splitPayload, this._customRequest);
	}
	/**
	 * Asks the mint for a melt quote
	 * @param mintUrl
	 * @param MeltQuotePayload
	 * @returns
	 */
	public static async meltQuote(
		mintUrl: string,
		meltQuotePayload: MeltQuotePayload,
		customRequest?: typeof request
	): Promise<MeltQuoteResponse> {
		const requestInstance = customRequest || request;
		const data = await requestInstance<MeltQuoteResponse>({
			endpoint: joinUrls(mintUrl, '/v1/melt/quote/bolt11'),
			method: 'POST',
			requestBody: meltQuotePayload
		});

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
	 * Asks the mint for a melt quote
	 * @param MeltQuotePayload
	 * @returns
	 */
	async meltQuote(meltQuotePayload: MeltQuotePayload): Promise<MeltQuoteResponse> {
		return CashuMint.meltQuote(this._mintUrl, meltQuotePayload, this._customRequest);
	}
	/**
	 * Ask mint to perform a melt operation. This pays a lightning invoice and destroys tokens matching its amount + fees
	 * @param mintUrl
	 * @param meltPayload
	 * @param customRequest
	 * @returns
	 */
	public static async melt(
		mintUrl: string,
		meltPayload: MeltPayload,
		customRequest?: typeof request
	): Promise<MeltResponse> {
		const requestInstance = customRequest || request;
		const data = await requestInstance<MeltResponse>({
			endpoint: joinUrls(mintUrl, '/v1/melt/bolt11'),
			method: 'POST',
			requestBody: meltPayload
		});

		if (
			!isObj(data) ||
			typeof data?.paid !== 'boolean' ||
			(data?.payment_preimage !== null && typeof data?.payment_preimage !== 'string')
		) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Ask mint to perform a melt operation. This pays a lightning invoice and destroys tokens matching its amount + fees
	 * @param meltPayload
	 * @returns
	 */
	async melt(meltPayload: MeltPayload): Promise<MeltResponse> {
		return CashuMint.melt(this._mintUrl, meltPayload, this._customRequest);
	}
	/**
	 * Checks if specific proofs have already been redeemed
	 * @param mintUrl
	 * @param checkPayload
	 * @param customRequest
	 * @returns redeemed and unredeemed ordered list of booleans
	 */
	public static async check(
		mintUrl: string,
		checkPayload: CheckStatePayload,
		customRequest?: typeof request
	): Promise<CheckStateResponse> {
		const requestInstance = customRequest || request;
		const data = await requestInstance<CheckStateResponse>({
			endpoint: joinUrls(mintUrl, '/v1/checkstate'),
			method: 'POST',
			requestBody: checkPayload
		});

		if (!isObj(data) || !Array.isArray(data?.states)) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Checks if specific proofs have already been redeemed
	 * @param checkPayload
	 * @returns redeemed and unredeemed ordered list of booleans
	 */
	async check(checkPayload: CheckStatePayload): Promise<CheckStateResponse> {
		return CashuMint.check(this._mintUrl, checkPayload, this._customRequest);
	}

	public static async restore(
		mintUrl: string,
		restorePayload: PostRestorePayload,
		customRequest?: typeof request
	): Promise<PostRestoreResponse> {
		const requestInstance = customRequest || request;
		//TODO remove after fix
		//@ts-expect-error temp fix
		restorePayload.quote = '';
		const data = await requestInstance<PostRestoreResponse>({
			endpoint: joinUrls(mintUrl, '/v1/restore'),
			method: 'POST',
			requestBody: restorePayload
		});

		if (!isObj(data) || !Array.isArray(data?.outputs) || !Array.isArray(data?.promises)) {
			throw new Error('bad response');
		}

		return data;
	}

	async restore(restorePayload: {
		outputs: Array<SerializedBlindedMessage>;
	}): Promise<PostRestoreResponse> {
		return CashuMint.restore(this._mintUrl, restorePayload, this._customRequest);
	}
}

export { CashuMint };
