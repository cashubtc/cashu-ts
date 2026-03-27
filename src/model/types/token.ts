import { type Amount } from '../Amount';
import { type Proof } from './proof';

/**
 * A normalized Cashu token.
 *
 * @remarks
 * Used for decoded v3 and v4 token payloads in the public API.
 */
export type Token = {
	/**
	 * The mints URL.
	 */
	mint: string;
	/**
	 * A list of proofs.
	 */
	proofs: Proof[];
	/**
	 * A message to send along with the token.
	 */
	memo?: string;
	/**
	 * The unit of the token.
	 */
	unit?: string;
};

/**
 * A Cashu v3 token.
 */
export type DeprecatedToken = {
	/**
	 * Token entries.
	 */
	token: TokenEntry[];
	/**
	 * A message to send along with the token.
	 */
	memo?: string;
	/**
	 * The unit of the token.
	 */
	unit?: string;
};

/**
 * TokenEntry that stores proofs and mints for v3 token.
 */
export type TokenEntry = {
	/**
	 * A list of proofs.
	 */
	proofs: Proof[];
	/**
	 * The mints URL.
	 */
	mint: string;
};

/**
 * Metadata for a Cashu token.
 */
export type TokenMetadata = {
	/**
	 * The unit of the token.
	 */
	unit: string;
	/**
	 * The memo of the token.
	 */
	memo?: string;
	/**
	 * The mint of the token.
	 */
	mint: string;
	/**
	 * The amount of the token.
	 */
	amount: Amount;
	/**
	 * The incomplete proofs of the token.
	 */
	incompleteProofs: Array<Omit<Proof, 'id'>>;
};
