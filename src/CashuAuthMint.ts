import type {
	BlindAuthMintPayload,
	BlindAuthMintResponse,
	MintActiveKeys,
	MintAllKeysets
} from './model/types/index.js';
import request from './request.js';
import { isObj, joinUrls, sanitizeUrl } from './utils.js';
/**
 * Class represents Cashu Mint API. This class contains Lower level functions that are implemented by CashuWallet.
 */
class CashuAuthMint {
	/**
	 * @param _mintUrl requires mint URL to create this object
	 * @param _customRequest if passed, use custom request implementation for network communication with the mint
	 */
	constructor(private _mintUrl: string, private _customRequest?: typeof request) {
		this._mintUrl = sanitizeUrl(_mintUrl);
		this._customRequest = _customRequest;
	}

	get mintUrl() {
		return this._mintUrl;
	}

	/**
	 * Mints new tokens by requesting blind signatures on the provided outputs.
	 * @param mintUrl
	 * @param mintPayload Payload containing the outputs to get blind signatures on
	 * @param customRequest
	 * @returns serialized blinded signatures
	 */
	public static async mint(
		mintUrl: string,
		mintPayload: BlindAuthMintPayload,
		clearAuthToken: string,
		customRequest?: typeof request
	) {
		const requestInstance = customRequest || request;
		const headers = {
			'Clear-auth': `${clearAuthToken}`
		};
		const data = await requestInstance<BlindAuthMintResponse>({
			endpoint: joinUrls(mintUrl, '/v1/auth/blind/mint'),
			method: 'POST',
			requestBody: mintPayload,
			headers
		});

		if (!isObj(data) || !Array.isArray(data?.signatures)) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Mints new tokens by requesting blind signatures on the provided outputs.
	 * @param mintPayload Payload containing the outputs to get blind signatures on
	 * @returns serialized blinded signatures
	 */
	async mint(mintPayload: BlindAuthMintPayload, clearAuthToken: string) {
		return CashuAuthMint.mint(this._mintUrl, mintPayload, clearAuthToken, this._customRequest);
	}

	/**
	 * Get the mints public keys
	 * @param mintUrl
	 * @param keysetId optional param to get the keys for a specific keyset. If not specified, the keys from all active keysets are fetched
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
			endpoint: keysetId
				? joinUrls(mintUrl, '/v1/auth/blind/keys', keysetId)
				: joinUrls(mintUrl, '/v1/auth/blind/keys')
		});

		if (!isObj(data) || !Array.isArray(data.keysets)) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Get the mints public keys
	 * @param keysetId optional param to get the keys for a specific keyset. If not specified, the keys from all active keysets are fetched
	 * @returns the mints public keys
	 */
	async getKeys(keysetId?: string, mintUrl?: string): Promise<MintActiveKeys> {
		const allKeys = await CashuAuthMint.getKeys(
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
		return requestInstance<MintAllKeysets>({
			endpoint: joinUrls(mintUrl, '/v1/auth/blind/keysets')
		});
	}

	/**
	 * Get the mints keysets in no specific order
	 * @returns all the mints past and current keysets.
	 */
	async getKeySets(): Promise<MintAllKeysets> {
		return CashuAuthMint.getKeySets(this._mintUrl, this._customRequest);
	}
}

export { CashuAuthMint };
