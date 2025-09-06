import { isValidHex, deriveKeysetId } from '../utils';
import { type MintKeyset, type MintKeys } from './types';
import { hexToBytes } from '@noble/curves/abstract/utils';

export class Keyset {
	private _id: string;
	private _unit: string;
	private _active: boolean;
	private _keyPairs?: Record<number, string>;
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

	get hasKeyPairs(): boolean {
		return !!this._keyPairs;
	}

	get hasHexId(): boolean {
		return isValidHex(this._id);
	}

	get final_expiry(): number | undefined {
		return this._final_expiry;
	}

	get keyPairs(): Record<number, string> | undefined {
		return this._keyPairs;
	}

	set keyPairs(keyPairs: Record<number, string>) {
		this._keyPairs = keyPairs;
	}

	toMintKeyset(): MintKeyset {
		return {
			id: this._id,
			unit: this._unit,
			active: this._active,
			input_fee_ppk: this._input_fee_ppk,
			final_expiry: this._final_expiry,
		};
	}

	toMintKeys(): MintKeys | null {
		if (!this.hasKeyPairs) {
			return null;
		}
		return {
			id: this._id,
			unit: this._unit,
			keys: this._keyPairs!,
		};
	}

	/**
	 * Verifies that the keyset's ID matches the derived ID from its keys, unit, and expiry.
	 *
	 * @returns True if verification succeeds, false otherwise (e.g., no keys or mismatch).
	 */
	verify(): boolean {
		if (!this.hasKeyPairs) {
			return false;
		}
		const versionByte = hexToBytes(this._id)[0];
		const derivedId = deriveKeysetId(this._keyPairs!, this._unit, this._final_expiry, versionByte);
		return derivedId === this._id;
	}
}
