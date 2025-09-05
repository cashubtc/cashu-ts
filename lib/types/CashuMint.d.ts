import { type WSConnection } from './WSConnection';
import type { CheckStatePayload, CheckStateResponse, GetInfoResponse, MeltPayload, MintActiveKeys, MintAllKeysets, PostRestoreResponse, SerializedBlindedMessage, SwapPayload, SwapResponse, MintQuotePayload, MintPayload, MintResponse, PostRestorePayload, MeltQuotePayload, PartialMintQuoteResponse, PartialMeltQuoteResponse } from './model/types/index';
import request from './request';
import { MintInfo } from './model/MintInfo';
import { type Logger } from './logger';
/**
 * Class represents Cashu Mint API. This class contains Lower level functions that are implemented
 * by CashuWallet.
 */
declare class CashuMint {
    private _mintUrl;
    private _customRequest?;
    private ws?;
    private _mintInfo?;
    private _authTokenGetter?;
    private _checkNut22;
    private _logger;
    /**
     * @param _mintUrl Requires mint URL to create this object.
     * @param _customRequest If passed, use custom request implementation for network communication
     *   with the mint.
     * @param [authTokenGetter] A function that is called by the CashuMint instance to obtain a NUT-22
     *   BlindedAuthToken (e.g. from a database or localstorage)
     */
    constructor(_mintUrl: string, _customRequest?: typeof request | undefined, authTokenGetter?: () => Promise<string>, options?: {
        logger?: Logger;
    });
    get mintUrl(): string;
    /**
     * Fetches mints info at the /info endpoint.
     *
     * @param mintUrl
     * @param customRequest
     */
    static getInfo(mintUrl: string, customRequest?: typeof request, logger?: Logger): Promise<GetInfoResponse>;
    /**
     * Fetches mints info at the /info endpoint.
     */
    getInfo(): Promise<GetInfoResponse>;
    getLazyMintInfo(): Promise<MintInfo>;
    /**
     * Performs a swap operation with ecash inputs and outputs.
     *
     * @param mintUrl
     * @param swapPayload Payload containing inputs and outputs.
     * @param customRequest
     * @returns Signed outputs.
     */
    static swap(mintUrl: string, swapPayload: SwapPayload, customRequest?: typeof request, blindAuthToken?: string): Promise<SwapResponse>;
    /**
     * Performs a swap operation with ecash inputs and outputs.
     *
     * @param swapPayload Payload containing inputs and outputs.
     * @returns Signed outputs.
     */
    swap(swapPayload: SwapPayload): Promise<SwapResponse>;
    /**
     * Requests a new mint quote from the mint.
     *
     * @param mintUrl
     * @param mintQuotePayload Payload for creating a new mint quote.
     * @param customRequest
     * @returns The mint will create and return a new mint quote containing a payment request for the
     *   specified amount and unit.
     */
    static createMintQuote(mintUrl: string, mintQuotePayload: MintQuotePayload, customRequest?: typeof request, blindAuthToken?: string, logger?: Logger): Promise<PartialMintQuoteResponse>;
    /**
     * Requests a new mint quote from the mint.
     *
     * @param mintQuotePayload Payload for creating a new mint quote.
     * @returns The mint will create and return a new mint quote containing a payment request for the
     *   specified amount and unit.
     */
    createMintQuote(mintQuotePayload: MintQuotePayload): Promise<PartialMintQuoteResponse>;
    /**
     * Gets an existing mint quote from the mint.
     *
     * @param mintUrl
     * @param quote Quote ID.
     * @param customRequest
     * @returns The mint will create and return a Lightning invoice for the specified amount.
     */
    static checkMintQuote(mintUrl: string, quote: string, customRequest?: typeof request, blindAuthToken?: string, logger?: Logger): Promise<PartialMintQuoteResponse>;
    /**
     * Gets an existing mint quote from the mint.
     *
     * @param quote Quote ID.
     * @returns The mint will create and return a Lightning invoice for the specified amount.
     */
    checkMintQuote(quote: string): Promise<PartialMintQuoteResponse>;
    /**
     * Mints new tokens by requesting blind signatures on the provided outputs.
     *
     * @param mintUrl
     * @param mintPayload Payload containing the outputs to get blind signatures on.
     * @param customRequest
     * @returns Serialized blinded signatures.
     */
    static mint(mintUrl: string, mintPayload: MintPayload, customRequest?: typeof request, blindAuthToken?: string): Promise<MintResponse>;
    /**
     * Mints new tokens by requesting blind signatures on the provided outputs.
     *
     * @param mintPayload Payload containing the outputs to get blind signatures on.
     * @returns Serialized blinded signatures.
     */
    mint(mintPayload: MintPayload): Promise<MintResponse>;
    /**
     * Requests a new melt quote from the mint.
     *
     * @param mintUrl
     * @param MeltQuotePayload
     * @returns
     */
    static createMeltQuote(mintUrl: string, meltQuotePayload: MeltQuotePayload, customRequest?: typeof request, blindAuthToken?: string, logger?: Logger): Promise<PartialMeltQuoteResponse>;
    /**
     * Requests a new melt quote from the mint.
     *
     * @param MeltQuotePayload
     * @returns
     */
    createMeltQuote(meltQuotePayload: MeltQuotePayload): Promise<PartialMeltQuoteResponse>;
    /**
     * Gets an existing melt quote.
     *
     * @param mintUrl
     * @param quote Quote ID.
     * @returns
     */
    static checkMeltQuote(mintUrl: string, quote: string, customRequest?: typeof request, blindAuthToken?: string, logger?: Logger): Promise<PartialMeltQuoteResponse>;
    /**
     * Gets an existing melt quote.
     *
     * @param quote Quote ID.
     * @returns
     */
    checkMeltQuote(quote: string): Promise<PartialMeltQuoteResponse>;
    /**
     * Requests the mint to pay for a Bolt11 payment request by providing ecash as inputs to be spent.
     * The inputs contain the amount and the fee_reserves for a Lightning payment. The payload can
     * also contain blank outputs in order to receive back overpaid Lightning fees.
     *
     * @param mintUrl
     * @param meltPayload
     * @param customRequest
     * @returns
     */
    static melt(mintUrl: string, meltPayload: MeltPayload, customRequest?: typeof request, blindAuthToken?: string, logger?: Logger): Promise<PartialMeltQuoteResponse>;
    /**
     * Ask mint to perform a melt operation. This pays a lightning invoice and destroys tokens
     * matching its amount + fees.
     *
     * @param meltPayload
     * @returns
     */
    melt(meltPayload: MeltPayload): Promise<PartialMeltQuoteResponse>;
    /**
     * Checks if specific proofs have already been redeemed.
     *
     * @param mintUrl
     * @param checkPayload
     * @param customRequest
     * @returns Redeemed and unredeemed ordered list of booleans.
     */
    static check(mintUrl: string, checkPayload: CheckStatePayload, customRequest?: typeof request): Promise<CheckStateResponse>;
    /**
     * Get the mints public keys.
     *
     * @param mintUrl
     * @param keysetId Optional param to get the keys for a specific keyset. If not specified, the
     *   keys from all active keysets are fetched.
     * @param customRequest
     * @returns
     */
    static getKeys(mintUrl: string, keysetId?: string, customRequest?: typeof request): Promise<MintActiveKeys>;
    /**
     * Get the mints public keys.
     *
     * @param keysetId Optional param to get the keys for a specific keyset. If not specified, the
     *   keys from all active keysets are fetched.
     * @returns The mints public keys.
     */
    getKeys(keysetId?: string, mintUrl?: string): Promise<MintActiveKeys>;
    /**
     * Get the mints keysets in no specific order.
     *
     * @param mintUrl
     * @param customRequest
     * @returns All the mints past and current keysets.
     */
    static getKeySets(mintUrl: string, customRequest?: typeof request): Promise<MintAllKeysets>;
    /**
     * Get the mints keysets in no specific order.
     *
     * @returns All the mints past and current keysets.
     */
    getKeySets(): Promise<MintAllKeysets>;
    /**
     * Checks if specific proofs have already been redeemed.
     *
     * @param checkPayload
     * @returns Redeemed and unredeemed ordered list of booleans.
     */
    check(checkPayload: CheckStatePayload): Promise<CheckStateResponse>;
    static restore(mintUrl: string, restorePayload: PostRestorePayload, customRequest?: typeof request): Promise<PostRestoreResponse>;
    restore(restorePayload: {
        outputs: SerializedBlindedMessage[];
    }): Promise<PostRestoreResponse>;
    /**
     * Tries to establish a websocket connection with the websocket mint url according to NUT-17.
     */
    connectWebSocket(): Promise<void>;
    /**
     * Closes a websocket connection.
     */
    disconnectWebSocket(): void;
    get webSocketConnection(): WSConnection | undefined;
    handleBlindAuth(path: string): Promise<string | undefined>;
}
export { CashuMint };
