/**
 * Cashu Wallet Class.
 *
 * @remarks
 * This is the instantiation point for the Cashu-TS library.
 */

import {
	type MeltBlanks,
	type OutputType,
	type OutputConfig,
	type SendConfig,
	type SendOfflineConfig,
	type ReceiveConfig,
	type MintProofsConfig,
	type MeltProofsConfig,
	type MeltPayload,
	type MeltQuotePayload,
	type MintPayload,
	type MintQuotePayload,
	type MPPOption,
	type MeltQuoteOptions,
	type SwapTransaction,
	type Bolt12MintQuotePayload,
	type SwapPayload,
	type MeltProofsResponse,
	type SendResponse,
	type SubscriptionCanceller,
	type RestoreConfig,
	type SecretsPolicy,
	type OutputSpec,
} from './types';
import {
	type CounterSource,
	EphemeralCounterSource,
	type OperationCounters,
	type CounterRange,
} from './counters';

import { signMintQuote, signP2PKProofs, hashToCurve } from '../crypto';
import { Mint } from '../mint';
import { MintInfo } from '../model/MintInfo';
import { KeyChain } from './KeyChain';
import { type Keyset } from './Keyset';
import { WalletOps } from './WalletOps';
import { WalletEvents } from './WalletEvents';
import { type Logger, NULL_LOGGER, measureTime, fail, failIf, failIfNullish } from '../logger';

// shared primitives and options
import type { Proof } from '../model/types/proof';
import type { Token } from '../model/types/token';
import type { SerializedBlindedSignature } from '../model/types/blinded';
import { CheckStateEnum, type ProofState } from '../model/types/proof-state';
import type { MintKeys, MintKeyset } from '../model/types/keyset';

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
} from '../mint/types';
import { MintQuoteState, MeltQuoteState } from '../mint/types';

// model helpers
import { OutputData, type OutputDataFactory, type OutputDataLike } from '../model/OutputData';

import {
	getDecodedToken,
	getKeepAmounts,
	hasValidDleq,
	splitAmount,
	stripDleq,
	sumProofs,
	sanitizeUrl,
} from '../utils';

/**
 * Class that represents a Cashu wallet.
 *
 * @remarks
 * This class should act as the entry point for this library. Can be instantiated with a mint
 * instance or mint url.
 * @example
 *
 * ```typescript
 * import { Wallet } from '@cashu/cashu-ts';
 * const wallet = new Wallet('http://localhost:3338', { unit: 'sat' });
 * await wallet.loadMint(); // Initialize mint info, keysets, and keys
 * // Wallet is now ready to use, eg:
 * const proofs = [...]; // your array of unspent proofs
 * const { keep, send } = await wallet.send(32, proofs);
 * ```
 */
class Wallet {
	/**
	 * Mint instance - allows direct calls to the mint.
	 */
	public readonly mint: Mint;
	/**
	 * KeyChain instance - contains wallet keysets/keys.
	 */
	public readonly keyChain: KeyChain;
	/**
	 * Entry point for the builder.
	 *
	 * @example
	 *
	 *     const { keep, send } = await wallet.ops
	 *     	.send(5, proofs)
	 *     	.sendDeterministic() // counter: 0 = auto
	 *     	.keepRandom()
	 *     	.includeFees(true)
	 *     	.run();
	 *
	 *     const proofs = await wallet.ops
	 *     	.receive(token)
	 *     	.deterministic()
	 *     	.keyset(wallet.keysetId)
	 *     	.run();
	 */
	public readonly ops: WalletOps;
	/**
	 * Convenience wrapper for events.
	 */
	public readonly on: WalletEvents;
	private _seed: Uint8Array | undefined = undefined;
	private _unit = 'sat';
	private _mintInfo: MintInfo | undefined = undefined;
	private _denominationTarget = 3;
	private _secretsPolicy: SecretsPolicy = 'auto';
	private _counterSource: CounterSource;
	private _boundKeysetId: string = '__PENDING__';
	private _logger: Logger;

	/**
	 * @remarks
	 * Mint data will be fetched if not supplied. Note: to preload keys and keysets, both must be
	 * provided. If only one is provided, it will be ignored.
	 * @param mint Cashu mint instance or mint url (e.g. 'http://localhost:3338').
	 * @param options.unit Optional. Set unit (default: 'sat')
	 * @param options.keys Optional. Cached public keys.
	 * @param options.keysets Optional. Cached keysets.
	 * @param options.mintInfo Optional. Mint info from the mint.
	 * @param options.denominationTarget Target number proofs per denomination (default: 3)
	 * @param options.bip39seed Optional. BIP39 seed for deterministic secrets.
	 * @param options.logger Custom logger instance. Defaults to a null logger.
	 */
	constructor(
		mint: Mint | string,
		options?: {
			unit?: string;
			keysetId?: string; // if omitted, wallet binds to cheapest in loadMint
			bip39seed?: Uint8Array;
			secretsPolicy?: SecretsPolicy; // optional, auto
			counterSource?: CounterSource; // optional, otherwise ephemeral
			initialCounter?: number; // only used by EphemeralCounterSource
			keys?: MintKeys[] | MintKeys;
			keysets?: MintKeyset[];
			mintInfo?: GetInfoResponse;
			denominationTarget?: number;
			keepFactory?: OutputDataFactory;
			logger?: Logger;
		},
	) {
		this.ops = new WalletOps(this);
		this.on = new WalletEvents(this);
		this._logger = options?.logger ?? NULL_LOGGER;
		this.mint = typeof mint === 'string' ? new Mint(mint) : mint;
		this._unit = options?.unit ?? this._unit;
		this.keyChain = new KeyChain(this.mint, this._unit, options?.keysets, options?.keys);
		this._mintInfo = options?.mintInfo ? new MintInfo(options.mintInfo) : this._mintInfo;
		this._denominationTarget = options?.denominationTarget ?? this._denominationTarget;
		// Validate and set seed
		if (options?.bip39seed) {
			this.failIf(
				!(options.bip39seed instanceof Uint8Array),
				'bip39seed must be a valid Uint8Array',
				{
					bip39seed: options.bip39seed,
				},
			);
			this._seed = options.bip39seed;
		}
		this._secretsPolicy = options?.secretsPolicy ?? this._secretsPolicy;
		this._boundKeysetId = options?.keysetId ?? '__PENDING__';
		if (options?.counterSource) {
			this._counterSource = options.counterSource;
		} else {
			const initial =
				options?.keysetId && options.initialCounter != null
					? { [options.keysetId]: options.initialCounter }
					: undefined;
			this._counterSource = new EphemeralCounterSource(initial);
		}
	}

	// Convenience wrappers for "log and throw"
	private fail(message: string, context?: Record<string, unknown>): never {
		return fail(message, this._logger, context);
	}
	private failIf(
		condition: boolean,
		message: string,
		context?: Record<string, unknown>,
	): asserts condition is false {
		return failIf(condition, message, this._logger, context);
	}
	private failIfNullish<T>(
		value: T,
		message: string,
		context?: Record<string, unknown>,
	): asserts value is Exclude<T, null | undefined> {
		return failIfNullish(value, message, this._logger, context);
	}

	/**
	 * Load mint information, keysets, and keys. Must be called before using other methods.
	 *
	 * @param forceRefresh If true, re-fetches data even if cached.
	 * @throws If fetching mint info, keysets, or keys fails.
	 */
	async loadMint(forceRefresh?: boolean): Promise<void> {
		const promises = [];

		// Load mint info
		if (!this._mintInfo || forceRefresh) {
			promises.push(
				this.mint.getInfo().then((info) => {
					this._mintInfo = new MintInfo(info);
					return null;
				}),
			);
		}

		// Load KeyChain
		promises.push(this.keyChain.init(forceRefresh).then(() => null));

		await Promise.all(promises);
		this._logger.debug('KeyChain', { keychain: this.keyChain.getCache() });

		if (this._boundKeysetId === '__PENDING__') {
			this._boundKeysetId = this.keyChain.getCheapestKeyset().id;
		}
	}

	/**
	 * Get the wallet's unit.
	 *
	 * @returns The unit (e.g., 'sat').
	 */
	get unit(): string {
		return this._unit;
	}

	/**
	 * Get information about the mint.
	 *
	 * @remarks
	 * Returns cached mint info. Call `loadMint` first to initialize the wallet.
	 * @returns Mint info.
	 * @throws If mint info is not initialized.
	 */
	getMintInfo(): MintInfo {
		this.failIfNullish(this._mintInfo, 'Mint info not initialized; call loadMint first');
		return this._mintInfo;
	}

	/**
	 * The keyset ID bound to this wallet instance.
	 */
	get keysetId(): string {
		this.failIf(this._boundKeysetId === '__PENDING__', 'Wallet not initialised, call loadMint');
		return this._boundKeysetId;
	}

	private async reserveFor(keysetId: string, totalOutputs: number): Promise<CounterRange> {
		if (totalOutputs <= 0) return { start: 0, count: 0 };
		return this._counterSource.reserve(keysetId, totalOutputs);
	}

	private countersNeeded(spec: OutputSpec): number {
		const ot = spec.newOutputType;
		if (ot.type !== 'deterministic' || ot.counter !== 0) return 0;
		const denoms = ot.denominations ?? [];
		return denoms.length;
	}

	private async setAutoCounters(
		keysetId: string,
		...specs: OutputSpec[]
	): Promise<{ specs: OutputSpec[]; used?: OperationCounters }> {
		const total = specs.reduce((n, s) => n + this.countersNeeded(s), 0);
		if (total === 0) return { specs };

		const range = await this.reserveFor(keysetId, total);
		let cursor = range.start;

		const patched = specs.map((s) => {
			const need = this.countersNeeded(s);
			if (need === 0) return s;
			const ot = s.newOutputType as Extract<OutputType, { type: 'deterministic' }>;
			const patchedOT: OutputType = { ...ot, counter: cursor };
			cursor += need;
			return { ...s, newOutputType: patchedOT };
		});

		return { specs: patched, used: { keysetId, start: range.start, count: range.count } };
	}

	/**
	 * Creates a new Wallet instance bound to a specific keyset.
	 *
	 * The new wallet inherits this wallet’s mint connection, seed, secrets policy, logger, and key
	 * cache. You can override the counter source or initial counter via `opts` param.
	 *
	 * @param id The keyset identifier to associate with the new wallet.
	 * @param opts Optional overrides:
	 *
	 *   - InitialCounter: Starting counter value for deterministic outputs.
	 *   - CounterSource: Custom counter source implementation to use instead of the default.
	 *
	 * @returns A new Wallet configured with the given keyset and inherited state.
	 */
	withKeyset(
		id: string,
		opts?: { initialCounter?: number; counterSource?: CounterSource },
	): Wallet {
		return new Wallet(this.mint, {
			keysetId: id,
			bip39seed: this._seed,
			secretsPolicy: this._secretsPolicy,
			logger: this._logger,
			counterSource: opts?.counterSource ?? this._counterSource,
			initialCounter: opts?.initialCounter,
			...this.keyChain.getCache(),
		});
	}

	/**
	 * Returns the default OutputType for this wallet, based on its configured secrets policy
	 * (options?.secretsPolicy) and seed state.
	 *
	 * - If the secrets policy is 'random', returns { type: 'random' }.
	 * - If the policy is 'deterministic', requires a seed and returns { type: 'deterministic', counter:
	 *   0 }. Counter 0 is a flag meaning "auto-increment from current state".
	 * - If no explicit policy is set, falls back to:
	 *
	 *   - Deterministic if a seed is present.
	 *   - Random if no seed is present.
	 *
	 * @returns An OutputType object describing the default output strategy.
	 * @throws Error if the policy is 'deterministic' but no seed has been set.
	 */
	public defaultOutputType(): OutputType {
		if (this._secretsPolicy === 'random') return { type: 'random' };
		if (this._secretsPolicy === 'deterministic') {
			if (!this._seed) throw new Error('Deterministic policy requires a seed');
			return { type: 'deterministic', counter: 0 }; // 0 = auto flag
		}
		return this._seed ? { type: 'deterministic', counter: 0 } : { type: 'random' };
	}

	/**
	 * Generates blinded messages based on the specified output type.
	 *
	 * @param amount The total amount for outputs.
	 * @param keyset The mint keys.
	 * @param outputType The output configuration.
	 * @returns Prepared output data.
	 */
	private createOutputData(
		amount: number,
		keyset: Keyset,
		outputType: OutputType,
	): OutputDataLike[] {
		if (amount < 0) {
			// we can accept zero (for blanks) or positive values
			this._logger.warn('Amount was negative');
			return [];
		}
		if (
			'custom' != outputType.type &&
			outputType.denominations &&
			outputType.denominations.length > 0
		) {
			const splitSum = outputType.denominations.reduce((sum, a) => sum + a, 0);
			this.failIf(splitSum !== amount, 'Custom denominations sum mismatch', {
				splitSum,
				expected: amount,
			});
		}
		let outputData: OutputDataLike[];
		switch (outputType.type) {
			case 'random':
				outputData = OutputData.createRandomData(amount, keyset, outputType.denominations);
				break;
			case 'deterministic':
				this.failIfNullish(
					this._seed,
					'Deterministic outputs require a seed configured in the wallet',
				);
				outputData = OutputData.createDeterministicData(
					amount,
					this._seed,
					outputType.counter,
					keyset,
					outputType.denominations,
				);
				break;
			case 'p2pk':
				outputData = OutputData.createP2PKData(
					outputType.options,
					amount,
					keyset,
					outputType.denominations,
				);
				break;
			case 'factory': {
				const factorySplit = splitAmount(amount, keyset.keys, outputType.denominations);
				outputData = factorySplit.map((a) => outputType.factory(a, keyset));
				break;
			}
			case 'custom': {
				outputData = outputType.data;
				const customTotal = OutputData.sumOutputAmounts(outputData);
				this.failIf(
					customTotal !== amount,
					`Custom output data total (${customTotal}) does not match amount (${amount})`,
				);

				break;
			}
			default: {
				this.fail('Invalid OutputType');
			}
		}
		return outputData;
	}

	/**
	 * Configures output denominations with fee adjustments and optimization.
	 *
	 * @remarks
	 * If outputType has denominations or custom data, this MUST sum to the amount. If no
	 * denominations specified, these will be calculated based on proofsWeHave or the default split.
	 * Additional denominations to cover fees will then be added if required.
	 * @param amount The total amount for outputs.
	 * @param keyset The mint keyset.
	 * @param outputType The output configuration.
	 * @param includeFees Whether to include swap fees in the output amount.
	 * @param proofsWeHave Optional proofs for optimizing denomination splitting.
	 * @returns OutputType with required denominations.
	 */
	private configureOutputs(
		amount: number,
		keyset: Keyset,
		outputType: OutputType,
		includeFees: boolean = false,
		proofsWeHave: Proof[] = [],
	): OutputSpec {
		let newAmount = amount;

		// Custom outputs don't have automatic optimizations or fee inclusion)
		if (outputType.type === 'custom') {
			this.failIf(includeFees, 'The custom OutputType does not support automatic fee inclusion');

			// Validate sum early, as no denominations to fill
			const customTotal = OutputData.sumOutputAmounts(outputType.data);
			this.failIf(
				customTotal !== amount,
				`Custom output data total (${customTotal}) does not match amount (${amount})`,
			);
			return { newOutputType: outputType, newAmount };
		}

		// Use denominations provided?
		let denominations = outputType.denominations ?? [];
		if (denominations.length > 0) {
			const splitSum = denominations.reduce((sum, a) => sum + a, 0);
			this.failIf(splitSum !== amount, 'Custom denominations sum mismatch', {
				splitSum,
				expected: amount,
			});
		}

		// If no denominations, but proofsWeHave was provided - optimize
		// to keep around _denominationTarget proofs of each denomination.
		if (denominations.length === 0 && proofsWeHave.length > 0) {
			denominations = getKeepAmounts(
				proofsWeHave,
				newAmount,
				keyset.keys,
				this._denominationTarget,
			);
		}

		// If no denominations were provided or optimized, compute the default split
		// before calculating fees to ensure accurate output count.
		if (denominations.length === 0) {
			denominations = splitAmount(newAmount, keyset.keys);
		}

		// With includeFees, we create additional output amounts to cover the
		// fee the receiver will pay when they spend the proofs (ie sender pays fees)
		if (includeFees) {
			let receiveFee = this.getFeesForKeyset(denominations.length, keyset.id);
			let receiveFeeAmounts = splitAmount(receiveFee, keyset.keys);
			while (
				this.getFeesForKeyset(denominations.length + receiveFeeAmounts.length, keyset.id) >
				receiveFee
			) {
				receiveFee++;
				receiveFeeAmounts = splitAmount(receiveFee, keyset.keys);
			}
			newAmount += receiveFee;
			denominations = [...denominations, ...receiveFeeAmounts];
		}
		const newOutputType: OutputType = { ...outputType, denominations };
		return { newOutputType, newAmount };
	}

	/**
	 * Creates a swap transaction with sorted outputs for mint compatibility.
	 *
	 * @param inputs Prepared input proofs.
	 * @param keepOutputs Outputs to keep (change or receiver's proofs).
	 * @param sendOutputs Outputs to send (optional, default empty for receive/mint).
	 * @returns Swap transaction with payload and metadata for processing signatures.
	 */
	private createSwapTransaction(
		inputs: Proof[],
		keepOutputs: OutputDataLike[],
		sendOutputs: OutputDataLike[] = [],
	): SwapTransaction {
		// Prepare inputs for mint
		inputs = this._prepareInputsForMint(inputs);

		const mergedBlindingData = [...keepOutputs, ...sendOutputs];
		const indices = mergedBlindingData
			.map((_, i) => i)
			.sort(
				(a, b) =>
					mergedBlindingData[a].blindedMessage.amount - mergedBlindingData[b].blindedMessage.amount,
			);
		const keepVector: boolean[] = [
			...Array.from({ length: keepOutputs.length }, () => true),
			...Array.from({ length: sendOutputs.length }, () => false),
		];
		const sortedOutputData: OutputDataLike[] = indices.map((i) => mergedBlindingData[i]);
		const sortedKeepVector: boolean[] = indices.map((i) => keepVector[i]);
		const outputs = sortedOutputData.map((d) => d.blindedMessage);
		this._logger.debug('createSwapTransaction:', {
			indices,
			sortedKeepVector,
			outputs,
		});
		const payload: SwapPayload = {
			inputs,
			outputs,
		};
		return {
			payload,
			outputData: sortedOutputData,
			keepVector: sortedKeepVector,
			sortedIndices: indices,
		};
	}

	/**
	 * Prepares inputs for a mint operation.
	 *
	 * @remarks
	 * Internal method; strips DLEQ for privacy and serializes witnesses.
	 * @param proofs The proofs to prepare.
	 * @param keepDleq Optional boolean to keep DLEQ (default: false, strips for privacy).
	 * @returns Prepared proofs for mint payload.
	 */
	private _prepareInputsForMint(proofs: Proof[], keepDleq: boolean = false): Proof[] {
		if (!keepDleq) {
			proofs = stripDleq(proofs);
		}
		return proofs.map((p) => ({
			...p,
			witness: p.witness && typeof p.witness !== 'string' ? JSON.stringify(p.witness) : p.witness,
		}));
	}

	/**
	 * Prepares proofs for sending by signing P2PK-locked proofs.
	 *
	 * @remarks
	 * Call this method before operations like send if the proofs are P2PK-locked and need unlocking.
	 * This is a public wrapper for signing.
	 * @param proofs The proofs to sign.
	 * @param privkey The private key for signing.
	 * @returns Signed proofs.
	 */
	signP2PKProofs(proofs: Proof[], privkey: string | string[]): Proof[] {
		return signP2PKProofs(proofs, privkey);
	}

	/**
	 * Receive a token (swaps with mint for new proofs)
	 *
	 * @example
	 *
	 * ```typescript
	 * const result = await wallet.receive(
	 * 	token,
	 * 	{ includeFees: true },
	 * 	{ type: 'deterministic', counter: 0 },
	 * );
	 * ```
	 *
	 * @param token Token string or decoded token.
	 * @param config Optional receive config.
	 * @param outputType Configuration for proof generation. Defaults to wallet.defaultOutputType().
	 * @returns Newly minted proofs.
	 */
	async receive(
		token: Token | string,
		config?: ReceiveConfig,
		outputType?: OutputType,
	): Promise<Proof[]> {
		const { keysetId, privkey, requireDleq, proofsWeHave, onCountersReserved } = config || {};
		outputType = outputType ?? this.defaultOutputType(); // Fallback to policy

		let proofs: Proof[] = [];
		const keysets = this.keyChain.getKeysets();

		// Decode and validate token
		const decodedToken = typeof token === 'string' ? getDecodedToken(token, keysets) : token;
		const tokenMintUrl = sanitizeUrl(decodedToken.mint);
		this.failIf(tokenMintUrl !== this.mint.mintUrl, 'Token belongs to a different mint', {
			token: tokenMintUrl,
			wallet: this.mint.mintUrl,
		});
		this.failIf(decodedToken.unit !== this._unit, 'Token is not in wallet unit', {
			token: decodedToken.unit,
			wallet: this._unit,
		});

		// Extract token proofs
		({ proofs } = decodedToken);
		const totalAmount = sumProofs(proofs);
		if (totalAmount === 0) {
			return [];
		}

		// Sign proofs if needed
		if (privkey) {
			proofs = this.signP2PKProofs(proofs, privkey);
		}

		// Check DLEQs if needed
		const keyset = this.keyChain.getKeyset(keysetId);
		if (requireDleq && proofs.some((p) => !hasValidDleq(p, keyset))) {
			this.fail('Token contains proofs with invalid or missing DLEQ');
		}

		// Shape receive output type and denominations
		const netAmount = totalAmount - this.getFeesForProofs(proofs);
		let receive = this.configureOutputs(
			netAmount,
			keyset,
			outputType,
			false, // includeFees is not applicable for receive
			proofsWeHave,
		);

		// Assign counter atomically if OutputType is deterministic
		// and the counter is zero (auto-assign)
		const autoCounters = await this.setAutoCounters(keyset.id, receive);
		[receive] = autoCounters.specs;
		if (autoCounters.used) onCountersReserved?.(autoCounters.used);
		this._logger.debug('receive counter', { counter: autoCounters.used, receive });

		// Create outputs and execute swap
		const outputs = this.createOutputData(receive.newAmount, keyset, receive.newOutputType);
		const swapTransaction = this.createSwapTransaction(proofs, outputs, []);
		const { signatures } = await this.mint.swap(swapTransaction.payload);

		// Construct and return proofs
		const proofsReceived = swapTransaction.outputData.map((d, i) =>
			d.toProof(signatures[i], keyset),
		);
		const orderedProofs: Proof[] = [];
		swapTransaction.sortedIndices.forEach((s, o) => {
			orderedProofs[s] = proofsReceived[o];
		});
		this._logger.debug('RECEIVE COMPLETED', { amounts: orderedProofs.map((p) => p.amount) });
		return orderedProofs;
	}

	/**
	 * Sends proofs of a given amount from provided proofs.
	 *
	 * @remarks
	 * If proofs are P2PK-locked to your public key, call signP2PKProofs first to sign them. The
	 * default config uses exact match selection, and does not includeFees or requireDleq. Because the
	 * send is offline, the user will unlock the signed proofs when they receive them online.
	 * @param amount Amount to send.
	 * @param proofs Array of proofs (must sum >= amount; pre-sign if P2PK-locked).
	 * @param config Optional parameters for the send.
	 * @returns SendResponse with keep/send proofs.
	 * @throws Throws if the send cannot be completed offline.
	 */
	sendOffline(amount: number, proofs: Proof[], config?: SendOfflineConfig): SendResponse {
		const { requireDleq = false, includeFees = false, exactMatch = true } = config || {};
		if (requireDleq) {
			// Only use proofs that have a DLEQ
			proofs = proofs.filter((p: Proof) => p.dleq != undefined);
		}
		this.failIf(sumProofs(proofs) < amount, 'Not enough funds available to send');

		const { keep, send } = this.selectProofsToSend(proofs, amount, includeFees, exactMatch);
		// Ensure witnesses are serialized, strip DLEQ if not required
		const sendPrepared = this._prepareInputsForMint(send, requireDleq);
		return { keep, send: sendPrepared };
	}

	/**
	 * Send proofs with online swap if necessary.
	 *
	 * @remarks
	 * If proofs are P2PK-locked to your public key, call signP2PKProofs first to sign them.
	 * @example
	 *
	 * ```typescript
	 * // Simple send
	 * const result = await wallet.send(5, proofs);
	 *
	 * // With a SendConfig
	 * const result = await wallet.send(5, proofs, { includeFees: true });
	 *
	 * // With Custom output configuration
	 * const customConfig: OutputConfig = {
	 * 	send: { type: 'p2pk', options: { pubkey: '...' } },
	 * 	keep: { type: 'deterministic', counter: 0 },
	 * };
	 * const customResult = await wallet.send(5, proofs, { includeFees: true }, customConfig);
	 * ```
	 *
	 * @param amount Amount to send (receiver gets this net amount).
	 * @param proofs Array of proofs to split.
	 * @param config Optional parameters for the swap.
	 * @returns SendResponse with keep/send proofs.
	 * @throws Throws if the send cannot be completed offline or if funds are insufficient.
	 */
	async send(
		amount: number,
		proofs: Proof[],
		config?: SendConfig,
		outputConfig?: OutputConfig,
	): Promise<SendResponse> {
		const { keysetId, includeFees = false, onCountersReserved } = config || {};
		// Fallback to policy defaults if no outputConfig
		outputConfig = outputConfig ?? {
			send: this.defaultOutputType(),
			keep: this.defaultOutputType(),
		};

		// First, let's see if we can avoid a swap (and fees)
		// by trying an exact match offline selection, including fees if
		// we are giving the receiver the amount + their fee to receive
		// In Wallet.ts, near send()

		try {
			// Offline exact-match only allowed for plain-random defaults; deterministic implies swap.
			const wantsDeterministicByPolicy = this.defaultOutputType().type === 'deterministic';
			const isPlainRandom = (ot?: OutputType) =>
				!ot || (ot.type === 'random' && (!ot.denominations || ot.denominations.length === 0));

			if (
				keysetId ||
				wantsDeterministicByPolicy ||
				!isPlainRandom(outputConfig.send) ||
				(outputConfig.keep && !isPlainRandom(outputConfig.keep))
			) {
				// Explain why we must fall back to swap
				const reasons: string[] = [];
				if (keysetId) reasons.push('keysetId override');
				if (wantsDeterministicByPolicy) reasons.push('wallet default is deterministic');
				if (!isPlainRandom(outputConfig.send)) reasons.push('non-default send output type');
				if (outputConfig.keep && !isPlainRandom(outputConfig.keep))
					reasons.push('non-default keep output type');

				throw new Error(`Options require a swap: ${reasons.join(', ')}`);
			}

			// Proceed with offline exact-match attempt
			const { keep, send } = this.sendOffline(amount, proofs, {
				includeFees,
				exactMatch: true,
				requireDleq: false, // safety
			});
			const expectedFee = includeFees ? this.getFeesForProofs(send) : 0;

			if (sumProofs(send) === amount + expectedFee) {
				this._logger.info('Successful exactMatch offline selection!');
				return { keep, send };
			}
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : 'Unknown error';
			this._logger.debug('ExactMatch offline selection failed.', { e: message });
		}

		// Fetch keys
		const keyset = this.keyChain.getKeyset(keysetId);

		// Shape SEND output type and denominations
		let send = this.configureOutputs(
			amount,
			keyset,
			outputConfig.send ?? this.defaultOutputType(),
			includeFees,
		);

		// Select the subset of proofs needed to cover the swap (sendTarget + swap fee)
		const { keep: unselectedProofs, send: selectedProofs } = this.selectProofsToSend(
			proofs,
			send.newAmount,
			true, // Include fees to cover swap fee
		);
		// this._logger.debug('PROOFS SELECTED', {
		// 	unselectedProofs: unselectedProofs.map(p=>p.amount),
		// 	selectedProofs: selectedProofs.map(p=>p.amount),
		// });
		if (selectedProofs.length === 0) {
			throw new Error('Not enough funds available to send');
		}

		// Calculate our expected change from the swap (and sanity check!)
		const selectedSum = sumProofs(selectedProofs);
		const swapFee = this.getFeesForProofs(selectedProofs);
		const changeAmount = selectedSum - swapFee - send.newAmount;
		this.failIf(changeAmount < 0, 'Not enough funds available for swap', {
			selectedSum,
			swapFee,
			sendTarget: send.newAmount,
			changeAmount,
		});

		// Shape KEEP (change) output type and denominations
		// No includeFees, as we are the receiver of the change
		// Uses unselectedProofs to optimize denominations if needed
		let keep = this.configureOutputs(
			changeAmount,
			keyset,
			outputConfig.keep ?? this.defaultOutputType(),
			false,
			unselectedProofs,
		);

		// Assign counters atomically if either/both OutputTypes are deterministic
		// and the counter is zero (auto-assign)
		const autoCounters = await this.setAutoCounters(keyset.id, send, keep);
		[send, keep] = autoCounters.specs;
		if (autoCounters.used) onCountersReserved?.(autoCounters.used);
		this._logger.debug('send counters', { counter: autoCounters.used, send, keep });

		// Create the output data
		const sendOutputs = this.createOutputData(send.newAmount, keyset, send.newOutputType);
		const keepOutputs = this.createOutputData(keep.newAmount, keyset, keep.newOutputType);

		// Execute swap
		const swapTransaction = this.createSwapTransaction(selectedProofs, keepOutputs, sendOutputs);
		const { signatures } = await this.mint.swap(swapTransaction.payload);

		// Construct proofs
		const swapProofs = swapTransaction.outputData.map((d, i) => d.toProof(signatures[i], keyset));
		const reorderedProofs = Array(swapProofs.length);
		const reorderedKeepVector = Array(swapTransaction.keepVector.length);
		swapTransaction.sortedIndices.forEach((s, i) => {
			reorderedKeepVector[s] = swapTransaction.keepVector[i];
			reorderedProofs[s] = swapProofs[i];
		});
		const keepProofs: Proof[] = [];
		const sendProofs: Proof[] = [];
		reorderedProofs.forEach((p: Proof, i) => {
			if (reorderedKeepVector[i]) {
				keepProofs.push(p);
			} else {
				sendProofs.push(p);
			}
		});
		this._logger.debug('SEND COMPLETED', {
			unselectedProofs: unselectedProofs.map((p) => p.amount),
			keepProofs: keepProofs.map((p) => p.amount),
			sendProofs: sendProofs.map((p) => p.amount),
		});
		return {
			keep: [...keepProofs, ...unselectedProofs],
			send: sendProofs,
		};
	}
	/**
	 * Swap is an alias of send.
	 */
	public readonly swap = this.send.bind(this);

	/**
	 * Selects proofs to send based on amount and fee inclusion.
	 *
	 * @remarks
	 * Uses an adapted Randomized Greedy with Local Improvement (RGLI) algorithm, which has a time
	 * complexity O(n log n) and space complexity O(n).
	 * @param proofs Array of Proof objects available to select from.
	 * @param amountToSend The target amount to send.
	 * @param includeFees Optional boolean to include fees; Default: false.
	 * @param exactMatch Optional boolean to require exact match; Default: false.
	 * @returns SendResponse containing proofs to keep and proofs to send.
	 * @throws Throws an error if an exact match cannot be found within MAX_TIMEMS.
	 * @see https://crypto.ethz.ch/publications/files/Przyda02.pdf
	 */
	selectProofsToSend(
		proofs: Proof[],
		amountToSend: number,
		includeFees = false,
		exactMatch = false,
	): SendResponse {
		// Init vars
		const MAX_TRIALS = 60; // 40-80 is optimal (per RGLI paper)
		const MAX_OVRPCT = 0; // Acceptable close match overage (percent)
		const MAX_OVRAMT = 0; // Acceptable close match overage (absolute)
		const MAX_TIMEMS = 1000; // Halt new trials if over time (in ms)
		const MAX_P2SWAP = 5000; // Max number of Phase 2 improvement swaps
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
					this.failIfNullish(rightIndex, 'Unexpected null rightIndex in binary search');
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
					`selectProofsToSend: best solution found in trial #${trial} - amount: ${amount}, delta: ${delta}`,
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
				this.failIf(
					exactMatch,
					'Proof selection took too long. Try again with a smaller proof set.',
				);
				this._logger.warn('Proof selection took too long. Returning best selection so far.');
				break;
			}
		}
		// Return Result
		if (bestSubset && bestDelta < Infinity) {
			const bestProofs = bestSubset.map((obj) => obj.proof);
			const bestSubsetSet = new Set(bestProofs);
			const keep = proofs.filter((p) => !bestSubsetSet.has(p));
			this._logger.info(`Proof selection took ${timer.elapsed()}ms`);
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
	private getProofFeePPK(proof: Proof): number {
		try {
			return this.keyChain.getKeyset(proof.id).fee;
		} catch (e) {
			this.fail(`Could not get fee. No keyset found for keyset id: ${proof.id}`, {
				e,
				keychain: this.keyChain.getKeysets(),
			});
		}
	}

	/**
	 * Calculates the fees based on inputs for a given keyset.
	 *
	 * @param nInputs Number of inputs.
	 * @param keysetId KeysetId used to lookup `input_fee_ppk`
	 * @returns Fee amount.
	 */
	getFeesForKeyset(nInputs: number, keysetId: string): number {
		try {
			const feePPK = this.keyChain.getKeyset(keysetId).fee;
			return Math.floor(Math.max((nInputs * feePPK + 999) / 1000, 0));
		} catch (e) {
			this.fail(`No keyset found with ID ${keysetId}`, { e });
		}
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
	 * @param options.keysetId Set a custom keysetId to restore from. @see `keyChain)`
	 */
	async restore(
		start: number,
		count: number,
		config?: RestoreConfig,
	): Promise<{ proofs: Proof[]; lastCounterWithSignature?: number }> {
		const { keysetId } = config || {};
		const keyset = this.keyChain.getKeyset(keysetId);
		this.failIfNullish(this._seed, 'Cashu Wallet must be initialized with a seed to use restore');

		// create deterministic blank outputs for unknown restore amounts
		// Note: zero amount + zero denomination passes splitAmount validation
		const zeros = Array(count).fill(0);
		const outputData = OutputData.createDeterministicData(0, this._seed, start, keyset, zeros);

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
				restoredProofs.push(outputData[i].toProof(matchingSig, keyset));
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
		return { ...res, amount: res.amount || amount, unit: res.unit || this._unit };
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
		const { supported } = this.getMintInfo().isSupported(20);
		this.failIf(!supported, 'Mint does not support NUT-20');
		const mintQuotePayload: MintQuotePayload = {
			unit: this._unit,
			amount: amount,
			description: description,
			pubkey: pubkey,
		};
		const res = await this.mint.createMintQuote(mintQuotePayload);
		this.failIf(typeof res.pubkey !== 'string', 'Mint returned unlocked mint quote');
		const resPubkey = res.pubkey!;
		return {
			...res,
			pubkey: resPubkey,
			amount: res.amount || amount,
			unit: res.unit || this._unit,
		};
	}

	/**
	 * Requests a mint quote from the mint. Response returns a Lightning BOLT12 offer for the
	 * requested given amount and unit.
	 *
	 * @param pubkey Public key to lock the quote to.
	 * @param options.amount BOLT12 offer amount requesting for mint. If not specified, the offer will
	 *   be amountless.
	 * @param options.description Description for the mint quote.
	 * @returns The mint will return a mint quote with a BOLT12 offer for minting tokens of the
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
		const mintInfo = this.getMintInfo();
		if (options?.description && !mintInfo.supportsBolt12Description) {
			this.fail('Mint does not support description for bolt12');
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
	 * Mint proofs for a bolt11 quote.
	 *
	 * @param amount Amount to mint.
	 * @param quote Mint quote ID or object (bolt11).
	 * @param config Optional parameters (e.g. privkey for locked quotes).
	 * @param outputType Configuration for proof generation. Defaults to wallet.defaultOutputType().
	 * @returns Minted proofs.
	 */
	async mintProofs(
		amount: number,
		quote: string | MintQuoteResponse,
		config?: MintProofsConfig,
		outputType?: OutputType,
	): Promise<Proof[]> {
		return this._mintProofs('bolt11', amount, quote, config, outputType);
	}

	/**
	 * Mints proofs for a bolt12 quote.
	 *
	 * @param amount Amount to mint.
	 * @param quote Bolt12 mint quote.
	 * @param privkey Private key to unlock the quote.
	 * @param config Optional parameters (e.g. keysetId).
	 * @param outputType Configuration for proof generation. Defaults to wallet.defaultOutputType().
	 * @returns Minted proofs.
	 */
	async mintProofsBolt12(
		amount: number,
		quote: Bolt12MintQuoteResponse,
		privkey: string,
		config?: { keysetId?: string },
		outputType?: OutputType,
	): Promise<Proof[]> {
		return this._mintProofs('bolt12', amount, quote, { ...config, privkey }, outputType);
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
			unit: meltQuote.unit || this._unit,
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
		const { supported, params } = this.getMintInfo().isSupported(15);
		this.failIf(!supported, 'Mint does not support NUT-15');
		this.failIf(
			!params?.some((p) => p.method === 'bolt11' && p.unit === this._unit),
			`Mint does not support MPP for bolt11 and ${this._unit}`,
		);
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
	 * Returns an existing bolt11 melt quote from the mint.
	 *
	 * @param quote ID of the melt quote.
	 * @returns The mint will return an existing melt quote.
	 */
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

	/**
	 * Returns an existing bolt12 melt quote from the mint.
	 *
	 * @param quote ID of the melt quote.
	 * @returns The mint will return an existing melt quote.
	 */
	async checkMeltQuoteBolt12(quote: string): Promise<Bolt12MeltQuoteResponse> {
		return this.mint.checkMeltQuoteBolt12(quote);
	}

	/**
	 * Melt proofs for a bolt11 melt quote.
	 *
	 * @remarks
	 * ProofsToSend must be at least amount+fee_reserve from the melt quote. This function does not
	 * perform coin selection!.
	 * @param meltQuote ID of the melt quote.
	 * @param proofsToSend Proofs to melt.
	 * @param config Optional parameters.
	 * @param outputType Configuration for proof generation. Defaults to wallet.defaultOutputType().
	 * @returns MeltProofsResponse with quote and change proofs.
	 */
	async meltProofs(
		meltQuote: MeltQuoteResponse,
		proofsToSend: Proof[],
		config?: MeltProofsConfig,
		outputType?: OutputType,
	): Promise<MeltProofsResponse> {
		return this._meltProofs('bolt11', meltQuote, proofsToSend, config, outputType);
	}

	/**
	 * Melt proofs for a bolt12 melt quote, returns change proofs using specified outputType.
	 *
	 * @remarks
	 * ProofsToSend must be at least amount+fee_reserve from the melt quote. This function does not
	 * perform coin selection!.
	 * @param meltQuote ID of the melt quote.
	 * @param proofsToSend Proofs to melt.
	 * @param config Optional parameters.
	 * @param outputType Configuration for proof generation. Defaults to wallet.defaultOutputType().
	 * @returns MeltProofsResponse with quote and change proofs.
	 */
	async meltProofsBolt12(
		meltQuote: Bolt12MeltQuoteResponse,
		proofsToSend: Proof[],
		config?: MeltProofsConfig,
		outputType?: OutputType,
	): Promise<MeltProofsResponse> {
		return this._meltProofs('bolt12', meltQuote, proofsToSend, config, outputType);
	}

	/**
	 * Get an array of the states of proofs from the mint (as an array of CheckStateEnum's)
	 *
	 * @param proofs (only the `secret` field is required)
	 * @returns NUT-07 state for each proof, in same order.
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
				this.failIfNullish(state, 'Could not find state for proof with Y: ' + YsSlice[j]);
				states.push(state);
			}
		}
		return states;
	}

	/**
	 * Groups proofs by their corresponding state, preserving order within each group.
	 *
	 * @param proofs (only the `secret` field is required)
	 * @returns An object with arrays of proofs grouped by CheckStateEnum state.
	 */
	async groupProofsByState(
		proofs: Proof[],
	): Promise<{ unspent: Proof[]; pending: Proof[]; spent: Proof[] }> {
		const states: ProofState[] = await this.checkProofsStates(proofs);
		const result = {
			unspent: [] as Proof[],
			pending: [] as Proof[],
			spent: [] as Proof[],
		};
		for (let i = 0; i < states.length; i++) {
			const proof = proofs[i];
			switch (states[i].state) {
				case CheckStateEnum.UNSPENT:
					result.unspent.push(proof);
					break;
				case CheckStateEnum.PENDING:
					result.pending.push(proof);
					break;
				case CheckStateEnum.SPENT:
					result.spent.push(proof);
					break;
			}
		}
		return result;
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
		this.failIfNullish(this.mint.webSocketConnection, 'failed to establish WebSocket connection.');
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
	 * Register a callback to be called when a single melt quote gets paid.
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
	 * Register a callback to be called whenever a melt quote’s state changes.
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
		this.failIfNullish(this.mint.webSocketConnection, 'failed to establish WebSocket connection.');
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
		this.failIfNullish(this.mint.webSocketConnection, 'failed to establish WebSocket connection.');
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
	 * Internal helper for minting proofs with bolt11 or bolt12.
	 *
	 * @remarks
	 * Handles blinded messages, signatures, and proof construction. Use public methods like
	 * mintProofs or helpers for API access.
	 * @param method 'bolt11' or 'bolt12'.
	 * @param amount Amount to mint (must be positive).
	 * @param quote Quote ID or object.
	 * @param config Optional (privkey, keysetId).
	 * @param outputType Configuration for proof generation. Defaults to wallet.defaultOutputType().
	 * @returns Minted proofs.
	 * @throws If params are invalid or mint returns errors.
	 */
	private async _mintProofs<T extends 'bolt11' | 'bolt12'>(
		method: T,
		amount: number,
		quote: string | (T extends 'bolt11' ? MintQuoteResponse : Bolt12MintQuoteResponse),
		config?: MintProofsConfig,
		outputType?: OutputType,
	): Promise<Proof[]> {
		outputType = outputType ?? this.defaultOutputType(); // Fallback to policy
		const { privkey, keysetId, proofsWeHave, onCountersReserved } = config ?? {};
		this.failIf(amount <= 0, 'Invalid mint amount: must be positive', { amount });

		// Shape output type and denominations for our proofs
		// we are receiving, so no includeFees
		const keyset = this.keyChain.getKeyset(keysetId);
		let mintProofs = this.configureOutputs(
			amount,
			keyset,
			outputType,
			false, // no fees
			proofsWeHave,
		);

		// Assign counters atomically if OutputType is deterministic
		// and the counter is zero (auto-assign)
		const autoCounters = await this.setAutoCounters(keyset.id, mintProofs);
		[mintProofs] = autoCounters.specs;
		if (autoCounters.used) onCountersReserved?.(autoCounters.used);
		this._logger.debug('mint counter', { counter: autoCounters.used, mintProofs });

		// Create outputs and mint payload
		const outputs = this.createOutputData(mintProofs.newAmount, keyset, mintProofs.newOutputType);
		const blindedMessages = outputs.map((d) => d.blindedMessage);
		let mintPayload: MintPayload;
		if (typeof quote === 'string') {
			mintPayload = {
				outputs: blindedMessages,
				quote: quote,
			};
		} else {
			this.failIf(!privkey, 'Can not sign locked quote without private key');
			const mintQuoteSignature = signMintQuote(privkey!, quote.quote, blindedMessages);
			mintPayload = {
				outputs: blindedMessages,
				quote: quote.quote,
				signature: mintQuoteSignature,
			};
		}

		// Mint proofs
		let signatures;
		if (method === 'bolt12') {
			({ signatures } = await this.mint.mintBolt12(mintPayload));
		} else {
			({ signatures } = await this.mint.mint(mintPayload));
		}
		this.failIf(
			signatures.length !== outputs.length,
			`Mint returned ${signatures.length} signatures, expected ${outputs.length}`,
		);

		this._logger.debug('MINT COMPLETED', { amounts: outputs.map((o) => o.blindedMessage.amount) });
		return outputs.map((d, i) => d.toProof(signatures[i], keyset));
	}

	/**
	 * Melt proofs for a given melt quote created with the bolt11 or bolt12 method.
	 *
	 * @remarks
	 * Creates NUT-08 blanks (1-sat) for Lightning fee return. Get these by setting a
	 * config.onChangeOutputsCreated callback for async melting. @see completeMelt.
	 * @param method Payment method of the quote.
	 * @param meltQuote The bolt11 or bolt12 melt quote.
	 * @param proofsToSend Proofs to melt.
	 * @param config Optional (keysetId, onChangeOutputsCreated).
	 * @param outputType Configuration for proof generation. Defaults to wallet.defaultOutputType().
	 * @returns MeltProofsResponse.
	 * @throws If params are invalid or mint returns errors.
	 * @see https://github.com/cashubtc/nuts/blob/main/08.md.
	 */
	private async _meltProofs<T extends 'bolt11' | 'bolt12'>(
		method: T,
		meltQuote: T extends 'bolt11' ? MeltQuoteResponse : Bolt12MeltQuoteResponse,
		proofsToSend: Proof[],
		config?: MeltProofsConfig,
		outputType?: OutputType,
	): Promise<MeltProofsResponse> {
		outputType = outputType ?? this.defaultOutputType(); // Fallback to policy
		const { keysetId, onChangeOutputsCreated, onCountersReserved } = config || {};
		const keyset = this.keyChain.getKeyset(keysetId);
		const feeReserve = sumProofs(proofsToSend) - meltQuote.amount;
		let outputData: OutputDataLike[] = [];

		// Create NUT-08 blanks for return of Lightning fee change
		// Note: zero amount + zero denomination passes splitAmount validation
		if (feeReserve > 0) {
			let count = Math.ceil(Math.log2(feeReserve)) || 1;
			if (count < 0) count = 0; // Prevents: -Infinity
			const denominations: number[] = count ? new Array<number>(count).fill(0) : [];
			this._logger.debug('Creating NUT-08 blanks for fee reserve', {
				feeReserve,
				denominations,
			});

			// Build effective OutputType and merge denominations
			if (outputType.type === 'custom') {
				this.fail('Custom OutputType not supported for melt change (must be 0-sat blanks)');
			}
			let melt: OutputSpec = {
				newAmount: 0,
				newOutputType: {
					...outputType,
					denominations, // Our 0-sat blanks
				},
			};

			// Assign counter atomically if OutputType is deterministic
			// and the counter is zero (auto-assign)
			const autoCounters = await this.setAutoCounters(keyset.id, melt);
			[melt] = autoCounters.specs;
			if (autoCounters.used) onCountersReserved?.(autoCounters.used);
			this._logger.debug('melt counter', { counter: autoCounters.used, melt });

			// Generate the blank outputs (no fees as we are receiving change)
			// Remember, zero amount + zero denomination passes splitAmount validation
			outputData = this.createOutputData(0, keyset, melt.newOutputType);
		}

		// Prepare proofs for mint
		proofsToSend = this._prepareInputsForMint(proofsToSend);

		const meltPayload: MeltPayload = {
			quote: meltQuote.quote,
			inputs: proofsToSend,
			outputs: outputData.map((d) => d.blindedMessage),
		};

		// Fire callback with blanks (if provided)
		if (onChangeOutputsCreated) {
			const blanks: MeltBlanks = {
				method,
				payload: meltPayload,
				outputData,
				keyset,
				quote: meltQuote,
			};
			onChangeOutputsCreated(blanks);
		}

		// Proceed with melt
		let meltResponse;
		if (method === 'bolt12') {
			meltResponse = await this.mint.meltBolt12(meltPayload);
		} else {
			meltResponse = await this.mint.melt(meltPayload);
		}

		// Sanity check mint didn't send too many signatures before mapping
		// Should not happen, except in case of a broken or malicious mint
		this.failIf(
			(meltResponse.change?.length ?? 0) > outputData.length,
			`Mint returned ${meltResponse.change?.length ?? 0} signatures, but only ${outputData.length} blanks were provided`,
		);

		// Construct change if provided (empty if pending/not paid; shorter ok if less overfee)
		const change = meltResponse.change?.map((s, i) => outputData[i].toProof(s, keyset)) ?? [];
		this._logger.debug('MELT COMPLETED', { changeAmounts: change.map((p) => p.amount) });
		return { quote: { ...meltResponse, unit: meltQuote.unit, request: meltQuote.request }, change };
	}

	/**
	 * Completes a pending melt by re-calling the melt endpoint and constructing change proofs.
	 *
	 * @remarks
	 * Use with blanks from onChangeOutputsCreated to retry pending melts. Works for Bolt11/Bolt12.
	 * Returns change proofs if paid, else empty change.
	 * @param blanks The blanks from onChangeOutputsCreated.
	 * @returns Updated MeltProofsResponse.
	 * @throws If melt fails or signatures don't match output count.
	 */
	async completeMelt<T extends MeltQuoteResponse>(
		blanks: MeltBlanks<T>,
	): Promise<MeltProofsResponse> {
		const meltResponse =
			blanks.method === 'bolt12'
				? await this.mint.meltBolt12(blanks.payload)
				: await this.mint.melt(blanks.payload);

		// Check for too many signatures before mapping
		this.failIf(
			(meltResponse.change?.length ?? 0) > blanks.outputData.length,
			`Mint returned ${meltResponse.change?.length ?? 0} signatures, but only ${blanks.outputData.length} blanks were provided`,
		);

		// Construct change (shorter ok)
		const change =
			meltResponse.change?.map((s, i) => blanks.outputData[i].toProof(s, blanks.keyset)) ?? [];

		this._logger.debug('COMPLETE MELT', { changeAmounts: change.map((p) => p.amount) });
		return {
			quote: { ...meltResponse, unit: blanks.quote.unit, request: blanks.quote.request },
			change,
		};
	}
}

export { Wallet };
