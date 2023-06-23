import { axios } from './axios.js';
import {
	ApiError,
	CheckSpendablePayload,
	CheckSpendableResponse,
	GetInfoResponse,
	MeltPayload,
	MeltResponse,
	MintKeys,
	RequestMintResponse,
	SerializedBlindedMessage,
	SerializedBlindedSignature,
	SplitPayload,
	SplitResponse
} from './model/types/index.js';
import { checkResponse, checkResponseError, isObj } from './utils.js';

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
		const { data } = await axios.get<GetInfoResponse>(`${mintUrl}/info`);
		return data;
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
		const { data } = await axios.get<RequestMintResponse>(`${mintUrl}/mint`, {
			params: { amount },
			timeout: 0
		});
		return data;
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
		try {
			const { data } = await axios.post<{ promises: Array<SerializedBlindedSignature> } & ApiError>(
				`${mintUrl}/mint`,
				payloads,
				{
					params: {
						// payment_hash is deprecated
						payment_hash: hash,
						hash
					}
				}
			);
			checkResponse(data);
			if (!isObj(data) || !Array.isArray(data?.promises)) {
				throw new Error('bad response');
			}
			return data;
		} catch (err) {
			checkResponseError(err);
			throw err;
		}
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
		const { data } = await axios.get<MintKeys>(`${mintUrl}/keys${keysetId ? `/${keysetId}` : ''}`);
		return data;
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
		const { data } = await axios.get<{ keysets: Array<string> }>(`${mintUrl}/keysets`);
		return data;
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
		try {
			const { data } = await axios.post<SplitResponse>(`${mintUrl}/split`, splitPayload, {
				timeout: 0
			});
			checkResponse(data);
			if (!isObj(data) || !Array.isArray(data?.fst) || !Array.isArray(data?.snd)) {
				throw new Error('bad response');
			}
			return data;
		} catch (err) {
			checkResponseError(err);
			throw err;
		}
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
		try {
			const { data } = await axios.post<MeltResponse>(`${mintUrl}/melt`, meltPayload, {
				timeout: 0
			});
			checkResponse(data);
			if (
				!isObj(data) ||
				typeof data?.paid !== 'boolean' ||
				(data?.preimage !== null && typeof data?.preimage !== 'string')
			) {
				throw new Error('bad response');
			}
			return data;
		} catch (err) {
			checkResponseError(err);
			throw err;
		}
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
		try {
			const { data } = await axios.post<{ fee: number } & ApiError>(
				`${mintUrl}/checkfees`,
				checkfeesPayload
			);
			checkResponse(data);
			if (!isObj(data) || typeof data?.fee !== 'number') {
				throw new Error('bad response');
			}
			return data;
		} catch (err) {
			checkResponseError(err);
			throw err;
		}
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
		try {
			const { data } = await axios.post<CheckSpendableResponse>(`${mintUrl}/check`, checkPayload);
			checkResponse(data);
			if (!isObj(data) || !Array.isArray(data?.spendable)) {
				throw new Error('bad response');
			}
			return data;
		} catch (err) {
			checkResponseError(err);
			throw err;
		}
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
