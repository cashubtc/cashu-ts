import { axios } from './axios.js';
import {
	ApiError,
	CheckSpendablePayload,
	CheckSpendableResponse,
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
	mintUrl: string;
	constructor(mintHost: string, mintApiRoot?: string, mintPort?: string) {
		if (mintPort) {
			this.mintUrl = `${mintHost}:${mintPort}`;
		} else {
			this.mintUrl = mintHost;
		}
		if (mintApiRoot) {
			if (mintApiRoot.charAt(0) === '/') {
				mintApiRoot = mintApiRoot.substring(1, mintApiRoot.length - 1);
			}
			this.mintUrl = `${this.mintUrl}/${mintApiRoot}`;
		}
	}

	async requestMint(amount: number): Promise<RequestMintResponse> {
		const { data } = await axios.get<RequestMintResponse>(`${this.mintUrl}/mint`, {
			params: { amount }
		});
		return data;
	}
	async mint(payloads: { outputs: Array<SerializedBlindedMessage> }, paymentHash = '') {
		try {
			const { data } = await axios.post<
				{
					promises: Array<SerializedBlindedSignature>;
				} & ApiError
			>(`${this.mintUrl}/mint`, payloads, {
				params: { payment_hash: paymentHash }
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

	async getKeys(): Promise<MintKeys> {
		const { data } = await axios.get<MintKeys>(`${this.mintUrl}/keys`);
		return data;
	}

	async getKeySets(): Promise<{ keysets: Array<string> }> {
		const { data } = await axios.get<{ keysets: Array<string> }>(`${this.mintUrl}/keysets`);
		return data;
	}

	async split(splitPayload: SplitPayload): Promise<SplitResponse> {
		try {
			const { data } = await axios.post<SplitResponse>(`${this.mintUrl}/split`, splitPayload);
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
	async melt(meltPayload: MeltPayload): Promise<MeltResponse> {
		try {
			const { data } = await axios.post<MeltResponse>(`${this.mintUrl}/melt`, meltPayload);
			checkResponse(data);
			checkResponse(data);
			if (!isObj(data) || typeof data?.paid !== 'boolean' || typeof data?.preimage !== 'string') {
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
