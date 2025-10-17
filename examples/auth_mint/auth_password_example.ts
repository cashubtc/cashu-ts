// +++++++++ Example of an auth wallet implementation with PASSWORD AUTH +++++++++
// Run the example with the following commands:
//
// 	# Start the auth mint:
// 	make up
//
//  # Run the demo:
//  make demo
//
//	# Experiment with different users:
// 	OIDC_USER="your-pass" \
// 	OIDC_PASSWORD="your-pass" \
// 	npx tsx auth_password_example.ts
//
// 	# When finished, tear down the auth mint with:
//  make down

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { ConsoleLogger, createAuthWallet } from '../../src';
import { Bytes, getEncodedToken } from '../../src/utils';
const MINT_URL = 'http://localhost:3338';
const DESIRED_BATS = 3;

// Expect these in the environment
const USERNAME = process.env.OIDC_USERNAME || 'test@test.com';
const PASSWORD = process.env.OIDC_PASSWORD || 'testtest';

async function main() {
	if (!USERNAME || !PASSWORD) {
		throw new Error('Set OIDC_USERNAME and OIDC_PASSWORD env vars to use the password grant.');
	}

	console.log('Auth BATs demo (password grant), mint:', MINT_URL);

	// 1) Build AuthManager,  OIDC client from the mint’s NUT-21 config
	const { auth, wallet, oidc } = await createAuthWallet(MINT_URL, {
		authPool: DESIRED_BATS,
		oidc: { scope: 'openid offline_access' },
		logger: new ConsoleLogger('debug'),
	});

	// 2) Perform the password grant (ROPC)
	console.log('Logging in via password grant…');
	const tokens = await oidc.passwordGrant(USERNAME, PASSWORD);
	console.log('Received access token (truncated):', (tokens.access_token ?? '').slice(0, 24), '…');
	console.log('Decoded access token payload:', decodeJwtPayload(tokens.access_token!));

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
		// Get a token
		console.log('\nRequesting a BAT for a protected endpoint (consumes one token)...');
		const bat = await auth.getBlindAuthToken({ method: 'POST', path: '/v1/swap' });
		console.log('\nExample Blind-auth header for the first BAT:');
		console.log('  Blind-auth:', bat);
		console.log('\nNote: requesting a BAT consumes it.');
		console.log(`\nMinted BATs in pool after getting token: ${auth.exportPool().length}`);
	}

	// 6) Mint some proofs and receive them
	console.log('\nObtain a mint quote for 100 sats...');
	const request = await wallet.createMintQuoteBolt11(100);
	await new Promise((res) => setTimeout(res, 1000));
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

function decodeJwtPayload(token: string) {
	const base64Url = token.split('.')[1];
	const json = Bytes.toString(Bytes.fromBase64(base64Url));
	return JSON.parse(json);
}

main().catch((err) => {
	console.error('Error in auth password demo:', err);
	process.exit(1);
});
