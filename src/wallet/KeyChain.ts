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
 * Manages all keysets for a Mint. Queries filter by the wallet's unit.
 *
 * @remarks
 * Stores keysets for every unit the mint exposes. Methods like `getKeysets()` and
 * `getCheapestKeyset()` filter by `this.unit`; `getKeyset(id)` is a direct lookup and is
 * intentionally cross-unit.
 */
export class KeyChain {
	private mint: Mint;
	private unit: string;
	private keysets: { [id: string]: Keyset } = {};
	private pendingKeyFetches: Map<string, Promise<Keyset>> = new Map();

	private assertInitialized(): void {
		if (Object.keys(this.keysets).length === 0) {
			throw new Error('KeyChain not initialized');
		}
	}

	constructor(mint: string | Mint, unit: string) {
		this.mint = typeof mint === 'string' ? new Mint(mint) : mint;
		this.unit = unit;
	}

	// ---------------------------------------------------------------------
	// Static helpers
	// ---------------------------------------------------------------------

	/**
	 * Construct a KeyChain from previously cached data.
	 *
	 * @remarks
	 * Does not hit the network. The cache should have been produced by `keyChain.cache`.
	 * @param mint Mint URL or Mint instance.
	 * @param unit The unit this KeyChain should filter queries by (e.g. 'sat').
	 * @param cache Cache produced by `keyChain.cache` or `KeyChain.mintToCacheDTO`.
	 */
	static fromCache(mint: string | Mint, unit: string, cache: KeyChainCache): KeyChain {
		const chain = new KeyChain(mint, unit);
		chain.loadFromCache(cache);
		return chain;
	}

	/**
	 * Convert Mint API DTOs into a consolidated KeyChainCache.
	 *
	 * @remarks
	 * This is symmetrical to {@link KeyChain.cacheToMintDTO}. It is used by the `cache` getter and any
	 * code that wants to move from raw Mint DTOs to the new cache shape.
	 * @param mintUrl Mint URL.
	 * @param allKeysets All keysets from mint.getKeySets() — any unit.
	 * @param allKeys All keys from mint.getKeys() — any unit.
	 */
	static mintToCacheDTO(
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
			mintUrl,
			savedAt: Date.now(),
		};
	}

	/**
	 * Convert a KeyChainCache back into Mint API DTOs.
	 *
	 * @remarks
	 * This is the inverse of {@link KeyChain.mintToCacheDTO}.
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
	 * synchronous path. Loads all keysets from the cache regardless of unit; query methods filter by
	 * `this.unit`.
	 */
	loadFromCache(cache: KeyChainCache): void {
		const { keysets, keys } = KeyChain.cacheToMintDTO(cache);
		this.buildKeychain(keysets, keys);
	}

	/**
	 * Builds keychain from Mint Keyset and Keys data. Stores all units.
	 *
	 * @param allKeysets Keyset data from mint.getKeySets() API.
	 * @param allKeys Keys data from mint.getKeys() API.
	 */
	private buildKeychain(allKeysets: MintKeyset[], allKeys: MintKeys[]): void {
		// Clear existing keysets to avoid stale data
		this.keysets = {};

		const keysMap = new Map<string, MintKeys>(allKeys.map((k) => [k.id, k]));

		for (const meta of allKeysets) {
			const mk = keysMap.get(meta.id);
			const keyset = mk ? Keyset.fromMintApi(meta, mk) : Keyset.fromMintApi(meta);

			// Discard unverified keys
			if (!keyset.verify()) {
				keyset.keys = {};
			}

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
			(k) => k.unit === this.unit && k.isActive && k.hasHexId && k.hasKeys,
		);
		if (activeKeysets.length === 0) {
			throw new Error(`No active keyset found for unit: ${this.unit}`);
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
	 * Get list of all keysets for the wallet's unit.
	 *
	 * @returns Array of Keysets for `this.unit`.
	 * @throws If uninitialized or no keysets exist for the unit.
	 */
	getKeysets(): Keyset[] {
		this.assertInitialized();
		const unitKeysets = Object.values(this.keysets).filter((k) => k.unit === this.unit);
		if (unitKeysets.length === 0) {
			throw new Error(`No keysets found for unit: ${this.unit}`);
		}
		return unitKeysets;
	}

	/**
	 * Returns all the keys in this KeyChain across all units.
	 *
	 * @returns Array of MintKeys objects.
	 * @throws If uninitialized.
	 */
	getAllKeys(): MintKeys[] {
		this.assertInitialized();
		return Object.values(this.keysets)
			.map((k) => k.toMintKeys())
			.filter((mk): mk is MintKeys => mk !== null);
	}

	/**
	 * Returns all the keyset IDs in this KeyChain across all units.
	 *
	 * @returns Array of keyset IDs.
	 * @throws If uninitialized.
	 */
	getAllKeysetIds(): string[] {
		this.assertInitialized();
		return Object.keys(this.keysets);
	}

	// ---------------------------------------------------------------------
	// Caching
	// ---------------------------------------------------------------------

	/**
	 * Preferred consolidated cache representation.
	 *
	 * @remarks
	 * Built from the live Keyset instances via their Mint DTO exporters.
	 */
	get cache(): KeyChainCache {
		// Use Object.values directly — all units, not just this.unit
		const allKeysets = Object.values(this.keysets);
		const metaList: MintKeyset[] = allKeysets.map((k) => k.toMintKeyset());
		const keysList: MintKeys[] = allKeysets
			.map((k) => k.toMintKeys())
			.filter((mk): mk is MintKeys => mk !== null);
		return KeyChain.mintToCacheDTO(this.mint.mintUrl, metaList, keysList);
	}
}
