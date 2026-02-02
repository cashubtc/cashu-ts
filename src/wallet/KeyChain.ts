import { Keyset } from './Keyset';
import { Mint } from '../mint';
import type {
	MintKeyset,
	MintKeys,
	GetKeysetsResponse,
	GetKeysResponse,
	KeyChainCache,
	KeysetCache,
} from '../model/types/keyset';

/**
 * Manages the unit-specific keysets for a Mint.
 *
 * @remarks
 * Will ONLY load keysets in the KeyChain unit.
 */
export class KeyChain {
	private mint: Mint;
	private unit: string;
	private keysets: { [id: string]: Keyset } = {};
	private pendingKeyFetches: Map<string, Promise<Keyset>> = new Map();

	constructor(
		mint: string | Mint,
		unit: string,
		cachedKeysets?: MintKeyset[],
		cachedKeys?: MintKeys[] | MintKeys,
	) {
		this.mint = typeof mint === 'string' ? new Mint(mint) : mint;
		this.unit = unit;

		// Legacy preload path using Mint API DTOs
		if (cachedKeysets && cachedKeys) {
			const arrayOfKeys = Array.isArray(cachedKeys) ? cachedKeys : [cachedKeys];
			this.buildKeychain(cachedKeysets, arrayOfKeys);
		}
	}

	// ---------------------------------------------------------------------
	// Static helpers
	// ---------------------------------------------------------------------

	/**
	 * Construct a KeyChain from previously cached data.
	 *
	 * @remarks
	 * Does not hit the network. The cache should have been produced by `keyChain.cache`.
	 */
	static fromCache(mint: string | Mint, cache: KeyChainCache): KeyChain {
		const chain = new KeyChain(mint, cache.unit);
		chain.loadFromCache(cache);
		return chain;
	}

	/**
	 * Convert Mint API DTOs into a consolidated KeyChainCache.
	 *
	 * @remarks
	 * This is symmetrical to {@link KeyChain.cacheToMintDTO}. It is used by the `cache` getter and any
	 * code that wants to move from raw Mint DTOs to the new cache shape.
	 */
	static mintToCacheDTO(
		unit: string,
		mintUrl: string,
		allKeysets: MintKeyset[],
		allKeys: MintKeys[],
	): KeyChainCache {
		const keysById = new Map<string, MintKeys>(allKeys.map((k) => [k.id, k]));
		const cacheKeysets: KeysetCache[] = allKeysets.map((meta) => {
			const maybeKeys = keysById.get(meta.id);
			const kc: KeysetCache = { ...meta };
			if (maybeKeys) {
				kc.keys = maybeKeys.keys;
			}
			return kc;
		});
		return {
			keysets: cacheKeysets,
			unit,
			mintUrl,
		};
	}

	/**
	 * Convert a KeyChainCache back into Mint API DTOs.
	 *
	 * @remarks
	 * This is the inverse of {@link KeyChain.mintToCacheDTO} and is used by `loadFromCache` and the
	 * deprecated `getCache()` wrapper.
	 */
	static cacheToMintDTO(cache: KeyChainCache): {
		keysets: MintKeyset[];
		keys: MintKeys[];
	} {
		const keysets: MintKeyset[] = cache.keysets.map((k) => ({
			id: k.id,
			unit: k.unit,
			active: k.active,
			input_fee_ppk: k.input_fee_ppk,
			final_expiry: k.final_expiry,
		}));

		const keys: MintKeys[] = cache.keysets
			.filter((k): k is KeysetCache & { keys: NonNullable<KeysetCache['keys']> } => !!k.keys)
			.map((k) => ({
				id: k.id,
				unit: k.unit,
				active: k.active,
				input_fee_ppk: k.input_fee_ppk,
				final_expiry: k.final_expiry,
				keys: k.keys,
			}));

		return { keysets, keys };
	}

	// ---------------------------------------------------------------------
	// Mint loading
	// ---------------------------------------------------------------------

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
		const [allKeysetsResponse, allKeysResponse]: [GetKeysetsResponse, GetKeysResponse] =
			await Promise.all([this.mint.getKeySets(), this.mint.getKeys()]);

		this.buildKeychain(allKeysetsResponse.keysets, allKeysResponse.keysets);
	}

	/**
	 * Synchronously load keysets and keys from cached data.
	 *
	 * @remarks
	 * Does not hit the network. Intended for callers that already have a KeyChainCache and want a
	 * synchronous path.
	 */
	loadFromCache(cache: KeyChainCache): void {
		if (cache.unit !== this.unit) {
			throw new Error(
				`KeyChain unit mismatch in cache, expected '${this.unit}', got '${cache.unit}' from ${cache.mintUrl}`,
			);
		}

		const { keysets, keys } = KeyChain.cacheToMintDTO(cache);
		this.buildKeychain(keysets, keys);
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
		const keysMap = new Map<string, MintKeys>(
			allKeys.filter((k) => k.unit === this.unit).map((k) => [k.id, k]),
		);

		// Build keysets
		for (const meta of unitKeysets) {
			// Add keys if we have them
			const mk = keysMap.get(meta.id);
			const keyset = mk ? Keyset.fromMintApi(meta, mk) : Keyset.fromMintApi(meta);

			// Discard unverifed keys
			if (keyset.hasKeys && !keyset.verify()) {
				keyset.keys = {};
			}

			// Add to keychain
			this.keysets[keyset.id] = keyset;
		}
	}

	// ---------------------------------------------------------------------
	// Queries
	// ---------------------------------------------------------------------

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
	 * Ensure we have usable keys for a specific keyset id.
	 *
	 * @param id Keyset ID.
	 * @returns Keyset with keys.
	 * @throws If keyset keys not found or verification fails.
	 */
	async ensureKeysetKeys(id: string): Promise<Keyset> {
		// Check keyset exists
		const existing = this.keysets[id];
		if (!existing) {
			throw new Error(`Keyset '${id}' not found`);
		}

		// Already usable
		if (existing.hasKeys) {
			return existing;
		}

		// Dedupe concurrent requests
		const pending = this.pendingKeyFetches.get(id);
		if (pending) {
			return await pending;
		}

		const promise = (async () => {
			// Get keys for id
			const res = await this.mint.getKeys(id);
			const mk = res.keysets.find((k) => k.id === id);
			if (!mk || !mk.keys || Object.keys(mk.keys).length === 0) {
				throw new Error(`Mint returned no keys for keyset '${id}'`);
			}

			// Rebuild from existing meta plus fetched keys
			const meta = existing.toMintKeyset();
			const rebuilt = Keyset.fromMintApi(meta, mk);
			if (!rebuilt.verify()) {
				throw new Error(`Keyset verification failed for ID ${id}`);
			}

			// Replace keyset with rebuilt one
			this.keysets[id] = rebuilt;
			return rebuilt;
		})();

		this.pendingKeyFetches.set(id, promise);

		try {
			return await promise;
		} finally {
			this.pendingKeyFetches.delete(id);
		}
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
	 * Returns all the keys in this KeyChain.
	 *
	 * @remarks
	 * This mirrors the old `wallet.getAllKeys()` behaviour and is the preferred replacement in v3.
	 * @returns Array of MintKeys objects.
	 * @throws If uninitialized.
	 */
	getAllKeys(): MintKeys[] {
		return this.getKeysets()
			.map((k) => k.toMintKeys())
			.filter((mk): mk is MintKeys => mk !== null);
	}

	/**
	 * Returns all the keyset IDs in this KeyChain.
	 *
	 * @returns Array of keyset IDs.
	 * @throws If uninitialized.
	 */
	getAllKeysetIds(): string[] {
		return this.getKeysets().map((k) => k.id);
	}

	// ---------------------------------------------------------------------
	// Caching
	// ---------------------------------------------------------------------

	/**
	 * Preferred consolidated cache representation.
	 *
	 * @remarks
	 * Built from the live Keyset instances via their Mint DTO exporters. This is the canonical cache
	 * API going forward.
	 */
	get cache(): KeyChainCache {
		const allKeysets: Keyset[] = this.getKeysets();
		const metaList: MintKeyset[] = allKeysets.map((k) => k.toMintKeyset());
		const keysList: MintKeys[] = allKeysets
			.map((k) => k.toMintKeys())
			.filter((mk): mk is MintKeys => mk !== null);
		return KeyChain.mintToCacheDTO(this.unit, this.mint.mintUrl, metaList, keysList);
	}

	/**
	 * Legacy Mint API cache format.
	 *
	 * @remarks
	 * Useful for instantiating new wallets / keychains without repeatedly calling the mint API.
	 * @deprecated Use the `cache` getter which returns a consolidated KeyChainCache.
	 */
	getCache(): {
		keysets: MintKeyset[];
		keys: MintKeys[];
		unit: string;
		mintUrl: string;
	} {
		const cache = this.cache;
		const { keysets, keys } = KeyChain.cacheToMintDTO(cache);
		return {
			keysets,
			keys,
			unit: cache.unit,
			mintUrl: cache.mintUrl,
		};
	}
}
