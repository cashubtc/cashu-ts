import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { CTSError, sumProofs } from '../../src';
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

describe('selectProofsRGLI, default parameters', () => {
  test('includeFees defaults to false (fees are not applied when the arg is omitted)', () => {
    // 1 sat/proof fee (1000ppk). With includeFees=false the two 1-sat proofs net 2 and
    // meet the target; if the default were true they would be uneconomical and dropped.
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(1), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(1), secret: 's2', C: 'C2' },
    ];
    const kc = keychainStub({ A: 1000 });

    // Three-arg call: both includeFees and exactMatch defaulted.
    const res = selectProofsRGLI(proofs, 2, kc);

    expect(res.send).toHaveLength(2);
    expect(sumProofs(res.send).toNumber()).toBe(2);
    expect(res.keep).toHaveLength(0);
  });

  test('exactMatch defaults to false (close match) when the arg is omitted', () => {
    // No subset of {5,5} sums to 3, so exact match returns nothing, but a close match
    // returns one 5-sat proof (net 5 >= 3). The omitted arg must behave as close match.
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(5), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(5), secret: 's2', C: 'C2' },
    ];
    const kc = keychainStub({ A: 0 });

    // Four-arg call: exactMatch defaulted, includeFees explicit.
    const res = selectProofsRGLI(proofs, 3, kc, false);
    expect(res.send.map((p) => p.amount.toNumber())).toEqual([5]);

    // Sanity: the explicit exact-match variant of the same input returns nothing.
    const exact = selectProofsRGLI(proofs, 3, kc, false, true);
    expect(exact.send).toHaveLength(0);
  });
});

describe('selectProofsRGLI, guards and error context', () => {
  test('throws for a proof amount above Number.MAX_SAFE_INTEGER', () => {
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(BigInt(Number.MAX_SAFE_INTEGER) + 1n), secret: 's1', C: 'C1' },
    ];
    const kc = keychainStub({ A: 0 });

    let caught: unknown;
    try {
      selectProofsRGLI(proofs, 5, kc);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    // Both concatenated halves of the message must be present.
    expect((caught as Error).message).toMatch(/does not support proof amounts/);
    expect((caught as Error).message).toMatch(/Provide a custom SelectProofs/);
  });

  test('fee lookup failure preserves the original error as cause and logs context', () => {
    const proofs: Proof[] = [{ id: 'MISSING', amount: Amount.from(4), secret: 's1', C: 'C1' }];
    const original = new Error('no keyset MISSING');
    const error = vi.fn<(m: string, ctx?: unknown) => void>();
    const kc = {
      getKeyset: () => {
        throw original;
      },
      getKeysets: () => [{ id: 'K', fee: 0 }],
    } as any;

    let caught: unknown;
    try {
      selectProofsRGLI(proofs, 5, kc, false, false, { error } as any);
    } catch (e) {
      caught = e;
    }
    // The thrown CTSError chains the underlying lookup error.
    expect(caught).toBeInstanceOf(CTSError);
    expect((caught as CTSError).cause).toBe(original);
    // The error log carries structured context (the raw error and keychain snapshot).
    expect(error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ error: original, keychain: [{ id: 'K', fee: 0 }] }),
    );
  });
});

describe('selectProofsRGLI, early-return guards', () => {
  test('zero target returns keep-all and empty send', () => {
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(5), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(5), secret: 's2', C: 'C2' },
    ];
    const kc = keychainStub({ A: 0 });

    const res = selectProofsRGLI(proofs, 0, kc);
    expect(res.send).toHaveLength(0);
    expect(res.keep).toHaveLength(2);
  });
});

describe('selectProofsRGLI, deterministic selection', () => {
  test('exact match returns the unique full-set solution', () => {
    // {1,2,4} sums to exactly 7 only as the whole set, so exact match must send all three.
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(1), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(2), secret: 's2', C: 'C2' },
      { id: 'A', amount: Amount.from(4), secret: 's3', C: 'C3' },
    ];
    const kc = keychainStub({ A: 0 });

    const res = selectProofsRGLI(proofs, 7, kc, false, true);
    expect(res.send.map((p) => p.amount.toNumber()).sort((a, b) => a - b)).toEqual([1, 2, 4]);
    expect(res.keep).toHaveLength(0);
  });

  test('close match with a fixed RNG returns the exact-hit subset', () => {
    // With Math.random pinned the shuffle is deterministic; {2,3,5} nets exactly 10.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(1), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(2), secret: 's2', C: 'C2' },
      { id: 'A', amount: Amount.from(3), secret: 's3', C: 'C3' },
      { id: 'A', amount: Amount.from(5), secret: 's4', C: 'C4' },
      { id: 'A', amount: Amount.from(8), secret: 's5', C: 'C5' },
    ];
    const kc = keychainStub({ A: 0 });

    const res = selectProofsRGLI(proofs, 10, kc, false, false);
    // Arbitrary-but-RNG-pinned tie-break: {2,3,5} and {2,8} both sum to 10. Asserting the
    // exact subset the pinned shuffle lands on is a deliberate change-detector, not a unique
    // spec solution.
    expect(res.send.map((p) => p.amount.toNumber()).sort((a, b) => a - b)).toEqual([2, 3, 5]);
    expect(sumProofs(res.send).toNumber()).toBe(10);
  });

  test('exact match with a seeded RNG swaps in the exact {2,4} subset', () => {
    // Seeded sequence drives the greedy + local-improvement swaps to the exact solution.
    const seq = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8];
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]);
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(1), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(2), secret: 's2', C: 'C2' },
      { id: 'A', amount: Amount.from(4), secret: 's3', C: 'C3' },
      { id: 'A', amount: Amount.from(8), secret: 's4', C: 'C4' },
    ];
    const kc = keychainStub({ A: 0 });

    const res = selectProofsRGLI(proofs, 6, kc, false, true);
    expect(res.send.map((p) => p.amount.toNumber()).sort((a, b) => a - b)).toEqual([2, 4]);
  });
});

describe('selectProofsRGLI, invariants', () => {
  test('a feasible close match never returns under the target (repeated unseeded runs)', () => {
    // Exact 5 exists ({1,4}); every run must net >= target with no RNG mocking.
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(1), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(2), secret: 's2', C: 'C2' },
      { id: 'A', amount: Amount.from(4), secret: 's3', C: 'C3' },
      { id: 'A', amount: Amount.from(8), secret: 's4', C: 'C4' },
    ];
    const kc = keychainStub({ A: 0 });

    for (let run = 0; run < 25; run++) {
      const res = selectProofsRGLI(proofs, 5, kc, false, false);
      expect(res.send.length).toBeGreaterThan(0);
      expect(sumProofs(res.send).toNumber()).toBeGreaterThanOrEqual(5);
    }
  });
});
