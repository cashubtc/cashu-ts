import { OutputData } from '../model/OutputData';
import {
	type BlindAuthMintPayload,
	type MintKeys,
	type MintKeyset,
	type Proof,
} from '../model/types';
import { hasValidDleq } from '../utils';
import { type CashuAuthMint } from './CashuAuthMint';

/**
 * Class that represents a Cashu NUT-22 wallet.
 */
class CashuAuthWallet {
	private _keys: Map<string, MintKeys> = new Map();
	private _keysetId: string | undefined;
	private _keysets: MintKeyset[] = [];
	private _unit = 'auth';

	mint: CashuAuthMint;

	/**
	 * @param mint NUT-22 auth mint instance.
	 * @param options.keys Public keys from the mint (will be fetched from mint if not provided)
	 * @param options.keysets Keysets from the mint (will be fetched from mint if not provided)
	 */
	constructor(
		mint: CashuAuthMint,
		options?: {
			keys?: MintKeys[] | MintKeys;
			keysets?: MintKeyset[];
		},
	) {
		this.mint = mint;
		let keys: MintKeys[] = [];
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
	get keysets(): MintKeyset[] {
		return this._keysets;
	}

	/**
	 * Load mint information, keysets and keys. This function can be called if no keysets are passed
	 * in the constructor.
	 */
	async loadMint() {
		await this.getKeySets();
		await this.getKeys();
	}

	/**
	 * Choose a keyset to activate based on the lowest input fee.
	 *
	 * Note: this function will filter out deprecated base64 keysets.
	 *
	 * @param keysets Keysets to choose from.
	 * @returns Active keyset.
	 */
	getActiveKeyset(keysets: MintKeyset[]): MintKeyset {
		let activeKeysets = keysets.filter((k: MintKeyset) => k.active);

		// we only consider keyset IDs that start with "00"
		activeKeysets = activeKeysets.filter((k: MintKeyset) => k.id.startsWith('00'));

		const activeKeyset = activeKeysets.sort(
			(a: MintKeyset, b: MintKeyset) => (a.input_fee_ppk ?? 0) - (b.input_fee_ppk ?? 0),
		)[0];
		if (!activeKeyset) {
			throw new Error('No active keyset found');
		}
		return activeKeyset;
	}

	/**
	 * Get keysets from the mint with the unit of the wallet.
	 *
	 * @returns Keysets with wallet's unit.
	 */
	async getKeySets(): Promise<MintKeyset[]> {
		const allKeysets = await this.mint.getKeySets();
		const unitKeysets = allKeysets.keysets.filter((k: MintKeyset) => k.unit === this._unit);
		this._keysets = unitKeysets;
		return this._keysets;
	}

	/**
	 * Get all active keys from the mint and set the keyset with the lowest fees as the active wallet
	 * keyset.
	 *
	 * @returns Keyset.
	 */
	async getAllKeys(): Promise<MintKeys[]> {
		const keysets = await this.mint.getKeys();
		this._keys = new Map(keysets.keysets.map((k: MintKeys) => [k.id, k]));
		this.keysetId = this.getActiveKeyset(this._keysets).id;
		return keysets.keysets;
	}

	/**
	 * Get public keys from the mint. If keys were already fetched, it will return those.
	 *
	 * If `keysetId` is set, it will fetch and return that specific keyset. Otherwise, we select an
	 * active keyset with the unit of the wallet.
	 *
	 * @param keysetId Optional keysetId to get keys for.
	 * @param forceRefresh? If set to true, it will force refresh the keyset from the mint.
	 * @returns Keyset.
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
	 * Mint proofs for a given mint quote.
	 *
	 * @param amount Amount to request.
	 * @param clearAuthToken ClearAuthToken to mint.
	 * @param options.keysetId? Optionally set keysetId for blank outputs for returned change.
	 * @returns Proofs.
	 */
	async mintProofs(
		amount: number,
		clearAuthToken: string,
		options?: {
			keysetId?: string;
		},
	): Promise<Proof[]> {
		const keyset = await this.getKeys(options?.keysetId);
		const outputData = OutputData.createRandomData(amount, keyset);

		const mintPayload: BlindAuthMintPayload = {
			outputs: outputData.map((d) => d.blindedMessage),
		};
		const { signatures } = await this.mint.mint(mintPayload, clearAuthToken);
		const authProofs = outputData.map((d, i) => d.toProof(signatures[i], keyset));
		if (authProofs.some((p) => !hasValidDleq(p, keyset))) {
			throw new Error('Mint returned auth proofs with invalid DLEQ');
		}
		return authProofs;
	}
}

export { CashuAuthWallet };
