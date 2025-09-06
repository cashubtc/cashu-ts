/**
 * Cashu Wallet "v3"
 *
 * A Cashu wallet under active refactoring and development. This class is a work-in-progress
 * redesign of the CashuWallet, aiming for improved separation of concerns, simplified options
 * handling, and a cleaner API through the use of tagged unions and pipeline optimization. It is not
 * yet stable or production-ready.
 *
 * @remarks
 * Not for production use: Continue using the {@link CashuWallet} class, which provides the
 * established and tested implementation. This Wallet class is experimental and subject to breaking
 * changes during the v3 refactor process.
 * @example
 *
 *     import { Wallet } from '@cashu/cashu-ts';
 *     const mintUrl = 'http://localhost:3338';
 *     const wallet = new Wallet(mintUrl, { unit: 'sat' });
 *     await wallet.loadMint(); // Initialize mint info, keysets, and keys
 *     // Wallet is now ready to use, eg:
 *     const proofs = [...]; // your array of unspent proofs
 *     const { keep, send } = await wallet.send(32, proofs);
 *
 * @v3
 */

import { signP2PKProofs } from './crypto/client/NUT11';
import { hashToCurve } from './crypto/common/index';
import { Mint } from './Mint';
import { MintInfo } from './model/MintInfo';
import { KeyChain } from './model/KeyChain';
import { type Logger, NULL_LOGGER, measureTime } from './logger';
import type {
	GetInfoResponse,
	MintQuoteResponse,
	ProofState,
	RestoreOptions,
	SerializedBlindedSignature,
	MeltPayload,
	MeltProofsResponse,
	MeltQuotePayload,
	MeltQuoteResponse,
	MintKeys,
	MintKeyset,
	MintActiveKeys,
	MintAllKeysets,
	MintPayload,
	MintQuotePayload,
	Proof,
	SendResponse,
	Token,
	MPPOption,
	MeltQuoteOptions,
	SwapTransaction,
	LockedMintQuoteResponse,
	PartialMintQuoteResponse,
	PartialMeltQuoteResponse,
	Bolt12MintQuotePayload,
	Bolt12MintQuoteResponse,
	Bolt12MeltQuoteResponse,
	SwapPayload,
} from './model/types/index';
import { MintQuoteState, MeltQuoteState } from './model/types/index';
import { type SubscriptionCanceller } from './model/types/wallet/websocket';
import {
	getDecodedToken,
	getKeepAmounts,
	hasValidDleq,
	splitAmount,
	stripDleq,
	sumProofs,
	deepEqual,
} from './utils';
import { signMintQuote } from './crypto/client/NUT20';
import { OutputData, type OutputDataFactory, type OutputDataLike } from './model/OutputData';

/**
 * @v3
 * Options for configuring P2PK (Pay-to-Public-Key) locked proofs according to NUT-11. This type
 * represents a stable data structure used in the original CashuWallet API.
 */
export type P2PKOptions = {
	pubkey: string | string[];
	locktime?: number;
	refundKeys?: string[];
	requiredSignatures?: number;
	requiredRefundSignatures?: number;
};

/**
 * @v3
 * Configuration for receive operations.
 */
export type SendConfig = {
	keysetId?: string;
	privkey?: string;
	includeFees?: boolean;
};

/**
 * @v3
 * Configuration for receive operations.
 */
export type ReceiveConfig = {
	keysetId?: string;
	privkey?: string;
	requireDleq?: boolean;
};

/**
 * @v3
 * Configuration for receive operations.
 */
export type MintProofsConfig = {
	keysetId?: string;
	privkey?: string;
};

/**
 * @v3
 * Configuration for receive operations.
 */
export type MeltProofsConfig = {
	keysetId?: string;
	privkey?: string;
};

/**
 * Shared properties for most `OutputType` variants (except 'custom').
 *
 * @v3
 */
export interface SharedOutputTypeProps {
	/**
	 * Optional custom amounts for splitting outputs.
	 *
	 * @default Uses basic splitAmount if omitted.
	 */
	splitAmounts?: number[];
	/**
	 * Optional proofs from this mint for optimizing denomination splitting.
	 *
	 * @remarks
	 * Used with Wallet's `denominationTarget` option.
	 * @see Wallet constructor for details.
	 */
	proofsWeHave?: Proof[];
}

/**
 * Configuration for generating blinded message outputs.
 *
 * @remarks
 * A discriminated union based on the `type` field. Experimental; may change. For production, use
 * CashuWallet's main API.
 * @example
 *
 *     // Random with custom splits
 *     const random: OutputType = { type: 'random', splitAmounts: [1, 2, 4] };
 *     // Deterministic
 *     const deterministic: OutputType = { type: 'deterministic', counter: 0 };
 *
 * @v3
 */
export type OutputType =
	| ({
			/**
			 * Random blinding factors (default behavior).
			 */
			type: 'random';
	  } & SharedOutputTypeProps)
	| ({
			/**
			 * Deterministic outputs based on a counter.
			 */
			type: 'deterministic';
			counter: number;
	  } & SharedOutputTypeProps)
	| ({
			/**
			 * Pay-to-public-key (P2PK) outputs.
			 *
			 * @see P2PKOptions
			 */
			type: 'p2pk';
			options: P2PKOptions;
	  } & SharedOutputTypeProps)
	| ({
			/**
			 * Factory-generated OutputData.
			 *
			 * @remarks
			 * Outputs count from splitAmounts or basic split.
			 * @see OutputDataFactory
			 */
			type: 'factory';
			factory: OutputDataFactory;
	  } & SharedOutputTypeProps)
	| {
			/**
			 * Pre-created OutputData, bypassing splitting.
			 */
			type: 'custom';
			data: OutputData[];
	  };

/**
 * Output config for send/swap operations.
 *
 * @remarks
 * Defines types for sent and kept proofs.
 *
 * - `send`: Required for recipient proofs.
 * - `keep`: Optional; defaults to random.
 *
 * @example
 *
 *     const config: OutputConfig = {
 *     	send: { type: 'random', splitAmounts: [1, 2] },
 *     	keep: { type: 'deterministic', counter: 0 },
 *     };
 *     await wallet.send(3, proofs, config, { includeFees: true });
 *
 * @v3
 */
export interface OutputConfig {
	send: OutputType;
	keep?: OutputType;
}

/**
 * Default `OutputType` ({ type: 'random' }).
 *
 * @remarks
 * Use for default random outputs in methods like `wallet.receive`. Narrowly typed for easy
 * spreading/customization.
 * @example
 *
 *     // Basic usage
 *     await wallet.receive('cashuB...', DEFAULT_OUTPUT, { requireDleq: true });
 *     // Customized
 *     const custom: OutputType = { ...DEFAULT_OUTPUT, splitAmounts: [1, 2, 4] };
 *
 * @v3
 */
export const DEFAULT_OUTPUT = { type: 'random' } satisfies Extract<OutputType, { type: 'random' }>;

/**
 * Default config for send/swap operations.
 *
 * @remarks
 * Simplifies calls; spread for customization.
 * @example
 *
 *     await wallet.send(5, proofs, DEFAULT_OUTPUT_CONFIG, { includeFees: true });
 *
 *     const customKeep = {
 *     	...DEFAULT_OUTPUT_CONFIG,
 *     	keep: { type: 'deterministic', counter: 0 },
 *     };
 *     await wallet.send(5, proofs, customKeep, { includeFees: true });
 *
 * @v3
 */
export const DEFAULT_OUTPUT_CONFIG: OutputConfig = {
	send: DEFAULT_OUTPUT,
	keep: DEFAULT_OUTPUT,
};

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
 *
 * @v3
 */
class Wallet {
	readonly mint: Mint;
	readonly keyChain: KeyChain;
	private _seed: Uint8Array | undefined = undefined;
	private _unit = 'sat';
	private _mintInfo: MintInfo | undefined = undefined;
	private _denominationTarget = 3;
	private _logger: Logger;

	/**
	 * @remarks
	 * Mint data will be fetched if not supplied. Note: to preload keys and keysets, both must be
	 * provided. If only one is provided, it will be ignored.
	 * @param mint Cashu mint instance or mint url (e.g. 'http://localhost:3338').
	 * @param options.unit Optional. Set unit (default: 'sat')
	 * @param options.keys Optional. Cached public keys (single, array, or full MintActiveKeys).
	 * @param options.keysets Optional. Cached keysets (array or full MintAllKeysets).
	 * @param options.mintInfo Optional. Mint info from the mint.
	 * @param options.denominationTarget Target number proofs per denomination (default: 3)
	 * @param options.bip39seed Optional. BIP39 seed for deterministic secrets.
	 * @param options.logger Custom logger instance. Defaults to a null logger.
	 */
	constructor(
		mint: Mint | string,
		options?: {
			unit?: string;
			keys?: MintKeys[] | MintKeys | MintActiveKeys;
			keysets?: MintKeyset[] | MintAllKeysets;
			mintInfo?: GetInfoResponse;
			bip39seed?: Uint8Array;
			denominationTarget?: number;
			keepFactory?: OutputDataFactory;
			logger?: Logger;
		},
	) {
		this._logger = options?.logger ?? NULL_LOGGER;
		this.mint = typeof mint === 'string' ? new Mint(mint) : mint;
		this._unit = options?.unit ?? this._unit;
		this.keyChain = new KeyChain(this.mint, this._unit, options?.keysets, options?.keys);
		this._mintInfo = options?.mintInfo ? new MintInfo(options.mintInfo) : this._mintInfo;
		this._denominationTarget = options?.denominationTarget ?? this._denominationTarget;
		// Validate and set seed
		if (options?.bip39seed) {
			if (!(options.bip39seed instanceof Uint8Array)) {
				const message = 'bip39seed must be a valid Uint8Array';
				this._logger.error(message, { bip39seed: options.bip39seed });
				throw new Error(message);
			}
			this._seed = options.bip39seed;
		}
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
		if (!this._mintInfo) {
			const message = 'Mint info not initialized; call loadMint first';
			this._logger.error(message);
			throw new Error(message);
		}
		return this._mintInfo;
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
		keyset: MintKeys,
		outputType: OutputType,
	): OutputDataLike[] {
		if (amount <= 0) {
			this._logger.warn('Amount was invalid (zero or negative)');
			return [];
		}
		if (
			'custom' != outputType.type &&
			outputType.splitAmounts &&
			outputType.splitAmounts.length > 0
		) {
			const splitSum = outputType.splitAmounts.reduce((sum, a) => sum + a, 0);
			if (splitSum !== amount) {
				this._logger.error('Custom splitAmounts sum mismatch', { splitSum, expected: amount });
				throw new Error(`Custom splitAmounts sum to ${splitSum}, expected ${amount}`);
			}
		}
		let outputData: OutputDataLike[];
		switch (outputType.type) {
			case 'random':
				outputData = OutputData.createRandomData(amount, keyset, outputType.splitAmounts);
				break;
			case 'deterministic':
				if (!this._seed) {
					const message = 'Deterministic outputs require a seed configured in the wallet';
					this._logger.error(message);
					throw new Error(message);
				}
				outputData = OutputData.createDeterministicData(
					amount,
					this._seed,
					outputType.counter,
					keyset,
					outputType.splitAmounts,
				);
				break;
			case 'p2pk':
				outputData = OutputData.createP2PKData(
					outputType.options,
					amount,
					keyset,
					outputType.splitAmounts,
				);
				break;
			case 'factory': {
				const factorySplit = splitAmount(amount, keyset.keys, outputType.splitAmounts);
				outputData = factorySplit.map((a) => outputType.factory(a, keyset));
				break;
			}
			case 'custom': {
				outputData = outputType.data;
				const customTotal = OutputData.sumOutputAmounts(outputData);
				if (customTotal !== amount) {
					const message = `Custom output data total (${customTotal}) does not match amount (${amount})`;
					this._logger.error(message);
					throw new Error(message);
				}
				break;
			}
			default: {
				const message = `Invalid OutputType`;
				this._logger.error(message);
				throw new Error(message);
			}
		}
		return outputData;
	}

	/**
	 * Configures outputs with fee adjustments and optimization.
	 *
	 * @param amount The total amount for outputs.
	 * @param keys The mint keys.
	 * @param outputType The output configuration.
	 * @param includeFees Whether to include swap fees in the output amount.
	 * @returns Prepared output data.
	 */
	private configureOutputs(
		amount: number,
		keys: MintKeys,
		outputType: OutputType,
		includeFees?: boolean,
	): OutputDataLike[] {
		let adjustedAmount = amount;

		// Custom outputs don't have automatic optimizations or fee inclusion)
		if (outputType.type === 'custom') {
			if (includeFees) {
				const message = 'The custom OutputType does not support automatic fee inclusion';
				this._logger.error(message);
				throw new Error(message);
			}
			return this.createOutputData(adjustedAmount, keys, outputType);
		}

		let splitAmounts = outputType.splitAmounts ?? [];
		const proofsWeHave = outputType.proofsWeHave ?? [];

		// If proofsWeHave was provided - we will try to optimize the outputs so
		// that we only keep around _denominationTarget proofs of each amount.
		if (proofsWeHave.length > 0) {
			splitAmounts = getKeepAmounts(
				proofsWeHave,
				adjustedAmount,
				keys.keys,
				this._denominationTarget,
			);
		}

		// If no splitAmounts were provided or optimized, compute the default split
		// before calculating fees to ensure accurate output count.
		if (splitAmounts.length === 0) {
			splitAmounts = splitAmount(adjustedAmount, keys.keys);
		}

		// With includeFees, we create additional output amounts to cover the
		// fee the receiver will pay when they spend the proofs (ie sender pays fees)
		if (includeFees) {
			let receiveFee = this.getFeesForKeyset(splitAmounts.length, keys.id);
			let receiveFeeAmounts = splitAmount(receiveFee, keys.keys);
			while (
				this.getFeesForKeyset(splitAmounts.length + receiveFeeAmounts.length, keys.id) > receiveFee
			) {
				receiveFee++;
				receiveFeeAmounts = splitAmount(receiveFee, keys.keys);
			}
			adjustedAmount += receiveFee;
			splitAmounts = [...splitAmounts, ...receiveFeeAmounts];
		}

		const effectiveOutputType: OutputType = { ...outputType, splitAmounts };
		return this.createOutputData(adjustedAmount, keys, effectiveOutputType);
	}

	/**
	 * Prepares inputs for a mint operation, with optional P2PK signing and DLEQ stripping.
	 *
	 * @remarks
	 * Recommended to use this method before any mint operation. Strips DLEQ by default.
	 * @param proofs The proofs to prepare.
	 * @param privkey Optional private key for signing.
	 * @param keepDleq Optional boolean to keep DLEQ.
	 * @returns Prepared proofs.
	 */
	private prepareInputs(proofs: Proof[], privkey?: string, keepDleq?: boolean): Proof[] {
		if (!keepDleq) {
			proofs = stripDleq(proofs);
		}
		if (privkey) {
			proofs = signP2PKProofs(proofs, privkey);
		}
		return proofs.map((p) => ({
			...p,
			witness: p.witness && typeof p.witness !== 'string' ? JSON.stringify(p.witness) : p.witness,
		}));
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
		privkey?: string,
	): SwapTransaction {
		// Sign P2PK proofs and prepare inputs for mint
		inputs = this.prepareInputs(inputs, privkey);

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
		this._logger.debug('createSwapTransaction:', {
			indices,
			sortedKeepVector,
			outputs: sortedOutputData.map((d) => d.blindedMessage),
		});
		const payload: SwapPayload = {
			inputs,
			outputs: sortedOutputData.map((d) => d.blindedMessage),
		};
		return {
			payload,
			outputData: sortedOutputData,
			keepVector: sortedKeepVector,
			sortedIndices: indices,
		};
	}

	/**
	 * Receives a cashu token and returns proofs using Default (random) secrets.
	 *
	 * @remarks
	 * Beginner-friendly default for privacy-focused receive.
	 * @param token Cashu token.
	 * @param config Optional parameters.
	 * @returns The proofs received from the token, using random secrets.
	 * @v3
	 */
	async receiveAsDefault(token: Token | string, config?: ReceiveConfig): Promise<Proof[]> {
		const outputType: OutputType = { type: 'random' }; // Pure default: no splits/proofs
		return this.receive(token, outputType, config);
	}

	/**
	 * Receives a cashu token and returns proofs using Deterministic secrets.
	 *
	 * @remarks
	 * Beginner-friendly for receiving recoverable proofs. Requires wallet seed.
	 * @param token Cashu token.
	 * @param counter Starting counter for deterministic secrets.
	 * @param splitAmounts Optional custom amounts for splitting outputs.
	 * @param proofsWeHave Optional proofs for optimizing denomination splitting.
	 * @param config Optional parameters.
	 * @returns The proofs received from the token, using deterministic secrets.
	 * @v3
	 */
	async receiveAsDeterministic(
		token: Token | string,
		counter: number,
		splitAmounts?: number[],
		proofsWeHave?: Proof[],
		config?: ReceiveConfig,
	): Promise<Proof[]> {
		const outputType: OutputType = {
			type: 'deterministic',
			counter,
			splitAmounts,
			proofsWeHave,
		};
		return this.receive(token, outputType, config);
	}

	/**
	 * Receives a cashu token and returns P2PK-locked proofs.
	 *
	 * @param token Cashu token.
	 * @param options P2PK locking options (e.g., pubkey, locktime).
	 * @param splitAmounts Optional custom amounts for splitting outputs.
	 * @param proofsWeHave Optional proofs for optimizing denomination splitting.
	 * @param config Optional parameters.
	 * @returns The proofs received from the token, P2PK-locked.
	 * @v3
	 */
	async receiveAsP2PK(
		token: Token | string,
		options: P2PKOptions,
		splitAmounts?: number[],
		proofsWeHave?: Proof[],
		config?: ReceiveConfig,
	): Promise<Proof[]> {
		const outputType: OutputType = {
			type: 'p2pk',
			options,
			splitAmounts,
			proofsWeHave,
		};
		return this.receive(token, outputType, config);
	}

	/**
	 * Receives a cashu token and returns proofs using factory-generated secrets.
	 *
	 * @param token Cashu token.
	 * @param factory Output data factory.
	 * @param splitAmounts Optional custom amounts for splitting outputs.
	 * @param proofsWeHave Optional proofs for optimizing denomination splitting.
	 * @param config Optional parameters.
	 * @returns The proofs received from the token, using factory-generated secrets.
	 * @v3
	 */
	async receiveAsFactory(
		token: Token | string,
		factory: OutputDataFactory,
		splitAmounts?: number[],
		proofsWeHave?: Proof[],
		config?: ReceiveConfig,
	): Promise<Proof[]> {
		const outputType: OutputType = {
			type: 'factory',
			factory,
			splitAmounts,
			proofsWeHave,
		};
		return this.receive(token, outputType, config);
	}

	/**
	 * Receives a cashu token and returns proofs using custom secrets This is a convenience method -
	 *
	 * @param token Cashu token.
	 * @param config Optional parameters.
	 * @returns The proofs received from the token, using custom secrets.
	 * @see receive()
	 */
	async receiveAsCustom(
		token: Token | string,
		data: OutputData[],
		config?: ReceiveConfig,
	): Promise<Proof[]> {
		const outputType: OutputType = {
			type: 'custom',
			data,
		};
		return this.receive(token, outputType, config);
	}

	/**
	 * Receives a cashu token and returns proofs that sum up to the amount of the token minus fees.
	 *
	 * @remarks
	 * For common cases, use `receiveAs...` helpers (eg receiveAsDefault, receiveAsP2PK etc).
	 * @param token Cashu token.
	 * @param config Optional parameters for configuring the Receive operation.
	 * @returns The proofs received from the token.
	 */
	async receive(
		token: Token | string,
		outputType: OutputType = DEFAULT_OUTPUT,
		config?: {
			privkey?: string;
			requireDleq?: boolean;
			keysetId?: string;
		},
	): Promise<Proof[]> {
		const keysets = this.keyChain.getKeySets();
		const decodedToken = typeof token === 'string' ? getDecodedToken(token, keysets) : token;
		if (decodedToken.mint !== this.mint.mintUrl) {
			const message = 'Token belongs to a different mint';
			this._logger.error(message);
			throw new Error(message);
		}
		const { proofs } = decodedToken;
		const totalAmount = sumProofs(proofs);
		if (totalAmount === 0) {
			return [];
		}
		const keys = this.keyChain.getKeys(config?.keysetId);
		if (config?.requireDleq && proofs.some((p) => !hasValidDleq(p, keys))) {
			const message = 'Token contains proofs with invalid or missing DLEQ';
			this._logger.error(message);
			throw new Error(message);
		}
		const netAmount = totalAmount - this.getFeesForProofs(proofs);
		const outputs = this.configureOutputs(
			netAmount,
			keys,
			outputType,
			false, // includeFees is not applicable for receive
		);
		const swapTransaction = this.createSwapTransaction(proofs, outputs, [], config?.privkey);
		const { signatures } = await this.mint.swap(swapTransaction.payload);
		const proofsReceived = swapTransaction.outputData.map((d, i) => d.toProof(signatures[i], keys));
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
	 * The default config uses exact match selection, and does not includeFees or requireDleq. P2PK
	 * locked proofs can be signed (witnessed) with the privkey option. Because the send is offline,
	 * the user will unlock the signed proofs when they they receive them online.
	 * @param amount Amount to send.
	 * @param proofs Array of proofs (must sum >= amount).
	 * @param config Optional parameters for the send.
	 * @returns SendResponse with keep/send proofs.
	 * @throws Throws if the send cannot be completed offline.
	 */
	sendOffline(
		amount: number,
		proofs: Proof[],
		config?: {
			privkey?: string;
			requireDleq?: boolean;
			includeFees?: boolean;
			exactMatch?: boolean;
		},
	): SendResponse {
		const { privkey, requireDleq = false, includeFees = false, exactMatch = true } = config || {};
		if (requireDleq) {
			// Only use proofs that have a DLEQ
			proofs = proofs.filter((p: Proof) => p.dleq != undefined);
		}
		if (sumProofs(proofs) < amount) {
			const message = 'Not enough funds available to send';
			this._logger.error(message);
			throw new Error(message);
		}
		const { keep, send } = this.selectProofsToSend(proofs, amount, includeFees, exactMatch);
		// Sign P2PK proofs if needed and ensure witnesses are serialized
		const sendSigned = this.prepareInputs(send, privkey);
		return { keep, send: sendSigned };
	}

	/**
	 * Sends proofs using Default (random) secrets for both send and keep outputs.
	 *
	 * @remarks
	 * Beginner-friendly default for privacy-focused sends. Uses random blinding to avoid linkability.
	 * @param amount Amount to send.
	 * @param proofs Proofs to split (sum >= amount).
	 * @param config Optional parameters (e.g. includeFees).
	 * @returns SendResponse with keep/send proofs.
	 */
	async sendAsDefault(amount: number, proofs: Proof[], config?: SendConfig): Promise<SendResponse> {
		return this.send(amount, proofs, { send: DEFAULT_OUTPUT }, config);
	}

	/**
	 * Sends proofs using deterministic secrets for both send and keep outputs, with auto-offset
	 * counters.
	 *
	 * @remarks
	 * Beginner-friendly for recoverable sends. Requires wallet seed. The keep counter is
	 * automatically offset to account for send outputs, so a single counter can be used.
	 * @param amount Amount to send.
	 * @param proofs Proofs to split (sum >= amount).
	 * @param counter Starting counter for deterministic secrets.
	 * @param config Optional parameters (e.g. includeFees).
	 * @returns SendResponse with keep/send proofs.
	 */
	async sendAsDeterministic(
		amount: number,
		proofs: Proof[],
		counter: number,
		config?: SendConfig,
	): Promise<SendResponse> {
		return this.send(
			amount,
			proofs,
			{
				send: { type: 'deterministic', counter },
				keep: { type: 'deterministic', counter },
			},
			config,
		);
	}

	/**
	 * Sends P2PK-locked proofs.
	 *
	 * @remarks
	 * Beginner-friendly for secure sends (e.g. locked to pubkey). Uses NUT-11 options for locking.
	 * Change proofs will be deterministic if a counter is provided, random otherwise.
	 * @param amount Amount to send.
	 * @param proofs Proofs to split (sum >= amount).
	 * @param p2pkOptions P2PK locking options (e.g. pubkey, locktime).
	 * @param config Optional parameters (e.g. includeFees).
	 * @returns SendResponse with keep/send proofs.
	 */
	async sendAsP2PK(
		amount: number,
		proofs: Proof[],
		p2pkOptions: P2PKOptions,
		counter?: number,
		config?: SendConfig,
	): Promise<SendResponse> {
		const keepOutput: OutputType = counter ? { type: 'deterministic', counter } : DEFAULT_OUTPUT;
		return this.send(
			amount,
			proofs,
			{ send: { type: 'p2pk', options: p2pkOptions }, keep: keepOutput },
			config,
		);
	}

	/**
	 * Sends proofs with P2PK-locked change (keep) outputs (random for send).
	 *
	 * @remarks
	 * For secure storage of change proofs. Uses NUT-11 options for keep locking.
	 * @param amount Amount to send.
	 * @param proofs Proofs to split (sum >= amount).
	 * @param p2pkOptions P2PK locking options for keep.
	 * @param config Optional parameters (e.g. includeFees).
	 * @returns SendResponse with keep/send proofs.
	 */
	async sendWithP2PKChange(
		amount: number,
		proofs: Proof[],
		p2pkOptions: P2PKOptions,
		config?: SendConfig,
	): Promise<SendResponse> {
		return this.send(
			amount,
			proofs,
			{ send: DEFAULT_OUTPUT, keep: { type: 'p2pk', options: p2pkOptions } },
			config,
		);
	}

	/**
	 * Splits and creates sendable tokens.
	 *
	 * @remarks
	 * This method performs an online swap if necessary. The `outputConfig` defaults to
	 * `DEFAULT_OUTPUT_CONFIG`, which uses random blinding factors for both `send` and `keep` outputs.
	 * For common cases, use `sendAs...` helpers (eg sendAsDefault, sendAsP2PK etc).
	 * @example
	 *
	 * ```typescript
	 * // Simple send (uses DEFAULT_OUTPUT_CONFIG)
	 * const result = await wallet.send(5, proofs);
	 *
	 * // Use default output configuration
	 * const result = await wallet.send(5, proofs, undefined, { includeFees: true });
	 *
	 * // Or explicitly use DEFAULT_OUTPUT_CONFIG
	 * const result = await wallet.send(5, proofs, DEFAULT_OUTPUT_CONFIG, { includeFees: true });
	 *
	 * // Custom output configuration
	 * const customConfig: OutputConfig = {
	 * 	send: { type: 'p2pk', options: { pubkey: '...' } },
	 * 	keep: { type: 'deterministic', counter: 0 },
	 * };
	 * const customResult = await wallet.send(5, proofs, customConfig);
	 * ```
	 *
	 * @param amount Amount to send (receiver gets this net amount).
	 * @param proofs Array of proofs to split.
	 * @param outputConfig Configuration for send and keep (change) outputs.
	 * @param config Optional parameters for the swap.
	 * @returns SendResponse with keep/send proofs.
	 * @throws Throws if the send cannot be completed offline or if funds are insufficient.
	 */
	async send(
		amount: number,
		proofs: Proof[],
		outputConfig: OutputConfig = DEFAULT_OUTPUT_CONFIG,
		config?: {
			privkey?: string;
			keysetId?: string;
			includeFees?: boolean;
		},
	): Promise<SendResponse> {
		const { privkey, keysetId, includeFees = false } = config || {};
		// First, let's see if we can avoid a swap (and fees)
		// by trying an exact match offline selection, including fees if
		// we are giving the receiver the amount + their fee to receive
		try {
			if (
				!deepEqual(outputConfig.send, DEFAULT_OUTPUT) ||
				(outputConfig.keep && !deepEqual(outputConfig.keep, DEFAULT_OUTPUT)) ||
				keysetId
			) {
				// Trigger swap only if non-default configs or custom keyset are used
				const issues = [
					!deepEqual<OutputType>(outputConfig.send, DEFAULT_OUTPUT) &&
						'non-default send outputConfig',
					outputConfig.keep &&
						!deepEqual(outputConfig.keep, DEFAULT_OUTPUT) &&
						'non-default keep outputConfig',
					keysetId && 'keysetId',
				]
					.filter(Boolean)
					.join(', ');
				throw new Error(`Options require a swap: ${issues}`);
			}
			const { keep, send } = this.sendOffline(amount, proofs, {
				privkey,
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
		const keys = this.keyChain.getKeys(keysetId);

		// Shape SEND output type and create outputs
		// Note: proofsWeHave is not valid for send outputs (optimization is for keep only)
		let sendType: OutputType = outputConfig.send ?? DEFAULT_OUTPUT;
		if ('custom' != sendType.type && sendType.proofsWeHave) {
			sendType = { ...sendType, proofsWeHave: undefined };
		}
		const sendOutputs = this.configureOutputs(amount, keys, sendType, includeFees);
		const sendTarget = OutputData.sumOutputAmounts(sendOutputs);

		// Select the subset of proofs needed to cover the swap (sendTarget + swap fee)
		const { keep: unselectedProofs, send: selectedProofs } = this.selectProofsToSend(
			proofs,
			sendTarget,
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
		const changeAmount = selectedSum - swapFee - sendTarget;
		if (changeAmount < 0) {
			const message = 'Not enough funds available for swap';
			this._logger.error(message, {
				selectedSum,
				swapFee,
				sendTarget,
				changeAmount,
			});
			throw new Error(message);
		}

		// Shape KEEP (change) output type and create outputs.
		// Note: no includeFees, as we are the receiver
		let keepType = outputConfig.keep ?? DEFAULT_OUTPUT;
		if (keepType.type === 'deterministic' && sendType.type === 'deterministic') {
			const oldKeepCounter = keepType.counter;
			keepType = { ...keepType, counter: keepType.counter + sendOutputs.length };
			this._logger.info('Auto-offsetting keep counter by send outputs length to avoid overlap', {
				oldKeepCounter: oldKeepCounter,
				sendLength: sendOutputs.length,
				newKeepCounter: keepType.counter,
			});
		}
		const keepOutputs = this.configureOutputs(changeAmount, keys, keepType, false);

		// Execute swap
		const swapTransaction = this.createSwapTransaction(
			selectedProofs,
			keepOutputs,
			sendOutputs,
			privkey,
		);
		const { signatures } = await this.mint.swap(swapTransaction.payload);

		// Construct proofs
		const swapProofs = swapTransaction.outputData.map((d, i) => d.toProof(signatures[i], keys));
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
					if (rightIndex === null) {
						const message = 'Unexpected null rightIndex in binary search';
						this._logger.error(message);
						throw new Error(message);
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
					const message = 'Proof selection took too long. Try again with a smaller proof set.';
					this._logger.error(message);
					throw new Error(message);
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
	private getProofFeePPK(proof: Proof): number {
		try {
			return this.keyChain.getKeyset(proof.id).fee;
		} catch (e) {
			const message = `Could not get fee. No keyset found for keyset id: ${proof.id}`;
			this._logger.error(message, { e, keychain: this.keyChain.getKeysetList() });
			throw new Error(message);
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
			const message = `No keyset found with ID ${keysetId}`;
			this._logger.error(message, { e });
			throw new Error(message);
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
		options?: RestoreOptions,
	): Promise<{ proofs: Proof[]; lastCounterWithSignature?: number }> {
		const { keysetId } = options || {};
		const keys = this.keyChain.getKeys(keysetId);
		if (!this._seed) {
			const message = 'CashuWallet must be initialized with a seed to use restore';
			this._logger.error(message);
			throw new Error(message);
		}
		// create blank amounts for unknown restore amounts
		const amounts = Array(count).fill(1);
		const outputData = OutputData.createDeterministicData(
			amounts.length,
			this._seed,
			start,
			keys,
			amounts,
		);

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
		if (!supported) {
			const message = 'Mint does not support NUT-20';
			this._logger.error(message);
			throw new Error(message);
		}
		const mintQuotePayload: MintQuotePayload = {
			unit: this._unit,
			amount: amount,
			description: description,
			pubkey: pubkey,
		};
		const res = await this.mint.createMintQuote(mintQuotePayload);
		if (typeof res.pubkey !== 'string') {
			const message = 'Mint returned unlocked mint quote';
			this._logger.error(message);
			throw new Error(message);
		} else {
			const pubkey = res.pubkey;
			return { ...res, pubkey, amount: res.amount || amount, unit: res.unit || this._unit };
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
		const mintInfo = this.getMintInfo();
		if (options?.description && !mintInfo.supportsBolt12Description) {
			const message = 'Mint does not support description for bolt12';
			this._logger.error(message);
			throw new Error(message);
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
	 * Mint proofs for a bolt11 quote for a given mint quote.
	 *
	 * @remarks
	 * For common cases, use `mintProofsAs...` helpers (eg mintProofsAsDefault, mintProofsAsP2PK etc).
	 * @param amount Amount to mint.
	 * @param quote Mint quote ID or object (bolt11/bolt12).
	 * @param outputType Configuration for proof generation. Defaults to 'random'.
	 * @param config Optional parameters (e.g. privkey for locked quotes).
	 * @returns Minted proofs.
	 */
	async mintProofs(
		amount: number,
		quote: string | MintQuoteResponse,
		outputType: OutputType = DEFAULT_OUTPUT,
		config?: MintProofsConfig,
	): Promise<Proof[]> {
		return this._mintProofs('bolt11', amount, quote, outputType, config);
	}

	/**
	 * Mints proofs for a bolt11 quote using default (random) secrets.
	 *
	 * @remarks
	 * Beginner-friendly default for privacy-focused bolt11 minting.
	 * @param amount Amount to mint.
	 * @param quote Mint quote ID or object.
	 * @param config Optional parameters (e.g. privkey, splitAmounts, proofsWeHave).
	 * @returns Minted proofs.
	 */
	async mintProofsAsDefault(
		amount: number,
		quote: string | MintQuoteResponse,
		config?: MintProofsConfig,
	): Promise<Proof[]> {
		return this.mintProofs(amount, quote, DEFAULT_OUTPUT, config);
	}

	/**
	 * Mints proofs for a bolt11 quote using deterministic secrets.
	 *
	 * @remarks
	 * Beginner-friendly for recoverable bolt11 proof minting. Requires wallet seed.
	 * @param amount Amount to mint.
	 * @param quote Mint quote ID or object.
	 * @param counter Starting counter for deterministic secrets.
	 * @param splitAmounts Optional custom amounts for splitting outputs.
	 * @param proofsWeHave Optional proofs for optimizing denomination splitting.
	 * @param config Optional parameters (e.g. privkey, splitAmounts, proofsWeHave).
	 * @returns Minted proofs.
	 */
	async mintProofsAsDeterministic(
		amount: number,
		quote: string | MintQuoteResponse,
		counter: number,
		splitAmounts?: number[],
		proofsWeHave?: Proof[],
		config?: MintProofsConfig,
	): Promise<Proof[]> {
		const effectiveOutputType: OutputType = {
			type: 'deterministic',
			counter,
			splitAmounts,
			proofsWeHave,
		};
		return this.mintProofs(amount, quote, effectiveOutputType, config);
	}

	/**
	 * Mints proofs for a bolt11 quote using P2PK-locked secrets.
	 *
	 * @remarks
	 * Beginner-friendly for secure minting (e.g. locked to pubkey).
	 * @param amount Amount to mint.
	 * @param quote Mint quote ID or object.
	 * @param p2pkOptions P2PK locking options (e.g. pubkey, locktime).
	 * @param splitAmounts Optional custom amounts for splitting outputs.
	 * @param proofsWeHave Optional proofs for optimizing denomination splitting.
	 * @param config Optional parameters (e.g. privkey, splitAmounts, proofsWeHave).
	 * @returns Minted proofs.
	 */
	async mintProofsAsP2PK(
		amount: number,
		quote: string | MintQuoteResponse,
		p2pkOptions: P2PKOptions,
		splitAmounts?: number[],
		proofsWeHave?: Proof[],
		config?: MintProofsConfig,
	): Promise<Proof[]> {
		const effectiveOutputType: OutputType = {
			type: 'p2pk',
			options: p2pkOptions,
			splitAmounts,
			proofsWeHave,
		};
		return this.mintProofs(amount, quote, effectiveOutputType, config);
	}

	/**
	 * Mints proofs for a bolt12 quote using specified output configuration.
	 *
	 * @param amount Amount to mint.
	 * @param quote Bolt12 mint quote.
	 * @param privkey Private key to unlock the quote.
	 * @param outputType Configuration for proof generation. Defaults to random.
	 * @param config Optional parameters (e.g. keysetId).
	 * @returns Minted proofs.
	 */
	async mintProofsBolt12(
		amount: number,
		quote: Bolt12MintQuoteResponse,
		privkey: string,
		outputType: OutputType = DEFAULT_OUTPUT,
		config?: { keysetId?: string },
	): Promise<Proof[]> {
		return this._mintProofs('bolt12', amount, quote, outputType, { ...config, privkey });
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
		if (!supported) {
			const message = 'Mint does not support NUT-15';
			this._logger.error(message);
			throw new Error(message);
		}
		if (!params?.some((p) => p.method === 'bolt11' && p.unit === this._unit)) {
			const message = `Mint does not support MPP for bolt11 and ${this._unit}`;
			this._logger.error(message);
			throw new Error(message);
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
	 * Melt proofs for a bolt11 melt quote, returns change proofs using using Default (random)
	 * secrets.
	 *
	 * @remarks
	 * Beginner-friendly default for privacy-focused melting.
	 * @param meltQuote ID of the melt quote.
	 * @param proofsToSend Proofs to melt.
	 * @param config Optional parameters.
	 * @returns MeltProofsResponse with quote and change proofs.
	 */
	async meltProofsAsDefault(
		meltQuote: MeltQuoteResponse,
		proofsToSend: Proof[],
		config?: MeltProofsConfig,
	): Promise<MeltProofsResponse> {
		return this.meltProofs(meltQuote, proofsToSend, DEFAULT_OUTPUT, config);
	}

	/**
	 * Melt proofs for a bolt11 melt quote, returns change proofs using deterministic secrets.
	 *
	 * @remarks
	 * Beginner-friendly for receiving recoverable change proofs. Requires wallet seed.
	 * @param meltQuote ID of the melt quote.
	 * @param proofsToSend Proofs to melt.
	 * @param counter Starting counter for deterministic secrets.
	 * @param config Optional parameters.
	 * @returns MeltProofsResponse with quote and change proofs.
	 */
	async meltProofsAsDeterministic(
		meltQuote: MeltQuoteResponse,
		proofsToSend: Proof[],
		counter: number,
		config?: MeltProofsConfig,
	): Promise<MeltProofsResponse> {
		return this.meltProofs(meltQuote, proofsToSend, { type: 'deterministic', counter }, config);
	}

	/**
	 * Melt proofs for a bolt11 melt quote, returns change proofs using specified outputType.
	 *
	 * @remarks
	 * ProofsToSend must be at least amount+fee_reserve frorm the melt quote. This function does not
	 * perform coin selection!.
	 * @param meltQuote ID of the melt quote.
	 * @param proofsToSend Proofs to melt.
	 * @param outputType Proof generation config (random, deterministic, p2pk, etc.).
	 * @param config Optional parameters.
	 * @returns MeltProofsResponse with quote and change proofs.
	 */
	async meltProofs(
		meltQuote: MeltQuoteResponse,
		proofsToSend: Proof[],
		outputType: OutputType = DEFAULT_OUTPUT,
		config?: MeltProofsConfig,
	): Promise<MeltProofsResponse> {
		return this._meltProofs('bolt11', meltQuote, proofsToSend, outputType, config);
	}

	/**
	 * Melt proofs for a bolt12 melt quote, returns change proofs using specified outputType.
	 *
	 * @remarks
	 * ProofsToSend must be at least amount+fee_reserve frorm the melt quote. This function does not
	 * perform coin selection!.
	 * @param meltQuote ID of the melt quote.
	 * @param proofsToSend Proofs to melt.
	 * @param outputType Proof generation config (random, deterministic, p2pk, etc.).
	 * @param config Optional parameters.
	 * @returns MeltProofsResponse with quote and change proofs.
	 */
	async meltProofsBolt12(
		meltQuote: Bolt12MeltQuoteResponse,
		proofsToSend: Proof[],
		outputType: OutputType = DEFAULT_OUTPUT,
		config?: MeltProofsConfig,
	): Promise<{
		quote: Bolt12MeltQuoteResponse;
		change: Proof[];
	}> {
		return this._meltProofs('bolt12', meltQuote, proofsToSend, outputType, config);
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
					const message = 'Could not find state for proof with Y: ' + YsSlice[j];
					this._logger.error(message);
					throw new Error(message);
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
			const message = 'failed to establish WebSocket connection.';
			this._logger.error(message);
			throw new Error(message);
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
			const message = 'failed to establish WebSocket connection.';
			this._logger.error(message);
			throw new Error(message);
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
			const message = 'failed to establish WebSocket connection.';
			this._logger.error(message);
			throw new Error(message);
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
	 * Internal helper for minting proofs with bolt11 or bolt12.
	 *
	 * @remarks
	 * Handles blinded messages, signatures, and proof construction. Use public methods like
	 * mintProofs or helpers for API access.
	 * @param method 'bolt11' or 'bolt12'.
	 * @param amount Amount to mint (must be positive).
	 * @param quote Quote ID or object.
	 * @param outputType Proof generation config (random, deterministic, p2pk, etc.).
	 * @param config Optional (privkey, keysetId).
	 * @returns Minted proofs.
	 * @throws If params are invalid or mint returns errors.
	 */
	private async _mintProofs<T extends 'bolt11' | 'bolt12'>(
		method: T,
		amount: number,
		quote: string | (T extends 'bolt11' ? MintQuoteResponse : Bolt12MintQuoteResponse),
		outputType: OutputType = DEFAULT_OUTPUT,
		config?: { privkey?: string; keysetId?: string },
	): Promise<Proof[]> {
		const { privkey, keysetId } = config ?? {};
		if (amount <= 0) {
			this._logger.warn('Invalid mint amount: must be positive', { amount });
			throw new Error('Amount must be positive');
		}
		const keyset = this.keyChain.getKeys(keysetId);
		const outputs = this.configureOutputs(amount, keyset, outputType, false); // No includeFees for mint
		const blindedMessages = outputs.map((d) => d.blindedMessage);
		let mintPayload: MintPayload;
		if (typeof quote === 'string') {
			mintPayload = {
				outputs: blindedMessages,
				quote: quote,
			};
		} else {
			if (!privkey) {
				const message = 'Can not sign locked quote without private key';
				this._logger.error(message);
				throw new Error(message);
			}
			const mintQuoteSignature = signMintQuote(privkey, quote.quote, blindedMessages);
			mintPayload = {
				outputs: blindedMessages,
				quote: quote.quote,
				signature: mintQuoteSignature,
			};
		}
		let signatures;
		if (method === 'bolt12') {
			({ signatures } = await this.mint.mintBolt12(mintPayload));
		} else {
			({ signatures } = await this.mint.mint(mintPayload));
		}
		if (signatures.length !== outputs.length) {
			const message = `Mint returned ${signatures.length} signatures, expected ${outputs.length}`;
			this._logger.error(message);
			throw new Error(message);
		}
		this._logger.debug('MINT COMPLETED', { amounts: outputs.map((o) => o.blindedMessage.amount) });
		return outputs.map((d, i) => d.toProof(signatures[i], keyset));
	}

	/**
	 * Melt proofs for a given melt quote created with the bolt11 or bolt12 method.
	 *
	 * @remarks
	 * Creates NUT-08 blanks (1-sat) for Lightning fee return.
	 * @param method Payment method of the quote.
	 * @param meltQuote The bolt11 or bolt12 melt quote.
	 * @param proofsToSend Proofs to melt.
	 * @param outputType Proof generation config (random, deterministic, p2pk, etc.).
	 * @param config Optional (privkey, keysetId).
	 * @returns Minted proofs.
	 * @throws If params are invalid or mint returns errors.
	 * @see https://github.com/cashubtc/nuts/blob/main/08.md.
	 */
	private async _meltProofs<T extends 'bolt11' | 'bolt12'>(
		method: T,
		meltQuote: T extends 'bolt11' ? MeltQuoteResponse : Bolt12MeltQuoteResponse,
		proofsToSend: Proof[],
		outputType: OutputType = DEFAULT_OUTPUT,
		config?: MeltProofsConfig,
	): Promise<MeltProofsResponse> {
		const { keysetId, privkey } = config || {};
		const keys = this.keyChain.getKeys(keysetId);
		const feeReserve = sumProofs(proofsToSend) - meltQuote.amount;
		let outputData: OutputDataLike[] = [];

		// Create NUT-08 blanks for return of Lightning fee change
		if (feeReserve > 0) {
			let count = Math.ceil(Math.log2(feeReserve)) || 1;
			if (count < 0) count = 0; // Prevents: -Infinity
			const splitAmounts: number[] = count ? new Array<number>(count).fill(1) : [];
			const changeAmount = splitAmounts.reduce((sum, a) => sum + a, 0);
			this._logger.debug('Creating NUT-08 blanks for fee reserve', {
				feeReserve,
				changeAmount,
				splitAmounts,
			});

			// Build effective OutputType and merge splitAmounts
			if (outputType.type === 'custom') {
				const message =
					'Custom OutputType not supported for melt change (must enforce 1-sat blanks)';
				this._logger.error(message);
				throw new Error(message);
			}
			const effectiveOutputType = {
				...outputType,
				splitAmounts, // Our 1-sat blanks
				proofsWeHave: undefined, // No optimization for change
			};

			// Generate the blank outputs
			outputData = this.configureOutputs(changeAmount, keys, effectiveOutputType, false);
		}

		// Sign P2PK proofs and prepare proofs for mint
		proofsToSend = this.prepareInputs(proofsToSend, privkey);

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
		const change = meltResponse.change?.map((s, i) => outputData[i].toProof(s, keys)) ?? [];
		this._logger.debug('MELT COMPLETED', { changeAmounts: change.map((p) => p.amount) });
		return { quote: { ...meltResponse, unit: meltQuote.unit, request: meltQuote.request }, change };
	}
}

export { Wallet };
