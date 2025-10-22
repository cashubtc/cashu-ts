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
		return new MintBuilder<'bolt11'>(this.wallet, 'bolt11', amount, quote);
	}
	mintBolt12(amount: number, quote: Bolt12MintQuoteResponse) {
		return new MintBuilder<'bolt12'>(this.wallet, 'bolt12', amount, quote);
	}
	meltBolt11(quote: MeltQuoteResponse, proofs: Proof[]) {
		return new MeltBuilder(this.wallet, 'bolt11', quote, proofs);
	}
	meltBolt12(quote: Bolt12MeltQuoteResponse, proofs: Proof[]) {
		return new MeltBuilder(this.wallet, 'bolt12', quote, proofs);
	}
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
export class SendBuilder {
	private sendOT?: OutputType;
	private keepOT?: OutputType;
	private config: SendConfig = {};
	private offlineExact?: { requireDleq: boolean };
	private offlineClose?: { requireDleq: boolean };

	constructor(
		private wallet: Wallet,
		private amount: number,
		private proofs: Proof[],
	) {}

	/**
	 * Use random blinding for the sent outputs.
	 *
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asRandom(denoms?: number[]) {
		this.sendOT = { type: 'random', denominations: denoms };
		return this;
	}
	/**
	 * Use deterministic outputs for the sent proofs.
	 *
	 * @param counter Starting counter. Zero means auto reserve using the wallet’s CounterSource.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asDeterministic(counter = 0, denoms?: number[]) {
		this.sendOT = { type: 'deterministic', counter, denominations: denoms };
		return this;
	}
	/**
	 * Use P2PK locked outputs for the sent proofs.
	 *
	 * @param options NUT 11 options like pubkey and locktime.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asP2PK(options: P2PKOptions, denoms?: number[]) {
		this.sendOT = { type: 'p2pk', options, denominations: denoms };
		return this;
	}
	/**
	 * Use a factory to generate OutputData for the sent proofs.
	 *
	 * @param factory OutputDataFactory used to produce blinded messages.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asFactory(factory: OutputDataFactory, denoms?: number[]) {
		this.sendOT = { type: 'factory', factory, denominations: denoms };
		return this;
	}
	/**
	 * Provide pre created OutputData for the sent proofs.
	 *
	 * @param data Fully formed OutputData. Their amounts must sum to the send amount, otherwise the
	 *   wallet will throw.
	 */
	asCustom(data: OutputData[]) {
		this.sendOT = { type: 'custom', data };
		return this;
	}

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
		if ((this.offlineExact || this.offlineClose) && (this.sendOT || this.keepOT)) {
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

		// Construct an OutputConfig using default send if no customizations
		const outputConfig: OutputConfig = {
			send: this.sendOT ?? this.wallet.defaultOutputType(),
			...(this.keepOT ? { keep: this.keepOT } : {}),
		};
		return this.wallet.send(this.amount, this.proofs, this.config, outputConfig);
	}
}

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
export class ReceiveBuilder {
	private outputType?: OutputType;
	private config: ReceiveConfig = {};

	constructor(
		private wallet: Wallet,
		private token: Token | string,
	) {}

	/**
	 * Use random blinding for the received outputs.
	 *
	 * @remarks
	 * If denoms specified, proofsWeHave() will have no effect.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asRandom(denoms?: number[]) {
		this.outputType = { type: 'random', denominations: denoms };
		return this;
	}
	/**
	 * Use deterministic outputs for the received proofs.
	 *
	 * @remarks
	 * If denoms specified, proofsWeHave() will have no effect.
	 * @param counter Starting counter. Zero means auto reserve using the wallet’s CounterSource.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asDeterministic(counter = 0, denoms?: number[]) {
		this.outputType = { type: 'deterministic', counter, denominations: denoms };
		return this;
	}
	/**
	 * Use P2PK locked outputs for the received proofs.
	 *
	 * @remarks
	 * If denoms specified, proofsWeHave() will have no effect.
	 * @param options NUT 11 options like pubkey and locktime.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asP2PK(options: P2PKOptions, denoms?: number[]) {
		this.outputType = { type: 'p2pk', options, denominations: denoms };
		return this;
	}
	/**
	 * Use a factory to generate OutputData for received proofs.
	 *
	 * @remarks
	 * If denoms specified, proofsWeHave() will have no effect.
	 * @param factory OutputDataFactory used to produce blinded messages.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asFactory(factory: OutputDataFactory, denoms?: number[]) {
		this.outputType = { type: 'factory', factory, denominations: denoms };
		return this;
	}
	/**
	 * Provide pre created OutputData for received proofs.
	 *
	 * @param data Fully formed OutputData for the final amount.
	 */
	asCustom(data: OutputData[]) {
		this.outputType = { type: 'custom', data };
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
		return this.wallet.receive(this.token, this.config, this.outputType);
	}
}

/**
 * Builder for minting proofs from a quote.
 *
 * @remarks
 * Bolt12 requires privkey by default, bolt11 only for locked quotes. The compiler will throw an
 * error if bolt12 and privkey() is omitted: MintBuilder<"bolt12", false>' is not assignable...
 * @example
 *
 *     const proofs = await wallet.ops
 *     	.mint(100, quote)
 *     	.asDeterministic() // counter 0 auto reserves
 *     	.onCountersReserved((info) => console.log(info))
 *     	.privkey('sk')
 *     	.run();
 */
export class MintBuilder<
	M extends 'bolt11' | 'bolt12',
	HasPrivKey extends boolean = M extends 'bolt12' ? false : true,
> {
	private outputType?: OutputType;
	private config: MintProofsConfig = {};

	// phantom field to satisfy linter (erased at emit)
	private readonly _hasPrivkey!: HasPrivKey;

	constructor(
		private wallet: Wallet,
		private method: M,
		private amount: number,
		private quote: string | MintQuoteResponse | Bolt12MintQuoteResponse,
	) {
		void this._hasPrivkey; // intentionally unused (phantom field)
	}

	/**
	 * Use random blinding for the minted proofs.
	 *
	 * @remarks
	 * If denoms specified, proofsWeHave() will have no effect.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asRandom(denoms?: number[]) {
		this.outputType = { type: 'random', denominations: denoms };
		return this;
	}
	/**
	 * Use deterministic outputs for the minted proofs.
	 *
	 * @remarks
	 * If denoms specified, proofsWeHave() will have no effect.
	 * @param counter Starting counter. Zero means auto reserve using the wallet’s CounterSource.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asDeterministic(counter = 0, denoms?: number[]) {
		this.outputType = { type: 'deterministic', counter, denominations: denoms };
		return this;
	}
	/**
	 * Use P2PK locked outputs for the minted proofs.
	 *
	 * @remarks
	 * If denoms specified, proofsWeHave() will have no effect.
	 * @param options NUT 11 options like pubkey and locktime.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asP2PK(options: P2PKOptions, denoms?: number[]) {
		this.outputType = { type: 'p2pk', options, denominations: denoms };
		return this;
	}
	/**
	 * Use a factory to generate OutputData for minted proofs.
	 *
	 * @remarks
	 * If denoms specified, proofsWeHave() will have no effect.
	 * @param factory OutputDataFactory used to produce blinded messages.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asFactory(factory: OutputDataFactory, denoms?: number[]) {
		this.outputType = { type: 'factory', factory, denominations: denoms };
		return this;
	}
	/**
	 * Provide pre created OutputData for minted proofs.
	 *
	 * @param data Fully formed OutputData for the final amount.
	 */
	asCustom(data: OutputData[]) {
		this.outputType = { type: 'custom', data };
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
	 * Private key to sign locked mint quotes.
	 *
	 * @param k Private key for locked quotes.
	 */
	privkey(k: string): MintBuilder<M, true> {
		// For bolt11 - privkey is sent in the config
		// For bolt12 - privkey is sent positionally in run()
		this.config.privkey = k;
		return this as MintBuilder<M, true>;
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
	 * @remarks
	 * This method can only be called for bolt12 quotes when .privkey() is set.
	 * @returns The newly minted proofs.
	 */
	async run(this: MintBuilder<M, true>) {
		// BOLT 11
		if (this.method === 'bolt11') {
			const bolt11 = this.quote as MintQuoteResponse;
			if (bolt11.pubkey && !this.config.privkey) {
				throw new Error('privkey is required for locked BOLT11 mint quotes');
			}
			return this.wallet.mintProofsBolt11(this.amount, bolt11, this.config, this.outputType);
		}

		// BOLT 12
		const bolt12 = this.quote as Bolt12MintQuoteResponse;
		if (!this.config.privkey) {
			throw new Error('privkey is required for BOLT12 mint quotes');
		}
		return this.wallet.mintProofsBolt12(
			this.amount,
			bolt12,
			this.config.privkey,
			this.config,
			this.outputType,
		);
	}
}

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
export class MeltBuilder {
	private outputType?: OutputType;
	private config: MeltProofsConfig = {};

	constructor(
		private wallet: Wallet,
		private method: 'bolt11' | 'bolt12',
		private quote: MeltQuoteResponse,
		private proofs: Proof[],
	) {}

	/**
	 * Use random blinding for change outputs.
	 *
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asRandom(denoms?: number[]) {
		this.outputType = { type: 'random', denominations: denoms };
		return this;
	}

	/**
	 * Use deterministic outputs for change.
	 *
	 * @param counter Starting counter. Zero means auto reserve using the wallet’s CounterSource.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asDeterministic(counter = 0, denoms?: number[]) {
		this.outputType = { type: 'deterministic', counter, denominations: denoms };
		return this;
	}

	/**
	 * Use P2PK-locked change (NUT-11).
	 *
	 * @param options NUT-11 locking options (e.g., pubkey, locktime).
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asP2PK(options: P2PKOptions, denoms?: number[]) {
		this.outputType = { type: 'p2pk', options, denominations: denoms };
		return this;
	}

	/**
	 * Use a factory to generate OutputData for change.
	 *
	 * @param factory Factory used to produce blinded messages.
	 * @param denoms Optional custom split. Can be partial if you only need SOME specific amounts.
	 */
	asFactory(factory: OutputDataFactory, denoms?: number[]) {
		this.outputType = { type: 'factory', factory, denominations: denoms };
		return this;
	}

	/**
	 * Provide pre-created OutputData for change.
	 *
	 * @param data Fully formed OutputData for the change amount.
	 */
	asCustom(data: OutputData[]) {
		this.outputType = { type: 'custom', data };
		return this;
	}

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
		// BOLT11
		if (this.method === 'bolt11') {
			return this.wallet.meltProofsBolt11(this.quote, this.proofs, this.config, this.outputType);
		}

		// BOLT 12
		return this.wallet.meltProofsBolt12(this.quote, this.proofs, this.config, this.outputType);
	}
}
