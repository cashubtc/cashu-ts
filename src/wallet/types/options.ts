// src/wallet/types/options.ts
import type { OutputDataFactory, OutputDataLike } from '../../model/OutputData';
import type { Proof } from '../../model/types';

export type OutputAmounts = {
	sendAmounts: number[];
	keepAmounts?: number[];
};

export type LockedMintQuote = {
	id: string;
	privkey: string;
};

/**
 * Options for processing received tokens.
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

export type RestoreOptions = {
	keysetId?: string;
};

/**
 * Options for configuring the Mint Proofs operation.
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
 */
export type MeltProofOptions = {
	keysetId?: string;
	counter?: number;
	privkey?: string;
};

// deprecated
export type InvoiceData = {
	paymentRequest: string;
	amountInSats?: number;
	amountInMSats?: number;
	timestamp?: number;
	paymentHash?: string;
	memo?: string;
	expiry?: number;
};
