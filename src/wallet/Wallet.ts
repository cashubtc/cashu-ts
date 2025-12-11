/**
 * Cashu Wallet Class.
 *
 * @remarks
 * This is the instantiation point for the Cashu-TS library.
 */

import {
	type MeltPreview,
	type OutputType,
	type OutputConfig,
	type SendConfig,
	type SendOfflineConfig,
	type ReceiveConfig,
	type MintProofsConfig,
	type MeltProofsConfig,
	type SwapTransaction,
	type MeltProofsResponse,
	type SendResponse,
	type RestoreConfig,
	type SecretsPolicy,
	type SwapPreview,
	type MeltBlanks,
} from './types';
import {
	type CounterSource,
	EphemeralCounterSource,
	type OperationCounters,
	type CounterRange,
} from './CounterSource';

import {
	signMintQuote,
	signP2PKProofs as cryptoSignP2PKProofs,
	hashToCurve,
	isP2PKSigAll,
	buildP2PKSigAllMessage,
	assertSigAllInputs,
	buildLegacyP2PKSigAllMessage,
	buildInterimP2PKSigAllMessage,
} from '../crypto';
import { Mint } from '../mint';
import { MintInfo } from '../model/MintInfo';
import { KeyChain } from './KeyChain';
import { type Keyset } from './Keyset';
import { WalletOps } from './WalletOps';
import { WalletEvents } from './WalletEvents';
import { WalletCounters } from './WalletCounters';
import { selectProofsRGLI, type SelectProofs } from './SelectProofs';
import { type Logger, NULL_LOGGER, fail, failIf, failIfNullish, safeCallback } from '../logger';

// shared primitives and options
import type { Proof } from '../model/types/proof';
import type { Token } from '../model/types/token';
import type { SerializedBlindedSignature } from '../model/types/blinded';
import { CheckStateEnum, type ProofState } from '../model/types/NUT07';
import type { MintKeys, MintKeyset } from '../model/types/keyset';
import type {
	GetInfoResponse,
	MeltRequest,
	MeltQuoteBaseResponse,
	MeltQuoteBolt11Request,
	MeltQuoteBolt11Response,
	MeltQuoteBolt12Response,
	MintRequest,
	MintQuoteBolt11Response,
	MintQuoteBolt12Response,
	MintQuoteBolt11Request,
	MintQuoteBolt12Request,
	SwapRequest,
} from '../model/types';

// model helpers
import { OutputData, type OutputDataLike } from '../model/OutputData';

import {
	getDecodedToken,
	getKeepAmounts,
	hasValidDleq,
	splitAmount,
	sumProofs,
	sanitizeUrl,
	invoiceHasAmountInHRP,
} from '../utils';
import { type AuthProvider } from '../auth/AuthProvider';

const PENDING_KEYSET_ID = '__PENDING__';

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
	 *     	.asDeterministic() // counter: 0 = auto
	 *     	.keepAsRandom()
	 *     	.includeFees(true)
	 *     	.run();
	 *
	 *     const proofs = await wallet.ops
	 *     	.receive(token)
	 *     	.asDeterministic()
	 *     	.keyset(wallet.keysetId)
	 *     	.run();
	 */
	public readonly ops: WalletOps;
	/**
	 * Convenience wrapper for events.
	 */
	public readonly on: WalletEvents;
	/**
	 * Developer-friendly counters API.
	 */
	public readonly counters: WalletCounters;
	private _seed: Uint8Array | undefined = undefined;
	private _unit = 'sat';
	private _mintInfo: MintInfo | undefined = undefined;
	private _denominationTarget = 3;
	private _secretsPolicy: SecretsPolicy = 'auto';
	private _counterSource: CounterSource;
	private _boundKeysetId: string = PENDING_KEYSET_ID;
	private _selectProofs: SelectProofs;
	private _logger: Logger;

	/**
	 * Create a wallet for a given mint and unit. Call `loadMint` before use.
	 *
	 * Binding, if `options.keysetId` is omitted, the wallet binds to the cheapest active keyset for
	 * this unit during `loadMint`. The keychain only loads keysets for this unit.
	 *
	 * Caching, to preload, provide both `keysets` and `keys`, otherwise the cache is ignored.
	 *
	 * Deterministic secrets, pass `bip39seed` and optionally `secretsPolicy`. Deterministic outputs
	 * reserve counters from `counterSource`, or an ephemeral in memory source if not supplied.
	 * `initialCounter` applies only with a supplied `keysetId` and the ephemeral source.
	 *
	 * Splitting, `denominationTarget` guides proof splits, default is 3. Override coin selection with
	 * `selectProofs` if needed. Logging defaults to a null logger.
	 *
	 * @param mint Mint instance or URL.
	 * @param options Optional settings.
	 * @param options.unit Wallet unit, default 'sat'.
	 * @param options.keysetId Bind to this keyset id, else bind on `loadMint`.
	 * @param options.bip39seed BIP39 seed for deterministic secrets.
	 * @param options.secretsPolicy Secrets policy, default 'auto'.
	 * @param options.counterSource Counter source for deterministic outputs. If provided, this takes
	 *   precedence over counterInit. Use when you need persistence across processes or devices.
	 * @param options.counterInit Seed values for the built-in EphemeralCounterSource. Ignored if
	 *   counterSource is also provided.
	 * @param options.keys Cached keys for this unit, only used when `keysets` is also provided.
	 * @param options.keysets Cached keysets for this unit, only used when `keys` is also provided.
	 * @param options.mintInfo Optional cached mint info.
	 * @param options.denominationTarget Target proofs per denomination, default 3.
	 * @param options.selectProofs Custom proof selection function.
	 * @param options.logger Logger instance, default null logger.
	 */
	constructor(
		mint: Mint | string,
		options?: {
			unit?: string;
			authProvider?: AuthProvider;
			keysetId?: string; // if omitted, wallet binds to cheapest in loadMint
			bip39seed?: Uint8Array;
			secretsPolicy?: SecretsPolicy; // optional, auto
			counterSource?: CounterSource; // optional, otherwise ephemeral
			counterInit?: Record<string, number>; // optional, starting "next" per keyset
			keys?: MintKeys[] | MintKeys;
			keysets?: MintKeyset[];
			mintInfo?: GetInfoResponse;
			denominationTarget?: number;
			selectProofs?: SelectProofs; // optional override
			logger?: Logger;
		},
	) {
		this.ops = new WalletOps(this);
		this.on = new WalletEvents(this);
		this._logger = options?.logger ?? NULL_LOGGER; // init early (seed can throw)
		this._selectProofs = options?.selectProofs ?? selectProofsRGLI; // vital
		this.mint =
			typeof mint === 'string'
				? new Mint(mint, { authProvider: options?.authProvider, logger: this._logger })
				: mint;
		this._unit = options?.unit ?? this._unit;
		this._boundKeysetId = options?.keysetId ?? this._boundKeysetId;
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
		if (options?.counterSource) {
			this._counterSource = options.counterSource;
		} else {
			this._counterSource = new EphemeralCounterSource(options?.counterInit);
		}
		this.counters = new WalletCounters(this._counterSource);
		this.keyChain = new KeyChain(this.mint, this._unit, options?.keysets, options?.keys);
		this._mintInfo = options?.mintInfo ? new MintInfo(options.mintInfo) : this._mintInfo;
		this._denominationTarget = options?.denominationTarget ?? this._denominationTarget;
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
	private safeCallback<T>(
		cb: ((p: T) => void) | undefined,
		payload: T,
		context?: Record<string, unknown>,
	): void {
		safeCallback(cb, payload, this._logger, context);
	}

	/**
	 * Asserts amount is a positive integer.
	 *
	 * @param amount To check.
	 * @param op Caller method name (or other identifier) for debug.
	 * @throws If not.
	 */
	private assertAmount(amount: unknown, op: string): asserts amount is number {
		this.failIf(
			typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0,
			'Amount must be a positive integer',
			{ op, amount },
		);
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

		if (this._boundKeysetId === PENDING_KEYSET_ID) {
			this._boundKeysetId = this.keyChain.getCheapestKeyset().id;
		} else {
			// Ensure the bound id is still present and keyed
			const k = this.keyChain.getKeyset(this._boundKeysetId);
			this.failIf(!k.hasKeys, 'Wallet keyset has no keys after refresh', { keyset: k.id });
		}
	}

	// -----------------------------------------------------------------
	// Section: Getters
	// -----------------------------------------------------------------

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
		this.failIf(this._boundKeysetId === PENDING_KEYSET_ID, 'Wallet not initialised, call loadMint');
		return this._boundKeysetId;
	}

	/**
	 * Gets the requested keyset or the keyset bound to the wallet.
	 *
	 * @remarks
	 * This method enforces wallet policies. If `id` is omitted, it returns the keyset bound to this
	 * wallet, including validation that:
	 *
	 * - The keyset exists in the keychain,
	 * - The unit matches the wallet's unit,
	 * - Keys are loaded for that keyset.
	 *
	 * Contrast with `keyChain.getKeyset(id?)`, which, when called without an id, returns the cheapest
	 * active keyset for the unit, ignoring the wallet binding.
	 * @param id Optional keyset id to resolve. If omitted, the wallet's bound keyset is used.
	 * @returns The resolved `Keyset`.
	 * @throws If the keyset is not found, has no keys, or its unit differs from the wallet.
	 */
	public getKeyset(id?: string): Keyset {
		const keyset = this.keyChain.getKeyset(id ?? this.keysetId);
		this.failIf(keyset.unit !== this._unit, 'Keyset unit does not match wallet unit', {
			keyset: keyset.id,
			unit: keyset.unit,
			walletUnit: this._unit,
		});
		this.failIf(!keyset.hasKeys, 'Keyset has no keys loaded', { keyset: keyset.id });
		return keyset;
	}

	public get logger(): Logger {
		return this._logger;
	}

	// -----------------------------------------------------------------
	// Section: Counters
	// -----------------------------------------------------------------

	private async reserveFor(keysetId: string, totalOutputs: number): Promise<CounterRange> {
		if (totalOutputs <= 0) return { start: 0, count: 0 };
		return this._counterSource.reserve(keysetId, totalOutputs);
	}

	private countersNeeded(ot: OutputType): number {
		if (ot.type !== 'deterministic' || ot.counter !== 0) return 0;
		return (ot.denominations ?? []).length;
	}

	private async addCountersToOutputTypes(
		keysetId: string,
		...outputTypes: OutputType[]
	): Promise<{ outputTypes: OutputType[]; used?: OperationCounters }> {
		const total = outputTypes.reduce((n, ot) => n + this.countersNeeded(ot), 0);
		if (total === 0) return { outputTypes };

		const range = await this.reserveFor(keysetId, total);
		let cursor = range.start;

		const patched = outputTypes.map((ot): OutputType => {
			if (ot.type === 'deterministic' && ot.counter === 0) {
				const need = (ot.denominations ?? []).length;
				if (need > 0) {
					const patched: typeof ot = { ...ot, counter: cursor };
					cursor += need;
					return patched;
				}
			}
			return ot;
		});

		// Fire event after successful reservation (wallet does not await handlers)
		const used = {
			keysetId,
			start: range.start,
			count: range.count,
			next: range.start + range.count,
		} as OperationCounters;
		this.on._emitCountersReserved(used);
		return { outputTypes: patched, used };
	}

	/**
	 * Bind this wallet to a specific keyset id.
	 *
	 * @remarks
	 * This changes the default keyset used by all operations that do not explicitly pass a keysetId.
	 * The method validates that the keyset exists in the keychain, matches the wallet unit, and has
	 * keys loaded.
	 *
	 * Typical uses:
	 *
	 * 1. After loadMint, to pin the wallet to a particular active keyset.
	 * 2. After a refresh, to rebind deliberately rather than falling back to cheapest.
	 *
	 * @param id The keyset identifier to bind to.
	 * @throws If keyset not found, if it has no keys loaded, or if its unit is not the wallet unit.
	 */
	public bindKeyset(id: string): void {
		const ks = this.keyChain.getKeyset(id);
		this.failIf(ks.unit !== this._unit, 'Keyset unit does not match wallet unit', {
			keyset: ks.id,
			unit: ks.unit,
			walletUnit: this._unit,
		});
		this.failIf(!ks.hasKeys, 'Keyset has no keys loaded', { keyset: ks.id });
		this._boundKeysetId = ks.id;
		this._logger.debug('Wallet bound to keyset', {
			keysetId: ks.id,
			unit: ks.unit,
			feePPK: ks.fee,
		});
	}

	/**
	 * Creates a new Wallet bound to a different keyset, sharing the same CounterSource.
	 *
	 * Use this to operate on multiple keysets concurrently without mutating your original wallet.
	 * Counters remain monotonic across instances because the same CounterSource is reused.
	 *
	 * Do NOT pass a fresh CounterSource for the same seed unless you know exactly why. Reusing
	 * counters can recreate secrets that a mint will reject.
	 *
	 * @param id The keyset identifier to bind to.
	 * @throws If keyset not found, if it has no keys loaded, or if its unit is not the wallet unit.
	 */
	public withKeyset(id: string, opts?: { counterSource?: CounterSource }): Wallet {
		return new Wallet(this.mint, {
			keysetId: id,
			bip39seed: this._seed,
			secretsPolicy: this._secretsPolicy,
			logger: this._logger,
			counterSource: opts?.counterSource ?? this._counterSource,
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
			this.failIfNullish(this._seed, 'Deterministic policy requires a seed');
			return { type: 'deterministic', counter: 0 }; // 0 = auto flag
		}
		return this._seed ? { type: 'deterministic', counter: 0 } : { type: 'random' };
	}

	// -----------------------------------------------------------------
	// Section: Output Creation
	// -----------------------------------------------------------------

	/**
	 * Configures output denominations with fee adjustments and optimization.
	 *
	 * @remarks
	 * If 'custom' outputType, data outputs MUST sum to the amount. Other outputTypes may supply
	 * denominations. If no denominations are passed in, they will be calculated based on proofsWeHave
	 * or the default split. If partial denominations are passed in, the balance will be added using
	 * default split. Additional denominations to cover fees will then be added if required.
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
	): OutputType {
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
			return outputType;
		}

		// Start with any denominations provided.
		// Note: These MAY be partial ("give me a [16,8], anything for the rest")
		// We will complete the denomination set before we are done.
		let denominations = outputType.denominations ?? [];

		// If no denominations, but proofsWeHave was provided - optimize
		// to get around _denominationTarget proofs of each denomination.
		if (denominations.length === 0 && proofsWeHave.length > 0) {
			denominations = getKeepAmounts(
				proofsWeHave,
				newAmount,
				keyset.keys,
				this._denominationTarget,
			);
		}

		// Fill in any missing denominations with default split.
		// NOTE: If we have to fill, the result will be in ASC order.
		// Original order is only maintained for exact denomination sets.
		denominations = splitAmount(newAmount, keyset.keys, denominations);

		// If includeFees, we create additional output amounts to cover the
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
		return { ...outputType, denominations };
	}

	/**
	 * Sum total implied by a prepared OutputType. Note: Empty denomination is valid (e.g: zero
	 * change).
	 */
	private preparedTotal(ot: OutputType): number {
		if (ot.type === 'custom') return OutputData.sumOutputAmounts(ot.data);
		const denoms = ot.denominations ?? [];
		return denoms.reduce((a, b) => a + b, 0);
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
		// we can accept zero (for blanks) or positive values
		this.failIf(amount < 0, 'Amount was negative', { amount });
		if (
			// 'custom' OutputType has no denominations. Every other OutputType does.
			// so let's sanity check those were filled properly (eg: configureOutputs)
			'custom' != outputType.type &&
			outputType.denominations &&
			outputType.denominations.length > 0
		) {
			const splitSum = outputType.denominations.reduce((sum, a) => sum + a, 0);
			this.failIf(splitSum !== amount, 'Denominations do not sum to the expected amount', {
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
	 * Creates a swap transaction with sorted outputs for privacy. This prevents a mint working out
	 * which proofs will be sent or kept.
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

		// Sort ASC by amount for privacy, but keep indices to return order afterwards
		// But ONLY if the transaction is NOT SIG_ALL (as order is fixed for signing)
		const mergedBlindingData = [...keepOutputs, ...sendOutputs];
		const indices = mergedBlindingData.map((_, i) => i);
		if (!isP2PKSigAll(inputs)) {
			indices.sort(
				(a, b) =>
					mergedBlindingData[a].blindedMessage.amount - mergedBlindingData[b].blindedMessage.amount,
			);
		}
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
			// outputs, // <-- removed for security
		});
		const payload: SwapRequest = {
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

	// -----------------------------------------------------------------
	// Section: Send and Receive
	// -----------------------------------------------------------------

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
		// Prepare and complete the send
		const txn = await this.prepareSwapToReceive(token, config, outputType);
		const { keep } = await this.completeSwap(txn, config?.privkey);
		return keep;
	}

	/**
	 * Prepare A Receive Transaction.
	 *
	 * @remarks
	 * Allows you to preview fees for a receive, get concrete outputs for P2PK SIG_ALL transactions,
	 * and do any pre-swap tasks (such as marking proofs in-flight etc)
	 * @example
	 *
	 * ```typescript
	 * // Prepare transaction
	 * const txn = await wallet.prepareSwapToReceive(token, { requireDleq: true });
	 * const fees = txn.fees;
	 *
	 * // Complete transaction
	 * const { keep } = await wallet.completeSwap(txn);
	 * ```
	 *
	 * @param token Token string or decoded token.
	 * @param config Optional receive config.
	 * @param outputType Configuration for proof generation. Defaults to wallet.defaultOutputType().
	 * @returns SwapPreview with metadata for swap transaction.
	 */
	async prepareSwapToReceive(
		token: Token | string,
		config?: ReceiveConfig,
		outputType?: OutputType,
	): Promise<SwapPreview> {
		const { keysetId, requireDleq, proofsWeHave, onCountersReserved } = config || {};
		outputType = outputType ?? this.defaultOutputType(); // Fallback to policy

		// Decode and validate token
		const decodedToken = typeof token === 'string' ? this.decodeToken(token) : token;
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
		let proofs: Proof[] = [];
		({ proofs } = decodedToken);
		const totalAmount = sumProofs(proofs);
		this.failIf(totalAmount === 0, 'Token contains no proofs', { proofs });

		// Check DLEQs if needed
		const keyset = this.getKeyset(keysetId); // specified or wallet keyset
		if (requireDleq) {
			for (const p of proofs) {
				const ks = this.keyChain.getKeyset(p.id);
				if (!hasValidDleq(p, ks)) {
					this.fail('Token contains proofs with invalid or missing DLEQ');
				}
			}
		}

		// Shape receive output type and denominations
		const swapFee = this.getFeesForProofs(proofs);
		const amount = totalAmount - swapFee;
		let receiveOT = this.configureOutputs(
			amount,
			keyset,
			outputType,
			false, // includeFees is not applicable for receive
			proofsWeHave,
		);

		// Assign counter atomically if OutputType is deterministic
		// and the counter is zero (auto-assign)
		const autoCounters = await this.addCountersToOutputTypes(keyset.id, receiveOT);
		[receiveOT] = autoCounters.outputTypes;
		if (autoCounters.used) {
			this.safeCallback(onCountersReserved, autoCounters.used, { op: 'receive' });
		}
		this._logger.debug('receive counter', { counter: autoCounters.used, receiveOT });

		// Create outputs and execute swap
		const outputs = this.createOutputData(this.preparedTotal(receiveOT), keyset, receiveOT);

		// Return SwapPreview
		return {
			amount,
			fees: swapFee,
			keysetId: keyset.id,
			inputs: proofs,
			keepOutputs: outputs,
		} as SwapPreview;
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
		this.assertAmount(amount, 'sendOffline');
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
		this.assertAmount(amount, 'send');
		const { keysetId, includeFees = false } = config || {};
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

		// Prepare and complete the send
		const txn = await this.prepareSwapToSend(amount, proofs, config, outputConfig);
		return await this.completeSwap(txn, config?.privkey);
	}

	/**
	 * Prepare A Send Transaction.
	 *
	 * @remarks
	 * Allows you to preview fees for a send, get concrete outputs for P2PK SIG_ALL transactions, and
	 * do any pre-swap tasks (such as marking proofs in-flight etc)
	 * @example
	 *
	 * ```typescript
	 * // Prepare transaction
	 * const txn = await wallet.prepareSwapToSend(5, proofs, { includeFees: true });
	 * const fees = txn.fees;
	 *
	 * // Complete transaction
	 * const { keep, send } = await wallet.completeSwap(txn);
	 * ```
	 *
	 * @param amount Amount to send (receiver gets this net amount).
	 * @param proofs Array of proofs to split.
	 * @param config Optional parameters for the swap.
	 * @returns SwapPreview with metadata for swap transaction.
	 * @throws Throws if the send cannot be completed offline or if funds are insufficient.
	 */
	async prepareSwapToSend(
		amount: number,
		proofs: Proof[],
		config?: SendConfig,
		outputConfig?: OutputConfig,
	): Promise<SwapPreview> {
		const { keysetId, includeFees = false, onCountersReserved } = config || {};

		// Fallback to policy defaults if no outputConfig
		outputConfig = outputConfig ?? {
			send: this.defaultOutputType(),
			keep: this.defaultOutputType(),
		};

		// Fetch keys
		const keyset = this.getKeyset(keysetId); // specified or wallet keyset

		// Shape SEND output type and denominations
		let sendOT = this.configureOutputs(
			amount,
			keyset,
			outputConfig.send ?? this.defaultOutputType(),
			includeFees,
		);
		const sendAmount = this.preparedTotal(sendOT);

		// Select the subset of proofs needed to cover the swap (sendTarget + swap fee)
		const { keep: unselectedProofs, send: selectedProofs } = this.selectProofsToSend(
			proofs,
			sendAmount,
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
		const changeAmount = selectedSum - swapFee - sendAmount;
		this.failIf(changeAmount < 0, 'Not enough funds available for swap', {
			selectedSum,
			swapFee,
			sendAmount,
			changeAmount,
		});

		// Shape KEEP (change) output type and denominations
		// No includeFees, as we are the receiver of the change
		let keepOT = this.configureOutputs(
			changeAmount,
			keyset,
			outputConfig.keep ?? this.defaultOutputType(),
			false,
			config?.proofsWeHave,
		);
		const keepAmount = this.preparedTotal(keepOT);

		// Assign counters atomically if either/both OutputTypes are deterministic
		// and the counter is zero (auto-assign)
		const autoCounters = await this.addCountersToOutputTypes(keyset.id, sendOT, keepOT);
		[sendOT, keepOT] = autoCounters.outputTypes;
		if (autoCounters.used) {
			this.safeCallback(onCountersReserved, autoCounters.used, { op: 'send' });
		}
		this._logger.debug('send counters', { counter: autoCounters.used, sendOT, keepOT });

		// Create the output data
		const sendOutputs = this.createOutputData(sendAmount, keyset, sendOT);
		const keepOutputs = this.createOutputData(keepAmount, keyset, keepOT);

		// Return SwapPreview
		return {
			amount,
			fees: swapFee,
			keysetId: keyset.id,
			inputs: selectedProofs,
			sendOutputs,
			keepOutputs,
			unselectedProofs,
		} as SwapPreview;
	}

	/**
	 * Complete a prepared swap transaction.
	 *
	 * @example
	 *
	 * ```typescript
	 * // Prepare transaction
	 * const txn = await wallet.prepareSwapToSend(5, proofs, { includeFees: true });
	 *
	 * // Complete transaction
	 * const result = await wallet.completeSwap(txn);
	 * ```
	 *
	 * @param swapPreview With metadata for swap transaction.
	 * @param privkey The private key(s) for signing.
	 * @returns SendResponse with keep/send proofs.
	 */
	async completeSwap(swapPreview: SwapPreview, privkey?: string | string[]): Promise<SendResponse> {
		const keepOutputs: OutputDataLike[] = swapPreview?.keepOutputs ? swapPreview.keepOutputs : [];
		const sendOutputs: OutputDataLike[] = swapPreview.sendOutputs ? swapPreview.sendOutputs : [];
		const unselectedProofs: Proof[] = swapPreview.unselectedProofs
			? swapPreview.unselectedProofs
			: [];

		// Sign proofs if needed
		if (privkey) {
			swapPreview.inputs = this.signP2PKProofs(swapPreview.inputs, privkey, [
				...keepOutputs,
				...sendOutputs,
			]);
		}

		// Create swap transaction
		const swapTransaction = this.createSwapTransaction(
			swapPreview.inputs,
			keepOutputs,
			sendOutputs,
		);

		// Execute swap
		const { signatures } = await this.mint.swap(swapTransaction.payload);

		// Construct proofs
		const keyset = this.getKeyset(swapPreview.keysetId);
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
	 * @deprecated - Use send()
	 */
	public readonly swap = this.send.bind(this);

	// -----------------------------------------------------------------
	// Section: Transaction Helpers
	// -----------------------------------------------------------------

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
		this.assertAmount(amountToSend, 'selectProofsToSend');
		const { keep, send } = this._selectProofs(
			proofs,
			amountToSend,
			this.keyChain,
			includeFees,
			exactMatch,
		);
		return { keep, send };
	}

	/**
	 * Prepares proofs for sending by signing P2PK-locked proofs.
	 *
	 * @remarks
	 * Call this method before operations like send if the proofs are P2PK-locked and need unlocking.
	 * This is a public wrapper for signing.
	 * @param proofs The proofs to sign.
	 * @param privkey The private key(s) for signing.
	 * @param outputData Optional. For signing of SIG_ALL transactions.
	 * @param quoteId Optional. For signing SIG_ALL melt transactions.
	 * @returns Signed proofs.
	 */
	signP2PKProofs(
		proofs: Proof[],
		privkey: string | string[],
		outputData?: OutputDataLike[],
		quoteId?: string,
	): Proof[] {
		// Normal case, sign everything as usual
		if (!isP2PKSigAll(proofs)) {
			return cryptoSignP2PKProofs(proofs, privkey, this._logger);
		}

		// Ensure SIG_ALL conditions are met
		this.failIfNullish(outputData, 'OutputData is required for SIG_ALL proof signing.');
		assertSigAllInputs(proofs);

		// SIG_ALL is in flux currently, so let's generate all known message formats
		// and sign the first proof only against each message...
		const [first, ...rest] = proofs;
		let signedFirst = first;
		const messages = [
			buildLegacyP2PKSigAllMessage(proofs, outputData, quoteId),
			buildInterimP2PKSigAllMessage(proofs, outputData, quoteId),
			buildP2PKSigAllMessage(proofs, outputData, quoteId),
		];
		for (const msg of messages) {
			signedFirst = cryptoSignP2PKProofs([signedFirst], privkey, this._logger, msg)[0];
		}

		// Return the proofs in same order as before
		return [signedFirst, ...rest];
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
			// We need the proof's keyset so use keyChain here
			// We must NOT fallback to wallet's keyset
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
			// We must NOT fallback to wallet's keyset
			const feePPK = this.keyChain.getKeyset(keysetId).fee;
			return Math.floor(Math.max((nInputs * feePPK + 999) / 1000, 0));
		} catch (e) {
			this.fail(`No keyset found with ID ${keysetId}`, { e });
		}
	}

	/**
	 * Prepares inputs for a mint operation.
	 *
	 * @remarks
	 * Internal method; strips DLEQ (NUT-12) and p2pk_e (NUT-26) for privacy and serializes witnesses.
	 * Returns an array of new proof objects - does not mutate the originals.
	 * @param proofs The proofs to prepare.
	 * @param keepDleq Optional boolean to keep DLEQ (default: false, strips for privacy).
	 * @returns Prepared proofs for mint payload.
	 */
	private _prepareInputsForMint(proofs: Proof[], keepDleq: boolean = false): Proof[] {
		return proofs.map((p) => {
			const witness =
				p.witness && typeof p.witness !== 'string' ? JSON.stringify(p.witness) : p.witness;
			const { dleq, p2pk_e, ...rest } = p; // isolate dleq and p2pk_e
			void p2pk_e; // intentionally unused (linter)
			// New proof object
			return keepDleq && dleq ? { ...rest, dleq, witness } : { ...rest, witness };
		});
	}

	/**
	 * Decodes a string token.
	 *
	 * @remarks
	 * Rehydrates a token from the space-saving CBOR format, including mapping short keyset ids to
	 * their full representation.
	 * @param token The token in string format (cashuB...)
	 * @returns Token object.
	 */
	public decodeToken(token: string): Token {
		const keysets = this.keyChain.getKeysets();
		return getDecodedToken(token, keysets);
	}

	// -----------------------------------------------------------------
	// Section: Restore
	// -----------------------------------------------------------------

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
		const keyset = this.getKeyset(keysetId); // specified or wallet keyset
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

	// -----------------------------------------------------------------
	// Section: Create Mint Quote
	// -----------------------------------------------------------------

	/**
	 * @deprecated Use createMintQuoteBolt11()
	 */
	async createMintQuote(amount: number, description?: string): Promise<MintQuoteBolt11Response> {
		return this.createMintQuoteBolt11(amount, description);
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
	async createMintQuoteBolt11(
		amount: number,
		description?: string,
	): Promise<MintQuoteBolt11Response> {
		this.assertAmount(amount, 'createMintQuoteBolt11');
		// Check if mint supports description for bolt11
		if (description) {
			const mintInfo = this.getMintInfo();
			if (!mintInfo.supportsNut04Description('bolt11', this._unit)) {
				this.fail('Mint does not support description for bolt11');
			}
		}

		const mintQuotePayload: MintQuoteBolt11Request = {
			unit: this._unit,
			amount: amount,
			description: description,
		};
		const res = await this.mint.createMintQuoteBolt11(mintQuotePayload);
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
	): Promise<MintQuoteBolt11Response> {
		this.assertAmount(amount, 'createLockedMintQuote');
		const { supported } = this.getMintInfo().isSupported(20);
		this.failIf(!supported, 'Mint does not support NUT-20');
		const mintQuotePayload: MintQuoteBolt11Request = {
			unit: this._unit,
			amount: amount,
			description: description,
			pubkey: pubkey,
		};
		const res = await this.mint.createMintQuoteBolt11(mintQuotePayload);
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
	): Promise<MintQuoteBolt12Response> {
		// Check if mint supports description for bolt12
		const mintInfo = this.getMintInfo();
		if (options?.description && !mintInfo.supportsNut04Description('bolt12', this._unit)) {
			this.fail('Mint does not support description for bolt12');
		}

		const mintQuotePayload: MintQuoteBolt12Request = {
			pubkey: pubkey,
			unit: this._unit,
			amount: options?.amount,
			description: options?.description,
		};

		return this.mint.createMintQuoteBolt12(mintQuotePayload);
	}

	// -----------------------------------------------------------------
	// Section: Check Mint Quote
	// -----------------------------------------------------------------

	/**
	 * @deprecated Use checkMintQuoteBolt11()
	 */
	async checkMintQuote(quote: string | MintQuoteBolt11Response): Promise<MintQuoteBolt11Response> {
		return this.checkMintQuoteBolt11(quote);
	}

	/**
	 * Gets an existing mint quote from the mint.
	 *
	 * @param quote Quote ID.
	 * @returns The mint will create and return a Lightning invoice for the specified amount.
	 */
	async checkMintQuoteBolt11(
		quote: string | MintQuoteBolt11Response,
	): Promise<MintQuoteBolt11Response> {
		const quoteId = typeof quote === 'string' ? quote : quote.quote;
		const baseRes = await this.mint.checkMintQuoteBolt11(quoteId);
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
	async checkMintQuoteBolt12(quote: string): Promise<MintQuoteBolt12Response> {
		return this.mint.checkMintQuoteBolt12(quote);
	}

	// -----------------------------------------------------------------
	// Section: Mint Proofs
	// -----------------------------------------------------------------

	/**
	 * @deprecated Use mintProofsBolt11()
	 */
	async mintProofs(
		amount: number,
		quote: string | MintQuoteBolt11Response,
		config?: MintProofsConfig,
		outputType?: OutputType,
	): Promise<Proof[]> {
		return this._mintProofs('bolt11', amount, quote, config, outputType);
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
	async mintProofsBolt11(
		amount: number,
		quote: string | MintQuoteBolt11Response,
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
		quote: MintQuoteBolt12Response,
		privkey: string,
		config?: { keysetId?: string },
		outputType?: OutputType,
	): Promise<Proof[]> {
		return this._mintProofs('bolt12', amount, quote, { ...config, privkey }, outputType);
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
		quote: string | (T extends 'bolt11' ? MintQuoteBolt11Response : MintQuoteBolt12Response),
		config?: MintProofsConfig,
		outputType?: OutputType,
	): Promise<Proof[]> {
		this.assertAmount(amount, `_mintProofs: ${method}`);
		outputType = outputType ?? this.defaultOutputType(); // Fallback to policy
		const { privkey, keysetId, proofsWeHave, onCountersReserved } = config ?? {};

		// Shape output type and denominations for our proofs
		// we are receiving, so no includeFees.
		const keyset = this.getKeyset(keysetId); // specified or wallet keyset
		let mintOT = this.configureOutputs(
			amount,
			keyset,
			outputType,
			false, // no fees
			proofsWeHave,
		);
		const mintAmount = this.preparedTotal(mintOT);

		// Assign counters atomically if OutputType is deterministic
		// and the counter is zero (auto-assign)
		const autoCounters = await this.addCountersToOutputTypes(keyset.id, mintOT);
		[mintOT] = autoCounters.outputTypes;
		if (autoCounters.used) {
			this.safeCallback(onCountersReserved, autoCounters.used, { op: 'mintProofs' });
		}
		this._logger.debug('mint counter', { counter: autoCounters.used, mintOT });

		// Create outputs and mint payload
		const outputs = this.createOutputData(mintAmount, keyset, mintOT);
		const blindedMessages = outputs.map((d) => d.blindedMessage);
		const mintPayload: MintRequest = {
			outputs: blindedMessages,
			quote: typeof quote === 'string' ? quote : quote.quote,
		};

		// Sign payload if the quote carries a public key
		if (typeof quote !== 'string' && quote.pubkey) {
			this.failIf(!privkey, 'Can not sign locked quote without private key');
			const mintQuoteSignature = signMintQuote(privkey!, quote.quote, blindedMessages);
			mintPayload.signature = mintQuoteSignature;
		}
		// Mint proofs
		let signatures;
		if (method === 'bolt12') {
			({ signatures } = await this.mint.mintBolt12(mintPayload));
		} else {
			({ signatures } = await this.mint.mintBolt11(mintPayload));
		}
		this.failIf(
			signatures.length !== outputs.length,
			`Mint returned ${signatures.length} signatures, expected ${outputs.length}`,
		);

		this._logger.debug('MINT COMPLETED', { amounts: outputs.map((o) => o.blindedMessage.amount) });
		return outputs.map((d, i) => d.toProof(signatures[i], keyset));
	}

	// -----------------------------------------------------------------
	// Section: Create Melt Quote
	// -----------------------------------------------------------------

	/**
	 * @deprecated Use createMeltQuoteBolt11.
	 */
	async createMeltQuote(invoice: string, amountMsat?: number): Promise<MeltQuoteBolt11Response> {
		return this.createMeltQuoteBolt11(invoice, amountMsat);
	}

	/**
	 * Requests a melt quote from the mint. Response returns amount and fees for a given unit in order
	 * to pay a Lightning invoice.
	 *
	 * @param invoice LN invoice that needs to get a fee estimate.
	 * @param amountMsat Optional amount in millisatoshis to attach for amountless invoices, must not
	 *   be provided for invoices that already encode an amount.
	 * @returns The mint will create and return a melt quote for the invoice with an amount and fee
	 *   reserve.
	 */
	async createMeltQuoteBolt11(
		invoice: string,
		amountMsat?: number,
	): Promise<MeltQuoteBolt11Response> {
		if (amountMsat !== undefined) {
			this.failIf(
				invoiceHasAmountInHRP(invoice),
				'amountMsat supplied but invoice already contains an amount. Leave amountMsat undefined for non-zero invoices.',
			);

			this.assertAmount(amountMsat, 'createMeltQuoteBolt11');
		}

		const supportsAmountless = this._mintInfo?.supportsAmountless?.('bolt11', this._unit) ?? false;

		const meltQuotePayload: MeltQuoteBolt11Request = {
			unit: this._unit,
			request: invoice,

			...(supportsAmountless && amountMsat !== undefined
				? {
						options: {
							amountless: {
								amount_msat: amountMsat,
							},
						},
					}
				: {}),
		};
		const meltQuote = await this.mint.createMeltQuoteBolt11(meltQuotePayload);
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
	): Promise<MeltQuoteBolt12Response> {
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
	 * @remarks
	 * Uses NUT-15 Partial multi-path payments for BOLT11.
	 * @param invoice LN invoice that needs to get a fee estimate.
	 * @param partialAmount The partial amount of the invoice's total to be paid by this instance.
	 * @returns The mint will create and return a melt quote for the invoice with an amount and fee
	 *   reserve.
	 * @see https://github.com/cashubtc/nuts/blob/main/15.md
	 */
	async createMultiPathMeltQuote(
		invoice: string,
		millisatPartialAmount: number,
	): Promise<MeltQuoteBolt11Response> {
		this.assertAmount(millisatPartialAmount, 'createMultiPathMeltQuote');
		const { supported, params } = this.getMintInfo().isSupported(15);
		this.failIf(!supported, 'Mint does not support NUT-15');
		this.failIf(
			!params?.some((p) => p.method === 'bolt11' && p.unit === this._unit),
			`Mint does not support MPP for bolt11 and ${this._unit}`,
		);
		const meltQuotePayload: MeltQuoteBolt11Request = {
			unit: this._unit,
			request: invoice,
			options: { mpp: { amount: millisatPartialAmount } },
		};
		const meltQuote = await this.mint.createMeltQuoteBolt11(meltQuotePayload);
		return { ...meltQuote, request: invoice, unit: this._unit };
	}

	// -----------------------------------------------------------------
	// Section: Check Melt Quote
	// -----------------------------------------------------------------

	/**
	 * @deprecated Use checkMeltQuoteBolt11()
	 */
	async checkMeltQuote(quote: string | MeltQuoteBolt11Response): Promise<MeltQuoteBolt11Response> {
		return this.checkMeltQuoteBolt11(quote);
	}

	/**
	 * Returns an existing bolt11 melt quote from the mint.
	 *
	 * @param quote ID of the melt quote.
	 * @returns The mint will return an existing melt quote.
	 */
	async checkMeltQuoteBolt11(
		quote: string | MeltQuoteBolt11Response,
	): Promise<MeltQuoteBolt11Response> {
		const quoteId = typeof quote === 'string' ? quote : quote.quote;
		const meltQuote = await this.mint.checkMeltQuoteBolt11(quoteId);
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
	async checkMeltQuoteBolt12(quote: string): Promise<MeltQuoteBolt12Response> {
		return this.mint.checkMeltQuoteBolt12(quote);
	}

	// -----------------------------------------------------------------
	// Section: Melt Proofs
	// -----------------------------------------------------------------

	/**
	 * @deprecated Use meltProofsBolt11()
	 */
	async meltProofs(
		meltQuote: MeltQuoteBolt11Response,
		proofsToSend: Proof[],
		config?: MeltProofsConfig,
		outputType?: OutputType,
	): Promise<MeltProofsResponse<MeltQuoteBolt11Response>> {
		return this.meltProofsBolt11(meltQuote, proofsToSend, config, outputType);
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
	async meltProofsBolt11(
		meltQuote: MeltQuoteBolt11Response,
		proofsToSend: Proof[],
		config?: MeltProofsConfig,
		outputType?: OutputType,
	): Promise<MeltProofsResponse<MeltQuoteBolt11Response>> {
		const meltTxn = await this.prepareMelt('bolt11', meltQuote, proofsToSend, config, outputType);
		const preferAsync: boolean = typeof config?.onChangeOutputsCreated === 'function';
		return this.completeMelt<MeltQuoteBolt11Response>(meltTxn, config?.privkey, preferAsync);
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
		meltQuote: MeltQuoteBolt12Response,
		proofsToSend: Proof[],
		config?: MeltProofsConfig,
		outputType?: OutputType,
	): Promise<MeltProofsResponse<MeltQuoteBolt12Response>> {
		const meltTxn = await this.prepareMelt('bolt12', meltQuote, proofsToSend, config, outputType);
		const preferAsync: boolean = typeof config?.onChangeOutputsCreated === 'function';
		return this.completeMelt<MeltQuoteBolt12Response>(meltTxn, config?.privkey, preferAsync);
	}

	/**
	 * Prepare A Melt Transaction.
	 *
	 * @remarks
	 * Allows you to preview fees for a melt, get concrete outputs for P2PK SIG_ALL melts, and do any
	 * pre-melt tasks (such as marking proofs in-flight etc). Creates NUT-08 blanks (1-sat) for
	 * Lightning fee return and returns a MeltPreview, which you can melt using completeMelt.
	 * @param method Payment method of the quote.
	 * @param meltQuote The melt quote.
	 * @param proofsToSend Proofs to melt.
	 * @param config Optional (keysetId, onChangeOutputsCreated).
	 * @param outputType Configuration for proof generation. Defaults to wallet.defaultOutputType().
	 * @returns MeltPreview.
	 * @throws If params are invalid.
	 * @see https://github.com/cashubtc/nuts/blob/main/08.md.
	 */
	async prepareMelt<TQuote extends MeltQuoteBaseResponse>(
		method: string,
		meltQuote: TQuote,
		proofsToSend: Proof[],
		config?: MeltProofsConfig,
		outputType?: OutputType,
	): Promise<MeltPreview<TQuote>> {
		outputType = outputType ?? this.defaultOutputType(); // Fallback to policy
		const { keysetId, onChangeOutputsCreated, onCountersReserved } = config || {};
		const keyset = this.getKeyset(keysetId); // specified or wallet keyset
		const sendAmount = sumProofs(proofsToSend);

		// feeReserve is the overage above the invoice/offer amount.
		// In the common case where selected proofs = amount + fee_reserve,
		// this equals the quote’s fee_reserve. If you overshoot more,
		// the extra also becomes NUT-08 lightning fee change.
		const feeReserve = sendAmount - meltQuote.amount;
		let outputData: OutputDataLike[] = [];

		// bolt11 does not allow partial payment, and although bolt12 could, mints
		// like CDK forbid it. So let's fail loudly up front...
		this.failIf(feeReserve < 0, 'Not enough proofs to cover amount + fee reserve', {
			sendAmount,
			quoteAmount: meltQuote.amount,
		});

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
			let meltOT: OutputType = { ...outputType, denominations };
			// Assign counter atomically if OutputType is deterministic
			// and the counter is zero (auto-assign)
			const autoCounters = await this.addCountersToOutputTypes(keyset.id, meltOT);
			[meltOT] = autoCounters.outputTypes;
			if (autoCounters.used) {
				this.safeCallback(onCountersReserved, autoCounters.used, { op: 'meltProofs' });
			}
			this._logger.debug('melt counter', { counter: autoCounters.used, meltOT });

			// Generate the blank outputs (no fees as we are receiving change)
			// Remember, zero amount + zero denomination passes splitAmount validation
			outputData = this.createOutputData(0, keyset, meltOT);
		}

		// Create melt preview
		const meltPreview: MeltPreview<TQuote> = {
			method,
			inputs: proofsToSend,
			outputData,
			keysetId: keyset.id,
			quote: meltQuote,
		};

		// Fire legacy event(s) after preview creation
		// Note: These events are deprecated and should be removed in a future version
		if (outputData.length > 0) {
			const blanks: MeltBlanks<TQuote> = {
				method: method as 'bolt11' | 'bolt12',
				payload: {
					quote: meltQuote.quote,
					inputs: proofsToSend,
					outputs: outputData.map((d) => d.blindedMessage),
				},
				outputData,
				keyset,
				quote: meltQuote,
			};
			this.safeCallback(onChangeOutputsCreated, blanks, { op: 'meltProofs' });
			this.on._emitMeltBlanksCreated(blanks); // global callback
		}

		return meltPreview;
	}

	/**
	 * Completes a pending melt by calling the melt endpoint and constructing change proofs.
	 *
	 * @remarks
	 * Use with a MeltPreview returned from prepareMelt or the legacy MeltBlanks object returned by
	 * the meltBlanksCreated or onChangeOutputsCreated callback. This method lets you sign P2PK locked
	 * proofs before melting. If the payment is pending or unpaid, the change array will be empty.
	 * @param meltPreview The preview from prepareMelt().
	 * @param privkey The private key(s) for signing.
	 * @param preferAsync Optional override to set 'respond-async' header.
	 * @returns Updated MeltProofsResponse.
	 * @throws If melt fails or signatures don't match output count.
	 */
	async completeMelt<TQuote extends MeltQuoteBaseResponse>(
		meltPreview: MeltPreview<TQuote> | MeltBlanks<TQuote>,
		privkey?: string | string[],
		preferAsync?: boolean,
	): Promise<MeltProofsResponse<TQuote>> {
		// Convert from legacy MeltBlanks if needed
		meltPreview = this.maybeConvertMeltBlanks(meltPreview);

		// Extract vars from MeltPreview
		let inputs = meltPreview.inputs;
		const outputs = meltPreview.outputData.map((d) => d.blindedMessage);
		const quote = meltPreview.quote.quote;
		const keyset = this.getKeyset(meltPreview.keysetId);

		// Sign proofs if needed
		if (privkey) {
			inputs = this.signP2PKProofs(inputs, privkey, meltPreview.outputData, quote);
		}

		// Prepare proofs for mint
		inputs = this._prepareInputsForMint(inputs);

		// Construct melt payload
		const meltPayload: MeltRequest = { quote, inputs, outputs };

		// Make melt call (note: bolt11 has legacy data handling)
		const meltResponse: MeltQuoteBaseResponse =
			meltPreview.method === 'bolt11'
				? await this.mint.meltBolt11(meltPayload, { preferAsync })
				: await this.mint.melt<TQuote>(meltPreview.method, meltPayload, {
						preferAsync,
					});

		// Check for too many blind signatures before mapping
		this.failIf(
			(meltResponse.change?.length ?? 0) > meltPreview.outputData.length,
			`Mint returned ${meltResponse.change?.length ?? 0} signatures, but only ${meltPreview.outputData.length} blanks were provided`,
		);

		// Construct change (shorter ok)
		const change =
			meltResponse.change?.map((s, i) => meltPreview.outputData[i].toProof(s, keyset)) ?? [];

		if (preferAsync) {
			this._logger.debug('ASYNC MELT REQUESTED', meltResponse);
		} else {
			this._logger.debug('MELT COMPLETED', { changeAmounts: change.map((p) => p.amount) });
		}

		const mergedQuote = {
			...meltPreview.quote,
			...meltResponse,
		} as TQuote;

		return { quote: mergedQuote, change } as MeltProofsResponse<TQuote>;
	}

	/**
	 * Helper to ease transition from MeltBlanks to MeltPreview.
	 */
	private maybeConvertMeltBlanks<TQuote extends MeltQuoteBaseResponse>(
		melt: MeltPreview<TQuote> | MeltBlanks<TQuote>,
	): MeltPreview<TQuote> {
		// New shape already, just return as is
		if (!('payload' in melt)) {
			return melt;
		}
		// Legacy MeltBlanks, adapt it to MeltPreview
		this._logger.warn(
			'MeltBlanks objects and the meltBlanksCreated / onChangeOutputsCreated events are deprecated. Please use wallet.prepareMelt() to create a MeltPreview instead.',
		);
		const { method, payload, outputData, keyset, quote } = melt;
		return {
			method,
			inputs: payload.inputs,
			outputData,
			keysetId: keyset.id,
			quote,
		};
	}

	// -----------------------------------------------------------------
	// Section: Proof States
	// -----------------------------------------------------------------

	/**
	 * Get an array of the states of proofs from the mint (as an array of CheckStateEnum's)
	 *
	 * @param proofs (only the `secret` field is required)
	 * @returns NUT-07 state for each proof, in same order.
	 */
	async checkProofsStates(proofs: Array<Pick<Proof, 'secret'>>): Promise<ProofState[]> {
		const enc = new TextEncoder();
		const Ys = proofs.map((p: Pick<Proof, 'secret'>) =>
			hashToCurve(enc.encode(p.secret)).toHex(true),
		);
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
}

export { Wallet };
