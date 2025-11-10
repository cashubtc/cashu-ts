import type { Proof } from '../../model/types/proof';
import type { MeltQuoteResponse } from '../../mint/types';
import {
	type OutputData,
	type OutputDataFactory,
	type OutputDataLike,
} from '../../model/OutputData';
import type { Keyset } from '../Keyset';
import type { MeltPayload } from './payloads';
import { type OperationCounters } from '../CounterSource';

export type SecretsPolicy = 'auto' | 'deterministic' | 'random';

export type RestoreConfig = {
	keysetId?: string;
};

/**
 * Blanks for completing a melt operation asynchronously.
 */
export interface MeltBlanks<T extends MeltQuoteResponse = MeltQuoteResponse> {
	method: 'bolt11' | 'bolt12';
	payload: MeltPayload;
	outputData: OutputDataLike[];
	keyset: Keyset;
	quote: T;
}

/**
 * Shared properties for most `OutputType` variants (except 'custom').
 */
export interface SharedOutputTypeProps {
	/**
	 * Optional custom amounts for splitting outputs.
	 *
	 * @default Uses basic splitAmount if omitted.
	 */
	denominations?: number[];
}

/**
 * Configuration for generating blinded message outputs.
 *
 * @remarks
 * A discriminated union based on the `type` field.
 * @example
 *
 *     // Random with custom splits
 *     const random: OutputType = { type: 'random', denominations: [1, 2, 4] };
 *     // Deterministic
 *     const deterministic: OutputType = { type: 'deterministic', counter: 0 };
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
			 *
			 * @remarks
			 * Counter: 0 means “auto-assign from wallet’s CounterSource”. Any positive value is used as
			 * the exact starting counter without reservation. Negative values are invalid.
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
			 * Outputs count from denominations or basic split.
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
 * - `keep`: Optional; defaults to wallet defaultOutputType policy.
 *
 * @example
 *
 *     const config: OutputConfig = {
 *     	send: { type: 'random', denominations: [1, 2] },
 *     	keep: { type: 'deterministic', counter: 0 },
 *     };
 *     await wallet.send(3, proofs, config, { includeFees: true });
 */
export interface OutputConfig {
	send: OutputType;
	keep?: OutputType;
}

/**
 * Options for configuring P2PK (Pay-to-Public-Key) locked proofs according to NUT-11.
 */
export type P2PKOptions = {
	pubkey: string | string[];
	locktime?: number;
	refundKeys?: string[];
	requiredSignatures?: number;
	requiredRefundSignatures?: number;
	additionalTags?: P2PKTag[];
};

export type P2PKTag = [key: string, ...values: string[]];

export type OnCountersReserved = (info: OperationCounters) => void;

/**
 * Configuration for send operations.
 */
export type SendConfig = {
	keysetId?: string;
	includeFees?: boolean;
	proofsWeHave?: Proof[];
	onCountersReserved?: OnCountersReserved;
};

/**
 * Configuration for offline send operations.
 */
export type SendOfflineConfig = {
	requireDleq?: boolean;
	includeFees?: boolean;
	exactMatch?: boolean;
};

/**
 * Configuration for receive operations.
 */
export type ReceiveConfig = {
	keysetId?: string;
	privkey?: string | string[];
	requireDleq?: boolean;
	proofsWeHave?: Proof[];
	onCountersReserved?: OnCountersReserved;
};

/**
 * Configuration for minting operations.
 */
export type MintProofsConfig = {
	keysetId?: string;
	privkey?: string;
	proofsWeHave?: Proof[];
	onCountersReserved?: OnCountersReserved;
};

/**
 * Configuration for melting operations.
 */
export type MeltProofsConfig = {
	keysetId?: string;
	onChangeOutputsCreated?: (blanks: MeltBlanks) => void;
	onCountersReserved?: OnCountersReserved;
};
