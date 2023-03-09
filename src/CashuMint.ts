import axios from 'axios';
import {
	CheckSpendablePayload,
	CheckSpendableResponse,
	MeltPayload,
	MeltResponse,
	MintKeys,
	requestMintResponse,
	SerializedBlindedMessage,
	SerializedBlindedSignature,
	SplitPayload,
	SplitResponse
} from './model/types/index.js';

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

	async requestMint(amount: number): Promise<requestMintResponse> {
		const { data } = await axios.get<requestMintResponse>(`${this.mintUrl}/mint`, {
			params: { amount }
		});
		return data;
	}
	async mint(payloads: { outputs: Array<SerializedBlindedMessage> }, paymentHash = '') {
		const { data } = await axios.post<{
			promises: Array<SerializedBlindedSignature> | { error: string };
		}>(`${this.mintUrl}/mint`, payloads, {
			params: { payment_hash: paymentHash }
		});
		return data;
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
		const { data } = await axios.post<SplitResponse>(`${this.mintUrl}/split`, splitPayload);
		return data;
	}
	async melt(meltPayload: MeltPayload): Promise<MeltResponse> {
		const { data } = await axios.post<MeltResponse>(`${this.mintUrl}/melt`, meltPayload);
		return data;
	}
	async checkFees(checkfeesPayload: { pr: string }): Promise<{ fee: number }> {
		const { data } = await axios.post<{ fee: number }>(
			`${this.mintUrl}/checkfees`,
			checkfeesPayload
		);
		return data;
	}
	async check(checkPayload: CheckSpendablePayload): Promise<CheckSpendableResponse> {
		const { data } = await axios.post<CheckSpendableResponse>(
			`${this.mintUrl}/check`,
			checkPayload
		);
		return data;
	}
}

export { CashuMint };
