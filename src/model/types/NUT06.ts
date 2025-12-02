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

export type MintContactInfo = {
	method: string;
	info: string;
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
