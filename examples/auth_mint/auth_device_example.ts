// +++++++++ Example of an auth wallet implementation with DEVICE CODE AUTH +++++++++
// Run the example with the following commands:
//
// 	make up
//  make demo-device
//  make down
//

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { createAuthWallet, getEncodedToken } from '../../src';
const MINT_URL = 'http://localhost:3338';
const DESIRED_BATS = 2;

async function main() {
	console.log('Auth BATs demo (device code grant), mint:', MINT_URL);

	// 1) Build AuthManager, Wallet, and OIDC client from the mint’s NUT-21 config
	const { auth, wallet, oidc } = await createAuthWallet(MINT_URL, {
		authPool: DESIRED_BATS,
		oidc: { scope: 'openid offline_access' },
	});

	// 2) Start the device authorization flow
	console.log('\nStarting device code flow...');
	const start = await oidc.startDeviceAuth(5);

	console.log('\nOpen this URL in a browser and enter the code:');
	console.log('  ', start.verification_uri);
	if (start.verification_uri_complete) {
		console.log('\nOr open this one directly (includes the code):');
		console.log('  ', start.verification_uri_complete);
	}
	console.log('\nUser code:', start.user_code);
	console.log('\nWaiting for authorisation... press Ctrl+C to cancel.\n');

	// enable cancellation
	let cancelled = false;
	const onSigInt = () => {
		if (!cancelled) {
			cancelled = true;
			start.cancel();
			console.error('\nCancelled by user.');
			process.exit(1);
		}
	};
	process.once('SIGINT', onSigInt);

	// Poll until tokens arrive
	const tokens = await start.poll();
	console.log('Received access token (truncated):', (tokens.access_token ?? '').slice(0, 24), '…');

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

	// tidy up
	process.off('SIGINT', onSigInt);
	console.log('\nDone.');
}

main().catch((err) => {
	console.error('Error in auth device demo:', err);
	process.exit(1);
});
