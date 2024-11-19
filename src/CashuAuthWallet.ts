import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { CashuAuthMint } from './CashuAuthMint.js';
import { BlindedMessage } from './model/BlindedMessage.js';
import {
	type MintKeys,
	type MintKeyset,
	type Proof,
	type SerializedBlindedMessage,
	SerializedBlindedSignature,
	GetInfoResponse,
	OutputAmounts,
	BlindingData,
	BlindAuthMintPayload
} from './model/types/index.js';
import { bytesToNumber, splitAmount, getKeepAmounts } from './utils.js';
import { pointFromHex } from '@cashu/crypto/modules/common';
import {
	blindMessage,
	constructProofFromPromise,
	serializeProof
} from '@cashu/crypto/modules/client';
import { deriveBlindingFactor, deriveSecret } from '@cashu/crypto/modules/client/NUT09';
import { createP2PKsecret } from '@cashu/crypto/modules/client/NUT11';
import { type Proof as NUT11Proof } from '@cashu/crypto/modules/common/index';

/**
 * The default number of proofs per denomination to keep in a wallet.
 */
const DEFAULT_DENOMINATION_TARGET = 3;

/**
 * The default unit for the wallet, if not specified in constructor.
 */
const DEFAULT_UNIT = 'auth';

/**
 * Class that represents a Cashu wallet.
 * This class should act as the entry point for this library
 */
class CashuAuthWallet {
	private _keys: Map<string, MintKeys> = new Map();
	private _keysetId: string | undefined;
	private _keysets: Array<MintKeyset> = [];
	private _seed: Uint8Array | undefined = undefined;
	private _unit = DEFAULT_UNIT;
	private _mintInfo: GetInfoResponse | undefined = undefined;
	private _denominationTarget = DEFAULT_DENOMINATION_TARGET;

	mint: CashuAuthMint;

	/**
	 * @param mint Cashu mint instance is used to make api calls
	 * @param options.unit optionally set unit (default is 'sat')
	 * @param options.keys public keys from the mint (will be fetched from mint if not provided)
	 * @param options.keysets keysets from the mint (will be fetched from mint if not provided)
	 * @param options.mintInfo mint info from the mint (will be fetched from mint if not provided)
	 * @param options.denominationTarget target number proofs per denomination (default: see @constant DEFAULT_DENOMINATION_TARGET)
	 * @param options.bip39seed BIP39 seed for deterministic secrets.
	 * This can lead to poor performance, in which case the seed should be directly provided
	 */
	constructor(
		mint: CashuAuthMint,
		options?: {
			unit?: string;
			keys?: Array<MintKeys> | MintKeys;
			keysets?: Array<MintKeyset>;
			mintInfo?: GetInfoResponse;
			bip39seed?: Uint8Array;
			denominationTarget?: number;
		}
	) {
		this.mint = mint;
		let keys: Array<MintKeys> = [];
		if (options?.keys && !Array.isArray(options.keys)) {
			keys = [options.keys];
		} else if (options?.keys && Array.isArray(options?.keys)) {
			keys = options?.keys;
		}
		if (keys) keys.forEach((key: MintKeys) => this._keys.set(key.id, key));
		if (options?.unit) this._unit = options?.unit;
		if (options?.keysets) this._keysets = options.keysets;
		if (options?.denominationTarget) {
			this._denominationTarget = options.denominationTarget;
		}

		if (options?.bip39seed) {
			if (options.bip39seed instanceof Uint8Array) {
				this._seed = options.bip39seed;
				return;
			}
			throw new Error('bip39seed must be a valid UInt8Array');
		}
	}

	get unit(): string {
		return this._unit;
	}
	get keys(): Map<string, MintKeys> {
		return this._keys;
	}
	get keysetId(): string {
		if (!this._keysetId) {
			throw new Error('No keysetId set');
		}
		return this._keysetId;
	}
	set keysetId(keysetId: string) {
		this._keysetId = keysetId;
	}
	get keysets(): Array<MintKeyset> {
		return this._keysets;
	}
	get mintInfo(): GetInfoResponse {
		if (!this._mintInfo) {
			throw new Error('Mint info not loaded');
		}
		return this._mintInfo;
	}

	/**
	 * Load mint information, keysets and keys. This function can be called if no keysets are passed in the constructor
	 */
	async loadMint() {
		await this.getKeySets();
		await this.getKeys();
	}

	/**
	 * Choose a keyset to activate based on the lowest input fee
	 *
	 * Note: this function will filter out deprecated base64 keysets
	 *
	 * @param keysets keysets to choose from
	 * @returns active keyset
	 */
	getActiveKeyset(keysets: Array<MintKeyset>): MintKeyset {
		let activeKeysets = keysets.filter((k: MintKeyset) => k.active);

		// we only consider keyset IDs that start with "00"
		activeKeysets = activeKeysets.filter((k: MintKeyset) => k.id.startsWith('00'));

		const activeKeyset = activeKeysets.sort(
			(a: MintKeyset, b: MintKeyset) => (a.input_fee_ppk ?? 0) - (b.input_fee_ppk ?? 0)
		)[0];
		if (!activeKeyset) {
			throw new Error('No active keyset found');
		}
		return activeKeyset;
	}

	/**
	 * Get keysets from the mint with the unit of the wallet
	 * @returns keysets with wallet's unit
	 */
	async getKeySets(): Promise<Array<MintKeyset>> {
		const allKeysets = await this.mint.getKeySets();
		const unitKeysets = allKeysets.keysets.filter((k: MintKeyset) => k.unit === this._unit);
		this._keysets = unitKeysets;
		return this._keysets;
	}

	/**
	 * Get all active keys from the mint and set the keyset with the lowest fees as the active wallet keyset.
	 * @returns keyset
	 */
	async getAllKeys(): Promise<Array<MintKeys>> {
		const keysets = await this.mint.getKeys();
		this._keys = new Map(keysets.keysets.map((k: MintKeys) => [k.id, k]));
		this.keysetId = this.getActiveKeyset(this._keysets).id;
		return keysets.keysets;
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
	async getKeys(keysetId?: string, forceRefresh?: boolean): Promise<MintKeys> {
		if (!(this._keysets.length > 0) || forceRefresh) {
			await this.getKeySets();
		}
		// no keyset id is chosen, let's choose one
		if (!keysetId) {
			const localKeyset = this.getActiveKeyset(this._keysets);
			keysetId = localKeyset.id;
		}
		// make sure we have keyset for this id
		if (!this._keysets.find((k: MintKeyset) => k.id === keysetId)) {
			await this.getKeySets();
			if (!this._keysets.find((k: MintKeyset) => k.id === keysetId)) {
				throw new Error(`could not initialize keys. No keyset with id '${keysetId}' found`);
			}
		}

		// make sure we have keys for this id
		if (!this._keys.get(keysetId)) {
			const keys = await this.mint.getKeys(keysetId);
			this._keys.set(keysetId, keys.keysets[0]);
		}

		// set and return
		this.keysetId = keysetId;
		return this._keys.get(keysetId) as MintKeys;
	}

	/**
	 * Mint proofs for a given mint quote
	 * @param amount amount to request
	 * @param clearAuthToken clearAuthToken to mint
	 * @param options.keysetId? optionally set keysetId for blank outputs for returned change.
	 * @param options.preference? Deprecated. Use `outputAmounts` instead. Optional preference for splitting proofs into specific amounts.
	 * @param options.outputAmounts? optionally specify the output's amounts to keep and to send.
	 * @param options.counter? optionally set counter to derive secret deterministically. CashuAuthWallet class must be initialized with seed phrase to take effect
	 * @param options.pubkey? optionally locks ecash to pubkey. Will not be deterministic, even if counter is set!
	 * @returns proofs
	 */
	async mintProofs(
		amount: number,
		clearAuthToken: string,
		options?: {
			keysetId?: string;
			outputAmounts?: OutputAmounts;
			proofsWeHave?: Array<Proof>;
			counter?: number;
			pubkey?: string;
		}
	): Promise<Array<Proof>> {
		const keyset = await this.getKeys(options?.keysetId);
		if (!options?.outputAmounts && options?.proofsWeHave) {
			options.outputAmounts = {
				keepAmounts: getKeepAmounts(
					options.proofsWeHave,
					amount,
					keyset.keys,
					this._denominationTarget
				),
				sendAmounts: []
			};
		}

		const { blindedMessages, secrets, blindingFactors } = this.createRandomBlindedMessages(
			amount,
			keyset,
			options?.outputAmounts?.keepAmounts,
			options?.counter,
			options?.pubkey
		);
		const mintPayload: BlindAuthMintPayload = {
			outputs: blindedMessages
		};
		const { signatures } = await this.mint.mint(mintPayload, clearAuthToken);
		return this.constructProofs(signatures, blindingFactors, secrets, keyset);
	}
	/**
	 * Creates blinded messages for a given amount
	 * @param amount amount to create blinded messages for
	 * @param split optional preference for splitting proofs into specific amounts. overrides amount param
	 * @param keyksetId? override the keysetId derived from the current mintKeys with a custom one. This should be a keyset that was fetched from the `/keysets` endpoint
	 * @param counter? optionally set counter to derive secret deterministically. CashuAuthWallet class must be initialized with seed phrase to take effect
	 * @param pubkey? optionally locks ecash to pubkey. Will not be deterministic, even if counter is set!
	 * @returns blinded messages, secrets, rs, and amounts
	 */
	private createRandomBlindedMessages(
		amount: number,
		keyset: MintKeys,
		split?: Array<number>,
		counter?: number,
		pubkey?: string
	): BlindingData & { amounts: Array<number> } {
		const amounts = splitAmount(amount, keyset.keys, split);
		return this.createBlindedMessages(amounts, keyset.id, counter, pubkey);
	}

	/**
	 * Creates blinded messages for a according to @param amounts
	 * @param amount array of amounts to create blinded messages for
	 * @param counter? optionally set counter to derive secret deterministically. CashuAuthWallet class must be initialized with seed phrase to take effect
	 * @param keyksetId? override the keysetId derived from the current mintKeys with a custom one. This should be a keyset that was fetched from the `/keysets` endpoint
	 * @param pubkey? optionally locks ecash to pubkey. Will not be deterministic, even if counter is set!
	 * @returns blinded messages, secrets, rs, and amounts
	 */
	private createBlindedMessages(
		amounts: Array<number>,
		keysetId: string,
		counter?: number,
		pubkey?: string
	): BlindingData & { amounts: Array<number> } {
		// if we atempt to create deterministic messages without a _seed, abort.
		if (counter != undefined && !this._seed) {
			throw new Error(
				'Cannot create deterministic messages without seed. Instantiate CashuAuthWallet with a bip39seed, or omit counter param.'
			);
		}
		const blindedMessages: Array<SerializedBlindedMessage> = [];
		const secrets: Array<Uint8Array> = [];
		const blindingFactors: Array<bigint> = [];
		for (let i = 0; i < amounts.length; i++) {
			let deterministicR = undefined;
			let secretBytes = undefined;
			if (pubkey) {
				secretBytes = createP2PKsecret(pubkey);
			} else if (this._seed && counter != undefined) {
				secretBytes = deriveSecret(this._seed, keysetId, counter + i);
				deterministicR = bytesToNumber(deriveBlindingFactor(this._seed, keysetId, counter + i));
			} else {
				secretBytes = randomBytes(32);
			}
			if (!pubkey) {
				const secretHex = bytesToHex(secretBytes);
				secretBytes = new TextEncoder().encode(secretHex);
			}
			secrets.push(secretBytes);
			const { B_, r } = blindMessage(secretBytes, deterministicR);
			blindingFactors.push(r);
			const blindedMessage = new BlindedMessage(amounts[i], B_, keysetId);
			blindedMessages.push(blindedMessage.getSerializedBlindedMessage());
		}
		return { blindedMessages, secrets, blindingFactors, amounts };
	}

	/**
	 * construct proofs from @params promises, @params rs, @params secrets, and @params keyset
	 * @param promises array of serialized blinded signatures
	 * @param rs arrays of binding factors
	 * @param secrets array of secrets
	 * @param keyset mint keyset
	 * @returns array of serialized proofs
	 */
	private constructProofs(
		promises: Array<SerializedBlindedSignature>,
		rs: Array<bigint>,
		secrets: Array<Uint8Array>,
		keyset: MintKeys
	): Array<Proof> {
		return promises
			.map((p: SerializedBlindedSignature, i: number) => {
				const blindSignature = { id: p.id, amount: p.amount, C_: pointFromHex(p.C_) };
				const r = rs[i];
				const secret = secrets[i];
				const A = pointFromHex(keyset.keys[p.amount]);
				return constructProofFromPromise(blindSignature, r, secret, A);
			})
			.map((p: NUT11Proof) => serializeProof(p) as Proof);
	}
}

export { CashuAuthWallet };
