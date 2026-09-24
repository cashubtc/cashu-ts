import { CallerAbortError, CTSError } from '../model/Errors';

// Cap on items between yields; the time budget usually yields first on curve work.
export const YIELD_CHUNK_SIZE = 32;
// A few frames: a chunk that has used this much CPU yields before the next item. Measured on
// v3 verification, 50 ms takes most of the batched-pairing win with stalls no spinner shows.
export const YIELD_BUDGET_MS = 50;

export type ChunkOptions = {
  /**
   * Most items between yields. Default 32. The time budget usually yields earlier.
   */
  chunkSize?: number;
  /**
   * Milliseconds of work between yields. Default 50, a few frames.
   */
  budgetMs?: number;
  /**
   * Checked before and after each yield; the call rejects with `CallerAbortError`.
   */
  signal?: AbortSignal;
  /**
   * Called at each yield and at the end, with items done so far and the total.
   */
  onProgress?: (done: number, total: number) => void;
};

/**
 * The chunk size to use, or a `CTSError`: a NaN or zero size would silently skip the work.
 */
export function chunkSizeOrThrow(chunkSize: number | undefined): number {
  const size = chunkSize ?? YIELD_CHUNK_SIZE;
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new CTSError('chunkSize must be a positive safe integer');
  }
  return size;
}

/**
 * The time budget to use, or a `CTSError`: a NaN budget would never yield, or stall the v3 slices.
 */
export function budgetOrThrow(budgetMs: number | undefined): number {
  const budget = budgetMs ?? YIELD_BUDGET_MS;
  if (!Number.isFinite(budget) || budget < 0) {
    throw new CTSError('budgetMs must be a finite, non-negative number');
  }
  return budget;
}

/**
 * Hands the thread back to the event loop as a macrotask, so pending input and paint can run.
 *
 * @remarks
 * `setTimeout(0)` is the last resort: browsers clamp nested timers to 4 ms, which would cost more
 * than the work being split. A `MessageChannel` message is not clamped.
 */
export async function yieldToEventLoop(): Promise<void> {
  const g = globalThis as {
    scheduler?: { yield?: () => Promise<void> };
    MessageChannel?: typeof MessageChannel;
  };
  if (typeof g.scheduler?.yield === 'function') return g.scheduler.yield();
  if (typeof g.MessageChannel === 'function') {
    await new Promise<void>((resolve) => {
      const { port1, port2 } = new g.MessageChannel!();
      port1.onmessage = () => {
        port1.close();
        resolve();
      };
      port2.postMessage(null);
    });
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Maps synchronously over `items`, yielding to the event loop every few frames.
 *
 * @remarks
 * Order is preserved. A yield happens when a chunk has used `budgetMs` of time or `chunkSize`
 * items, whichever comes first, so a slow item and a fast one both stay responsive. A short list
 * that finishes inside the budget never yields.
 */
export async function mapInChunks<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => R,
  opts?: ChunkOptions,
): Promise<R[]> {
  const size = chunkSizeOrThrow(opts?.chunkSize);
  const budget = budgetOrThrow(opts?.budgetMs);
  const total = items.length;
  const out: R[] = new Array<R>(total);
  const abort = () => {
    if (opts?.signal?.aborted) throw new CallerAbortError('Operation aborted by caller');
  };
  abort();
  let chunkStart = performance.now();
  let inChunk = 0;
  for (let i = 0; i < total; i++) {
    out[i] = fn(items[i], i);
    inChunk++;
    const last = i + 1 === total;
    if (!last && (inChunk >= size || performance.now() - chunkStart >= budget)) {
      opts?.onProgress?.(i + 1, total);
      await yieldToEventLoop();
      abort();
      chunkStart = performance.now();
      inChunk = 0;
    }
  }
  opts?.onProgress?.(total, total);
  return out;
}
