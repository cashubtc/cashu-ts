import { Keyset } from './Keyset';
import { type Mint } from '../Mint';
import { type MintKeyset, type MintKeys } from './types';

export class KeyChain {
	private mint: Mint;
	private unit: string;
	private keysets: { [id: string]: Keyset } = {}; // Compact: plain object over Map
	private _activeKeysetId: string | undefined;

	constructor(mint: Mint, unit: string) {
		this.mint = mint;
		this.unit = unit;
	}

	/**
	 * Single entry point to load or refresh keysets and keys for the unit. Fetches in parallel,
	 * filters by unit, assigns keys.
	 *
	 * @param forceRefresh If true, refetch even if loaded.
	 */
	async init(forceRefresh?: boolean): Promise<void> {
		if (Object.keys(this.keysets).length > 0 && !forceRefresh) {
			return; // Already loaded, skip unless force
		}

		const [allKeysets, allKeys] = await Promise.all([
			this.mint.getKeySets(),
			this.mint.getKeys(), // Assume returns all active keys
		]);

		// Filter and create keysets for unit
		const unitKeysets = allKeysets.keysets.filter((k: MintKeyset) => k.unit === this.unit);
		unitKeysets.forEach((k: MintKeyset) => {
			this.keysets[k.id] = new Keyset(k.id, k.unit, k.active, k.input_fee_ppk);
		});

		// Assign keys to matching keysets
		allKeys.keysets.forEach((mk: MintKeys) => {
			const keyset = this.keysets[mk.id];
			if (keyset && mk.unit === this.unit) {
				keyset.keyPairs = mk.keys;
				keyset.final_expiry = mk.final_expiry;
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
	 * @throws If not found or no keys loaded.
	 */
	getKeyset(id: string): Keyset {
		const keyset = this.keysets[id];
		if (!keyset) {
			throw new Error(`Keyset '${id}' not found`);
		}
		if (!keyset.hasKeyPairs) {
			throw new Error(`No keys loaded for keyset '${id}'`);
		}
		return keyset;
	}

	/**
	 * Get the active keyset (lowest fee, active, hex ID).
	 *
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
	 * Get keys for a keyset (as MintKeys).
	 *
	 * @param id Optional ID; defaults to active.
	 * @returns {id, unit, final_expiry?, keys} .
	 */
	getKeys(id?: string): MintKeys {
		const keyset = id ? this.getKeyset(id) : this.getActiveKeyset();
		return {
			id: keyset.id,
			unit: keyset.unit,
			final_expiry: keyset.final_expiry,
			keys: keyset.keyPairs!,
		};
	}
}
