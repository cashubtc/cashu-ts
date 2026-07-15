/**
 * Concurrent mint requests for enumerable batch work (e.g. NUT-07 state-check batches).
 *
 * @remarks
 * Modest pool: browsers allow ~6 connections per host and mint rate limits are per-minute windows,
 * so 4 in flight cuts wall-clock without changing the request count.
 * @internal
 */
export const BATCH_POOL_SIZE = 4;

/**
 * Runs `fn` over `items` with at most `limit` in flight; results keep item order.
 *
 * @internal
 */
export async function runPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
