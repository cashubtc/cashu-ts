export interface AuthProvider {
  // Blind-auth, NUT-22. `body` is the exact serialized request body, if any: a version 02 BAT
  // signs the request transcript (method, target, body hash), so the bytes must be the sent bytes.
  getBlindAuthToken(input: {
    method: 'GET' | 'POST';
    path: string;
    body?: string;
  }): Promise<string>;
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
