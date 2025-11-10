import { type Proof } from './proof';

/**
 * A Cashu token.
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
 * A Cashu token.
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
 * TokenEntry that stores proofs and mints.
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
	amount: number;
};
