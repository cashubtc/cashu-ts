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
	 * P2BK E.
	 */
	pe?: Uint8Array;
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
