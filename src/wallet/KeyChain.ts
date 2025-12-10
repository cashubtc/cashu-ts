import { Keyset } from './Keyset';
import { Mint } from '../mint';
import type { MintKeyset, MintKeys, MintAllKeysets, MintActiveKeys } from '../model/types/keyset';
import { isValidHex } from '../utils';

/**
 * Manages the unit-specific keysets for a Mint.
 *
 * @remarks
 * Will ONLY load keysets in the Keychain unit.
 */
export class KeyChain {
	private mint: Mint;
	private unit: string;
	private keysets: { [id: string]: Keyset } = {};

	constructor(
		mint: string | Mint,
		unit: string,
		cachedKeysets?: MintKeyset[],
		cachedKeys?: MintKeys[] | MintKeys,
	) {
		this.mint = typeof mint === 'string' ? new Mint(mint) : mint;
		this.unit = unit;
		// Optional preload
		if (cachedKeysets && cachedKeys) {
			this.loadFromCache(cachedKeysets, cachedKeys);
		}
	}

	/**
	 * Asynchronously load keysets and keys from the mint.
	 *
	 * @remarks
	 * Intended for callers that want the freshest data from the mint and can use an asynchronous
	 * path.
	 * @param forceRefresh If true, re-fetches data even if already loaded.
	 */
	async init(forceRefresh?: boolean): Promise<void> {
		// Skip if already loaded, unless force
		if (Object.keys(this.keysets).length > 0 && !forceRefresh) {
			return;
		}

		// Fetch keys and keysets in parallel
		const [allKeysetsResponse, allKeysResponse]: [MintAllKeysets, MintActiveKeys] =
			await Promise.all([this.mint.getKeySets(), this.mint.getKeys()]);

		this.buildKeychain(allKeysetsResponse.keysets, allKeysResponse.keysets);

		// Smoke test (will throw if init was unsuccessful)
		this.getCheapestKeyset();
	}

	/**
	 * Synchronously load keysets and keys from cached data.
	 *
	 * @remarks
	 * Does not hit the network. Intended for callers that already have MintKeyset and MintKeys data
	 * and need a synchronous path.
	 */
	loadFromCache(cachedKeysets: MintKeyset[], cachedKeys: MintKeys[] | MintKeys): void {
		const arrayOfKeys = Array.isArray(cachedKeys) ? cachedKeys : [cachedKeys];
		this.buildKeychain(cachedKeysets, arrayOfKeys);

		// Smoke test
		this.getCheapestKeyset();
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

		// Filter Keysets / Keys by unit
		const unitKeysets = allKeysets.filter((k) => k.unit === this.unit);
		if (!unitKeysets.length) {
			throw new Error(`No Keysets found for unit: ${this.unit}`);
		}
		const keysMap = new Map(allKeys.filter((k) => k.unit === this.unit).map((k) => [k.id, k]));

		// Build keysets
		for (const meta of unitKeysets) {
			let keyset: Keyset;

			// Note: only active hex keysets should have keys
			if (meta.active && isValidHex(meta.id)) {
				const mk = keysMap.get(meta.id);
				keyset = Keyset.fromMintApi(meta, mk);
			} else {
				keyset = Keyset.fromMintApi(meta);
			}

			// Validate active hex keysets
			if (keyset.hasKeys && !keyset.verify()) {
				throw new Error(`Keyset verification failed for ID ${keyset.id}`);
			}

			// Add to keychain
			this.keysets[keyset.id] = keyset;
		}
	}

	/**
	 * Get a keyset by ID or the cheapest keyset if no ID is provided.
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
	 * Get the cheapest active keyset.
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
		const activeKeysets = Object.values(this.keysets).filter(
			(k) => k.isActive && k.hasHexId && k.hasKeys,
		);
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
