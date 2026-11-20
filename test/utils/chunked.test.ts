import { afterEach, describe, expect, test, vi } from 'vitest';

import { CallerAbortError } from '../../src/model/Errors';
import { budgetedYield, mapInChunks, yieldToEventLoop } from '../../src/utils/chunked';

describe('mapInChunks', () => {
  test.each([NaN, Infinity, -1])('rejects budgetMs %s', async (budgetMs) => {
    await expect(mapInChunks([1], (x) => x, { budgetMs })).rejects.toThrow('budgetMs');
  });

  test.each([NaN, Infinity, 0, -1, 1.5])('rejects chunkSize %s', async (chunkSize) => {
    await expect(mapInChunks([1], (x) => x, { chunkSize })).rejects.toThrow('chunkSize');
  });

  test('aborting while yielded prevents the final chunk', async () => {
    const ac = new AbortController();
    const calls: number[] = [];
    const pending = mapInChunks([1, 2], (x) => calls.push(x), {
      chunkSize: 1,
      signal: ac.signal,
    });
    ac.abort();
    await expect(pending).rejects.toBeInstanceOf(CallerAbortError);
    expect(calls).toEqual([1]);
  });

  test('preserves order and reports cumulative progress', async () => {
    const seen: Array<[number, number]> = [];
    const out = await mapInChunks([1, 2, 3, 4, 5], (x) => x * 2, {
      chunkSize: 2,
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(seen).toEqual([
      [2, 5],
      [4, 5],
      [5, 5],
    ]);
  });

  test('yields when the time budget is spent, before the count cap', async () => {
    const calls: number[] = [];
    const spin = (x: number) => {
      const until = performance.now() + 5;
      while (performance.now() < until) {
        // burn ~5 ms per item
      }
      calls.push(x);
      return x;
    };
    const pending = mapInChunks([1, 2, 3, 4, 5, 6], spin, { chunkSize: 100, budgetMs: 8 });
    // the first chunk stops once 8 ms have gone by, well before six items
    expect(calls.length).toBeLessThan(6);
    await pending;
    expect(calls).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('yields between chunks', async () => {
    const calls: number[] = [];
    const pending = mapInChunks(
      [1, 2, 3],
      (x) => {
        calls.push(x);
        return x;
      },
      { chunkSize: 1 },
    );
    expect(calls).toEqual([1]);
    await pending;
    expect(calls).toEqual([1, 2, 3]);
  });

  test('an aborted signal stops before the next chunk', async () => {
    const ac = new AbortController();
    await expect(
      mapInChunks(
        [1, 2, 3],
        (x) => {
          if (x === 1) ac.abort();
          return x;
        },
        { chunkSize: 1, signal: ac.signal },
      ),
    ).rejects.toBeInstanceOf(CallerAbortError);
  });
});

describe('mapInChunks timer fairness', () => {
  test('a timeout signal stops a long job rather than waiting for it to end', async () => {
    const spin = () => {
      const end = performance.now() + 1;
      while (performance.now() < end) {
        // busy: one item of curve-sized work
      }
    };
    const items = Array.from({ length: 1_000 }, (_, i) => i);
    // ~1 s of work; the timer only fires if the yields let timer tasks run.
    await expect(
      mapInChunks(items, spin, { signal: AbortSignal.timeout(30) }),
    ).rejects.toBeInstanceOf(CallerAbortError);
  });
});

describe('budgetedYield', () => {
  test('rejects at once for a signal that is already aborted', async () => {
    await expect(budgetedYield(AbortSignal.abort())()).rejects.toBeInstanceOf(CallerAbortError);
  });
});

describe('yieldToEventLoop', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('falls back to a timer without MessageChannel', async () => {
    vi.stubGlobal('MessageChannel', undefined);
    await expect(yieldToEventLoop()).resolves.toBeUndefined();
  });
});
