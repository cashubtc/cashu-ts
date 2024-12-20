import { setupServer } from 'msw/node';
import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, afterAll, afterEach, test, describe, expect } from 'vitest';

import { CashuMint } from '../src/CashuMint.js';
import { CashuWallet } from '../src/CashuWallet.js';
import {
	CheckStateEnum,
	MeltQuoteResponse,
	MeltQuoteState,
	MintQuoteResponse,
	MintQuoteState
} from '../src/model/types/index.js';
import { getDecodedToken } from '../src/utils.js';
import { Server, WebSocket } from 'mock-socket';
import { injectWebSocketImpl } from '../src/ws.js';
import { MintInfo } from '../src/model/MintInfo.js';
import { OutputData } from '../src/model/OutputData.js';

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
		const wallet = new CashuWallet(mint, { unit });

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
		const wallet = new CashuWallet(mint, { unit });

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
		const wallet = new CashuWallet(mint, { unit });

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
			expect(s[1].tags).toContainEqual(['refund', ['iamarefund']]);
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
			expect(s[1].tags).toContainEqual(['refund', ['iamarefund', 'asecondrefund']]);
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
