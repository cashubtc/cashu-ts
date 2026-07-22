import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Amount } from '../../src';
import { hashToCurve } from '../../src/crypto';
import type { Proof } from '../../src/model/types';
import { type OperationCounters } from '../../src/wallet';
import { WalletEvents } from '../../src/wallet/WalletEvents';

// Helper: flush microtasks (needed because cancelSafely runs them async)
const flushMicrotasks = async (n = 2) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/**
 * Mock WS that WalletEvents talks to.
 */
class MockWS {
  public createSubscription = vi.fn(
    (
      { kind, filters }: { kind: string; filters: string[] },
      cb: (p: any) => void,
      err: (e: Error) => void,
    ) => {
      const id = this.nextId++;
      this.subs.set(id, { kind, filters, cb, err });
      return id;
    },
  );

  public cancelSubscription = vi.fn((id: number, cb: (p: any) => void) => {
    const sub = this.subs.get(id);
    if (sub && sub.cb === cb) this.subs.delete(id);
  });

  /**
   * Deliver an update payload to matching subscribers for a kind.
   */
  emit(
    kind: 'bolt11_mint_quote' | 'bolt11_melt_quote',
    payload: { quote: string; [k: string]: any },
  ) {
    for (const { kind: k, filters, cb } of this.subs.values()) {
      if (k !== kind) continue;
      if (filters.includes(payload.quote)) cb(payload);
    }
  }

  /**
   * Deliver a proof_state payload (matches by Y)
   */
  emitProof(payload: { Y: string; [k: string]: any }) {
    for (const { kind: k, filters, cb } of this.subs.values()) {
      if (k !== 'proof_state') continue;
      if (filters.includes(payload.Y)) cb(payload);
    }
  }

  /**
   * Deliver a proof_state payload to every proof_state subscriber unconditionally, simulating a
   * misbehaving mint that sends a Y outside the subscribed filters.
   */
  emitProofRaw(payload: { Y: string; [k: string]: any }) {
    for (const { kind: k, cb } of this.subs.values()) {
      if (k !== 'proof_state') continue;
      cb(payload);
    }
  }

  /**
   * Invoke error callbacks for a kind.
   */
  fail(kind: string, error: any) {
    for (const { kind: k, err } of this.subs.values()) {
      if (k === kind) err(error);
    }
  }

  /**
   * First set of filters registered for a kind (for tests to craft payloads)
   */
  firstFilters(kind: string): string[] {
    for (const { kind: k, filters } of this.subs.values()) {
      if (k === kind) return filters;
    }
    return [];
  }

  /**
   * Count current subscriptions for a kind.
   */
  count(kind: string): number {
    let n = 0;
    for (const { kind: k } of this.subs.values()) if (k === kind) n++;
    return n;
  }

  private subs = new Map<
    number,
    { kind: string; filters: string[]; cb: (p: any) => void; err: (e: Error) => void }
  >();
  private nextId = 1;
}

/**
 * Minimal Mint surface for WalletEvents.
 */
class MockMint {
  public webSocketConnection: MockWS | undefined;
  public connectWebSocket = vi.fn(async () => {
    if (!this.webSocketConnection) this.webSocketConnection = new MockWS();
  });
}

/**
 * Only what WalletEvents touches.
 */
class MockWallet {
  public mint = new MockMint();
}

describe('WalletEvents', () => {
  let mock: MockWallet;
  let events: WalletEvents;

  beforeEach(() => {
    vi.useRealTimers();
    mock = new MockWallet();
    // @ts-expect-error only the mocked subset is injected
    events = new WalletEvents(mock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('basic subscriptions', () => {
    it('mintQuoteUpdates subscribes and receives updates', async () => {
      const cb = vi.fn();
      const err = vi.fn();
      const canceller = await events.mintQuoteUpdates(['a', 'b'], cb, err);

      const ws = mock.mint.webSocketConnection!;
      ws.emit('bolt11_mint_quote', { quote: 'a', state: 'PAID' });

      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ quote: 'a' }));
      expect(typeof canceller).toBe('function');
    });

    it('mintQuotePaid only forwards PAID', async () => {
      const cb = vi.fn();
      const err = vi.fn();
      await events.mintQuotePaid('x', cb, err);

      const ws = mock.mint.webSocketConnection!;
      ws.emit('bolt11_mint_quote', { quote: 'x', state: 'UNPAID' });
      expect(cb).not.toHaveBeenCalled();

      ws.emit('bolt11_mint_quote', { quote: 'x', state: 'PAID' });
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ quote: 'x' }));
    });

    it('meltQuoteUpdates subscribes and receives updates', async () => {
      const cb = vi.fn();
      const err = vi.fn();
      await events.meltQuoteUpdates(['m1'], cb, err);

      const ws = mock.mint.webSocketConnection!;
      ws.emit('bolt11_melt_quote', { quote: 'm1', state: 'PAID' });
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ quote: 'm1' }));
    });

    it('meltQuotePaid only forwards PAID', async () => {
      const cb = vi.fn();
      const err = vi.fn();
      await events.meltQuotePaid('m2', cb, err);

      const ws = mock.mint.webSocketConnection!;
      ws.emit('bolt11_melt_quote', { quote: 'm2', state: 'UNPAID' });
      expect(cb).not.toHaveBeenCalled();

      ws.emit('bolt11_melt_quote', { quote: 'm2', state: 'PAID' });
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ quote: 'm2' }));
    });

    it('proofStateUpdates subscribes and forwards payloads with proof attached', async () => {
      const cb = vi.fn();
      const err = vi.fn();
      const proofs: Proof[] = [
        { amount: Amount.from(2), id: '00bd033559de27d0', secret: 's1', C: 'test' },
      ];
      await events.proofStateUpdates(proofs, cb, err);

      const ws = mock.mint.webSocketConnection!;
      const [Y] = ws.firstFilters('proof_state'); // use the Y that WalletEvents subscribed with
      ws.emitProof({ Y, state: 0 });

      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ Y, state: 0 }));
    });

    it('proofStateUpdates accepts ProofLike-shaped input and preserves its type', async () => {
      type StoredProof = {
        id: string;
        amount: number;
        secret: string;
        C: string;
        reserved: boolean;
      };
      const stored: StoredProof[] = [
        { amount: 2, id: '00bd033559de27d0', secret: 's1', C: 'test', reserved: false },
      ];
      const seen: Array<{ proof: StoredProof }> = [];
      const err = vi.fn();
      await events.proofStateUpdates<StoredProof>(stored, (p) => seen.push(p), err);

      const ws = mock.mint.webSocketConnection!;
      const [Y] = ws.firstFilters('proof_state');
      ws.emitProof({ Y, state: 0 });

      expect(seen).toHaveLength(1);
      expect(seen[0].proof).toBe(stored[0]);
      // input shape (number amount, reserved field) is preserved
      expect(seen[0].proof.reserved).toBe(false);
      expect(typeof seen[0].proof.amount).toBe('number');
    });

    it('proofStateUpdates throws on duplicate proof secrets', async () => {
      const proofs: Proof[] = [
        { amount: Amount.from(2), id: '00bd033559de27d0', secret: 'same', C: 'a' },
        { amount: Amount.from(2), id: '00bd033559de27d0', secret: 'same', C: 'b' },
      ];
      await expect(events.proofStateUpdates(proofs, vi.fn(), vi.fn())).rejects.toThrow(
        /Duplicate proof secret/,
      );
    });

    it('proofStateUpdates ignores updates for an unsubscribed Y', async () => {
      const cb = vi.fn();
      const err = vi.fn();
      const proofs: Proof[] = [
        { amount: Amount.from(2), id: '00bd033559de27d0', secret: 's1', C: 'test' },
      ];
      await events.proofStateUpdates(proofs, cb, err);

      const ws = mock.mint.webSocketConnection!;
      // Simulate a misbehaving mint sending a Y the wallet never subscribed to.
      ws.emitProofRaw({ Y: 'bogus_Y_from_malicious_mint', state: 0 });

      expect(cb).not.toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
    });

    it('proofStateUpdates ignores prototype-key Ys (no pollution lookup)', async () => {
      const cb = vi.fn();
      const err = vi.fn();
      const proofs: Proof[] = [
        { amount: Amount.from(2), id: '00bd033559de27d0', secret: 's1', C: 'test' },
      ];
      await events.proofStateUpdates(proofs, cb, err);

      const ws = mock.mint.webSocketConnection!;
      // A plain-object proofMap would resolve these to inherited values
      // (Object.prototype, the constructor, etc.) and bypass the unknown-Y guard.
      ws.emitProofRaw({ Y: '__proto__', state: 0 });
      ws.emitProofRaw({ Y: 'constructor', state: 0 });
      ws.emitProofRaw({ Y: 'hasOwnProperty', state: 0 });
      ws.emitProofRaw({ Y: 'toString', state: 0 });

      expect(cb).not.toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
    });
  });

  describe('onceMintPaid', () => {
    it('resolves on PAID and unsubscribes (async canceller)', async () => {
      const p = events.onceMintPaid('q1');
      await flushMicrotasks(); // wait for subscription to be created
      const ws = mock.mint.webSocketConnection!;
      ws.emit('bolt11_mint_quote', { quote: 'q1', state: 'PAID', amount: 123 });
      const res = await p;
      expect(res).toMatchObject({ quote: 'q1', amount: 123 });
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
    });

    it('rejects with AbortError', async () => {
      const ac = new AbortController();
      const p = events.onceMintPaid('q2', { signal: ac.signal });
      ac.abort();
      await expect(p).rejects.toMatchObject({ name: 'AbortError' });
      const ws = mock.mint.webSocketConnection!;
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
    });

    it('rejects on timeout and unsubscribes', async () => {
      vi.useFakeTimers();
      const p = events.onceMintPaid('q3', { timeoutMs: 10 });
      vi.advanceTimersByTime(11);
      await expect(p).rejects.toThrow(/Timeout waiting for mint paid/);
      const ws = mock.mint.webSocketConnection!;
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('propagates underlying error and unsubscribes', async () => {
      const p = events.onceMintPaid('q4');
      await flushMicrotasks(); // wait for subscription
      const ws = mock.mint.webSocketConnection!;
      ws.fail('bolt11_mint_quote', new Error('boom'));
      await expect(p).rejects.toThrow('boom');
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
    });
  });

  describe('onceAnyMintPaid', () => {
    it('resolves when the first is PAID and cancels the rest', async () => {
      const p = events.onceAnyMintPaid(['a', 'b', 'c']);
      await flushMicrotasks(); // subs ready
      const ws = mock.mint.webSocketConnection!;
      ws.emit('bolt11_mint_quote', { quote: 'b', state: 'PAID', amount: 42 });
      const res = await p;
      expect(res).toMatchObject({ id: 'b', quote: expect.objectContaining({ amount: 42 }) });
      await flushMicrotasks();
      expect(ws.cancelSubscription.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('honours AbortSignal', async () => {
      const ac = new AbortController();
      const p = events.onceAnyMintPaid(['x', 'y'], { signal: ac.signal });
      ac.abort();
      await expect(p).rejects.toMatchObject({ name: 'AbortError' });
      const ws = mock.mint.webSocketConnection!;
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
    });

    it('times out if none paid', async () => {
      vi.useFakeTimers();
      const p = events.onceAnyMintPaid(['x1', 'x2'], { timeoutMs: 5 });
      vi.advanceTimersByTime(6);
      await expect(p).rejects.toThrow(/Timeout waiting for any mint paid/);
      const ws = mock.mint.webSocketConnection!;
      await flushMicrotasks();
      expect(ws.cancelSubscription.mock.calls.length).toBeGreaterThanOrEqual(2);
      vi.useRealTimers();
    });

    it('rejects when ids is empty', async () => {
      await expect(events.onceAnyMintPaid([])).rejects.toThrow(/No quote ids provided/);
    });

    it('failOnError=true rejects on first error and cancels the rest', async () => {
      const p = events.onceAnyMintPaid(['f1', 'f2', 'f3'], { failOnError: true });
      await flushMicrotasks(); // subs ready
      const ws = mock.mint.webSocketConnection!;
      ws.fail('bolt11_mint_quote', new Error('bad'));
      await expect(p).rejects.toThrow(/bad/);
      await flushMicrotasks();
      expect(ws.cancelSubscription.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('dedupes ids, resolves on first unique winner', async () => {
      const p = events.onceAnyMintPaid(['dup', 'dup', 'other']);
      await flushMicrotasks(); // subs ready
      const ws = mock.mint.webSocketConnection!;
      expect(ws.count('bolt11_mint_quote')).toBe(2); // dup + other
      ws.emit('bolt11_mint_quote', { quote: 'dup', state: 'PAID' });
      const res = await p;
      expect(res.id).toBe('dup');
    });

    it('normalizes non-Error objects when subs error (stringified JSON)', async () => {
      const p = events.onceAnyMintPaid(['e1', 'e2']);
      await flushMicrotasks(); // subs ready

      const ws = mock.mint.webSocketConnection!;
      // Our WS mock broadcasts the same error to all subs per call; the first call
      // already empties the set. So assert we get *a* JSON-stringified object.
      ws.fail('bolt11_mint_quote', { code: 1, msg: 'x' } as any);
      ws.fail('bolt11_mint_quote', { code: 2, msg: 'y' } as any);

      await expect(p).rejects.toThrow(/"code":\s*\d/);
    });

    it('safeStringify fallback path via object containing BigInt', async () => {
      const p = events.onceMintPaid('bigobj');
      await flushMicrotasks(); // sub ready
      const ws = mock.mint.webSocketConnection!;
      ws.fail('bolt11_mint_quote', { n: 10n } as any);
      await expect(p).rejects.toThrow(/\[object Object\]/);
    });

    it('primitive BigInt errors normalize to the object tag', async () => {
      const p = events.onceMintPaid('big-prim');
      await flushMicrotasks(); // sub ready

      const ws = mock.mint.webSocketConnection!;
      ws.fail('bolt11_mint_quote', 10n);

      // With current normalizeError/safeStringify, primitives fall back to
      // Object.prototype.toString => "[object BigInt]".
      await expect(p).rejects.toThrow(/\[object BigInt\]/);
    });
  });

  describe('onceMeltPaid', () => {
    it('resolves when melt is PAID and auto-unsubscribes', async () => {
      const p = events.onceMeltPaid('m1');
      await flushMicrotasks(); // sub ready
      const ws = mock.mint.webSocketConnection!;
      ws.emit('bolt11_melt_quote', { quote: 'm1', state: 'PAID', amount: 7 });
      const res = await p;
      expect(res).toMatchObject({ quote: 'm1', amount: 7 });
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
    });
  });

  describe('onceMeltPaid extra branches', () => {
    it('rejects with AbortError and unsubscribes', async () => {
      const ac = new AbortController();
      const rmSpy = vi.spyOn(ac.signal, 'removeEventListener');
      const p = events.onceMeltPaid('m-abort', { signal: ac.signal });
      ac.abort();
      await expect(p).rejects.toMatchObject({ name: 'AbortError' });
      const ws = mock.mint.webSocketConnection!;
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
      expect(rmSpy).toHaveBeenCalled();
    });

    it('rejects on timeout and unsubscribes', async () => {
      vi.useFakeTimers();
      const p = events.onceMeltPaid('m-timeout', { timeoutMs: 10 });
      vi.advanceTimersByTime(11);
      await expect(p).rejects.toThrow(/Timeout waiting for melt paid/);
      const ws = mock.mint.webSocketConnection!;
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('propagates underlying error and unsubscribes', async () => {
      const p = events.onceMeltPaid('m-error');
      await flushMicrotasks(); // sub ready
      const ws = mock.mint.webSocketConnection!;
      ws.fail('bolt11_melt_quote', new Error('melt-boom'));
      await expect(p).rejects.toThrow('melt-boom');
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
    });

    it('resolves and removes listener when a signal was provided', async () => {
      const ac = new AbortController();
      const rmSpy = vi.spyOn(ac.signal, 'removeEventListener');
      const p = events.onceMeltPaid('m-ok', { signal: ac.signal });
      await flushMicrotasks(); // sub ready
      const ws = mock.mint.webSocketConnection!;
      ws.emit('bolt11_melt_quote', { quote: 'm-ok', state: 'PAID', amount: 1 });
      await expect(p).resolves.toMatchObject({ quote: 'm-ok' });
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
      expect(rmSpy).toHaveBeenCalled();
    });
  });

  describe('proofStatesStream', () => {
    it('surfaces setup errors via the consumer (no hang, no unhandled rejection)', async () => {
      // Vitest fails the test on any unhandled rejection, so reaching the
      // explicit rejection assertion below also proves cancelP did not leak.
      const proofs: Proof[] = [
        { amount: Amount.from(2), id: '00bd033559de27d0', secret: 'dup', C: 'a' },
        { amount: Amount.from(2), id: '00bd033559de27d0', secret: 'dup', C: 'b' },
      ];
      const iter = events.proofStatesStream(proofs);
      await expect(
        (async () => {
          for await (const _ of iter) {
            // should never yield
          }
        })(),
      ).rejects.toThrow(/Duplicate proof secret/);
    });

    it('yields payloads until error completes the stream, then cancels', async () => {
      const proofs: Proof[] = [
        { amount: Amount.from(2), id: '00bd033559de27d0', secret: 's1', C: 'test' },
        { amount: Amount.from(2), id: '00bd033559de27d0', secret: 's2', C: 'test2' },
      ];
      const iter = events.proofStatesStream(proofs);

      const out: unknown[] = [];
      const consumer = (async () => {
        for await (const item of iter) out.push(item);
        return out;
      })();

      await flushMicrotasks(); // sub ready
      const ws = mock.mint.webSocketConnection!;
      const [y1, y2] = ws.firstFilters('proof_state');
      ws.emitProof({ Y: y1, state: 0 });
      ws.emitProof({ Y: y2, state: 1 });
      ws.fail('proof_state', new Error('done'));

      const collected = await consumer;
      expect(collected).toEqual([
        expect.objectContaining({ Y: y1, state: 0 }),
        expect.objectContaining({ Y: y2, state: 1 }),
      ]);

      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
    });

    it('aborts the stream and cancels subscription', async () => {
      const proofs: Proof[] = [
        { amount: Amount.from(2), id: '00bd033559de27d0', secret: 's1', C: 'test' },
      ];

      const ac = new AbortController();
      const iter = events.proofStatesStream(proofs, { signal: ac.signal });

      const consumed: unknown[] = [];
      const consumer = (async () => {
        for await (const x of iter) consumed.push(x);
        return consumed;
      })();

      await flushMicrotasks();
      const ws = mock.mint.webSocketConnection!;
      const [Y] = ws.firstFilters('proof_state');
      ws.emitProof({ Y, state: 0 });
      ac.abort();

      const result = await consumer;
      expect(result).toEqual([expect.objectContaining({ Y, state: 0 })]);

      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
    });

    it('buffers with maxBuffer, drops oldest by default, calls onDrop', async () => {
      const proofs: Proof[] = [{ amount: Amount.from(1), id: 'i', secret: 's', C: 'c' }];
      const dropped: any[] = [];
      const iter = events.proofStatesStream(proofs, {
        maxBuffer: 2,
        onDrop: (p) => dropped.push(p),
      });

      const out: any[] = [];
      const consumer = (async () => {
        for await (const x of iter) out.push(x);
        return out;
      })();

      await flushMicrotasks(); // sub ready
      const ws = mock.mint.webSocketConnection!;
      const [Y] = ws.firstFilters('proof_state');
      ws.emitProof({ Y, n: 1 });
      ws.emitProof({ Y, n: 2 });
      ws.emitProof({ Y, n: 3 }); // drop {n:1}
      ws.fail('proof_state', new Error('end'));

      const result = await consumer;
      expect(dropped).toEqual([expect.objectContaining({ n: 1 })]);
      expect(result).toEqual([
        expect.objectContaining({ n: 2 }),
        expect.objectContaining({ n: 3 }),
      ]);
    });

    it('drop:newest discards incoming payload and reports it via onDrop', async () => {
      const proofs: Proof[] = [{ amount: Amount.from(1), id: 'i', secret: 's', C: 'c' }];
      const dropped: any[] = [];
      const iter = events.proofStatesStream(proofs, {
        maxBuffer: 2,
        drop: 'newest',
        onDrop: (p) => dropped.push(p),
      });

      const out: any[] = [];
      const consumer = (async () => {
        for await (const x of iter) out.push(x);
        return out;
      })();

      await flushMicrotasks(); // sub ready
      const ws = mock.mint.webSocketConnection!;
      const [Y] = ws.firstFilters('proof_state');
      ws.emitProof({ Y, n: 1 });
      ws.emitProof({ Y, n: 2 });
      ws.emitProof({ Y, n: 3 }); // dropped
      ws.fail('proof_state', new Error('end'));

      const result = await consumer;
      expect(dropped).toEqual([expect.objectContaining({ n: 3 })]);
      expect(result).toEqual([
        expect.objectContaining({ n: 1 }),
        expect.objectContaining({ n: 2 }),
      ]);
    });

    it('onDrop exceptions are swallowed', async () => {
      const proofs: Proof[] = [{ amount: Amount.from(1), id: 'i', secret: 's', C: 'c' }];
      const iter = events.proofStatesStream(proofs, {
        maxBuffer: 1,
        onDrop: () => {
          throw new Error('ignore');
        },
      });

      const out: any[] = [];
      const consumer = (async () => {
        for await (const x of iter) out.push(x);
        return out;
      })();

      await flushMicrotasks(); // sub ready
      const ws = mock.mint.webSocketConnection!;
      const [Y] = ws.firstFilters('proof_state');
      ws.emitProof({ Y, n: 1 });
      ws.emitProof({ Y, n: 2 }); // drops n:1; onDrop throws (ignored)
      ws.fail('proof_state', new Error('end'));

      const result = await consumer;
      expect(result).toEqual([expect.objectContaining({ n: 2 })]);
    });
  });

  describe('group()', () => {
    it('collects multiple cancellers and cancels all safely (async-safe)', async () => {
      const g = events.group();

      const c1 = vi.fn();
      const c2 = vi.fn(() => {
        throw new Error('ignore me');
      });
      const c3 = Promise.resolve(vi.fn());

      void g.add(c1);
      void g.add(c2);
      void g.add(c3);

      g(); // invoke the composite canceller directly
      expect(g.cancelled).toBe(true);
      await flushMicrotasks();

      expect(c1).toHaveBeenCalled();
      expect(c2).toHaveBeenCalled();
      await expect(c3).resolves.toBeTypeOf('function');
      const inner = await c3;
      expect(inner).toHaveBeenCalled();

      const postCancel = vi.fn();
      void g.add(postCancel);
      await flushMicrotasks();
      expect(postCancel).toHaveBeenCalled();
    });

    it('group canceller is idempotent, only cancels once', async () => {
      const g = events.group();
      const c = vi.fn();
      void g.add(c);
      g();
      g(); // second call no-op
      await flushMicrotasks();
      expect(c).toHaveBeenCalledTimes(1);
    });

    it('group handles rejected Promise<SubscriptionCanceller> without throwing', async () => {
      const g = events.group();
      void g.add(Promise.reject(new Error('reject-me')));
      g();
      await flushMicrotasks();
      expect(g.cancelled).toBe(true);
    });

    it('adding after cancelled cancels immediately, even if canceller throws', async () => {
      const g = events.group();
      g();
      const throws = vi.fn(() => {
        throw new Error('boom');
      });
      void g.add(throws);
      await flushMicrotasks();
      expect(throws).toHaveBeenCalled();
    });

    it('group exposes .cancelled as enumerable', () => {
      const g = events.group();
      const keys = Object.keys(g);
      expect(keys).toContain('cancelled');
    });
  });

  describe('proofStatesStream immediate abort', () => {
    it('does not emit and cancels immediately when signal is already aborted', async () => {
      const proofs: Proof[] = [{ amount: Amount.from(1), id: 'z', secret: 's', C: 'c' }];
      const ac = new AbortController();
      ac.abort(); // aborted before creating the stream

      const iter = events.proofStatesStream(proofs, { signal: ac.signal });

      const out: unknown[] = [];
      for await (const x of iter) out.push(x);

      expect(out).toEqual([]);
      const ws = mock.mint.webSocketConnection!;
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
    });
  });

  describe("proofStatesStream drop:'newest' without onDrop", () => {
    it('drops the incoming payload and does not enqueue it (no onDrop provided)', async () => {
      const proofs: Proof[] = [{ amount: Amount.from(1), id: 'd', secret: 's', C: 'c' }];
      const iter = events.proofStatesStream(proofs, { maxBuffer: 1, drop: 'newest' });

      const out: any[] = [];
      const consumer = (async () => {
        for await (const x of iter) out.push(x);
        return out;
      })();

      await flushMicrotasks(); // sub ready
      const ws = mock.mint.webSocketConnection!;
      const [Y] = ws.firstFilters('proof_state');
      ws.emitProof({ Y, n: 1 }); // queued
      ws.emitProof({ Y, n: 2 }); // dropped
      ws.fail('proof_state', new Error('done'));

      const collected = await consumer;
      expect(collected).toEqual([expect.objectContaining({ n: 1 })]);
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
    });

    it('drops incoming payload silently when buffer full and no onDrop provided', async () => {
      const proofs: Proof[] = [{ amount: Amount.from(1), id: 'd', secret: 's', C: 'c' }];
      const iter = events.proofStatesStream(proofs, { maxBuffer: 1, drop: 'newest' });

      const out: any[] = [];
      const consumer = (async () => {
        for await (const x of iter) out.push(x);
        return out;
      })();

      // Ensure the subscription is installed before emitting
      await flushMicrotasks();

      const ws = mock.mint.webSocketConnection!;
      const enc = new TextEncoder();
      const Y = hashToCurve(enc.encode(proofs[0].secret)).toHex(true);

      ws.emitProof({ Y, n: 1 }); // queued
      ws.emitProof({ Y, n: 2 }); // silently dropped (newest)
      ws.emitProof({ Y, n: 3 }); // silently dropped (newest)
      ws.fail('proof_state', new Error('end'));

      const result = await consumer;
      expect(result).toEqual([{ Y, n: 1, proof: proofs[0] }]);
    });
  });

  describe('group() add after cancellation, rejected promise canceller', () => {
    it('immediately attempts to cancel and ignores rejection', async () => {
      const g = events.group();
      g(); // cancel first
      const rejected = Promise.reject(new Error('nope'));
      void g.add(rejected);
      await flushMicrotasks();
      expect(g.cancelled).toBe(true);
    });
  });

  describe('WalletEvents.countersReserved', () => {
    it('invokes handler with payload and supports unsubscribe', () => {
      const we = new WalletEvents({} as any);

      const payload: OperationCounters = { keysetId: 'K', start: 10, count: 3, next: 13 };
      let seen: OperationCounters | null = null;

      const cancel = we.countersReserved((p) => {
        // should not throw if handler throws later; we test that after
        seen = p;
      });

      (we as any)._emitCountersReserved(payload);
      expect(seen).toEqual(payload);

      // unsubscribe and ensure no further calls
      seen = null;
      cancel();
      (we as any)._emitCountersReserved(payload);
      expect(seen).toBeNull();
    });

    it('swallows handler errors (does not throw from _emitCountersReserved)', () => {
      const we = new WalletEvents({} as any);

      we.countersReserved(() => {
        throw new Error('boom');
      });

      expect(() =>
        (we as any)._emitCountersReserved({ keysetId: 'K', start: 0, count: 1 }),
      ).not.toThrow();
    });
  });

  // A wallet whose connectWebSocket resolves but never populates webSocketConnection.
  const makeNullWsWallet = () => ({
    mint: { connectWebSocket: vi.fn(async () => {}), webSocketConnection: undefined },
  });

  // A fully controllable mint WS: deliver a PAID to one quote id, or error one id in isolation.
  // setupFailIds makes createSubscription throw synchronously for those ids (setup rejection).
  const makeControllableWallet = (setupFailIds: string[] = []) => {
    const subs = new Map<
      number,
      { filters: string[]; cb: (p: any) => void; err: (e: any) => void }
    >();
    let nextId = 1;
    const createSubscription = vi.fn(
      (sub: { kind: string; filters: string[] }, cb: (p: any) => void, err: (e: any) => void) => {
        if (sub.filters.some((f) => setupFailIds.includes(f))) {
          throw new Error(`setup-failed:${sub.filters.join(',')}`);
        }
        const id = nextId++;
        subs.set(id, { filters: sub.filters, cb, err });
        return id;
      },
    );
    const cancelSubscription = vi.fn((id: number) => {
      subs.delete(id);
    });
    const ws = {
      createSubscription,
      cancelSubscription,
      emitPaid: (quote: string) => {
        for (const s of subs.values())
          if (s.filters.includes(quote)) s.cb({ quote, state: 'PAID' });
      },
      failFor: (quote: string, error: any) => {
        for (const s of subs.values()) if (s.filters.includes(quote)) s.err(error);
      },
    };
    const wallet = { mint: { connectWebSocket: vi.fn(async () => {}), webSocketConnection: ws } };
    return { wallet, ws };
  };

  describe('error normalization', () => {
    it('serializes circular error objects without throwing (keeps [Circular])', async () => {
      const p = events.onceMintPaid('circ');
      await flushMicrotasks();
      const ws = mock.mint.webSocketConnection!;
      const circular: any = { name: 'loop' };
      circular.self = circular;
      ws.fail('bolt11_mint_quote', circular);
      const err = (await p.catch((e) => e)) as Error;
      // Circular detection must produce a [Circular] marker, not the toString fallback.
      expect(err.message).toContain('[Circular]');
      expect(err.message).not.toBe('[object Object]');
    });

    it('serializes objects with null-valued properties as JSON null', async () => {
      const p = events.onceMintPaid('nullprop');
      await flushMicrotasks();
      const ws = mock.mint.webSocketConnection!;
      ws.fail('bolt11_mint_quote', { a: null, b: 2 });
      const err = (await p.catch((e) => e)) as Error;
      expect(err.message).toContain('"a":null');
      expect(err.message).not.toBe('[object Object]');
    });

    it('keeps string errors verbatim (no JSON quoting)', async () => {
      const p = events.onceMintPaid('strerr');
      await flushMicrotasks();
      const ws = mock.mint.webSocketConnection!;
      ws.fail('bolt11_mint_quote', 'plain-string-error');
      const err = (await p.catch((e) => e)) as Error;
      expect(err.message).toBe('plain-string-error');
    });

    it('attaches the original value as error cause', async () => {
      const p = events.onceMintPaid('causeerr');
      await flushMicrotasks();
      const ws = mock.mint.webSocketConnection!;
      const original = { code: 7, msg: 'z' };
      ws.fail('bolt11_mint_quote', original);
      const err = (await p.catch((e) => e)) as Error & { cause?: unknown };
      expect(err.cause).toEqual(original);
    });

    it('abort error carries name AbortError and message Aborted', async () => {
      const ac = new AbortController();
      const p = events.onceMintPaid('abmsg', { signal: ac.signal });
      ac.abort();
      await expect(p).rejects.toMatchObject({ name: 'AbortError', message: 'Aborted' });
    });
  });

  describe('withAbort wiring', () => {
    it('aborting the signal after subscribing cancels the subscription', async () => {
      const ac = new AbortController();
      await events.mintQuoteUpdates(['a'], vi.fn(), vi.fn(), { signal: ac.signal });
      const ws = mock.mint.webSocketConnection!;
      expect(ws.cancelSubscription).not.toHaveBeenCalled();
      ac.abort();
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
    });

    it('an already-aborted signal cancels the subscription immediately', async () => {
      const ac = new AbortController();
      ac.abort();
      await events.mintQuoteUpdates(['a'], vi.fn(), vi.fn(), { signal: ac.signal });
      const ws = mock.mint.webSocketConnection!;
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalled();
    });

    it('the returned canceller detaches the abort listener (no double cancel on later abort)', async () => {
      const ac = new AbortController();
      const cancel = await events.mintQuoteUpdates(['a'], vi.fn(), vi.fn(), { signal: ac.signal });
      const ws = mock.mint.webSocketConnection!;
      cancel();
      expect(ws.cancelSubscription).toHaveBeenCalledTimes(1);
      ac.abort();
      await flushMicrotasks();
      expect(ws.cancelSubscription).toHaveBeenCalledTimes(1);
    });
  });

  describe('null WebSocket connection', () => {
    it('mintQuoteUpdates throws a descriptive error when no WS is established', async () => {
      const ev = new WalletEvents(makeNullWsWallet() as any);
      await expect(ev.mintQuoteUpdates(['a'], vi.fn(), vi.fn())).rejects.toThrow(
        'Failed to establish WebSocket connection.',
      );
    });

    it('meltQuoteUpdates throws a descriptive error when no WS is established', async () => {
      const ev = new WalletEvents(makeNullWsWallet() as any);
      await expect(ev.meltQuoteUpdates(['a'], vi.fn(), vi.fn())).rejects.toThrow(
        'Failed to establish WebSocket connection.',
      );
    });

    it('proofStateUpdates throws a descriptive error when no WS is established', async () => {
      const ev = new WalletEvents(makeNullWsWallet() as any);
      const proofs: Proof[] = [
        { amount: Amount.from(1), id: '00bd033559de27d0', secret: 's', C: 'c' },
      ];
      await expect(ev.proofStateUpdates(proofs, vi.fn(), vi.fn())).rejects.toThrow(
        'Failed to establish WebSocket connection.',
      );
    });

    it('onceMintPaid rejects (does not hang) when subscription setup fails', async () => {
      const ev = new WalletEvents(makeNullWsWallet() as any);
      await expect(ev.onceMintPaid('q')).rejects.toThrow(
        'Failed to establish WebSocket connection.',
      );
    });
  });

  describe('waitUntilPaid timeout handling', () => {
    it('does not arm a timeout when timeoutMs is non-positive', async () => {
      vi.useFakeTimers();
      const p = events.onceMintPaid('neg', { timeoutMs: -1 });
      await flushMicrotasks();
      vi.advanceTimersByTime(50);
      const ws = mock.mint.webSocketConnection!;
      ws.emit('bolt11_mint_quote', { quote: 'neg', state: 'PAID' });
      await expect(p).resolves.toMatchObject({ quote: 'neg' });
      vi.useRealTimers();
    });

    it('clears the timeout timer on resolution', async () => {
      vi.useFakeTimers();
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      const p = events.onceMintPaid('ct', { timeoutMs: 10000 });
      await flushMicrotasks();
      const ws = mock.mint.webSocketConnection!;
      ws.emit('bolt11_mint_quote', { quote: 'ct', state: 'PAID' });
      await p;
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
      vi.useRealTimers();
    });

    it('does not call clearTimeout when no timeout was armed', async () => {
      vi.useFakeTimers();
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      const p = events.onceMintPaid('noct');
      await flushMicrotasks();
      const ws = mock.mint.webSocketConnection!;
      ws.emit('bolt11_mint_quote', { quote: 'noct', state: 'PAID' });
      await p;
      expect(clearSpy).not.toHaveBeenCalled();
      clearSpy.mockRestore();
      vi.useRealTimers();
    });

    it('removes the abort listener (by name) on resolution', async () => {
      const ac = new AbortController();
      const rmSpy = vi.spyOn(ac.signal, 'removeEventListener');
      const p = events.onceMintPaid('rmabort', { signal: ac.signal });
      await flushMicrotasks();
      const ws = mock.mint.webSocketConnection!;
      ws.emit('bolt11_mint_quote', { quote: 'rmabort', state: 'PAID' });
      await p;
      expect(rmSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('a pre-aborted signal rejects before any subscription is attempted', async () => {
      const ac = new AbortController();
      ac.abort();
      const p = events.onceMintPaid('preab', { signal: ac.signal });
      await flushMicrotasks();
      expect(mock.mint.connectWebSocket).not.toHaveBeenCalled();
      await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('cleans up exactly once (a late error after resolution does not re-cancel)', async () => {
      const p = events.onceMintPaid('once');
      await flushMicrotasks();
      const ws = mock.mint.webSocketConnection!;
      ws.emit('bolt11_mint_quote', { quote: 'once', state: 'PAID' });
      ws.fail('bolt11_mint_quote', new Error('late'));
      await p;
      await flushMicrotasks(4);
      expect(ws.cancelSubscription).toHaveBeenCalledTimes(1);
    });
  });

  describe('onceAnyMintPaid resource handling', () => {
    it('does not arm a timeout when timeoutMs is non-positive', async () => {
      vi.useFakeTimers();
      const { wallet, ws } = makeControllableWallet();
      const ev = new WalletEvents(wallet as any);
      const p = ev.onceAnyMintPaid(['a'], { timeoutMs: -1 });
      await flushMicrotasks(4);
      vi.advanceTimersByTime(50);
      ws.emitPaid('a');
      await expect(p).resolves.toMatchObject({ id: 'a' });
      vi.useRealTimers();
    });

    it('clears the timeout timer on resolution', async () => {
      vi.useFakeTimers();
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      const { wallet, ws } = makeControllableWallet();
      const ev = new WalletEvents(wallet as any);
      const p = ev.onceAnyMintPaid(['a'], { timeoutMs: 10000 });
      await flushMicrotasks(4);
      ws.emitPaid('a');
      await p;
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
      vi.useRealTimers();
    });

    it('does not call clearTimeout when no timeout was armed', async () => {
      vi.useFakeTimers();
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      const { wallet, ws } = makeControllableWallet();
      const ev = new WalletEvents(wallet as any);
      const p = ev.onceAnyMintPaid(['a']);
      await flushMicrotasks(4);
      ws.emitPaid('a');
      await p;
      expect(clearSpy).not.toHaveBeenCalled();
      clearSpy.mockRestore();
      vi.useRealTimers();
    });

    it('removes the abort listener (by name) on resolution', async () => {
      const ac = new AbortController();
      const rmSpy = vi.spyOn(ac.signal, 'removeEventListener');
      const { wallet, ws } = makeControllableWallet();
      const ev = new WalletEvents(wallet as any);
      const p = ev.onceAnyMintPaid(['a', 'b'], { signal: ac.signal });
      await flushMicrotasks(4);
      ws.emitPaid('a');
      await expect(p).resolves.toMatchObject({ id: 'a' });
      expect(rmSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('a pre-aborted signal rejects before any subscription is attempted', async () => {
      const ac = new AbortController();
      ac.abort();
      const { wallet } = makeControllableWallet();
      const ev = new WalletEvents(wallet as any);
      const p = ev.onceAnyMintPaid(['a', 'b'], { signal: ac.signal });
      await flushMicrotasks();
      expect(wallet.mint.connectWebSocket).not.toHaveBeenCalled();
      await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  describe('onceAnyMintPaid error semantics', () => {
    it('by default ignores a single erroring stream and still resolves on another PAID', async () => {
      const { wallet, ws } = makeControllableWallet();
      const ev = new WalletEvents(wallet as any);
      const p = ev.onceAnyMintPaid(['a', 'b']);
      await flushMicrotasks(4);
      ws.failFor('a', new Error('a-err'));
      ws.emitPaid('b');
      await expect(p).resolves.toMatchObject({ id: 'b' });
    });

    it('failOnError rejects on the first stream error even if another could pay', async () => {
      const { wallet, ws } = makeControllableWallet();
      const ev = new WalletEvents(wallet as any);
      const p = ev.onceAnyMintPaid(['a', 'b'], { failOnError: true });
      await flushMicrotasks(4);
      ws.failFor('a', new Error('a-err'));
      ws.emitPaid('b');
      await expect(p).rejects.toThrow('a-err');
    });

    it('rejects with a descriptive error when every stream errors (undefined reasons)', async () => {
      const { wallet, ws } = makeControllableWallet();
      const ev = new WalletEvents(wallet as any);
      const p = ev.onceAnyMintPaid(['a', 'b']);
      await flushMicrotasks(4);
      ws.failFor('a', undefined);
      ws.failFor('b', undefined);
      await expect(p).rejects.toThrow('No subscriptions remaining');
    });

    it('by default tolerates a setup failure on one id and resolves when another pays', async () => {
      const { wallet, ws } = makeControllableWallet(['boom']);
      const ev = new WalletEvents(wallet as any);
      const p = ev.onceAnyMintPaid(['boom', 'ok']);
      await flushMicrotasks(4);
      ws.emitPaid('ok');
      await expect(p).resolves.toMatchObject({ id: 'ok' });
    });

    it('rejects with the last setup error when every subscription fails to register', async () => {
      const { wallet } = makeControllableWallet(['x', 'y']);
      const ev = new WalletEvents(wallet as any);
      const p = ev.onceAnyMintPaid(['x', 'y']);
      await expect(p).rejects.toThrow(/setup-failed/);
    });

    it('failOnError rejects immediately on a setup failure, ignoring a pending payer', async () => {
      const { wallet, ws } = makeControllableWallet(['boom']);
      const ev = new WalletEvents(wallet as any);
      const p = ev.onceAnyMintPaid(['boom', 'ok'], { failOnError: true });
      await flushMicrotasks(4);
      ws.emitPaid('ok');
      await expect(p).rejects.toThrow(/setup-failed/);
    });
  });

  describe('proofStatesStream buffering edges', () => {
    it('treats a non-positive maxBuffer as unbounded', async () => {
      const proofs: Proof[] = [{ amount: Amount.from(1), id: 'i', secret: 's', C: 'c' }];
      const dropped: any[] = [];
      const ac = new AbortController();
      const iter = events.proofStatesStream(proofs, {
        maxBuffer: -1,
        signal: ac.signal,
        onDrop: (d) => dropped.push(d),
      });
      const out: any[] = [];
      const consumer = (async () => {
        for await (const x of iter) out.push(x);
        return out;
      })();

      await flushMicrotasks();
      const ws = mock.mint.webSocketConnection!;
      const [Y] = ws.firstFilters('proof_state');
      ws.emitProof({ Y, n: 1 });
      ws.emitProof({ Y, n: 2 });
      ac.abort();

      const result = await consumer;
      expect(dropped).toEqual([]);
      expect(result).toEqual([
        expect.objectContaining({ n: 1 }),
        expect.objectContaining({ n: 2 }),
      ]);
    });

    it("drop:'newest' keeps the buffered head, not the tail", async () => {
      const proofs: Proof[] = [{ amount: Amount.from(1), id: 'i', secret: 's', C: 'c' }];
      const dropped: any[] = [];
      const ac = new AbortController();
      const iter = events.proofStatesStream(proofs, {
        maxBuffer: 2,
        drop: 'newest',
        signal: ac.signal,
        onDrop: (d) => dropped.push(d),
      });
      const out: any[] = [];
      const consumer = (async () => {
        for await (const x of iter) out.push(x);
        return out;
      })();

      await flushMicrotasks();
      const ws = mock.mint.webSocketConnection!;
      const [Y] = ws.firstFilters('proof_state');
      ws.emitProof({ Y, n: 1 });
      ws.emitProof({ Y, n: 2 });
      ws.emitProof({ Y, n: 3 });
      ac.abort();

      const result = await consumer;
      expect(dropped).toEqual([expect.objectContaining({ n: 3 })]);
      expect(result).toEqual([
        expect.objectContaining({ n: 1 }),
        expect.objectContaining({ n: 2 }),
      ]);
    });

    it('removes the abort listener (by name) when the stream completes', async () => {
      const proofs: Proof[] = [{ amount: Amount.from(1), id: 'i', secret: 's', C: 'c' }];
      const ac = new AbortController();
      const rmSpy = vi.spyOn(ac.signal, 'removeEventListener');
      const iter = events.proofStatesStream(proofs, { signal: ac.signal });
      const consumer = (async () => {
        for await (const _ of iter) break;
      })();

      await flushMicrotasks();
      const ws = mock.mint.webSocketConnection!;
      const [Y] = ws.firstFilters('proof_state');
      ws.emitProof({ Y, state: 0 });
      await consumer;
      await flushMicrotasks();
      expect(rmSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });
  });

  describe('group() lifecycle', () => {
    it('a fresh group is not cancelled', () => {
      const g = events.group();
      expect(g.cancelled).toBe(false);
    });

    it('added cancellers are held until the group is invoked', async () => {
      const g = events.group();
      const c = vi.fn();
      void g.add(c);
      await flushMicrotasks();
      expect(c).not.toHaveBeenCalled();
      g();
      await flushMicrotasks();
      expect(c).toHaveBeenCalledTimes(1);
    });
  });

  describe('waitUntilPaid default timeout message', () => {
    // The public onceMint/MeltPaid wrappers always pass a message, so the internal default is only
    // reachable directly. Assert the fallback text used when a caller omits it.
    it('rejects with the built-in default message when no timeoutMsg is given', async () => {
      vi.useFakeTimers();
      const subscribeFn = () => Promise.resolve(() => {}); // never resolves the paid callback
      const p = (events as any).waitUntilPaid(subscribeFn, 'id', { timeoutMs: 5 });
      await flushMicrotasks();
      vi.advanceTimersByTime(6);
      await expect(p).rejects.toThrow('Timeout waiting for paid');
      vi.useRealTimers();
    });
  });

  describe('onceAnyMintPaid all-setup-fail fallback', () => {
    // Every subscription rejects with no error value, so lastError stays nullish and the descriptive
    // fallback message must surface instead of an undefined rejection.
    it('rejects with "No subscriptions remaining" when all setups fail without an error', async () => {
      // connectWebSocket rejects with a nullish reason, so each subscription setup rejects with no
      // usable error and lastError stays nullish.
      const wallet = {
        mint: {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- nullish reason is the case under test
          connectWebSocket: vi.fn(() => Promise.reject(undefined)),
          webSocketConnection: undefined,
        },
      };
      const ev = new WalletEvents(wallet as any);
      await expect(ev.onceAnyMintPaid(['a', 'b'])).rejects.toThrow('No subscriptions remaining');
    });
  });

  describe('countersReserved error logging', () => {
    // A throwing handler is swallowed, but the failure must be logged with the event name so callers
    // can tell which hook failed.
    it('logs the failure with the countersReserved event tag when a handler throws', () => {
      const logger = {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        log: vi.fn(),
      };
      const we = new WalletEvents({ logger } as any);
      we.countersReserved(() => {
        throw new Error('boom');
      });

      (we as any)._emitCountersReserved({ keysetId: 'K', start: 0, count: 1, next: 1 });

      expect(logger.warn).toHaveBeenCalledWith(
        'callback failed',
        expect.objectContaining({ event: 'countersReserved' }),
      );
    });
  });
});
