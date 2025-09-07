import { Keyset } from './Keyset';
import { type Mint } from '../mint';
import { type MintKeyset, type MintKeys } from '../model/types';

export class KeyChain {
	private mint: Mint;
	private unit: string;
	private keysets: { [id: string]: Keyset } = {};
	private _activeKeysetId: string | undefined;

	constructor(
		mint: Mint,
		unit: string,
		cachedKeysets?: MintKeyset[],
		cachedKeys?: MintKeys[] | MintKeys,
	) {
		this.mint = mint;
		this.unit = unit;
		if (cachedKeysets && cachedKeys) {
			// Normalize and preload if both are provided
			const arrayOfKeys = Array.isArray(cachedKeys) ? cachedKeys : [cachedKeys];
			this.buildKeychain(cachedKeysets, arrayOfKeys);
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
		const [allKeysetsResponse, allKeysResponse]: [
			{ keysets: MintKeyset[] },
			{ keysets: MintKeys[] },
		] = await Promise.all([this.mint.getKeySets(), this.mint.getKeys()]);

		this.buildKeychain(allKeysetsResponse.keysets, allKeysResponse.keysets);
	}

	/**
	 * Builds keychain from Mint Keyset and Keys data.
	 *
	 * @param allKeysets Keyset data from mint.getKeySets() API.
	 * @param allKeys Keys data from mint.getKeys() API.
	 */
	private buildKeychain(allKeysets: MintKeyset[], allKeys: MintKeys[]): void {
		// Clear existing keysets to avoid stale data
		this.keysets = {};

		// Filter and create Keysets for unit
		const unitKeysets = allKeysets.filter((k: MintKeyset) => k.unit === this.unit);
		unitKeysets.forEach((k: MintKeyset) => {
			this.keysets[k.id] = new Keyset(k.id, k.unit, k.active, k.input_fee_ppk, k.final_expiry);
		});

		// Create map of keys filtered by unit for fast lookup
		const keysMap = new Map<string, MintKeys>(
			allKeys.filter((k) => k.unit === this.unit).map((k) => [k.id, k]),
		);

		// Assign keys and validate active hex keysets
		// Note: Non-hex and inactive keysets should not have keys
		Object.values(this.keysets).forEach((keyset) => {
			if (!keyset.hasHexId || !keyset.isActive) return;
			const mk = keysMap.get(keyset.id);
			if (mk) {
				keyset.keys = mk.keys;
				if (!keyset.verify()) {
					throw new Error(`Keyset verification failed for ID ${keyset.id}`);
				}
			}
		});

		// Set active ID
		this._activeKeysetId = this.getCheapestKeyset().id;
	}

	/**
	 * Get a keyset by ID or the active keyset if no ID is provided.
	 *
	 * @param id Optional keyset ID.
	 * @returns Keyset with keys.
	 * @throws If keyset not found or uninitialized.
	 */
	getKeyset(id?: string): Keyset {
		const keyset = id ? this.keysets[id] : this.getCheapestKeyset();
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
	getCheapestKeyset(): Keyset {
		if (Object.keys(this.keysets).length === 0) {
			throw new Error('KeyChain not initialized');
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
	getKeysets(): Keyset[] {
		if (Object.keys(this.keysets).length === 0) {
			throw new Error('KeyChain not initialized');
		}
		return Object.values(this.keysets);
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
		const allKeysets = this.getKeysets();
		const allKeys = allKeysets
			.filter((k) => k.hasKeys)
			.map((k) => k.toMintKeys())
			.filter((mk): mk is MintKeys => mk !== null);
		return {
			keysets: allKeysets.map((k) => k.toMintKeyset()),
			keys: allKeys,
			unit: this.unit,
			mintUrl: this.mint.mintUrl,
		};
	}
}
