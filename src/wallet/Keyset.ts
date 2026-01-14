import { isValidHex, deriveKeysetId, isBase64String } from '../utils';
import { type MintKeyset, type MintKeys } from '../model/types';
import { hexToBytes } from '@noble/curves/utils.js';

export class Keyset {
	private _id: string;
	private _unit: string;
	private _active: boolean;
	private _keys: Record<number, string> = {};
	private _input_fee_ppk?: number;
	private _final_expiry?: number;

	constructor(
		id: string,
		unit: string,
		active: boolean,
		input_fee_ppk?: number,
		final_expiry?: number,
	) {
		this._id = id;
		this._unit = unit;
		this._active = active;
		this._input_fee_ppk = input_fee_ppk;
		this._final_expiry = final_expiry;
	}

	get id(): string {
		return this._id;
	}

	get unit(): string {
		return this._unit;
	}

	get isActive(): boolean {
		return this._active;
	}

	get fee(): number {
		return this._input_fee_ppk ?? 0;
	}

	get expiry(): number | undefined {
		return this._final_expiry;
	}

	get hasKeys(): boolean {
		return Object.keys(this._keys).length > 0;
	}

	get hasHexId(): boolean {
		return isValidHex(this._id);
	}

	get keys(): Record<number, string> {
		return this._keys;
	}

	set keys(keys: Record<number, string>) {
		this._keys = keys;
	}

	/**
	 * @deprecated Use `isActive` instead.
	 */
	get active(): boolean {
		return this.isActive;
	}

	/**
	 * @deprecated Use `fee` instead.
	 */
	get input_fee_ppk(): number {
		return this.fee;
	}

	/**
	 * @deprecated Use `expiry` instead.
	 */
	get final_expiry(): number | undefined {
		return this.expiry;
	}

	/**
	 * To Mint API MintKeyset format.
	 *
	 * @returns MintKeyset object.
	 */
	toMintKeyset(): MintKeyset {
		return {
			id: this._id,
			unit: this._unit,
			active: this._active,
			input_fee_ppk: this._input_fee_ppk,
			final_expiry: this._final_expiry,
		};
	}

	/**
	 * To Mint API MintKeys format.
	 *
	 * @returns MintKeys object.
	 */
	toMintKeys(): MintKeys | null {
		if (!this.hasKeys) {
			return null;
		}
		return {
			id: this._id,
			unit: this._unit,
			keys: this._keys,
		};
	}

	/**
	 * Verifies that the keyset's ID matches the derived ID from its keys, unit, and expiry.
	 *
	 * @returns True if verification succeeds, false otherwise (e.g: no keys or mismatch).
	 */
	verify(): boolean {
		if (!this.hasKeys) {
			return false;
		}
		return Keyset.verifyKeysetId({
			id: this._id,
			unit: this._unit,
			final_expiry: this._final_expiry,
			input_fee_ppk: this._input_fee_ppk,
			keys: this._keys,
		});
	}

	/**
	 * Verifies that a MintKeys DTO has a correct id for its keys/unit/expiry.
	 *
	 * @returns True if verification succeeds, false otherwise (e.g: no keys or mismatch).
	 */
	static verifyKeysetId(keys: MintKeys): boolean {
		if (!keys.keys || Object.keys(keys.keys).length === 0) {
			return false;
		}
		const isDeprecatedBase64 = isBase64String(keys.id) && !isValidHex(keys.id);
		const versionByte = isValidHex(keys.id) ? hexToBytes(keys.id)[0] : 0;
		const derivedId = deriveKeysetId(keys.keys, {
			input_fee_ppk: keys.input_fee_ppk,
			expiry: keys.final_expiry,
			unit: keys.unit,
			versionByte,
			isDeprecatedBase64,
		});
		return derivedId === keys.id;
	}

	/**
	 * Create a Keyset from Mint API DTOs.
	 *
	 * @param meta The MintKeyset metadata from GetKeysetsResponse.
	 * @param keys The MintKeys from GetKeysResponse.
	 * @returns Keyset instance.
	 */
	static fromMintApi(meta: MintKeyset, keys?: MintKeys): Keyset {
		const ks = new Keyset(meta.id, meta.unit, meta.active, meta.input_fee_ppk, meta.final_expiry);

		// Sanity checks
		if (keys) {
			if (keys.id !== meta.id) {
				throw new Error(`Mismatched keyset ids: meta=${meta.id}, keys=${keys.id}`);
			}
			if (keys.unit !== meta.unit) {
				throw new Error(`Mismatched keyset units: meta=${meta.unit}, keys=${keys.unit}`);
			}
			if (
				keys.final_expiry !== undefined &&
				meta.final_expiry !== undefined &&
				keys.final_expiry !== meta.final_expiry
			) {
				throw new Error(`Mismatched keyset expiry for id=${meta.id}`);
			}
			// All good
			ks.keys = keys.keys;
		}
		return ks;
	}
}
