import { CashuMint } from './CashuMint';
import { MintInfo } from './model/MintInfo';
import { Logger } from './logger';
import { GetInfoResponse, MeltProofOptions, MintProofOptions, MintQuoteResponse, ProofState, ReceiveOptions, RestoreOptions, SendOptions, SwapOptions, MeltProofsResponse, MeltQuoteResponse, MintKeys, MintKeyset, Proof, SendResponse, Token, LockedMintQuoteResponse, PartialMintQuoteResponse, PartialMeltQuoteResponse } from './model/types/index';
import { SubscriptionCanceller } from './model/types/wallet/websocket';
import { OutputDataFactory } from './model/OutputData';
/**
 * Class that represents a Cashu wallet. This class should act as the entry point for this library.
 */
declare class CashuWallet {
    private _keys;
    private _keysetId;
    private _keysets;
    private _seed;
    private _unit;
    private _mintInfo;
    private _denominationTarget;
    private _keepFactory;
    private _logger;
    mint: CashuMint;
    /**
     * @param mint Cashu mint instance is used to make api calls.
     * @param options.unit Optionally set unit (default is 'sat')
     * @param options.keys Public keys from the mint (will be fetched from mint if not provided)
     * @param options.keysets Keysets from the mint (will be fetched from mint if not provided)
     * @param options.mintInfo Mint info from the mint (will be fetched from mint if not provided)
     * @param options.denominationTarget Target number proofs per denomination (default: see @constant
     *   DEFAULT_DENOMINATION_TARGET)
     * @param options.bip39seed BIP39 seed for deterministic secrets.
     * @param options.keepFactory A function that will be used by all parts of the library that
     *   produce proofs to be kept (change, etc.). This can lead to poor performance, in which case
     *   the seed should be directly provided.
     */
    constructor(mint: CashuMint, options?: {
        unit?: string;
        keys?: MintKeys[] | MintKeys;
        keysets?: MintKeyset[];
        mintInfo?: GetInfoResponse;
        bip39seed?: Uint8Array;
        denominationTarget?: number;
        keepFactory?: OutputDataFactory;
        logger?: Logger;
    });
    get unit(): string;
    get keys(): Map<string, MintKeys>;
    get keysetId(): string;
    set keysetId(keysetId: string);
    get keysets(): MintKeyset[];
    get mintInfo(): MintInfo;
    /**
     * Get information about the mint.
     *
     * @returns Mint info.
     */
    getMintInfo(): Promise<MintInfo>;
    /**
     * Get stored information about the mint or request it if not loaded.
     *
     * @returns Mint info.
     */
    lazyGetMintInfo(): Promise<MintInfo>;
    /**
     * Load mint information, keysets and keys. This function can be called if no keysets are passed
     * in the constructor.
     */
    loadMint(): Promise<void>;
    /**
     * Choose a keyset to activate based on the lowest input fee.
     *
     * Note: this function will filter out deprecated base64 keysets.
     *
     * @param keysets Keysets to choose from.
     * @returns Active keyset.
     */
    getActiveKeyset(keysets: MintKeyset[]): MintKeyset;
    /**
     * Get keysets from the mint with the unit of the wallet.
     *
     * @returns Keysets with wallet's unit.
     */
    getKeySets(): Promise<MintKeyset[]>;
    /**
     * Get all active keys from the mint and set the keyset with the lowest fees as the active wallet
     * keyset.
     *
     * @returns Keyset.
     */
    getAllKeys(): Promise<MintKeys[]>;
    /**
     * Get public keys from the mint. If keys were already fetched, it will return those.
     *
     * If `keysetId` is set, it will fetch and return that specific keyset. Otherwise, we select an
     * active keyset with the unit of the wallet.
     *
     * @param keysetId Optional keysetId to get keys for.
     * @param forceRefresh? If set to true, it will force refresh the keyset from the mint.
     * @returns Keyset.
     */
    getKeys(keysetId?: string, forceRefresh?: boolean): Promise<MintKeys>;
    /**
     * Receive an encoded or raw Cashu token (only supports single tokens. It will only process the
     * first token in the token array)
     *
     * @param {string | Token} token - Cashu token, either as string or decoded.
     * @param {ReceiveOptions} [options] - Optional configuration for token processing.
     * @returns New token with newly created proofs, token entries that had errors.
     */
    receive(token: string | Token, options?: ReceiveOptions): Promise<Proof[]>;
    /**
     * Send proofs of a given amount, by providing at least the required amount of proofs.
     *
     * @param amount Amount to send.
     * @param proofs Array of proofs (accumulated amount of proofs must be >= than amount)
     * @param {SendOptions} [options] - Optional parameters for configuring the send operation.
     * @returns {SendResponse}
     */
    send(amount: number, proofs: Proof[], options?: SendOptions): Promise<SendResponse>;
    /**
     * Selects proofs to send based on amount and fee inclusion.
     *
     * @remarks
     * Uses an adapted Randomized Greedy with Local Improvement (RGLI) algorithm, which has a time
     * complexity O(n log n) and space complexity O(n).
     * @param proofs Array of Proof objects available to select from.
     * @param amountToSend The target amount to send.
     * @param includeFees Optional boolean to include fees; Default: false.
     * @returns SendResponse containing proofs to keep and proofs to send.
     * @see https://crypto.ethz.ch/publications/files/Przyda02.pdf
     */
    selectProofsToSend(proofs: Proof[], amountToSend: number, includeFees?: boolean): SendResponse;
    /**
     * Calculates the fees based on inputs (proofs)
     *
     * @param proofs Input proofs to calculate fees for.
     * @returns Fee amount.
     * @throws Throws an error if the proofs keyset is unknown.
     */
    getFeesForProofs(proofs: Proof[]): number;
    /**
     * Returns the current fee PPK for a proof according to the cached keyset.
     *
     * @param proof {Proof} A single proof.
     * @returns FeePPK {number} The feePPK for the selected proof.
     * @throws Throws an error if the proofs keyset is unknown.
     */
    private getProofFeePPK;
    /**
     * Calculates the fees based on inputs for a given keyset.
     *
     * @param nInputs Number of inputs.
     * @param keysetId KeysetId used to lookup `input_fee_ppk`
     * @returns Fee amount.
     */
    getFeesForKeyset(nInputs: number, keysetId: string): number;
    /**
     * Splits and creates sendable tokens if no amount is specified, the amount is implied by the
     * cumulative amount of all proofs if both amount and preference are set, but the preference
     * cannot fulfill the amount, then we use the default split.
     *
     * @param {SwapOptions} [options] - Optional parameters for configuring the swap operation.
     * @returns Promise of the change- and send-proofs.
     */
    swap(amount: number, proofs: Proof[], options?: SwapOptions): Promise<SendResponse>;
    /**
     * Restores batches of deterministic proofs until no more signatures are returned from the mint.
     *
     * @param [gapLimit=300] The amount of empty counters that should be returned before restoring
     *   ends (defaults to 300). Default is `300`
     * @param [batchSize=100] The amount of proofs that should be restored at a time (defaults to
     *   100). Default is `100`
     * @param [counter=0] The counter that should be used as a starting point (defaults to 0). Default
     *   is `0`
     * @param [keysetId] Which keysetId to use for the restoration. If none is passed the instance's
     *   default one will be used.
     */
    batchRestore(gapLimit?: number, batchSize?: number, counter?: number, keysetId?: string): Promise<{
        proofs: Proof[];
        lastCounterWithSignature?: number;
    }>;
    /**
     * Regenerates.
     *
     * @param start Set starting point for count (first cycle for each keyset should usually be 0)
     * @param count Set number of blinded messages that should be generated.
     * @param options.keysetId Set a custom keysetId to restore from. keysetIds can be loaded with
     *   `CashuMint.getKeySets()`
     */
    restore(start: number, count: number, options?: RestoreOptions): Promise<{
        proofs: Proof[];
        lastCounterWithSignature?: number;
    }>;
    /**
     * Requests a mint quote form the mint. Response returns a Lightning payment request for the
     * requested given amount and unit.
     *
     * @param amount Amount requesting for mint.
     * @param description Optional description for the mint quote.
     * @param pubkey Optional public key to lock the quote to.
     * @returns The mint will return a mint quote with a Lightning invoice for minting tokens of the
     *   specified amount and unit.
     */
    createMintQuote(amount: number, description?: string): Promise<MintQuoteResponse>;
    /**
     * Requests a mint quote from the mint that is locked to a public key.
     *
     * @param amount Amount requesting for mint.
     * @param pubkey Public key to lock the quote to.
     * @param description Optional description for the mint quote.
     * @returns The mint will return a mint quote with a Lightning invoice for minting tokens of the
     *   specified amount and unit. The quote will be locked to the specified `pubkey`.
     */
    createLockedMintQuote(amount: number, pubkey: string, description?: string): Promise<LockedMintQuoteResponse>;
    /**
     * Gets an existing mint quote from the mint.
     *
     * @param quote Quote ID.
     * @returns The mint will create and return a Lightning invoice for the specified amount.
     */
    checkMintQuote(quote: MintQuoteResponse): Promise<MintQuoteResponse>;
    checkMintQuote(quote: string): Promise<PartialMintQuoteResponse>;
    /**
     * Mint proofs for a given mint quote.
     *
     * @param amount Amount to request.
     * @param {string} quote - ID of mint quote (when quote is a string)
     * @param {LockedMintQuote} quote - Containing the quote ID and unlocking private key (when quote
     *   is a LockedMintQuote)
     * @param {MintProofOptions} [options] - Optional parameters for configuring the Mint Proof
     *   operation.
     * @returns Proofs.
     */
    mintProofs(amount: number, quote: MintQuoteResponse, options: MintProofOptions & {
        privateKey: string;
    }): Promise<Proof[]>;
    mintProofs(amount: number, quote: string, options?: MintProofOptions): Promise<Proof[]>;
    /**
     * Requests a melt quote from the mint. Response returns amount and fees for a given unit in order
     * to pay a Lightning invoice.
     *
     * @param invoice LN invoice that needs to get a fee estimate.
     * @returns The mint will create and return a melt quote for the invoice with an amount and fee
     *   reserve.
     */
    createMeltQuote(invoice: string): Promise<MeltQuoteResponse>;
    /**
     * Requests a multi path melt quote from the mint.
     *
     * @param invoice LN invoice that needs to get a fee estimate.
     * @param partialAmount The partial amount of the invoice's total to be paid by this instance.
     * @returns The mint will create and return a melt quote for the invoice with an amount and fee
     *   reserve.
     */
    createMultiPathMeltQuote(invoice: string, millisatPartialAmount: number): Promise<MeltQuoteResponse>;
    /**
     * Return an existing melt quote from the mint.
     *
     * @param quote ID of the melt quote.
     * @returns The mint will return an existing melt quote.
     */
    checkMeltQuote(quote: string): Promise<PartialMeltQuoteResponse>;
    checkMeltQuote(quote: MeltQuoteResponse): Promise<MeltQuoteResponse>;
    /**
     * Melt proofs for a melt quote. proofsToSend must be at least amount+fee_reserve form the melt
     * quote. This function does not perform coin selection!. Returns melt quote and change proofs.
     *
     * @param meltQuote ID of the melt quote.
     * @param proofsToSend Proofs to melt.
     * @param {MeltProofOptions} [options] - Optional parameters for configuring the Melting Proof
     *   operation.
     * @returns
     */
    meltProofs(meltQuote: MeltQuoteResponse, proofsToSend: Proof[], options?: MeltProofOptions): Promise<MeltProofsResponse>;
    /**
     * Creates a split payload.
     *
     * @param amount Amount to send.
     * @param proofsToSend Proofs to split*
     * @param outputAmounts? Optionally specify the output's amounts to keep and to send.
     * @param counter? Optionally set counter to derive secret deterministically. CashuWallet class
     *   must be initialized with seed phrase to take effect.
     * @param pubkey? Optionally locks ecash to pubkey. Will not be deterministic, even if counter is
     *   set!
     * @param privkey? Will create a signature on the @param proofsToSend secrets if set.
     * @param customOutputData? Optionally specify your own OutputData (blinded messages)
     * @param p2pk? Optionally specify options to lock the proofs according to NUT-11.
     * @returns
     */
    private createSwapPayload;
    /**
     * Get an array of the states of proofs from the mint (as an array of CheckStateEnum's)
     *
     * @param proofs (only the `secret` field is required)
     * @returns
     */
    checkProofsStates(proofs: Proof[]): Promise<ProofState[]>;
    /**
     * Register a callback to be called whenever a mint quote's state changes.
     *
     * @param quoteIds List of mint quote IDs that should be subscribed to.
     * @param callback Callback function that will be called whenever a mint quote state changes.
     * @param errorCallback
     * @returns
     */
    onMintQuoteUpdates(quoteIds: string[], callback: (payload: MintQuoteResponse) => void, errorCallback: (e: Error) => void): Promise<SubscriptionCanceller>;
    /**
     * Register a callback to be called whenever a melt quote's state changes.
     *
     * @param quoteIds List of melt quote IDs that should be subscribed to.
     * @param callback Callback function that will be called whenever a melt quote state changes.
     * @param errorCallback
     * @returns
     */
    onMeltQuotePaid(quoteId: string, callback: (payload: MeltQuoteResponse) => void, errorCallback: (e: Error) => void): Promise<SubscriptionCanceller>;
    /**
     * Register a callback to be called when a single mint quote gets paid.
     *
     * @param quoteId Mint quote id that should be subscribed to.
     * @param callback Callback function that will be called when this mint quote gets paid.
     * @param errorCallback
     * @returns
     */
    onMintQuotePaid(quoteId: string, callback: (payload: MintQuoteResponse) => void, errorCallback: (e: Error) => void): Promise<SubscriptionCanceller>;
    /**
     * Register a callback to be called when a single melt quote gets paid.
     *
     * @param quoteId Melt quote id that should be subscribed to.
     * @param callback Callback function that will be called when this melt quote gets paid.
     * @param errorCallback
     * @returns
     */
    onMeltQuoteUpdates(quoteIds: string[], callback: (payload: MeltQuoteResponse) => void, errorCallback: (e: Error) => void): Promise<SubscriptionCanceller>;
    /**
     * Register a callback to be called whenever a subscribed proof state changes.
     *
     * @param proofs List of proofs that should be subscribed to.
     * @param callback Callback function that will be called whenever a proof's state changes.
     * @param errorCallback
     * @returns
     */
    onProofStateUpdates(proofs: Proof[], callback: (payload: ProofState & {
        proof: Proof;
    }) => void, errorCallback: (e: Error) => void): Promise<SubscriptionCanceller>;
    /**
     * Creates blinded messages for a according to @param amounts.
     *
     * @param amount Array of amounts to create blinded messages for.
     * @param counter? Optionally set counter to derive secret deterministically. CashuWallet class
     *   must be initialized with seed phrase to take effect.
     * @param pubkey? Optionally locks ecash to pubkey. Will not be deterministic, even if counter is
     *   set!
     * @param outputAmounts? Optionally specify the output's amounts to keep and to send.
     * @param p2pk? Optionally specify options to lock the proofs according to NUT-11.
     * @param factory? Optionally specify a custom function that produces OutputData (blinded
     *   messages)
     * @returns Blinded messages, secrets, rs, and amounts.
     */
    private createOutputData;
    /**
     * Creates NUT-08 blank outputs (fee returns) for a given fee reserve See:
     * https://github.com/cashubtc/nuts/blob/main/08.md.
     *
     * @param amount Amount to cover with blank outputs.
     * @param keysetId Mint keysetId.
     * @param counter? Optionally set counter to derive secret deterministically. CashuWallet class
     *   must be initialized with seed phrase to take effect.
     * @returns Blinded messages, secrets, and rs.
     */
    private createBlankOutputs;
}
export { CashuWallet };
