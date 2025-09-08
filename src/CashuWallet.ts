import { signP2PKProofs } from './crypto/client/NUT11';
import { hashToCurve } from './crypto/common/index';
import { type CashuMint } from './CashuMint';
import { MintInfo } from './model/MintInfo';
import { type Logger, NULL_LOGGER, measureTime } from './logger';

// shared primitives and shared options
import type { Proof } from './model/types/proof';
import type { Token } from './model/types/token';
import type { SerializedBlindedSignature } from './model/types/blinded';
import type { ProofState } from './model/types/proof-state';
import type { MintKeys, MintKeyset } from './model/types/keyset';

// wallet constructed DTOs and wallet responses
import type {
	OutputAmounts,
	ReceiveOptions,
	SendOptions,
	SwapOptions,
	RestoreOptions,
	MeltProofOptions,
	MintProofOptions,
	MeltPayload,
	MeltProofsResponse,
	MeltQuotePayload,
	MintPayload,
	MintQuotePayload,
	MPPOption,
	MeltQuoteOptions,
	SwapTransaction,
	Bolt12MintQuotePayload,
	SendResponse,
	SubscriptionCanceller,
} from './wallet/types';

// mint wire DTOs and enums
import type {
	GetInfoResponse,
	MintQuoteResponse,
	MeltQuoteResponse,
	PartialMintQuoteResponse,
	PartialMeltQuoteResponse,
	LockedMintQuoteResponse,
	Bolt12MintQuoteResponse,
	Bolt12MeltQuoteResponse,
} from './mint/types';
import { MintQuoteState, MeltQuoteState } from './mint/types';

// utils and helpers
import {
	getDecodedToken,
	getKeepAmounts,
	hasValidDleq,
	splitAmount,
	stripDleq,
	sumProofs,
	verifyKeysetId,
} from './utils';
import { signMintQuote } from './crypto/client/NUT20';
import {
	OutputData,
	type OutputDataFactory,
	type OutputDataLike,
	isOutputDataFactory,
} from './model/OutputData';

/**
 * The default number of proofs per denomination to keep in a wallet.
 */
const DEFAULT_DENOMINATION_TARGET = 3;

/**
 * The default unit for the wallet, if not specified in constructor.
 */
const DEFAULT_UNIT = 'sat';

/**
 * Class that represents a Cashu wallet. This class should act as the entry point for this library.
 */
class CashuWallet {
	private _keys: Map<string, MintKeys> = new Map();
	private _keysetId: string | undefined;
	private _keysets: MintKeyset[] = [];
	private _seed: Uint8Array | undefined = undefined;
	private _unit = DEFAULT_UNIT;
	private _mintInfo: MintInfo | undefined = undefined;
	private _denominationTarget = DEFAULT_DENOMINATION_TARGET;
	private _keepFactory: OutputDataFactory | undefined;
	private _logger: Logger;

	mint: CashuMint;

	/**
	 * @param mint Cashu mint instance is used to make api calls.
	 * @param options.unit Optionally set unit (default is 'sat')
	 * @param options.keys Public keys from the mint (will be fetched from mint if not provided)
	 * @param options.keysets Keysets from the mint (will be fetched from mint if not provided)
	 * @param options.mintInfo Mint info from the mint (will be fetched from mint if not provided)
	 * @param options.denominationTarget Target number proofs per denomination (default: see @constant
	 *   DEFAULT_DENOMINATION_TARGET)
	 * @param options.bip39seed BIP39 seed for deterministic secrets.
	 * @param options.keepFactory A function that will be used by all parts of the library that
	 *   produce proofs to be kept (change, etc.). This can lead to poor performance, in which case
	 *   the seed should be directly provided.
	 */
	constructor(
		mint: CashuMint,
		options?: {
			unit?: string;
			keys?: MintKeys[] | MintKeys;
			keysets?: MintKeyset[];
			mintInfo?: GetInfoResponse;
			bip39seed?: Uint8Array;
			denominationTarget?: number;
			keepFactory?: OutputDataFactory;
			logger?: Logger;
		},
	) {
		this.mint = mint;
		this._logger = options?.logger ?? NULL_LOGGER;
		let keys: MintKeys[] = [];
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
	get keysets(): MintKeyset[] {
		return this._keysets;
	}
	get mintInfo(): MintInfo {
		if (!this._mintInfo) {
			throw new Error('Mint info not loaded');
		}
		return this._mintInfo;
	}

	/**
	 * Get information about the mint.
	 *
	 * @returns Mint info.
	 */
	async getMintInfo(): Promise<MintInfo> {
		const infoRes = await this.mint.getInfo();
		this._mintInfo = new MintInfo(infoRes);
		return this._mintInfo;
	}

	/**
	 * Get stored information about the mint or request it if not loaded.
	 *
	 * @returns Mint info.
	 */
	async lazyGetMintInfo(): Promise<MintInfo> {
		if (!this._mintInfo) {
			return await this.getMintInfo();
		}
		return this._mintInfo;
	}

	/**
	 * Load mint information, keysets and keys. This function can be called if no keysets are passed
	 * in the constructor.
	 */
	async loadMint() {
		await Promise.all([
			this.getMintInfo(),
			this.getKeys(), // NB: also runs getKeySets()
		]);
	}

	/**
	 * Choose a keyset to activate based on the lowest input fee.
	 *
	 * Note: this function will filter out deprecated base64 keysets.
	 *
	 * @param keysets Keysets to choose from.
	 * @returns Active keyset.
	 */
	getActiveKeyset(keysets: MintKeyset[]): MintKeyset {
		let activeKeysets = keysets.filter((k: MintKeyset) => k.active && k.unit === this._unit);

		// we only consider keyset IDs that start with "00"
		activeKeysets = activeKeysets.filter((k: MintKeyset) => k.id.startsWith('00'));

		const activeKeyset = activeKeysets.sort(
			(a: MintKeyset, b: MintKeyset) => (a.input_fee_ppk ?? 0) - (b.input_fee_ppk ?? 0),
		)[0];
		if (!activeKeyset) {
			throw new Error('No active keyset found');
		}
		return activeKeyset;
	}

	/**
	 * Get keysets from the mint with the unit of the wallet.
	 *
	 * @returns Keysets with wallet's unit.
	 */
	async getKeySets(): Promise<MintKeyset[]> {
		const allKeysets = await this.mint.getKeySets();
		const unitKeysets = allKeysets.keysets.filter((k: MintKeyset) => k.unit === this._unit);
		this._keysets = unitKeysets;
		return this._keysets;
	}

	/**
	 * Get all active keys from the mint and set the keyset with the lowest fees as the active wallet
	 * keyset.
	 *
	 * @returns Keyset.
	 */
	async getAllKeys(): Promise<MintKeys[]> {
		const keysets = await this.mint.getKeys();
		keysets.keysets.forEach((k) => {
			if (!verifyKeysetId(k)) {
				throw new Error(`Couldn't verify keyset ID ${k.id}`);
			}
		});
		this._keys = new Map(keysets.keysets.map((k: MintKeys) => [k.id, k]));
		this.keysetId = this.getActiveKeyset(this._keysets).id;
		return keysets.keysets;
	}

	/**
	 * Get public keys from the mint. If keys were already fetched, it will return those.
	 *
	 * If `keysetId` is set, it will fetch and return that specific keyset. Otherwise, we select an
	 * active keyset with the unit of the wallet.
	 *
	 * @param keysetId Optional keysetId to get keys for.
	 * @param forceRefresh? If set to true, it will force refresh the keyset from the mint.
	 * @returns Keyset.
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
			if (!verifyKeysetId(keys.keysets[0])) {
				throw new Error(`Couldn't verify keyset ID ${keys.keysets[0].id}`);
			}
			this._keys.set(keysetId, keys.keysets[0]);
		}

		// set and return
		this.keysetId = keysetId;
		return this._keys.get(keysetId) as MintKeys;
	}

	/**
	 * Receive an encoded or raw Cashu token (only supports single tokens. It will only process the
	 * first token in the token array)
	 *
	 * @param {string | Token} token - Cashu token, either as string or decoded.
	 * @param {ReceiveOptions} [options] - Optional configuration for token processing.
	 * @returns New token with newly created proofs, token entries that had errors.
	 */
	async receive(token: string | Token, options?: ReceiveOptions): Promise<Proof[]> {
		const { requireDleq, keysetId, outputAmounts, counter, pubkey, privkey, outputData, p2pk } =
			options || {};

		// Fetch the keysets if we don't have them
		if (this._keysets.length === 0) {
			await this.getKeySets();
		}
		if (typeof token === 'string') {
			token = getDecodedToken(token, this._keysets);
		}
		const keys = await this.getKeys(keysetId);
		if (requireDleq) {
			if (token.proofs.some((p: Proof) => !hasValidDleq(p, keys))) {
				throw new Error('Token contains proofs with invalid DLEQ');
			}
		}
		const amount = sumProofs(token.proofs) - this.getFeesForProofs(token.proofs);
		let newOutputData: { send: OutputDataLike[] | OutputDataFactory } | undefined = undefined;
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
			p2pk,
		);
		const { signatures } = await this.mint.swap(swapTransaction.payload);
		const proofs = swapTransaction.outputData.map((d, i) => d.toProof(signatures[i], keys));
		const orderedProofs: Proof[] = [];
		swapTransaction.sortedIndices.forEach((s, o) => {
			orderedProofs[s] = proofs[o];
		});
		return orderedProofs;
	}

	/**
	 * Send proofs of a given amount, by providing at least the required amount of proofs.
	 *
	 * @param amount Amount to send.
	 * @param proofs Array of proofs (accumulated amount of proofs must be >= than amount)
	 * @param {SendOptions} [options] - Optional parameters for configuring the send operation.
	 * @returns {SendResponse}
	 */
	async send(amount: number, proofs: Proof[], options?: SendOptions): Promise<SendResponse> {
		const {
			offline,
			includeFees,
			includeDleq,
			keysetId,
			outputAmounts,
			pubkey,
			privkey,
			outputData,
		} = options || {};
		// Try an offline selection first - using DLEQ proofs only if required
		if (includeDleq) {
			proofs = proofs.filter((p: Proof) => p.dleq != undefined);
		}
		if (sumProofs(proofs) < amount) {
			throw new Error('Not enough funds available to send');
		}
		const { keep: keepProofsOffline, send: sendProofOffline } = this.selectProofsToSend(
			proofs,
			amount,
			options?.includeFees,
		);

		// Check if we were successful offline, or if we are using options that require a swap
		// If so, lets' fall back to doing a swap
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
			const sendRes = await this.swap(amount, proofs, options);
			const { keep, send } = sendRes;
			const serialized = sendRes.serialized;

			return { keep, send, serialized };
		}

		// Still here? Let's check the offline selection was ok and return it
		if (sumProofs(sendProofOffline) < amount + expectedFee) {
			throw new Error('Not enough funds available to send');
		}

		return { keep: keepProofsOffline, send: sendProofOffline };
	}

	/**
	 * Selects proofs to send based on amount and fee inclusion.
	 *
	 * @remarks
	 * Uses an adapted Randomized Greedy with Local Improvement (RGLI) algorithm, which has a time
	 * complexity O(n log n) and space complexity O(n).
	 * @param proofs Array of Proof objects available to select from.
	 * @param amountToSend The target amount to send.
	 * @param includeFees Optional boolean to include fees; Default: false.
	 * @returns SendResponse containing proofs to keep and proofs to send.
	 * @see https://crypto.ethz.ch/publications/files/Przyda02.pdf
	 */
	selectProofsToSend(proofs: Proof[], amountToSend: number, includeFees = false): SendResponse {
		// Init vars
		const MAX_TRIALS = 60; // 40-80 is optimal (per RGLI paper)
		const MAX_OVRPCT = 0; // Acceptable close match overage (percent)
		const MAX_OVRAMT = 0; // Acceptable close match overage (absolute)
		const MAX_TIMEMS = 1000; // Halt new trials if over time (in ms)
		const MAX_P2SWAP = 5000; // Max number of Phase 2 improvement swaps
		const exactMatch = false; // Allows close match (> amountToSend + fee)
		const timer = measureTime(); // start the clock
		let bestSubset: ProofWithFee[] | null = null;
		let bestDelta = Infinity;
		let bestAmount = 0;
		let bestFeePPK = 0;

		/**
		 * Helper Functions.
		 */
		interface ProofWithFee {
			proof: Proof;
			exFee: number;
			ppkfee: number;
		}
		// Calculate net amount after fees
		const sumExFees = (amount: number, feePPK: number): number => {
			return amount - (includeFees ? Math.ceil(feePPK / 1000) : 0);
		};
		// Shuffle array for randomization
		const shuffleArray = <T>(array: T[]): T[] => {
			const shuffled = [...array];
			for (let i = shuffled.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
			}
			return shuffled;
		};
		// Performs a binary search on a sorted (ascending) array of ProofWithFee objects by exFee.
		// If lessOrEqual=true, returns the rightmost index where exFee <= value
		// If lessOrEqual=false, returns the leftmost index where exFee >= value
		const binarySearchIndex = (
			arr: ProofWithFee[],
			value: number,
			lessOrEqual: boolean,
		): number | null => {
			let left = 0,
				right = arr.length - 1,
				result: number | null = null;
			while (left <= right) {
				const mid = Math.floor((left + right) / 2);
				const midValue = arr[mid].exFee;
				if (lessOrEqual ? midValue <= value : midValue >= value) {
					result = mid;
					if (lessOrEqual) left = mid + 1;
					else right = mid - 1;
				} else {
					if (lessOrEqual) right = mid - 1;
					else left = mid + 1;
				}
			}
			return lessOrEqual ? result : left < arr.length ? left : null;
		};
		// Insert into array of ProofWithFee objects sorted by exFee
		const insertSorted = (arr: ProofWithFee[], obj: ProofWithFee): void => {
			const value = obj.exFee;
			let left = 0,
				right = arr.length;
			while (left < right) {
				const mid = Math.floor((left + right) / 2);
				if (arr[mid].exFee < value) left = mid + 1;
				else right = mid;
			}
			arr.splice(left, 0, obj);
		};
		// "Delta" is the excess over amountToSend including fees
		// plus a tiebreaker to favour lower PPK keysets
		// NB: Solutions under amountToSend are invalid (delta: Infinity)
		const calculateDelta = (amount: number, feePPK: number): number => {
			const netSum = sumExFees(amount, feePPK);
			if (netSum < amountToSend) return Infinity; // no good
			return amount + feePPK / 1000 - amountToSend;
		};

		/**
		 * Pre-processing.
		 */
		let totalAmount = 0;
		let totalFeePPK = 0;
		const proofWithFees = proofs.map((p) => {
			const ppkfee = this.getProofFeePPK(p);
			const exFee = includeFees ? p.amount - ppkfee / 1000 : p.amount;
			const obj = { proof: p, exFee, ppkfee };
			// Sum all economical proofs (filtered below)
			if (!includeFees || exFee > 0) {
				totalAmount += p.amount;
				totalFeePPK += ppkfee;
			}
			return obj;
		});

		// Filter uneconomical proofs (totals computed above)
		let spendableProofs = includeFees
			? proofWithFees.filter((obj) => obj.exFee > 0)
			: proofWithFees;

		// Sort by exFee ascending
		spendableProofs.sort((a, b) => a.exFee - b.exFee);

		// Remove proofs too large to be useful and adjust totals
		// Exact Match: Keep proofs where exFee <= amountToSend
		// Close Match: Keep proofs where exFee <= nextBiggerExFee
		if (spendableProofs.length > 0) {
			let endIndex;
			if (exactMatch) {
				const rightIndex = binarySearchIndex(spendableProofs, amountToSend, true);
				endIndex = rightIndex !== null ? rightIndex + 1 : 0;
			} else {
				const biggerIndex = binarySearchIndex(spendableProofs, amountToSend, false);
				if (biggerIndex !== null) {
					const nextBiggerExFee = spendableProofs[biggerIndex].exFee;
					const rightIndex = binarySearchIndex(spendableProofs, nextBiggerExFee, true);
					if (rightIndex === null) {
						throw new Error('Unexpected null rightIndex in binary search');
					}
					endIndex = rightIndex + 1;
				} else {
					// Keep all proofs if all exFee < amountToSend
					endIndex = spendableProofs.length;
				}
			}
			// Adjust totals for removed proofs
			for (let i = endIndex; i < spendableProofs.length; i++) {
				totalAmount -= spendableProofs[i].proof.amount;
				totalFeePPK -= spendableProofs[i].ppkfee;
			}
			spendableProofs = spendableProofs.slice(0, endIndex);
		}

		// Validate using precomputed totals
		const totalNetSum = sumExFees(totalAmount, totalFeePPK);
		if (amountToSend <= 0 || amountToSend > totalNetSum) {
			return { keep: proofs, send: [] };
		}

		// Max acceptable amount for non-exact matches
		const maxOverAmount = Math.min(
			Math.ceil(amountToSend * (1 + MAX_OVRPCT / 100)),
			amountToSend + MAX_OVRAMT,
			totalNetSum,
		);

		/**
		 * RGLI algorithm: Runs multiple trials (up to MAX_TRIALS) Each trial starts with randomized
		 * greedy subset (S) and then tries to improve that subset to get a valid solution. NOTE: Fees
		 * are dynamic, based on number of proofs (PPK), so we perform all calculations based on net
		 * amounts.
		 */
		for (let trial = 0; trial < MAX_TRIALS; trial++) {
			// PHASE 1: Randomized Greedy Selection
			// Add proofs up to amountToSend (after adjusting for fees)
			// for exact match or the first amount over target otherwise
			const S: ProofWithFee[] = [];
			let amount = 0;
			let feePPK = 0;
			for (const obj of shuffleArray(spendableProofs)) {
				const newAmount = amount + obj.proof.amount;
				const newFeePPK = feePPK + obj.ppkfee;
				const netSum = sumExFees(newAmount, newFeePPK);
				if (exactMatch && netSum > amountToSend) break;
				S.push(obj);
				amount = newAmount;
				feePPK = newFeePPK;
				if (netSum >= amountToSend) break;
			}

			// PHASE 2: Local Improvement
			// Examine all the amounts found in the first phase, and find the
			// amount not in the current solution (others), which would get us
			// closest to the amountToSend.

			// Calculate the "others" array (note: spendableProofs is sorted ASC)
			// Using set.has() for filtering gives faster lookups: O(n+m)
			// Using array.includes() would be way slower: O(n*m)
			const SSet = new Set(S);
			const others = spendableProofs.filter((obj) => !SSet.has(obj));
			// Generate a random order for accessing the trial subset ('S')
			const indices = shuffleArray(Array.from({ length: S.length }, (_, i) => i)).slice(
				0,
				MAX_P2SWAP,
			);
			for (const i of indices) {
				// Exact or acceptable close match solution found?
				const netSum = sumExFees(amount, feePPK);
				if (
					netSum === amountToSend ||
					(!exactMatch && netSum >= amountToSend && netSum <= maxOverAmount)
				) {
					break;
				}

				// Get details for proof being replaced (objP), and temporarily
				// calculate the subset amount/fee with that proof removed.
				const objP = S[i];
				const tempAmount = amount - objP.proof.amount;
				const tempFeePPK = feePPK - objP.ppkfee;
				const tempNetSum = sumExFees(tempAmount, tempFeePPK);
				const target = amountToSend - tempNetSum;

				// Find a better replacement proof (objQ) and swap it in
				// Exact match can only replace larger to close on the target
				// Close match can replace larger or smaller as needed, but will
				// not replace larger unless it closes on the target
				const qIndex = binarySearchIndex(others, target, exactMatch);
				if (qIndex !== null) {
					const objQ = others[qIndex];
					if (!exactMatch || objQ.exFee > objP.exFee) {
						if (target >= 0 || objQ.exFee <= objP.exFee) {
							S[i] = objQ;
							amount = tempAmount + objQ.proof.amount;
							feePPK = tempFeePPK + objQ.ppkfee;
							others.splice(qIndex, 1);
							insertSorted(others, objP);
						}
					}
				}
			}
			// Update best solution
			const delta = calculateDelta(amount, feePPK);
			if (delta < bestDelta) {
				this._logger.debug(
					'selectProofsToSend: best solution found in trial #{trial} - amount: {amount}, delta: {delta}',
					{ trial, amount, delta },
				);
				bestSubset = [...S].sort((a, b) => b.exFee - a.exFee); // copy & sort
				bestDelta = delta;
				bestAmount = amount;
				bestFeePPK = feePPK;

				// "PHASE 3": Final check to make sure we haven't overpaid fees
				// and see if we can improve the solution. This is an adaptation
				// to the original RGLI, which helps us identify close match and
				// optimal fee solutions more consistently
				const tempS = [...bestSubset]; // copy
				while (tempS.length > 1 && bestDelta > 0) {
					const objP = tempS.pop() as ProofWithFee;
					const tempAmount = amount - objP.proof.amount;
					const tempFeePPK = feePPK - objP.ppkfee;
					const tempDelta = calculateDelta(tempAmount, tempFeePPK);
					if (tempDelta == Infinity) break;
					if (tempDelta < bestDelta) {
						bestSubset = [...tempS];
						bestDelta = tempDelta;
						bestAmount = tempAmount;
						bestFeePPK = tempFeePPK;
						amount = tempAmount;
						feePPK = tempFeePPK;
					}
				}
			}
			// Check if solution is acceptable
			if (bestSubset && bestDelta < Infinity) {
				const bestSum = sumExFees(bestAmount, bestFeePPK);
				if (
					bestSum === amountToSend ||
					(!exactMatch && bestSum >= amountToSend && bestSum <= maxOverAmount)
				) {
					break;
				}
			}
			// Time limit reached?
			if (timer.elapsed() > MAX_TIMEMS) {
				if (exactMatch) {
					throw new Error('Proof selection took too long. Try again with a smaller proof set.');
				} else {
					this._logger.warn('Proof selection took too long. Returning best selection so far.');
					break;
				}
			}
		}
		// Return Result
		if (bestSubset && bestDelta < Infinity) {
			const bestProofs = bestSubset.map((obj) => obj.proof);
			const bestSubsetSet = new Set(bestProofs);
			const keep = proofs.filter((p) => !bestSubsetSet.has(p));
			this._logger.info('Proof selection took {time}ms', { time: timer.elapsed() });
			return { keep, send: bestProofs };
		}
		return { keep: proofs, send: [] };
	}

	/**
	 * Calculates the fees based on inputs (proofs)
	 *
	 * @param proofs Input proofs to calculate fees for.
	 * @returns Fee amount.
	 * @throws Throws an error if the proofs keyset is unknown.
	 */
	getFeesForProofs(proofs: Proof[]): number {
		const sumPPK = proofs.reduce((a, c) => a + this.getProofFeePPK(c), 0);
		return Math.ceil(sumPPK / 1000);
	}

	/**
	 * Returns the current fee PPK for a proof according to the cached keyset.
	 *
	 * @param proof {Proof} A single proof.
	 * @returns FeePPK {number} The feePPK for the selected proof.
	 * @throws Throws an error if the proofs keyset is unknown.
	 */
	private getProofFeePPK(proof: Proof) {
		const keyset = this._keysets.find((k) => k.id === proof.id);
		if (!keyset) {
			throw new Error(`Could not get fee. No keyset found for keyset id: ${proof.id}`);
		}
		return keyset?.input_fee_ppk || 0;
	}

	/**
	 * Calculates the fees based on inputs for a given keyset.
	 *
	 * @param nInputs Number of inputs.
	 * @param keysetId KeysetId used to lookup `input_fee_ppk`
	 * @returns Fee amount.
	 */
	getFeesForKeyset(nInputs: number, keysetId: string): number {
		const fees = Math.floor(
			Math.max(
				(nInputs * (this._keysets.find((k: MintKeyset) => k.id === keysetId)?.input_fee_ppk || 0) +
					999) /
					1000,
				0,
			),
		);
		return fees;
	}

	/**
	 * Splits and creates sendable tokens if no amount is specified, the amount is implied by the
	 * cumulative amount of all proofs if both amount and preference are set, but the preference
	 * cannot fulfill the amount, then we use the default split.
	 *
	 * @param {SwapOptions} [options] - Optional parameters for configuring the swap operation.
	 * @returns Promise of the change- and send-proofs.
	 */
	async swap(amount: number, proofs: Proof[], options?: SwapOptions): Promise<SendResponse> {
		// Init
		let { outputAmounts } = options || {};
		const { includeFees, keysetId, counter, pubkey, privkey, proofsWeHave, outputData, p2pk } =
			options || {};
		const keyset = await this.getKeys(keysetId);

		let amountToSend = amount;
		const amountAvailable = sumProofs(proofs);

		// Create SEND output splits.
		// If includeFees, create extra outputs to cover the onward cost of receiving the token
		// This ensures the receiver ends up with the full amount when they receive the proofs
		let sendAmounts = outputAmounts?.sendAmounts || splitAmount(amountToSend, keyset.keys);
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
		}

		// Now, let's select the subset of proofs we need to for the swap
		// Note: we must aways include fees to ensure we cover the swap fee
		const { keep: keepProofs, send: sendProofs } = this.selectProofsToSend(
			proofs,
			amountToSend,
			true, // inc. fees
		);

		// Sanity check - will the selected proofs cover the swap?
		const amountToKeep = sumProofs(sendProofs) - this.getFeesForProofs(sendProofs) - amountToSend;
		if (amountToKeep < 0) {
			throw new Error('Not enough balance to send');
		}

		// Create KEEP output splits.
		// These outputs are the "change" from the swap if we selected more proofs than needed
		let keepAmounts;
		if (!outputAmounts?.keepAmounts && !proofsWeHave) {
			// Default split
			keepAmounts = splitAmount(amountToKeep, keyset.keys);
		} else if (!outputAmounts?.keepAmounts && proofsWeHave) {
			// Optimize change based on target denominations
			keepAmounts = getKeepAmounts(
				proofsWeHave,
				amountToKeep,
				keyset.keys,
				this._denominationTarget,
			);
		} else if (outputAmounts) {
			// Custom split
			if (outputAmounts.keepAmounts?.reduce((a: number, b: number) => a + b, 0) != amountToKeep) {
				throw new Error('Keep amounts do not match amount to keep');
			}
			keepAmounts = outputAmounts.keepAmounts;
		}

		// Sanity check (is this redundant vs sanity check above?)
		if (amountToSend + this.getFeesForProofs(sendProofs) > amountAvailable) {
			this._logger.error(
				`Not enough funds available (${amountAvailable}) for swap amountToSend: ${amountToSend} + fee: ${this.getFeesForProofs(
					sendProofs,
				)} | length: ${sendProofs.length}`,
			);
			throw new Error(`Not enough funds available for swap`);
		}

		// Create the outputData using the keep/send splits
		// and create the swap payload
		outputAmounts = {
			keepAmounts: keepAmounts,
			sendAmounts: sendAmounts,
		};

		const keepOutputData = outputData?.keep || this._keepFactory;
		const sendOutputData = outputData?.send;

		const swapTransaction = this.createSwapPayload(
			amountToSend,
			sendProofs,
			keyset,
			outputAmounts,
			counter,
			pubkey,
			privkey,
			{ keep: keepOutputData, send: sendOutputData },
			p2pk,
		);

		// Do the swap and create the new proofs
		const { signatures } = await this.mint.swap(swapTransaction.payload);
		const swapProofs = swapTransaction.outputData.map((d, i) => d.toProof(signatures[i], keyset));
		const splitProofsToKeep: Proof[] = [];
		const splitProofsToSend: Proof[] = [];
		const reorderedKeepVector = Array(swapTransaction.keepVector.length);
		const reorderedProofs = Array(swapProofs.length);
		swapTransaction.sortedIndices.forEach((s, i) => {
			reorderedKeepVector[s] = swapTransaction.keepVector[i];
			reorderedProofs[s] = swapProofs[i];
		});
		reorderedProofs.forEach((p: Proof, i) => {
			if (reorderedKeepVector[i]) {
				splitProofsToKeep.push(p);
			} else {
				splitProofsToSend.push(p);
			}
		});
		return {
			keep: [...splitProofsToKeep, ...keepProofs],
			send: splitProofsToSend,
		};
	}

	/**
	 * Restores batches of deterministic proofs until no more signatures are returned from the mint.
	 *
	 * @param [gapLimit=300] The amount of empty counters that should be returned before restoring
	 *   ends (defaults to 300). Default is `300`
	 * @param [batchSize=100] The amount of proofs that should be restored at a time (defaults to
	 *   100). Default is `100`
	 * @param [counter=0] The counter that should be used as a starting point (defaults to 0). Default
	 *   is `0`
	 * @param [keysetId] Which keysetId to use for the restoration. If none is passed the instance's
	 *   default one will be used.
	 */
	async batchRestore(
		gapLimit = 300,
		batchSize = 100,
		counter = 0,
		keysetId?: string,
	): Promise<{ proofs: Proof[]; lastCounterWithSignature?: number }> {
		const requiredEmptyBatches = Math.ceil(gapLimit / batchSize);
		const restoredProofs: Proof[] = [];

		let lastCounterWithSignature: undefined | number;
		let emptyBatchesFound = 0;

		while (emptyBatchesFound < requiredEmptyBatches) {
			const restoreRes = await this.restore(counter, batchSize, { keysetId });
			if (restoreRes.proofs.length > 0) {
				emptyBatchesFound = 0;
				restoredProofs.push(...restoreRes.proofs);
				lastCounterWithSignature = restoreRes.lastCounterWithSignature;
			} else {
				emptyBatchesFound++;
			}
			counter += batchSize;
		}
		return { proofs: restoredProofs, lastCounterWithSignature };
	}

	/**
	 * Regenerates.
	 *
	 * @param start Set starting point for count (first cycle for each keyset should usually be 0)
	 * @param count Set number of blinded messages that should be generated.
	 * @param options.keysetId Set a custom keysetId to restore from. keysetIds can be loaded with
	 *   `CashuMint.getKeySets()`
	 */
	async restore(
		start: number,
		count: number,
		options?: RestoreOptions,
	): Promise<{ proofs: Proof[]; lastCounterWithSignature?: number }> {
		const { keysetId } = options || {};
		const keys = await this.getKeys(keysetId);
		if (!this._seed) {
			throw new Error('CashuWallet must be initialized with a seed to use restore');
		}
		// create deterministic blank outputs for unknown restore amounts
		// Note: zero amount + zero denomination passes splitAmount validation
		const zeros = Array(count).fill(0);
		const outputData = OutputData.createDeterministicData(0, this._seed, start, keys, zeros);

		const { outputs, signatures } = await this.mint.restore({
			outputs: outputData.map((d) => d.blindedMessage),
		});

		const signatureMap: { [sig: string]: SerializedBlindedSignature } = {};
		outputs.forEach((o, i) => (signatureMap[o.B_] = signatures[i]));

		const restoredProofs: Proof[] = [];
		let lastCounterWithSignature: number | undefined;

		for (let i = 0; i < outputData.length; i++) {
			const matchingSig = signatureMap[outputData[i].blindedMessage.B_];
			if (matchingSig) {
				lastCounterWithSignature = start + i;
				outputData[i].blindedMessage.amount = matchingSig.amount;
				restoredProofs.push(outputData[i].toProof(matchingSig, keys));
			}
		}

		return {
			proofs: restoredProofs,
			lastCounterWithSignature,
		};
	}

	/**
	 * Requests a mint quote from the mint. Response returns a Lightning payment request for the
	 * requested given amount and unit.
	 *
	 * @param amount Amount requesting for mint.
	 * @param description Optional description for the mint quote.
	 * @param pubkey Optional public key to lock the quote to.
	 * @returns The mint will return a mint quote with a Lightning invoice for minting tokens of the
	 *   specified amount and unit.
	 */
	async createMintQuote(amount: number, description?: string): Promise<MintQuoteResponse> {
		const mintQuotePayload: MintQuotePayload = {
			unit: this._unit,
			amount: amount,
			description: description,
		};
		const res = await this.mint.createMintQuote(mintQuotePayload);
		return { ...res, amount: res.amount || amount, unit: res.unit || this.unit };
	}

	/**
	 * Requests a mint quote from the mint that is locked to a public key.
	 *
	 * @param amount Amount requesting for mint.
	 * @param pubkey Public key to lock the quote to.
	 * @param description Optional description for the mint quote.
	 * @returns The mint will return a mint quote with a Lightning invoice for minting tokens of the
	 *   specified amount and unit. The quote will be locked to the specified `pubkey`.
	 */
	async createLockedMintQuote(
		amount: number,
		pubkey: string,
		description?: string,
	): Promise<LockedMintQuoteResponse> {
		const { supported } = (await this.lazyGetMintInfo()).isSupported(20);
		if (!supported) {
			throw new Error('Mint does not support NUT-20');
		}
		const mintQuotePayload: MintQuotePayload = {
			unit: this._unit,
			amount: amount,
			description: description,
			pubkey: pubkey,
		};
		const res = await this.mint.createMintQuote(mintQuotePayload);
		if (typeof res.pubkey !== 'string') {
			throw new Error('Mint returned unlocked mint quote');
		} else {
			const pubkey = res.pubkey;
			return { ...res, pubkey, amount: res.amount || amount, unit: res.unit || this.unit };
		}
	}

	/**
	 * Requests a mint quote from the mint. Response returns a Lightning BOLT12 offer for the
	 * requested given amount and unit.
	 *
	 * @param pubkey Public key to lock the quote to.
	 * @param options.amount BOLT12 offer amount requesting for mint. If not specified, the offer will
	 *   be amountless.
	 * @param options.description Description for the mint quote.
	 * @returns The mint will return a mint quote with a Lightning invoice for minting tokens of the
	 *   specified amount and unit.
	 */
	async createMintQuoteBolt12(
		pubkey: string,
		options?: {
			amount?: number;
			description?: string;
		},
	): Promise<Bolt12MintQuoteResponse> {
		// Check if mint supports description for bolt12
		const mintInfo = await this.lazyGetMintInfo();
		if (options?.description && !mintInfo.supportsBolt12Description) {
			throw new Error('Mint does not support description for bolt12');
		}

		const mintQuotePayload: Bolt12MintQuotePayload = {
			pubkey: pubkey,
			unit: this._unit,
			amount: options?.amount,
			description: options?.description,
		};

		return this.mint.createMintQuoteBolt12(mintQuotePayload);
	}

	/**
	 * Gets an existing mint quote from the mint.
	 *
	 * @param quote Quote ID.
	 * @returns The mint will create and return a Lightning invoice for the specified amount.
	 */
	async checkMintQuote(quote: MintQuoteResponse): Promise<MintQuoteResponse>;
	async checkMintQuote(quote: string): Promise<PartialMintQuoteResponse>;
	async checkMintQuote(
		quote: string | MintQuoteResponse,
	): Promise<MintQuoteResponse | PartialMintQuoteResponse> {
		const quoteId = typeof quote === 'string' ? quote : quote.quote;
		const baseRes = await this.mint.checkMintQuote(quoteId);
		if (typeof quote === 'string') {
			return baseRes;
		}
		return { ...baseRes, amount: baseRes.amount || quote.amount, unit: baseRes.unit || quote.unit };
	}

	/**
	 * Gets an existing BOLT12 mint quote from the mint.
	 *
	 * @param quote Quote ID.
	 * @returns The latest mint quote for the given quote ID.
	 */
	async checkMintQuoteBolt12(quote: string): Promise<Bolt12MintQuoteResponse> {
		return this.mint.checkMintQuoteBolt12(quote);
	}

	/**
	 * Mint proofs for a given mint quote.
	 *
	 * @param amount Amount to request.
	 * @param {string} quote - ID of mint quote (when quote is a string)
	 * @param {LockedMintQuote} quote - Containing the quote ID and unlocking private key (when quote
	 *   is a LockedMintQuote)
	 * @param {MintProofOptions} [options] - Optional parameters for configuring the Mint Proof
	 *   operation.
	 * @returns Proofs.
	 */
	async mintProofs(
		amount: number,
		quote: MintQuoteResponse,
		options: MintProofOptions & { privateKey: string },
	): Promise<Proof[]>;
	async mintProofs(amount: number, quote: string, options?: MintProofOptions): Promise<Proof[]>;
	async mintProofs(
		amount: number,
		quote: string | MintQuoteResponse,
		options?: MintProofOptions & { privateKey?: string },
	): Promise<Proof[]> {
		return this._mintProofs('bolt11', amount, quote, options);
	}

	/**
	 * Mint proofs for a given mint quote.
	 *
	 * @param amount Amount to request. This must be less than or equal to the `quote.amountPaid -
	 *   quote.amountIssued`
	 * @param {string} quote - ID of mint quote.
	 * @param {string} privateKey - Private key to unlock the quote.
	 * @param {MintProofOptions} [options] - Optional parameters for configuring the Mint Proof
	 *   operation.
	 * @returns Proofs.
	 */
	async mintProofsBolt12(
		amount: number,
		quote: Bolt12MintQuoteResponse,
		privateKey: string,
		options?: MintProofOptions,
	): Promise<Proof[]> {
		return this._mintProofs('bolt12', amount, quote, { ...options, privateKey });
	}

	/**
	 * Requests a melt quote from the mint. Response returns amount and fees for a given unit in order
	 * to pay a Lightning invoice.
	 *
	 * @param invoice LN invoice that needs to get a fee estimate.
	 * @returns The mint will create and return a melt quote for the invoice with an amount and fee
	 *   reserve.
	 */
	async createMeltQuote(invoice: string): Promise<MeltQuoteResponse> {
		const meltQuotePayload: MeltQuotePayload = {
			unit: this._unit,
			request: invoice,
		};
		const meltQuote = await this.mint.createMeltQuote(meltQuotePayload);
		return {
			...meltQuote,
			unit: meltQuote.unit || this.unit,
			request: meltQuote.request || invoice,
		};
	}

	/**
	 * Requests a melt quote from the mint. Response returns amount and fees for a given unit in order
	 * to pay a BOLT12 offer.
	 *
	 * @param offer BOLT12 offer that needs to get a fee estimate.
	 * @param amountMsat Amount in millisatoshis for amount-less offers. If this is defined and the
	 *   offer has an amount, they **MUST** be equal.
	 * @returns The mint will create and return a melt quote for the offer with an amount and fee
	 *   reserve.
	 */
	async createMeltQuoteBolt12(
		offer: string,
		amountMsat?: number,
	): Promise<Bolt12MeltQuoteResponse> {
		return this.mint.createMeltQuoteBolt12({
			unit: this._unit,
			request: offer,
			options: amountMsat
				? {
						amountless: {
							amount_msat: amountMsat,
						},
					}
				: undefined,
		});
	}

	/**
	 * Requests a multi path melt quote from the mint.
	 *
	 * @param invoice LN invoice that needs to get a fee estimate.
	 * @param partialAmount The partial amount of the invoice's total to be paid by this instance.
	 * @returns The mint will create and return a melt quote for the invoice with an amount and fee
	 *   reserve.
	 */
	async createMultiPathMeltQuote(
		invoice: string,
		millisatPartialAmount: number,
	): Promise<MeltQuoteResponse> {
		const { supported, params } = (await this.lazyGetMintInfo()).isSupported(15);
		if (!supported) {
			throw new Error('Mint does not support NUT-15');
		}
		if (!params?.some((p) => p.method === 'bolt11' && p.unit === this.unit)) {
			throw new Error(`Mint does not support MPP for bolt11 and ${this.unit}`);
		}
		const mppOption: MPPOption = {
			amount: millisatPartialAmount,
		};
		const meltOptions: MeltQuoteOptions = {
			mpp: mppOption,
		};
		const meltQuotePayload: MeltQuotePayload = {
			unit: this._unit,
			request: invoice,
			options: meltOptions,
		};
		const meltQuote = await this.mint.createMeltQuote(meltQuotePayload);
		return { ...meltQuote, request: invoice, unit: this._unit };
	}

	/**
	 * Return an existing melt quote from the mint.
	 *
	 * @param quote ID of the melt quote.
	 * @returns The mint will return an existing melt quote.
	 */
	async checkMeltQuote(quote: string): Promise<PartialMeltQuoteResponse>;
	async checkMeltQuote(quote: MeltQuoteResponse): Promise<MeltQuoteResponse>;
	async checkMeltQuote(
		quote: string | MeltQuoteResponse,
	): Promise<MeltQuoteResponse | PartialMeltQuoteResponse> {
		const quoteId = typeof quote === 'string' ? quote : quote.quote;
		const meltQuote = await this.mint.checkMeltQuote(quoteId);
		if (typeof quote === 'string') {
			return meltQuote;
		}
		return { ...meltQuote, request: quote.request, unit: quote.unit };
	}

	async checkMeltQuoteBolt12(quote: string): Promise<Bolt12MeltQuoteResponse> {
		return this.mint.checkMeltQuoteBolt12(quote);
	}

	/**
	 * Melt proofs for a melt quote. proofsToSend must be at least amount+fee_reserve form the melt
	 * quote. This function does not perform coin selection!. Returns melt quote and change proofs.
	 *
	 * @param meltQuote ID of the melt quote.
	 * @param proofsToSend Proofs to melt.
	 * @param {MeltProofOptions} [options] - Optional parameters for configuring the Melting Proof
	 *   operation.
	 * @returns
	 */
	async meltProofs(
		meltQuote: MeltQuoteResponse,
		proofsToSend: Proof[],
		options?: MeltProofOptions,
	): Promise<MeltProofsResponse> {
		return this._meltProofs('bolt11', meltQuote, proofsToSend, options);
	}

	/**
	 * Melt proofs for a melt quote. proofsToSend must be at least amount+fee_reserve form the melt
	 * quote. This function does not perform coin selection!. Returns melt quote and change proofs.
	 *
	 * @param meltQuote ID of the melt quote.
	 * @param proofsToSend Proofs to melt.
	 * @param {MeltProofOptions} [options] - Optional parameters for configuring the Melting Proof
	 *   operation.
	 * @returns
	 */
	async meltProofsBolt12(
		meltQuote: Bolt12MeltQuoteResponse,
		proofsToSend: Proof[],
		options?: MeltProofOptions,
	): Promise<{
		quote: Bolt12MeltQuoteResponse;
		change: Proof[];
	}> {
		return this._meltProofs('bolt12', meltQuote, proofsToSend, options);
	}

	/**
	 * Creates a split payload.
	 *
	 * @param amount Amount to send.
	 * @param proofsToSend Proofs to split*
	 * @param outputAmounts? Optionally specify the output's amounts to keep and to send.
	 * @param counter? Optionally set counter to derive secret deterministically. CashuWallet class
	 *   must be initialized with seed phrase to take effect.
	 * @param pubkey? Optionally locks ecash to pubkey. Will not be deterministic, even if counter is
	 *   set!
	 * @param privkey? Will create a signature on the @param proofsToSend secrets if set.
	 * @param customOutputData? Optionally specify your own OutputData (blinded messages)
	 * @param p2pk? Optionally specify options to lock the proofs according to NUT-11.
	 * @returns
	 */
	private createSwapPayload(
		amount: number,
		proofsToSend: Proof[],
		keyset: MintKeys,
		outputAmounts?: OutputAmounts,
		counter?: number,
		pubkey?: string,
		privkey?: string,
		customOutputData?: {
			keep?: OutputDataLike[] | OutputDataFactory;
			send?: OutputDataLike[] | OutputDataFactory;
		},
		p2pk?: {
			pubkey: string | string[];
			locktime?: number;
			refundKeys?: string[];
			requiredSignatures?: number;
			requiredRefundSignatures?: number;
		},
	): SwapTransaction {
		const totalAmount = proofsToSend.reduce((total: number, curr: Proof) => total + curr.amount, 0);
		if (outputAmounts && outputAmounts.sendAmounts && !outputAmounts.keepAmounts) {
			outputAmounts.keepAmounts = splitAmount(
				totalAmount - amount - this.getFeesForProofs(proofsToSend),
				keyset.keys,
			);
		}
		const keepAmount = totalAmount - amount - this.getFeesForProofs(proofsToSend);
		let keepOutputData: OutputDataLike[] = [];
		let sendOutputData: OutputDataLike[] = [];

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
				undefined,
				outputAmounts?.keepAmounts,
				undefined,
				this._keepFactory,
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
				counter ? counter + keepOutputData.length : undefined,
				pubkey,
				outputAmounts?.sendAmounts,
				p2pk,
			);
		}

		if (privkey) {
			proofsToSend = signP2PKProofs(proofsToSend, privkey);
		}

		proofsToSend = stripDleq(proofsToSend);

		// Ensure witnesses are serialized before sending to mint
		proofsToSend = proofsToSend.map((p: Proof) => {
			const witness =
				p.witness && typeof p.witness !== 'string' ? JSON.stringify(p.witness) : p.witness;
			return { ...p, witness };
		});

		const mergedBlindingData = [...keepOutputData, ...sendOutputData];
		const indices = mergedBlindingData
			.map((_, i) => i)
			.sort(
				(a, b) =>
					mergedBlindingData[a].blindedMessage.amount - mergedBlindingData[b].blindedMessage.amount,
			);
		const keepVector: boolean[] = [
			...Array.from({ length: keepOutputData.length }, () => true),
			...Array.from({ length: sendOutputData.length }, () => false),
		];

		const sortedOutputData: OutputDataLike[] = indices.map((i) => mergedBlindingData[i]);
		const sortedKeepVector: boolean[] = indices.map((i) => keepVector[i]);

		return {
			payload: {
				inputs: proofsToSend,
				outputs: sortedOutputData.map((d) => d.blindedMessage),
			},
			outputData: sortedOutputData,
			keepVector: sortedKeepVector,
			sortedIndices: indices,
		};
	}

	/**
	 * Get an array of the states of proofs from the mint (as an array of CheckStateEnum's)
	 *
	 * @param proofs (only the `secret` field is required)
	 * @returns
	 */
	async checkProofsStates(proofs: Proof[]): Promise<ProofState[]> {
		const enc = new TextEncoder();
		const Ys = proofs.map((p: Proof) => hashToCurve(enc.encode(p.secret)).toHex(true));
		// TODO: Replace this with a value from the info endpoint of the mint eventually
		const BATCH_SIZE = 100;
		const states: ProofState[] = [];
		for (let i = 0; i < Ys.length; i += BATCH_SIZE) {
			const YsSlice = Ys.slice(i, i + BATCH_SIZE);
			const { states: batchStates } = await this.mint.check({
				Ys: YsSlice,
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
	 * Register a callback to be called whenever a mint quote's state changes.
	 *
	 * @param quoteIds List of mint quote IDs that should be subscribed to.
	 * @param callback Callback function that will be called whenever a mint quote state changes.
	 * @param errorCallback
	 * @returns
	 */
	async onMintQuoteUpdates(
		quoteIds: string[],
		callback: (payload: MintQuoteResponse) => void,
		errorCallback: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		await this.mint.connectWebSocket();
		if (!this.mint.webSocketConnection) {
			throw new Error('failed to establish WebSocket connection.');
		}
		const subId = this.mint.webSocketConnection.createSubscription(
			{ kind: 'bolt11_mint_quote', filters: quoteIds },
			callback,
			errorCallback,
		);
		return () => {
			this.mint.webSocketConnection?.cancelSubscription(subId, callback);
		};
	}

	/**
	 * Register a callback to be called whenever a melt quote's state changes.
	 *
	 * @param quoteIds List of melt quote IDs that should be subscribed to.
	 * @param callback Callback function that will be called whenever a melt quote state changes.
	 * @param errorCallback
	 * @returns
	 */
	async onMeltQuotePaid(
		quoteId: string,
		callback: (payload: MeltQuoteResponse) => void,
		errorCallback: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		return this.onMeltQuoteUpdates(
			[quoteId],
			(p) => {
				if (p.state === MeltQuoteState.PAID) {
					callback(p);
				}
			},
			errorCallback,
		);
	}

	/**
	 * Register a callback to be called when a single mint quote gets paid.
	 *
	 * @param quoteId Mint quote id that should be subscribed to.
	 * @param callback Callback function that will be called when this mint quote gets paid.
	 * @param errorCallback
	 * @returns
	 */
	async onMintQuotePaid(
		quoteId: string,
		callback: (payload: MintQuoteResponse) => void,
		errorCallback: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		return this.onMintQuoteUpdates(
			[quoteId],
			(p) => {
				if (p.state === MintQuoteState.PAID) {
					callback(p);
				}
			},
			errorCallback,
		);
	}

	/**
	 * Register a callback to be called when a single melt quote gets paid.
	 *
	 * @param quoteId Melt quote id that should be subscribed to.
	 * @param callback Callback function that will be called when this melt quote gets paid.
	 * @param errorCallback
	 * @returns
	 */
	async onMeltQuoteUpdates(
		quoteIds: string[],
		callback: (payload: MeltQuoteResponse) => void,
		errorCallback: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		await this.mint.connectWebSocket();
		if (!this.mint.webSocketConnection) {
			throw new Error('failed to establish WebSocket connection.');
		}
		const subId = this.mint.webSocketConnection.createSubscription(
			{ kind: 'bolt11_melt_quote', filters: quoteIds },
			callback,
			errorCallback,
		);
		return () => {
			this.mint.webSocketConnection?.cancelSubscription(subId, callback);
		};
	}

	/**
	 * Register a callback to be called whenever a subscribed proof state changes.
	 *
	 * @param proofs List of proofs that should be subscribed to.
	 * @param callback Callback function that will be called whenever a proof's state changes.
	 * @param errorCallback
	 * @returns
	 */
	async onProofStateUpdates(
		proofs: Proof[],
		callback: (payload: ProofState & { proof: Proof }) => void,
		errorCallback: (e: Error) => void,
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
			errorCallback,
		);
		return () => {
			this.mint.webSocketConnection?.cancelSubscription(subId, callback);
		};
	}

	/**
	 * Creates blinded messages for a according to @param amounts.
	 *
	 * @param amount Array of amounts to create blinded messages for.
	 * @param counter? Optionally set counter to derive secret deterministically. CashuWallet class
	 *   must be initialized with seed phrase to take effect.
	 * @param pubkey? Optionally locks ecash to pubkey. Will not be deterministic, even if counter is
	 *   set!
	 * @param outputAmounts? Optionally specify the output's amounts to keep and to send.
	 * @param p2pk? Optionally specify options to lock the proofs according to NUT-11.
	 * @param factory? Optionally specify a custom function that produces OutputData (blinded
	 *   messages)
	 * @returns Blinded messages, secrets, rs, and amounts.
	 */
	private createOutputData(
		amount: number,
		keyset: MintKeys,
		counter?: number,
		pubkey?: string,
		outputAmounts?: number[],
		p2pk?: {
			pubkey: string | string[];
			locktime?: number;
			refundKeys?: string[];
			requiredSignatures?: number;
			requiredRefundSignatures?: number;
		},
		factory?: OutputDataFactory,
	): OutputDataLike[] {
		let outputData: OutputDataLike[];
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
				outputAmounts,
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
	 * Creates NUT-08 blank outputs (fee returns) for a given fee reserve See:
	 * https://github.com/cashubtc/nuts/blob/main/08.md.
	 *
	 * @param amount Amount to cover with blank outputs.
	 * @param keysetId Mint keysetId.
	 * @param counter? Optionally set counter to derive secret deterministically. CashuWallet class
	 *   must be initialized with seed phrase to take effect.
	 * @returns Blinded messages, secrets, and rs.
	 */
	private createBlankOutputs(
		amount: number,
		keyset: MintKeys,
		counter?: number,
		factory?: OutputDataFactory,
	): OutputDataLike[] {
		let count = Math.ceil(Math.log2(amount)) || 1;
		//Prevent count from being -Infinity
		if (count < 0) {
			count = 0;
		}
		// Note: zero amount + zero denomination passes splitAmount validation
		const zeros = count ? Array(count).fill(0) : [];
		return this.createOutputData(0, keyset, counter, undefined, zeros, undefined, factory);
	}

	/**
	 * Mints proofs for a given mint quote created with the bolt11 or bolt12 method.
	 *
	 * @param method Payment method of the quote.
	 * @param amount Amount to mint.
	 * @param quote The bolt11 or bolt12 mint quote.
	 * @param options Optional parameters for configuring the Mint Proof operation.
	 * @returns Proofs.
	 */
	private async _mintProofs<T extends 'bolt11' | 'bolt12'>(
		method: T,
		amount: number,
		quote: string | (T extends 'bolt11' ? MintQuoteResponse : Bolt12MintQuoteResponse),
		options?: MintProofOptions & { privateKey?: string },
	): Promise<Proof[]> {
		let { outputAmounts } = options || {};
		const { counter, pubkey, p2pk, keysetId, proofsWeHave, outputData, privateKey } = options || {};

		const keyset = await this.getKeys(keysetId);
		if (!outputAmounts && proofsWeHave) {
			outputAmounts = {
				keepAmounts: getKeepAmounts(proofsWeHave, amount, keyset.keys, this._denominationTarget),
				sendAmounts: [],
			};
		}
		let newBlindingData: OutputData[] = [];
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
				p2pk,
			);
		}
		let mintPayload: MintPayload;
		if (typeof quote !== 'string') {
			if (!privateKey) {
				throw new Error('Can not sign locked quote without private key');
			}
			const blindedMessages = newBlindingData.map((d) => d.blindedMessage);
			const mintQuoteSignature = signMintQuote(privateKey, quote.quote, blindedMessages);
			mintPayload = {
				outputs: blindedMessages,
				quote: quote.quote,
				signature: mintQuoteSignature,
			};
		} else {
			mintPayload = {
				outputs: newBlindingData.map((d) => d.blindedMessage),
				quote: quote,
			};
		}
		if (method === 'bolt12') {
			const { signatures } = await this.mint.mintBolt12(mintPayload);
			return newBlindingData.map((d, i) => d.toProof(signatures[i], keyset));
		}
		const { signatures } = await this.mint.mint(mintPayload);
		return newBlindingData.map((d, i) => d.toProof(signatures[i], keyset));
	}

	/**
	 * Melt proofs for a given melt quote created with the bolt11 or bolt12 method.
	 *
	 * @param method Payment method of the quote.
	 * @param meltQuote The bolt11 or bolt12 melt quote.
	 * @param proofsToSend Proofs to melt.
	 * @param options Optional parameters for configuring the Melting Proof operation.
	 * @returns Melt quote and change proofs.
	 */
	private async _meltProofs<T extends 'bolt11' | 'bolt12'>(
		method: T,
		meltQuote: T extends 'bolt11' ? MeltQuoteResponse : Bolt12MeltQuoteResponse,
		proofsToSend: Proof[],
		options?: MeltProofOptions,
	): Promise<MeltProofsResponse> {
		const { keysetId, counter, privkey } = options || {};
		const keys = await this.getKeys(keysetId);
		const outputData = this.createBlankOutputs(
			sumProofs(proofsToSend) - meltQuote.amount,
			keys,
			counter,
			this._keepFactory,
		);
		if (privkey != undefined) {
			proofsToSend = signP2PKProofs(proofsToSend, privkey);
		}

		proofsToSend = stripDleq(proofsToSend);

		// Ensure witnesses are serialized before sending to mint
		proofsToSend = proofsToSend.map((p: Proof) => {
			const witness =
				p.witness && typeof p.witness !== 'string' ? JSON.stringify(p.witness) : p.witness;
			return { ...p, witness };
		});

		const meltPayload: MeltPayload = {
			quote: meltQuote.quote,
			inputs: proofsToSend,
			outputs: outputData.map((d) => d.blindedMessage),
		};
		if (method === 'bolt12') {
			const meltResponse = await this.mint.meltBolt12(meltPayload);
			return {
				quote: { ...meltResponse, unit: meltQuote.unit, request: meltQuote.request },
				change: meltResponse.change?.map((s, i) => outputData[i].toProof(s, keys)) ?? [],
			};
		}
		const meltResponse = await this.mint.melt(meltPayload);
		return {
			quote: { ...meltResponse, unit: meltQuote.unit, request: meltQuote.request },
			change: meltResponse.change?.map((s, i) => outputData[i].toProof(s, keys)) ?? [],
		};
	}
}

export { CashuWallet };
