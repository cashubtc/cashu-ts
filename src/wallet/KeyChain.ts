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
import { isValidHex } from '../utils';

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

			// Smoke test, fail fast on bad cache
			this.getCheapestKeyset();
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
				keys: k.keys,
				final_expiry: k.final_expiry,
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

		// Smoke test (will throw if init was unsuccessful)
		this.getCheapestKeyset();
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
				`KeyChain unit mismatch in cache, expected '${this.unit}', got '${cache.unit}'`,
			);
		}

		const { keysets, keys } = KeyChain.cacheToMintDTO(cache);
		this.buildKeychain(keysets, keys);

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
		const keysMap = new Map<string, MintKeys>(
			allKeys.filter((k) => k.unit === this.unit).map((k) => [k.id, k]),
		);

		// Build keysets
		for (const meta of unitKeysets) {
			let keyset: Keyset;

			// Only active hex keysets should have keys
			if (meta.active && isValidHex(meta.id)) {
				const mk = keysMap.get(meta.id);
				keyset = Keyset.fromMintApi(meta, mk);
			} else {
				keyset = Keyset.fromMintApi(meta);
			}

			// Validate active keysets with keys
			if (keyset.hasKeys && !keyset.verify()) {
				throw new Error(`Keyset verification failed for ID ${keyset.id}`);
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
