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
 * @remarks
 * Not chunked: `limit` workers pull from a shared cursor, so a slow item never stalls the rest.
 * Lock-free because `next++` claims are synchronous; workers only interleave at the await. Rejects
 * on the first `fn` rejection (Promise.all); later rejections are absorbed.
 * @internal
 */
export async function runPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  // Shared cursor: index of the next unclaimed item.
  let next = 0;
  // Spawn up to `limit` workers, each an immediately-invoked async loop.
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    // `next++` reads-then-bumps in one synchronous step, so every index is claimed exactly
    // once; the worker claims whatever is next by the time its await settles.
    for (let i = next++; i < items.length; i = next++) {
      // Write by slot, so output order matches input order however workers finish.
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
