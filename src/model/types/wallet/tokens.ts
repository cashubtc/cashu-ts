import { type Proof } from './index';

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

export type V4DLEQTemplate = {
	/**
	 * Challenge.
	 */
	e: Uint8Array;
	/**
	 * Response.
	 */
	s: Uint8Array;
	/**
	 * Blinding factor.
	 */
	r: Uint8Array;
};

/**
 * Template for a Proof inside a V4 Token.
 */
export type V4ProofTemplate = {
	/**
	 * Amount.
	 */
	a: number;
	/**
	 * Secret.
	 */
	s: string;
	/**
	 * Signature.
	 */
	c: Uint8Array;
	/**
	 * DLEQ.
	 */
	d?: V4DLEQTemplate;
	/**
	 * Witness.
	 */
	w?: string;
};

/**
 * TokenEntry in a V4 Token.
 */
export type V4InnerToken = {
	/**
	 * ID.
	 */
	i: Uint8Array;
	/**
	 * Proofs.
	 */
	p: V4ProofTemplate[];
};

/**
 * Template for a V4 Token.
 */
export type TokenV4Template = {
	/**
	 * TokenEntries.
	 */
	t: V4InnerToken[];
	/**
	 * Memo.
	 */
	d: string;
	/**
	 * Mint Url.
	 */
	m: string;
	/**
	 * Unit.
	 */
	u: string;
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
type TokenEntry = {
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
	/**
	 * Proofs without an id.
	 */
	incompleteProofs: Omit<Proof, 'id'>[];
};
