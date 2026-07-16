import { randomBytes } from '@noble/hashes/utils.js';
import { HttpResponse, http } from 'msw';
import { test, describe, expect, vi } from 'vitest';

import { Wallet, Amount, CheckStateEnum, type Proof, type ProofState } from '../../src';

import { useTestServer, mint, unit, dummyKeysResp, mintUrl, logger } from './_setup';

const server = useTestServer();

const allUnspent = (n: number): ProofState[] =>
  Array(n).fill({ state: CheckStateEnum.UNSPENT }) as ProofState[];

describe('Restoring deterministic proofs', () => {
  test('Batch restore', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const mockRestore = vi
      .spyOn(wallet, 'restore')
      .mockImplementation(async (start): Promise<{ proofs: Proof[] }> => {
        if (start === 0) {
          return { proofs: Array(21).fill(1) as Proof[] };
        }
        return { proofs: [] };
      });
    const mockStates = vi.spyOn(wallet, 'checkProofsStates').mockResolvedValue(allUnspent(21));
    const { proofs: restoredProofs } = await wallet.batchRestore();
    expect(restoredProofs.length).toBe(21);
    // one pooled wave of 4 batches covers the gap limit
    expect(mockRestore).toHaveBeenCalledTimes(4);
    // spent filtering is on by default
    expect(mockStates).toHaveBeenCalledTimes(1);
    mockRestore.mockClear();
    mockStates.mockClear();
  });
  test('Batch restore with custom values', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const mockRestore = vi
      .spyOn(wallet, 'restore')
      .mockImplementation(
        async (start): Promise<{ proofs: Proof[]; lastCounterWithSignature?: number }> => {
          if (start === 0) {
            return { proofs: Array(42).fill(1) as Proof[], lastCounterWithSignature: 41 };
          }
          return { proofs: [] };
        },
      );
    const { proofs: restoredProofs, lastCounterWithSignature } = await wallet.batchRestore({
      gapLimit: 100,
      batchSize: 50,
      filterSpent: false,
    });
    expect(restoredProofs.length).toBe(42);
    expect(mockRestore).toHaveBeenCalledTimes(4);
    expect(lastCounterWithSignature).toBe(41);
    mockRestore.mockClear();
  });
  test('Batch restore recovers proofs found past the gap limit in the same wave', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    // the gap limit is reached at start 300, but the batch at 600 is already in flight in
    // the same wave; its proofs reset the gap count and are kept, not dropped.
    const mockRestore = vi
      .spyOn(wallet, 'restore')
      .mockImplementation(
        async (start): Promise<{ proofs: Proof[]; lastCounterWithSignature?: number }> => {
          if (start === 0) {
            return { proofs: Array(5).fill(1) as Proof[], lastCounterWithSignature: 4 };
          }
          if (start === 600) {
            return { proofs: Array(3).fill(1) as Proof[], lastCounterWithSignature: 602 };
          }
          return { proofs: [] };
        },
      );
    const { proofs: restoredProofs, lastCounterWithSignature } = await wallet.batchRestore({
      batchSize: 300,
      filterSpent: false,
    });
    expect(restoredProofs.length).toBe(8);
    expect(lastCounterWithSignature).toBe(602);
    // the empty batch at 900 closes the gap again, so one wave suffices
    expect(mockRestore).toHaveBeenCalledTimes(4);
    mockRestore.mockClear();
  });
  test('Batch restore drops spent proofs but keeps pending, counter unfiltered', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const found = [{ secret: 'a' }, { secret: 'b' }, { secret: 'c' }, { secret: 'd' }] as Proof[];
    const mockRestore = vi
      .spyOn(wallet, 'restore')
      .mockImplementation(
        async (start): Promise<{ proofs: Proof[]; lastCounterWithSignature?: number }> => {
          if (start === 0) {
            return { proofs: found, lastCounterWithSignature: 3 };
          }
          return { proofs: [] };
        },
      );
    const mockStates = vi
      .spyOn(wallet, 'checkProofsStates')
      .mockResolvedValue([
        { state: CheckStateEnum.UNSPENT },
        { state: CheckStateEnum.SPENT },
        { state: CheckStateEnum.PENDING },
        { state: CheckStateEnum.UNSPENT },
      ] as ProofState[]);
    const { proofs: restoredProofs, lastCounterWithSignature } = await wallet.batchRestore();
    expect(restoredProofs.map((p) => p.secret)).toEqual(['a', 'c', 'd']);
    expect(lastCounterWithSignature).toBe(3);
    expect(mockStates).toHaveBeenCalledWith(found);
    mockRestore.mockClear();
    mockStates.mockClear();
  });
  test('Batch restore treats maxCounter as an inclusive ceiling and ends there', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const calls: Array<[number, number]> = [];
    const mockRestore = vi
      .spyOn(wallet, 'restore')
      .mockImplementation(async (start, count): Promise<{ proofs: Proof[] }> => {
        calls.push([start, count]);
        return { proofs: [1] as unknown as Proof[] };
      });
    // gapLimit Infinity: the gap rule never fires, so only the bound can end the scan
    const { proofs } = await wallet.batchRestore({
      gapLimit: Infinity,
      batchSize: 100,
      maxCounter: 349,
      filterSpent: false,
    });
    // 350 counters in 100-batches; the last is clamped, nothing probes past the bound
    expect(calls).toEqual([
      [0, 100],
      [100, 100],
      [200, 100],
      [300, 50],
    ]);
    expect(proofs.length).toBe(4);
    mockRestore.mockClear();
  });
});

describe('restore', () => {
  test('sends zero-amount blanks and maps signatures to proofs', async () => {
    const wallet = new Wallet(mint, { unit, bip39seed: randomBytes(32), logger });
    await wallet.loadMint();
    interface RestoreBody {
      outputs: unknown[];
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
    expect(res.proofs.every((p) => p.amount.equals(Amount.from(1)))).toBe(true);
  });
});
