import { bytesToHex } from '@noble/curves/utils.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { HttpResponse, http } from 'msw';
import { test, describe, expect, vi } from 'vitest';

import {
  Wallet,
  Amount,
  CheckStateEnum,
  OutputData,
  createSecretAndBlindingFactorDeriver,
  hashToCurve,
  type Proof,
} from '../../src';

import { useTestServer, mint, unit, dummyKeysResp, mintUrl, mintInfoResp, logger } from './_setup';

const server = useTestServer();

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
    // filterSpent: false is the plain restore path, which is what is mocked here; the default
    // path state checks first and is covered end to end further down
    const { proofs: restoredProofs } = await wallet.batchRestore({ filterSpent: false });
    expect(restoredProofs.length).toBe(21);
    // the opening batch finds usage, then one full pooled wave covers the gap limit
    expect(mockRestore).toHaveBeenCalledTimes(5);
    mockRestore.mockClear();
  });
  test('Batch restore settles an unused keyset with a single gap-width wave', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const mockRestore = vi.spyOn(wallet, 'restore').mockResolvedValue({ proofs: [] as Proof[] });
    const { proofs } = await wallet.batchRestore({ filterSpent: false });
    expect(proofs).toEqual([]);
    // one empty 500-batch already satisfies the 300 gap limit, so the scan never
    // widens to the full pool and the keyset costs a single request
    expect(mockRestore).toHaveBeenCalledTimes(1);
    mockRestore.mockClear();
  });
  test('Batch restore caps its default batch at 500 despite a larger advertised cap', async () => {
    server.use(
      http.get(mintUrl + '/v1/info', () => {
        return HttpResponse.json({ ...mintInfoResp, max_array_length: 4000 });
      }),
    );
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const counts: number[] = [];
    const mockRestore = vi
      .spyOn(wallet, 'restore')
      .mockImplementation(async (_start, count): Promise<{ proofs: Proof[] }> => {
        counts.push(count);
        return { proofs: [] };
      });
    await wallet.batchRestore({ filterSpent: false });
    // the scan pays client crypto per counter, so it does not follow the advertised 4000
    expect(counts).toEqual([500]);
    mockRestore.mockClear();
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
    // gapLimit 100 at batchSize 50 opens two wide, then one full wave after the find
    expect(mockRestore).toHaveBeenCalledTimes(6);
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
    // the empty batch at 900 closes the gap again, so the probe and one wave suffice
    expect(mockRestore).toHaveBeenCalledTimes(5);
    mockRestore.mockClear();
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

describe('restoreAll', () => {
  // Minimal Keyset-shaped stub; only `unit` is read by restoreAll's filter.
  const ks = (unitStr: string) => ({ unit: unitStr }) as never;

  test('restores every keyset in the wallet unit and merges results', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    vi.spyOn(wallet.keyChain, 'getAllKeysetIds').mockReturnValue(['A', 'B', 'C']);
    vi.spyOn(wallet.keyChain, 'getKeyset').mockImplementation((id) =>
      id === 'C' ? ks('eur') : ks('sat'),
    );
    const batchSpy = vi.spyOn(wallet, 'batchRestore').mockImplementation(async (config) => {
      if (config?.keysetId === 'A') {
        return {
          proofs: [{ secret: 'a1' }, { secret: 'a2' }] as Proof[],
          lastCounterWithSignature: 12,
        };
      }
      return { proofs: [] }; // keyset B: nothing found
    });

    const { proofs, lastCounters } = await wallet.restoreAll();

    expect(proofs.map((p) => p.secret)).toEqual(['a1', 'a2']);
    // per-keyset counters: B absent (no signatures), C never scanned (wrong unit)
    expect(lastCounters).toEqual({ A: 12 });
    expect(batchSpy).toHaveBeenCalledTimes(2);
    expect(batchSpy).toHaveBeenCalledWith({ keysetId: 'A' });
    expect(batchSpy).toHaveBeenCalledWith({ keysetId: 'B' });
  });

  test('forwards scan options to every keyset', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    vi.spyOn(wallet.keyChain, 'getAllKeysetIds').mockReturnValue(['A']);
    vi.spyOn(wallet.keyChain, 'getKeyset').mockReturnValue(ks('sat'));
    const batchSpy = vi.spyOn(wallet, 'batchRestore').mockResolvedValue({ proofs: [] });

    await wallet.restoreAll({ gapLimit: 100, batchSize: 50, filterSpent: false });

    expect(batchSpy).toHaveBeenCalledWith({
      gapLimit: 100,
      batchSize: 50,
      filterSpent: false,
      keysetId: 'A',
    });
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

  test('state checks before restoring: skips spent, keeps pending, scans past a spent wave', async () => {
    const seed = randomBytes(32);
    const keysetId = dummyKeysResp.keysets[0].id;
    const wallet = new Wallet(mint, { unit, bip39seed: seed, logger });
    await wallet.loadMint();

    // Counters 0-39 are issued and spent, 45 is issued and unspent, 46 is issued and pending,
    // the rest were never used. 0-39 is exactly the first pooled wave at batchSize 10, so under
    // a "no signatures means empty" rule the scan would stop there and never reach either.
    const SPENT_THROUGH = 39;
    const LIVE = 45;
    const PENDING = 46;
    const VALID_POINT = '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422';
    const derive = createSecretAndBlindingFactorDeriver(seed, keysetId);
    const enc = new TextEncoder();
    const counterByY = new Map<string, number>();
    const counterByB_ = new Map<string, number>();
    for (let c = 0; c <= 120; c++) {
      try {
        const derived = derive(c);
        counterByY.set(hashToCurve(enc.encode(bytesToHex(derived.secret))).toHex(true), c);
        counterByB_.set(OutputData.fromDerivedBytes(0, keysetId, derived).blindedMessage.B_, c);
      } catch {
        continue; // invalid blinding factor: skipped at issuance, so never used
      }
    }

    const restoredB_: string[] = [];
    server.use(
      http.post(mintUrl + '/v1/checkstate', async ({ request }) => {
        const { Ys } = (await request.json()) as { Ys: string[] };
        return HttpResponse.json({
          states: Ys.map((Y) => {
            const c = counterByY.get(Y) ?? Infinity;
            let state: CheckStateEnum = CheckStateEnum.UNSPENT;
            if (c <= SPENT_THROUGH) state = CheckStateEnum.SPENT;
            if (c === PENDING) state = CheckStateEnum.PENDING;
            return { Y, state, witness: null };
          }),
        });
      }),
      http.post(mintUrl + '/v1/restore', async ({ request }) => {
        const body = (await request.json()) as { outputs: Array<{ B_: string }> };
        body.outputs.forEach((o) => restoredB_.push(o.B_));
        const issued = body.outputs.filter((o) => {
          const c = counterByB_.get(o.B_);
          return c === LIVE || c === PENDING;
        });
        return HttpResponse.json({
          outputs: issued,
          signatures: issued.map(() => ({ id: keysetId, amount: 1, C_: VALID_POINT })),
        });
      }),
    );

    const { proofs, lastCounterWithSignature } = await wallet.batchRestore({
      batchSize: 10,
      gapLimit: 10,
    });

    // pending is issued and still live, so it is recovered and it sets the high-water mark
    expect(proofs).toHaveLength(2);
    expect(lastCounterWithSignature).toBe(PENDING);
    // the whole point: a spent proof's blinded message is never revealed to the mint
    const spentRevealed = restoredB_.filter(
      (b) => (counterByB_.get(b) ?? Infinity) <= SPENT_THROUGH,
    );
    expect(spentRevealed).toEqual([]);
  });
});
