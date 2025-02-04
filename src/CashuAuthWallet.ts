import { CashuAuthMint } from './CashuAuthMint.js';
import {
	type MintKeys,
	type MintKeyset,
	type Proof,
	GetInfoResponse,
	BlindAuthMintPayload
} from './model/types/index.js';
import { OutputData } from './model/OutputData.js';

/**
 * Class that represents a Cashu wallet.
 * This class should act as the entry point for this library
 */
class CashuAuthWallet {
	private _keys: Map<string, MintKeys> = new Map();
	private _keysetId: string | undefined;
	private _keysets: Array<MintKeyset> = [];
	private _unit = 'auth';
	private _mintInfo: GetInfoResponse | undefined = undefined;

	mint: CashuAuthMint;

	/**
	 * @param mint Cashu mint instance is used to make api calls
	 * @param options.unit optionally set unit (default is 'sat')
	 * @param options.keys public keys from the mint (will be fetched from mint if not provided)
	 * @param options.keysets keysets from the mint (will be fetched from mint if not provided)
	 * @param options.mintInfo mint info from the mint (will be fetched from mint if not provided)
	 * @param options.denominationTarget target number proofs per denomination (default: see @constant DEFAULT_DENOMINATION_TARGET)
	 * @param options.bip39seed BIP39 seed for deterministic secrets.
	 * This can lead to poor performance, in which case the seed should be directly provided
	 */
	constructor(
		mint: CashuAuthMint,
		options?: {
			keys?: Array<MintKeys> | MintKeys;
			keysets?: Array<MintKeyset>;
			mintInfo?: GetInfoResponse;
		}
	) {
		this.mint = mint;
		let keys: Array<MintKeys> = [];
		if (options?.keys && !Array.isArray(options.keys)) {
			keys = [options.keys];
		} else if (options?.keys && Array.isArray(options?.keys)) {
			keys = options?.keys;
		}
		if (keys) keys.forEach((key: MintKeys) => this._keys.set(key.id, key));
		if (options?.keysets) this._keysets = options.keysets;
	}

	get keys(): Map<string, MintKeys> {
		return this._keys;
	}
	get keysetId(): string {
		if (!this._keysetId) {
			throw new Error('No keysetId set');
		}
		return this._keysetId;
	}
	set keysetId(keysetId: string) {
		this._keysetId = keysetId;
	}
	get keysets(): Array<MintKeyset> {
		return this._keysets;
	}
	get mintInfo(): GetInfoResponse {
		if (!this._mintInfo) {
			throw new Error('Mint info not loaded');
		}
		return this._mintInfo;
	}

	/**
	 * Load mint information, keysets and keys. This function can be called if no keysets are passed in the constructor
	 */
	async loadMint() {
		await this.getKeySets();
		await this.getKeys();
	}

	/**
	 * Choose a keyset to activate based on the lowest input fee
	 *
	 * Note: this function will filter out deprecated base64 keysets
	 *
	 * @param keysets keysets to choose from
	 * @returns active keyset
	 */
	getActiveKeyset(keysets: Array<MintKeyset>): MintKeyset {
		let activeKeysets = keysets.filter((k: MintKeyset) => k.active);

		// we only consider keyset IDs that start with "00"
		activeKeysets = activeKeysets.filter((k: MintKeyset) => k.id.startsWith('00'));

		const activeKeyset = activeKeysets.sort(
			(a: MintKeyset, b: MintKeyset) => (a.input_fee_ppk ?? 0) - (b.input_fee_ppk ?? 0)
		)[0];
		if (!activeKeyset) {
			throw new Error('No active keyset found');
		}
		return activeKeyset;
	}

	/**
	 * Get keysets from the mint with the unit of the wallet
	 * @returns keysets with wallet's unit
	 */
	async getKeySets(): Promise<Array<MintKeyset>> {
		const allKeysets = await this.mint.getKeySets();
		const unitKeysets = allKeysets.keysets.filter((k: MintKeyset) => k.unit === this._unit);
		this._keysets = unitKeysets;
		return this._keysets;
	}

	/**
	 * Get all active keys from the mint and set the keyset with the lowest fees as the active wallet keyset.
	 * @returns keyset
	 */
	async getAllKeys(): Promise<Array<MintKeys>> {
		const keysets = await this.mint.getKeys();
		this._keys = new Map(keysets.keysets.map((k: MintKeys) => [k.id, k]));
		this.keysetId = this.getActiveKeyset(this._keysets).id;
		return keysets.keysets;
	}

	/**
	 * Get public keys from the mint. If keys were already fetched, it will return those.
	 *
	 * If `keysetId` is set, it will fetch and return that specific keyset.
	 * Otherwise, we select an active keyset with the unit of the wallet.
	 *
	 * @param keysetId optional keysetId to get keys for
	 * @param forceRefresh? if set to true, it will force refresh the keyset from the mint
	 * @returns keyset
	 */
	async getKeys(keysetId?: string, forceRefresh?: boolean): Promise<MintKeys> {
		if (!(this._keysets.length > 0) || forceRefresh) {
			await this.getKeySets();
		}
		// no keyset id is chosen, let's choose one
		if (!keysetId) {
			const localKeyset = this.getActiveKeyset(this._keysets);
			keysetId = localKeyset.id;
		}
		// make sure we have keyset for this id
		if (!this._keysets.find((k: MintKeyset) => k.id === keysetId)) {
			await this.getKeySets();
			if (!this._keysets.find((k: MintKeyset) => k.id === keysetId)) {
				throw new Error(`could not initialize keys. No keyset with id '${keysetId}' found`);
			}
		}

		// make sure we have keys for this id
		if (!this._keys.get(keysetId)) {
			const keys = await this.mint.getKeys(keysetId);
			this._keys.set(keysetId, keys.keysets[0]);
		}

		// set and return
		this.keysetId = keysetId;
		return this._keys.get(keysetId) as MintKeys;
	}

	/**
	 * Mint proofs for a given mint quote
	 * @param amount amount to request
	 * @param clearAuthToken clearAuthToken to mint
	 * @param options.keysetId? optionally set keysetId for blank outputs for returned change.
	 * @param options.preference? Deprecated. Use `outputAmounts` instead. Optional preference for splitting proofs into specific amounts.
	 * @param options.outputAmounts? optionally specify the output's amounts to keep and to send.
	 * @param options.counter? optionally set counter to derive secret deterministically. CashuAuthWallet class must be initialized with seed phrase to take effect
	 * @param options.pubkey? optionally locks ecash to pubkey. Will not be deterministic, even if counter is set!
	 * @returns proofs
	 */
	async mintProofs(
		amount: number,
		clearAuthToken: string,
		options?: {
			keysetId?: string;
		}
	): Promise<Array<Proof>> {
		const keyset = await this.getKeys(options?.keysetId);
		const outputData = OutputData.createRandomData(amount, keyset);

		const mintPayload: BlindAuthMintPayload = {
			outputs: outputData.map((d) => d.blindedMessage)
		};
		const { signatures } = await this.mint.mint(mintPayload, clearAuthToken);
		return outputData.map((d, i) => d.toProof(signatures[i], keyset));
	}
}

export { CashuAuthWallet };
