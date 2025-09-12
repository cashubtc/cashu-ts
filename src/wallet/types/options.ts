import type { OutputDataFactory, OutputDataLike } from '../../model/OutputData';
import type { Proof } from '../../model/types';

export type RestoreOptions = {
	keysetId?: string;
};

/**
 * @v2
 */
export type OutputAmounts = {
	sendAmounts: number[];
	keepAmounts?: number[];
};

/**
 * @v2
 */
export type LockedMintQuote = {
	id: string;
	privkey: string;
};

/**
 * Options for processing received tokens.
 *
 * @v2
 */
export type ReceiveOptions = {
	keysetId?: string;
	outputAmounts?: OutputAmounts;
	proofsWeHave?: Proof[];
	counter?: number;
	pubkey?: string;
	privkey?: string;
	requireDleq?: boolean;
	outputData?: OutputDataLike[] | OutputDataFactory;
	p2pk?: {
		pubkey: string | string[];
		locktime?: number;
		refundKeys?: string[];
		requiredSignatures?: number;
		requiredRefundSignatures?: number;
	};
};

/**
 * Options for configuring the send operation.
 *
 * @v2
 */
export type SendOptions = {
	outputAmounts?: OutputAmounts;
	proofsWeHave?: Proof[];
	counter?: number;
	pubkey?: string;
	privkey?: string;
	keysetId?: string;
	offline?: boolean;
	includeFees?: boolean;
	includeDleq?: boolean;
	outputData?: {
		send?: OutputDataLike[] | OutputDataFactory;
		keep?: OutputDataLike[] | OutputDataFactory;
	};
	p2pk?: {
		pubkey: string | string[];
		locktime?: number;
		refundKeys?: string[];
		requiredSignatures?: number;
		requiredRefundSignatures?: number;
	};
};

/**
 * Options for configuring the swap operation.
 *
 * @v2
 */
export type SwapOptions = {
	outputAmounts?: OutputAmounts;
	proofsWeHave?: Proof[];
	counter?: number;
	pubkey?: string;
	privkey?: string;
	keysetId?: string;
	includeFees?: boolean;
	outputData?: {
		send?: OutputDataLike[] | OutputDataFactory;
		keep?: OutputDataLike[] | OutputDataFactory;
	};
	p2pk?: {
		pubkey: string | string[];
		locktime?: number;
		refundKeys?: string[];
		requiredSignatures?: number;
		requiredRefundSignatures?: number;
	};
};

/**
 * Options for configuring the Mint Proofs operation.
 *
 * @v2
 */
export type MintProofOptions = {
	keysetId?: string;
	outputAmounts?: OutputAmounts;
	proofsWeHave?: Proof[];
	counter?: number;
	pubkey?: string;
	outputData?: OutputDataLike[] | OutputDataFactory;
	p2pk?: {
		pubkey: string | string[];
		locktime?: number;
		refundKeys?: string[];
		requiredSignatures?: number;
		requiredRefundSignatures?: number;
	};
};

/**
 * Options for configuring the Melt Proofs operation.
 *
 * @v2
 */
export type MeltProofOptions = {
	keysetId?: string;
	counter?: number;
	privkey?: string;
};

/**
 * @deprecated
 * @v2
 */
export type InvoiceData = {
	paymentRequest: string;
	amountInSats?: number;
	amountInMSats?: number;
	timestamp?: number;
	paymentHash?: string;
	memo?: string;
	expiry?: number;
};
