import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { sumProofs } from '../../src';
import { Amount } from '../../src/model/Amount';
import { type Proof } from '../../src/model/types';
import { selectProofsRGLI } from '../../src/wallet/SelectProofs';

// -----------------------------------------------------------------
// Most paths are exercised via wallet tests.
// These tests cover the edge case branches.
// -----------------------------------------------------------------

// Minimal keychain stub
function keychainStub(fees: Record<string, number>) {
  return {
    getKeyset: (id: string) => ({ fee: fees[id] ?? 0 }),
    getKeysets: () => Object.keys(fees).map((id) => ({ id, fee: fees[id] })),
  } as any;
}

// Logger spy with correct function typings
function loggerSpy() {
  const debug = vi.fn<(m: string) => void>();
  const info = vi.fn<(m: string) => void>();
  const warn = vi.fn<(m: string) => void>();
  return { logger: { debug, info, warn } as any, calls: { debug, info, warn } };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.resetModules();
});

describe('selectProofsRGLI, focused unit tests', () => {
  test('returns keep all when everything becomes uneconomical with fees', () => {
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(1), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(1), secret: 's2', C: 'C2' },
    ];
    // fee ppk two thousand, ceil(2000, 1000) equals two, exFee becomes negative
    const kc = keychainStub({ A: 2000 });
    const { logger } = loggerSpy();

    const res = selectProofsRGLI(proofs, 1, kc, true, false, logger);
    expect(res.send).toHaveLength(0);
    expect(res.keep).toHaveLength(2);
  });

  test('exact match, pre trim to zero when all exFee are greater than target', () => {
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(10), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(12), secret: 's2', C: 'C2' },
    ];
    const kc = keychainStub({ A: 0 });
    // target smaller than smallest candidate, binary search returns null, endIndex zero
    const res = selectProofsRGLI(proofs, 5, kc, false, true);
    expect(res.send).toHaveLength(0);
    expect(res.keep).toHaveLength(2);
  });

  test('close match, biggerIndex null branch, all exFee less than target so all kept for selection', () => {
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(3), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(4), secret: 's2', C: 'C2' },
    ];
    const kc = keychainStub({ A: 0 });
    const res = selectProofsRGLI(proofs, 6, kc, false, false);
    expect(res.send.length + res.keep.length).toBe(2);
    expect(res.send.length).toBeGreaterThan(0);
  });

  test('accepts AmountLike target amount', () => {
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(3), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(4), secret: 's2', C: 'C2' },
    ];
    const kc = keychainStub({ A: 0 });
    const res = selectProofsRGLI(proofs, Amount.from('6'), kc, false, false);
    expect(res.send.length).toBeGreaterThan(0);
  });

  test('accepts JSON-parsed ProofLike[] and rehydrates proof amounts', () => {
    const proofs = JSON.parse(
      JSON.stringify([
        { id: 'A', amount: Amount.from(4), secret: 's1', C: 'C1' },
        { id: 'A', amount: Amount.from(4), secret: 's2', C: 'C2' },
      ]),
    ) as Proof[];
    const kc = keychainStub({ A: 0 });

    const res = selectProofsRGLI(proofs, 6, kc, false, false);

    expect(res.send.length).toBeGreaterThan(0);
    expect(res.send.every((p) => p.amount instanceof Amount)).toBe(true);
  });

  test('no feasible solution, amount exceeds total after fees, returns keep all and empty send', () => {
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(2), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(3), secret: 's2', C: 'C2' },
    ];
    const kc = keychainStub({ A: 0 });
    const res = selectProofsRGLI(proofs, 10, kc, true, false);
    expect(res.send).toHaveLength(0);
    expect(res.keep).toHaveLength(2);
  });

  test('happy path, succeeds and logs total time, covering final logging lines', () => {
    const proofs: Proof[] = [
      { id: 'L', amount: Amount.from(8), secret: 's1', C: 'C1' },
      { id: 'L', amount: Amount.from(8), secret: 's2', C: 'C2' },
      { id: 'L', amount: Amount.from(4), secret: 's3', C: 'C3' },
    ];
    const kc = keychainStub({ L: 600 }); // ceil(600 / 1000) equals one per thousand proofs
    const { logger, calls } = loggerSpy();

    const res = selectProofsRGLI(proofs, 15, kc, true, false, logger);
    const sum = sumProofs(res.send);
    const fee = Math.ceil((res.send.length * 600) / 1000);
    expect(sum.subtract(fee).greaterThanOrEqual(15)).toBeTruthy();
    expect(calls.info).toHaveBeenCalled(); // covers the info log at the end
  });

  test('local improvement swaps in a better proof and re-inserts the replaced proof in sorted order', () => {
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(4), secret: 's4', C: 'C4' },
      { id: 'A', amount: Amount.from(5), secret: 's5', C: 'C5' },
      { id: 'A', amount: Amount.from(6), secret: 's6', C: 'C6' },
    ];
    const kc = keychainStub({ A: 0 });
    const randomValues = [0.4, 0.9, 0.9];
    let index = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => randomValues[index++] ?? 0.9);

    const res = selectProofsRGLI(proofs, 9, kc, false, false);

    expect(res.send.map((p) => p.amount.toNumber()).sort((a, b) => a - b)).toEqual([4, 5]);
    expect(res.keep.map((p) => p.amount.toNumber())).toEqual([6]);
  });

  test('timeout in exact match throws on time budget exceeded', () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 10_000;
      return now;
    });

    // Use only even amounts so an odd exact target is impossible.
    // total = 2 + 4 + 6 + 8 = 20; target = 7 (feasible range, but exact impossible)
    const proofs = [
      { id: 'Z', amount: 2, secret: 's1', C: 'C1' },
      { id: 'Z', amount: 4, secret: 's2', C: 'C2' },
      { id: 'Z', amount: 6, secret: 's3', C: 'C3' },
      { id: 'Z', amount: 8, secret: 's4', C: 'C4' },
    ];
    const kc = {
      getKeyset: () => ({ fee: 0 }),
      getKeysets: () => [{ id: 'Z', fee: 0 }],
    } as any;

    expect(() => selectProofsRGLI(proofs as any, 7, kc, false, true)).toThrow(/took too long/i);
  });

  test('throws if keyset fee lookup fails (feeForProof error path)', () => {
    const proofs: Proof[] = [
      { id: 'MISSING', amount: Amount.from(4), secret: 's1', C: 'C1' },
      { id: 'MISSING', amount: Amount.from(8), secret: 's2', C: 'C2' },
    ];

    // Keychain stub that *throws* for unknown ids
    const kc = {
      getKeyset: (id: string) => {
        throw new Error(`no keyset ${id}`);
      },
      getKeysets: () => [],
    } as any;

    // includeFees=false vs true does not matter here, we fail during fee lookup
    expect(() => selectProofsRGLI(proofs as any, 5, kc, false, false)).toThrow(
      /Could not get fee\. No keyset found/i,
    );
  });
});

describe('selectProofsRGLI, invariants', () => {
  test('sub-sat fee proofs are kept and aggregate into a spendable sat', () => {
    // 1 sat at 999ppk nets 0.001 alone; one thousand of them net exactly 1
    const proofs: Proof[] = Array.from({ length: 1000 }, (_, i) => ({
      id: 'A',
      amount: Amount.from(1),
      secret: `s${i}`,
      C: `C${i}`,
    }));
    const kc = keychainStub({ A: 999 });

    const res = selectProofsRGLI(proofs, 1, kc, true, false);

    expect(res.send).toHaveLength(1000);
    expect(res.keep).toHaveLength(0);
  });

  test('a 1 sat proof at 1000ppk is uneconomical and never selected', () => {
    const proofs: Proof[] = [{ id: 'A', amount: Amount.from(1), secret: 's1', C: 'C1' }];
    const kc = keychainStub({ A: 1000 });

    const res = selectProofsRGLI(proofs, 1, kc, true, false);

    expect(res.send).toHaveLength(0);
    expect(res.keep).toHaveLength(1);
  });

  test('exact match finds a proof whose exFee is above target but whose net hits it', () => {
    // 6 sat at 500ppk: exFee 5.5 but net alone is 6 - ceil(500/1000) = 5
    const proofs: Proof[] = [{ id: 'A', amount: Amount.from(6), secret: 's1', C: 'C1' }];
    const kc = keychainStub({ A: 500 });

    const res = selectProofsRGLI(proofs, 5, kc, true, true);

    expect(res.send).toHaveLength(1);
    expect(res.send[0].amount.toNumber()).toBe(6);
    expect(res.keep).toHaveLength(0);
  });
});

describe('selectProofsRGLI, u64-scale amounts', () => {
  test('close match selects among proofs above Number.MAX_SAFE_INTEGER', () => {
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(2n ** 60n), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(2n ** 59n), secret: 's2', C: 'C2' },
    ];
    const kc = keychainStub({ A: 0 });

    const res = selectProofsRGLI(proofs, 2n ** 59n, kc, false, false);

    expect(res.send.map((p) => p.amount.toBigInt())).toEqual([2n ** 59n]);
  });

  test('exact match nets a u64 target with fees, using the widened trim bound', () => {
    // 2^60 at 500ppk nets 2^60 - 1; its exFee (2^60) sits exactly at target + 1
    const proofs: Proof[] = [{ id: 'A', amount: Amount.from(2n ** 60n), secret: 's1', C: 'C1' }];
    const kc = keychainStub({ A: 500 });

    const res = selectProofsRGLI(proofs, 2n ** 60n - 1n, kc, true, true);

    expect(res.send).toHaveLength(1);
  });

  test('exact match mixes huge and small proofs', () => {
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(2n ** 60n), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(3), secret: 's2', C: 'C2' },
      { id: 'A', amount: Amount.from(1), secret: 's3', C: 'C3' },
    ];
    const kc = keychainStub({ A: 0 });

    const res = selectProofsRGLI(proofs, 2n ** 60n + 4n, kc, false, true);

    expect(res.send).toHaveLength(3);
  });

  test('sums beyond MAX_SAFE_INTEGER stay exact even when single proofs are safe', () => {
    // 1024 proofs of 2^44 + 1 sum past 2^53; double arithmetic would drift here
    const amount = 2n ** 44n + 1n;
    const proofs: Proof[] = Array.from({ length: 1024 }, (_, i) => ({
      id: 'A',
      amount: Amount.from(amount),
      secret: `s${i}`,
      C: `C${i}`,
    }));
    const kc = keychainStub({ A: 0 });

    const res = selectProofsRGLI(proofs, 1024n * amount, kc, false, false);

    expect(res.send).toHaveLength(1024);
    expect(res.keep).toHaveLength(0);
  });
});
