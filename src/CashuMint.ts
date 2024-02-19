import {
	CheckSpendablePayload,
	CheckSpendableResponse,
	GetInfoResponse,
	MeltPayload,
	MeltResponse,
	MintKeys,
	MintActiveKeys,
	MintAllKeysets,
	RequestMintResponse,
	SplitPayload,
	SplitResponse,
	RequestMintPayload,
	PostMintPayload,
	PostMintResponse,
	MeltQuotePayload,
	MeltQuoteResponse
} from './model/types/index.js';
import request from './request.js';
import { isObj, joinUrls } from './utils.js';

/**
 * Class represents Cashu Mint API. This class contains Lower level functions that are implemented by CashuWallet.
 */
class CashuMint {
	/**
	 * @param _mintUrl requires mint URL to create this object
	 * @param _customRequest if passed, use custom request implementation for network communication with the mint
	 */
	constructor(private _mintUrl: string) { }

	get mintUrl() {
		return this._mintUrl;
	}

	/**
	 * fetches mints info at the /info endpoint
	 * @param mintUrl
	 * @param customRequest
	 */
	public static async getInfo(mintUrl: string): Promise<GetInfoResponse> {
		return request<GetInfoResponse>({ endpoint: joinUrls(mintUrl, '/v1/info') });
	}
	/**
	 * Starts a minting process by requesting an invoice from the mint
	 * @param mintUrl
	 * @param amount Amount requesting for mint.
	 * @param customRequest
	 * @returns the mint will create and return a Lightning invoice for the specified amount
	 */
	public static async mintQuote(mintUrl: string, requestMintPayload: RequestMintPayload): Promise<RequestMintResponse> {
		return request<RequestMintResponse>({
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
		return CashuMint.mintQuote(this._mintUrl, requestMintPayload);
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
	) {
		const data = await request<PostMintResponse>({
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
		return CashuMint.mint(this._mintUrl, mintPayload);
	}
	/**
	 * Get the mints public keys
	 * @param mintUrl
	 * @param keysetId optional param to get the keys for a specific keyset. If not specified, the keys from the active keyset are fetched
	 * @param customRequest
	 * @returns
	 */
	public static async getKeys(mintUrl: string, keysetId?: string): Promise<MintActiveKeys> {
		// backwards compatibility for base64 encoded keyset ids
		if (keysetId) {
			// make the keysetId url safe
			keysetId = keysetId.replace(/\//g, '_').replace(/\+/g, '-');
		}

		const data = await request<MintActiveKeys>({
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
	async getKeys(keysetId?: string, mintUrl?: string, unit?: string): Promise<MintKeys> {
		const allKeys = await CashuMint.getKeys(mintUrl || this._mintUrl, keysetId);
		// find keyset with unit 'sat'
		const satKeys = (allKeys.keysets).find((keys) => keys.unit === unit ? unit : 'sat');
		if (!satKeys) {
			throw new Error('No keyset with unit "sat" found');
		}
		return satKeys
	}
	/**
	 * Get the mints keysets in no specific order
	 * @param mintUrl
	 * @param customRequest
	 * @returns all the mints past and current keysets.
	 */
	public static async getKeySets(mintUrl: string): Promise<MintAllKeysets> {
		return request<MintAllKeysets>({ endpoint: joinUrls(mintUrl, '/v1/keysets') });
	}

	/**
	 * Get the mints keysets in no specific order
	 * @returns all the mints past and current keysets.
	 */
	async getKeySets(): Promise<MintAllKeysets> {
		return CashuMint.getKeySets(this._mintUrl);
	}

	/**
	 * Ask mint to perform a split operation
	 * @param mintUrl
	 * @param splitPayload data needed for performing a token split
	 * @returns split tokens
	 */
	public static async split(mintUrl: string, splitPayload: SplitPayload): Promise<SplitResponse> {
		const data = await request<SplitResponse>({
			endpoint: joinUrls(mintUrl, '/v1/split'),
			method: 'POST',
			requestBody: splitPayload
		});

		if (!isObj(data) || !Array.isArray(data?.signatures)) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Ask mint to perform a split operation
	 * @param splitPayload data needed for performing a token split
	 * @returns split tokens
	 */
	async split(splitPayload: SplitPayload): Promise<SplitResponse> {
		return CashuMint.split(this._mintUrl, splitPayload);
	}
	/**
	 * Asks the mint for a melt quote
	 * @param mintUrl
	 * @param MeltQuotePayload
	 * @returns
	 */
	public static async meltQuote(mintUrl: string, meltQuotePayload: MeltQuotePayload): Promise<MeltQuoteResponse> {
		const data = await request<MeltQuoteResponse>({
			endpoint: joinUrls(mintUrl, '/v1/melt/quote/bolt11'),
			method: 'POST',
			requestBody: meltQuotePayload
		});

		if (!isObj(data) || typeof data?.amount !== 'number' || typeof data?.fee_reserve !== 'number' || typeof data?.quote !== 'string') {
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
		return CashuMint.meltQuote(this._mintUrl, meltQuotePayload);
	}
	/**
	 * Ask mint to perform a melt operation. This pays a lightning invoice and destroys tokens matching its amount + fees
	 * @param mintUrl
	 * @param meltPayload
	 * @returns
	 */
	public static async melt(mintUrl: string, meltPayload: MeltPayload): Promise<MeltResponse> {
		const data = await request<MeltResponse>({
			endpoint: joinUrls(mintUrl, '/v1/melt/bolt11'),
			method: 'POST',
			requestBody: meltPayload
		});

		if (
			!isObj(data) ||
			typeof data?.paid !== 'boolean' ||
			(data?.proof !== null && typeof data?.proof !== 'string')
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
		return CashuMint.melt(this._mintUrl, meltPayload);
	}
	/**
	 * Estimate fees for a given LN invoice
	 * @param mintUrl
	 * @param checkfeesPayload Payload containing LN invoice that needs to get a fee estimate
	 * @returns estimated Fee
	 */
	public static async checkFees(
		mintUrl: string,
		checkfeesPayload: { pr: string }
	): Promise<{ fee: number }> {
		const data = await request<{ fee: number }>({
			endpoint: joinUrls(mintUrl, 'checkfees'),
			method: 'POST',
			requestBody: checkfeesPayload
		});

		if (!isObj(data) || typeof data?.fee !== 'number') {
			throw new Error('bad response');
		}

		return data;
	}

	/**
	 * Checks if specific proofs have already been redeemed
	 * @param mintUrl
	 * @param checkPayload
	 * @returns redeemed and unredeemed ordered list of booleans
	 */
	public static async check(
		mintUrl: string,
		checkPayload: CheckSpendablePayload
	): Promise<CheckSpendableResponse> {
		const data = await request<CheckSpendableResponse>({
			endpoint: joinUrls(mintUrl, '/v1/check'),
			method: 'POST',
			requestBody: checkPayload
		});

		if (!isObj(data) || !Array.isArray(data?.spendable)) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Checks if specific proofs have already been redeemed
	 * @param checkPayload
	 * @returns redeemed and unredeemed ordered list of booleans
	 */
	async check(checkPayload: CheckSpendablePayload): Promise<CheckSpendableResponse> {
		return CashuMint.check(this._mintUrl, checkPayload);
	}
	
	

	
}

export { CashuMint };
