import { CallerAbortError, CTSError } from '../model/Errors';

// One size for every curve; a BLS item is about 1 ms, so a chunk stays under a frame.
export const YIELD_CHUNK_SIZE = 32;

export type ChunkOptions = {
  chunkSize?: number;
  /**
   * Checked before each chunk; the call rejects with `CallerAbortError`.
   */
  signal?: AbortSignal;
  /**
   * Called after each chunk with items done so far and the total.
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
 * Maps synchronously over `items` in chunks, yielding to the event loop between them.
 *
 * @remarks
 * Order is preserved. The first chunk runs without a yield, so a short list costs nothing extra.
 */
export async function mapInChunks<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => R,
  opts?: ChunkOptions,
): Promise<R[]> {
  const size = chunkSizeOrThrow(opts?.chunkSize);
  const total = items.length;
  const out: R[] = new Array<R>(total);
  for (let start = 0; start < total; start += size) {
    if (opts?.signal?.aborted) throw new CallerAbortError('Operation aborted by caller');
    if (start > 0) await yieldToEventLoop();
    if (opts?.signal?.aborted) throw new CallerAbortError('Operation aborted by caller');
    const end = Math.min(start + size, total);
    for (let i = start; i < end; i++) out[i] = fn(items[i], i);
    opts?.onProgress?.(end, total);
  }
  return out;
}
