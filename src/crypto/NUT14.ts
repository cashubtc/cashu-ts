import { bytesToHex, hexToBytes, randomBytes } from '@noble/curves/utils';
import { createSecret } from './NUT10';
import { sha256 } from '@noble/hashes/sha2';

/**
 * Create an HTLC hash/preimage pair.
 *
 * @param preimage - Optional. Preimage to use (Default: random preimage)
 * @returns Hash and preimage pair.
 */
export function createHTLCHash(preimage?: string): { hash: string; preimage: string } {
	const piBytes = preimage ? hexToBytes(preimage) : randomBytes(32);
	const hash = bytesToHex(sha256(piBytes));
	return { hash, preimage: bytesToHex(piBytes) };
}

/**
 * Create an HTLC secret.
 *
 * @param hash - The HTLC hash to add to Secret.data.
 * @param tags - Optional. Additional P2PK tags.
 */
export const createHTLCsecret = (hash: string, tags?: string[][]): string => {
	return createSecret('HTLC', hash, tags);
};
