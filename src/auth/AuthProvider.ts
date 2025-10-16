export interface AuthProvider {
	// Blind-auth, NUT-22
	getBlindAuthToken(input: { method: 'GET' | 'POST'; path: string }): Promise<string>;
	ensure?(minTokens: number): Promise<void>;

	// Clear-auth, NUT-21
	getCAT(): string | undefined;
	setCAT(cat: string | undefined): void;

	/**
	 * Ensure a valid CAT is available, refreshing if expiring soon. Return a token that is safe to
	 * send right now, or undefined if not obtainable.
	 */
	ensureCAT?(minValiditySec?: number): Promise<string | undefined>;
}
