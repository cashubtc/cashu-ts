import { HttpResponse, http } from 'msw';
import { test, describe, expect } from 'vitest';

import {
	Wallet,
	type Proof,
	type MeltQuoteBolt11Response,
	type MeltQuoteBaseResponse,
	type MintQuoteBaseResponse,
	MeltQuoteState,
	MintQuoteState,
	MintQuoteBolt11Response,
	Amount,
	AmountLike,
} from '../../src';

import { Bytes } from '../../src/utils';
import { hexToBytes } from '@noble/curves/utils.js';
import { useTestServer, mint, mintUrl, unit, logger } from './_setup';

const server = useTestServer();

describe('requestTokens', () => {
	test('test requestTokens', async () => {
		server.use(
			http.post(mintUrl + '/v1/mint/bolt11', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const mintQuote: MintQuoteBolt11Response = {
			quote: 'test-quote-id',
			request: 'lnbc...',
			amount: Amount.from(1),
			unit: 'sat',
			state: MintQuoteState.UNPAID,
			expiry: null,
		};
		const proofs = await wallet.mintProofsBolt11(1, mintQuote);

		expect(proofs).toHaveLength(1);
		expect(proofs[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('prepareMint defers request until completeMint', async () => {
		let mintCalls = 0;
		server.use(
			http.post(mintUrl + '/v1/mint/bolt11', () => {
				mintCalls += 1;
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const mintQuote: MintQuoteBolt11Response = {
			quote: 'deferred-quote-id',
			request: 'lnbc...',
			amount: Amount.from(1),
			unit: 'sat',
			state: MintQuoteState.UNPAID,
			expiry: null,
		};
		const preview = await wallet.prepareMint('bolt11', 1, mintQuote);
		expect(mintCalls).toBe(0);
		expect(preview.method).toBe('bolt11');
		expect(preview.payload.quote).toBe('deferred-quote-id');
		expect(preview.outputData).toHaveLength(1);

		const proofs = await wallet.completeMint(preview);

		expect(mintCalls).toBe(1);
		expect(proofs).toHaveLength(1);
		expect(proofs[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
	});

	test('test requestTokens bad response', async () => {
		server.use(
			http.post(mintUrl + '/v1/mint/bolt11', () => {
				return HttpResponse.json({});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const mintQuote: MintQuoteBolt11Response = {
			quote: 'bad-response-quote',
			request: 'lnbc...',
			amount: Amount.from(1),
			unit: 'sat',
			state: MintQuoteState.UNPAID,
			expiry: null,
		};
		await expect(wallet.mintProofsBolt11(1, mintQuote)).rejects.toThrow(
			'Invalid response from mint',
		);
		await expect(wallet.mintProofsBolt11(1, 'badquote')).rejects.toThrow(
			'Invalid response from mint',
		);
	});

	test('prepareMint deterministic counters reserve once and avoid duplicate outputs', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 0 }],
				});
			}),
		);

		const keysetId = '00bd033559de27d0';
		const seed = hexToBytes(
			'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
		);
		const wallet = new Wallet(mint, { unit, bip39seed: seed, logger });
		await wallet.loadMint();

		const mintQuote: MintQuoteBolt11Response = {
			quote: 'quote123',
			request: 'lnbc...',
			amount: Amount.from(1),
			unit: 'sat',
			state: MintQuoteState.UNPAID,
			expiry: null,
		};

		const preview = await wallet.prepareMint('bolt11', 3, mintQuote, undefined, {
			type: 'deterministic',
			counter: 0,
		});

		expect(preview.outputData.length).toBeGreaterThan(0);
		const secrets = preview.outputData.map((p) => Bytes.toHex(p.secret));
		expect(new Set(secrets).size).toBe(secrets.length);
		expect(await wallet.counters.peekNext(keysetId)).toBe(preview.outputData.length);
	});
});

describe('generic mint/melt methods', () => {
	describe('wallet.createMintQuote / checkMintQuote', () => {
		test('createMintQuote with custom method hits /v1/mint/quote/{method}', async () => {
			server.use(
				http.post(mintUrl + '/v1/mint/quote/bacs', () =>
					HttpResponse.json({
						quote: 'bacs-quote-1',
						request: 'CASHU-REF-ABC',
						unit: 'gbp',
						amount: 5000,
						reference: 'REF-123',
						state: MintQuoteState.UNPAID,
						expiry: null,
					}),
				),
			);
			const wallet = new Wallet(mint, { unit });
			await wallet.loadMint();

			type BacsMintQuoteRes = MintQuoteBaseResponse & {
				amount: Amount;
				reference: string;
				state: MintQuoteState;
			};

			const quote = await wallet.createMintQuote<BacsMintQuoteRes>(
				'bacs',
				{
					amount: 5000n,
					sort_code: '12-34-56',
				},
				{
					normalize: (raw) => ({
						...(raw as BacsMintQuoteRes),
						amount: Amount.from(raw.amount as AmountLike),
					}),
				},
			);

			expect(quote.quote).toBe('bacs-quote-1');
			expect(quote.request).toBe('CASHU-REF-ABC');
			expect(quote.reference).toBe('REF-123');
			expect(quote.amount).toBeInstanceOf(Amount);
			expect(quote.amount.toBigInt()).toBe(5000n);
		});

		test('createMintQuote forces wallet unit over payload unit', async () => {
			server.use(
				http.post(mintUrl + '/v1/mint/quote/bacs', async ({ request }) => {
					const body = (await request.json()) as { unit: string };
					return HttpResponse.json({
						quote: 'bacs-quote-unit',
						request: 'CASHU-REF-UNIT',
						unit: body.unit,
					});
				}),
			);
			const wallet = new Wallet(mint, { unit: 'sat' });
			await wallet.loadMint();

			const quote = await wallet.createMintQuote('bacs', {
				amount: 5000n,
				unit: 'usd',
			});

			expect(quote.unit).toBe('sat');
		});

		test('createMintQuote for bolt11 delegates correctly', async () => {
			server.use(
				http.post(mintUrl + '/v1/mint/quote/bolt11', () =>
					HttpResponse.json({
						quote: 'bolt11-quote-1',
						request: 'lnbc1000...',
						unit: 'sat',
						amount: 1000,
						state: MintQuoteState.UNPAID,
						expiry: 3600,
					}),
				),
			);
			const wallet = new Wallet(mint, { unit });
			await wallet.loadMint();

			const quote = await wallet.createMintQuoteBolt11(1000);

			expect(quote.quote).toBe('bolt11-quote-1');
			expect(quote.amount).toBeInstanceOf(Amount);
			expect(quote.amount.toBigInt()).toBe(1000n);
		});

		test('checkMintQuoteBolt11 does not merge caller fields over mint response', async () => {
			server.use(
				http.get(mintUrl + '/v1/mint/quote/bolt11/bolt11-quote-merge', () =>
					HttpResponse.json({
						quote: 'bolt11-quote-merge',
						request: 'lnbc-remote',
						unit: 'sat',
						amount: 1000,
						state: MintQuoteState.PAID,
						expiry: 3600,
					}),
				),
			);
			const wallet = new Wallet(mint, { unit });
			await wallet.loadMint();

			const quote = await wallet.checkMintQuoteBolt11({
				quote: 'bolt11-quote-merge',
				request: 'lnbc-local',
				unit: 'usd',
				amount: Amount.from(1),
				state: MintQuoteState.UNPAID,
				expiry: null,
			});

			expect(quote.request).toBe('lnbc-remote');
			expect(quote.unit).toBe('sat');
		});

		test('checkMintQuote with custom method hits /v1/mint/quote/{method}/{id}', async () => {
			server.use(
				http.get(mintUrl + '/v1/mint/quote/bacs/bacs-quote-1', () =>
					HttpResponse.json({
						quote: 'bacs-quote-1',
						request: 'CASHU-REF-ABC',
						unit: 'gbp',
						amount: 5000,
						reference: 'REF-123',
						state: MintQuoteState.PAID,
						expiry: null,
					}),
				),
			);
			const wallet = new Wallet(mint, { unit });
			await wallet.loadMint();

			type BacsMintQuoteRes = MintQuoteBaseResponse & {
				amount: Amount;
				reference: string;
				state: MintQuoteState;
			};

			const quote = await wallet.checkMintQuote<BacsMintQuoteRes>('bacs', 'bacs-quote-1', {
				normalize: (raw) => ({
					...(raw as BacsMintQuoteRes),
					amount: Amount.from(raw.amount as AmountLike),
				}),
			});

			expect(quote.quote).toBe('bacs-quote-1');
			expect(quote.state).toBe(MintQuoteState.PAID);
			expect(quote.amount).toBeInstanceOf(Amount);
		});

		test('checkMintQuote accepts quote object', async () => {
			server.use(
				http.get(mintUrl + '/v1/mint/quote/bacs/bacs-quote-2', () =>
					HttpResponse.json({
						quote: 'bacs-quote-2',
						request: 'REF',
						unit: 'gbp',
						state: MintQuoteState.UNPAID,
						expiry: null,
					}),
				),
			);
			const wallet = new Wallet(mint, { unit });
			await wallet.loadMint();

			const quote = await wallet.checkMintQuote('bacs', { quote: 'bacs-quote-2' });
			expect(quote.quote).toBe('bacs-quote-2');
		});
	});

	describe('wallet.mintProofs', () => {
		test('mintProofs with custom method hits /v1/mint/{method}', async () => {
			server.use(
				http.post(mintUrl + '/v1/mint/bacs', () => {
					return HttpResponse.json({
						signatures: [
							{
								id: '00bd033559de27d0',
								amount: 1,
								C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625',
							},
						],
					});
				}),
			);
			const wallet = new Wallet(mint, { unit });
			await wallet.loadMint();

			const customQuote = { quote: 'custom-mint-quote' };
			const proofs = await wallet.mintProofs('bacs', 1, customQuote);

			expect(proofs).toHaveLength(1);
			expect(proofs[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		});

		test('mintProofs rejects quote objects in the wrong wallet unit', async () => {
			const wallet = new Wallet(mint, { unit: 'sat' });
			await wallet.loadMint();

			await expect(
				wallet.mintProofs('bacs', 1, {
					quote: 'wrong-unit-mint-quote',
					request: 'req',
					unit: 'usd',
				}),
			).rejects.toThrow("Quote unit 'usd' does not match wallet unit 'sat'");
		});
	});

	describe('wallet.createMeltQuote / checkMeltQuote', () => {
		test('createMeltQuote with custom method hits /v1/melt/quote/{method}', async () => {
			server.use(
				http.post(mintUrl + '/v1/melt/quote/bacs', () =>
					HttpResponse.json({
						quote: 'bacs-melt-1',
						amount: 5000,
						unit: 'gbp',
						state: MeltQuoteState.UNPAID,
						expiry: 3600,
						fee_estimate: 50,
						reference: 'BACS-PAY-REF',
					}),
				),
			);
			const wallet = new Wallet(mint, { unit });
			await wallet.loadMint();

			type BacsMeltQuoteRes = MeltQuoteBaseResponse & {
				fee_estimate: Amount;
				reference: string;
			};

			const quote = await wallet.createMeltQuote<BacsMeltQuoteRes>(
				'bacs',
				{
					request: 'GB29NWBK60161331926819',
					amount: 5000n,
				},
				{
					normalize: (raw) => ({
						...(raw as BacsMeltQuoteRes),
						fee_estimate: Amount.from(raw.fee_estimate as AmountLike),
					}),
				},
			);

			expect(quote.quote).toBe('bacs-melt-1');
			expect(quote.amount).toBeInstanceOf(Amount);
			expect(quote.amount.toBigInt()).toBe(5000n);
			expect(quote.fee_estimate).toBeInstanceOf(Amount);
			expect(quote.fee_estimate.toBigInt()).toBe(50n);
			expect(quote.reference).toBe('BACS-PAY-REF');
		});

		test('createMeltQuote forces wallet unit over payload unit', async () => {
			server.use(
				http.post(mintUrl + '/v1/melt/quote/bacs', async ({ request }) => {
					const body = (await request.json()) as { unit: string };
					return HttpResponse.json({
						quote: 'bacs-melt-unit',
						amount: 5000,
						unit: body.unit,
						state: MeltQuoteState.UNPAID,
						expiry: 3600,
					});
				}),
			);
			const wallet = new Wallet(mint, { unit: 'sat' });
			await wallet.loadMint();

			const quote = await wallet.createMeltQuote('bacs', {
				request: 'GB29NWBK60161331926819',
				amount: 5000n,
				unit: 'usd',
			});

			expect(quote.unit).toBe('sat');
		});

		test('checkMeltQuote with custom method hits /v1/melt/quote/{method}/{id}', async () => {
			server.use(
				http.get(mintUrl + '/v1/melt/quote/bacs/bacs-melt-1', () =>
					HttpResponse.json({
						quote: 'bacs-melt-1',
						amount: 5000,
						unit: 'gbp',
						state: MeltQuoteState.PAID,
						expiry: 3600,
					}),
				),
			);
			const wallet = new Wallet(mint, { unit });
			await wallet.loadMint();

			const quote = await wallet.checkMeltQuote('bacs', 'bacs-melt-1');

			expect(quote.quote).toBe('bacs-melt-1');
			expect(quote.state).toBe(MeltQuoteState.PAID);
			expect(quote.amount).toBeInstanceOf(Amount);
		});

		test('checkMeltQuoteBolt11 does not merge caller fields over mint response', async () => {
			server.use(
				http.get(mintUrl + '/v1/melt/quote/bolt11/bolt11-melt-merge', () =>
					HttpResponse.json({
						quote: 'bolt11-melt-merge',
						amount: 5000,
						unit: 'sat',
						state: MeltQuoteState.PAID,
						expiry: 3600,
						fee_reserve: 50,
						request: 'lnbc-remote',
					}),
				),
			);
			const wallet = new Wallet(mint, { unit });
			await wallet.loadMint();

			const quote = await wallet.checkMeltQuoteBolt11({
				quote: 'bolt11-melt-merge',
				amount: Amount.from(1),
				unit: 'usd',
				state: MeltQuoteState.UNPAID,
				expiry: 1,
				fee_reserve: Amount.from(1),
				request: 'lnbc-local',
			});

			expect(quote.request).toBe('lnbc-remote');
			expect(quote.unit).toBe('sat');
		});

		test('checkMeltQuote accepts quote object', async () => {
			server.use(
				http.get(mintUrl + '/v1/melt/quote/bacs/bacs-melt-2', () =>
					HttpResponse.json({
						quote: 'bacs-melt-2',
						amount: 100,
						unit: 'gbp',
						state: MeltQuoteState.UNPAID,
						expiry: 3600,
					}),
				),
			);
			const wallet = new Wallet(mint, { unit });
			await wallet.loadMint();

			const quote = await wallet.checkMeltQuote('bacs', { quote: 'bacs-melt-2' });
			expect(quote.quote).toBe('bacs-melt-2');
		});
	});

	describe('wallet.meltProofs', () => {
		test('meltProofs with custom method hits /v1/melt/{method}', async () => {
			server.use(
				http.post(mintUrl + '/v1/melt/bacs', () => {
					return HttpResponse.json({
						quote: 'bacs-melt-1',
						amount: 10,
						unit: 'sat',
						state: MeltQuoteState.PAID,
						expiry: 3600,
						change: [
							{
								id: '00bd033559de27d0',
								amount: 1,
								C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
							},
						],
					});
				}),
			);
			const wallet = new Wallet(mint, { unit, logger });
			await wallet.loadMint();

			const meltQuote: Pick<MeltQuoteBaseResponse, 'amount' | 'quote'> = {
				quote: 'bacs-melt-1',
				amount: Amount.from(10),
			};
			const proofsToSend: Proof[] = [
				{ id: '00bd033559de27d0', amount: 8n, secret: 'secret1', C: 'C1' },
				{ id: '00bd033559de27d0', amount: 5n, secret: 'secret2', C: 'C2' },
			];

			const response = await wallet.meltProofs('bacs', meltQuote, proofsToSend);

			expect(response.quote.state).toBe(MeltQuoteState.PAID);
			expect(response.change).toHaveLength(1);
			expect(response.change[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		});

		test('meltProofs rejects quote objects in the wrong wallet unit', async () => {
			const wallet = new Wallet(mint, { unit: 'sat' });
			await wallet.loadMint();

			await expect(
				wallet.meltProofs(
					'bacs',
					{
						quote: 'wrong-unit-melt-quote',
						amount: Amount.from(10),
						unit: 'usd',
					},
					[{ id: '00bd033559de27d0', amount: 10n, secret: 'secret1', C: 'C1' }],
				),
			).rejects.toThrow("Quote unit 'usd' does not match wallet unit 'sat'");
		});
	});

	describe('invalid method validation', () => {
		test('rejects invalid method strings', async () => {
			const wallet = new Wallet(mint, { unit });
			await wallet.loadMint();

			await expect(wallet.createMintQuote('INVALID', { amount: 1n })).rejects.toThrow(
				'Invalid mint quote method',
			);

			await expect(wallet.createMintQuote('has spaces', { amount: 1n })).rejects.toThrow(
				'Invalid mint quote method',
			);

			await expect(wallet.createMeltQuote('has/slash', { request: 'x' })).rejects.toThrow(
				'Invalid melt quote method',
			);
		});
	});

	describe('normalizer stacking', () => {
		test('bolt11 normalization is applied automatically via generic', async () => {
			server.use(
				http.post(mintUrl + '/v1/melt/quote/bolt11', () =>
					HttpResponse.json({
						quote: 'bolt11-melt-via-generic',
						amount: 100,
						unit: 'sat',
						fee_reserve: 5,
						state: MeltQuoteState.UNPAID,
						expiry: 3600,
						payment_preimage: null,
						request: 'lnbc100...',
					}),
				),
			);
			const wallet = new Wallet(mint, { unit });
			await wallet.loadMint();

			// Use the generic method with bolt11 — should auto-apply bolt normalization
			const quote = await wallet.createMeltQuote<MeltQuoteBolt11Response>('bolt11', {
				request: 'lnbc100...',
			});

			expect(quote.amount).toBeInstanceOf(Amount);
			expect(quote.amount.toBigInt()).toBe(100n);
			expect(quote.fee_reserve).toBeInstanceOf(Amount);
			expect(quote.fee_reserve.toBigInt()).toBe(5n);
			expect(quote.request).toBe('lnbc100...');
		});

		test('custom normalize runs after base normalization', async () => {
			server.use(
				http.post(mintUrl + '/v1/melt/quote/swift', () =>
					HttpResponse.json({
						quote: 'swift-1',
						amount: 200,
						unit: 'usd',
						state: MeltQuoteState.UNPAID,
						expiry: 7200,
						processing_fee: 15,
					}),
				),
			);
			const wallet = new Wallet(mint, { unit });
			await wallet.loadMint();

			type SwiftRes = MeltQuoteBaseResponse & { processing_fee: Amount };

			const quote = await wallet.createMeltQuote<SwiftRes>(
				'swift',
				{
					request: 'SWIFT-REF',
					amount: 200n,
				},
				{
					normalize: (raw) => ({
						...(raw as SwiftRes),
						processing_fee: Amount.from(raw.processing_fee as AmountLike),
					}),
				},
			);

			// Base fields normalized automatically
			expect(quote.amount).toBeInstanceOf(Amount);
			expect(quote.amount.toBigInt()).toBe(200n);
			// Custom field normalized by callback
			expect(quote.processing_fee).toBeInstanceOf(Amount);
			expect(quote.processing_fee.toBigInt()).toBe(15n);
		});
	});
});
