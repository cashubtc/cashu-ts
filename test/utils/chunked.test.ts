import { describe, expect, test } from 'vitest';

import { CallerAbortError } from '../../src/model/Errors';
import { mapInChunks } from '../../src/utils/chunked';

describe('mapInChunks', () => {
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
