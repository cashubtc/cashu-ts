import { setupServer } from 'msw/node';
import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, afterAll, afterEach, test, describe, expect, vi } from 'vitest';

import { CashuMint } from '../src/CashuMint.js';
import { CashuWallet } from '../src/CashuWallet.js';
import {
	CheckStateEnum,
	MeltQuoteResponse,
	MeltQuoteState,
	MintQuoteResponse,
	MintQuoteState,
	Proof
} from '../src/model/types/index.js';
import { bytesToNumber, getDecodedToken } from '../src/utils.js';
import { Server, WebSocket } from 'mock-socket';
import { injectWebSocketImpl } from '../src/ws.js';
import { MintInfo } from '../src/model/MintInfo.js';
import { OutputData } from '../src/model/OutputData.js';
import { hexToBytes } from '@noble/curves/abstract/utils';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';

injectWebSocketImpl(WebSocket);

const dummyKeysResp = {
	keysets: [
		{
			id: '009a1f293253e41e',
			unit: 'sat',
			keys: {
				1: '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
				2: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5'
			}
		}
	]
};
const dummyKeysetResp = {
	keysets: [
		{
			id: '009a1f293253e41e',
			unit: 'sat',
			active: true,
			input_fee_ppk: 0
		}
	]
};
const mintUrl = 'http://localhost:3338';
const mint = new CashuMint(mintUrl);
const unit = 'sat';
const invoice =
	'lnbc20u1p3u27nppp5pm074ffk6m42lvae8c6847z7xuvhyknwgkk7pzdce47grf2ksqwsdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzpgxqyz5vqsp5sw6n7cztudpl5m5jv3z6dtqpt2zhd3q6dwgftey9qxv09w82rgjq9qyyssqhtfl8wv7scwp5flqvmgjjh20nf6utvv5daw5h43h69yqfwjch7wnra3cn94qkscgewa33wvfh7guz76rzsfg9pwlk8mqd27wavf2udsq3yeuju';
const server = setupServer();

beforeAll(() => {
	server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
	server.use(
		http.get(mintUrl + '/v1/keys', () => {
			return HttpResponse.json(dummyKeysResp);
		})
	);
	server.use(
		http.get(mintUrl + '/v1/keys/009a1f293253e41e', () => {
			return HttpResponse.json(dummyKeysResp);
		})
	);
	server.use(
		http.get(mintUrl + '/v1/keysets', () => {
			return HttpResponse.json(dummyKeysetResp);
		})
	);
});

afterEach(() => {
	server.resetHandlers();
});

afterAll(() => {
	server.close();
});

describe('test info', () => {
	const mintInfoResp = JSON.parse(
		'{"name":"Testnut mint","pubkey":"0296d0aa13b6a31cf0cd974249f28c7b7176d7274712c95a41c7d8066d3f29d679","version":"Nutshell/0.16.3","description":"Mint for testing Cashu wallets","description_long":"This mint usually runs the latest main branch of the nutshell repository. It uses a FakeWallet, all your Lightning invoices will always be marked paid so that you can test minting and melting ecash via Lightning.","contact":[{"method":"email","info":"contact@me.com"},{"method":"twitter","info":"@me"},{"method":"nostr","info":"npub1337"}],"motd":"This is a message of the day field. You should display this field to your users if the content changes!","icon_url":"https://image.nostr.build/46ee47763c345d2cfa3317f042d332003f498ee281fb42808d47a7d3b9585911.png","time":1731684933,"nuts":{"4":{"methods":[{"method":"bolt11","unit":"sat","description":true},{"method":"bolt11","unit":"usd","description":true},{"method":"bolt11","unit":"eur","description":true}],"disabled":false},"5":{"methods":[{"method":"bolt11","unit":"sat"},{"method":"bolt11","unit":"usd"},{"method":"bolt11","unit":"eur"}],"disabled":false},"7":{"supported":true},"8":{"supported":true},"9":{"supported":true},"10":{"supported":true},"11":{"supported":true},"12":{"supported":true},"14":{"supported":true},"17":{"supported":[{"method":"bolt11","unit":"sat","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"usd","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"eur","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]}]}}}'
	);
	test('test info', async () => {
		server.use(
			http.get(mintUrl + '/v1/info', () => {
				return HttpResponse.json(mintInfoResp);
			})
		);
		const wallet = new CashuWallet(mint, { unit });

		const info = await wallet.getMintInfo();
		expect(info.contact).toEqual([
			{ method: 'email', info: 'contact@me.com' },
			{ method: 'twitter', info: '@me' },
			{ method: 'nostr', info: 'npub1337' }
		]);
		expect(info.isSupported(10)).toEqual({ supported: true });
		expect(info.isSupported(5)).toEqual({
			disabled: false,
			params: [
				{ method: 'bolt11', unit: 'sat' },
				{ method: 'bolt11', unit: 'usd' },
				{ method: 'bolt11', unit: 'eur' }
			]
		});
		expect(info.isSupported(17)).toEqual({
			supported: true,
			params: [
				{
					method: 'bolt11',
					unit: 'sat',
					commands: ['bolt11_melt_quote', 'proof_state', 'bolt11_mint_quote']
				},
				{
					method: 'bolt11',
					unit: 'usd',
					commands: ['bolt11_melt_quote', 'proof_state', 'bolt11_mint_quote']
				},
				{
					method: 'bolt11',
					unit: 'eur',
					commands: ['bolt11_melt_quote', 'proof_state', 'bolt11_mint_quote']
				}
			]
		});
		expect(info).toEqual(new MintInfo(mintInfoResp));
	});
	test('test info with deprecated contact field', async () => {
		// mintInfoRespDeprecated is the same as mintInfoResp but with the contact field in the old format
		const mintInfoRespDeprecated = JSON.parse(
			'{"name":"Testnut mint","pubkey":"0296d0aa13b6a31cf0cd974249f28c7b7176d7274712c95a41c7d8066d3f29d679","version":"Nutshell/0.16.3","description":"Mint for testing Cashu wallets","description_long":"This mint usually runs the latest main branch of the nutshell repository. All your Lightning invoices will always be marked paid so that you can test minting and melting ecash via Lightning.","contact":[["email","contact@me.com"],["twitter","@me"],["nostr","npub1337"]],"motd":"This is a message of the day field. You should display this field to your users if the content changes!","nuts":{"4":{"methods":[{"method":"bolt11","unit":"sat"},{"method":"bolt11","unit":"usd"}],"disabled":false},"5":{"methods":[{"method":"bolt11","unit":"sat"},{"method":"bolt11","unit":"usd"}],"disabled":false},"7":{"supported":true},"8":{"supported":true},"9":{"supported":true},"10":{"supported":true},"11":{"supported":true},"12":{"supported":true},"17":[{"method":"bolt11","unit":"sat","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"usd","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]}]}}'
		);
		server.use(
			http.get(mintUrl + '/v1/info', () => {
				return HttpResponse.json(mintInfoRespDeprecated);
			})
		);
		const wallet = new CashuWallet(mint, { unit });
		const info = await wallet.getMintInfo();
		expect(info.contact).toEqual([
			{ method: 'email', info: 'contact@me.com' },
			{ method: 'twitter', info: '@me' },
			{ method: 'nostr', info: 'npub1337' }
		]);
	});
});

describe('test fees', () => {
	test('test melt quote fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
				return HttpResponse.json({
					quote: 'test_melt_quote_id',
					amount: 2000,
					fee_reserve: 20,
					payment_preimage: null,
					state: 'UNPAID'
				} as MeltQuoteResponse);
			})
		);
		const wallet = new CashuWallet(mint, { unit });

		const fee = await wallet.checkMeltQuote('test');
		const amount = 2000;

		expect(fee.fee_reserve + amount).toEqual(2020);
	});
});

describe('receive', () => {
	const tokenInput =
		'cashuAeyJ0b2tlbiI6W3sicHJvb2ZzIjpbeyJpZCI6IjAwOWExZjI5MzI1M2U0MWUiLCJhbW91bnQiOjEsInNlY3JldCI6IjAxZjkxMDZkMTVjMDFiOTQwYzk4ZWE3ZTk2OGEwNmUzYWY2OTYxOGVkYjhiZThlNTFiNTEyZDA4ZTkwNzkyMTYiLCJDIjoiMDJmODVkZDg0YjBmODQxODQzNjZjYjY5MTQ2MTA2YWY3YzBmMjZmMmVlMGFkMjg3YTNlNWZhODUyNTI4YmIyOWRmIn1dLCJtaW50IjoiaHR0cDovL2xvY2FsaG9zdDozMzM4In1dfQ=';
	test('test receive encoded token', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						}
					]
				});
			})
		);
		const wallet = new CashuWallet(mint, { unit });

		const proofs = await wallet.receive(tokenInput);

		expect(proofs).toHaveLength(1);
		expect(proofs).toMatchObject([{ amount: 1, id: '009a1f293253e41e' }]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('test receive raw token', async () => {
		const decodedInput = getDecodedToken(tokenInput);
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: 'z32vUtKgNCm1',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						}
					]
				});
			})
		);

		const wallet = new CashuWallet(mint);

		const proofs = await wallet.receive(decodedInput);

		expect(proofs).toHaveLength(1);
		expect(proofs).toMatchObject([{ amount: 1, id: 'z32vUtKgNCm1' }]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});
	test('test receive custom split', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						},
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						},
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						}
					]
				});
			})
		);

		const wallet = new CashuWallet(mint, { unit });
		const token3sat =
			'cashuAeyJ0b2tlbiI6IFt7InByb29mcyI6IFt7ImlkIjogIjAwOWExZjI5MzI1M2U0MWUiLCAiYW1vdW50IjogMSwgInNlY3JldCI6ICJlN2MxYjc2ZDFiMzFlMmJjYTJiMjI5ZDE2MGJkZjYwNDZmMzNiYzQ1NzAyMjIzMDRiNjUxMTBkOTI2ZjdhZjg5IiwgIkMiOiAiMDM4OWNkOWY0Zjk4OGUzODBhNzk4OWQ0ZDQ4OGE3YzkxYzUyNzdmYjkzMDQ3ZTdhMmNjMWVkOGUzMzk2Yjg1NGZmIn0sIHsiaWQiOiAiMDA5YTFmMjkzMjUzZTQxZSIsICJhbW91bnQiOiAyLCAic2VjcmV0IjogImRlNTVjMTVmYWVmZGVkN2Y5Yzk5OWMzZDRjNjJmODFiMGM2ZmUyMWE3NTJmZGVmZjZiMDg0Y2YyZGYyZjVjZjMiLCAiQyI6ICIwMmRlNDBjNTlkOTAzODNiODg1M2NjZjNhNGIyMDg2NGFjODNiYTc1OGZjZTNkOTU5ZGJiODkzNjEwMDJlOGNlNDcifV0sICJtaW50IjogImh0dHA6Ly9sb2NhbGhvc3Q6MzMzOCJ9XX0=';

		const proofs = await wallet.receive(token3sat, {
			outputAmounts: { keepAmounts: [], sendAmounts: [1, 1, 1] }
		});

		expect(proofs).toHaveLength(3);
		expect(proofs).toMatchObject([
			{ amount: 1, id: '009a1f293253e41e' },
			{ amount: 1, id: '009a1f293253e41e' },
			{ amount: 1, id: '009a1f293253e41e' }
		]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});
	test('test receive tokens already spent', async () => {
		const msg = 'tokens already spent. Secret: asdasdasd';
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return new HttpResponse(JSON.stringify({ detail: msg }), { status: 400 });
			})
		);
		const wallet = new CashuWallet(mint, { unit });
		const result = await wallet.receive(tokenInput).catch((e) => e);
		expect(result).toEqual(new Error('tokens already spent. Secret: asdasdasd'));
	});

	test('test receive could not verify proofs', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return new HttpResponse(JSON.stringify({ code: 0, error: 'could not verify proofs.' }), {
					status: 400
				});
			})
		);
		const wallet = new CashuWallet(mint, { unit });
		const result = await wallet.receive(tokenInput).catch((e) => e);
		expect(result).toEqual(new Error('could not verify proofs.'));
	});
});

describe('checkProofsStates', () => {
	const proofs = [
		{
			id: '009a1f293253e41e',
			amount: 1,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
		}
	];
	test('test checkProofsStates - get proofs that are NOT spendable', async () => {
		server.use(
			http.post(mintUrl + '/v1/checkstate', () => {
				return HttpResponse.json({
					states: [
						{
							Y: '02d5dd71f59d917da3f73defe997928e9459e9d67d8bdb771e4989c2b5f50b2fff',
							state: 'UNSPENT',
							witness: 'witness-asd'
						}
					]
				});
			})
		);
		const wallet = new CashuWallet(mint, { unit });

		const result = await wallet.checkProofsStates(proofs);
		result.forEach((r) => {
			expect(r.state).toEqual(CheckStateEnum.UNSPENT);
			expect(r.witness).toEqual('witness-asd');
		});
	});
});

describe('requestTokens', () => {
	test('test requestTokens', async () => {
		server.use(
			http.post(mintUrl + '/v1/mint/bolt11', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625'
						}
					]
				});
			})
		);
		const wallet = new CashuWallet(mint, { unit });

		const proofs = await wallet.mintProofs(1, '');

		expect(proofs).toHaveLength(1);
		expect(proofs[0]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});
	test('test requestTokens bad resonse', async () => {
		server.use(
			http.post(mintUrl + '/v1/mint/bolt11', () => {
				return HttpResponse.json({});
			})
		);
		const wallet = new CashuWallet(mint, { unit });

		const result = await wallet.mintProofs(1, '').catch((e) => e);

		expect(result).toEqual(new Error('bad response'));
	});
});

describe('send', () => {
	const proofs = [
		{
			id: '009a1f293253e41e',
			amount: 1,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
		}
	];
	test('test send base case', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						}
					]
				});
			})
		);
		const wallet = new CashuWallet(mint, { unit });
		await wallet.getKeys();

		const result = await wallet.send(1, proofs);

		expect(result.keep).toHaveLength(0);
		expect(result.send).toHaveLength(1);
		expect(result.send[0]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
	});

	test('test send over paying. Should return change', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						},
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						}
					]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });

		const result = await wallet.send(1, [
			{
				id: '009a1f293253e41e',
				amount: 2,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			}
		]);

		expect(result.send).toHaveLength(1);
		expect(result.send[0]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(1);
		expect(result.keep[0]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
		expect(/[0-9a-f]{64}/.test(result.keep[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.keep[0].secret)).toBe(true);
	});
	test('test send overpaying with p2pk.', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						},
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						}
					]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });

		const result = await wallet.send(
			1,
			[
				{
					id: '009a1f293253e41e',
					amount: 2,
					secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
					C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
				}
			],
			{ p2pk: { pubkey: 'pk' } }
		);

		expectNUT10SecretDataToEqual([result.send[0]], 'pk');
		expect(result.keep[0].secret.length).toBe(64);
	});

	test('test send over paying2', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						},
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						}
					]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });

		const overpayProofs = [
			{
				id: '009a1f293253e41e',
				amount: 2,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			}
		];
		const result = await wallet.send(1, overpayProofs);

		expect(result.send).toHaveLength(1);
		expect(result.send[0]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(1);
		expect(result.keep[0]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
		expect(/[0-9a-f]{64}/.test(result.keep[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.keep[0].secret)).toBe(true);
	});
	test('test send preference', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						},
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						},
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						},
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						}
					]
				});
			})
		);
		const wallet = new CashuWallet(mint, { unit });

		const overpayProofs = [
			{
				id: '009a1f293253e41e',
				amount: 2,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			},
			{
				id: '009a1f293253e41e',
				amount: 2,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			}
		];
		await wallet.getKeys();
		const result = await wallet.send(4, overpayProofs, {
			// preference: { sendPreference: [{ amount: 1, count: 4 }] }
			outputAmounts: { sendAmounts: [1, 1, 1, 1], keepAmounts: [] }
		});

		expect(result.send).toHaveLength(4);
		expect(result.send[0]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
		expect(result.send[1]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
		expect(result.send[2]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
		expect(result.send[3]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(0);
	});

	test('test send preference overpay', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						},
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						},
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						},
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						}
					]
				});
			})
		);
		const wallet = new CashuWallet(mint, { unit });

		const overpayProofs = [
			{
				id: '009a1f293253e41e',
				amount: 2,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			},
			{
				id: '009a1f293253e41e',
				amount: 2,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			}
		];
		await wallet.getKeys();
		const result = await wallet.send(3, overpayProofs, {
			outputAmounts: { sendAmounts: [1, 1, 1], keepAmounts: [1] }
		});

		expect(result.send).toHaveLength(3);
		expect(result.send[0]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
		expect(result.send[1]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
		expect(result.send[2]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(1);
		expect(result.keep[0]).toMatchObject({ amount: 1, id: '009a1f293253e41e' });
	});

	test('test send not enough funds', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '009a1f293253e41e',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						}
					]
				});
			})
		);
		const wallet = new CashuWallet(mint, { unit });

		const result = await wallet.send(2, proofs).catch((e) => e);

		expect(result).toEqual(new Error('Not enough funds available to send'));
	});
	test('test send bad response', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });

		const result = await wallet
			.send(1, [
				{
					id: '009a1f293253e41e',
					amount: 2,
					secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
					C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
				}
			])
			.catch((e) => e);

		expect(result).toEqual(new Error('bad response'));
	});
});

describe('deterministic', () => {
	test('no seed', async () => {
		const wallet = new CashuWallet(mint);
		await wallet.getKeys();
		const result = await wallet
			.send(
				1,
				[
					{
						id: '009a1f293253e41e',
						amount: 2,
						secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
						C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
					}
				],
				{ counter: 1 }
			)
			.catch((e) => e);
		expect(result).toEqual(new Error('cannot create deterministic messages without seed'));
	});
	test.each([
		[
			0,
			'485875df74771877439ac06339e284c3acfcd9be7abf3bc20b516faeadfe77ae',
			'ad00d431add9c673e843d4c2bf9a778a5f402b985b8da2d5550bf39cda41d679'
		],
		[
			1,
			'8f2b39e8e594a4056eb1e6dbb4b0c38ef13b1b2c751f64f810ec04ee35b77270',
			'967d5232515e10b81ff226ecf5a9e2e2aff92d66ebc3edf0987eb56357fd6248'
		],
		[
			2,
			'bc628c79accd2364fd31511216a0fab62afd4a18ff77a20deded7b858c9860c8',
			'b20f47bb6ae083659f3aa986bfa0435c55c6d93f687d51a01f26862d9b9a4899'
		]
	])('deterministic OutputData: counter %i -> secret: %s, r: %s', async (counter, secret, r) => {
		const hexSeed =
			'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8';

		const numberR = bytesToNumber(hexToBytes(r));
		const decoder = new TextDecoder();

		const data = OutputData.createSingleDeterministicData(
			0,
			hexToBytes(hexSeed),
			counter,
			'009a1f293253e41e'
		);
		expect(decoder.decode(data.secret)).toBe(secret);
		expect(data.blindingFactor).toBe(numberR);
	});
});

describe('WebSocket Updates', () => {
	test('mint update', async () => {
		const fakeUrl = 'ws://localhost:3338/v1/ws';
		const server = new Server(fakeUrl, { mock: false });
		server.on('connection', (socket) => {
			socket.on('message', (m) => {
				console.log(m);
				try {
					const parsed = JSON.parse(m.toString());
					if (parsed.method === 'subscribe') {
						const message = `{"jsonrpc": "2.0", "result": {"status": "OK", "subId": "${parsed.params.subId}"}, "id": ${parsed.id}}`;
						socket.send(message);
						setTimeout(() => {
							const message = `{"jsonrpc": "2.0", "method": "subscribe", "params": {"subId": "${parsed.params.subId}", "payload": {"quote": "123", "request": "456", "state": "PAID", "paid": true, "expiry": 123}}}`;
							socket.send(message);
						}, 500);
					}
				} catch {
					console.log('Server parsing failed...');
				}
			});
		});
		const wallet = new CashuWallet(mint);
		const state = await new Promise(async (res, rej) => {
			const callback = (p: MintQuoteResponse) => {
				if (p.state === MintQuoteState.PAID) {
					res(p);
				}
			};
			const test = await wallet.onMintQuoteUpdates(['123'], callback, () => {
				rej();
				console.log('error');
			});
		});
		expect(state).toMatchObject({ quote: '123' });
		mint.disconnectWebSocket();
		server.close();
	});
	test('melt update', async () => {
		const fakeUrl = 'ws://localhost:3338/v1/ws';
		const server = new Server(fakeUrl, { mock: false });
		server.on('connection', (socket) => {
			socket.on('message', (m) => {
				console.log(m);
				try {
					const parsed = JSON.parse(m.toString());
					if (parsed.method === 'subscribe') {
						const message = `{"jsonrpc": "2.0", "result": {"status": "OK", "subId": "${parsed.params.subId}"}, "id": ${parsed.id}}`;
						socket.send(message);
						setTimeout(() => {
							const message = `{"jsonrpc": "2.0", "method": "subscribe", "params": {"subId": "${parsed.params.subId}", "payload": {"quote": "123", "request": "456", "state": "PAID", "paid": true, "expiry": 123}}}`;
							socket.send(message);
						}, 500);
					}
				} catch {
					console.log('Server parsing failed...');
				}
			});
		});
		const wallet = new CashuWallet(mint);
		const state = await new Promise(async (res, rej) => {
			const callback = (p: MeltQuoteResponse) => {
				console.log(p);
				if (p.state === MeltQuoteState.PAID) {
					res(p);
				}
			};
			const test = await wallet.onMeltQuoteUpdates(['123'], callback, (e) => {
				console.log(e);
				rej();
				console.log('error');
			});
		});
		expect(state).toMatchObject({ quote: '123' });
		server.close();
	});
});
describe('multi mint', async () => {
	const mintInfo = JSON.parse(
		'{"name":"Cashu mint","pubkey":"023ef9a3cda9945d5e784e478d3bd0c8d39726bcb3ca11098fe685a95d3f889d28","version":"Nutshell/0.16.4","contact":[],"time":1737973290,"nuts":{"4":{"methods":[{"method":"bolt11","unit":"sat","description":true}],"disabled":false},"5":{"methods":[{"method":"bolt11","unit":"sat"}],"disabled":false},"7":{"supported":true},"8":{"supported":true},"9":{"supported":true},"10":{"supported":true},"11":{"supported":true},"12":{"supported":true},"14":{"supported":true},"20":{"supported":true},"15":{"methods":[{"method":"bolt11","unit":"sat"}]},"17":{"supported":[{"method":"bolt11","unit":"sat","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]}]}}}'
	);
	test('multi path melt quotes', async () => {
		server.use(
			http.get(mintUrl + '/v1/info', () => {
				return HttpResponse.json(mintInfo);
			})
		);
		server.use(
			http.post<any, { options: { mpp: number } }>(
				mintUrl + '/v1/melt/quote/bolt11',
				async ({ request }) => {
					const body = await request.json();
					if (!body?.options.mpp) {
						return new HttpResponse('No MPP', { status: 400 });
					}
					return HttpResponse.json({
						quote: 'K-80Mo7xrtQRgaA1ifrxDKGQGZEGlo7zNDwTtf-D',
						amount: 1,
						fee_reserve: 2,
						paid: false,
						state: 'UNPAID',
						expiry: 1673972705,
						payment_preimage: null,
						change: null
					});
				}
			)
		);
		const mint = new CashuMint(mintUrl);
		const wallet = new CashuWallet(mint);
		const invoice =
			'lnbc20u1p3u27nppp5pm074ffk6m42lvae8c6847z7xuvhyknwgkk7pzdce47grf2ksqwsdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzpgxqyz5vqsp5sw6n7cztudpl5m5jv3z6dtqpt2zhd3q6dwgftey9qxv09w82rgjq9qyyssqhtfl8wv7scwp5flqvmgjjh20nf6utvv5daw5h43h69yqfwjch7wnra3cn94qkscgewa33wvfh7guz76rzsfg9pwlk8mqd27wavf2udsq3yeuju';
		const meltQuote = await wallet.createMultiPathMeltQuote(invoice, 1000);
		expect(meltQuote.amount).toBe(1);
		expect(meltQuote.quote).toBe('K-80Mo7xrtQRgaA1ifrxDKGQGZEGlo7zNDwTtf-D');
		await expect(wallet.createMeltQuote(invoice)).rejects.toThrow();
	});
});
describe('P2PK BlindingData', () => {
	test('Create BlindingData locked to pk with locktime and single refund key', async () => {
		const wallet = new CashuWallet(mint);
		const keys = await wallet.getKeys();
		const data = OutputData.createP2PKData(
			{ pubkey: 'thisisatest', locktime: 212, refundKeys: ['iamarefund'] },
			21,
			keys
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', 212]);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund']);
		});
	});
	test('Create BlindingData locked to pk with locktime and multiple refund keys', async () => {
		const wallet = new CashuWallet(mint);
		const keys = await wallet.getKeys();
		const data = OutputData.createP2PKData(
			{ pubkey: 'thisisatest', locktime: 212, refundKeys: ['iamarefund', 'asecondrefund'] },
			21,
			keys
		);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toContainEqual(['locktime', 212]);
			expect(s[1].tags).toContainEqual(['refund', 'iamarefund', 'asecondrefund']);
		});
	});
	test('Create BlindingData locked to pk without locktime and no refund keys', async () => {
		const wallet = new CashuWallet(mint);
		const keys = await wallet.getKeys();
		const data = OutputData.createP2PKData({ pubkey: 'thisisatest' }, 21, keys);
		const decoder = new TextDecoder();
		const allSecrets = data.map((d) => JSON.parse(decoder.decode(d.secret)));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('thisisatest');
			expect(s[1].tags).toEqual([]);
		});
	});
});

describe('Restoring deterministic proofs', () => {
	test('Batch restore', async () => {
		const wallet = new CashuWallet(mint);
		let rounds = 0;
		const mockRestore = vi
			.spyOn(wallet, 'restore')
			.mockImplementation(async (start, count, options?): Promise<{ proofs: Array<Proof> }> => {
				if (rounds === 0) {
					rounds++;
					return { proofs: Array(21).fill(1) as Array<Proof> };
				}
				rounds++;
				return { proofs: [] };
			});
		const { proofs: restoredProofs } = await wallet.batchRestore();
		expect(restoredProofs.length).toBe(21);
		expect(mockRestore).toHaveBeenCalledTimes(4);
		mockRestore.mockClear();
	});
	test('Batch restore with custom values', async () => {
		const wallet = new CashuWallet(mint);
		let rounds = 0;
		const mockRestore = vi
			.spyOn(wallet, 'restore')
			.mockImplementation(
				async (
					start,
					count,
					options?
				): Promise<{ proofs: Array<Proof>; lastCounterWithSignature?: number }> => {
					if (rounds === 0) {
						rounds++;
						return { proofs: Array(42).fill(1) as Array<Proof>, lastCounterWithSignature: 41 };
					}
					rounds++;
					return { proofs: [] };
				}
			);
		const { proofs: restoredProofs, lastCounterWithSignature } = await wallet.batchRestore(
			100,
			50,
			0
		);
		expect(restoredProofs.length).toBe(42);
		expect(mockRestore).toHaveBeenCalledTimes(3);
		expect(lastCounterWithSignature).toBe(41);
		mockRestore.mockClear();
	});
});

describe('Blind Authentication', () => {
	test('Mint Info', async () => {
		const mintInfo = JSON.parse(
			'{"name":"Testnut auth mint","pubkey":"020fbbac41bcbd8d9b5353ee137baf45e0b21ccf33c0721a09bc7cbec495b156a2","version":"Nutshell/0.16.4","description":"","description_long":"","contact":[{"method":"email","info":"contact@me.com"},{"method":"twitter","info":"@me"},{"method":"nostr","info":"npub1337"}],"motd":"","icon_url":"","time":1738594208,"nuts":{"4":{"methods":[{"method":"bolt11","unit":"sat","description":true},{"method":"bolt11","unit":"usd","description":true},{"method":"bolt11","unit":"eur","description":true}],"disabled":false},"5":{"methods":[{"method":"bolt11","unit":"sat"},{"method":"bolt11","unit":"usd"},{"method":"bolt11","unit":"eur"}],"disabled":false},"7":{"supported":true},"8":{"supported":true},"9":{"supported":true},"10":{"supported":true},"11":{"supported":true},"12":{"supported":true},"14":{"supported":true},"20":{"supported":true},"17":{"supported":[{"method":"bolt11","unit":"sat","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"usd","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"eur","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]}]},"21":{"openid_discovery":"https://oicd.8333.space/realms/nutshell/.well-known/openid-configuration","client_id":"cashu-client","protected_endpoints":[{"method":"POST","path":"/v1/auth/blind/mint"}]},"22":{"bat_max_mint":100,"protected_endpoints":[{"method":"POST","path":"/v1/swap"},{"method":"POST","path":"/v1/mint/quote/bolt11"},{"method":"POST","path":"/v1/mint/bolt11"},{"method":"POST","path":"/v1/melt/bolt11"}]}}}'
		);
		server.use(
			http.get(mintUrl + '/v1/info', () => {
				return HttpResponse.json(mintInfo);
			})
		);
		const wallet = new CashuWallet(mint);
		const info = await wallet.getMintInfo();
		const mintRequiresAuth = info.requiresBlindAuthToken('/v1/mint/bolt11');
		const restoreRequiresAuth = info.requiresBlindAuthToken('v1/restore');
		expect(mintRequiresAuth).toBeTruthy();
		expect(restoreRequiresAuth).toBeFalsy();
	});
});

describe('Test coinselection', () => {
	const notes = [
		{
			id: '009a1f293253e41e',
			amount: 2,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
		},
		{
			id: '009a1f293253e41e',
			amount: 8,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
		},
		{
			id: '009a1f293253e41e',
			amount: 16,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
		},
		{
			id: '009a1f293253e41e',
			amount: 16,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
		},
		{
			id: '009a1f293253e41e',
			amount: 1,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
		},
		{
			id: '009a1f293253e41e',
			amount: 1,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
		}
	];
	test('offline coinselection, zero fee keyset', async () => {
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const targetAmount = 25;
		const { send } = await wallet.send(targetAmount, notes, { offline: true, includeFees: false });
		expect(send).toHaveLength(3);
		const amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		expect(amountSend).toBe(25);
		const { send: sendFeesInc } = await wallet.send(targetAmount, notes, {
			offline: true,
			includeFees: true
		});
		expect(sendFeesInc).toHaveLength(3);
		const amountSendFeesInc = sendFeesInc.reduce((acc, p) => acc + p.amount, 0);
		expect(amountSendFeesInc).toBe(25);
	});
	test('next best match coinselection', async () => {
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const targetAmount = 23;
		const { send } = wallet.selectProofsToSend(
			notes,
			targetAmount,
			true, // includeFees
			false // no exact match
		);
		console.log(
			'send',
			send.map((p) => p.amount)
		);
		expect(send).toHaveLength(2);
		const amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		expect(amountSend).toBe(24);
	});
	test('offline coinselection with large input fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 1000 }]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const targetAmount = 31;
		const { send } = await wallet.send(targetAmount, notes, { offline: true, includeFees: true });
		const amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		const fee = wallet.getFeesForProofs(send);
		// Fee = ceil(3 * 1000 / 1000) = 3, net = 34 - 3 = 31
		console.log('optimal:>>', [16, 16, 2]);
		expect(send).toHaveLength(3);
		expect(amountSend).toBe(34);
		expect(amountSend - fee).toBe(targetAmount);
	});
	test('offline coinselection with medium input fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 600 }]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const targetAmount = 31;
		const { send } = await wallet.send(targetAmount, notes, { offline: true, includeFees: true });
		// const { send } = wallet.selectProofsToSend(
		// 	notes,
		// 	targetAmount,
		// 	true, // includeFees
		// 	true // no exact match
		// );
		const amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		const fee = wallet.getFeesForProofs(send);
		// Fee = ceil(3 * 600 / 1000) = 2, net = 33 - 2 = 31
		console.log('optimal:>>', [16, 16, 1]);
		expect(send).toHaveLength(3);
		expect(amountSend).toBe(33);
		expect(amountSend - fee).toBe(targetAmount);
	});
	test('insufficient proofs', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 600 }]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const smallNotes = [
			{ id: '009a1f293253e41e', amount: 1, secret: 'secret1', C: 'C1' },
			{ id: '009a1f293253e41e', amount: 1, secret: 'secret2', C: 'C2' },
			{ id: '009a1f293253e41e', amount: 2, secret: 'secret3', C: 'C3' }
		]; // Total = 4
		const targetAmount = 5;
		// Fee for 3 proofs = ceil(3 * 600 / 1000) = 2, need 5 + 2 = 7, but 4 < 7, so expect throw
		await expect(
			wallet.send(targetAmount, smallNotes, {
				offline: true,
				includeFees: true
			})
		).rejects.toThrow('Not enough funds available to send');
		// try using selectProofsToSend directly
		const { send, keep } = wallet.selectProofsToSend(
			smallNotes,
			targetAmount,
			true, // includeFees
			true //  exact match
		);
		// Fee = ceil(1 * 1000 / 1000) = 1, need 60 + 1 = 61, 64 >= 61
		expect(send).toHaveLength(0);
		expect(keep).toHaveLength(3);
	});
	test('single proof selection', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 1000 }]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const largeNote = [
			{ id: '009a1f293253e41e', amount: 64, secret: 'secret1', C: 'C1' },
			{ id: '009a1f293253e41e', amount: 16, secret: 'secret2', C: 'C2' },
			{ id: '009a1f293253e41e', amount: 4, secret: 'secret3', C: 'C3' }
		];
		const targetAmount = 60;
		const { send } = wallet.selectProofsToSend(
			largeNote,
			targetAmount,
			true, // includeFees
			false // no exact match
		);
		// Fee = ceil(1 * 1000 / 1000) = 1, need 60 + 1 = 61, 64 >= 61
		expect(send).toHaveLength(1);
		expect(send[0].amount).toBe(64);
		const amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		const fee = wallet.getFeesForProofs(send);
		expect(amountSend - fee).toBeGreaterThanOrEqual(targetAmount);
		const { send: sendExact } = wallet.selectProofsToSend(
			largeNote,
			15,
			true, // includeFees
			false // exact match
		);
		// Fee = ceil(1 * 1000 / 1000) = 1, need 15 + 1 = 16
		expect(sendExact).toHaveLength(1);
		expect(sendExact[0].amount).toBe(16);
	});
	test('multiple keysets with different fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [
						{ id: '00keyset1', unit: 'sat', active: true, input_fee_ppk: 600 },
						{ id: '00keyset2', unit: 'sat', active: true, input_fee_ppk: 1000 }
					]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const mixedNotes = [
			{ id: '00keyset1', amount: 16, secret: 'secret1', C: 'C1' },
			{ id: '00keyset2', amount: 16, secret: 'secret2', C: 'C2' },
			{ id: '00keyset1', amount: 1, secret: 'secret3', C: 'C3' },
			{ id: '00keyset2', amount: 10, secret: 'secret4', C: 'C4' }
		];
		const targetAmount = 31;
		const { send } = wallet.selectProofsToSend(
			mixedNotes,
			targetAmount,
			true, // includeFees
			false // no exact match
		);
		const amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		const fee = wallet.getFeesForProofs(send);
		expect(amountSend - fee).toBeGreaterThanOrEqual(targetAmount);
		// e.g., [16_00keyset1, 16_00keyset2, 10_00keyset2], fee = ceil((600+1000+1000)/1000) = 3, net = 42 - 3 = 39 >= 31
		expect(send).toHaveLength(3);
		expect(amountSend).toBe(42);
	});
	test('zero amount to send', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 600 }]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const targetAmount = 0;
		// Exact match (offline)
		const { send } = await wallet.send(targetAmount, notes, { offline: true, includeFees: true });
		// No proofs needed, fee = 0, net = 0 >= 0
		expect(send).toHaveLength(0);
		// try using selectProofsToSend directly
		const { send: send1, keep: keep1 } = wallet.selectProofsToSend(
			notes,
			targetAmount,
			true, // includeFees
			true //  exact match
		);
		expect(send1).toHaveLength(0);
		expect(keep1).toHaveLength(6);
	});
	test('all proofs smaller than target', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 600 }]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const smallNotes = [
			{ id: '009a1f293253e41e', amount: 8, secret: 'secret1', C: 'C1' },
			{ id: '009a1f293253e41e', amount: 8, secret: 'secret2', C: 'C2' },
			{ id: '009a1f293253e41e', amount: 8, secret: 'secret3', C: 'C3' },
			{ id: '009a1f293253e41e', amount: 1, secret: 'secret4', C: 'C4' }
		];
		const targetAmount = 15;
		// Exact match (offline)
		const { send } = await wallet.send(targetAmount, smallNotes, {
			offline: true,
			includeFees: true
		});
		const amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		// Fee = ceil(3 * 600 / 1000) = 2, need 15 + 2 = 17
		expect(send).toHaveLength(3);
		expect(amountSend).toBe(17);
		const fee = wallet.getFeesForProofs(send);
		expect(amountSend - fee).toBe(targetAmount);
		// Best match (online)
		const { send: sendOffline } = wallet.selectProofsToSend(
			smallNotes,
			targetAmount + 1, // 16
			true, // includeFees
			false // no exact match
		);
		console.log('sendOffline', sendOffline);
		const amountSendOffline = sendOffline.reduce((acc, p) => acc + p.amount, 0);
		// Fee = ceil(3 * 600 / 1000) = 2, need 16 + 2 = 18 (24 > 18 = best match)
		expect(sendOffline).toHaveLength(3);
		expect(amountSendOffline).toBe(24);
	});
	test('integration select 10 from 100 minted', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 600 }]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const smallNotes = [
			{ id: '009a1f293253e41e', amount: 64, secret: 'secret1', C: 'C1' },
			{ id: '009a1f293253e41e', amount: 32, secret: 'secret2', C: 'C2' },
			{ id: '009a1f293253e41e', amount: 4, secret: 'secret3', C: 'C3' }
		];
		const targetAmount = 10;
		// best match (online)
		const { send } = wallet.selectProofsToSend(
			smallNotes,
			targetAmount,
			true, // includeFees
			false // no exact match
		);
		console.log(
			'send',
			send.map((p) => p.amount)
		);
		expect(send).toBeDefined();
		expect(send.length).toBe(1);
		const amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		expect(amountSend).toBe(32);
	});
	test('exact match not possible', async () => {
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const proofs = [
			{ id: '009a1f293253e41e', amount: 2, secret: 's1', C: 'C1' },
			{ id: '009a1f293253e41e', amount: 2, secret: 's2', C: 'C2' },
			{ id: '009a1f293253e41e', amount: 2, secret: 's3', C: 'C3' }
		];
		const targetAmount = 5;
		await expect(
			wallet.send(targetAmount, proofs, { offline: true, includeFees: true })
		).rejects.toThrow('Not enough funds available to send');
	});
	test('minimal fee selection', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [
						{ id: '00low', unit: 'sat', active: true, input_fee_ppk: 200 },
						{ id: '00high', unit: 'sat', active: true, input_fee_ppk: 1000 }
					]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const proofs = [
			{ id: '00low', amount: 16, secret: 's1', C: 'C1' },
			{ id: '00high', amount: 16, secret: 's2', C: 'C2' },
			{ id: '00low', amount: 8, secret: 's3', C: 'C3' }
		];
		const targetAmount = 20;
		const { send } = wallet.selectProofsToSend(
			proofs,
			targetAmount,
			true, // includeFees
			false // no exact match
		);
		const fee = wallet.getFeesForProofs(send);
		console.log(send.map((p) => [p.amount, p.id]));
		expect(send.every((p) => p.id === '00low')).toBe(true); // Prefer low-fee keyset
		expect(send.reduce((a, p) => a + p.amount, 0) - fee).toBeGreaterThanOrEqual(targetAmount);
	});
	test('zero fee scenario', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 0 }]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const targetAmount = 25;
		const { send } = await wallet.send(targetAmount, notes, { offline: true, includeFees: true });
		const amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		expect(amountSend).toBe(25); // No fee adjustment
	});
	test('duplicate proofs exceeding limit', async () => {
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const dupNotes = Array(10).fill({ id: '009a1f293253e41e', amount: 8, secret: 's', C: 'C' });
		const targetAmount = 24;
		const { send } = await wallet.send(targetAmount, dupNotes, {
			offline: true,
			includeFees: false
		});
		expect(send).toHaveLength(3); // 3 * 8 = 24
	});
	test('non-exact match with zero fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 0 }]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const targetAmount = 23;
		const { send } = wallet.selectProofsToSend(
			notes,
			targetAmount,
			true, // includeFees
			false // no exact match
		);
		expect(send.reduce((a, p) => a + p.amount, 0)).toBeGreaterThanOrEqual(targetAmount);
	});
	test('process large proof array (50+ notes)', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 1000 }]
				});
			})
		);

		// Define 50 additional notes: 128, and 49 others
		const additionalNotes = [
			{
				id: '009a1f293253e41e',
				amount: 128,
				secret: 's255',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			},
			...Array(49)
				.fill(null)
				.map((_, i) => ({
					id: '009a1f293253e41e',
					amount: 2 ** (i % 10), // 1, 2, 4, 8, 16, 32, 64, 128, 256, 512
					secret: `secret${i}`,
					C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
				}))
		];
		const allNotes = [...notes, ...additionalNotes]; // 6 + 50 = 56 notes
		// console.log('allNotes', allNotes.map((p)=>p.amount));
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });

		// Exact Match Test
		const targetAmountExact = 128;
		console.time('largeProofsExactTest');
		const { send: sendExact } = wallet.selectProofsToSend(
			allNotes,
			targetAmountExact,
			true, // includeFees
			true // exact match
		);
		console.timeEnd('largeProofsExactTest');
		if (sendExact.length === 0) {
			throw new Error('No exact match found');
		}
		const amountSendExact = sendExact.reduce((acc, p) => acc + p.amount, 0);
		const feeExact = wallet.getFeesForProofs(sendExact);
		console.log(
			'Exact send:',
			sendExact.map((p) => p.amount)
		);
		expect(amountSendExact - feeExact).toBe(targetAmountExact);

		// Non-Exact Match Test
		const targetAmountNonExact = 127;
		console.time('largeProofsClosestTest');
		const { send: sendNonExact } = wallet.selectProofsToSend(
			allNotes,
			targetAmountNonExact,
			true, // includeFees
			false // non-exact match
		);
		console.timeEnd('largeProofsClosestTest');
		const amountSendNonExact = sendNonExact.reduce((acc, p) => acc + p.amount, 0);
		const feeNonExact = wallet.getFeesForProofs(sendNonExact);
		console.log(
			'Non-exact send:',
			sendNonExact.map((p) => p.amount)
		);
		expect(amountSendNonExact - feeNonExact).toBeGreaterThanOrEqual(targetAmountNonExact);
	});
	test('select small amount with fees from many small notes', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 600 }]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const smallNotes = [
			...Array(50).fill({ id: '009a1f293253e41e', amount: 1, secret: 's1', C: 'C1' }),
			...Array(50).fill({ id: '009a1f293253e41e', amount: 2, secret: 's2', C: 'C2' })
		];
		const targetAmount = 15;

		// Non-exact match
		const { send } = wallet.selectProofsToSend(
			smallNotes,
			targetAmount,
			true, // includeFees
			false // no exact match
		);
		console.log(
			'send:',
			send.map((p) => p.amount)
		);
		const sum = send.reduce((acc, p) => acc + p.amount, 0);
		const fee = wallet.getFeesForProofs(send);
		expect(sum - fee).toBeGreaterThanOrEqual(targetAmount);
		// Check efficiency: should ideally use around 50 proofs or fewer if larger proofs were available
		expect(send.length).toBeLessThanOrEqual(50);
	});
	test('exorbitant input fees (10 sats per proof)', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 10000 }]
				});
			})
		);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const targetAmount = 5;
		const { send } = wallet.selectProofsToSend(
			notes,
			targetAmount,
			true, // includeFees
			false // exact match
		);
		const fee = wallet.getFeesForProofs(send);
		console.log(
			'send:',
			send.map((p) => p.amount)
		);
		console.log('fee:', fee);
		expect(send.length).toBe(1);
		expect(send[0].amount).toBe(16);
		// 16 - ceil(10000/1000) = 16 - 10 = 6 >= 5
		expect(send.reduce((a, p) => a + p.amount, 0) - fee).toBeGreaterThanOrEqual(targetAmount);
	});
	test('optimal offline coinselection', async () => {
		const wallet = new CashuWallet(mint, { unit });
		await wallet.getKeys();
		const targetAmount = 25;
		const { send } = await wallet.send(targetAmount, notes, {
			offline: true
		});
		expect(send).toHaveLength(3);
		const amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		expect(amountSend).toBe(25);
	});
	test('next optimal offline coinselection', async () => {
		const wallet = new CashuWallet(mint, { unit });
		await wallet.getKeys();
		const targetAmount = 23;
		// Offline means exact match only, and we throw if we can't make it
		await expect(
			wallet.send(targetAmount, notes, {
				offline: true
			})
		).rejects.toThrow('Not enough funds available to send');
		// expect(send).toHaveLength(2);
		// const amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		// expect(amountSend).toBe(24);
	});

	test('optimal offline coinselection with 1000 ppk input fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [
						{
							id: '009a1f293253e41e',
							unit: 'sat',
							active: true,
							input_fee_ppk: 1000
						}
					]
				});
			})
		);
		const mint = new CashuMint(mintUrl);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const targetAmount = 31;
		const { send } = await wallet.send(targetAmount, notes, {
			offline: true,
			includeFees: true
		});
		expect(send).toHaveLength(3);
		const amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		// fee ppk is 1000:
		// * 2 proofs (optimal) would have had fee = 2
		// * next optimal solution is 4 proofs with fee 4.
		expect(amountSend).toBe(34);
	});
	test('optimal offline coinselection with 600 ppk input fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [
						{
							id: '009a1f293253e41e',
							unit: 'sat',
							active: true,
							input_fee_ppk: 600
						}
					]
				});
			})
		);
		const mint = new CashuMint(mintUrl);
		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const targetAmount = 31;
		const { send } = await wallet.send(targetAmount, notes, {
			offline: true,
			includeFees: true
		});
		expect(send).toHaveLength(3);
		const amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		expect(amountSend).toBe(33);
	});
	test('bench aggressive coinselection with huge proofsets and fees (with mixed amounts)', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [
						{
							id: '009a1f293253e41e',
							unit: 'sat',
							active: true,
							input_fee_ppk: 600
						}
					]
				});
			})
		);
		let numProofs = 1000;
		let proofs: Array<Proof> = [];
		for (let i = 0; i < numProofs; ++i) {
			const amount = (new DataView(randomBytes(4).buffer).getUint32(0, false)) & ((1 << 19) - 1);
			const proof = {
				id: '009a1f293253e41e',
				amount: amount,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			};
			proofs.push(proof);
		}

		const totalAmount = proofs.reduce((acc, p) => p.amount + acc, 0);

		console.log(`totalAmount: ${totalAmount}`);
		console.log(`N Proofs: ${numProofs}`);

		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const amountToSend = Math.floor((Math.random() * totalAmount) / 2 + totalAmount / 2);

		// Reusable vars
		let amountSend;
		let amountKeep;
		let send;
		let keep;
		let fee;

		// Non-exact match test
		console.time('selectProofs-fees-closest');
		({ send } = wallet.selectProofsToSend(
			proofs,
			amountToSend,
			true, // includeFees
			false // no exact match
		));
		console.timeEnd('selectProofs-fees-closest');
		fee = wallet.getFeesForProofs(send);
		amountSend = send.reduce((acc, p) => acc + p.amount, 0);
		expect(amountSend - fee).toBeGreaterThanOrEqual(amountToSend);

		// Exact match test
		console.time('selectProofs-fees-exact');
		({ send, keep } = wallet.selectProofsToSend(
			proofs,
			amountToSend,
			true, // includeFees
			true // exact match
		));
		console.timeEnd('selectProofs-fees-exact');
		amountKeep = keep.reduce((acc, p) => acc + p.amount, 0);
		fee = wallet.getFeesForProofs(send);
		amountSend = send.reduce((acc, p) => acc + p.amount, 0);

		if (send.length > 0) {
			// Exact match found
			expect(amountSend - fee).toEqual(amountToSend);
		} else {
			// No exact match possible, all proofs kept
			expect(amountKeep).toEqual(totalAmount);
			expect(send).toHaveLength(0);
		}
	});
	test('comparative coinselection DP optimal vs RGLI approximate (with mixed amounts)', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [
						{
							id: '009a1f293253e41e',
							unit: 'sat',
							active: true,
							input_fee_ppk: 600
						}
					]
				});
			})
		);
		let numProofs = 30;
		let proofs: Array<Proof> = [];
		for (let i = 0; i < numProofs; ++i) {
			const amount = (new DataView(randomBytes(4).buffer).getUint32(0, false)) & ((1 << 19) - 1);
			const proof = {
				id: '009a1f293253e41e',
				amount: amount,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			};
			proofs.push(proof);
		}

		const totalAmount = proofs.reduce((acc, p) => p.amount + acc, 0);

		console.log(`totalAmount: ${totalAmount}`);
		console.log(`N Proofs: ${numProofs}`);

		const keysets = await mint.getKeySets();
		const wallet = new CashuWallet(mint, { unit, keysets: keysets.keysets });
		const amountToSend = Math.floor((Math.random() * totalAmount) / 2 + totalAmount / 2);
		console.log(`target amount to send: ${amountToSend}`);

		// Lollerfirst's DP version - selectProofsToSendV2:
		const { send: sendDP } = wallet.selectProofsToSendV2(
			proofs,
			amountToSend,
			true, // includeFees
		);
		const feeDP = wallet.getFeesForProofs(sendDP);
		const amountSendDP = sendDP.reduce((acc, p) => acc + p.amount, 0);
		expect(amountSendDP - feeDP).toBeGreaterThanOrEqual(amountToSend);

		console.log(`selectProofs-DP: send.length = ${sendDP.length}`);
		console.log(`selectProofs-DP: amountSend = ${amountSendDP}`);

		const { send: sendRGLI } = wallet.selectProofsToSend(
			proofs,
			amountToSend,
			true, // includeFees
			false, // close match
		);

		const feeRGLI = wallet.getFeesForProofs(sendRGLI);
		const amountSendRGLI = sendRGLI.reduce((acc, p) => acc + p.amount, 0);
		console.log(`selectProofs-RGLI: send.length = ${sendRGLI.length}`);
		console.log(`selectProofs-RGLI: amountSend = ${amountSendRGLI}`);
		expect(amountSendRGLI - feeRGLI).toBeGreaterThanOrEqual(amountToSend);

		console.log(`\namountToSend-RGLI relative error: ${(1 - amountSendDP / amountSendRGLI).toExponential(8)}`);
	})
});

function expectNUT10SecretDataToEqual(p: Array<Proof>, s: string) {
	p.forEach((p) => {
		const parsedSecret = JSON.parse(p.secret);
		expect(parsedSecret[1].data).toBe(s);
	});
}
