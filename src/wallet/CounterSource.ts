import { CTSError } from '../model/Errors';
/**
 * Usable counters in range is [start, start+count-1]
 *
 * @example // Start: 5, count: 3 => 5,6,7.
 */
export interface CounterRange {
  start: number;
  count: number;
}

/**
 * The counter key for mint quote lock keys (NUT-13 derivation type `0x04`).
 *
 * @remarks
 * One cursor per wallet, not per keyset: a mint quote is requested before any keyset is chosen, so
 * its lock key derives without one. It is a counter of its own because a quote may mint nothing,
 * and because a lock key may be handed over for delegated minting and so must never collide with a
 * proof secret key. A `CounterSource` sees it as just another key to persist, so nothing
 * implementing the interface needs to know about purposes; do not assume every key is a keyset id.
 */
export const QUOTE_COUNTER_KEY = 'mint-quote-lock';

// CounterSource.ts
/**
 * Persistence for deterministic derivation counters.
 *
 * @remarks
 * A counter value describes one allocation completely, so an implementation that ever replays a
 * value silently mints duplicate proofs: the same counter re-derives the same secret **and** the
 * same blinding factor, and every proof after the first spend of that secret is refused as already
 * spent, mint-wide and permanently. Reserve and persist atomically, and never roll a cursor back.
 * Quote locks (see {@link QUOTE_COUNTER_KEY}) have no equivalent detector at all, since nothing
 * blinds them, so their cursor must advance on every quote request.
 */
export interface CounterSource {
  /**
   * Reserve n counters for a keyset.
   *
   * N may be 0. In that case the call MUST NOT mutate state and MUST return { start: currentNext,
   * count: 0 }, effectively a read only peek of the cursor.
   */
  reserve(keysetId: string, n: number): Promise<CounterRange>;
  /**
   * Reserve a caller-chosen range `[start, start+count)` for a keyset.
   *
   * @remarks
   * Use for manual deterministic counters, where the caller picks the range rather than taking the
   * next free one. MUST be atomic with `reserve()`: checking the cursor and bumping it in two calls
   * leaves a window for a concurrent reservation to take counters inside the range. Counters below
   * `start` are burned, matching `advanceToAtLeast`.
   * @throws If `start` is below the cursor, i.e. the range was already handed out.
   */
  reserveAt(keysetId: string, start: number, count: number): Promise<CounterRange>;
  /**
   * Monotonic bump, ensure the next counter is at least minNext.
   *
   * @remarks
   * Unconditional: a cursor already past `minNext` is left alone. To take a specific range and find
   * out whether it was already issued, use `reserveAt()`.
   */
  advanceToAtLeast(keysetId: string, minNext: number): Promise<void>;
  /**
   * Optional introspection.
   */
  snapshot?(): Promise<Record<string, number>>;
  /**
   * Optional hard set, useful for tests or migrations.
   */
  setNext?(keysetId: string, next: number): Promise<void>;
}

/**
 * Counter summary for an operation.
 *
 * - `keysetId` - of the transaction.
 * - `start` - beginning of reservation.
 * - `count` - number of reservations.
 * - `next` - counter available after reservation.
 *
 * @example // Start: 5, Count: 3 => 5,6,7. Next: 8.
 */
export type OperationCounters = {
  keysetId: string;
  start: number;
  count: number;
  next: number;
};

/**
 * In memory implementation with per keyset locks for atomic counters.
 */
export class EphemeralCounterSource implements CounterSource {
  private next = new Map<string, number>();
  private locks = new Map<string, Promise<void>>();

  constructor(initial?: Record<string, number>) {
    if (initial) {
      for (const [k, v] of Object.entries(initial)) this.next.set(k, v);
    }
  }

  private async withLock<T>(k: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = this.locks.get(k) ?? Promise.resolve();
    let release!: () => void;
    const p = new Promise<void>((resolve) => (release = resolve));
    const chain = prev.then(() => p);
    this.locks.set(k, chain);
    try {
      await prev;
      return await fn();
    } finally {
      release();
      if (this.locks.get(k) === chain) {
        this.locks.delete(k);
      }
    }
  }

  async reserve(keysetId: string, n: number): Promise<CounterRange> {
    if (n < 0) throw new CTSError('reserve called with negative count');
    return this.withLock(keysetId, () => {
      const cur = this.next.get(keysetId) ?? 0;
      if (n === 0) return { start: cur, count: 0 }; // report current, do not move
      this.next.set(keysetId, cur + n);
      return { start: cur, count: n };
    });
  }

  async reserveAt(keysetId: string, start: number, count: number): Promise<CounterRange> {
    if (start < 0 || count < 0) {
      throw new CTSError('reserveAt called with a negative start or count');
    }
    return this.withLock(keysetId, () => {
      const cur = this.next.get(keysetId) ?? 0;
      if (start < cur) {
        throw new CTSError(
          `Counter ${start} for keyset ${keysetId} was already issued (next is ${cur})`,
        );
      }
      this.next.set(keysetId, start + count);
      return { start, count };
    });
  }

  async advanceToAtLeast(keysetId: string, minNext: number): Promise<void> {
    await this.withLock(keysetId, () => {
      const cur = this.next.get(keysetId) ?? 0;
      if (minNext > cur) this.next.set(keysetId, minNext);
    });
  }

  async setNext(keysetId: string, next: number): Promise<void> {
    await this.withLock(keysetId, () => {
      if (next < 0) throw new CTSError('setNext: negative next not allowed');
      this.next.set(keysetId, next);
    });
  }

  snapshot(): Promise<Record<string, number>> {
    return Promise.resolve(Object.fromEntries(this.next.entries()));
  }
}

/**
 * Create a shared in-memory {@link CounterSource}.
 *
 * Use this when multiple {@link Wallet} instances share the same seed and must allocate
 * deterministic outputs without overlapping counter ranges. Pass the returned source to each wallet
 * via the `counterSource` option.
 *
 * The source is memory-only — counters do not survive page reloads. Subscribe to
 * {@link WalletEvents.countersReserved | wallet.on.countersReserved} to persist counter state to
 * your own storage.
 *
 * @param initial - Optional seed values (`{ [keysetId]: nextCounter }`).
 */
export function createEphemeralCounterSource(initial?: Record<string, number>): CounterSource {
  return new EphemeralCounterSource(initial);
}
