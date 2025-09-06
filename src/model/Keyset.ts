import { isValidHex, deriveKeysetId } from '../utils';
import { type MintKeyset, type MintKeys } from './types';
import { hexToBytes } from '@noble/curves/abstract/utils';

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
	 * For compat with v2 MintKeyset type.
	 */
	get active(): boolean {
		return this._active;
	}

	/**
	 * For compat with v2 MintKeyset type.
	 */
	get input_fee_ppk(): number {
		return this._input_fee_ppk ?? 0;
	}

	/**
	 * For compat with v2 MintKeyset type.
	 */
	get final_expiry(): number | undefined {
		return this._final_expiry;
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
	 * @returns True if verification succeeds, false otherwise (e.g., no keys or mismatch).
	 */
	verify(): boolean {
		if (!this.hasKeys) {
			return false;
		}
		const versionByte = hexToBytes(this._id)[0];
		const derivedId = deriveKeysetId(this._keys, this._unit, this._final_expiry, versionByte);
		return derivedId === this._id;
	}
}
