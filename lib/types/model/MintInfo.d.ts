import { GetInfoResponse, MPPMethod, SwapMethod, WebSocketSupport } from './types';
export declare class MintInfo {
    private readonly _mintInfo;
    private readonly _protectedEnpoints?;
    constructor(info: GetInfoResponse);
    isSupported(num: 4 | 5): {
        disabled: boolean;
        params: SwapMethod[];
    };
    isSupported(num: 7 | 8 | 9 | 10 | 11 | 12 | 14 | 20): {
        supported: boolean;
    };
    isSupported(num: 17): {
        supported: boolean;
        params?: WebSocketSupport[];
    };
    isSupported(num: 15): {
        supported: boolean;
        params?: MPPMethod[];
    };
    requiresBlindAuthToken(path: string): boolean;
    private checkGenericNut;
    private checkMintMelt;
    private checkNut17;
    private checkNut15;
    get contact(): import('./types').MintContactInfo[];
    get description(): string | undefined;
    get description_long(): string | undefined;
    get name(): string;
    get pubkey(): string;
    get nuts(): {
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
                method: "GET" | "POST";
                path: string;
            }>;
        };
    };
    get version(): string;
    get motd(): string | undefined;
}
