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
  type ScanResult =
    | { proofs: Proof[]; used: false }
    | { proofs: Proof[]; lastCounterWithSignature: number; used: true };
  type Scan = (start: number, count: number, keysetId?: string) => Promise<ScanResult>;
  // The scan step is private, so stub it by name: these tests pin the geometry, which is what
  // batchRestore owns, and the step itself is covered end to end further down.
  const stubScan = (wallet: Wallet, impl: (start: number, count: number) => ScanResult) =>
    vi
      .spyOn(wallet as unknown as { restoreUnspent: Scan }, 'restoreUnspent')
      .mockImplementation(async (start, count) => impl(start, count));
  const found = (n: number, last: number): ScanResult => ({
    proofs: Array(n).fill(1) as Proof[],
    lastCounterWithSignature: last,
    used: true,
  });
  const empty: ScanResult = { proofs: [], used: false };

  test('Batch restore', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const scan = stubScan(wallet, (start) => (start === 0 ? found(21, 20) : empty));
    const { proofs } = await wallet.batchRestore();
    expect(proofs.length).toBe(21);
    // the gap-width probe finds usage, then one two-batch wave covers the gap limit
    expect(scan).toHaveBeenCalledTimes(3);
  });
  test('Batch restore settles an unused keyset with a single gap-width probe', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const scan = stubScan(wallet, () => empty);
    const { proofs } = await wallet.batchRestore();
    expect(proofs).toEqual([]);
    // the probe is as wide as the gap limit, so one empty probe settles the keyset
    expect(scan).toHaveBeenCalledTimes(1);
  });
  test('Batch restore sizes batches by keyset kind, not by a larger advertised cap', async () => {
    server.use(
      http.get(mintUrl + '/v1/info', () => {
        return HttpResponse.json({ ...mintInfoResp, max_array_length: 4000 });
      }),
    );
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const counts: number[] = [];
    stubScan(wallet, (start, count) => {
      counts.push(count);
      return start === 0 ? found(1, 0) : empty;
    });
    await wallet.batchRestore();
    // a 300-wide probe, then 200-batches for this BIP32 keyset: the scan pays client crypto per
    // counter, so it does not follow the advertised 4000
    expect(counts).toEqual([300, 200, 200]);
  });
  test('Batch restore with custom values', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const scan = stubScan(wallet, (start) => (start === 0 ? found(42, 41) : empty));
    const { proofs, lastCounterWithSignature } = await wallet.batchRestore({
      gapLimit: 100,
      batchSize: 50,
    });
    expect(proofs.length).toBe(42);
    // a 100-wide probe finds usage, then a two-batch wave of 50 closes the gap
    expect(scan).toHaveBeenCalledTimes(3);
    expect(lastCounterWithSignature).toBe(41);
  });
  test('Batch restore recovers proofs found past the gap limit in the same wave', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    // the gap limit is reached at start 300, but the batch at 600 is already in flight in
    // the same wave; its proofs reset the gap count and are kept, not dropped.
    const scan = stubScan(wallet, (start) => {
      if (start === 0) return found(5, 4);
      if (start === 600) return found(3, 602);
      return empty;
    });
    const { proofs, lastCounterWithSignature } = await wallet.batchRestore({ batchSize: 300 });
    expect(proofs.length).toBe(8);
    expect(lastCounterWithSignature).toBe(602);
    // the find at 600 leaves 297 empty counters, so one more two-batch wave closes the gap
    expect(scan).toHaveBeenCalledTimes(5);
  });
  test('Batch restore probes the gap, then doubles the wave up to the pool for a used HMAC keyset', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const calls: Array<[number, number]> = [];
    stubScan(wallet, (start, count) => {
      calls.push([start, count]);
      return start < 1500 ? found(1, start + count - 1) : empty;
    });
    // the scan step is stubbed, so the keyset only has to look like a v1 (HMAC) id: 500-batches, pool 4
    await wallet.batchRestore({ keysetId: `01${'ab'.repeat(32)}` });
    // one 300-wide probe, then waves of 2 and 4 batches as usage keeps showing
    expect(calls).toEqual([
      [0, 300],
      [300, 500],
      [800, 500],
      [1300, 500],
      [1800, 500],
      [2300, 500],
      [2800, 500],
    ]);
  });
  test('Batch restore treats maxCounter as an inclusive ceiling and ends there', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    const calls: Array<[number, number]> = [];
    stubScan(wallet, (start, count) => {
      calls.push([start, count]);
      return found(1, start + count - 1);
    });
    // gapLimit Infinity: the gap rule never fires, so only the bound can end the scan
    const { proofs } = await wallet.batchRestore({
      gapLimit: Infinity,
      batchSize: 100,
      maxCounter: 349,
    });
    // 350 counters in 100-batches; the last is clamped, nothing probes past the bound
    expect(calls).toEqual([
      [0, 100],
      [100, 100],
      [200, 100],
      [300, 50],
    ]);
    expect(proofs.length).toBe(4);
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

    await wallet.restoreAll({ gapLimit: 100, batchSize: 50 });

    expect(batchSpy).toHaveBeenCalledWith({ gapLimit: 100, batchSize: 50, keysetId: 'A' });
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
        const out = OutputData.createSingleDeterministicData(0, seed, c, keysetId);
        counterByB_.set(out.blindedMessage.B_, c);
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
