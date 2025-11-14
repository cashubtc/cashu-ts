// +++++++++++++++++++++ CI Integration Test ++++++++++++++++++
// To run locally, spin up a local mint instance on port 3338.
//
// Startup command:
//
// - CDK Mint:
// docker run -d -p 3338:3338 --name cdk-mint  -e CDK_MINTD_DATABASE=sqlite  -e CDK_MINTD_LN_BACKEND=fakewallet  -e CDK_MINTD_INPUT_FEE_PPK=100  -e CDK_MINTD_LISTEN_HOST=0.0.0.0  -e CDK_MINTD_LISTEN_PORT=3338  -e CDK_MINTD_FAKE_WALLET_MIN_DELAY=1  -e CDK_MINTD_FAKE_WALLET_MAX_DELAY=1 -e CDK_MINTD_MNEMONIC='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' cashubtc/mintd:latest
//
// - Nutshell:
// docker run -d -p 3338:3338 --name nutshell -e MINT_LIGHTNING_BACKEND=FakeWallet -e MINT_INPUT_FEE_PPK=100 -e MINT_LISTEN_HOST=0.0.0.0 -e MINT_LISTEN_PORT=3338 -e MINT_PRIVATE_KEY=TEST_PRIVATE_KEY -e FAKEWALLET_DELAY_PAYMENT=TRUE -e FAKEWALLET_DELAY_OUTGOING_PAYMENT=1 -e FAKEWALLET_DELAY_INCOMING_PAYMENT=1 -e MINT_TRANSACTION_RATE_LIMIT_PER_MINUTE=100 cashubtc/nutshell:0.18.1 poetry run mint
//
// NOTE: Both Nutshell & CDK remember ln invoices, so you will need to tear down the mint and
// start over to run the tests again:
//
// - CDK Mint:
// docker rm -f -v cdk-mint
//
// - Nutshell:
// docker rm -f -v nutshell

import dns from 'node:dns';
import { vi, test, describe, expect } from 'vitest';
import { secp256k1, schnorr } from '@noble/curves/secp256k1';
import {
	Mint,
	Wallet,
	CheckStateEnum,
	MeltQuoteState,
	MintQuoteState,
	type MintKeys,
	type Proof,
	type ProofState,
	type Token,
	MintOperationError,
	injectWebSocketImpl,
	OutputData,
	OutputDataFactory,
	OutputConfig,
	OutputType,
	P2PKBuilder,
	ConsoleLogger,
} from '../src';
import ws from 'ws';
import {
	getDecodedToken,
	getEncodedToken,
	getEncodedTokenV4,
	hexToNumber,
	numberToHexPadded64,
	sumProofs,
} from '../src/utils';
import { hexToBytes, bytesToHex, randomBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha2';
dns.setDefaultResultOrder('ipv4first');

const mintUrl = 'http://localhost:3338';
const unit = 'sat';

injectWebSocketImpl(ws as unknown as typeof WebSocket);

// Set timeouts for this test suite file
vi.setConfig({
	testTimeout: 10_000,
	hookTimeout: 10_000,
	maxConcurrency: 1,
});

// Helper to wait until mint quote is paid
async function untilMintQuotePaid(wallet, quote) {
	try {
		await wallet.on.onceMintPaid(quote.quote, {
			timeoutMs: 6_000,
		});
	} catch (e) {
		console.warn('Not paid in time or aborted', e);
	}
}

function expectNUT10SecretDataToEqual(p: Array<Proof>, s: string) {
	p.forEach((p) => {
		const parsedSecret = JSON.parse(p.secret);
		expect(parsedSecret[1].data).toBe(s);
	});
}

function expectBlindedSecretDataToEqualECDH(
	proofs: Array<Proof>,
	bobPrivHex: Uint8Array, // receiver’s private key
	bobPubHex: string, // receiver’s SEC1-compressed pubkey P
) {
	for (const p of proofs) {
		expect(p.p2pk_e).toBeDefined();

		const E = secp256k1.Point.fromHex(p.p2pk_e as string);
		const parsed = JSON.parse(p.secret) as ['P2PK', { data: string; tags?: string[][] }];
		const blindedData = parsed[1].data; // this is P′ for slot 0

		// Z = p · E
		const pBig = secp256k1.Point.Fn.fromBytes(bobPrivHex);
		const Z = E.multiply(pBig);
		const Zx = Z.toBytes(false).slice(1, 33); // 32-byte X

		// r = SHA-256(DST || Zx || kid || i=0) mod n, retry once if zero
		const DST = new TextEncoder().encode('Cashu_P2BK_v1');
		const kid = hexToBytes(p.id);
		let r = secp256k1.Point.Fn.fromBytes(sha256(new Uint8Array([...DST, ...Zx, ...kid, 0x00])));
		if (r === 0n) {
			r = secp256k1.Point.Fn.fromBytes(sha256(new Uint8Array([...DST, ...Zx, ...kid, 0x00, 0xff])));
			if (r === 0n) throw new Error('P2BK: tweak derivation failed in test');
		}

		const P = secp256k1.Point.fromHex(bobPubHex);
		const Pprime = P.add(secp256k1.Point.BASE.multiply(r)).toHex(true);
		expect(blindedData).toBe(Pprime);
	}
}

describe('mint api', () => {
	test('get keys', async () => {
		const mint = new Mint(mintUrl);
		const keys = await mint.getKeys();
		expect(keys).toBeDefined();
	});
	test('get keysets', async () => {
		const mint = new Mint(mintUrl);
		const keysets = await mint.getKeySets();
		expect(keysets).toBeDefined();
		expect(keysets.keysets).toBeDefined();
		expect(keysets.keysets.length).toBeGreaterThan(0);
	});
	test('get info', async () => {
		const mint = new Mint(mintUrl);
		const info = await mint.getInfo();
		// console.log('mint info: ', info);
		expect(info).toBeDefined();
	});
	test('request mint', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(100);
		await untilMintQuotePaid(wallet, request);
		expect(request).toBeDefined();
		const mintQuote = await wallet.checkMintQuoteBolt11(request.quote);
		expect(mintQuote).toBeDefined();
	});
	test('mint tokens', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(1337);
		await untilMintQuotePaid(wallet, request);
		expect(request).toBeDefined();
		expect(request.request).toContain('lnbc1337');
		const proofs = await wallet.mintProofsBolt11(1337, request.quote);
		expect(proofs).toBeDefined();
		// expect that the sum of all tokens.proofs.amount is equal to the requested amount
		expect(sumProofs(proofs)).toBe(1337);
	});
	test('invoice with description', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const quote = await wallet.createMintQuoteBolt11(100, 'test description');
		await untilMintQuotePaid(wallet, quote);
		expect(quote).toBeDefined();
		// console.log(`invoice with description: ${quote.request}`);
	});
	test('get fee for external invoice', async () => {
		const invoice =
			'lnbc20u1p3u27nppp5pm074ffk6m42lvae8c6847z7xuvhyknwgkk7pzdce47grf2ksqwsdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzpgxqyz5vqsp5sw6n7cztudpl5m5jv3z6dtqpt2zhd3q6dwgftey9qxv09w82rgjq9qyyssqhtfl8wv7scwp5flqvmgjjh20nf6utvv5daw5h43h69yqfwjch7wnra3cn94qkscgewa33wvfh7guz76rzsfg9pwlk8mqd27wavf2udsq3yeuju';
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const fee = (await wallet.createMeltQuoteBolt11(invoice)).fee_reserve;
		expect(fee).toBeDefined();
		// because external invoice, fee should be > 0
		expect(fee).toBeGreaterThan(0);
	});
	test('pay external invoice', async () => {
		const invoice =
			'lnbc20u1p5tj77hsp5hva2cwk48eajjatzje0wwyanfl2dmu87h7c30mnurfmu5mr6ypjspp53cmmk6mgvdrp7xpuf9vfyqyxjl5ce9dqs4prc6jh6eqf5ldmqvvshp55qf3c2rxuxqahgt2d7yp6xdrjdt5r2sm2uqsatyn3v7u0k09mnhqxq9z0rgqcqpnrzjq0xp6zfjhwvmq6tltd09jcdc82ml6eh3alzvnaw8httxcx7tu78syrvfkqqqm0qqqyqqqqlgqqqvx5qqjq9qxpqysgqunatemrzxl5srnxy4jpqeu4rhdfvkx0agvqeumkmx4mvsusc2er4t4h9jg396mfxp0lu72nueehapde6cv42ldd80pryz8jrxky3k5qqm6f4zx';
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(3000);
		await untilMintQuotePaid(wallet, request);
		const proofs = await wallet.mintProofsBolt11(3000, request.quote);
		const meltQuote = await wallet.createMeltQuoteBolt11(invoice);
		const fee = meltQuote.fee_reserve;
		expect(fee).toBeGreaterThan(0);
		// get the quote from the mint
		const quote_ = await wallet.checkMeltQuoteBolt11(meltQuote.quote);
		expect(quote_).toBeDefined();
		const sendResponse = await wallet.send(2000 + fee, proofs, { includeFees: true });
		const response = await wallet.meltProofsBolt11(meltQuote, sendResponse.send);
		expect(response).toBeDefined();
		// expect that we have not received the fee back, since it was external
		expect(response.change.reduce((a, b) => a + b.amount, 0)).toBeLessThan(fee);
		// check states of spent and kept proofs after payment
		const sentProofsStates = await wallet.checkProofsStates(sendResponse.send);
		expect(sentProofsStates).toBeDefined();
		// expect that all proofs are spent, i.e. all are CheckStateEnum.SPENT
		sentProofsStates.forEach((state) => {
			expect(state.state).toBe(CheckStateEnum.SPENT);
			expect(state.witness).toBeNull();
		});
		// expect none of the sendResponse.keep to be spent
		const keepProofsStates = await wallet.checkProofsStates(sendResponse.keep);
		expect(keepProofsStates).toBeDefined();
		keepProofsStates.forEach((state) => {
			expect(state.state).toBe(CheckStateEnum.UNSPENT);
			expect(state.witness).toBeNull();
		});
	});
	test('test send tokens exact without previous split', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(64);
		await untilMintQuotePaid(wallet, request);
		const proofs = await wallet.mintProofsBolt11(64, request.quote);
		const sendResponse = await wallet.send(64, proofs);
		expect(sendResponse).toBeDefined();
		expect(sendResponse.send).toBeDefined();
		expect(sendResponse.keep).toBeDefined();
		expect(sendResponse.send.length).toBe(1);
		expect(sendResponse.keep.length).toBe(0);
		expect(sumProofs(sendResponse.send)).toBe(64);
	});
	test('test send tokens with change', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(100);
		await untilMintQuotePaid(wallet, request);
		const proofs = await wallet.mintProofsBolt11(100, request.quote); // 4,32,64
		const sendResponse = await wallet.send(10, proofs, { includeFees: false });
		expect(sendResponse).toBeDefined();
		expect(sendResponse.send).toBeDefined();
		expect(sendResponse.keep).toBeDefined();
		expect(sendResponse.send.length).toBe(2); // 2,8
		// The 32 would have been selected (fee: 1 sat), leaving 4,64 unspent
		// We expect: 16, 4, 1 change + 4,64 unspent = 5 proofs (total 89)
		expect(sendResponse.keep.length).toBe(5);
		expect(sumProofs(sendResponse.send)).toBe(10);
		expect(sumProofs(sendResponse.keep)).toBe(89);
	});
	test('receive tokens with previous split', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(100);
		await untilMintQuotePaid(wallet, request);
		const proofs = await wallet.mintProofsBolt11(100, request.quote);
		const sendResponse = await wallet.send(10, proofs);
		const encoded = getEncodedToken({ mint: mintUrl, proofs: sendResponse.send });
		const response = await wallet.receive(encoded);
		expect(response).toBeDefined();
	});
	test('receive tokens with previous mint', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(64);
		await untilMintQuotePaid(wallet, request);
		const proofs = await wallet.mintProofsBolt11(64, request.quote);
		const encoded = getEncodedToken({ mint: mintUrl, proofs: proofs });
		const response = await wallet.receive(encoded);
		expect(response).toBeDefined();
	});
	test('send and receive p2pk', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const privKeyAlice = secp256k1.utils.randomSecretKey();
		const pubKeyAlice = bytesToHex(secp256k1.getPublicKey(privKeyAlice));
		const privKeyBob = secp256k1.utils.randomSecretKey();
		const pubKeyBob = bytesToHex(secp256k1.getPublicKey(privKeyBob));
		console.log('pubKeyAlice:', pubKeyAlice);
		console.log('pubKeyBob:', pubKeyBob);
		// Mint some proofs
		const request = await wallet.createMintQuoteBolt11(128);
		await untilMintQuotePaid(wallet, request);
		const mintedProofs = await wallet.mintProofsBolt11(128, request.quote);
		// Send them P2PK locked to Bob
		const { send } = await wallet.ops.send(64, mintedProofs).asP2PK({ pubkey: pubKeyBob }).run();
		expectNUT10SecretDataToEqual(send, pubKeyBob);
		const encoded = getEncodedToken({ mint: mintUrl, proofs: send });
		// Try and receive them with Alice's secret key (should fail)
		const result = await wallet
			.receive(encoded, { privkey: bytesToHex(privKeyAlice) })
			.catch((e) => e);
		expect(result).toBeInstanceOf(MintOperationError);
		const e = result as MintOperationError;
		expect(e.name).toBe('MintOperationError');
		expect([0, 20008]).toContain(e.code); // nutshell + cdk
		expect(e.message.toLowerCase()).toMatch(/witness.*p2pk.*signature/); // nutshell + cdk
		// Try and receive them with Bob's secret key (should suceed)
		const proofs = await wallet.receive(encoded, { privkey: bytesToHex(privKeyBob) });
		expect(
			proofs.reduce((curr, acc) => {
				return curr + acc.amount;
			}, 0),
		).toBe(63);
	});
	test('send and receive p2pk with additional tags', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();

		const privKeyAlice = secp256k1.utils.randomSecretKey();
		const pubKeyAlice = bytesToHex(secp256k1.getPublicKey(privKeyAlice));
		// console.log('pubKeyAlice:', pubKeyAlice);

		// Mint some proofs
		const request = await wallet.createMintQuoteBolt11(128);
		await untilMintQuotePaid(wallet, request);
		const mintedProofs = await wallet.mintProofs(128, request.quote);

		// Send them P2PK locked to Alice, with extra tags
		const p2pk = new P2PKBuilder()
			.addLockPubkey(pubKeyAlice)
			.addTags([
				['e', 'abc'],
				['p', '123'],
			])
			.addTag('msg', 'hello')
			.toOptions();
		const { send } = await wallet.ops.send(64, mintedProofs).asP2PK(p2pk).run();
		expectNUT10SecretDataToEqual(send, pubKeyAlice);
		send.forEach((p) => {
			const parsedSecret = JSON.parse(p.secret);
			expect(parsedSecret[1].tags).toStrictEqual([
				['e', 'abc'],
				['p', '123'],
				['msg', 'hello'],
			]);
		});
		const encoded = getEncodedToken({ mint: mintUrl, proofs: send });

		// Try and receive them with Alice's secret key (should succeed)
		const proofs = await wallet.receive(encoded, { privkey: bytesToHex(privKeyAlice) });

		expect(
			proofs.reduce((curr, acc) => {
				return curr + acc.amount;
			}, 0),
		).toBe(63);
	});

	test('send and receive p2bk', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();

		const privKeyAlice = secp256k1.utils.randomSecretKey();
		const pubKeyAlice = bytesToHex(secp256k1.getPublicKey(privKeyAlice));

		const privKeyBob = secp256k1.utils.randomSecretKey();
		const pubKeyBob = bytesToHex(secp256k1.getPublicKey(privKeyBob));
		console.log('pubKeyAlice:', pubKeyAlice);
		console.log('pubKeyBob:', pubKeyBob);
		console.log('privKeyAlice:', bytesToHex(privKeyAlice));
		console.log('privKeyBob:', bytesToHex(privKeyBob));

		// Mint some proofs
		const request = await wallet.createMintQuoteBolt11(128);
		await untilMintQuotePaid(wallet, request);
		const mintedProofs = await wallet.mintProofsBolt11(128, request.quote);

		// Send them P2BK locked to Bob
		const p2pkOpts = new P2PKBuilder().addLockPubkey(pubKeyBob).blindKeys().toOptions();
		const { send } = await wallet.ops.send(64, mintedProofs).asP2PK(p2pkOpts).run();
		console.log('P2BK SEND', send);
		expectBlindedSecretDataToEqualECDH(send, privKeyBob, pubKeyBob);
		const encoded = getEncodedToken({ mint: mintUrl, proofs: send });
		console.log('P2BK token', encoded);

		// Try and receive them with Bob's secret key (should suceed)
		const proofs = await wallet.receive(encoded, { privkey: bytesToHex(privKeyBob) });
		console.log('P2BK RECEIVE', proofs);
		expect(
			proofs.reduce((curr, acc) => {
				return curr + acc.amount;
			}, 0),
		).toBe(63);
	});

	test('send and receive p2bk SCHNORR', async () => {
		const wallet = new Wallet(mintUrl, { unit, logger: new ConsoleLogger('debug') });
		await wallet.loadMint();

		const privKeyAlice = schnorr.utils.randomSecretKey();
		const pubKeyAlice = '02' + bytesToHex(schnorr.getPublicKey(privKeyAlice));
		const privKeyBob = schnorr.utils.randomSecretKey();
		const pubKeyBob = '02' + bytesToHex(schnorr.getPublicKey(privKeyBob));
		console.log('pubKeyAlice:', pubKeyAlice);
		console.log('pubKeyBob:', pubKeyBob);
		console.log('privKeyAlice:', bytesToHex(privKeyAlice));
		console.log('privKeyBob:', bytesToHex(privKeyBob));

		// Mint some proofs
		const request = await wallet.createMintQuoteBolt11(128);
		await untilMintQuotePaid(wallet, request);
		const mintedProofs = await wallet.mintProofsBolt11(128, request.quote);

		// Send them P2BK locked to Bob
		const p2pkOpts = new P2PKBuilder().addLockPubkey(pubKeyBob).blindKeys().toOptions();
		const { send } = await wallet.ops.send(64, mintedProofs).asP2PK(p2pkOpts).run();
		console.log('P2BK SEND', send);
		expectBlindedSecretDataToEqualECDH(send, privKeyBob, pubKeyBob);
		const encoded = getEncodedToken({ mint: mintUrl, proofs: send });
		console.log('P2BK token', encoded);

		// Try and receive them with Bob's secret key (should suceed)
		const proofs = await wallet.receive(encoded, { privkey: bytesToHex(privKeyBob) });
		console.log('P2BK RECEIVE', proofs);

		expect(
			proofs.reduce((curr, acc) => {
				return curr + acc.amount;
			}, 0),
		).toBe(63);
	});

	test('mint and melt p2pk', async () => {
		const invoice =
			'lnbc20u1p5tnrdtsp5xaus66jztyj4f4m9wuza7ay9994d5dals6dluvw80dduhhulgxvspp5gsdp48uz9x20etle8j7muweujzxd2w4ay2v6cwzwjy7pff44r4gqhp5jujtt4hgd57c5hskstzkjkxqtfmctfvpfc3wmt3h42a9f2p9sqcsxq9z0rgqcqpnrzjqvxr759n8jl5226n47zw6325pyffxqlpyrjh9ztswvnglhrmtcsfzrw8mqqqf2cqqqqqqqlgqqqqzhsqjq9qxpqysgq2rtnpkqzmwmuf6cw653s63552qf0hgst6xzdywkgekhz836ayrz572cm72r7ejj7w0ktgldlwfu33fpr9dxywx5wqy4tte7smpa9q4gqaaydvv';
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const privKeyBob = secp256k1.utils.randomSecretKey();
		const pubKeyBob = secp256k1.getPublicKey(privKeyBob);
		const mintRequest = await wallet.createMintQuoteBolt11(3000);
		await untilMintQuotePaid(wallet, mintRequest);
		const proofs = await wallet.ops
			.mintBolt11(3000, mintRequest.quote)
			.asP2PK({
				pubkey: bytesToHex(pubKeyBob),
			})
			.run();
		const meltRequest = await wallet.createMeltQuoteBolt11(invoice);
		const fee = meltRequest.fee_reserve;
		expect(fee).toBeGreaterThan(0);
		const signedProofs = wallet.signP2PKProofs(proofs, bytesToHex(privKeyBob));
		const response = await wallet.meltProofsBolt11(meltRequest, signedProofs);
		expect(response).toBeDefined();
		expect(response.quote.state == MeltQuoteState.PAID).toBe(true);
	});
	test('mint deterministic', async () => {
		const hexSeed = bytesToHex(randomBytes(64));
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const data = OutputData.createSingleDeterministicData(1, hexToBytes(hexSeed), 1, keys.id);
		const quote = await wallet.createMintQuoteBolt11(1);
		await untilMintQuotePaid(wallet, quote);
		const proof = await wallet.mintProofsBolt11(
			1,
			quote.quote,
			{},
			{ type: 'custom', data: [data] },
		);
		expect(proof).toBeDefined();
	});
	test('websocket updates', async () => {
		const mint = new Mint(mintUrl);
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const mintQuote = await wallet.createMintQuoteBolt11(21);
		const callback = vi.fn();
		const res = await new Promise(async (res, rej) => {
			const unsub = await wallet.on.mintQuoteUpdates(
				[mintQuote.quote],
				(p) => {
					if (p.state === MintQuoteState.PAID) {
						callback();
						res(1);
						unsub();
					}
				},
				(e) => {
					console.log(e);
					unsub();
					rej(e);
				},
			);
		});
		mint.disconnectWebSocket();
		expect(res).toBe(1);
		expect(callback).toBeCalled();
	});
	test('websocket mint quote updates on multiple ids', async () => {
		const mint = new Mint(mintUrl);
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const mintQuote1 = await wallet.createMintQuoteBolt11(21);
		const mintQuote2 = await wallet.createMintQuoteBolt11(22);
		const res = await new Promise(async (res, rej) => {
			let quotesPaid = 0;
			const unsub = await wallet.on.mintQuoteUpdates(
				[mintQuote1.quote, mintQuote2.quote],
				(update) => {
					if (update.state == MintQuoteState.PAID) {
						quotesPaid++;
					}
					if (quotesPaid === 2) {
						unsub();
						res(1);
					}
				},
				(e) => {
					console.log(e);
					unsub();
					rej(e);
				},
			);
		});
		mint.disconnectWebSocket();
		expect(res).toBe(1);
		expect(mint.webSocketConnection?.activeSubscriptions.length).toBe(0);
	});
	test('websocket proof state + mint quote updates', async () => {
		const mint = new Mint(mintUrl);
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const quote = await wallet.createMintQuoteBolt11(63);
		await new Promise((res, rej) => {
			wallet.on.mintQuotePaid(quote.quote, res, rej);
		});
		const proofs = await wallet.mintProofsBolt11(63, quote.quote);
		console.log(
			'proofs',
			proofs.map((p) => p.amount),
		);
		await new Promise<ProofState>((res) => {
			wallet.on.proofStateUpdates(
				proofs,
				(p) => {
					// console.log(p);
					if (p.state === CheckStateEnum.SPENT) {
						res(p);
					}
				},
				(e) => {
					console.log(e);
				},
			);
			// Wallet will try to avoid a swap if possible, so
			// let's give it a keysetID to force one.
			const keysetId = wallet.keyChain.getCheapestKeyset().id;
			wallet.send(21, proofs, { keysetId }); // fire and forget
		});
		mint.disconnectWebSocket();
	}, 10000);
	test('mint with signed quote and payload', async () => {
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const privkey = 'd56ce4e446a85bbdaa547b4ec2b073d40ff802831352b8272b7dd7a4de5a7cac';
		const pubkey = bytesToHex(secp256k1.getPublicKey(hexToBytes(privkey)));
		const quote = await wallet.createLockedMintQuote(63, pubkey);
		await untilMintQuotePaid(wallet, quote);
		const proofs = await wallet.mintProofsBolt11(63, quote, { privkey });
		expect(proofs).toBeDefined();
		expect(proofs.length).toBeGreaterThan(0);
	});
});
describe('dleq', () => {
	test('mint and check dleq', async () => {
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const NUT12 = wallet.getMintInfo().nuts['12'];
		if (NUT12 == undefined || !NUT12.supported) {
			throw new Error('Cannot run this test: mint does not support NUT12');
		}
		const mintRequest = await wallet.createMintQuoteBolt11(3000);
		await untilMintQuotePaid(wallet, mintRequest);
		const proofs = await wallet.mintProofsBolt11(3000, mintRequest.quote);
		proofs.forEach((p) => {
			expect(p).toHaveProperty('dleq');
			expect(p.dleq).toHaveProperty('s');
			expect(p.dleq).toHaveProperty('e');
			expect(p.dleq).toHaveProperty('r');
		});
	});
	test('send and receive token with dleq', async () => {
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const NUT12 = wallet.getMintInfo().nuts['12'];
		if (NUT12 == undefined || !NUT12.supported) {
			throw new Error('Cannot run this test: mint does not support NUT12');
		}
		const mintRequest = await wallet.createMintQuoteBolt11(8);
		await untilMintQuotePaid(wallet, mintRequest);
		const proofs = await wallet.mintProofsBolt11(8, mintRequest.quote);
		const { send } = wallet.sendOffline(4, proofs, { requireDleq: true });
		send.forEach((p) => {
			expect(p.dleq).toBeDefined();
			expect(p.dleq?.r).toBeDefined();
		});
		const token = {
			mint: mintUrl,
			proofs: send,
		} as Token;
		const encodedToken = getEncodedTokenV4(token);
		const newProofs = await wallet.receive(encodedToken, { requireDleq: true });
		expect(newProofs).toBeDefined();
	});
	test('send strip dleq', async () => {
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const NUT12 = wallet.getMintInfo().nuts['12'];
		if (NUT12 == undefined || !NUT12.supported) {
			throw new Error('Cannot run this test: mint does not support NUT12');
		}
		const mintRequest = await wallet.createMintQuoteBolt11(8);
		await untilMintQuotePaid(wallet, mintRequest);
		const proofs = await wallet.mintProofsBolt11(8, mintRequest.quote);
		const { send } = await wallet.send(4, proofs);
		send.forEach((p) => expect(p.dleq).toBeDefined());
		const encoded = getEncodedToken({ proofs: send, mint: mintUrl }, { removeDleq: true });
		const decoded = getDecodedToken(encoded);
		decoded.proofs.forEach((p) => expect(p.dleq).toBeUndefined());
	});
	test('send not enough proofs when dleq is required', async () => {
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const NUT12 = wallet.getMintInfo().nuts['12'];
		if (NUT12 == undefined || !NUT12.supported) {
			throw new Error('Cannot run this test: mint does not support NUT12');
		}
		const mintRequest = await wallet.createMintQuoteBolt11(8);
		await untilMintQuotePaid(wallet, mintRequest);
		let proofs = await wallet.mintProofsBolt11(8, mintRequest.quote);
		// strip dleq
		proofs = proofs.map((p) => {
			return { ...p, dleq: undefined };
		});
		expect(() => {
			wallet.sendOffline(4, proofs, { requireDleq: true });
		}).toThrowError(new Error('Not enough funds available to send'));
	});
	test('receive with invalid dleq', async () => {
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const NUT12 = wallet.getMintInfo().nuts['12'];
		if (NUT12 == undefined || !NUT12.supported) {
			throw new Error('Cannot run this test: mint does not support NUT12');
		}
		const mintRequest = await wallet.createMintQuoteBolt11(8);
		await untilMintQuotePaid(wallet, mintRequest);
		let proofs = await wallet.mintProofsBolt11(8, mintRequest.quote);
		// alter dleq signature
		proofs.forEach((p) => {
			if (p.dleq != undefined) {
				const s = hexToNumber(p.dleq.s) + BigInt(1);
				p.dleq.s = numberToHexPadded64(s);
			}
		});
		const token = {
			mint: mintUrl,
			proofs: proofs,
			unit: wallet.unit,
		} as Token;
		const exc = await wallet.receive(token, { requireDleq: true }).catch((e) => e);
		expect(exc).toEqual(new Error('Token contains proofs with invalid or missing DLEQ'));
	});
});
describe('Custom Outputs', () => {
	const sk = randomBytes(32);
	const pk = secp256k1.getPublicKey(sk);
	const hexSk = bytesToHex(sk);
	const hexPk = bytesToHex(pk);
	const invoice =
		'lnbc10n1pn449a7pp5eh3jn9p8hlcq0c0ppcfem2hg9ehptqr9hjk5gst6c0c9qfmrrvgsdq4gdshx6r4ypqkgerjv4ehxcqzpuxqr8pqsp539s9559pdth06j37kexk9zq2pusl4yvy97ruf36jqgyskawlls3s9p4gqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqysgqy00qa3xgn03jtwrtpu93rqrp806czmpftj8g97cm0r3d2x4rsvlhp5vzgjyzzazl9xf4gpgd35gmys998tlfu8j5zrk7sf3n2nh3t3gpyul75t';
	test('Default keepFactory', async () => {
		// First we create a keep factory, this is a function that will be used to construct all outputs that we "keep"
		function p2pkFactory(a: number, k: MintKeys) {
			return OutputData.createSingleP2PKData({ pubkey: hexPk }, a, k.id);
		}
		const keepFactory: OutputType = { type: 'factory', factory: p2pkFactory };
		// We then construct and load the wallet
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		// Lets mint some fresh proofs, using our p2pKFactory as the outputType
		const quoteRes = await wallet.createMintQuoteBolt11(32);
		await untilMintQuotePaid(wallet, quoteRes);
		const proofs = await wallet.mintProofsBolt11(32, quoteRes.quote, {}, keepFactory);
		// Because of the keepFactory we expect these proofs to be locked to our public key
		expectNUT10SecretDataToEqual(proofs, hexPk);
		// Lets melt some of these proofs to pay an invoice
		const meltQuote = await wallet.createMeltQuoteBolt11(invoice);
		const meltAmount = meltQuote.amount + meltQuote.fee_reserve;
		// Use our keepFactory for the change (keep) outputs
		const customConfig: OutputConfig = {
			keep: keepFactory,
			send: wallet.defaultOutputType(),
		};
		// We need to sign our proofs before sending because they are locked
		const signedProofs = wallet.signP2PKProofs(proofs, hexSk);
		const { keep: meltKeep, send: meltSend } = await wallet.send(
			meltAmount,
			signedProofs,
			{
				includeFees: true,
			},
			customConfig,
		);
		// Again the change we get from the swap are expected to be locked to our public key
		expectNUT10SecretDataToEqual(meltKeep, hexPk);
		// We then pay the melt. In this case no private key is required, as our factory only applies to keep Proofs, not send Proofs
		const meltRes = await wallet.meltProofsBolt11(meltQuote, meltSend, {}, keepFactory);
		// Even the change we receive from the fee reserve is expected to be locked
		if (meltRes.change && meltRes.change.length > 0) {
			expectNUT10SecretDataToEqual(meltRes.change, hexPk);
		}
		// Finally we want to check whether received token are locked as well
		const restAmount = sumProofs(meltKeep) - wallet.getFeesForProofs(meltKeep);
		// First we unlock all the proofs that we have left
		const signedMeltKeep = wallet.signP2PKProofs(meltKeep, hexSk);
		const unlockedProofs = await wallet.send(restAmount, signedMeltKeep);
		// Just to receive them and lock them again, but this time overwriting the default factory
		const newFactory: OutputType = {
			type: 'factory',
			factory: (a, k) => OutputData.createSingleP2PKData({ pubkey: 'testKey' }, a, k.id),
		};
		const newProofs = await wallet.receive(
			{ proofs: unlockedProofs.send, mint: mintUrl, unit: wallet.unit },
			{},
			newFactory,
		);
		// We expect all received proofs to be locked using newFactory
		expectNUT10SecretDataToEqual(newProofs, 'testKey');
	});
	test('Manual Factory Mint', async () => {
		function createFactory(pubkey: string): OutputDataFactory {
			function inner(a: number, k: MintKeys) {
				return OutputData.createSingleP2PKData({ pubkey: pubkey }, a, k.id);
			}
			return inner;
		}
		const manualFactory: OutputType = { type: 'factory', factory: createFactory('mintTest') };
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const quote = await wallet.createMintQuoteBolt11(21);
		await untilMintQuotePaid(wallet, quote);
		const proofs = await wallet.mintProofsBolt11(21, quote.quote, {}, manualFactory);
		expectNUT10SecretDataToEqual(proofs, 'mintTest');
	});
	test('Manual Factory Send', async () => {
		function createFactory(pubkey: string): OutputDataFactory {
			function inner(a: number, k: MintKeys) {
				return OutputData.createSingleP2PKData({ pubkey }, a, k.id);
			}
			return inner;
		}
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const quote = await wallet.createMintQuoteBolt11(21);
		await untilMintQuotePaid(wallet, quote);
		const proofs = await wallet.mintProofsBolt11(21, quote.quote);
		const amount = sumProofs(proofs) - wallet.getFeesForProofs(proofs);
		const { send, keep } = await wallet.send(
			amount,
			proofs,
			{},
			{
				send: { type: 'factory', factory: createFactory('send') },
				keep: { type: 'factory', factory: createFactory('keep') },
			},
		);
		expectNUT10SecretDataToEqual(send, 'send');
		expectNUT10SecretDataToEqual(keep, 'keep');
	});
	test('Manual BlindingData', async () => {
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const keys = wallet.keyChain.getKeyset();
		const quote = await wallet.createMintQuoteBolt11(40);
		await untilMintQuotePaid(wallet, quote);
		const proofs = await wallet.mintProofsBolt11(40, quote.quote);
		const data1 = OutputData.createP2PKData({ pubkey: 'key1' }, 10, keys);
		const data2 = OutputData.createP2PKData({ pubkey: 'key2' }, 10, keys);
		const customConfig: OutputConfig = {
			keep: wallet.defaultOutputType(),
			send: { type: 'custom', data: [...data1, ...data2] },
		};
		const { send } = await wallet.send(20, proofs, {}, customConfig);
		const key1Sends = send.slice(0, data1.length);
		const key2Sends = send.slice(data1.length);
		expectNUT10SecretDataToEqual(key1Sends, 'key1');
		expectNUT10SecretDataToEqual(key2Sends, 'key2');
	});
});
describe('Keep Vector and Reordering', () => {
	test('Receive', async () => {
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const mintQuote = await wallet.createMintQuoteBolt11(64);
		await untilMintQuotePaid(wallet, mintQuote);
		const testOutputAmounts = [8, 4, 8, 2, 8, 2];
		const testProofs = await wallet.mintProofsBolt11(64, mintQuote.quote);
		const { send } = await wallet.send(32, testProofs, { includeFees: true });
		const receiveProofs = await wallet.receive(
			{ mint: mintUrl, proofs: send, unit: wallet.unit }, // "token"
			{}, // config
			{ type: 'random', denominations: testOutputAmounts }, // outputType
		);
		receiveProofs.forEach((p, i) => expect(p.amount).toBe(testOutputAmounts[i]));
	});
	test('Send', async () => {
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const mintQuote = await wallet.createMintQuoteBolt11(64);
		await untilMintQuotePaid(wallet, mintQuote);
		const testOutputAmounts = [8, 4, 8, 2, 8, 2];
		const testProofs = await wallet.mintProofsBolt11(64, mintQuote.quote);
		const fees = wallet.getFeesForProofs(testProofs);
		const customConfig: OutputConfig = {
			keep: { type: 'random', denominations: [16, 8, ...Array(8 - fees).fill(1)] },
			send: { type: 'random', denominations: testOutputAmounts },
		};
		const { send } = await wallet.send(32, testProofs, {}, customConfig);
		send.forEach((p, i) => expect(p.amount).toBe(testOutputAmounts[i]));
	});
	test('Send with partial keep denominations (wants 16,8 but the rest can be anything)', async () => {
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const mintQuote = await wallet.createMintQuoteBolt11(64);
		await untilMintQuotePaid(wallet, mintQuote);
		const testSendAmounts = [8, 4, 8, 2, 8, 2]; // complete (32), defined order
		const testKeepAmounts = [16, 8]; // incomplete (24 vs 31), , so we expect...
		const expectedKeep = [16, 8, 4, 2, 1]; // ascending order with 8,16 + split
		const testProofs = await wallet.mintProofsBolt11(64, mintQuote.quote);
		const customConfig: OutputConfig = {
			keep: { type: 'random', denominations: testKeepAmounts },
			send: { type: 'random', denominations: testSendAmounts },
		};
		const { send, keep } = await wallet.send(32, testProofs, {}, customConfig);
		console.log(send.map((p) => p.amount));
		console.log(keep.map((p) => p.amount));
		send.forEach((p, i) => expect(p.amount).toBe(testSendAmounts[i]));
		keep.forEach((p, i) => expect(p.amount).toBe(expectedKeep[i]));
	});
	test('Send with partial send denominations (wants 16,8 but the rest can be anything)', async () => {
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();
		const mintQuote = await wallet.createMintQuoteBolt11(64);
		await untilMintQuotePaid(wallet, mintQuote);
		const testSendAmounts = [16, 8]; // incomplete (24 vs 32), so we expect...
		const expectedSend = [16, 8, 8]; // ascending order with 8,16 + split rest
		const testKeepAmounts = [8, 4, 8, 1, 8, 2]; // complete (31), defined order
		const testProofs = await wallet.mintProofsBolt11(64, mintQuote.quote);
		const customConfig: OutputConfig = {
			keep: { type: 'random', denominations: testKeepAmounts },
			send: { type: 'random', denominations: testSendAmounts },
		};
		const { send, keep } = await wallet.send(32, testProofs, {}, customConfig);
		console.log(
			'send',
			send.map((p) => p.amount),
		);
		console.log(
			'keep',
			keep.map((p) => p.amount),
		);
		send.forEach((p, i) => expect(p.amount).toBe(expectedSend[i]));
		keep.forEach((p, i) => expect(p.amount).toBe(testKeepAmounts[i]));
	});
});
describe('Wallet Restore', () => {
	test('Using batch restore', async () => {
		const seed = randomBytes(64);
		const wallet = new Wallet(mintUrl, { bip39seed: seed });
		await wallet.loadMint();
		const mintQuote = await wallet.createMintQuoteBolt11(70);
		await untilMintQuotePaid(wallet, mintQuote);
		const proofs = await wallet.ops.mintBolt11(70, mintQuote.quote).asDeterministic(5).run();
		const { proofs: restoredProofs, lastCounterWithSignature } = await wallet.batchRestore();
		expect(restoredProofs).toEqual(proofs);
		expect(sumProofs(restoredProofs)).toBe(70);
		expect(lastCounterWithSignature).toBe(7);
	});
});
