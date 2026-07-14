import { randomBytes } from '@noble/hashes/utils.js';
import { HttpResponse, http } from 'msw';
import { test, describe, expect, vi } from 'vitest';

import {
  Wallet,
  Amount,
  CheckStateEnum,
  OutputData,
  decryptDGap,
  encryptDGap,
  type Proof,
  type ProofState,
} from '../../src';
import { DUMMY_TEST_KEYS } from '../consts';

import { useTestServer, mint, unit, dummyKeysResp, mintUrl, mintInfoResp, logger } from './_setup';

const server = useTestServer();

const allUnspent = (n: number): ProofState[] =>
  Array(n).fill({ state: CheckStateEnum.UNSPENT }) as ProofState[];

const VALID_POINT = '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422';
const KEYSET_ID = DUMMY_TEST_KEYS.id;

// NUT-342 (draft) test helpers
const mintInfo342 = {
  ...mintInfoResp,
  nuts: { ...mintInfoResp.nuts, '342': { supported: true } },
};
const use342Info = () =>
  server.use(http.get(mintUrl + '/v1/info', () => HttpResponse.json(mintInfo342)));

// Deterministic blank for a counter; blinding factor depends only on (seed, keyset, counter)
const blank = (seed: Uint8Array, counter: number) =>
  OutputData.createDeterministicData(0, seed, counter, DUMMY_TEST_KEYS, [0])[0];

// Fake NUT-09 endpoint: answers per-B_ from the issued map, echoing stored d_gap values
function useFakeRestoreMint(issued: Map<string, { counter: number; d_gap?: number | string }>) {
  let calls = 0;
  server.use(
    http.post(mintUrl + '/v1/restore', async ({ request }) => {
      calls++;
      const body = (await request.json()) as { outputs: Array<{ id: string; B_: string }> };
      const outputs: unknown[] = [];
      const signatures: unknown[] = [];
      for (const output of body.outputs) {
        const hit = issued.get(output.B_);
        if (!hit) continue;
        outputs.push(output);
        signatures.push({
          id: output.id,
          amount: 1,
          C_: VALID_POINT,
          ...(hit.d_gap !== undefined && { d_gap: hit.d_gap }),
        });
      }
      return HttpResponse.json({ outputs, signatures });
    }),
  );
  return () => calls;
}

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

describe('restoreEfficient (draft NUT-342)', () => {
  test('recovers the gap window via binary search and encrypted d_gap', async () => {
    use342Info();
    const seed = randomBytes(64);
    // issued counters 0, 1, 3 — counter 2 is a derivation gap inside the window
    const issued = new Map(
      [0, 1, 3].map((c) => {
        const output = blank(seed, c);
        return [
          output.blindedMessage.B_,
          { counter: c, d_gap: encryptDGap(c, output.blindingFactor) },
        ];
      }),
    );
    const restoreCalls = useFakeRestoreMint(issued);

    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();
    const res = await wallet.restoreEfficient({ probeWindow: 5 });

    expect(res.proofs).toHaveLength(3);
    expect(res.lastCounterWithSignature).toBe(3);
    // first window + ~29 binary-search probes + final window restore, far below a linear scan
    expect(restoreCalls()).toBeLessThan(40);
  });

  test('re-probes the terminal window when T lies beyond window 0', async () => {
    use342Info();
    const seed = randomBytes(64);
    // counters span two probe windows (0..4 and 5..9), so the search converges
    // on window 1 and must fetch the terminal window again for its d_gap
    const issued = new Map(
      [0, 1, 2, 6, 7].map((c) => {
        const output = blank(seed, c);
        return [
          output.blindedMessage.B_,
          { counter: c, d_gap: encryptDGap(c, output.blindingFactor) },
        ];
      }),
    );
    useFakeRestoreMint(issued);

    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();
    const res = await wallet.restoreEfficient({ probeWindow: 5 });

    expect(res.proofs).toHaveLength(5);
    expect(res.lastCounterWithSignature).toBe(7);
  });

  test('falls back when the terminal window vanishes mid-search', async () => {
    use342Info();
    const seed = randomBytes(64);
    // counters 5..6 sit in window 1; the mint answers for them exactly once,
    // so the terminal re-probe comes back empty (inconsistent mint)
    const window1 = new Map([5, 6].map((c) => [blank(seed, c).blindedMessage.B_, c] as const));
    const anchor = blank(seed, 0).blindedMessage.B_;
    let window1Answers = 1;
    server.use(
      http.post(mintUrl + '/v1/restore', async ({ request }) => {
        const body = (await request.json()) as { outputs: Array<{ id: string; B_: string }> };
        const hits = body.outputs.filter((o) => o.B_ === anchor || window1.has(o.B_));
        const isWindow1 = hits.some((o) => window1.has(o.B_));
        if (isWindow1 && window1Answers-- <= 0) {
          return HttpResponse.json({ outputs: [], signatures: [] });
        }
        return HttpResponse.json({
          outputs: hits,
          signatures: hits.map((o) => ({ id: o.id, amount: 1, C_: VALID_POINT })),
        });
      }),
    );
    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();
    const mockBatch = vi
      .spyOn(wallet, 'batchRestore')
      .mockResolvedValue({ proofs: [], lastCounterWithSignature: undefined });

    await wallet.restoreEfficient({ probeWindow: 5 });

    expect(mockBatch).toHaveBeenCalledTimes(1);
  });

  test('accepts a plaintext integer d_gap', async () => {
    use342Info();
    const seed = randomBytes(64);
    const issued = new Map(
      [0, 1, 2].map((c) => [blank(seed, c).blindedMessage.B_, { counter: c, d_gap: c }] as const),
    );
    useFakeRestoreMint(issued);

    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();
    const res = await wallet.restoreEfficient({ probeWindow: 5 });

    expect(res.proofs).toHaveLength(3);
    expect(res.lastCounterWithSignature).toBe(2);
  });

  test('falls back to batchRestore when the mint lacks support', async () => {
    const wallet = new Wallet(mint, { unit, bip39seed: randomBytes(64) });
    await wallet.loadMint();
    const mockBatch = vi
      .spyOn(wallet, 'batchRestore')
      .mockResolvedValue({ proofs: [], lastCounterWithSignature: undefined });

    const res = await wallet.restoreEfficient();

    expect(res.proofs).toHaveLength(0);
    expect(mockBatch).toHaveBeenCalledWith({ keysetId: undefined, filterSpent: false });
  });

  test('falls back when the mint has no signatures at all', async () => {
    use342Info();
    const restoreCalls = useFakeRestoreMint(new Map());
    const wallet = new Wallet(mint, { unit, bip39seed: randomBytes(64) });
    await wallet.loadMint();
    const mockBatch = vi
      .spyOn(wallet, 'batchRestore')
      .mockResolvedValue({ proofs: [], lastCounterWithSignature: undefined });

    await wallet.restoreEfficient({ probeWindow: 5 });

    expect(restoreCalls()).toBe(1); // empty first window short-circuits the search
    expect(mockBatch).toHaveBeenCalledTimes(1);
  });

  test('falls back when the terminal signature carries no d_gap', async () => {
    use342Info();
    const seed = randomBytes(64);
    const issued = new Map(
      [0, 1].map((c) => [blank(seed, c).blindedMessage.B_, { counter: c }] as const),
    );
    useFakeRestoreMint(issued);
    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();
    const mockBatch = vi
      .spyOn(wallet, 'batchRestore')
      .mockResolvedValue({ proofs: [], lastCounterWithSignature: undefined });

    await wallet.restoreEfficient({ probeWindow: 5 });

    expect(mockBatch).toHaveBeenCalledTimes(1);
  });

  test('falls back when the mint returns an invalid d_gap', async () => {
    use342Info();
    const seed = randomBytes(64);
    const output = blank(seed, 0);
    // gap of 5 for t=0 would rewind past counter 0
    const issued = new Map([
      [output.blindedMessage.B_, { counter: 0, d_gap: encryptDGap(5, output.blindingFactor) }],
    ]);
    useFakeRestoreMint(issued);
    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();
    const mockBatch = vi
      .spyOn(wallet, 'batchRestore')
      .mockResolvedValue({ proofs: [], lastCounterWithSignature: undefined });

    await wallet.restoreEfficient({ probeWindow: 5 });

    expect(mockBatch).toHaveBeenCalledTimes(1);
  });
});

describe('recovery gap attachment (draft NUT-342)', () => {
  const oneSatProof = {
    id: '00bd033559de27d0',
    amount: Amount.from(1),
    secret: '407915bc212be61a77e3e6d2aeb4c727980bda51cd06a6afc29e2861768a7837',
    C: '02bc9097997d81afb2cc7346b5e4345a9346bd2a506eb7958598a72f0cf85163ea',
  };

  function useSwapCapture() {
    const captured: { outputs: Array<{ id: string; amount: number; d_gap?: string }> } = {
      outputs: [],
    };
    server.use(
      http.post(mintUrl + '/v1/swap', async ({ request }) => {
        const body = (await request.json()) as typeof captured;
        captured.outputs = body.outputs;
        return HttpResponse.json({
          signatures: body.outputs.map((o) => ({ id: o.id, amount: o.amount, C_: VALID_POINT })),
        });
      }),
    );
    return captured;
  }

  test('attaches encrypted d_gap to deterministic outputs when the mint advertises support', async () => {
    use342Info();
    const captured = useSwapCapture();
    const seed = randomBytes(64);
    const provider = vi.fn(async () => undefined);

    const wallet = new Wallet(mint, { unit, bip39seed: seed, recoveryGapProvider: provider });
    await wallet.loadMint();
    await wallet.receive([oneSatProof]);

    expect(provider).toHaveBeenCalledWith(KEYSET_ID);
    expect(captured.outputs).toHaveLength(1);
    const dGap = captured.outputs[0].d_gap;
    expect(typeof dGap).toBe('string');
    // fresh wallet: counter 0 is the first unspent, so the gap is 0
    expect(decryptDGap(dGap as string, blank(seed, 0).blindingFactor)).toBe(0);
  });

  test('computes the gap from the provider counter', async () => {
    use342Info();
    const captured = useSwapCapture();
    const seed = randomBytes(64);

    const wallet = new Wallet(mint, {
      unit,
      bip39seed: seed,
      counterInit: { [KEYSET_ID]: 10 },
      recoveryGapProvider: async () => 4,
    });
    await wallet.loadMint();
    await wallet.receive([oneSatProof]);

    // output counter 10, first unspent 4 -> gap 6
    expect(decryptDGap(captured.outputs[0].d_gap as string, blank(seed, 10).blindingFactor)).toBe(
      6,
    );
  });

  test('attaches nothing when the mint lacks support', async () => {
    const captured = useSwapCapture();
    const provider = vi.fn(async () => undefined);

    const wallet = new Wallet(mint, {
      unit,
      bip39seed: randomBytes(64),
      recoveryGapProvider: provider,
    });
    await wallet.loadMint();
    await wallet.receive([oneSatProof]);

    expect(provider).not.toHaveBeenCalled();
    expect(captured.outputs[0].d_gap).toBeUndefined();
  });
});
