export type HttpMethod = 'GET' | 'POST';

export interface AuthProvider {
	/**
	 * Return a serialized BAT string to put in the `Blind-auth` header for the given HTTP method and
	 * path (path only, no origin). Should throw a clear error if a BAT cannot be produced.
	 */
	getBlindAuthToken(input: { method: HttpMethod; path: string }): Promise<string>;

	/**
	 * Optional hint to pre-warm the BAT pool.
	 */
	ensure?(minTokens: number): Promise<void>;
}
