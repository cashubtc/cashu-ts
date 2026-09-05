import { randomBytes } from '@noble/hashes/utils.js';
import { HttpResponse, http } from 'msw';
import { test, describe, expect, vi } from 'vitest';

import { Wallet, Amount, type Proof } from '../../src';
import { PUBKEYS } from '../consts';

import {
  useTestServer,
  mint,
  unit,
  dummyKeysResp,
  dummyKeysetResp,
  mintUrl,
  logger,
} from './_setup';

const server = useTestServer();

describe('Restoring deterministic proofs', () => {
  test('Batch restore treats a batch of zero-value signatures as occupied', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const mockRestore = vi
      .spyOn(wallet, 'restore')
      .mockImplementation(
        async (start): Promise<{ proofs: Proof[]; lastCounterWithSignature?: number }> => {
          // first batch: signed, but every signature is zero-value
          if (start === 0) return { proofs: [], lastCounterWithSignature: 5 };
          if (start === 50)
            return { proofs: Array(3).fill(1) as Proof[], lastCounterWithSignature: 52 };
          return { proofs: [] };
        },
      );
    const res = await wallet.batchRestore(100, 50);
    expect(res.proofs).toHaveLength(3);
    expect(res.lastCounterWithSignature).toBe(52);
    mockRestore.mockClear();
  });

  test('Batch restore keeps scanning the keyset it started on', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const bound = wallet.keysetId;
    const mockRestore = vi.spyOn(wallet, 'restore').mockImplementation(async () => {
      // a keychain repair inside restore() can rebind an auto-bound wallet mid-scan
      (wallet as unknown as { _boundKeysetId: string })._boundKeysetId = '009a1f293253e41e';
      return { proofs: [] };
    });
    await wallet.batchRestore(100, 50);
    expect(mockRestore.mock.calls.length).toBeGreaterThan(1);
    expect(mockRestore.mock.calls.every((c) => c[2]?.keysetId === bound)).toBe(true);
    mockRestore.mockClear();
  });

  test('Batch restore', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    let rounds = 0;
    const mockRestore = vi
      .spyOn(wallet, 'restore')
      .mockImplementation(async (): Promise<{ proofs: Proof[] }> => {
        if (rounds === 0) {
          rounds++;
          return { proofs: Array(21).fill(1) as Proof[] };
        }
        rounds++;
        return { proofs: [] };
      });
    const { proofs: restoredProofs } = await wallet.batchRestore();
    expect(restoredProofs.length).toBe(21);
    expect(mockRestore).toHaveBeenCalledTimes(2);
    mockRestore.mockClear();
  });
  test('Batch restore with custom values', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    let rounds = 0;
    const mockRestore = vi
      .spyOn(wallet, 'restore')
      .mockImplementation(
        async (): Promise<{ proofs: Proof[]; lastCounterWithSignature?: number }> => {
          if (rounds === 0) {
            rounds++;
            return { proofs: Array(42).fill(1) as Proof[], lastCounterWithSignature: 41 };
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

  test('unblinds restore signatures with the keyset they name and skips zero-value ones', async () => {
    const VALID_POINT = '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422';
    const keysetB = { id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 0 };
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({ keysets: [...dummyKeysetResp.keysets, keysetB] }),
      ),
      http.get(mintUrl + '/v1/keys/009a1f293253e41e', () =>
        HttpResponse.json({ keysets: [{ ...keysetB, keys: PUBKEYS }] }),
      ),
      http.post(mintUrl + '/v1/restore', async ({ request }) => {
        const body = (await request.json()) as { outputs: unknown[] };
        // counter 0 on the scanned keyset, counter 1 signed at zero under a keyset the wallet
        // has never heard of (no keys are needed for it), counter 2 on keyset B
        return HttpResponse.json({
          outputs: body.outputs,
          signatures: body.outputs.map((_, i) => ({
            id: i === 2 ? keysetB.id : i === 1 ? 'aaaaaaaaaaaaaaaa' : dummyKeysResp.keysets[0].id,
            amount: i === 1 ? 0 : 1,
            C_: VALID_POINT,
          })),
        });
      }),
    );
    const wallet = new Wallet(mint, { unit, bip39seed: randomBytes(32), logger });
    await wallet.loadMint();

    const res = await wallet.restore(0, 3);

    expect(res.proofs.map((p) => p.id)).toEqual([dummyKeysResp.keysets[0].id, keysetB.id]);
    expect(res.lastCounterWithSignature).toBe(2);
  });
});
