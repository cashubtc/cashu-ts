import { describe, expect, test } from 'vitest';

import { runPool } from '../../src/transport/pool';

describe('runPool', () => {
  test('runs items with bounded concurrency and keeps result order', async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await runPool([30, 10, 20], 2, async (ms) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return ms;
    });
    expect(results).toEqual([30, 10, 20]);
    expect(peak).toBe(2);
  });

  test('a failure stops new claims and settles in-flight work before rejecting', async () => {
    const claimed: number[] = [];
    let inFlight = 0;
    const pool = runPool([0, 1, 2, 3, 4], 2, async (item) => {
      claimed.push(item);
      inFlight++;
      try {
        await new Promise((r) => setTimeout(r, item === 0 ? 5 : 25));
        if (item === 0) throw new Error('boom');
        return item;
      } finally {
        inFlight--;
      }
    });
    await expect(pool).rejects.toThrow('boom');
    expect(inFlight).toBe(0); // rejection waited for the in-flight item
    expect(claimed).toEqual([0, 1]); // items queued behind the failure were never claimed
  });
});
