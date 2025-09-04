import { CashuAuthMint } from './CashuAuthMint';
import { CashuAuthWallet } from './CashuAuthWallet';
import { Proof } from '../model/types';
/**
 * Helper function to encode a cashu auth token authA.
 *
 * @param proof
 */
export declare function getEncodedAuthToken(proof: Proof): string;
export declare function getBlindedAuthToken(amount: number, url: string, clearAuthToken: string): Promise<string[]>;
export { CashuAuthMint, CashuAuthWallet };
