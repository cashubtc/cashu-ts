import { type SerializedBlindedMessage } from '../wallet';

/**
 * Cashu api error.
 */
export type ApiError = {
	/**
	 * Error message.
	 */
	error?: string;
	/**
	 * HTTP error code.
	 */
	code?: number;
	/**
	 * Detailed error message.
	 */
	detail?: string;
};

/**
 * Entries of CheckStateResponse with state of the proof.
 */
export type ProofState = {
	Y: string;
	state: CheckStateEnum;
	witness: string | null;
};

/**
 * Enum for the state of a proof.
 */
export const CheckStateEnum = {
	UNSPENT: 'UNSPENT',
	PENDING: 'PENDING',
	SPENT: 'SPENT',
} as const;
export type CheckStateEnum = (typeof CheckStateEnum)[keyof typeof CheckStateEnum];

/**
 * Response when checking proofs if they are spendable. Should not rely on this for receiving, since
 * it can be easily cheated.
 */
export type CheckStateResponse = {
	states: ProofState[];
} & ApiError;

/**
 * Response from mint at /info endpoint.
 */
export type GetInfoResponse = {
	name: string;
	pubkey: string;
	version: string;
	description?: string;
	description_long?: string;
	icon_url?: string;
	contact: MintContactInfo[];
	nuts: {
		'4': {
			// Minting
			methods: SwapMethod[];
			disabled: boolean;
		};
		'5': {
			// Melting
			methods: SwapMethod[];
			disabled: boolean;
		};
		'7'?: {
			// Token state check
			supported: boolean;
		};
		'8'?: {
			// Overpaid melt fees
			supported: boolean;
		};
		'9'?: {
			// Restore
			supported: boolean;
		};
		'10'?: {
			// Spending conditions
			supported: boolean;
		};
		'11'?: {
			// P2PK
			supported: boolean;
		};
		'12'?: {
			// DLEQ
			supported: boolean;
		};
		'14'?: {
			// HTLCs
			supported: boolean;
		};
		'15'?: {
			// MPP
			methods: MPPMethod[];
		};
		'17'?: {
			// WebSockets
			supported: WebSocketSupport[];
		};
		'20'?: {
			// Locked Mint Quote
			supported: boolean;
		};
		'22'?: {
			// Blind Authentication
			bat_max_mint: number;
			protected_endpoints: Array<{ method: 'GET' | 'POST'; path: string }>;
		};
		'25'?: {
			// Compact Nut Filters
			supported: boolean;
		};
	};
	motd?: string;
};

/**
 * Response from the mint after requesting a melt quote.
 */
export type PartialMeltQuoteResponse = {
	/**
	 * Quote ID.
	 */
	quote: string;
	/**
	 * Amount to be melted.
	 */
	amount: number;
	/**
	 * Fee reserve to be added to the amount.
	 */
	fee_reserve: number;
	/**
	 * State of the melt quote.
	 */
	state: MeltQuoteState;
	/**
	 * Timestamp of when the quote expires.
	 */
	expiry: number;
	/**
	 * Preimage of the paid invoice. is null if it the invoice has not been paid yet. can be null,
	 * depending on which LN-backend the mint uses.
	 */
	payment_preimage: string | null;
	/**
	 * Return/Change from overpaid fees. This happens due to Lighting fee estimation being inaccurate.
	 */
	change?: SerializedBlindedSignature[];
	/**
	 * Payment request for the melt quote.
	 */
	request?: string;
	/**
	 * Unit of the melt quote.
	 */
	unit?: string;
} & ApiError;

export type MeltQuoteResponse = PartialMeltQuoteResponse & { request: string; unit: string };

export const MeltQuoteState = {
	UNPAID: 'UNPAID',
	PENDING: 'PENDING',
	PAID: 'PAID',
} as const;
export type MeltQuoteState = (typeof MeltQuoteState)[keyof typeof MeltQuoteState];

export type MintContactInfo = {
	method: string;
	info: string;
};

export const MintQuoteState = {
	UNPAID: 'UNPAID',
	PAID: 'PAID',
	ISSUED: 'ISSUED',
} as const;
export type MintQuoteState = (typeof MintQuoteState)[keyof typeof MintQuoteState];

/**
 * Response from the mint after requesting a mint.
 */
export type PartialMintQuoteResponse = {
	/**
	 * Payment request.
	 */
	request: string;
	/**
	 * Quote ID.
	 */
	quote: string;
	/**
	 * State of the mint quote.
	 */
	state: MintQuoteState;
	/**
	 * Timestamp of when the quote expires.
	 */
	expiry: number;
	/**
	 * Public key the quote is locked to.
	 */
	pubkey?: string;
	/**
	 * Unit of the quote.
	 */
	unit?: string;
	/**
	 * Amount requested for mint quote.
	 */
	amount?: number;
} & ApiError;

export type MintQuoteResponse = PartialMintQuoteResponse & { amount: number; unit: string };

export type LockedMintQuoteResponse = MintQuoteResponse & { pubkey: string };

/**
 * Response from the mint after requesting a mint.
 */
export type MintResponse = {
	signatures: SerializedBlindedSignature[];
} & ApiError;

/**
 * Response from mint at /v1/restore endpoint.
 */
export type PostRestoreResponse = {
	outputs: SerializedBlindedMessage[];
	signatures: SerializedBlindedSignature[];
};

/*
 * Zero-Knowledge that BlindedSignature
 * was generated using a specific public key
 */
export type SerializedDLEQ = {
	s: string;
	e: string;
	r?: string;
};

/**
 * Blinded signature as it is received from the mint.
 */
export type SerializedBlindedSignature = {
	/**
	 * Keyset id for indicating which public key was used to sign the blinded message.
	 */
	id: string;
	/**
	 * Amount denominated in Satoshi.
	 */
	amount: number;
	/**
	 * Blinded signature.
	 */
	C_: string;
	/**
	 * DLEQ Proof.
	 */
	dleq?: SerializedDLEQ;
};

/**
 * Ecash to other MoE swap method, displayed in @type {GetInfoResponse}
 */
export type SwapMethod = {
	method: string;
	unit: string;
	min_amount: number;
	max_amount: number;
};

/**
 * Response from the mint after performing a split action.
 */
export type SwapResponse = {
	/**
	 * Represents the outputs after the split.
	 */
	signatures: SerializedBlindedSignature[];
} & ApiError;

/**
 * MPP supported methods.
 */
export type MPPMethod = {
	method: string;
	unit: string;
};

/**
 * WebSocket supported methods.
 */
export type WebSocketSupport = {
	method: string;
	unit: string;
	commands: string[];
};

/**
 * Response from the mint after blind auth minting.
 */
export type BlindAuthMintResponse = {
	signatures: SerializedBlindedSignature[];
} & ApiError;

/**
 * Response to a get spent filter request
 */
export type GetFilterResponse = {
	n: number;
	p?: number;
	m?: number;
	content: string;
	timestamp: number;
} & ApiError;
