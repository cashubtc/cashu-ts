import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { selectProofsRGLI } from '../../src/wallet/SelectProofs';
import { Proof } from '../../src/model/types';
import { Amount } from '../../src/model/Amount';
import { sumProofs } from '../../src';

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

    const res = selectProofsRGLI(proofs as any, 1, kc, true, false, logger);
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
    const res = selectProofsRGLI(proofs as any, 5, kc, false, true);
    expect(res.send).toHaveLength(0);
    expect(res.keep).toHaveLength(2);
  });

  test('close match, biggerIndex null branch, all exFee less than target so all kept for selection', () => {
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(3), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(4), secret: 's2', C: 'C2' },
    ];
    const kc = keychainStub({ A: 0 });
    const res = selectProofsRGLI(proofs as any, 6, kc, false, false);
    expect(res.send.length + res.keep.length).toBe(2);
    expect(res.send.length).toBeGreaterThan(0);
  });

  test('accepts AmountLike target amount', () => {
    const proofs: Proof[] = [
      { id: 'A', amount: Amount.from(3), secret: 's1', C: 'C1' },
      { id: 'A', amount: Amount.from(4), secret: 's2', C: 'C2' },
    ];
    const kc = keychainStub({ A: 0 });
    const res = selectProofsRGLI(proofs as any, Amount.from('6'), kc, false, false);
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
    const res = selectProofsRGLI(proofs as any, 10, kc, true, false);
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

    const res = selectProofsRGLI(proofs as any, 15, kc, true, false, logger);
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

    const res = selectProofsRGLI(proofs as any, 9, kc, false, false);

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
