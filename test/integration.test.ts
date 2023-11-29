import { CashuMint } from '../src/CashuMint.js';
import { CashuWallet } from '../src/CashuWallet.js';

import dns from 'node:dns';
import { getEncodedToken } from '../src/utils.js';
dns.setDefaultResultOrder('ipv4first');

const externalInvoice =
	'lnbc20u1p3u27nppp5pm074ffk6m42lvae8c6847z7xuvhyknwgkk7pzdce47grf2ksqwsdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzpgxqyz5vqsp5sw6n7cztudpl5m5jv3z6dtqpt2zhd3q6dwgftey9qxv09w82rgjq9qyyssqhtfl8wv7scwp5flqvmgjjh20nf6utvv5daw5h43h69yqfwjch7wnra3cn94qkscgewa33wvfh7guz76rzsfg9pwlk8mqd27wavf2udsq3yeuju';

let request: Record<string, string> | undefined;
const mintUrl = 'http://localhost:3338';

describe('mint api', () => {
	test('get keys', async () => {
		const mint = new CashuMint(mintUrl);
		const keys = await mint.getKeys();
		expect(keys).toBeDefined();
	});
	test('get keysets', async () => {
		const mint = new CashuMint(mintUrl);
		const keysets = await mint.getKeySets();
		expect(keysets).toBeDefined();
		expect(keysets.keysets).toBeDefined();
		expect(keysets.keysets.length).toBeGreaterThan(0);
	});

	test('get info', async () => {
		const mint = new CashuMint(mintUrl);
		const info = await mint.getInfo();
		expect(info).toBeDefined();
	});
	test('request mint', async () => {
		const mint = new CashuMint(mintUrl);
		const wallet = new CashuWallet(mint);
		const request = await wallet.requestMint(100);
		expect(request).toBeDefined();
	});
	test('mint tokens', async () => {
		const mint = new CashuMint(mintUrl);
		const wallet = new CashuWallet(mint);
		const request = await wallet.requestMint(1337);
		expect(request).toBeDefined();
		expect(request.request).toContain('lnbc1337');
		const tokens = await wallet.requestTokens(1337, request.quote);
		expect(tokens).toBeDefined();
		// expect that the sum of all tokens.proofs.amount is equal to the requested amount
		expect(tokens.proofs.reduce((a, b) => a + b.amount, 0)).toBe(1337);
	});
	test('get fee for local invoice', async () => {
		const mint = new CashuMint(mintUrl);
		const wallet = new CashuWallet(mint);
		const request = await wallet.requestMint(100);
		const fee = (await wallet.getMeltQuote(request.request)).fee_reserve;
		expect(fee).toBeDefined();
		// because local invoice, fee should be 0
		expect(fee).toBe(0);
	});
	test('get fee for external invoice', async () => {
		const mint = new CashuMint(mintUrl);
		const wallet = new CashuWallet(mint);
		const fee = (await wallet.getMeltQuote(externalInvoice)).fee_reserve;
		expect(fee).toBeDefined();
		// because external invoice, fee should be > 0
		expect(fee).toBeGreaterThan(0);
	});
	test('pay local invoice', async () => {
		const mint = new CashuMint(mintUrl);
		const wallet = new CashuWallet(mint);
		const request = await wallet.requestMint(100);
		const tokens = await wallet.requestTokens(100, request.quote);

		// expect no fee because local invoice
		const requestToPay = await wallet.requestMint(10);
		const quote = await wallet.getMeltQuote(requestToPay.request);
		const fee = quote.fee_reserve
		expect(fee).toBe(0);

		const sendResponse = await wallet.send(10, tokens.proofs);
		const response = await wallet.payLnInvoice(requestToPay.request, sendResponse.send, quote);
		expect(response).toBeDefined();
		// expect that we have received the fee back, since it was internal
		expect(response.change.reduce((a, b) => a + b.amount, 0)).toBe(fee);

		// check states of spent and kept proofs after payment
		const sentProofsSpent = await wallet.checkProofsSpent(sendResponse.send)
		expect(sentProofsSpent).toBeDefined();
		// expect that all proofs are spent, i.e. sendProofsSpent == sendResponse.send
		expect(sentProofsSpent).toEqual(sendResponse.send);
		// expect none of the sendResponse.returnChange to be spent
		const returnChangeSpent = await wallet.checkProofsSpent(sendResponse.returnChange)
		expect(returnChangeSpent).toBeDefined();
		expect(returnChangeSpent).toEqual([]);
	});
	test('pay external invoice', async () => {
		const mint = new CashuMint(mintUrl);
		const wallet = new CashuWallet(mint);
		const request = await wallet.requestMint(3000);
		const tokens = await wallet.requestTokens(3000, request.quote);

		const fee = (await wallet.getMeltQuote(externalInvoice)).fee_reserve;
		expect(fee).toBeGreaterThan(0);

		const sendResponse = await wallet.send(2000 + fee, tokens.proofs);
		const response = await wallet.payLnInvoice(externalInvoice, sendResponse.send);

		expect(response).toBeDefined();
		// expect that we have received the fee back, since it was internal
		expect(response.change.reduce((a, b) => a + b.amount, 0)).toBe(fee);

		// check states of spent and kept proofs after payment
		const sentProofsSpent = await wallet.checkProofsSpent(sendResponse.send)
		expect(sentProofsSpent).toBeDefined();
		// expect that all proofs are spent, i.e. sendProofsSpent == sendResponse.send
		expect(sentProofsSpent).toEqual(sendResponse.send);
		// expect none of the sendResponse.returnChange to be spent
		const returnChangeSpent = await wallet.checkProofsSpent(sendResponse.returnChange)
		expect(returnChangeSpent).toBeDefined();
		expect(returnChangeSpent).toEqual([]);
	});
	test('test send tokens', async () => {
		const mint = new CashuMint(mintUrl);
		const wallet = new CashuWallet(mint);
		const request = await wallet.requestMint(100);
		const tokens = await wallet.requestTokens(100, request.quote);

		const sendResponse = await wallet.send(10, tokens.proofs);
		expect(sendResponse).toBeDefined();
		expect(sendResponse.send).toBeDefined();
		expect(sendResponse.returnChange).toBeDefined();
		expect(sendResponse.send.length).toBe(2);
		expect(sendResponse.returnChange.length).toBe(4);
	});
	test('receive tokens', async () => {
		const mint = new CashuMint(mintUrl);
		const wallet = new CashuWallet(mint);
		const request = await wallet.requestMint(100);
		const tokens = await wallet.requestTokens(100, request.quote);

		const sendResponse = await wallet.send(10, tokens.proofs);
		const encoded = getEncodedToken({
			token: [{ mint: mintUrl, proofs: sendResponse.send }]
		});
		const response = await wallet.receive(encoded);
		expect(response).toBeDefined();
		expect(response.token).toBeDefined();
		expect(response.tokensWithErrors).toBeUndefined();
	});
});
