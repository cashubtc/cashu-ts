// +++++++++ Example of an auth wallet implementation with AUTH CODE + PKCE, copy and paste flow +++++++++
// Run the example with the following commands:
//
//   make up
//   make demo-device
//   make down
//
// The script prints a login URL. Open it, complete login, then copy the ?code=…
// from the final URL and paste it back into the terminal.

import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import * as crypto from 'node:crypto';
import * as readline from 'node:readline';

import { ConsoleLogger, createAuthWallet } from '../../src';
import { Bytes, getEncodedToken } from '../../src/utils';

const MINT_URL = 'http://localhost:3338';
const DESIRED_BATS = 3;

// Pick one redirect URI that your Keycloak client allows.
// In copy and paste mode nothing needs to be listening there.
const REDIRECT_URI = 'http://localhost:3388/callback';

async function main() {
	console.log('Auth BATs demo, auth code with PKCE, mint:', MINT_URL);

	// 1) Build AuthManager, Wallet, and OIDC client from the mint’s NUT-21 config
	const { auth, wallet, oidc } = await createAuthWallet(MINT_URL, {
		authPool: DESIRED_BATS,
		oidc: { scope: 'openid offline_access' },
		logger: new ConsoleLogger('debug'),
	});

	// 2) Authorisation Code with PKCE, manual copy and paste
	console.log('\nStarting browser based login with PKCE...');
	const { verifier, challenge } = oidc.generatePKCE();
	const state = crypto.randomBytes(24).toString('base64url');

	const authUrl = await oidc.buildAuthCodeUrl({
		redirectUri: REDIRECT_URI,
		codeChallenge: challenge,
		codeChallengeMethod: 'S256',
		state,
	});

	console.log(
		'\nOpen this URL in a browser to authorise, then copy the code query parameter from the final URL:',
	);
	console.log('  ', authUrl);

	const pasted = await prompt(
		'\nPaste the full redirected URL, then press Enter:\n> ',
	);
	const { code, gotState } = extractCodeAndState(pasted);

	if (!code) {
		throw new Error('No authorisation code found, paste the full redirected URL');
	}
	if (gotState && gotState !== state) {
		throw new Error('PKCE state mismatch, possible CSRF');
	}

	const tokens = await oidc.exchangeAuthCode({
		code,
		redirectUri: REDIRECT_URI,
		codeVerifier: verifier,
	});
	console.log('Received access token, truncated:', (tokens.access_token ?? '').slice(0, 24), '…');

	// 3) Mint BATs up to desired pool size
	console.log(`\nEnsuring min ${DESIRED_BATS} BATS...`);
	await auth.ensure(DESIRED_BATS);

	// 4) Dump the pool and an example Blind-auth header
	const pool = auth.exportPool();
	console.log(`\nMinted BATs in pool: ${pool.length}`);
	pool.slice(0, Math.min(pool.length, 3)).forEach((p, i) => {
		console.log(`BAT #${i + 1}: id=${p.id}, C=${p.C.slice(0, 16)}..., secret=${p.secret}...`);
	});

	// 5) Consume one BAT on a protected endpoint
	if (pool.length > 0) {
		console.log('\nRequesting a BAT for a protected endpoint, consumes one token...');
		const bat = await auth.getBlindAuthToken({ method: 'POST', path: '/v1/swap' });
		console.log('\nExample Blind-auth header for the first BAT:');
		console.log('  Blind-auth:', bat);
		console.log('\nNote, requesting a BAT consumes it.');
		console.log(`\nMinted BATs in pool after getting token: ${auth.exportPool().length}`);
	}

	// 6) Mint some proofs and receive them
	console.log('\nObtain a mint quote for 100 sats...');
	const request = await wallet.createMintQuoteBolt11(100);
	await new Promise((res) => setTimeout(res, 3000));
	console.log('\nMint the proofs...');
	const proofs = await wallet.mintProofs(100, request.quote);
	console.log(
		'\nMinted 100 sats.',
		proofs.map((p) => p.amount),
	);
	console.log(`\nMinted BATs in pool: ${auth.exportPool().length}`);

	console.log('\nSend 10 sats...');
	const sendResponse = await wallet.send(10, proofs);
	const encoded = getEncodedToken({ mint: MINT_URL, proofs: sendResponse.send });
	console.log('\nSend token...', encoded);

	console.log('\nReceive the token...');
	const response = await wallet.receive(encoded);
	console.log(
		'\nReceived 10 sats.',
		response.map((p) => p.amount),
	);
	console.log(`\nMinted BATs in pool: ${auth.exportPool().length}`);

	console.log('\nDone.');
}

// -------- helpers --------

function extractCodeAndState(input: string): { code?: string; gotState?: string } {
	try {
		const url = new URL(input.trim());
		return {
			code: url.searchParams.get('code') ?? undefined,
			gotState: url.searchParams.get('state') ?? undefined,
		};
	} catch {
		throw new Error('Please paste the full redirected URL including ?code=…');
	}
}

function prompt(q: string): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) =>
		rl.question(q, (ans) => {
			rl.close();
			resolve(ans);
		}),
	);
}

function decodeJwtPayload(token: string) {
	const base64Url = token.split('.')[1];
	const json = Bytes.toString(Bytes.fromBase64(base64Url));
	return JSON.parse(json);
}

main().catch((err) => {
	console.error('Error in auth PKCE demo:', err);
	process.exit(1);
});
