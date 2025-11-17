import type {
	SerializedBlindedMessage,
	SerializedBlindedSignature,
} from '../../model/types/blinded';
import type { ProofState } from '../../model/types/proof-state';

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
		'21'?: {
			// Clear Authentication
			openid_discovery: string;
			client_id: string;
			protected_endpoints?: Array<{ method: 'GET' | 'POST'; path: string }>;
		};
		'22'?: {
			// Blind Authentication
			bat_max_mint: number;
			protected_endpoints: Array<{ method: 'GET' | 'POST'; path: string }>;
		};
	};
	motd?: string;
};

/**
 * Base melt quote response - all melt quotes have these fields (NUT-05)
 */
export type NUT05MeltQuoteResponse = {
	/**
	 * Quote ID.
	 */
	quote: string;
	/**
	 * Amount to be melted.
	 */
	amount: number;
	/**
	 * Unit of the melt quote.
	 */
	unit: string;
	/**
	 * State of the melt quote.
	 */
	state: MeltQuoteState;
	/**
	 * Timestamp of when the quote expires.
	 */
	expiry: number;
	/**
	 * Return/Change from overpaid fees. This happens due to Lighting fee estimation being inaccurate.
	 */
	change?: SerializedBlindedSignature[];
} & ApiError;

/**
 * Response from the mint after requesting a melt quote.
 *
 * @deprecated - Use MeltQuoteBolt11Response.
 */
export type PartialMeltQuoteResponse = NUT05MeltQuoteResponse & {
	/**
	 * Fee reserve to be added to the amount.
	 */
	fee_reserve: number;
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
} & ApiError;

/**
 * Response from the mint after requesting a BOLT11 melt quote. Contains payment details and state
 * for paying Lightning Network offers.
 */
export type MeltQuoteBolt11Response = NUT05MeltQuoteResponse & {
	/**
	 * Payment request for the melt quote.
	 */
	request: string; // LN invoice
	/**
	 * Fee reserve to be added to the amount.
	 */
	fee_reserve: number;
	/**
	 * Preimage of the paid invoice. is null if it the invoice has not been paid yet. can be null,
	 * depending on which LN-backend the mint uses.
	 */
	payment_preimage: string | null;
	/**
	 * Return/Change from overpaid fees. This happens due to Lighting fee estimation being inaccurate.
	 */
	change?: SerializedBlindedSignature[];
};

/**
 * Response from the mint after requesting a BOLT12 melt quote. Contains payment details and state
 * for paying Lightning Network offers.
 *
 * @remarks
 * - Same as Bolt11.
 */
export type MeltQuoteBolt12Response = MeltQuoteBolt11Response;

/**
 * @deprecated - Use MeltQuoteBolt11Response.
 */
export type MeltQuoteResponse = PartialMeltQuoteResponse & { request: string; unit: string };

/**
 * @deprecated - Use MeltQuoteBolt12Response.
 */
export type Bolt12MeltQuoteResponse = MeltQuoteResponse;

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
 * Response from the mint after requesting a BOLT12 mint quote. Contains a Lightning Network offer
 * and tracks payment/issuance amounts.
 */
export type Bolt12MintQuoteResponse = {
	/**
	 * Quote identifier.
	 */
	quote: string;
	/**
	 * BOLT12 offer that can be paid to mint tokens.
	 */
	request: string;
	/**
	 * Requested amount. This is null for amount-less offers.
	 */
	amount: number | null;
	/**
	 * Unit of the amount.
	 */
	unit: string;
	/**
	 * Unix timestamp when quote expires.
	 */
	expiry: number | null;
	/**
	 * Public key that locked this quote.
	 */
	pubkey: string;
	/**
	 * The amount that has been paid to the mint via the bolt12 offer. The difference between this and
	 * `amount_issued` can be minted.
	 */
	amount_paid: number;
	/**
	 * The amount of ecash that has been issued for the given mint quote.
	 */
	amount_issued: number;
};

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

/**
 * Ecash to other MoE swap method, displayed in @type {GetInfoResponse}
 */
export type SwapMethod = {
	method: string;
	unit: string;
	min_amount: number;
	max_amount: number;
	description?: boolean; //added this for Nutshell =>0.16.4 compatibility, see https://github.com/cashubtc/nutshell/pull/783
	options?: {
		description?: boolean;
	};
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
