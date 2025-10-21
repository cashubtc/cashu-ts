import {
	type MeltQuoteResponse,
	type MintQuoteResponse,
	type Bolt12MeltQuoteResponse,
	type Bolt12MintQuoteResponse,
} from '../mint/types';
import { type OutputData, type OutputDataFactory } from '../model/OutputData';
import type { Proof } from '../model/types/proof';
import type { Token } from '../model/types/token';
import {
	type OutputType,
	type OutputConfig,
	type SendConfig,
	type ReceiveConfig,
	type MintProofsConfig,
	type P2PKOptions,
	type OnCountersReserved,
	type MeltProofsConfig,
} from './types';
import type { Wallet } from './Wallet';

/**
 * Fluent operations builder for a Wallet instance.
 *
 * @remarks
 * Provides chainable builders for sending, receiving, and minting. Each builder is single use. If
 * you do not customise an output side, the wallet’s policy defaults apply.
 */
export class WalletOps {
	constructor(private wallet: Wallet) {}
	send(amount: number, proofs: Proof[]) {
		return new SendBuilder(this.wallet, amount, proofs);
	}
	receive(token: Token | string) {
		return new ReceiveBuilder(this.wallet, token);
	}
	mintBolt11(amount: number, quote: string | MintQuoteResponse) {
		return new MintBuilder(this.wallet, 'bolt11', amount, quote);
	}
	mintBolt12(amount: number, quote: Bolt12MintQuoteResponse) {
		return new MintBuilder(this.wallet, 'bolt12', amount, quote);
	}
	meltBolt11(quote: MeltQuoteResponse, proofs: Proof[]) {
		return new MeltBuilder(this.wallet, 'bolt11', quote, proofs);
	}
	meltBolt12(quote: Bolt12MeltQuoteResponse, proofs: Proof[]) {
		return new MeltBuilder(this.wallet, 'bolt12', quote, proofs);
	}
}

/**
 * Mixin infrastructure.
 *
 * Adds the asXXX family to a builder, always targeting a property named `outputType`.
 *
 * DX notes:
 *
 * - Compose it once per builder.
 * - No per-instance allocations, methods live on the prototype.
 * - TSDoc on these methods appears wherever the mixin is applied.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtor<TInstance extends object = object> = new (...args: any[]) => TInstance;

/**
 * Structural helper: any builder that carries the unified `outputType` slot.
 */
type HasOutputSlot = { outputType?: OutputType };

/**
 * Methods added by the mixin. Keeping doc comments here ensures IDE hovers work on every builder
 * that composes this mixin.
 */
interface OutputTypeMethods {
	/**
	 * Use random blinding for the outputs.
	 *
	 * @remarks
	 * If `denoms` are specified, any `proofsWeHave()` hint will have no effect.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asRandom(denoms?: number[]): this;

	/**
	 * Use deterministic outputs.
	 *
	 * @remarks
	 * If `denoms` are specified, any `proofsWeHave()` hint will have no effect.
	 * @param counter Starting counter. Zero means auto reserve using the wallet’s CounterSource.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asDeterministic(counter?: number, denoms?: number[]): this;

	/**
	 * Use P2PK locked outputs.
	 *
	 * @remarks
	 * If `denoms` are specified, any `proofsWeHave()` hint will have no effect.
	 * @param options NUT 11 options like pubkey and locktime.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asP2PK(options: P2PKOptions, denoms?: number[]): this;

	/**
	 * Use a factory to generate `OutputData`.
	 *
	 * @remarks
	 * If `denoms` are specified, any `proofsWeHave()` hint will have no effect.
	 * @param factory OutputDataFactory used to produce blinded messages.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asFactory(factory: OutputDataFactory, denoms?: number[]): this;

	/**
	 * Provide pre-created `OutputData`.
	 *
	 * @param data Fully formed `OutputData` for the final amount.
	 */
	asCustom(data: OutputData[]): this;
}

/**
 * Mixin that adds asXXX (asRandom/asDeterministic/etc.) to a builder. It always targets the unified
 * `outputType` slot on the builder.
 *
 * Usage: class BaseReceiveBuilder { protected outputType?: OutputType; ... } export class
 * ReceiveBuilder extends WithOutputType(BaseReceiveBuilder) {}
 */
function WithOutputType<Base extends AnyCtor<object>>(BaseCtor: Base) {
	// TS mixins must accept (...args: any[]) in ctor.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	class WithOT extends (BaseCtor as new (...args: any[]) => object) implements OutputTypeMethods {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		constructor(...args: any[]) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
			super(...args);
		}

		asRandom(denoms?: number[]) {
			(this as HasOutputSlot).outputType = { type: 'random', denominations: denoms };
			return this;
		}

		asDeterministic(counter = 0, denoms?: number[]) {
			(this as HasOutputSlot).outputType = {
				type: 'deterministic',
				counter,
				denominations: denoms,
			};
			return this;
		}

		asP2PK(options: P2PKOptions, denoms?: number[]) {
			(this as HasOutputSlot).outputType = {
				type: 'p2pk',
				options,
				denominations: denoms,
			};
			return this;
		}

		asFactory(factory: OutputDataFactory, denoms?: number[]) {
			(this as HasOutputSlot).outputType = {
				type: 'factory',
				factory,
				denominations: denoms,
			};
			return this;
		}

		asCustom(data: OutputData[]) {
			(this as HasOutputSlot).outputType = { type: 'custom', data };
			return this;
		}
	}

	// Tell TS/IDE: instances are the base builder PLUS OutputTypeMethods (with docs).
	return WithOT as new (
		...args: ConstructorParameters<Base>
	) => InstanceType<Base> & OutputTypeMethods;
}

/**
 * Builder for composing a send or swap.
 *
 * @remarks
 * If you only customise the send side, keep is omitted so the wallet may still attempt an offline
 * exact match selection where possible.
 * @example
 *
 *     const { keep, send } = await wallet.ops
 *     	.send(5, proofs)
 *     	.asDeterministic() // counter 0 means auto reserve via CounterSource
 *     	.keepAsRandom()
 *     	.includeFees(true) // sender pays receiver’s future spend fee
 *     	.run();
 */
class BaseSendBuilder {
	// Slots targeted by the mixin and keep methods
	protected outputType?: OutputType; // send-side output type (formerly sendOT)
	protected keepOT?: OutputType;

	protected config: SendConfig = {};
	protected offlineExact?: { requireDleq: boolean };
	protected offlineClose?: { requireDleq: boolean };

	constructor(
		protected wallet: Wallet,
		protected amount: number,
		protected proofs: Proof[],
	) {}

	/**
	 * Use random blinding for change outputs.
	 *
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	keepAsRandom(denoms?: number[]) {
		this.keepOT = { type: 'random', denominations: denoms };
		return this;
	}
	/**
	 * Use deterministic outputs for change.
	 *
	 * @param counter Starting counter. Zero means auto reserve using the wallet’s CounterSource.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	keepAsDeterministic(counter = 0, denoms?: number[]) {
		this.keepOT = { type: 'deterministic', counter, denominations: denoms };
		return this;
	}
	/**
	 * Use P2PK locked change (NUT 11).
	 *
	 * @param options Locking options applied to the kept proofs.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	keepAsP2PK(options: P2PKOptions, denoms?: number[]) {
		this.keepOT = { type: 'p2pk', options, denominations: denoms };
		return this;
	}
	/**
	 * Use a factory to generate OutputData for change.
	 *
	 * @param factory OutputDataFactory used to produce blinded messages.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	keepAsFactory(factory: OutputDataFactory, denoms?: number[]) {
		this.keepOT = { type: 'factory', factory, denominations: denoms };
		return this;
	}
	/**
	 * Provide pre created OutputData for change.
	 *
	 * @param data Fully formed OutputData for the keep (change) amount.
	 */
	keepAsCustom(data: OutputData[]) {
		this.keepOT = { type: 'custom', data };
		return this;
	}

	/**
	 * Make the sender cover the receiver’s future spend fee.
	 *
	 * @param on When true, include fees in the sent amount. Default true if called.
	 */
	includeFees(on = true) {
		this.config.includeFees = on;
		return this;
	}
	/**
	 * Use a specific keyset for the operation.
	 *
	 * @param id Keyset id to use for mint keys and fee lookup.
	 */
	keyset(id: string) {
		this.config.keysetId = id;
		return this;
	}
	/**
	 * Receive a callback once counters are atomically reserved for deterministic outputs.
	 *
	 * @param cb Called with OperationCounters when counters are reserved.
	 */
	onCountersReserved(cb: OnCountersReserved) {
		this.config.onCountersReserved = cb;
		return this;
	}
	/**
	 * Force a pure offline, exact match selection. No mint calls are made. If an exact match cannot
	 * be found, this throws.
	 *
	 * @param requireDleq Only consider proofs with a DLEQ when true.
	 */
	offlineExactOnly(requireDleq = false) {
		this.offlineExact = { requireDleq };
		return this;
	}

	/**
	 * Force a pure offline selection that allows a close match, overspend permitted per wallet RGLI.
	 * No mint calls are made. Returns the best offline subset found, or throws if funds are
	 * insufficient.
	 *
	 * @param requireDleq Only consider proofs with a DLEQ when true.
	 */
	offlineCloseMatch(requireDleq = false) {
		this.offlineClose = { requireDleq };
		return this;
	}

	/**
	 * Execute the send or swap.
	 *
	 * @returns The split result with kept and sent proofs.
	 */
	async run() {
		// If an offline mode is requested, forbid custom OutputTypes,
		// because offline uses existing proofs and cannot honour new outputs.
		if ((this.offlineExact || this.offlineClose) && (this.outputType || this.keepOT)) {
			throw new Error(
				'Offline selection cannot be combined with custom output types. Remove send/keep output configuration, or use an online swap.',
			);
		}

		// Strict offline, exact match only
		if (this.offlineExact) {
			return this.wallet.sendOffline(this.amount, this.proofs, {
				includeFees: this.config.includeFees,
				exactMatch: true,
				requireDleq: this.offlineExact.requireDleq,
			});
		}

		// Offline close match, may overshoot
		if (this.offlineClose) {
			return this.wallet.sendOffline(this.amount, this.proofs, {
				includeFees: this.config.includeFees,
				exactMatch: false,
				requireDleq: this.offlineClose.requireDleq,
			});
		}

		// If either side was customized, construct a full OutputConfig.
		if (this.outputType || this.keepOT) {
			const outputConfig: OutputConfig = {
				send: this.outputType ?? this.wallet.defaultOutputType(),
				...(this.keepOT ? { keep: this.keepOT } : {}),
			};
			return this.wallet.send(this.amount, this.proofs, this.config, outputConfig);
		}
		// Nothing customized: rely on wallet overload to apply policy defaults.
		return this.wallet.send(this.amount, this.proofs, this.config);
	}
}

// Compose the mixin to attach send-side asXXX methods that write into `outputType`.
export class SendBuilder extends WithOutputType(BaseSendBuilder) {}

/**
 * Builder for receiving a token.
 *
 * @remarks
 * If you do not call a type method, the wallet’s policy default is used.
 * @example
 *
 *     const proofs = await wallet.ops
 *     	.receive(token)
 *     	.asDeterministic() // counter 0 auto reserves
 *     	.requireDleq(true)
 *     	.run();
 */
class BaseReceiveBuilder {
	// Slot targeted by WithOutputType
	protected outputType?: OutputType;
	protected config: ReceiveConfig = {};

	constructor(
		protected wallet: Wallet,
		protected token: Token | string,
	) {}

	/**
	 * Use a specific keyset for the operation.
	 *
	 * @param id Keyset id to use for mint keys and fee lookup.
	 */
	keyset(id: string) {
		this.config.keysetId = id;
		return this;
	}
	/**
	 * Require all incoming proofs to have a valid DLEQ for the selected keyset.
	 *
	 * @param on When true, proofs without DLEQ are rejected.
	 */
	requireDleq(on = true) {
		this.config.requireDleq = on;
		return this;
	}
	/**
	 * Private key used to sign P2PK locked incoming proofs.
	 *
	 * @param k Single key or array of multisig keys.
	 */
	privkey(k: string | string[]) {
		this.config.privkey = k;
		return this;
	}
	/**
	 * Provide existing proofs to help optimise denomination selection.
	 *
	 * @remarks
	 * Has no effect if denominations (custom split) was specified.
	 * @param p Proofs currently held by the wallet, used to hit denomination targets.
	 */
	proofsWeHave(p: Proof[]) {
		this.config.proofsWeHave = p;
		return this;
	}
	/**
	 * Receive a callback once counters are atomically reserved for deterministic outputs.
	 *
	 * @param cb Called with OperationCounters when counters are reserved.
	 */
	onCountersReserved(cb: OnCountersReserved) {
		this.config.onCountersReserved = cb;
		return this;
	}

	async run() {
		return this.outputType
			? this.wallet.receive(this.token, this.config, this.outputType)
			: this.wallet.receive(this.token, this.config);
	}
}

// Build main class with mixin
export class ReceiveBuilder extends WithOutputType(BaseReceiveBuilder) {}

/**
 * Builder for minting proofs from a quote.
 *
 * @example
 *
 *     const proofs = await wallet.ops
 *     	.mint(100, quote)
 *     	.asDeterministic() // counter 0 auto reserves
 *     	.onCountersReserved((info) => console.log(info))
 *     	.run();
 */
class BaseMintBuilder {
	// Slot targeted by WithOutputType
	protected outputType?: OutputType;
	protected config: MintProofsConfig = {};

	// Hold the mutually exclusive quotes in separate slots for clean narrowing.
	protected quote11?: string | MintQuoteResponse;
	protected quote12?: Bolt12MintQuoteResponse;

	constructor(
		protected wallet: Wallet,
		protected method: 'bolt11' | 'bolt12',
		protected amount: number,
		quote: string | MintQuoteResponse | Bolt12MintQuoteResponse,
	) {
		if (method === 'bolt12') {
			this.quote12 = quote as Bolt12MintQuoteResponse;
		} else {
			this.quote11 = quote as string | MintQuoteResponse;
		}
	}

	/**
	 * Use a specific keyset for the operation.
	 *
	 * @param id Keyset id to use for mint keys and fee lookup.
	 */
	keyset(id: string) {
		this.config.keysetId = id;
		return this;
	}
	/**
	 * Private key to sign locked mint quotes.
	 *
	 * @param k Private key for locked quotes.
	 */
	privkey(k: string) {
		// For BOLT12, wallet API requires privkey as separate arg;
		// for BOLT11 we keep it in config if the wallet uses it for locked quotes.
		this.config.privkey = k;
		return this;
	}
	/**
	 * Provide existing proofs to help optimise denomination selection.
	 *
	 * @remarks
	 * Has no effect if denominations (custom split) was specified.
	 * @param p Proofs currently held by the wallet, used to hit denomination targets.
	 */
	proofsWeHave(p: Proof[]) {
		this.config.proofsWeHave = p;
		return this;
	}
	/**
	 * Receive a callback once counters are atomically reserved for deterministic outputs.
	 *
	 * @param cb Called with OperationCounters when counters are reserved.
	 */
	onCountersReserved(cb: OnCountersReserved) {
		this.config.onCountersReserved = cb;
		return this;
	}

	/**
	 * Execute minting against the quote.
	 *
	 * @returns The newly minted proofs.
	 */
	async run() {
		if (this.method === 'bolt12') {
			if (!this.config.privkey) {
				throw new Error('privkey is required for BOLT12 mint quotes');
			}
			// Signature: mintProofsBolt12(amount, quote, privkey, config?, outputType?)
			return this.outputType
				? this.wallet.mintProofsBolt12(
						this.amount,
						this.quote12!, // guaranteed for bolt12
						this.config.privkey,
						this.config,
						this.outputType,
					)
				: this.wallet.mintProofsBolt12(
						this.amount,
						this.quote12!, // guaranteed for bolt12
						this.config.privkey,
						this.config,
					);
		}
		// BOLT11: mintProofsBolt11(amount, quote, config?, outputType?)
		return this.outputType
			? this.wallet.mintProofsBolt11(this.amount, this.quote11!, this.config, this.outputType)
			: this.wallet.mintProofsBolt11(this.amount, this.quote11!, this.config);
	}
}

// Build main class with mixin
export class MintBuilder extends WithOutputType(BaseMintBuilder) {}

/**
 * Builder for melting proofs to pay a Lightning invoice or BOLT12 offer.
 *
 * @remarks
 * Supports both BOLT11 and BOLT12. You can optionally receive a callback when NUT-08 blanks are
 * created for async melts.
 * @example
 *
 * ```typescript
 * // Basic BOLT11 melt
 * await wallet.ops.meltBolt11(quote, proofs).run();
 *
 * // BOLT12 melt with deterministic change and NUT-08 blanks callback
 * await wallet.ops
 * 	.meltBolt12(quote12, proofs)
 * 	.asDeterministic() // counter 0 auto reserves
 * 	.onChangeOutputsCreated((blanks) => {
 * 		// Persist blanks and retry later with wallet.completeMelt(blanks)
 * 	})
 * 	.onCountersReserved((info) => console.log('Reserved', info))
 * 	.run();
 * ```
 */
class BaseMeltBuilder {
	// Slot targeted by WithOutputType
	protected outputType?: OutputType;
	protected config: MeltProofsConfig = {};

	constructor(
		protected wallet: Wallet,
		protected method: 'bolt11' | 'bolt12',
		protected quote: MeltQuoteResponse,
		protected proofs: Proof[],
	) {}

	/**
	 * Use a specific keyset for the melt operation.
	 *
	 * @param id Keyset id to use for mint keys and fee lookup.
	 */
	keyset(id: string) {
		this.config.keysetId = id;
		return this;
	}

	/**
	 * Receive a callback once counters are atomically reserved for deterministic outputs.
	 *
	 * @param cb Called with OperationCounters when counters are reserved.
	 */
	onCountersReserved(cb: OnCountersReserved) {
		this.config.onCountersReserved = cb;
		return this;
	}

	/**
	 * Receive a callback when NUT-08 blanks (0-sat change outputs) are created for async melts.
	 *
	 * @remarks
	 * You can persist these blanks and later call `wallet.completeMelt(blanks)` to finalize and
	 * recover change once the invoice/offer is paid.
	 * @param cb Callback invoked with the created blanks payload.
	 */
	onChangeOutputsCreated(cb: NonNullable<MeltProofsConfig['onChangeOutputsCreated']>) {
		this.config.onChangeOutputsCreated = cb;
		return this;
	}

	/**
	 * Execute the melt against the quote.
	 *
	 * @returns The melt result: `{ quote, change }`.
	 */
	async run() {
		if (this.method === 'bolt12') {
			return this.outputType
				? this.wallet.meltProofsBolt12(this.quote, this.proofs, this.config, this.outputType)
				: this.wallet.meltProofsBolt12(this.quote, this.proofs, this.config);
		}
		// BOLT11
		return this.outputType
			? this.wallet.meltProofsBolt11(this.quote, this.proofs, this.config, this.outputType)
			: this.wallet.meltProofsBolt11(this.quote, this.proofs, this.config);
	}
}

// Build main class with mixin
export class MeltBuilder extends WithOutputType(BaseMeltBuilder) {}
