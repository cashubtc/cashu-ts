import type { MeltPayload, MeltQuoteResponse, Proof } from '../model/types/index';
import { type OutputData, type OutputDataFactory, type OutputDataLike } from '../model/OutputData';
import { type Keyset } from './Keyset';

/**
 * @v3
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
 *
 * @v3
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
 * A discriminated union based on the `type` field. Experimental; may change. For production, use
 * CashuWallet's main API.
 * @example
 *
 *     // Random with custom splits
 *     const random: OutputType = { type: 'random', denominations: [1, 2, 4] };
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
 * - `keep`: Optional; defaults to random.
 *
 * @example
 *
 *     const config: OutputConfig = {
 *     	send: { type: 'random', denominations: [1, 2] },
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
 *     const custom: OutputType = { ...DEFAULT_OUTPUT, denominations: [1, 2, 4] };
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
 * Configuration for send operations.
 */
export type SendConfig = {
	keysetId?: string;
	includeFees?: boolean;
};

/**
 * @v3
 * Configuration for offline send operations.
 */
export type SendOfflineConfig = {
	requireDleq?: boolean;
	includeFees?: boolean;
	exactMatch?: boolean;
};

/**
 * @v3
 * Configuration for receive operations.
 */
export type ReceiveConfig = {
	keysetId?: string;
	privkey?: string | string[];
	requireDleq?: boolean;
	proofsWeHave?: Proof[];
};

/**
 * @v3
 * Configuration for minting operations.
 */
export type MintProofsConfig = {
	keysetId?: string;
	privkey?: string;
	proofsWeHave?: Proof[];
};

/**
 * @v3
 * Configuration for melting operations.
 */
export type MeltProofsConfig = {
	keysetId?: string;
	onChangeOutputsCreated?: (blanks: MeltBlanks) => void;
};
