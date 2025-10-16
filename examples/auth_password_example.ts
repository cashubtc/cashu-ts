// +++++++++ Example of an auth wallet implementation with PASSWORD AUTH +++++++++
// A local mint instance should be running on port 3338. Startup command:
// docker run -d -p 3338:3338 --name nutshell -e MINT_LIGHTNING_BACKEND=FakeWallet -e MINT_INPUT_FEE_PPK=100 -e MINT_LISTEN_HOST=0.0.0.0 -e MINT_LISTEN_PORT=3338 -e MINT_PRIVATE_KEY=TEST_PRIVATE_KEY cashubtc/nutshell:0.16.0 poetry run mint
// run the example with the following command:
//
// 	OIDC_USERNAME="your-user" \
// 	OIDC_PASSWORD="your-pass" \
// 	npx tsx examples/auth_password_example.ts

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { ConsoleLogger, createAuthWallet } from '../src';
const MINT_URL = 'http://localhost:3338';
const DESIRED_BATS = 2;

// Expect these in the environment
const USERNAME = process.env.OIDC_USERNAME || '';
const PASSWORD = process.env.OIDC_PASSWORD || '';

async function main() {
	if (!USERNAME || !PASSWORD) {
		throw new Error('Set OIDC_USERNAME and OIDC_PASSWORD env vars to use the password grant.');
	}

	console.log('Auth BATs demo (password grant), mint:', MINT_URL);

	// 1) Build AuthManager,  OIDC client from the mint’s NUT-21 config
	const { auth, wallet, oidc } = await createAuthWallet(MINT_URL, {
		authPool: DESIRED_BATS,
		oidc: { scope: 'openid offline_access' },
		// logger: new ConsoleLogger('debug'),
	});

	// 2) Perform the password grant (ROPC)
	console.log('Logging in via password grant…');
	const tokens = await oidc.passwordGrant(USERNAME, PASSWORD);
	console.log('Received access token (truncated):', (tokens.access_token ?? '').slice(0, 24), '…');

	// 3) Mint BATs up to desired pool size
	console.log('\nEnsuring min 2 BATS...');
	await auth.ensure(DESIRED_BATS);

	// 4) Dump the pool and an example Blind-auth header
	const pool = auth.exportPool();
	console.log(`\nMinted BATs in pool: ${pool.length}`);
	pool.slice(0, Math.min(pool.length, 3)).forEach((p, i) => {
		console.log(`BAT #${i + 1}: id=${p.id}, C=${p.C.slice(0, 16)}..., secret=${p.secret}...`);
	});

	// 3) Mint BATs up to desired pool size
	console.log('\nEnsuring min 5 BATS...');
	await auth.ensure(5);
	console.log(`\nMinted BATs in pool: ${auth.exportPool().length}`);

	if (pool.length > 0) {
		// Get a token
		console.log('\nRequesting a BAT for a protected endpoint (consumes one token)...');
		const bat = await auth.getBlindAuthToken({ method: 'POST', path: '/v1/swap' });
		console.log('\nExample Blind-auth header for the first BAT:');
		console.log('  Blind-auth:', bat);
		console.log('\nNote: using a BAT consumes it, so do not reuse this header in production.');
		console.log(`\nMinted BATs in pool after getting token: ${auth.exportPool().length}`);
	}

	console.log('\nDone.');
}

main().catch((err) => {
	console.error('Error in auth password demo:', err);
	process.exit(1);
});
