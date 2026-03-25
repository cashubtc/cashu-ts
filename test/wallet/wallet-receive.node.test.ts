import { HttpResponse, http } from 'msw';
import { test, describe, expect } from 'vitest';

import {
	Wallet,
	getDecodedToken,
	OutputData,
	type AmountLike,
	type HasKeysetKeys,
} from '../../src';

import { hexToBytes } from '@noble/curves/utils.js';
import { mint, unit, token3sat, mintUrl, logger, useTestServer } from './_setup';

const server = useTestServer();

describe('receive', () => {
	const tokenInput =
		'cashuBo2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdGF0gaJhaUgAvQM1Wd4n0GFwgaNhYQFhc3hAMDFmOTEwNmQxNWMwMWI5NDBjOThlYTdlOTY4YTA2ZTNhZjY5NjE4ZWRiOGJlOGU1MWI1MTJkMDhlOTA3OTIxNmFjWCEC-F3YSw-EGENmy2kUYQavfA8m8u4K0oej5fqFJSi7Kd8';

	test('test receive token from wrong mint', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		// Token from http://localhost/Bitcoin:3338
		const foreignToken =
			'cashuBo2FteB1odHRwOi8vbG9jYWxob3N0L0JpdGNvaW46MzMzOGF1Y3NhdGF0gaJhaUgAvQM1Wd4n0GFwgaNhYQFhc3hAMDFmOTEwNmQxNWMwMWI5NDBjOThlYTdlOTY4YTA2ZTNhZjY5NjE4ZWRiOGJlOGU1MWI1MTJkMDhlOTA3OTIxNmFjWCEC-F3YSw-EGENmy2kUYQavfA8m8u4K0oej5fqFJSi7Kd8';
		await expect(wallet.receive(foreignToken)).rejects.toThrow('Token belongs to a different mint');
	});

	test('test receive token with wrong unit', async () => {
		const wallet = new Wallet(mint, { unit, logger });
		await wallet.loadMint();

		// Token in usd
		const foreignToken =
			'cashuBo2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3VzZGF0gaJhaUgAvQM1Wd4n0GFwgaNhYQFhc3hAMDFmOTEwNmQxNWMwMWI5NDBjOThlYTdlOTY4YTA2ZTNhZjY5NjE4ZWRiOGJlOGU1MWI1MTJkMDhlOTA3OTIxNmFjWCEC-F3YSw-EGENmy2kUYQavfA8m8u4K0oej5fqFJSi7Kd8';
		await expect(wallet.receive(foreignToken)).rejects.toThrow('Token is not in wallet unit');
	});

	test('test receive token with unsanitized mint url', async () => {
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

		// Token from http://localhost:3338/ (<-- has trailing slash)
		const unsanitizedToken =
			'cashuBo2Ftdmh0dHA6Ly9sb2NhbGhvc3Q6MzMzOC9hdWNzYXRhdIGiYWlIAL0DNVneJ9BhcIGjYWEBYXN4QDAxZjkxMDZkMTVjMDFiOTQwYzk4ZWE3ZTk2OGEwNmUzYWY2OTYxOGVkYjhiZThlNTFiNTEyZDA4ZTkwNzkyMTZhY1ghAvhd2EsPhBhDZstpFGEGr3wPJvLuCtKHo-X6hSUouynf';
		const proofs = await wallet.receive(unsanitizedToken);

		expect(proofs).toHaveLength(1);
		expect(proofs).toMatchObject([{ amount: 1n, id: '00bd033559de27d0' }]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('test receive encoded token', async () => {
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

		const proofs = await wallet.receive(tokenInput);

		expect(proofs).toHaveLength(1);
		expect(proofs).toMatchObject([{ amount: 1n, id: '00bd033559de27d0' }]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('test receive raw token', async () => {
		const decodedInput = getDecodedToken(tokenInput, ['z32vUtKgNCm1']);
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return HttpResponse.json({
					signatures: [
						{
							id: 'z32vUtKgNCm1',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
						},
					],
				});
			}),
		);

		const wallet = new Wallet(mint);
		await wallet.loadMint();

		const proofs = await wallet.receive(decodedInput);

		expect(proofs).toHaveLength(1);
		expect(proofs).toMatchObject([{ amount: 1n, id: 'z32vUtKgNCm1' }]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});
	test('test receive custom split', async () => {
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
					],
				});
			}),
		);

		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const proofs = await wallet.receive(
			token3sat,
			{},
			{ type: 'random', denominations: [1, 1, 1] },
		);

		expect(proofs).toHaveLength(3);
		expect(proofs).toMatchObject([
			{ amount: 1n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
		]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});
	test('test receive tokens already spent', async () => {
		const msg = 'tokens already spent. Secret: asdasdasd';
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return new HttpResponse(JSON.stringify({ detail: msg }), { status: 400 });
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.receive(tokenInput).catch((e) => e);
		expect(result).toMatchObject({
			name: 'HttpResponseError',
			message: 'tokens already spent. Secret: asdasdasd',
			status: 400,
		});
	});

	test('test receive could not verify proofs', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', () => {
				return new HttpResponse(JSON.stringify({ code: 0, error: 'could not verify proofs.' }), {
					status: 400,
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const result = await wallet.receive(tokenInput).catch((e) => e);
		expect(result).toMatchObject({
			name: 'HttpResponseError',
			message: 'could not verify proofs.',
			status: 400,
		});
	});
	test('test receive deterministic - autocounter', async () => {
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
							amount: 2,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const seed = hexToBytes(
			'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
		);
		const wallet = new Wallet(mint, { unit, bip39seed: seed });
		await wallet.loadMint();

		const proofs = await wallet.receive(token3sat, {}, { type: 'deterministic', counter: 0 });
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 2n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
		]);
		expect(proofs[0].secret).toBe(
			'8e0ad268631046765b570f85fe0951710c6e0e13c81b3df50ddfee21d235d132', // counter:0
		);
		expect(proofs[1].secret).toBe(
			'0b59dbc968effd7f5ab4649c0d91ab160cbd58e3aa3490d060701f44dd62e52c', // counter:1
		);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);

		// get next secrets too
		const proofs2 = await wallet.receive(token3sat, {}, { type: 'deterministic', counter: 0 });
		expect(proofs2).toHaveLength(2);
		expect(proofs2).toMatchObject([
			{ amount: 2n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
		]);
		expect(proofs2[0].secret).toBe(
			'c756ae91cf316eaa4b845edcca35f04ee9d1732c10e7205b0ef30123bcbbc1b8', // counter:2
		);
		expect(proofs2[1].secret).toBe(
			'7ceefb4d471163bd155649285c140e7647be996d1d38d4b02a9ff92bfb424cbf', // counter:3
		);
		expect(/[0-9a-f]{64}/.test(proofs2[0].C)).toBe(true);

		// get next secrets too
		const proofs3 = await wallet.receive(token3sat, {}, { type: 'deterministic', counter: 0 });
		expect(proofs3).toHaveLength(2);
		expect(proofs3).toMatchObject([
			{ amount: 2n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
		]);
		expect(proofs3[0].secret).toBe(
			'f6305874d89704b77de6fcf94c796cd274154cdbf824d35cbc72bfdc6ed60414', // counter:4
		);
		expect(proofs3[1].secret).toBe(
			'c3cad2ac3da43f84995a7ea362bd5509a992ef3684c151f5f3945b1a1f026efd', // counter:5
		);
		expect(/[0-9a-f]{64}/.test(proofs3[0].C)).toBe(true);
	});
	test('test receive deterministic - defined counter', async () => {
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
							amount: 2,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const seed = hexToBytes(
			'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
		);
		const wallet = new Wallet(mint, { unit, bip39seed: seed });
		await wallet.loadMint();

		const proofs = await wallet.receive(token3sat, {}, { type: 'deterministic', counter: 5 });
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 2n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
		]);
		expect(proofs[0].secret).toBe(
			'c3cad2ac3da43f84995a7ea362bd5509a992ef3684c151f5f3945b1a1f026efd', // counter:5
		);
		expect(proofs[1].secret).toBe(
			'bd31ac247f79cc72c0c6ba2793a44d006c57fd98ff4a982e357e48c12cf47f02', // counter:6
		);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
	});

	test('test receive p2pk', async () => {
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
							amount: 2,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const proofs = await wallet.receive(
			token3sat,
			{},
			{
				type: 'p2pk',
				options: { pubkey: '02a9acc1e594c8d2f91fbd5664973aaef2ff2b8c2f6cf5f419c17a35755a6ab5c4' },
			},
		);
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 2n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
		]);
		const allSecrets = proofs.map((d) => JSON.parse(d.secret));
		allSecrets.forEach((s) => {
			expect(s[0] === 'P2PK');
			expect(s[1].data).toBe('02a9acc1e594c8d2f91fbd5664973aaef2ff2b8c2f6cf5f419c17a35755a6ab5c4');
		});
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('test receive factory', async () => {
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
							amount: 2,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const customFactory = (amount: AmountLike, keyset: HasKeysetKeys): OutputData => {
			return OutputData.createRandomData(amount, keyset)[0];
		};
		const proofs = await wallet.receive(token3sat, {}, { type: 'factory', factory: customFactory });
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 2n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
		]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('test receive custom', async () => {
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
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const customData = OutputData.createRandomData(
			3,
			wallet.keyChain.getKeyset('00bd033559de27d0')!,
			[1, 1, 1],
		);
		const proofs = await wallet.receive(token3sat, {}, { type: 'custom', data: customData });
		expect(proofs).toHaveLength(3);
		expect(proofs).toMatchObject([
			{ amount: 1n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
		]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('test receive requireDleq true throws', async () => {
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		await expect(wallet.receive(token3sat, { requireDleq: true })).rejects.toThrow(
			'Token contains proofs with invalid or missing DLEQ',
		);
		// Try using a receive helper too
		await expect(wallet.receive(token3sat, { requireDleq: true })).rejects.toThrow(
			'Token contains proofs with invalid or missing DLEQ',
		);
	});

	test('test receive proofsWeHave optimization', async () => {
		server.use(
			http.post(mintUrl + '/v1/swap', async () => {
				return HttpResponse.json({
					signatures: [
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
						{
							id: '00bd033559de27d0',
							amount: 1,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
						{
							id: '00bd033559de27d0',
							amount: 2,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const existingProofs = [
			{ amount: 2n, id: '00bd033559de27d0', secret: 'test', C: 'test' },
			{ amount: 2n, id: '00bd033559de27d0', secret: 'test', C: 'test' },
			{ amount: 2n, id: '00bd033559de27d0', secret: 'test', C: 'test' },
		];
		const tok = {
			mint: 'http://localhost:3338',
			proofs: [
				{
					id: '00bd033559de27d0',
					amount: 1n,
					secret: 'e7c1b76d1b31e2bca2b229d160bdf6046f33bc4570222304b65110d926f7af89',
					C: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
				},
				{
					id: '00bd033559de27d0',
					amount: 2n,
					secret: 'e7c1b76d1b31e2bca2b229d160bdf6046f33bc4570222304b65110d926f7af89',
					C: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
				},
				{
					id: '00bd033559de27d0',
					amount: 2n,
					secret: 'de55c15faefded7f9c999c3d4c62f81b0c6fe21a752fdeff6b084cf2df2f5cf3',
					C: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
				},
			],
			unit: 'sat',
		};
		const proofs = await wallet.receive(tok, { proofsWeHave: existingProofs });
		// receiving 5 with a target count of 3, we expect three 1s, and one 2
		// as we already have the target amount of 2s
		expect(proofs).toHaveLength(4);
		expect(proofs).toMatchObject([
			{ amount: 1n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
			{ amount: 2n, id: '00bd033559de27d0' },
		]);
	});

	test('test receive privkey signing', async () => {
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
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const proofs = await wallet.receive(token3sat, {
			privkey: '5d41402abc4b2a76b9719d911017c592',
		});
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 2n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
		]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});

	test('test receive keysetId', async () => {
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
							amount: 2,
							C_: '02de40c59d90383b8853ccf3a4b20864ac83ba758fce3d959dbb89361002e8ce47',
						},
					],
				});
			}),
		);
		const wallet = new Wallet(mint, { unit });
		await wallet.loadMint();

		const proofs = await wallet.receive(token3sat, {
			keysetId: '00bd033559de27d0',
		});
		expect(proofs).toHaveLength(2);
		expect(proofs).toMatchObject([
			{ amount: 2n, id: '00bd033559de27d0' },
			{ amount: 1n, id: '00bd033559de27d0' },
		]);
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[0-9a-f]{64}/.test(proofs[0].secret)).toBe(true);
	});
});
