// +++++++++++++++++++++ CI Integration Test ++++++++++++++++++
// To run locally, spin up a local mint instance on port 3338. Startup command:
// docker run -d -p 3338:3338 --name nutshell -e MINT_LIGHTNING_BACKEND=FakeWallet -e MINT_INPUT_FEE_PPK=100 -e MINT_LISTEN_HOST=0.0.0.0 -e MINT_LISTEN_PORT=3338 -e MINT_PRIVATE_KEY=TEST_PRIVATE_KEY cashubtc/nutshell:0.16.5 poetry run mint

import dns from 'node:dns';
import { test, describe, expect } from 'vitest';
import { vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
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
dns.setDefaultResultOrder('ipv4first');

const externalInvoice =
	'lnbc20u1p3u27nppp5pm074ffk6m42lvae8c6847z7xuvhyknwgkk7pzdce47grf2ksqwsdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzpgxqyz5vqsp5sw6n7cztudpl5m5jv3z6dtqpt2zhd3q6dwgftey9qxv09w82rgjq9qyyssqhtfl8wv7scwp5flqvmgjjh20nf6utvv5daw5h43h69yqfwjch7wnra3cn94qkscgewa33wvfh7guz76rzsfg9pwlk8mqd27wavf2udsq3yeuju';

const mintUrl = 'http://localhost:3338';
const unit = 'sat';

injectWebSocketImpl(ws as unknown as typeof WebSocket);

function expectNUT10SecretDataToEqual(p: Array<Proof>, s: string) {
	p.forEach((p) => {
		const parsedSecret = JSON.parse(p.secret);
		expect(parsedSecret[1].data).toBe(s);
	});
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
		expect(info).toBeDefined();
	});
	test('request mint', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(100);
		expect(request).toBeDefined();
		const mintQuote = await wallet.checkMintQuoteBolt11(request.quote);
		expect(mintQuote).toBeDefined();
	});
	test('mint tokens', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(1337);
		expect(request).toBeDefined();
		expect(request.request).toContain('lnbc1337');
		const proofs = await wallet.mintProofs(1337, request.quote);
		expect(proofs).toBeDefined();
		// expect that the sum of all tokens.proofs.amount is equal to the requested amount
		expect(sumProofs(proofs)).toBe(1337);
	});
	test('get fee for local invoice', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(100);
		const fee = (await wallet.createMeltQuoteBolt11(request.request)).fee_reserve;
		expect(fee).toBeDefined();
		// because local invoice, fee should be 0
		expect(fee).toBe(0);
	});
	test('invoice with description', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const quote = await wallet.createMintQuoteBolt11(100, 'test description');
		expect(quote).toBeDefined();
		console.log(`invoice with description: ${quote.request}`);
	});
	test('get fee for external invoice', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const fee = (await wallet.createMeltQuoteBolt11(externalInvoice)).fee_reserve;
		expect(fee).toBeDefined();
		// because external invoice, fee should be > 0
		expect(fee).toBeGreaterThan(0);
	});
	test('pay local invoice', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(100);
		const proofs = await wallet.mintProofs(100, request.quote);

		// expect no fee because local invoice
		const mintQuote = await wallet.createMintQuoteBolt11(10);
		const quote = await wallet.createMeltQuoteBolt11(mintQuote.request);
		const fee = quote.fee_reserve;
		expect(fee).toBe(0);

		// get the quote from the mint
		const quote_ = await wallet.checkMeltQuoteBolt11(quote.quote);
		expect(quote_).toBeDefined();

		const sendResponse = await wallet.send(10, proofs, { includeFees: true });
		const response = await wallet.meltProofs(quote, sendResponse.send);
		expect(response).toBeDefined();
		// expect that we have received the fee back, since it was internal
		expect(response.change.reduce((a, b) => a + b.amount, 0)).toBe(fee);

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
	test('pay external invoice', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(3000);
		const proofs = await wallet.mintProofs(3000, request.quote);

		const meltQuote = await wallet.createMeltQuoteBolt11(externalInvoice);
		const fee = meltQuote.fee_reserve;
		expect(fee).toBeGreaterThan(0);

		// get the quote from the mint
		const quote_ = await wallet.checkMeltQuoteBolt11(meltQuote.quote);
		expect(quote_).toBeDefined();

		const sendResponse = await wallet.send(2000 + fee, proofs, { includeFees: true });
		const response = await wallet.meltProofs(meltQuote, sendResponse.send);

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
		const proofs = await wallet.mintProofs(64, request.quote);

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
		const proofs = await wallet.mintProofs(100, request.quote); // 4,32,64
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
	}, 10000000);
	test('receive tokens with previous split', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(100);
		const proofs = await wallet.mintProofs(100, request.quote);

		const sendResponse = await wallet.send(10, proofs);
		const encoded = getEncodedToken({ mint: mintUrl, proofs: sendResponse.send });
		const response = await wallet.receive(encoded);
		expect(response).toBeDefined();
	});
	test('receive tokens with previous mint', async () => {
		const wallet = new Wallet(mintUrl, { unit });
		await wallet.loadMint();
		const request = await wallet.createMintQuoteBolt11(64);
		const proofs = await wallet.mintProofs(64, request.quote);
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
		const mintedProofs = await wallet.mintProofs(128, request.quote);

		// Send them P2PK locked to Bob
		const { send } = await wallet.ops.send(64, mintedProofs).asP2PK({ pubkey: pubKeyBob }).run();
		expectNUT10SecretDataToEqual(send, pubKeyBob);
		const encoded = getEncodedToken({ mint: mintUrl, proofs: send });

		// Try and receive them with Alice's secret key (should fail)
		const result = await wallet
			.receive(encoded, { privkey: bytesToHex(privKeyAlice) })
			.catch((e) => e);
		expect(result).toEqual(new MintOperationError(0, 'Witness is missing for p2pk signature'));

		// Try and receive them with Bob's secret key (should suceed)
		const proofs = await wallet.receive(encoded, { privkey: bytesToHex(privKeyBob) });
		expect(
			proofs.reduce((curr, acc) => {
				return curr + acc.amount;
			}, 0),
		).toBe(63);
	});

	test('mint and melt p2pk', async () => {
		const wallet = new Wallet(mintUrl);
		await wallet.loadMint();

		const privKeyBob = secp256k1.utils.randomSecretKey();
		const pubKeyBob = secp256k1.getPublicKey(privKeyBob);

		const mintRequest = await wallet.createMintQuoteBolt11(3000);

		const proofs = await wallet.ops
			.mintBolt11(3000, mintRequest.quote)
			.asP2PK({
				pubkey: bytesToHex(pubKeyBob),
			})
			.run();

		const meltRequest = await wallet.createMeltQuoteBolt11(externalInvoice);
		const fee = meltRequest.fee_reserve;
		expect(fee).toBeGreaterThan(0);
		const signedProofs = wallet.signP2PKProofs(proofs, bytesToHex(privKeyBob));
		const response = await wallet.meltProofs(meltRequest, signedProofs);
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
		await new Promise((r) => setTimeout(r, 1500));
		const proof = await wallet.mintProofs(1, quote.quote, {}, { type: 'custom', data: [data] });
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
					rej(e);
					unsub();
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

		const callbackRef = vi.fn();
		const res = await new Promise(async (res, rej) => {
			let counter = 0;
			const unsub = await wallet.on.mintQuoteUpdates(
				[mintQuote1.quote, mintQuote2.quote],
				() => {
					counter++;
					callbackRef();
					if (counter === 4) {
						unsub();
						res(1);
					}
				},
				() => {
					counter++;
					if (counter === 4) {
						unsub();
						rej();
					}
				},
			);
		});
		mint.disconnectWebSocket();
		expect(res).toBe(1);
		expect(callbackRef).toHaveBeenCalledTimes(4);
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
		const proofs = await wallet.mintProofs(63, quote.quote);
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
		const proofs = await wallet.mintProofs(63, quote, { privkey });

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
		const proofs = await wallet.mintProofs(3000, mintRequest.quote);

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
		const proofs = await wallet.mintProofs(8, mintRequest.quote);

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
		const proofs = await wallet.mintProofs(8, mintRequest.quote);

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
		let proofs = await wallet.mintProofs(8, mintRequest.quote);

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
		let proofs = await wallet.mintProofs(8, mintRequest.quote);

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
		await new Promise((res) => setTimeout(res, 2000));
		const proofs = await wallet.mintProofs(32, quoteRes.quote, {}, keepFactory);

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
		const meltRes = await wallet.meltProofs(meltQuote, meltSend, {}, keepFactory);
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
	}, 15000);
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
		await new Promise((res) => setTimeout(res, 1000));
		const proofs = await wallet.mintProofs(21, quote.quote, {}, manualFactory);
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
		await new Promise((res) => setTimeout(res, 1000));
		const proofs = await wallet.mintProofs(21, quote.quote);
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
		await new Promise((res) => setTimeout(res, 1000));
		const proofs = await wallet.mintProofs(40, quote.quote);
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
		await new Promise((res) => setTimeout(res, 1000));
		const testOutputAmounts = [8, 4, 8, 2, 8, 2];
		const testProofs = await wallet.mintProofs(64, mintQuote.quote);

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
		await new Promise((res) => setTimeout(res, 1000));
		const testOutputAmounts = [8, 4, 8, 2, 8, 2];
		const testProofs = await wallet.mintProofs(64, mintQuote.quote);

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
		await new Promise((res) => setTimeout(res, 1000));
		const testSendAmounts = [8, 4, 8, 2, 8, 2]; // complete (32), defined order
		const testKeepAmounts = [16, 8]; // incomplete (24 vs 31), , so we expect...
		const expectedKeep = [16, 8, 4, 2, 1]; // ascending order with 8,16 + split
		const testProofs = await wallet.mintProofs(64, mintQuote.quote);

		const fees = wallet.getFeesForProofs(testProofs);

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
		await new Promise((res) => setTimeout(res, 1000));
		const testSendAmounts = [16, 8]; // incomplete (24 vs 32), so we expect...
		const expectedSend = [16, 8, 8]; // ascending order with 8,16 + split rest
		const testKeepAmounts = [8, 4, 8, 1, 8, 2]; // complete (31), defined order
		const testProofs = await wallet.mintProofs(64, mintQuote.quote);

		const fees = wallet.getFeesForProofs(testProofs);

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
		await new Promise((r) => setTimeout(r, 1000));
		const proofs = await wallet.ops.mintBolt11(70, mintQuote.quote).asDeterministic(5).run();

		const { proofs: restoredProofs, lastCounterWithSignature } = await wallet.batchRestore();
		expect(restoredProofs).toEqual(proofs);
		expect(sumProofs(restoredProofs)).toBe(70);
		expect(lastCounterWithSignature).toBe(7);
	});
});
