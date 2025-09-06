import { Keyset } from './Keyset';
import { type Mint } from '../Mint';
import { type MintKeyset, type MintKeys, type MintAllKeysets, type MintActiveKeys } from './types';
import { verifyKeysetId } from '../utils';

export class KeyChain {
	private mint: Mint;
	private unit: string;
	private keysets: { [id: string]: Keyset } = {};
	private _activeKeysetId: string | undefined;

	constructor(
		mint: Mint,
		unit: string,
		cachedKeysets?: MintKeyset[] | MintAllKeysets,
		cachedKeys?: MintKeys[] | MintKeys | MintActiveKeys,
	) {
		this.mint = mint;
		this.unit = unit;
		if (cachedKeysets && cachedKeys) {
			// Normalize and preload if both are provided
			const allKeysets = 'keysets' in cachedKeysets ? cachedKeysets : { keysets: cachedKeysets };
			const activeKeys =
				'keysets' in cachedKeys
					? cachedKeys
					: { keysets: Array.isArray(cachedKeys) ? cachedKeys : [cachedKeys] };
			this.buildKeychain(allKeysets, activeKeys);
		}
	}

	/**
	 * Single entry point to load or refresh keysets and keys for the unit.
	 *
	 * @remarks
	 * Fetches in parallel, filters by unit, assigns keys.
	 * @param forceRefresh If true, refetch even if loaded.
	 */
	async init(forceRefresh?: boolean): Promise<void> {
		// Skip if already loaded, unless force
		if (Object.keys(this.keysets).length > 0 && !forceRefresh) {
			return;
		}

		// Fetch keys and keysets in parallel
		const [allKeysets, allKeys] = await Promise.all([
			this.mint.getKeySets(), // Returns MintAllKeysets
			this.mint.getKeys(), // Returns MintActiveKeys
		]);

		this.buildKeychain(allKeysets, allKeys);
	}

	/**
	 * Builds keychain from MintAllKeysets and MintActiveKeys data.
	 *
	 * @param allKeysets Keyset data from mint.getKeySets() API.
	 * @param allKeys Keys data from mint.getKeys() API.
	 */
	private buildKeychain(allKeysets: MintAllKeysets, allKeys: MintActiveKeys): void {
		// Clear existing keysets to avoid stale data
		this.keysets = {};

		// Filter and create Keysets for unit
		const unitKeysets = allKeysets.keysets.filter((k: MintKeyset) => k.unit === this.unit);
		unitKeysets.forEach((k: MintKeyset) => {
			this.keysets[k.id] = new Keyset(k.id, k.unit, k.active, k.input_fee_ppk, k.final_expiry);
		});

		// Assign keys to matching keysets
		allKeys.keysets.forEach((mk: MintKeys) => {
			const keyset = this.keysets[mk.id];
			if (keyset && mk.unit === this.unit) {
				keyset.keyPairs = mk.keys;
			}
		});

		// Set active ID
		this._activeKeysetId = this.getActiveKeyset().id;

		// Validate
		if (!this._activeKeysetId) {
			throw new Error('No active keyset found for unit');
		}
	}

	/**
	 * Get a keyset by ID. Assumes init() called.
	 *
	 * @param id Keyset ID.
	 * @returns Keyset with keys.
	 * @throws If not found.
	 */
	getKeyset(id: string): Keyset {
		const keyset = this.keysets[id];
		if (!keyset) {
			throw new Error(`Keyset '${id}' not found`);
		}
		return keyset;
	}

	/**
	 * Get the active keyset.
	 *
	 * @remarks
	 * Selects active keyset with lowest fee and hex ID.
	 * @returns Active Keyset.
	 * @throws If none found or uninitialized.
	 */
	getActiveKeyset(): Keyset {
		if (Object.keys(this.keysets).length === 0) {
			throw new Error('KeyChain not initialized; call init() first');
		}
		const activeKeysets = Object.values(this.keysets).filter((k) => k.isActive && k.hasHexId);
		if (activeKeysets.length === 0) {
			throw new Error('No active keyset found');
		}
		return activeKeysets.sort((a, b) => a.fee - b.fee)[0];
	}

	/**
	 * Get list of all keysets for the unit.
	 *
	 * @returns Array of Keysets.
	 * @throws If uninitialized.
	 */
	getKeysetList(): Keyset[] {
		if (Object.keys(this.keysets).length === 0) {
			throw new Error('KeyChain not initialized; call init() first');
		}
		return Object.values(this.keysets);
	}

	/**
	 * Get keys for a keyset (default: the active keyset)
	 *
	 * @param id Optional ID; defaults to active.
	 * @returns {id, unit, final_expiry?, keys} .
	 * @throws If no keys found.
	 */
	getKeys(id?: string): MintKeys {
		const keyset = id ? this.getKeyset(id) : this.getActiveKeyset();
		const mintKeys = keyset.toMintKeys();
		if (!mintKeys) {
			throw new Error(`No keys loaded for keyset '${id || keyset.id}'`);
		}
		if (!verifyKeysetId(mintKeys)) {
			throw new Error(`Couldn't verify keyset ID '${id || keyset.id}'`);
		}
		return mintKeys;
	}

	/**
	 * Get all keys for all loaded keysets in the unit.
	 *
	 * @returns Array of MintKeys for keysets that have keys loaded.
	 * @throws If uninitialized or if any keyset ID verification fails.
	 */
	getAllKeys(): MintKeys[] {
		if (Object.keys(this.keysets).length === 0) {
			throw new Error('KeyChain not initialized; call init() first');
		}
		const allKeysets = this.getKeysetList();
		const allKeys = allKeysets
			.map((k) => k.toMintKeys())
			.filter((mk): mk is MintKeys => mk !== null);
		allKeys.forEach((keys) => {
			if (!verifyKeysetId(keys)) {
				throw new Error(`Couldn't verify keyset ID '${keys.id}'`);
			}
		});
		return allKeys;
	}

	/**
	 * Extract the Mint API data from the keychain.
	 *
	 * @remarks
	 * Useful for instantiating new wallets / keychains without repeatedly calling the mint API.
	 */
	getCache(): {
		keysets: MintKeyset[];
		keys: MintKeys[];
		unit: string;
		mintUrl: string;
	} {
		const allKeysets = this.getKeysetList();
		return {
			keysets: allKeysets.map((k) => k.toMintKeyset()),
			keys: this.getAllKeys(), // Reuse getAllKeys() to avoid duplication
			unit: this.unit,
			mintUrl: this.mint.mintUrl,
		};
	}
}
