// +++++++++ Example of an auth wallet implementation with DEVICE CODE AUTH +++++++++
// A local mint instance should be running on port 3338. Startup command:
// docker run -d -p 3338:3338 --name nutshell -e MINT_LIGHTNING_BACKEND=FakeWallet -e MINT_INPUT_FEE_PPK=100 -e MINT_LISTEN_HOST=0.0.0.0 -e MINT_LISTEN_PORT=3338 -e MINT_PRIVATE_KEY=TEST_PRIVATE_KEY cashubtc/nutshell:0.16.0 poetry run mint
// run the example with the following command: `npx tsx examples/auth_device_example.ts`

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { createAuthWallet } from '../src';
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

	// 3) Poll until tokens arrive
	const tokens = await start.poll();
	console.log('Received access token (truncated):', (tokens.access_token ?? '').slice(0, 24), '…');

	// 4) Mint BATs up to desired pool size
	console.log('\nEnsuring min 2 BATS...');
	await auth.ensure(DESIRED_BATS);

	// 5) Dump the pool and an example Blind-auth header
	const pool = auth.exportPool();
	console.log(`\nMinted BATs in pool: ${pool.length}`);
	pool.slice(0, Math.min(pool.length, 3)).forEach((p, i) => {
		console.log(`BAT #${i + 1}: id=${p.id}, C=${p.C.slice(0, 16)}..., secret=${p.secret}...`);
	});

	// 6) Mint a few more
	console.log('\nEnsuring min 5 BATS...');
	await auth.ensure(5);
	console.log(`\nMinted BATs in pool: ${auth.exportPool().length}`);

	// 7) Consume one BAT on a protected endpoint
	if (pool.length > 0) {
		console.log('\nRequesting a BAT for a protected endpoint (consumes one token)...');
		const bat = await auth.getBlindAuthToken({ method: 'POST', path: '/v1/swap' });
		console.log('\nExample Blind-auth header for the first BAT:');
		console.log('  Blind-auth:', bat);
		console.log('\nNote: using a BAT consumes it, so do not reuse this header in production.');
		console.log(`\nMinted BATs in pool after getting token: ${auth.exportPool().length}`);
	}

	// tidy up
	process.off('SIGINT', onSigInt);
	console.log('\nDone.');
}

main().catch((err) => {
	console.error('Error in auth device demo:', err);
	process.exit(1);
});
