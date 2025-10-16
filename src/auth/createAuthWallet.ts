import { Mint } from '../mint/Mint';
import { Wallet } from '../wallet/Wallet';
import { AuthManager } from './AuthManager';
import type { OIDCAuth, OIDCAuthOptions } from './OIDCAuth';

/**
 * High-level helper to create a fully authenticated wallet session.
 *
 * @remarks
 * Like a dependency injector, it wires Mint->OIDCAuth->AuthManager->Wallet in the correct order.
 * Wallet is returned ready to use.
 * @param mintUrl URL of the mint to connect to.
 * @param options.authPool Optional. Desired BAT pool size (default 10)
 * @param options.oidc Optional. Options for OIDCAuth (scope, clientId, logger, etc.)
 * @returns {mint, auth, oidc, wallet} — hydrated, ready to use.
 */
export async function createAuthWallet(
	mintUrl: string,
	options?: {
		authPool?: number;
		oidc?: OIDCAuthOptions;
	},
): Promise<{ mint: Mint; auth: AuthManager; oidc: OIDCAuth; wallet: Wallet }> {
	// 1. Create a Mint instance
	const mint = new Mint(mintUrl);

	// 2. Create an AuthManager for both BAT and CAT handling
	const auth = new AuthManager(mintUrl, { desiredPoolSize: options?.authPool ?? 10 });

	// 3. Discover and configure OIDCAuth from the mint
	const oidc = await mint.oidcAuth({
		...options?.oidc,
		onTokens: (t) => auth.setCAT(t.access_token), // set CAT automatically
	});

	// 4. Attach OIDCAuth back into AuthManager for refresh, etc.
	auth.attachOIDC(oidc);

	// 5. Hydrate wallet using the same mint and auth provider
	const wallet = new Wallet(mint, { authProvider: auth });
	await wallet.loadMint();

	return { mint, auth, oidc, wallet };
}
