import { SerializedBlindedMessage } from '../wallet';
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
export declare const CheckStateEnum: {
    readonly UNSPENT: "UNSPENT";
    readonly PENDING: "PENDING";
    readonly SPENT: "SPENT";
};
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
            methods: SwapMethod[];
            disabled: boolean;
        };
        '5': {
            methods: SwapMethod[];
            disabled: boolean;
        };
        '7'?: {
            supported: boolean;
        };
        '8'?: {
            supported: boolean;
        };
        '9'?: {
            supported: boolean;
        };
        '10'?: {
            supported: boolean;
        };
        '11'?: {
            supported: boolean;
        };
        '12'?: {
            supported: boolean;
        };
        '14'?: {
            supported: boolean;
        };
        '15'?: {
            methods: MPPMethod[];
        };
        '17'?: {
            supported: WebSocketSupport[];
        };
        '20'?: {
            supported: boolean;
        };
        '22'?: {
            bat_max_mint: number;
            protected_endpoints: Array<{
                method: 'GET' | 'POST';
                path: string;
            }>;
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
export type MeltQuoteResponse = PartialMeltQuoteResponse & {
    request: string;
    unit: string;
};
export declare const MeltQuoteState: {
    readonly UNPAID: "UNPAID";
    readonly PENDING: "PENDING";
    readonly PAID: "PAID";
};
export type MeltQuoteState = (typeof MeltQuoteState)[keyof typeof MeltQuoteState];
export type MintContactInfo = {
    method: string;
    info: string;
};
export declare const MintQuoteState: {
    readonly UNPAID: "UNPAID";
    readonly PAID: "PAID";
    readonly ISSUED: "ISSUED";
};
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
export type MintQuoteResponse = PartialMintQuoteResponse & {
    amount: number;
    unit: string;
};
export type LockedMintQuoteResponse = MintQuoteResponse & {
    pubkey: string;
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
