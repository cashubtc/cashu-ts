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
	constructor(public mintUrl: string) { }

	async getInfo(): Promise<GetInfoResponse> {
		const { data } = await axios.get<GetInfoResponse>(`${this.mintUrl}/info`);
		return data;
	}

	async requestMint(amount: number): Promise<RequestMintResponse> {
		const { data } = await axios.get<RequestMintResponse>(`${this.mintUrl}/mint`, {
			params: { amount }
		});
		return data;
	}

	async mint(payloads: { outputs: Array<SerializedBlindedMessage> }, hash: string) {
		try {
			const { data } = await axios.post<
				{
					promises: Array<SerializedBlindedSignature>;
				} & ApiError
			>(`${this.mintUrl}/mint`, payloads, {
				params: {
					// payment_hash is deprecated
					payment_hash: hash,
					hash
				}
			});
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
	public static async getKeys(mintUrl: string, keysetId?: string): Promise<MintKeys> {
		if (keysetId) {
			// make the keysetId url safe
			keysetId = keysetId.replace(/\//g, '_').replace(/\+/g, '-');
		}
		const { data } = await axios.get<MintKeys>(`${mintUrl}/keys${keysetId ? `/${keysetId}` : ''}`);
		return data;
	}
	async getKeys(keysetId?: string): Promise<MintKeys> {
		return CashuMint.getKeys(this.mintUrl, keysetId);
	}

	async getKeySets(): Promise<{ keysets: Array<string> }> {
		const { data } = await axios.get<{ keysets: Array<string> }>(`${this.mintUrl}/keysets`);
		return data;
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
		return CashuMint.split(this.mintUrl, splitPayload);
	}
	async melt(meltPayload: MeltPayload): Promise<MeltResponse> {
		try {
			const { data } = await axios.post<MeltResponse>(`${this.mintUrl}/melt`, meltPayload);
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
	async checkFees(checkfeesPayload: { pr: string }): Promise<{ fee: number }> {
		try {
			const { data } = await axios.post<{ fee: number } & ApiError>(
				`${this.mintUrl}/checkfees`,
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
	async check(checkPayload: CheckSpendablePayload): Promise<CheckSpendableResponse> {
		try {
			const { data } = await axios.post<CheckSpendableResponse>(
				`${this.mintUrl}/check`,
				checkPayload
			);
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
}

export { CashuMint };
