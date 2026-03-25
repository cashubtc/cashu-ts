import { HttpResponse, http } from 'msw';
import { test, describe, expect } from 'vitest';

import { Wallet, Amount, OutputData, type Proof, type OutputConfig } from '../../src';

import { Bytes } from '../../src/utils';
import { hexToBytes } from '@noble/curves/utils.js';

import { useTestServer, mint, mintUrl, unit, logger } from './_setup';

const server = useTestServer();

function expectNUT10SecretDataToEqual(p: Array<Proof>, s: string) {
	p.forEach((p) => {
		const parsedSecret = JSON.parse(p.secret);
		expect(parsedSecret[1].data).toBe(s);
	});
}

describe('send', () => {
	const proofs = [
		{
			id: '00bd033559de27d0',
			amount: 1n,
			secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
		},
	];
	test('test send base case', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.send(1, proofs);

		expect(result.keep).toHaveLength(0);
		expect(result.send).toHaveLength(1);
		expect(result.send[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
	});

	test('test send accepts AmountLike values', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const amountInputs = [Amount.from(1), 1n, '1'] as const;
		for (const amount of amountInputs) {
			const result = await wallet.send(amount, proofs);
			expect(result.keep).toHaveLength(0);
			expect(result.send).toHaveLength(1);
			expect(result.send[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		}
	});

	test('test send over paying. Should return change', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.send(1, [
			{
				id: '00bd033559de27d0',
				amount: 2n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		]);

		expect(result.send).toHaveLength(1);
		expect(result.send[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(1);
		expect(result.keep[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.keep[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.keep[0].secret)).toBe(true);
	});
	test('test send overpaying with p2pk.', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.send(
			1,
			[
				{
					id: '00bd033559de27d0',
					amount: 2n,
					secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
					C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
				},
			],
			{
				// p2pk: { pubkey: 'pk' }
			},
			{
				send: { type: 'p2pk', options: { pubkey: '02' + 'aa'.repeat(32) } },
			},
		);

		expectNUT10SecretDataToEqual([result.send[0]], '02' + 'aa'.repeat(32));
		expect(result.keep[0].secret.length).toBe(64);
	});

	test('test send over paying2', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const overpayProofs = [
			{
				id: '00bd033559de27d0',
				amount: 2n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		const result = await wallet.send(1, overpayProofs);

		expect(result.send).toHaveLength(1);
		expect(result.send[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(1);
		expect(result.keep[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.keep[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.keep[0].secret)).toBe(true);
	});
	test('test send preference', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const overpayProofs = [
			{
				id: '00bd033559de27d0',
				amount: 2n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 2n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		const result = await wallet.send(
			4,
			overpayProofs,
			{
				// preference: { sendPreference: [{ amount: 1, count: 4 }] }
				// outputAmounts: { sendAmounts: [1, 1, 1, 1], keepAmounts: [] },
			},
			{
				send: { type: 'random', denominations: [1, 1, 1, 1] },
				keep: { type: 'random', denominations: [] },
			},
		);

		expect(result.send).toHaveLength(4);
		expect(result.send[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(result.send[1]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(result.send[2]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(result.send[3]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
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
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const overpayProofs = [
			{
				id: '00bd033559de27d0',
				amount: 2n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 2n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		const result = await wallet.send(
			3,
			overpayProofs,
			{},
			{
				send: { type: 'random', denominations: [1, 1, 1] },
				keep: { type: 'random', denominations: [1] },
			},
		);

		expect(result.send).toHaveLength(3);
		expect(result.send[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(result.send[1]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(result.send[2]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(1);
		expect(result.keep[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
	});

	test('test send not enough funds', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.send(2, proofs).catch((e) => e);

		expect(result).toEqual(new Error('Not enough funds available to send'));
	});
	test('test send bad response', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({});
			}),
		);
		const wallet = new Wallet(mint, { unit, logger });
		await wallet.loadMint();
		await expect(
			wallet.send(1, [
				{
					id: '00bd033559de27d0',
					amount: 2n,
					secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
					C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
				},
			]),
		).rejects.toThrow('Invalid response from mint');
	});
	test('test send with proofsWeHave', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const overpayProofs = [
			{
				id: '00bd033559de27d0',
				amount: 1n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 8n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		const result = await wallet.send(3, overpayProofs, {
			includeFees: true,
			proofsWeHave: [{ secret: '123', C: '123', amount: 64n, id: 'id' }],
		});

		// Swap 8, get 7 back (after 1*600ppk = 1 sat fee).
		// Send 3 [2,1] plus fee (2*600 for send inputs = 1200ppk = 2 sat fee)
		// Total unselected = [1]
		// Total send = [2, 2, 1]  = send 3, total fee = 3*600 = 1800ppk = 2 sats)
		// Total change = [1, 1] because proofs are optimized to target (3)
		// Total keep = [1, 1, 1]
		expect(result.send).toHaveLength(3);
		expect(result.send[0]).toMatchObject({ amount: 2n, id: '00bd033559de27d0' });
		expect(result.send[1]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(result.send[2]).toMatchObject({ amount: 2n, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(3);
		expect(result.keep[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(result.keep[0]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(result.keep[1]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
	});

	test('test send preference with fees included', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);
		server.use(
			http.post(mintUrl + '/v1/swap', async () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const overpayProofs = [
			{
				id: '00bd033559de27d0',
				amount: 1n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 8n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		const result = await wallet.send(3, overpayProofs, { includeFees: true });

		// Swap 8, get 7 back (after 1*600ppk = 1 sat fee).
		// Send 3 [2,1] plus fee (2*600 for send inputs = 1200ppk = 2 sat fee)
		// Total unselected = [1]
		// Total send = [2, 2, 1]  = send 3, total fee = 3*600 = 1800ppk = 2 sats)
		// Total change = [2] because proofs are not optimized
		// Total keep = [2, 1]
		expect(result.send).toHaveLength(3);
		expect(result.send[0]).toMatchObject({ amount: 2n, id: '00bd033559de27d0' });
		expect(result.send[1]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
		expect(result.send[2]).toMatchObject({ amount: 2n, id: '00bd033559de27d0' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(result.send[0].secret)).toBe(true);
		expect(result.keep).toHaveLength(2);
		expect(result.keep[0]).toMatchObject({ amount: 2n, id: '00bd033559de27d0' });
		expect(result.keep[1]).toMatchObject({ amount: 1n, id: '00bd033559de27d0' });
	});
	test('send with deterministic keep/send auto-offsets counters and fees', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);
		const seed = hexToBytes(
			'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
		);
		const wallet = new Wallet(mint, { unit, bip39seed: seed, logger });
		await wallet.loadMint();

		const overpayProofs = [
			{
				id: '00bd033559de27d0',
				amount: 1n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: '00bd033559de27d0',
				amount: 8n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];
		const outputConfig: OutputConfig = {
			send: { type: 'deterministic', counter: 0 },
			keep: { type: 'deterministic', counter: 0 }, // Should auto-offset to send.length
		};
		const result = await wallet.send(3, overpayProofs, { includeFees: true }, outputConfig);
		// Send:  2,1,2 keep: 2 => counter 4
		expect(await wallet.counters.peekNext('00bd033559de27d0')).toBe(4);
		// Assert no overlap (e.g., secrets are unique)
		const allSecrets = [...result.keep, ...result.send].map((p) => p.secret);
		expect(new Set(allSecrets).size).toBe(allSecrets.length); // No duplicates
	});
	test('prepareSwapToSend deterministic counters, manual and auto combos advance cursor and avoid reuse', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);

		const keysetId = '00bd033559de27d0';
		const seed = hexToBytes(
			'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
		);

		const proofs = [
			{
				id: keysetId,
				amount: 1n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: keysetId,
				amount: 8n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];

		const cases: Array<{
			name: string;
			amount: number;
			includeFees: boolean;
			outputConfig: OutputConfig;
		}> = [
			{
				name: 'send manual, keep auto',
				amount: 3,
				includeFees: true,
				outputConfig: {
					send: { type: 'deterministic', counter: 16 },
					keep: { type: 'deterministic', counter: 0 },
				},
			},
			{
				name: 'send auto, keep manual',
				amount: 3,
				includeFees: true,
				outputConfig: {
					send: { type: 'deterministic', counter: 0 },
					keep: { type: 'deterministic', counter: 25 },
				},
			},
			{
				name: 'send auto, keep auto',
				amount: 3,
				includeFees: true,
				outputConfig: {
					send: { type: 'deterministic', counter: 0 },
					keep: { type: 'deterministic', counter: 0 },
				},
			},
			{
				name: 'send manual, keep manual (disjoint)',
				amount: 3,
				includeFees: true,
				outputConfig: {
					send: { type: 'deterministic', counter: 50 },
					keep: { type: 'deterministic', counter: 2 },
				},
			},
			{
				name: 'send manual, keep auto (no includeFees)',
				amount: 3,
				includeFees: false,
				outputConfig: {
					send: { type: 'deterministic', counter: 7 },
					keep: { type: 'deterministic', counter: 0 },
				},
			},
		];

		for (const tc of cases) {
			const wallet = new Wallet(mint, { unit, bip39seed: seed, logger });
			await wallet.loadMint();

			const res = await wallet.prepareSwapToSend(
				tc.amount,
				proofs,
				{ includeFees: tc.includeFees },
				tc.outputConfig,
			);

			const sendLen = res.sendOutputs?.length ?? 0;
			const keepLen = res.keepOutputs?.length ?? 0;

			// No overlap, duplicates would imply reused counters for deterministic outputs
			const allSecrets = [...(res.keepOutputs ?? []), ...(res.sendOutputs ?? [])].map(
				(p) => p.secret,
			);
			expect(new Set(allSecrets).size).toBe(allSecrets.length);

			const sendOT = tc.outputConfig.send;
			const keepOT = tc.outputConfig.keep!; // cases all have keep

			const sendIsManual = sendOT.type === 'deterministic' && sendOT.counter > 0;
			const keepIsManual = keepOT.type === 'deterministic' && keepOT.counter > 0;

			const manualEnds: number[] = [];
			if (sendOT.type === 'deterministic' && sendOT.counter > 0 && sendLen > 0) {
				manualEnds.push(sendOT.counter + sendLen);
			}
			if (keepOT.type === 'deterministic' && keepOT.counter > 0 && keepLen > 0) {
				manualEnds.push(keepOT.counter + keepLen);
			}

			const maxManualEnd = manualEnds.length ? Math.max(...manualEnds) : 0;

			const autoTotal = (sendIsManual ? 0 : sendLen) + (keepIsManual ? 0 : keepLen);

			const expectedNext = maxManualEnd + autoTotal;

			expect(await wallet.counters.peekNext(keysetId)).toBe(expectedNext);
		}
	});

	test('prepareSwapToSend throws when manual deterministic ranges overlap', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);

		const keysetId = '00bd033559de27d0';
		const seed = hexToBytes(
			'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
		);

		const wallet = new Wallet(mint, { unit, bip39seed: seed, logger });
		await wallet.loadMint();

		const proofs = [
			{
				id: keysetId,
				amount: 1n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: keysetId,
				amount: 8n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];

		const outputConfig: OutputConfig = {
			send: { type: 'deterministic', counter: 5 },
			keep: { type: 'deterministic', counter: 5 }, // same start, guaranteed overlap if both have outputs
		};

		await expect(
			wallet.prepareSwapToSend(3, proofs, { includeFees: true }, outputConfig),
		).rejects.toThrow('Manual counter ranges overlap');
	});
	test('manual counters advances cursor, then auto allocation must not reuse counters', async () => {
		server.use(
			http.get(mintUrl + '/v1/keysets', () => {
				return HttpResponse.json({
					keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 600 }],
				});
			}),
		);

		const keysetId = '00bd033559de27d0';
		const seed = hexToBytes(
			'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
		);

		const proofs = [
			{
				id: keysetId,
				amount: 1n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
			{
				id: keysetId,
				amount: 8n,
				secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			},
		];

		const wallet = new Wallet(mint, { unit, bip39seed: seed, logger });
		await wallet.loadMint();

		// Op 1: manual send counter, auto keep counter
		const out1: OutputConfig = {
			send: { type: 'deterministic', counter: 50 },
			keep: { type: 'deterministic', counter: 0 },
		};
		const res1 = await wallet.prepareSwapToSend(3, proofs, { includeFees: true }, out1);

		const sendLen1 = res1.sendOutputs?.length ?? 0;
		const keepLen1 = res1.keepOutputs?.length ?? 0;

		expect(sendLen1).toBeGreaterThan(0);
		expect(keepLen1).toBeGreaterThan(0);

		const secrets1 = [...(res1.keepOutputs ?? []), ...(res1.sendOutputs ?? [])].map(
			(p) => p.secret,
		);

		const send1 = out1.send;
		if (send1.type !== 'deterministic') throw new Error('test setup: send1 must be deterministic');
		const expectedNext1 = send1.counter + sendLen1 + keepLen1;
		expect(await wallet.counters.peekNext(keysetId)).toBe(expectedNext1);

		// Op 2: both auto, must allocate strictly after op1 cursor, no reuse
		const out2: OutputConfig = {
			send: { type: 'deterministic', counter: 0 },
			keep: { type: 'deterministic', counter: 0 },
		};
		const res2 = await wallet.prepareSwapToSend(3, proofs, { includeFees: true }, out2);

		const sendLen2 = res2.sendOutputs?.length ?? 0;
		const keepLen2 = res2.keepOutputs?.length ?? 0;

		expect(sendLen2).toBeGreaterThan(0);

		const secrets2 = [...(res2.keepOutputs ?? []), ...(res2.sendOutputs ?? [])].map(
			(p) => p.secret,
		);

		// No duplicates across both ops, duplicates would imply counter reuse
		const allSecrets = [...secrets1, ...secrets2];
		expect(new Set(allSecrets).size).toBe(allSecrets.length);

		const expectedNext2 = expectedNext1 + sendLen2 + keepLen2;
		expect(await wallet.counters.peekNext(keysetId)).toBe(expectedNext2);
	});
});

describe('deterministic', () => {
	test('no seed', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		const result = await wallet
			.send(
				1,
				[
					{
						id: '00bd033559de27d0',
						amount: 2n,
						secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
						C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
					},
				],
				{},
				{ send: { type: 'deterministic', counter: 1 } },
			)
			.catch((e) => e);
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('Deterministic outputs require a seed configured in the wallet');
	});
	test.each([
		[
			0,
			'8e0ad268631046765b570f85fe0951710c6e0e13c81b3df50ddfee21d235d132',
			'f63e13f15cfebe03e798acf3f738802c6da03bceb16e762b8169f8107316c0de',
		],
		[
			1,
			'0b59dbc968effd7f5ab4649c0d91ab160cbd58e3aa3490d060701f44dd62e52c',
			'c3db201daaaa59771c7e176ff761f44f37adde86a1e56cbc50627d24d1143f5a',
		],
		[
			2,
			'c756ae91cf316eaa4b845edcca35f04ee9d1732c10e7205b0ef30123bcbbc1b8',
			'6d1e1424bc2c84df6a5ee6295683e152e002891c3c142513eee41d8f3307e8f0',
		],
	])(
		'deterministic OutputData -- Legacy Derivation: counter %i -> secret: %s, r: %s',
		async (counter, secret, r) => {
			const hexSeed =
				'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8';

			const numberR = Bytes.toBigInt(hexToBytes(r));
			const decoder = new TextDecoder();

			const data = OutputData.createSingleDeterministicData(
				0,
				hexToBytes(hexSeed),
				counter,
				'00bd033559de27d0',
			);
			expect(decoder.decode(data.secret)).toBe(secret);
			expect(data.blindingFactor).toBe(numberR);
		},
	);

	test.each([
		[
			0,
			'ba250bf927b1df5dd0a07c543be783a4349a7f99904acd3406548402d3484118',
			'4f8b32a54aed811b692a665ed296b4c1fc2f37a8be4006379e95063a76693745',
		],
		[
			1,
			'3a6423fe56abd5e74ec9d22a91ee110cd2ce45a7039901439d62e5534d3438c1',
			'c4b8412ee644067007423480c9e556385b71ffdff0f340bc16a95c0534fe0e01',
		],
		[
			2,
			'843484a75b78850096fac5b513e62854f11d57491cf775a6fd2edf4e583ae8c0',
			'ceff40983441c40acaf77d2a8ddffd5c1c84391fb9fd0dc4607c186daab1c829',
		],
	])(
		'deterministic OutputData -- New Derivation: counter %i -> secret: %s, r: %s',
		async (counter, secret, r) => {
			const hexSeed =
				'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8';

			const numberR = Bytes.toBigInt(hexToBytes(r));
			const decoder = new TextDecoder();

			const data = OutputData.createSingleDeterministicData(
				0,
				hexToBytes(hexSeed),
				counter,
				'012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30',
			);
			expect(decoder.decode(data.secret)).toBe(secret);
			expect(data.blindingFactor).toBe(numberR);
		},
	);
});
