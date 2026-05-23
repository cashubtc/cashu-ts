import { type Logger } from '../logger';
import { Mint } from '../mint/Mint';
import request, { type RequestFetch, type RequestFn, type RequestOptions } from '../transport';
import { Wallet } from '../wallet/Wallet';

import { AuthManager } from './AuthManager';
import type { OIDCAuth, OIDCAuthOptions } from './OIDCAuth';

/**
 * High-level helper to create a fully authenticated wallet session.
 *
 * @remarks
 * Like a dependency injector, it wires AuthManager->Mint->OIDCAuth->Wallet in the correct order.
 * Wallet is returned ready to use.
 * @param mintUrl URL of the mint to connect to.
 * @param options.authPool Optional. Desired BAT pool size and per-request mint cap. Both
 *   desiredPoolSize and maxPerMint on the AuthManager will be set to this value. Defaults to 10.
 * @param options.oidc Optional. Options for OIDCAuth (scope, clientId, logger, etc.)
 * @param options.customRequest Optional request function for mint HTTP calls.
 * @param options.requestFetch Optional fetch-compatible transport for mint HTTP calls. Ignored when
 *   `customRequest` is supplied.
 * @returns {mint, auth, oidc, wallet} — hydrated, ready to use.
 * @throws If mint does not require authentication.
 */
export async function createAuthWallet(
  mintUrl: string,
  options?: {
    authPool?: number;
    oidc?: OIDCAuthOptions;
    customRequest?: RequestFn;
    requestFetch?: RequestFetch;
    logger?: Logger;
  },
): Promise<{ mint: Mint; auth: AuthManager; oidc: OIDCAuth; wallet: Wallet }> {
  let requestInstance: RequestFn | undefined = options?.customRequest;
  if (!requestInstance && options?.requestFetch) {
    const requestFetch = options.requestFetch;
    requestInstance = <T>(args: RequestOptions): Promise<T> =>
      request<T>({ ...args, fetch: requestFetch });
  }

  // 1. Create an AuthManager for both BAT and CAT handling
  const auth = new AuthManager(mintUrl, {
    desiredPoolSize: options?.authPool ?? 10,
    maxPerMint: options?.authPool ?? 10,
    request: requestInstance,
    logger: options?.logger,
  });

  // 2. Create a Mint instance using the AuthManager
  const mint = new Mint(mintUrl, {
    authProvider: auth,
    customRequest: options?.customRequest,
    requestFetch: options?.requestFetch,
    logger: options?.logger,
  });

  // 3. Discover and configure OIDCAuth from the mint
  const oidc = await mint.oidcAuth({
    ...options?.oidc,
    logger: options?.logger,
    onTokens: (t) => auth.setCAT(t.access_token), // set CAT automatically
  });

  // 4. Attach OIDCAuth back into AuthManager for refresh, etc.
  auth.attachOIDC(oidc);

  // 5. Hydrate wallet using the same mint and auth provider
  const wallet = new Wallet(mint, { authProvider: auth, logger: options?.logger });
  await wallet.loadMint();

  return { mint, auth, oidc, wallet };
}
