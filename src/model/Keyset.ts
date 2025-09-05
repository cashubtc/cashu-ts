import { isValidHex } from '../utils';

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

	set keyPairs(keyPairs: Record<number, string>) {
		this._keyPairs = keyPairs;
	}

	get keyPairs(): Record<number, string> | undefined {
		return this._keyPairs;
	}

	get final_expiry(): number | undefined {
		return this._final_expiry;
	}
}
