import { MintKeys, MintKeyset, Proof } from '../model/types';
import { CashuAuthMint } from './CashuAuthMint';
/**
 * Class that represents a Cashu NUT-22 wallet.
 */
declare class CashuAuthWallet {
    private _keys;
    private _keysetId;
    private _keysets;
    private _unit;
    mint: CashuAuthMint;
    /**
     * @param mint NUT-22 auth mint instance.
     * @param options.keys Public keys from the mint (will be fetched from mint if not provided)
     * @param options.keysets Keysets from the mint (will be fetched from mint if not provided)
     */
    constructor(mint: CashuAuthMint, options?: {
        keys?: MintKeys[] | MintKeys;
        keysets?: MintKeyset[];
    });
    get keys(): Map<string, MintKeys>;
    get keysetId(): string;
    set keysetId(keysetId: string);
    get keysets(): MintKeyset[];
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
     * Mint proofs for a given mint quote.
     *
     * @param amount Amount to request.
     * @param clearAuthToken ClearAuthToken to mint.
     * @param options.keysetId? Optionally set keysetId for blank outputs for returned change.
     * @returns Proofs.
     */
    mintProofs(amount: number, clearAuthToken: string, options?: {
        keysetId?: string;
    }): Promise<Proof[]>;
}
export { CashuAuthWallet };
