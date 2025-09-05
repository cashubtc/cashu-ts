import { Keyset } from './Keyset';
import { type Mint } from '../Mint';
import { type MintKeyset, type MintKeys, type MintAllKeysets, type MintActiveKeys } from './types';

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
		if (!keyset.hasKeyPairs) {
			throw new Error(`No keys loaded for keyset '${id || keyset.id}'`);
		}
		return {
			id: keyset.id,
			unit: keyset.unit,
			keys: keyset.keyPairs!,
		} as MintKeys;
	}

	/**
	 * Extract the Mint API data from the keychain.
	 *
	 * @remarks
	 * Useful for instantiating new wallets / keychains without repeatedly calling the mint API.
	 */
	getCache(): { cachedKeysets: MintKeyset[]; cachedKeys: MintKeys[] } {
		const unitKeysets = this.getKeysetList().map((k) => ({
			id: k.id,
			unit: k.unit,
			active: k.isActive,
			input_fee_ppk: k.fee,
			final_expiry: k.final_expiry,
		}));
		const unitKeys = unitKeysets.map((k) => this.getKeys(k.id)).filter(Boolean);
		return {
			cachedKeysets: unitKeysets,
			cachedKeys: unitKeys,
		};
	}
}
