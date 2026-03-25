import { HttpResponse, http } from 'msw';
import { test, describe, expect, vi } from 'vitest';

import { Wallet, type Proof } from '../../src';

import { randomBytes } from '@noble/hashes/utils.js';
import { useTestServer, mint, unit, dummyKeysResp, mintUrl, logger } from './_setup';

const server = useTestServer();

describe('Restoring deterministic proofs', () => {
	test('Batch restore', async () => {
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		let rounds = 0;
		const mockRestore = vi
			.spyOn(wallet, 'restore')
			.mockImplementation(async (): Promise<{ proofs: Array<Proof> }> => {
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
		const wallet = new Wallet(mint);
		await wallet.loadMint();
		let rounds = 0;
		const mockRestore = vi
			.spyOn(wallet, 'restore')
			.mockImplementation(
				async (): Promise<{ proofs: Array<Proof>; lastCounterWithSignature?: number }> => {
					if (rounds === 0) {
						rounds++;
						return { proofs: Array(42).fill(1) as Array<Proof>, lastCounterWithSignature: 41 };
					}
					rounds++;
					return { proofs: [] };
				},
			);
		const { proofs: restoredProofs, lastCounterWithSignature } = await wallet.batchRestore(
			100,
			50,
			0,
		);
		expect(restoredProofs.length).toBe(42);
		expect(mockRestore).toHaveBeenCalledTimes(3);
		expect(lastCounterWithSignature).toBe(41);
		mockRestore.mockClear();
	});
});

describe('restore', () => {
	test('sends zero-amount blanks and maps signatures to proofs', async () => {
		const wallet = new Wallet(mint, { unit, bip39seed: randomBytes(32), logger });
		await wallet.loadMint();
		interface RestoreBody {
			outputs: Array<unknown>;
		}
		let seenBody: RestoreBody = { outputs: [] };

		// valid compressed secp point (any well-formed 33-byte point will do)
		const VALID_POINT = '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422';

		server.use(
			http.post(mintUrl + '/v1/restore', async ({ request }) => {
				const body = (await request.json()) as RestoreBody;
				seenBody = body;

				// echo outputs, return one signature per output
				return HttpResponse.json({
					outputs: body.outputs,
					signatures: body.outputs.map(() => ({
						id: dummyKeysResp.keysets[0].id,
						amount: 1, // any existing key amount is fine (dummyKeysResp has 1 & 2)
						C_: VALID_POINT, // valid point so OutputData.toProof() doesn't choke
					})),
				});
			}),
		);

		const res = await wallet.restore(0, 3);

		// request assertions
		expect(Array.isArray(seenBody.outputs)).toBe(true);
		expect(seenBody.outputs).toHaveLength(3);
		expect(seenBody.outputs.every((o: any) => o.amount === 0)).toBe(true);

		// response shape is OK and produced proofs
		expect(Array.isArray(res.proofs)).toBe(true);
		expect(res.proofs.length).toBeGreaterThan(0);
		// proofs should be of amount 1 because we overprinted 1 in the signatures
		expect(res.proofs.every((p: any) => p.amount === 1n)).toBe(true);
	});
});
