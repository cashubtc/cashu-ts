import {
	CheckSpendablePayload,
	CheckSpendableResponse,
	GetInfoResponse,
	MeltPayload,
	MeltResponse,
	MintKeys,
	PostRestoreResponse,
	RequestMintResponse,
	SerializedBlindedMessage,
	SerializedBlindedSignature,
	SplitPayload,
	SplitResponse
} from './model/types/index.js';
import request from './request.js';
import { isObj, joinUrls } from './utils.js';

/**
 * Class represents Cashu Mint API. This class contains Lower level functions that are implemented by CashuWallet.
 */
class CashuMint {
	/**
	 * @param _mintUrl requires mint URL to create this object
	 */
	constructor(private _mintUrl: string) {}

	get mintUrl() {
		return this._mintUrl;
	}
	/**
	 * fetches mints info at the /info endpoint
	 * @param mintUrl
	 */
	public static async getInfo(mintUrl: string): Promise<GetInfoResponse> {
		return request<GetInfoResponse>({ endpoint: joinUrls(mintUrl, 'info') });
	}
	/**
	 * fetches mints info at the /info endpoint
	 */
	async getInfo(): Promise<GetInfoResponse> {
		return CashuMint.getInfo(this._mintUrl);
	}
	/**
	 * Starts a minting process by requesting an invoice from the mint
	 * @param mintUrl
	 * @param amount Amount requesting for mint.
	 * @returns the mint will create and return a Lightning invoice for the specified amount
	 */
	public static async requestMint(mintUrl: string, amount: number): Promise<RequestMintResponse> {
		return request<RequestMintResponse>({
			endpoint: `${joinUrls(mintUrl, 'mint')}?amount=${amount}`
		});
	}

	/**
	 * Starts a minting process by requesting an invoice from the mint
	 * @param amount Amount requesting for mint.
	 * @returns the mint will create and return a Lightning invoice for the specified amount
	 */
	async requestMint(amount: number): Promise<RequestMintResponse> {
		return CashuMint.requestMint(this._mintUrl, amount);
	}
	/**
	 * Requests the mint to perform token minting after the LN invoice has been paid
	 * @param mintUrl
	 * @param payloads outputs (Blinded messages) that can be written
	 * @param hash hash (id) used for by the mint to keep track of wether the invoice has been paid yet
	 * @returns serialized blinded signatures
	 */
	public static async mint(
		mintUrl: string,
		payloads: { outputs: Array<SerializedBlindedMessage> },
		hash: string
	) {
		const data = await request<{ promises: Array<SerializedBlindedSignature> }>({
			endpoint: `${joinUrls(mintUrl, 'mint')}?hash=${hash}`,
			method: 'POST',
			requestBody: payloads
		});

		if (!isObj(data) || !Array.isArray(data?.promises)) {
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
	async mint(payloads: { outputs: Array<SerializedBlindedMessage> }, hash: string) {
		return CashuMint.mint(this._mintUrl, payloads, hash);
	}
	/**
	 * Get the mints public keys
	 * @param mintUrl
	 * @param keysetId optional param to get the keys for a specific keyset. If not specified, the keys from the active keyset are fetched
	 * @returns
	 */
	public static async getKeys(mintUrl: string, keysetId?: string): Promise<MintKeys> {
		if (keysetId) {
			// make the keysetId url safe
			keysetId = keysetId.replace(/\//g, '_').replace(/\+/g, '-');
		}
		return request<MintKeys>({
			endpoint: keysetId ? joinUrls(mintUrl, 'keys', keysetId) : joinUrls(mintUrl, 'keys')
		});
	}
	/**
	 * Get the mints public keys
	 * @param keysetId optional param to get the keys for a specific keyset. If not specified, the keys from the active keyset are fetched
	 * @returns the mints public keys
	 */
	async getKeys(keysetId?: string): Promise<MintKeys> {
		return CashuMint.getKeys(this._mintUrl, keysetId);
	}
	/**
	 * Get the mints keysets in no specific order
	 * @param mintUrl
	 * @returns all the mints past and current keysets.
	 */
	public static async getKeySets(mintUrl: string): Promise<{ keysets: Array<string> }> {
		return request<{ keysets: Array<string> }>({ endpoint: joinUrls(mintUrl, 'keysets') });
	}

	/**
	 * Get the mints keysets in no specific order
	 * @returns all the mints past and current keysets.
	 */
	async getKeySets(): Promise<{ keysets: Array<string> }> {
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
			endpoint: joinUrls(mintUrl, 'split'),
			method: 'POST',
			requestBody: splitPayload
		});

		if (!isObj(data) || !Array.isArray(data?.promises)) {
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
	 * Ask mint to perform a melt operation. This pays a lightning invoice and destroys tokens matching its amount + fees
	 * @param mintUrl
	 * @param meltPayload
	 * @returns
	 */
	public static async melt(mintUrl: string, meltPayload: MeltPayload): Promise<MeltResponse> {
		const data = await request<MeltResponse>({
			endpoint: joinUrls(mintUrl, 'melt'),
			method: 'POST',
			requestBody: meltPayload
		});

		if (
			!isObj(data) ||
			typeof data?.paid !== 'boolean' ||
			(data?.preimage !== null && typeof data?.preimage !== 'string')
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
	 * Estimate fees for a given LN invoice
	 * @param mintUrl
	 * @param checkfeesPayload Payload containing LN invoice that needs to get a fee estimate
	 * @returns estimated Fee
	 */
	async checkFees(checkfeesPayload: { pr: string }): Promise<{ fee: number }> {
		return CashuMint.checkFees(this._mintUrl, checkfeesPayload);
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
			endpoint: joinUrls(mintUrl, 'check'),
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

	public static async restore(
		mintUrl: string,
		restorePayload: { outputs: Array<SerializedBlindedMessage> }
	): Promise<PostRestoreResponse> {
		const data = await request<PostRestoreResponse>({
			endpoint: joinUrls(mintUrl, 'restore'),
			method: 'POST',
			requestBody: restorePayload
		});

		if (!isObj(data) || !Array.isArray(data?.outputs) || !Array.isArray(data?.promises) ) {
			throw new Error('bad response');
		}

		return data;
	}

	async restore(restorePayload: { outputs: Array<SerializedBlindedMessage> }): Promise<PostRestoreResponse> {
		return CashuMint.restore(this._mintUrl, restorePayload);
	}

	
}

export { CashuMint };
