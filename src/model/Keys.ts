import { CashuMint } from '../CashuMint';
import { isValidHex } from '../utils';
import { MintKeyset } from './types';

export class Keyset {
	private _id: string;
	private _unit: string;
	private _active: boolean;
	private _keyPairs?: Record<number, string>;
	private _input_fee_ppk?: number;

	constructor(id: string, unit: string, active: boolean, input_fee_ppk?: number) {
		this._id = id;
		this._unit = unit;
		this._active = active;
		this._input_fee_ppk = input_fee_ppk;
	}

	get isActive(): boolean {
		return this._active;
	}

	get unit(): string {
		return this._unit;
	}

	get id(): string {
		return this._id;
	}

	get hasKeyPairs(): boolean {
		return !!this._keyPairs;
	}

	get fee(): number {
		return this._input_fee_ppk ?? 0;
	}

	get hasHexId(): boolean {
		return isValidHex(this._id);
	}

	set keyPairs(keyPairs: Record<number, string>) {
		this._keyPairs = keyPairs;
	}
}

export class WalletKeyChain {
	private mint: CashuMint;
	private unit: string;
	private keysets: Map<string, Keyset> = new Map();

	constructor(mint: CashuMint, unit: string) {
		this.mint = mint;
		this.unit = unit;
	}

	addKeyset(k: Keyset) {
		this.keysets.set(k.id, k);
	}

	getLocalKeyset(keysetId: string) {
		return this.keysets.get(keysetId);
	}

	getKeysetList(): Array<Keyset> {
		return [...this.keysets].map((v) => v[1]);
	}

	/**
	 * Get public keys from the mint. If keys were already fetched, it will return those.
	 *
	 * If `keysetId` is set, it will fetch and return that specific keyset.
	 * Otherwise, we select an active keyset with the unit of the wallet.
	 *
	 * @param keysetId optional keysetId to get keys for
	 * @param forceRefresh? if set to true, it will force refresh the keyset from the mint
	 * @returns keyset
	 */
	async getKeys(keysetId?: string, forceRefresh?: boolean): Promise<Keyset> {
		if (!(this.keysets.size > 0) || forceRefresh) {
			await this.getKeySets();
		}
		// no keyset id is chosen, let's choose one
		if (!keysetId) {
			const localKeyset = this._getActiveKeyset();
			keysetId = localKeyset.id;
		}

		let keyset = this.getLocalKeyset(keysetId);
		if (!keyset) {
			await this.getKeySets();
			keyset = this.getLocalKeyset(keysetId);
		}
		if (!keyset) {
			throw new Error(`could not initialize keys. No keyset with id '${keysetId}' found`);
		}

		// make sure we have keys for this id
		if (!keyset.hasKeyPairs) {
			const keys = await this.mint.getKeys(keysetId);
			keyset.keyPairs = keys.keysets[0];
		}

		return keyset;
	}

	_getActiveKeyset() {
		return WalletKeyChain.getActiveKeyset(this.getKeysetList());
	}

	/**
	 * Choose a keyset to activate based on the lowest input fee
	 *
	 * Note: this function will filter out deprecated base64 keysets
	 *
	 * @param keysets keysets to choose from
	 * @returns active keyset
	 */
	static getActiveKeyset(keysets: Array<Keyset>): Keyset {
		const activeKeysetsWithHexId = keysets.filter((k) => k.isActive && k.hasHexId);
		const cheapestSelectedKeyset = activeKeysetsWithHexId.sort(
			(a, b) => (a.fee ?? 0) - (b.fee ?? 0)
		)[0];
		if (!cheapestSelectedKeyset) {
			throw new Error('No active keyset found');
		}
		return cheapestSelectedKeyset;
	}

	/**
	 * Get keysets from the mint with the unit of the wallet
	 * @returns keysets with wallet's unit
	 */
	async getKeySets(): Promise<Array<Keyset>> {
		const allKeysets = await this.mint.getKeySets();
		const unitKeysets = allKeysets.keysets.filter((k: MintKeyset) => k.unit === this.unit);
		unitKeysets.forEach((k) => this.addKeyset(new Keyset(k.id, k.unit, k.active)));
		return this.getKeysetList();
	}
}
