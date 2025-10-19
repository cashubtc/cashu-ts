import { type Logger } from '../logger';
import { Mint } from '../mint/Mint';
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
 * @param options.authPool Optional. Desired BAT pool size (default 10)
 * @param options.oidc Optional. Options for OIDCAuth (scope, clientId, logger, etc.)
 * @returns {mint, auth, oidc, wallet} — hydrated, ready to use.
 * @throws If mint does not require authentication.
 */
export async function createAuthWallet(
	mintUrl: string,
	options?: {
		authPool?: number;
		oidc?: OIDCAuthOptions;
		logger?: Logger;
	},
): Promise<{ mint: Mint; auth: AuthManager; oidc: OIDCAuth; wallet: Wallet }> {
	// 1. Create an AuthManager for both BAT and CAT handling
	const auth = new AuthManager(mintUrl, {
		desiredPoolSize: options?.authPool ?? 10,
		logger: options?.logger,
	});

	// 2. Create a Mint instance using the AuthManager
	const mint = new Mint(mintUrl, { authProvider: auth, logger: options?.logger });

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
