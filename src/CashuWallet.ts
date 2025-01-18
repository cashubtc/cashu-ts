import {
	blindMessage,
	constructProofFromPromise,
	serializeProof
} from '@cashu/crypto/modules/client';
import { deriveBlindingFactor, deriveSecret } from '@cashu/crypto/modules/client/NUT09';
import { createP2PKsecret, getSignedProofs } from '@cashu/crypto/modules/client/NUT11';
import { verifyDLEQProof_reblind } from '@cashu/crypto/modules/client/NUT12';
import { hashToCurve, pointFromHex } from '@cashu/crypto/modules/common';
import { DLEQ, type Proof as NUT11Proof } from '@cashu/crypto/modules/common';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { CashuMint } from './CashuMint.js';
import { BlindedMessage } from './model/BlindedMessage.js';
import { MintInfo } from './model/MintInfo.js';
import {
	GetInfoResponse,
	MeltProofOptions,
	MeltQuoteState,
	MintProofOptions,
	MintQuoteResponse,
	MintQuoteState,
	OutputAmounts,
	ProofState,
	ReceiveOptions,
	RestoreOptions,
	SendOptions,
	SerializedBlindedSignature,
	SerializedDLEQ,
	SwapOptions,
	type MeltPayload,
	type MeltProofsResponse,
	type MeltQuotePayload,
	type MeltQuoteResponse,
	type MintKeys,
	type MintKeyset,
	type MintPayload,
	type MintQuotePayload,
	type Proof,
	type SendResponse,
	type SerializedBlindedMessage,
	type SwapPayload,
	type Token,
	SwapTransaction
} from './model/types/index.js';
import { SubscriptionCanceller } from './model/types/wallet/websocket.js';
import {
	bytesToNumber,
	getDecodedToken,
	getKeepAmounts,
	hasValidDleq,
	numberToHexPadded64,
	splitAmount,
	stripDleq,
	sumProofs
} from './utils.js';
import {
	OutputData,
	OutputDataFactory,
	OutputDataLike,
	isOutputDataFactory
} from './model/OutputData.js';

/**
 * The default number of proofs per denomination to keep in a wallet.
 */
const DEFAULT_DENOMINATION_TARGET = 3;

/**
 * The default unit for the wallet, if not specified in constructor.
 */
const DEFAULT_UNIT = 'sat';

/**
 * Class that represents a Cashu wallet.
 * This class should act as the entry point for this library
 */
class CashuWallet {
	private _keys: Map<string, MintKeys> = new Map();
	private _keysetId: string | undefined;
	private _keysets: Array<MintKeyset> = [];
	private _seed: Uint8Array | undefined = undefined;
	private _unit = DEFAULT_UNIT;
	private _mintInfo: MintInfo | undefined = undefined;
	private _denominationTarget = DEFAULT_DENOMINATION_TARGET;
	private _keepFactory: OutputDataFactory | undefined;

	mint: CashuMint;

	/**
	 * @param mint Cashu mint instance is used to make api calls
	 * @param options.unit optionally set unit (default is 'sat')
	 * @param options.keys public keys from the mint (will be fetched from mint if not provided)
	 * @param options.keysets keysets from the mint (will be fetched from mint if not provided)
	 * @param options.mintInfo mint info from the mint (will be fetched from mint if not provided)
	 * @param options.denominationTarget target number proofs per denomination (default: see @constant DEFAULT_DENOMINATION_TARGET)
	 * @param options.bip39seed BIP39 seed for deterministic secrets.
	 * @param options.keepFactory A function that will be used by all parts of the library that produce proofs to be kept (change, etc.).
	 * This can lead to poor performance, in which case the seed should be directly provided
	 */
	constructor(
		mint: CashuMint,
		options?: {
			unit?: string;
			keys?: Array<MintKeys> | MintKeys;
			keysets?: Array<MintKeyset>;
			mintInfo?: GetInfoResponse;
			bip39seed?: Uint8Array;
			denominationTarget?: number;
			keepFactory?: OutputDataFactory;
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
		if (options?.mintInfo) this._mintInfo = new MintInfo(options.mintInfo);
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
		if (options?.keepFactory) {
			this._keepFactory = options.keepFactory;
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
	get mintInfo(): MintInfo {
		if (!this._mintInfo) {
			throw new Error('Mint info not loaded');
		}
		return this._mintInfo;
	}

	/**
	 * Get information about the mint
	 * @returns mint info
	 */
	async getMintInfo(): Promise<MintInfo> {
		const infoRes = await this.mint.getInfo();
		this._mintInfo = new MintInfo(infoRes);
		return this._mintInfo;
	}

	/**
	 * Load mint information, keysets and keys. This function can be called if no keysets are passed in the constructor
	 */
	async loadMint() {
		await this.getMintInfo();
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
	 * Receive an encoded or raw Cashu token (only supports single tokens. It will only process the first token in the token array)
	 * @param {(string|Token)} token - Cashu token, either as string or decoded
	 * @param {ReceiveOptions} [options] - Optional configuration for token processing
	 * @returns New token with newly created proofs, token entries that had errors
	 */
	async receive(token: string | Token, options?: ReceiveOptions): Promise<Array<Proof>> {
		const { requireDleq, keysetId, outputAmounts, counter, pubkey, privkey, outputData, p2pk } =
			options || {};

		if (typeof token === 'string') {
			token = getDecodedToken(token);
		}
		const keys = await this.getKeys(keysetId);
		if (requireDleq) {
			if (token.proofs.some((p: Proof) => !hasValidDleq(p, keys))) {
				throw new Error('Token contains proofs with invalid DLEQ');
			}
		}
		const amount = sumProofs(token.proofs) - this.getFeesForProofs(token.proofs);
		let newOutputData: { send: Array<OutputDataLike> | OutputDataFactory } | undefined = undefined;
		if (outputData) {
			newOutputData = { send: outputData };
		} else if (this._keepFactory) {
			newOutputData = { send: this._keepFactory };
		}
		const swapTransaction = this.createSwapPayload(
			amount,
			token.proofs,
			keys,
			outputAmounts,
			counter,
			pubkey,
			privkey,
			newOutputData,
			p2pk
		);
		const { signatures } = await this.mint.swap(swapTransaction.payload);
		const proofs = swapTransaction.outputData.map((d, i) => d.toProof(signatures[i], keys));
		const orderedProofs: Array<Proof> = [];
		swapTransaction.sortedIndices.forEach((s, o) => {
			orderedProofs[s] = proofs[o];
		});
		return orderedProofs;
	}

	/**
	 * Send proofs of a given amount, by providing at least the required amount of proofs
	 * @param amount amount to send
	 * @param proofs array of proofs (accumulated amount of proofs must be >= than amount)
	 * @param {SendOptions} [options] - Optional parameters for configuring the send operation
	 * @returns {SendResponse}
	 */
	async send(amount: number, proofs: Array<Proof>, options?: SendOptions): Promise<SendResponse> {
		const {
			proofsWeHave,
			offline,
			includeFees,
			includeDleq,
			keysetId,
			outputAmounts,
			pubkey,
			privkey,
			outputData
		} = options || {};
		if (includeDleq) {
			proofs = proofs.filter((p: Proof) => p.dleq != undefined);
		}
		if (sumProofs(proofs) < amount) {
			throw new Error('Not enough funds available to send');
		}
		const { keep: keepProofsOffline, send: sendProofOffline } = this.selectProofsToSend(
			proofs,
			amount,
			options?.includeFees
		);
		const expectedFee = includeFees ? this.getFeesForProofs(sendProofOffline) : 0;
		if (
			!offline &&
			(sumProofs(sendProofOffline) != amount + expectedFee || // if the exact amount cannot be selected
				outputAmounts ||
				pubkey ||
				privkey ||
				keysetId ||
				outputData) // these options require a swap
		) {
			// we need to swap
			// input selection, needs fees because of the swap
			const { keep: keepProofsSelect, send: sendProofs } = this.selectProofsToSend(
				proofs,
				amount,
				true
			);
			proofsWeHave?.push(...keepProofsSelect);

			const sendRes = await this.swap(amount, sendProofs, options);
			let { keep, send } = sendRes;
			const serialized = sendRes.serialized;
			keep = keepProofsSelect.concat(keep);

			if (!includeDleq) {
				send = stripDleq(send);
			}

			return { keep, send, serialized };
		}

		if (sumProofs(sendProofOffline) < amount + expectedFee) {
			throw new Error('Not enough funds available to send');
		}

		if (!includeDleq) {
			return { keep: keepProofsOffline, send: stripDleq(sendProofOffline) };
		}

		return { keep: keepProofsOffline, send: sendProofOffline };
	}

	selectProofsToSend(
		proofs: Array<Proof>,
		amountToSend: number,
		includeFees?: boolean
	): SendResponse {
		const sortedProofs = proofs.sort((a: Proof, b: Proof) => a.amount - b.amount);
		const smallerProofs = sortedProofs
			.filter((p: Proof) => p.amount <= amountToSend)
			.sort((a: Proof, b: Proof) => b.amount - a.amount);
		const biggerProofs = sortedProofs
			.filter((p: Proof) => p.amount > amountToSend)
			.sort((a: Proof, b: Proof) => a.amount - b.amount);
		const nextBigger = biggerProofs[0];
		if (!smallerProofs.length && nextBigger) {
			return {
				keep: proofs.filter((p: Proof) => p.secret !== nextBigger.secret),
				send: [nextBigger]
			};
		}

		if (!smallerProofs.length && !nextBigger) {
			return { keep: proofs, send: [] };
		}

		let remainder = amountToSend;
		let selectedProofs = [smallerProofs[0]];
		const returnedProofs = [];
		const feePPK = includeFees ? this.getFeesForProofs(selectedProofs) : 0;
		remainder -= selectedProofs[0].amount - feePPK / 1000;
		if (remainder > 0) {
			const { keep, send } = this.selectProofsToSend(
				smallerProofs.slice(1),
				remainder,
				includeFees
			);
			selectedProofs.push(...send);
			returnedProofs.push(...keep);
		}

		const selectedFeePPK = includeFees ? this.getFeesForProofs(selectedProofs) : 0;
		if (sumProofs(selectedProofs) < amountToSend + selectedFeePPK && nextBigger) {
			selectedProofs = [nextBigger];
		}

		return {
			keep: proofs.filter((p: Proof) => !selectedProofs.includes(p)),
			send: selectedProofs
		};
	}

	/**
	 * calculates the fees based on inputs (proofs)
	 * @param proofs input proofs to calculate fees for
	 * @returns fee amount
	 */
	getFeesForProofs(proofs: Array<Proof>): number {
		if (!this._keysets.length) {
			throw new Error('Could not calculate fees. No keysets found');
		}
		const keysetIds = new Set(proofs.map((p: Proof) => p.id));
		keysetIds.forEach((id: string) => {
			if (!this._keysets.find((k: MintKeyset) => k.id === id)) {
				throw new Error(`Could not calculate fees. No keyset found with id: ${id}`);
			}
		});

		const fees = Math.floor(
			Math.max(
				(proofs.reduce(
					(total: number, curr: Proof) =>
						total + (this._keysets.find((k: MintKeyset) => k.id === curr.id)?.input_fee_ppk || 0),
					0
				) +
					999) /
					1000,
				0
			)
		);
		return fees;
	}

	/**
	 * calculates the fees based on inputs for a given keyset
	 * @param nInputs number of inputs
	 * @param keysetId keysetId used to lookup `input_fee_ppk`
	 * @returns fee amount
	 */
	getFeesForKeyset(nInputs: number, keysetId: string): number {
		const fees = Math.floor(
			Math.max(
				(nInputs * (this._keysets.find((k: MintKeyset) => k.id === keysetId)?.input_fee_ppk || 0) +
					999) /
					1000,
				0
			)
		);
		return fees;
	}

	/**
	 * Splits and creates sendable tokens
	 * if no amount is specified, the amount is implied by the cumulative amount of all proofs
	 * if both amount and preference are set, but the preference cannot fulfill the amount, then we use the default split
	 *  @param {SwapOptions} [options] - Optional parameters for configuring the swap operation
	 * @returns promise of the change- and send-proofs
	 */
	async swap(amount: number, proofs: Array<Proof>, options?: SwapOptions): Promise<SendResponse> {
		let { outputAmounts } = options || {};
		const { includeFees, keysetId, counter, pubkey, privkey, proofsWeHave, outputData, p2pk } =
			options || {};
		const keyset = await this.getKeys(keysetId);

		const proofsToSend = proofs;
		let amountToSend = amount;
		const amountAvailable = sumProofs(proofs);
		let amountToKeep = amountAvailable - amountToSend - this.getFeesForProofs(proofsToSend);
		// send output selection
		let sendAmounts = outputAmounts?.sendAmounts || splitAmount(amountToSend, keyset.keys);

		// include the fees to spend the the outputs of the swap
		if (includeFees) {
			let outputFee = this.getFeesForKeyset(sendAmounts.length, keyset.id);
			let sendAmountsFee = splitAmount(outputFee, keyset.keys);
			while (
				this.getFeesForKeyset(sendAmounts.concat(sendAmountsFee).length, keyset.id) > outputFee
			) {
				outputFee++;
				sendAmountsFee = splitAmount(outputFee, keyset.keys);
			}
			sendAmounts = sendAmounts.concat(sendAmountsFee);
			amountToSend += outputFee;
			amountToKeep -= outputFee;
		}

		// keep output selection
		let keepAmounts;
		if (!outputAmounts?.keepAmounts && proofsWeHave) {
			keepAmounts = getKeepAmounts(
				proofsWeHave,
				amountToKeep,
				keyset.keys,
				this._denominationTarget
			);
		} else if (outputAmounts) {
			if (outputAmounts.keepAmounts?.reduce((a: number, b: number) => a + b, 0) != amountToKeep) {
				throw new Error('Keep amounts do not match amount to keep');
			}
			keepAmounts = outputAmounts.keepAmounts;
		}

		if (amountToSend + this.getFeesForProofs(proofsToSend) > amountAvailable) {
			console.error(
				`Not enough funds available (${amountAvailable}) for swap amountToSend: ${amountToSend} + fee: ${this.getFeesForProofs(
					proofsToSend
				)} | length: ${proofsToSend.length}`
			);
			throw new Error(`Not enough funds available for swap`);
		}

		if (amountToSend + this.getFeesForProofs(proofsToSend) + amountToKeep != amountAvailable) {
			throw new Error('Amounts do not match for swap');
		}

		outputAmounts = {
			keepAmounts: keepAmounts,
			sendAmounts: sendAmounts
		};

		const keepOutputData = outputData?.keep || this._keepFactory;
		const sendOutputData = outputData?.send;

		const swapTransaction = this.createSwapPayload(
			amountToSend,
			proofsToSend,
			keyset,
			outputAmounts,
			counter,
			pubkey,
			privkey,
			{ keep: keepOutputData, send: sendOutputData },
			p2pk
		);
		const { signatures } = await this.mint.swap(swapTransaction.payload);
		const swapProofs = swapTransaction.outputData.map((d, i) => d.toProof(signatures[i], keyset));
		const splitProofsToKeep: Array<Proof> = [];
		const splitProofsToSend: Array<Proof> = [];
		const reorderedKeepVector = Array(swapTransaction.keepVector.length);
		const reorderedProofs = Array(swapProofs.length);
		swapTransaction.sortedIndices.forEach((s, i) => {
			reorderedKeepVector[s] = swapTransaction.keepVector[i];
			reorderedProofs[s] = swapProofs[i];
		});
		reorderedProofs.forEach((p, i) => {
			if (reorderedKeepVector[i]) {
				splitProofsToKeep.push(p);
			} else {
				splitProofsToSend.push(p);
			}
		});
		return {
			keep: splitProofsToKeep,
			send: splitProofsToSend
		};
	}

	/**
	 * Regenerates
	 * @param start set starting point for count (first cycle for each keyset should usually be 0)
	 * @param count set number of blinded messages that should be generated
	 * @param options.keysetId set a custom keysetId to restore from. keysetIds can be loaded with `CashuMint.getKeySets()`
	 */
	async restore(
		start: number,
		count: number,
		options?: RestoreOptions
	): Promise<{ proofs: Array<Proof> }> {
		const { keysetId } = options || {};
		const keys = await this.getKeys(keysetId);
		if (!this._seed) {
			throw new Error('CashuWallet must be initialized with a seed to use restore');
		}
		// create blank amounts for unknown restore amounts
		const amounts = Array(count).fill(0);
		const outputData = OutputData.createDeterministicData(
			amounts.length,
			this._seed,
			start,
			keys,
			amounts
		);

		const { outputs, promises } = await this.mint.restore({
			outputs: outputData.map((d) => d.blindedMessage)
		});

		const outputsWithSignatures: {signature: SerializedBlindedSignature, data: OutputData}[] = []

		console.log(outputs.map(o=>o.amount))
		console.log(promises.map(o=>o.amount))

		for (let i = 0; i < outputs.length; i++) {
			const data = outputData.find(d=> d.blindedMessage.B_===outputs[i].B_)
			if (!data) {
				continue
			}
			outputsWithSignatures[i] = {
				signature: promises[i],
				data
			}
		}
		outputsWithSignatures.forEach(o=>o.data.blindedMessage.amount = o.signature.amount)

		
		return {
			proofs: outputsWithSignatures.map((d) => d.data.toProof(d.signature, keys))
		};
	}

	/**
	 * Requests a mint quote form the mint. Response returns a Lightning payment request for the requested given amount and unit.
	 * @param amount Amount requesting for mint.
	 * @param description optional description for the mint quote
	 * @returns the mint will return a mint quote with a Lightning invoice for minting tokens of the specified amount and unit
	 */
	async createMintQuote(amount: number, description?: string) {
		const mintQuotePayload: MintQuotePayload = {
			unit: this._unit,
			amount: amount,
			description: description
		};
		return await this.mint.createMintQuote(mintQuotePayload);
	}

	/**
	 * Gets an existing mint quote from the mint.
	 * @param quote Quote ID
	 * @returns the mint will create and return a Lightning invoice for the specified amount
	 */
	async checkMintQuote(quote: string) {
		return await this.mint.checkMintQuote(quote);
	}

	/**
	 * Mint proofs for a given mint quote
	 * @param amount amount to request
	 * @param quote ID of mint quote
	 * @param {MintProofOptions} [options] - Optional parameters for configuring the Mint Proof operation
	 * @returns proofs
	 */
	async mintProofs(
		amount: number,
		quote: string,
		options?: MintProofOptions
	): Promise<Array<Proof>> {
		let { outputAmounts } = options || {};
		const { counter, pubkey, p2pk, keysetId, proofsWeHave, outputData } = options || {};

		const keyset = await this.getKeys(keysetId);
		if (!outputAmounts && proofsWeHave) {
			outputAmounts = {
				keepAmounts: getKeepAmounts(proofsWeHave, amount, keyset.keys, this._denominationTarget),
				sendAmounts: []
			};
		}

		let newBlindingData: Array<OutputData> = [];
		if (outputData) {
			if (isOutputDataFactory(outputData)) {
				const amounts = splitAmount(amount, keyset.keys, outputAmounts?.keepAmounts);
				for (let i = 0; i < amounts.length; i++) {
					newBlindingData.push(outputData(amounts[i], keyset));
				}
			} else {
				newBlindingData = outputData;
			}
		} else if (this._keepFactory) {
			const amounts = splitAmount(amount, keyset.keys, outputAmounts?.keepAmounts);
			for (let i = 0; i < amounts.length; i++) {
				newBlindingData.push(this._keepFactory(amounts[i], keyset));
			}
		} else {
			newBlindingData = this.createOutputData(
				amount,
				keyset,
				counter,
				pubkey,
				outputAmounts?.keepAmounts,
				p2pk
			);
		}
		const mintPayload: MintPayload = {
			outputs: newBlindingData.map((d) => d.blindedMessage),
			quote: quote
		};
		const { signatures } = await this.mint.mint(mintPayload);
		return newBlindingData.map((d, i) => d.toProof(signatures[i], keyset));
	}

	/**
	 * Requests a melt quote from the mint. Response returns amount and fees for a given unit in order to pay a Lightning invoice.
	 * @param invoice LN invoice that needs to get a fee estimate
	 * @returns the mint will create and return a melt quote for the invoice with an amount and fee reserve
	 */
	async createMeltQuote(invoice: string): Promise<MeltQuoteResponse> {
		const meltQuotePayload: MeltQuotePayload = {
			unit: this._unit,
			request: invoice
		};
		const meltQuote = await this.mint.createMeltQuote(meltQuotePayload);
		return meltQuote;
	}

	/**
	 * Return an existing melt quote from the mint.
	 * @param quote ID of the melt quote
	 * @returns the mint will return an existing melt quote
	 */
	async checkMeltQuote(quote: string): Promise<MeltQuoteResponse> {
		const meltQuote = await this.mint.checkMeltQuote(quote);
		return meltQuote;
	}

	/**
	 * Melt proofs for a melt quote. proofsToSend must be at least amount+fee_reserve form the melt quote. This function does not perform coin selection!.
	 * Returns melt quote and change proofs
	 * @param meltQuote ID of the melt quote
	 * @param proofsToSend proofs to melt
	 * @param {MeltProofOptions} [options] - Optional parameters for configuring the Melting Proof operation
	 * @returns
	 */
	async meltProofs(
		meltQuote: MeltQuoteResponse,
		proofsToSend: Array<Proof>,
		options?: MeltProofOptions
	): Promise<MeltProofsResponse> {
		const { keysetId, counter, privkey } = options || {};
		const keys = await this.getKeys(keysetId);
		const outputData = this.createBlankOutputs(
			sumProofs(proofsToSend) - meltQuote.amount,
			keys,
			counter,
			this._keepFactory
		);
		if (privkey != undefined) {
			proofsToSend = getSignedProofs(
				proofsToSend.map((p: Proof) => {
					return {
						amount: p.amount,
						C: pointFromHex(p.C),
						id: p.id,
						secret: new TextEncoder().encode(p.secret)
					};
				}),
				privkey
			).map((p: NUT11Proof) => serializeProof(p));
		}

		proofsToSend = stripDleq(proofsToSend);

		const meltPayload: MeltPayload = {
			quote: meltQuote.quote,
			inputs: proofsToSend,
			outputs: outputData.map((d) => d.blindedMessage)
		};
		const meltResponse = await this.mint.melt(meltPayload);
		return {
			quote: meltResponse,
			change: meltResponse.change?.map((s, i) => outputData[i].toProof(s, keys)) ?? []
		};
	}

	/**
	 * Creates a split payload
	 * @param amount amount to send
	 * @param proofsToSend proofs to split*
	 * @param outputAmounts? optionally specify the output's amounts to keep and to send.
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 * @param pubkey? optionally locks ecash to pubkey. Will not be deterministic, even if counter is set!
	 * @param privkey? will create a signature on the @param proofsToSend secrets if set
	 * @returns
	 */
	private createSwapPayload(
		amount: number,
		proofsToSend: Array<Proof>,
		keyset: MintKeys,
		outputAmounts?: OutputAmounts,
		counter?: number,
		pubkey?: string,
		privkey?: string,
		customOutputData?: {
			keep?: Array<OutputDataLike> | OutputDataFactory;
			send?: Array<OutputDataLike> | OutputDataFactory;
		},
		p2pk?: { pubkey: string; locktime?: number; refundKeys?: Array<string> }
	): SwapTransaction {
		const totalAmount = proofsToSend.reduce((total: number, curr: Proof) => total + curr.amount, 0);
		if (outputAmounts && outputAmounts.sendAmounts && !outputAmounts.keepAmounts) {
			outputAmounts.keepAmounts = splitAmount(
				totalAmount - amount - this.getFeesForProofs(proofsToSend),
				keyset.keys
			);
		}
		const keepAmount = totalAmount - amount - this.getFeesForProofs(proofsToSend);
		let keepOutputData: Array<OutputDataLike> = [];
		let sendOutputData: Array<OutputDataLike> = [];

		if (customOutputData?.keep) {
			if (isOutputDataFactory(customOutputData.keep)) {
				const factory = customOutputData.keep;
				const amounts = splitAmount(keepAmount, keyset.keys);
				amounts.forEach((a) => {
					keepOutputData.push(factory(a, keyset));
				});
			} else {
				keepOutputData = customOutputData.keep;
			}
		} else {
			keepOutputData = this.createOutputData(
				keepAmount,
				keyset,
				counter,
				pubkey,
				outputAmounts?.keepAmounts,
				p2pk,
				this._keepFactory
			);
		}

		if (customOutputData?.send) {
			if (isOutputDataFactory(customOutputData.send)) {
				const factory = customOutputData.send;
				const amounts = splitAmount(amount, keyset.keys);
				amounts.forEach((a) => {
					sendOutputData.push(factory(a, keyset));
				});
			} else {
				sendOutputData = customOutputData.send;
			}
		} else {
			sendOutputData = this.createOutputData(
				amount,
				keyset,
				counter,
				pubkey,
				outputAmounts?.sendAmounts,
				p2pk
			);
		}

		if (privkey) {
			proofsToSend = getSignedProofs(
				proofsToSend.map((p: Proof) => {
					return {
						amount: p.amount,
						C: pointFromHex(p.C),
						id: p.id,
						secret: new TextEncoder().encode(p.secret)
					};
				}),
				privkey
			).map((p: NUT11Proof) => serializeProof(p));
		}

		proofsToSend = stripDleq(proofsToSend);

		const mergedBlindingData = [...keepOutputData, ...sendOutputData];
		const indices = mergedBlindingData
			.map((_, i) => i)
			.sort(
				(a, b) =>
					mergedBlindingData[a].blindedMessage.amount - mergedBlindingData[b].blindedMessage.amount
			);
		const keepVector = [
			...Array(keepOutputData.length).fill(true),
			...Array(sendOutputData.length).fill(false)
		];

		const sortedOutputData = indices.map((i) => mergedBlindingData[i]);
		const sortedKeepVector = indices.map((i) => keepVector[i]);

		return {
			payload: {
				inputs: proofsToSend,
				outputs: sortedOutputData.map((d) => d.blindedMessage)
			},
			outputData: sortedOutputData,
			keepVector: sortedKeepVector,
			sortedIndices: indices
		};
	}

	/**
	 * Get an array of the states of proofs from the mint (as an array of CheckStateEnum's)
	 * @param proofs (only the `secret` field is required)
	 * @returns
	 */
	async checkProofsStates(proofs: Array<Proof>): Promise<Array<ProofState>> {
		const enc = new TextEncoder();
		const Ys = proofs.map((p: Proof) => hashToCurve(enc.encode(p.secret)).toHex(true));
		// TODO: Replace this with a value from the info endpoint of the mint eventually
		const BATCH_SIZE = 100;
		const states: Array<ProofState> = [];
		for (let i = 0; i < Ys.length; i += BATCH_SIZE) {
			const YsSlice = Ys.slice(i, i + BATCH_SIZE);
			const { states: batchStates } = await this.mint.check({
				Ys: YsSlice
			});
			const stateMap: { [y: string]: ProofState } = {};
			batchStates.forEach((s) => {
				stateMap[s.Y] = s;
			});
			for (let j = 0; j < YsSlice.length; j++) {
				const state = stateMap[YsSlice[j]];
				if (!state) {
					throw new Error('Could not find state for proof with Y: ' + YsSlice[j]);
				}
				states.push(state);
			}
		}
		return states;
	}

	/**
	 * Register a callback to be called whenever a mint quote's state changes
	 * @param quoteIds List of mint quote IDs that should be subscribed to
	 * @param callback Callback function that will be called whenever a mint quote state changes
	 * @param errorCallback
	 * @returns
	 */
	async onMintQuoteUpdates(
		quoteIds: Array<string>,
		callback: (payload: MintQuoteResponse) => void,
		errorCallback: (e: Error) => void
	): Promise<SubscriptionCanceller> {
		await this.mint.connectWebSocket();
		if (!this.mint.webSocketConnection) {
			throw new Error('failed to establish WebSocket connection.');
		}
		const subId = this.mint.webSocketConnection.createSubscription(
			{ kind: 'bolt11_mint_quote', filters: quoteIds },
			callback,
			errorCallback
		);
		return () => {
			this.mint.webSocketConnection?.cancelSubscription(subId, callback);
		};
	}

	/**
	 * Register a callback to be called whenever a melt quote's state changes
	 * @param quoteIds List of melt quote IDs that should be subscribed to
	 * @param callback Callback function that will be called whenever a melt quote state changes
	 * @param errorCallback
	 * @returns
	 */
	async onMeltQuotePaid(
		quoteId: string,
		callback: (payload: MeltQuoteResponse) => void,
		errorCallback: (e: Error) => void
	): Promise<SubscriptionCanceller> {
		return this.onMeltQuoteUpdates(
			[quoteId],
			(p) => {
				if (p.state === MeltQuoteState.PAID) {
					callback(p);
				}
			},
			errorCallback
		);
	}

	/**
	 * Register a callback to be called when a single mint quote gets paid
	 * @param quoteId Mint quote id that should be subscribed to
	 * @param callback Callback function that will be called when this mint quote gets paid
	 * @param errorCallback
	 * @returns
	 */
	async onMintQuotePaid(
		quoteId: string,
		callback: (payload: MintQuoteResponse) => void,
		errorCallback: (e: Error) => void
	): Promise<SubscriptionCanceller> {
		return this.onMintQuoteUpdates(
			[quoteId],
			(p) => {
				if (p.state === MintQuoteState.PAID) {
					callback(p);
				}
			},
			errorCallback
		);
	}

	/**
	 * Register a callback to be called when a single melt quote gets paid
	 * @param quoteId Melt quote id that should be subscribed to
	 * @param callback Callback function that will be called when this melt quote gets paid
	 * @param errorCallback
	 * @returns
	 */
	async onMeltQuoteUpdates(
		quoteIds: Array<string>,
		callback: (payload: MeltQuoteResponse) => void,
		errorCallback: (e: Error) => void
	): Promise<SubscriptionCanceller> {
		await this.mint.connectWebSocket();
		if (!this.mint.webSocketConnection) {
			throw new Error('failed to establish WebSocket connection.');
		}
		const subId = this.mint.webSocketConnection.createSubscription(
			{ kind: 'bolt11_melt_quote', filters: quoteIds },
			callback,
			errorCallback
		);
		return () => {
			this.mint.webSocketConnection?.cancelSubscription(subId, callback);
		};
	}

	/**
	 * Register a callback to be called whenever a subscribed proof state changes
	 * @param proofs List of proofs that should be subscribed to
	 * @param callback Callback function that will be called whenever a proof's state changes
	 * @param errorCallback
	 * @returns
	 */
	async onProofStateUpdates(
		proofs: Array<Proof>,
		callback: (payload: ProofState & { proof: Proof }) => void,
		errorCallback: (e: Error) => void
	): Promise<SubscriptionCanceller> {
		await this.mint.connectWebSocket();
		if (!this.mint.webSocketConnection) {
			throw new Error('failed to establish WebSocket connection.');
		}
		const enc = new TextEncoder();
		const proofMap: { [y: string]: Proof } = {};
		for (let i = 0; i < proofs.length; i++) {
			const y = hashToCurve(enc.encode(proofs[i].secret)).toHex(true);
			proofMap[y] = proofs[i];
		}
		const ys = Object.keys(proofMap);
		const subId = this.mint.webSocketConnection.createSubscription(
			{ kind: 'proof_state', filters: ys },
			(p: ProofState) => {
				callback({ ...p, proof: proofMap[p.Y] });
			},
			errorCallback
		);
		return () => {
			this.mint.webSocketConnection?.cancelSubscription(subId, callback);
		};
	}

	/**
	 * Creates blinded messages for a according to @param amounts
	 * @param amount array of amounts to create blinded messages for
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 * @param keyksetId? override the keysetId derived from the current mintKeys with a custom one. This should be a keyset that was fetched from the `/keysets` endpoint
	 * @param pubkey? optionally locks ecash to pubkey. Will not be deterministic, even if counter is set!
	 * @returns blinded messages, secrets, rs, and amounts
	 */
	private createOutputData(
		amount: number,
		keyset: MintKeys,
		counter?: number,
		pubkey?: string,
		outputAmounts?: Array<number>,
		p2pk?: { pubkey: string; locktime?: number; refundKeys?: Array<string> },
		factory?: OutputDataFactory
	): Array<OutputDataLike> {
		let outputData: Array<OutputDataLike>;
		if (pubkey) {
			outputData = OutputData.createP2PKData({ pubkey }, amount, keyset, outputAmounts);
		} else if (counter || counter === 0) {
			if (!this._seed) {
				throw new Error('cannot create deterministic messages without seed');
			}
			outputData = OutputData.createDeterministicData(
				amount,
				this._seed,
				counter,
				keyset,
				outputAmounts
			);
		} else if (p2pk) {
			outputData = OutputData.createP2PKData(p2pk, amount, keyset, outputAmounts);
		} else if (factory) {
			const amounts = splitAmount(amount, keyset.keys);
			outputData = amounts.map((a) => factory(a, keyset));
		} else {
			outputData = OutputData.createRandomData(amount, keyset, outputAmounts);
		}
		return outputData;
	}

	/**
	 * Creates NUT-08 blank outputs (fee returns) for a given fee reserve
	 * See: https://github.com/cashubtc/nuts/blob/main/08.md
	 * @param amount amount to cover with blank outputs
	 * @param keysetId mint keysetId
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 * @returns blinded messages, secrets, and rs
	 */
	private createBlankOutputs(
		amount: number,
		keyset: MintKeys,
		counter?: number,
		factory?: OutputDataFactory
	): Array<OutputDataLike> {
		let count = Math.ceil(Math.log2(amount)) || 1;
		//Prevent count from being -Infinity
		if (count < 0) {
			count = 0;
		}
		const amounts = count ? Array(count).fill(1) : [];
		return this.createOutputData(amount, keyset, counter, undefined, amounts, undefined, factory);
	}
}

export { CashuWallet };
