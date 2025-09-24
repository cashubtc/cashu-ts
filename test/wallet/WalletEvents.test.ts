import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WalletEvents } from '../../src/wallet/WalletEvents';
import { Proof } from '../../src/model/types';

// Light, behaviour-first shims
type MintQuoteResponse = any;
type MeltQuoteResponse = any;
type SubscriptionCanceller = () => void;

// Helper: flush microtasks (needed because cancelSafely runs them async)
const flushMicrotasks = async (n = 2) => {
	for (let i = 0; i < n; i++) await Promise.resolve();
};

// A controllable mock for the Wallet surface WalletEvents needs
class MockWallet {
	public mintPaidHandlers = new Map<
		string,
		{
			cb: (p: MintQuoteResponse) => void;
			err: (e: Error) => void;
			cancelInner: ReturnType<typeof vi.fn>;
		}
	>();

	public meltPaidHandlers = new Map<
		string,
		{
			cb: (p: MeltQuoteResponse) => void;
			err: (e: Error) => void;
			cancelInner: ReturnType<typeof vi.fn>;
		}
	>();

	public mintUpdatesHandlers = new Map<
		string,
		{
			cb: (p: MintQuoteResponse) => void;
			err: (e: Error) => void;
			cancelInner: ReturnType<typeof vi.fn>;
		}
	>();

	public meltUpdatesHandlers = new Map<
		string,
		{
			cb: (p: MeltQuoteResponse) => void;
			err: (e: Error) => void;
			cancelInner: ReturnType<typeof vi.fn>;
		}
	>();

	public proofStateHandlers:
		| {
				proofs: Proof[];
				cb: (payload: unknown) => void;
				err: (e: Error) => void;
				cancelInner: ReturnType<typeof vi.fn>;
		  }
		| undefined;

	// Returns a *wrapper* canceller that forwards to a spy-able inner fn
	private makeWrappedCanceller() {
		const cancelInner = vi.fn();
		const canceller: SubscriptionCanceller = () => cancelInner();
		return { canceller, cancelInner };
	}

	async onMintQuotePaid(
		quoteId: string,
		cb: (payload: MintQuoteResponse) => void,
		err: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		const { canceller, cancelInner } = this.makeWrappedCanceller();
		this.mintPaidHandlers.set(quoteId, { cb, err, cancelInner });
		return canceller;
	}

	async onMintQuoteUpdates(
		quoteIds: string[],
		cb: (payload: MintQuoteResponse) => void,
		err: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		const inners: ReturnType<typeof vi.fn>[] = [];
		quoteIds.forEach((id) => {
			const { cancelInner } = this.makeWrappedCanceller();
			this.mintUpdatesHandlers.set(id, { cb, err, cancelInner });
			inners.push(cancelInner);
			// Return canceller per-id via outer group canceller:
		});
		return () => inners.forEach((fn) => fn());
	}

	async onMeltQuotePaid(
		quoteId: string,
		cb: (payload: MeltQuoteResponse) => void,
		err: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		const { canceller, cancelInner } = this.makeWrappedCanceller();
		this.meltPaidHandlers.set(quoteId, { cb, err, cancelInner });
		return canceller;
	}

	async onMeltQuoteUpdates(
		quoteIds: string[],
		cb: (payload: MeltQuoteResponse) => void,
		err: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		const inners: ReturnType<typeof vi.fn>[] = [];
		quoteIds.forEach((id) => {
			const { cancelInner } = this.makeWrappedCanceller();
			this.meltUpdatesHandlers.set(id, { cb, err, cancelInner });
			inners.push(cancelInner);
		});
		return () => inners.forEach((fn) => fn());
	}

	async onProofStateUpdates(
		proofs: Proof[],
		cb: (payload: unknown) => void,
		err: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		const { canceller, cancelInner } = this.makeWrappedCanceller();
		this.proofStateHandlers = { proofs, cb, err, cancelInner };
		return canceller;
	}
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

	describe('passthroughs', () => {
		it('mintQuotes passthrough', async () => {
			const cb = vi.fn();
			const err = vi.fn();
			const canceller = await events.mintQuotes(['a', 'b'], cb, err);
			mock.mintUpdatesHandlers.get('a')!.cb({ quote: 'a', state: 'PAID' });
			expect(cb).toHaveBeenCalledWith(expect.objectContaining({ quote: 'a' }));
			expect(typeof canceller).toBe('function');
		});

		it('mintPaid passthrough', async () => {
			const cb = vi.fn();
			const err = vi.fn();
			await events.mintPaid('x', cb, err);
			mock.mintPaidHandlers.get('x')!.cb({ quote: 'x', state: 'PAID' });
			expect(cb).toHaveBeenCalledWith(expect.objectContaining({ quote: 'x' }));
		});

		it('meltUpdates passthrough', async () => {
			const cb = vi.fn();
			const err = vi.fn();
			await events.meltUpdates(['m1'], cb, err);
			mock.meltUpdatesHandlers.get('m1')!.cb({ quote: 'm1', state: 'PAID' });
			expect(cb).toHaveBeenCalledWith(expect.objectContaining({ quote: 'm1' }));
		});

		it('meltPaid passthrough', async () => {
			const cb = vi.fn();
			const err = vi.fn();
			await events.meltPaid('m2', cb, err);
			mock.meltPaidHandlers.get('m2')!.cb({ quote: 'm2', state: 'PAID' });
			expect(cb).toHaveBeenCalledWith(expect.objectContaining({ quote: 'm2' }));
		});

		it('proofStates passthrough', async () => {
			const cb = vi.fn();
			const err = vi.fn();
			const proofs: Proof[] = [{ amount: 2, id: '00bd033559de27d0', secret: 's1', C: 'test' }];
			await events.proofStates(proofs, cb, err);
			mock.proofStateHandlers!.cb({ Y: 'fake', state: 0 });
			expect(cb).toHaveBeenCalledWith({ Y: 'fake', state: 0 });
		});
	});

	describe('onceMintPaid', () => {
		it('resolves on PAID and unsubscribes (async canceller)', async () => {
			const callSpy = vi.spyOn(mock, 'onMintQuotePaid');
			const p = events.onceMintPaid('q1');
			const h = mock.mintPaidHandlers.get('q1')!;
			// simulate paid
			h.cb({ quote: 'q1', state: 'PAID', amount: 123 });
			const res = await p;
			expect(res).toMatchObject({ quote: 'q1', amount: 123 });
			expect(callSpy).toHaveBeenCalled();
			// give cancelSafely time to call the inner canceller
			await flushMicrotasks();
			expect(h.cancelInner).toHaveBeenCalled();
		});

		it('rejects with AbortError', async () => {
			const ac = new AbortController();
			const p = events.onceMintPaid('q2', { signal: ac.signal });
			ac.abort();
			await expect(p).rejects.toMatchObject({ name: 'AbortError' });
			const h = mock.mintPaidHandlers.get('q2');
			if (h) {
				await flushMicrotasks();
				expect(h.cancelInner).toHaveBeenCalled();
			}
		});

		it('rejects on timeout and unsubscribes', async () => {
			vi.useFakeTimers();
			const p = events.onceMintPaid('q3', { timeoutMs: 10 });
			vi.advanceTimersByTime(11);
			await expect(p).rejects.toThrow(/Timeout waiting for mint paid/);
			const h = mock.mintPaidHandlers.get('q3')!;
			await flushMicrotasks();
			expect(h.cancelInner).toHaveBeenCalled();
			vi.useRealTimers();
		});

		it('propagates underlying error and unsubscribes', async () => {
			const p = events.onceMintPaid('q4');
			const h = mock.mintPaidHandlers.get('q4')!;
			h.err(new Error('boom'));
			await expect(p).rejects.toThrow('boom');
			await flushMicrotasks();
			expect(h.cancelInner).toHaveBeenCalled();
		});
	});

	describe('onceAnyMintPaid', () => {
		it('resolves when the first is PAID and cancels the rest', async () => {
			const p = events.onceAnyMintPaid(['a', 'b', 'c']);
			const ha = mock.mintPaidHandlers.get('a')!;
			const hb = mock.mintPaidHandlers.get('b')!;
			const hc = mock.mintPaidHandlers.get('c')!;
			// b wins
			hb.cb({ quote: 'b', state: 'PAID', amount: 42 });
			const res = await p;
			expect(res).toMatchObject({ id: 'b', quote: expect.objectContaining({ amount: 42 }) });
			await flushMicrotasks();
			expect(ha.cancelInner).toHaveBeenCalled();
			expect(hb.cancelInner).toHaveBeenCalled();
			expect(hc.cancelInner).toHaveBeenCalled();
		});

		it('honours AbortSignal', async () => {
			const ac = new AbortController();
			const p = events.onceAnyMintPaid(['x', 'y'], { signal: ac.signal });
			ac.abort();
			await expect(p).rejects.toMatchObject({ name: 'AbortError' });
			// optional: if subscription happened before abort, canceller is called
			const hx = mock.mintPaidHandlers.get('x');
			const hy = mock.mintPaidHandlers.get('y');
			await flushMicrotasks();
			if (hx) expect(hx.cancelInner).toHaveBeenCalled();
			if (hy) expect(hy.cancelInner).toHaveBeenCalled();
		});

		it('times out if none paid', async () => {
			vi.useFakeTimers();
			const p = events.onceAnyMintPaid(['x1', 'x2'], { timeoutMs: 5 });
			vi.advanceTimersByTime(6);
			await expect(p).rejects.toThrow(/Timeout waiting for any mint paid/);
			await flushMicrotasks();
			const h1 = mock.mintPaidHandlers.get('x1')!;
			const h2 = mock.mintPaidHandlers.get('x2')!;
			expect(h1.cancelInner).toHaveBeenCalled();
			expect(h2.cancelInner).toHaveBeenCalled();
			vi.useRealTimers();
		});

		it('rejects when ids is empty', async () => {
			await expect(events.onceAnyMintPaid([])).rejects.toThrow(/No quote ids provided/);
		});

		it('failOnError=true rejects on first error and cancels the rest', async () => {
			const p = events.onceAnyMintPaid(['f1', 'f2', 'f3'], { failOnError: true });
			const h1 = mock.mintPaidHandlers.get('f1')!;
			const h2 = mock.mintPaidHandlers.get('f2')!;
			const h3 = mock.mintPaidHandlers.get('f3')!;
			h2.err(new Error('bad'));
			await expect(p).rejects.toThrow(/bad/);
			await flushMicrotasks();
			expect(h1.cancelInner).toHaveBeenCalled();
			expect(h2.cancelInner).toHaveBeenCalled();
			expect(h3.cancelInner).toHaveBeenCalled();
		});

		it('dedupes ids, resolves on first unique winner', async () => {
			const p = events.onceAnyMintPaid(['dup', 'dup', 'other']);
			const hd = mock.mintPaidHandlers.get('dup')!;
			hd.cb({ quote: 'dup', state: 'PAID' });
			const res = await p;
			expect(res.id).toBe('dup');
			expect(mock.mintPaidHandlers.size).toBe(2); // dup + other
		});

		it('normalizes non-Error objects when all subs error after registration', async () => {
			const p = events.onceAnyMintPaid(['e1', 'e2']);
			const h1 = mock.mintPaidHandlers.get('e1')!;
			const h2 = mock.mintPaidHandlers.get('e2')!;
			h1.err({ code: 1, msg: 'x' } as any);
			h2.err({ code: 2, msg: 'y' } as any);
			await expect(p).rejects.toThrow(/"code":\s*2/); // last object stringified
		});

		it('safeStringify fallback path via object containing BigInt', async () => {
			const p = events.onceMintPaid('bigobj');
			const h = mock.mintPaidHandlers.get('bigobj')!;
			// Trigger error with a non-Error object that contains a BigInt => JSON.stringify throws
			h.err({ n: 10n } as any);
			// normalizeError uses safeStringify, which falls back to Object.prototype.toString => "[object Object]"
			await expect(p).rejects.toThrow(/\[object Object\]/);
		});

		it('primitive BigInt errors normalize to "Unknown error"', async () => {
			const p = events.onceMintPaid('big-prim');
			const h = mock.mintPaidHandlers.get('big-prim')!;
			// @ts-expect-error deliberate primitive BigInt
			h.err(10n);
			await expect(p).rejects.toThrow(/Unknown error/);
		});
	});

	describe('onceMeltPaid', () => {
		it('resolves when melt is PAID and auto-unsubscribes', async () => {
			const p = events.onceMeltPaid('m1');
			const h = mock.meltPaidHandlers.get('m1')!;
			h.cb({ quote: 'm1', state: 'PAID', amount: 7 });
			const res = await p;
			expect(res).toMatchObject({ quote: 'm1', amount: 7 });
			await flushMicrotasks();
			expect(h.cancelInner).toHaveBeenCalled();
		});
	});

	describe('onceMeltPaid extra branches', () => {
  it('rejects with AbortError and unsubscribes', async () => {
    const ac = new AbortController();
    // spy on cleanup path (removeEventListener is part of coverage gap)
    const rmSpy = vi.spyOn(ac.signal, 'removeEventListener');
    const p = events.onceMeltPaid('m-abort', { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });

    const h = mock.meltPaidHandlers.get('m-abort');
    if (h) {
      await flushMicrotasks();
      expect(h.cancelInner).toHaveBeenCalled();
    }
    expect(rmSpy).toHaveBeenCalled(); // covers removeEventListener line
  });

  it('rejects on timeout and unsubscribes', async () => {
    vi.useFakeTimers();
    const p = events.onceMeltPaid('m-timeout', { timeoutMs: 10 });
    vi.advanceTimersByTime(11);
    await expect(p).rejects.toThrow(/Timeout waiting for melt paid/);
    const h = mock.meltPaidHandlers.get('m-timeout')!;
    await flushMicrotasks();
    expect(h.cancelInner).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('propagates underlying error and unsubscribes', async () => {
    const p = events.onceMeltPaid('m-error');
    const h = mock.meltPaidHandlers.get('m-error')!;
    h.err(new Error('melt-boom'));
    await expect(p).rejects.toThrow('melt-boom');
    await flushMicrotasks();
    expect(h.cancelInner).toHaveBeenCalled();
  });

  it('resolves and removes listener when a signal was provided', async () => {
    const ac = new AbortController();
    const rmSpy = vi.spyOn(ac.signal, 'removeEventListener');
    const p = events.onceMeltPaid('m-ok', { signal: ac.signal });
    const h = mock.meltPaidHandlers.get('m-ok')!;
    h.cb({ quote: 'm-ok', state: 'PAID', amount: 1 });
    await expect(p).resolves.toMatchObject({ quote: 'm-ok' });
    await flushMicrotasks();
    expect(h.cancelInner).toHaveBeenCalled();
    expect(rmSpy).toHaveBeenCalled(); // exercises the success-path cleanup too
  });
});


	describe('proofStatesStream', () => {
		it('yields payloads until error completes the stream, then cancels', async () => {
			const proofs: Proof[] = [
				{ amount: 2, id: '00bd033559de27d0', secret: 's1', C: 'test' },
				{ amount: 2, id: '00bd033559de27d0', secret: 's2', C: 'test2' },
			];
			const iter = events.proofStatesStream(proofs);

			// Start consumption to ensure subscription is created
			const out: unknown[] = [];
			const consumer = (async () => {
				for await (const item of iter) out.push(item);
				return out;
			})();

			// Now we can push updates
			const h = mock.proofStateHandlers!;
			h.cb({ Y: 'y1', state: 0 });
			h.cb({ Y: 'y2', state: 1 });

			// End the stream via error handler (WalletEvents treats err as done)
			h.err(new Error('done'));

			const collected = await consumer;
			expect(collected).toEqual([
				{ Y: 'y1', state: 0 },
				{ Y: 'y2', state: 1 },
			]);

			await flushMicrotasks();
			expect(h.cancelInner).toHaveBeenCalled();
		});

		it('aborts the stream and cancels subscription', async () => {
			const proofs: Proof[] = [{ amount: 2, id: '00bd033559de27d0', secret: 's1', C: 'test' }];

			const ac = new AbortController();
			const iter = events.proofStatesStream(proofs, { signal: ac.signal });

			const hPromise = (async () => {
				// Ensure generator starts, so subscription is created
				const it = iter[Symbol.asyncIterator]();
				// kick it off, will await internally
				return {
					it,
					get handler() {
						return mock.proofStateHandlers!;
					},
				};
			})();

			// Start a consumer
			const consumed: unknown[] = [];
			const consumer = (async () => {
				for await (const x of iter) consumed.push(x);
				return consumed;
			})();

			// Wait a tick so subscription exists
			await flushMicrotasks();
			const h = mock.proofStateHandlers!;

			// Push one payload, then abort
			h.cb({ Y: 'y1', state: 0 });
			ac.abort();

			const result = await consumer;
			expect(result).toEqual([{ Y: 'y1', state: 0 }]);

			await flushMicrotasks();
			expect(h.cancelInner).toHaveBeenCalled();
			void hPromise; // silence unused
		});
		it('buffers with maxBuffer, drops oldest by default, calls onDrop', async () => {
			const proofs: Proof[] = [{ amount: 1, id: 'i', secret: 's', C: 'c' }];
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

			const h = mock.proofStateHandlers!;
			h.cb({ n: 1 });
			h.cb({ n: 2 });
			h.cb({ n: 3 }); // triggers drop of {n:1}
			h.err(new Error('end'));

			const result = await consumer;
			expect(dropped).toEqual([{ n: 1 }]);
			expect(result).toEqual([{ n: 2 }, { n: 3 }]);
		});

		it('drop:newest discards incoming payload and reports it via onDrop', async () => {
			const proofs: Proof[] = [{ amount: 1, id: 'i', secret: 's', C: 'c' }];
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

			const h = mock.proofStateHandlers!;
			h.cb({ n: 1 });
			h.cb({ n: 2 });
			h.cb({ n: 3 }); // dropped (incoming)
			h.err(new Error('end'));

			const result = await consumer;
			expect(dropped).toEqual([{ n: 3 }]);
			expect(result).toEqual([{ n: 1 }, { n: 2 }]);
		});

		it('onDrop exceptions are swallowed', async () => {
			const proofs: Proof[] = [{ amount: 1, id: 'i', secret: 's', C: 'c' }];
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

			const h = mock.proofStateHandlers!;
			h.cb({ n: 1 });
			h.cb({ n: 2 }); // drops n:1 and onDrop throws, but ignored
			h.err(new Error('end'));

			const result = await consumer;
			expect(result).toEqual([{ n: 2 }]);
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

			g.add(c1);
			g.add(c2);
			g.add(c3);

			g(); // invoke the composite canceller directly
			expect(g.cancelled).toBe(true);
			// cancelSafely runs in a microtask
			await flushMicrotasks();

			expect(c1).toHaveBeenCalled();
			expect(c2).toHaveBeenCalled();
			await expect(c3).resolves.toBeTypeOf('function');
			// The inner resolved function should also have been called
			const inner = await c3;
			expect(inner).toHaveBeenCalled();

			// Adding after cancellation should cancel immediately (no-op on future use)
			const postCancel = vi.fn();
			g.add(postCancel);
			await flushMicrotasks();
			expect(postCancel).toHaveBeenCalled();
		});

		it('group canceller is idempotent, only cancels once', async () => {
			const g = events.group();
			const c = vi.fn();
			g.add(c);
			g();
			g(); // second call no-op
			await flushMicrotasks();
			expect(c).toHaveBeenCalledTimes(1);
		});

		it('group handles rejected Promise<SubscriptionCanceller> without throwing', async () => {
			const g = events.group();
			g.add(Promise.reject(new Error('reject-me')));
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
			g.add(throws);
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
			const proofs: Proof[] = [{ amount: 1, id: 'z', secret: 's', C: 'c' }];
			const ac = new AbortController();
			ac.abort(); // aborted before creating the stream

			const iter = events.proofStatesStream(proofs, { signal: ac.signal });

			const out: unknown[] = [];
			for await (const x of iter) out.push(x);

			// stream ended synchronously, nothing yielded
			expect(out).toEqual([]);

			// subscription was created but then immediately cancelled
			expect(mock.proofStateHandlers).toBeDefined();
			await flushMicrotasks();
			expect(mock.proofStateHandlers!.cancelInner).toHaveBeenCalled();
		});
	});

	describe("proofStatesStream drop:'newest' without onDrop", () => {
		it('drops the incoming payload and does not enqueue it (no onDrop provided)', async () => {
			const proofs: Proof[] = [{ amount: 1, id: 'd', secret: 's', C: 'c' }];
			// maxBuffer=1, so second push should be dropped (newest) without a callback
			const iter = events.proofStatesStream(proofs, { maxBuffer: 1, drop: 'newest' });

			const out: any[] = [];
			const consumer = (async () => {
				for await (const x of iter) out.push(x);
				return out;
			})();

			const h = mock.proofStateHandlers!;
			h.cb({ n: 1 }); // queued
			h.cb({ n: 2 }); // should be dropped immediately (no onDrop)
			h.err(new Error('done'));

			const collected = await consumer;
			expect(collected).toEqual([{ n: 1 }]); // n:2 did not appear
			await flushMicrotasks();
			expect(h.cancelInner).toHaveBeenCalled();
		});
	});

	describe('group() add after cancellation, rejected promise canceller', () => {
		it('immediately attempts to cancel and ignores rejection', async () => {
			const g = events.group();
			g(); // cancel first

			// Add a promised canceller that rejects; cancelSafely should await and swallow it
			const rejected = Promise.reject(new Error('nope'));
			g.add(rejected);

			// Let microtasks flush (cancelSafely runs async)
			await flushMicrotasks();
			expect(g.cancelled).toBe(true);
			// nothing to assert beyond "no throw" and branch execution, coverage will tick these lines
		});
	});
});
