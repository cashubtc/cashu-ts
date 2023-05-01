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
 * Class represents Cashu Mint API.
 */
class CashuMint {
	constructor(private _mintUrl: string) {}
	get mintUrl() {
		return this._mintUrl;
	}

	public static async getInfo(mintUrl: string): Promise<GetInfoResponse> {
		const { data } = await axios.get<GetInfoResponse>(`${mintUrl}/info`);
		return data;
	}
	async getInfo(): Promise<GetInfoResponse> {
		return CashuMint.getInfo(this._mintUrl);
	}
	public static async requestMint(mintUrl: string, amount: number): Promise<RequestMintResponse> {
		const { data } = await axios.get<RequestMintResponse>(`${mintUrl}/mint`, {
			params: { amount }
		});
		return data;
	}
	async requestMint(amount: number): Promise<RequestMintResponse> {
		return CashuMint.requestMint(this._mintUrl, amount);
	}
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
	async mint(payloads: { outputs: Array<SerializedBlindedMessage> }, hash: string) {
		return CashuMint.mint(this._mintUrl, payloads, hash);
	}
	public static async getKeys(mintUrl: string, keysetId?: string): Promise<MintKeys> {
		if (keysetId) {
			// make the keysetId url safe
			keysetId = keysetId.replace(/\//g, '_').replace(/\+/g, '-');
		}
		const { data } = await axios.get<MintKeys>(`${mintUrl}/keys${keysetId ? `/${keysetId}` : ''}`);
		return data;
	}
	async getKeys(keysetId?: string): Promise<MintKeys> {
		return CashuMint.getKeys(this._mintUrl, keysetId);
	}
	public static async getKeySets(mintUrl: string): Promise<{ keysets: Array<string> }> {
		const { data } = await axios.get<{ keysets: Array<string> }>(`${mintUrl}/keysets`);
		return data;
	}
	async getKeySets(): Promise<{ keysets: Array<string> }> {
		return CashuMint.getKeySets(this._mintUrl);
	}
	public static async split(mintUrl: string, splitPayload: SplitPayload): Promise<SplitResponse> {
		try {
			const { data } = await axios.post<SplitResponse>(`${mintUrl}/split`, splitPayload);
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
	async split(splitPayload: SplitPayload): Promise<SplitResponse> {
		return CashuMint.split(this._mintUrl, splitPayload);
	}
	public static async melt(mintUrl: string, meltPayload: MeltPayload): Promise<MeltResponse> {
		try {
			const { data } = await axios.post<MeltResponse>(`${mintUrl}/melt`, meltPayload);
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
	async melt(meltPayload: MeltPayload): Promise<MeltResponse> {
		return CashuMint.melt(this._mintUrl, meltPayload);
	}
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
	async checkFees(checkfeesPayload: { pr: string }): Promise<{ fee: number }> {
		return CashuMint.checkFees(this._mintUrl, checkfeesPayload);
	}
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
	async check(checkPayload: CheckSpendablePayload): Promise<CheckSpendableResponse> {
		return CashuMint.check(this._mintUrl, checkPayload);
	}
}

export { CashuMint };
