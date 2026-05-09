import type { AmountLike } from '../Amount';

import type { Nut29Info } from './NUT29';

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
    '19'?: {
      ttl: number | null;
      cached_endpoints: Array<{ method: 'GET' | 'POST'; path: string }>;
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
    '29'?: Nut29Info;
  };
  motd?: string;
};

export type MintContactInfo = {
  method: string;
  info: string;
};

/**
 * Ecash to other MoE swap method, displayed in @type {GetInfoResponse}.
 *
 * @remarks
 * `min_amount` and `max_amount` are `<int|null>` per NUT-04/05/25/XX — null when the mint
 * advertises no lower/upper bound. Consumers should use null-safe checks (`?? 0`, `!= null`,
 * truthy) before passing to `Amount.from(...)`.
 */
export type SwapMethod = {
  method: string;
  unit: string;
  min_amount: AmountLike | null;
  max_amount: AmountLike | null;
  description?: boolean; //added this for Nutshell =>0.16.4 compatibility, see https://github.com/cashubtc/nutshell/pull/783
  options?: {
    description?: boolean;
    amountless?: boolean;
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
