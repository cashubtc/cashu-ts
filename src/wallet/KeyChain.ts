import { MAX_SUPPORTED_KEYSET_VERSION } from '../crypto/curves';
import { fail, failIf, type Logger, NULL_LOGGER } from '../logger';
import { Mint } from '../mint';
import { CTSError } from '../model/Errors';
import type {
  MintKeyset,
  MintKeys,
  GetKeysetsResponse,
  GetKeysResponse,
  KeyChainCache,
  KeysetCache,
} from '../model/types/keyset';
import { normalizeMintUrl } from '../utils';

import { Keyset } from './Keyset';

/**
 * Refuse a keyset whose id version this build cannot spend.
 *
 * @remarks
 * Guards the points that commit a wallet to a keyset (binding, and fetching its keys), not
 * `getKeyset`, which is a plain lookup used inside filters and fee sums where throwing would
 * rewrite control flow. Restore deliberately skips such keysets instead of failing.
 * @internal
 */
export function assertSpendableVersion(keyset: Keyset, logger?: Logger): void {
  failIf(
    keyset.version > MAX_SUPPORTED_KEYSET_VERSION,
    `Keyset '${keyset.id}' uses id version ${keyset.version}; this build of cashu-ts supports ` +
      `up to ${MAX_SUPPORTED_KEYSET_VERSION}. Upgrade to use this keyset.`,
    logger,
    { keysetId: keyset.id, version: keyset.version, supported: MAX_SUPPORTED_KEYSET_VERSION },
  );
}

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
  // Object.create(null): a mint-supplied id of '__proto__'/'constructor'/etc must resolve to
  // an own entry or nothing, never an inherited Object.prototype member (which is truthy and
  // would slip past the not-found guard in getKeyset).
  private keysets: { [id: string]: Keyset } = Object.create(null) as { [id: string]: Keyset };
  private pendingKeyFetches: Map<string, Promise<Keyset>> = new Map();
  // When this chain's data was fetched or, for restored data, when the cache it came from was.
  private savedAt?: number;
  // Bumped on every rebuild so a slower key fetch cannot commit over a newer snapshot.
  private generation = 0;
  // Bumped when a refresh starts so the last-started refresh wins, whatever order they return in.
  private refreshSeq = 0;
  private _logger: Logger;

  private assertInitialized(): void {
    if (Object.keys(this.keysets).length === 0) {
      throw new CTSError('KeyChain not initialized');
    }
  }

  constructor(mint: string | Mint, unit: string, logger: Logger = NULL_LOGGER) {
    this.mint = typeof mint === 'string' ? new Mint(mint) : mint;
    this.unit = unit;
    this._logger = logger;
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
   * @param logger Optional logger for warnings.
   */
  static fromCache(
    mint: string | Mint,
    unit: string,
    cache: KeyChainCache,
    logger?: Logger,
  ): KeyChain {
    const chain = new KeyChain(mint, unit, logger);
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
        kc.keys = { ...maybeKeys.keys };
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
        keys: { ...k.keys },
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
    const seq = ++this.refreshSeq;
    const [allKeysetsResponse, allKeysResponse]: [GetKeysetsResponse, GetKeysResponse] =
      await Promise.all([this.mint.getKeySets(), this.mint.getKeys()]);

    // A refresh started later than this one, so leave the snapshot to it.
    if (seq !== this.refreshSeq) {
      this._logger.debug('Discarding keychain refresh superseded by a later one', { seq });
      return;
    }
    this.buildKeychain(allKeysetsResponse.keysets, allKeysResponse.keysets);
    this.savedAt = Date.now();
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
    if (typeof cache.mintUrl !== 'string') {
      throw new CTSError('KeyChain cache is missing its mint URL');
    }
    const cacheMintUrl = normalizeMintUrl(cache.mintUrl);
    if (cacheMintUrl !== this.mint.mintUrl) {
      throw new CTSError(
        `KeyChain cache is for a different mint: ${cacheMintUrl} (expected ${this.mint.mintUrl})`,
      );
    }
    const { keysets, keys } = KeyChain.cacheToMintDTO(cache);
    this.buildKeychain(keysets, keys);
    this.savedAt = cache.savedAt;
  }

  /**
   * Builds keychain from Mint Keyset and Keys data. Stores all units.
   *
   * @param allKeysets Keyset data from mint.getKeySets() API.
   * @param allKeys Keys data from mint.getKeys() API.
   */
  private buildKeychain(allKeysets: MintKeyset[], allKeys: MintKeys[]): void {
    // Keep a reference to the outgoing snapshot so verified keys survive a refresh.
    // NUT-01 only serves keys for active keysets, so a rebuild would otherwise blank
    // every keyset that has rotated out. The new map is built in full and swapped in
    // at the end, so a rejected entry leaves the outgoing snapshot untouched.
    const previous = this.keysets;
    const next = Object.create(null) as { [id: string]: Keyset };

    const keysMap = new Map<string, MintKeys>(allKeys.map((k) => [k.id, k]));

    for (const meta of allKeysets) {
      const mk = keysMap.get(meta.id);
      const keyset = mk ? Keyset.fromMintApi(meta, mk) : Keyset.fromMintApi(meta);

      // Discard unverified keys
      if (!keyset.verify()) {
        if (keyset.hasKeys) {
          this._logger.warn('Discarding keys that do not derive their keyset id', {
            id: keyset.id,
          });
        }
        keyset.keys = {};
      }

      // Carry forward previously verified keys for a keyset the mint no longer serves. A v0 id
      // hashes the keys alone, so the unit is compared against the prior one as well.
      const prior = previous[meta.id];
      if (!keyset.hasKeys && prior?.hasKeys && prior.unit === keyset.unit) {
        keyset.keys = { ...prior.keys };
        // A v1+ id also commits to fee and expiry, so changed metadata voids carried keys.
        if (!keyset.verify()) {
          this._logger.warn(
            'Dropping carried keys: fresh metadata no longer derives the keyset id',
            {
              id: keyset.id,
            },
          );
          keyset.keys = {};
        }
      }

      next[keyset.id] = keyset;
    }

    this.keysets = next;
    this.generation++;
  }

  // ---------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------

  /**
   * Get a keyset by ID, or the cheapest modern keyset if no ID is provided.
   *
   * @param id Optional keyset ID. Any explicit value, including '', is looked up as given.
   * @returns Keyset with keys.
   * @throws If the id is unknown (including '' and any other non-undefined value), or the chain is
   *   uninitialized.
   */
  getKeyset(id?: string): Keyset {
    const keyset = id !== undefined ? this.keysets[id] : this.getCheapestKeyset();
    if (!keyset) {
      throw new CTSError(`Keyset '${id}' not found`);
    }
    return keyset;
  }

  /**
   * Get the cheapest modern active keyset.
   *
   * @remarks
   * Prefers the highest keyset ID version, then the lowest fee, then the latest `final_expiry` (no
   * expiry sorts as never expiring).
   * @returns Active Keyset.
   * @throws If none found or uninitialized.
   */
  getCheapestKeyset(): Keyset {
    if (Object.keys(this.keysets).length === 0) {
      throw new CTSError('KeyChain not initialized');
    }
    const unitActive = Object.values(this.keysets).filter(
      (k) => k.unit === this.unit && k.isActive && k.hasHexId,
    );
    // Newest version wins below, so a keyset this build cannot spend must not be a candidate. Its
    // keys are already blanked (the id derivation that `verify()` runs rejects the version), so
    // this is belt and braces; the branch that matters is the diagnosis below.
    const activeKeysets = unitActive.filter(
      (k) => k.hasKeys && k.version <= MAX_SUPPORTED_KEYSET_VERSION,
    );
    if (activeKeysets.length === 0) {
      const tooNew = unitActive.filter((k) => k.version > MAX_SUPPORTED_KEYSET_VERSION);
      if (tooNew.length > 0) {
        const lowest = Math.min(...tooNew.map((k) => k.version));
        fail(
          `No supported keyset for unit: ${this.unit}. The mint's active keysets use id version ` +
            `${lowest} or later; this build of cashu-ts supports up to ` +
            `${MAX_SUPPORTED_KEYSET_VERSION}. Upgrade to spend on this mint.`,
          this._logger,
          { unit: this.unit, lowestVersion: lowest, supported: MAX_SUPPORTED_KEYSET_VERSION },
        );
      }
      throw new CTSError(`No active keyset found for unit: ${this.unit}`);
    }
    const never = Number.MAX_SAFE_INTEGER;
    return activeKeysets.sort(
      (a, b) => b.version - a.version || a.fee - b.fee || (b.expiry ?? never) - (a.expiry ?? never),
    )[0];
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
      throw new CTSError(`Keyset '${id}' not found`);
    }
    assertSpendableVersion(existing, this._logger);

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
      const startedGeneration = this.generation;
      const res = await this.mint.getKeys(id);
      const mk = res.keysets.find((k) => k.id === id);
      if (!mk || !mk.keys || Object.keys(mk.keys).length === 0) {
        throw new CTSError(`Mint returned no keys for keyset '${id}'`);
      }

      // Rebuild from existing meta plus fetched keys
      const meta = existing.toMintKeyset();
      const rebuilt = Keyset.fromMintApi(meta, mk);
      if (!rebuilt.verify()) {
        throw new CTSError(`Keyset verification failed for ID ${id}`);
      }

      // A newer snapshot replaced ours while fetching, so its entry wins: the rebuilt one carries
      // the metadata captured before the refresh.
      if (this.generation !== startedGeneration) {
        this._logger.debug('Keychain refreshed during key fetch; returning the live keyset', {
          id,
        });
        const current = this.keysets[id];
        if (!current) {
          throw new CTSError(`Keyset '${id}' not found`);
        }
        return current;
      }
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
      throw new CTSError(`No keysets found for unit: ${this.unit}`);
    }
    return unitKeysets;
  }

  /**
   * True if `id` is a keyset belonging to this KeyChain's unit.
   *
   * @remarks
   * O(1) and non-throwing, unlike `getKeyset(id)` (cross-unit) and `getKeysets()` (allocates,
   * throws when the unit has none). Use it to keep foreign-unit proofs out of amount arithmetic.
   */
  isUnitKeyset(id?: string): boolean {
    if (!id) return false;
    const keyset = this.keysets[id];
    return keyset !== undefined && keyset.unit === this.unit;
  }

  /**
   * True if `id` is a keyset this KeyChain knows about, any unit.
   *
   * @remarks
   * O(1) and non-throwing, unlike `getKeyset(id)`. False for an uninitialized chain.
   */
  hasKeyset(id?: string): boolean {
    return !!id && this.keysets[id] !== undefined;
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
    const cache = KeyChain.mintToCacheDTO(this.mint.mintUrl, metaList, keysList);
    // Reserializing restored data does not make it fresh: keep the provenance it came with.
    cache.savedAt = this.savedAt;
    return cache;
  }
}
