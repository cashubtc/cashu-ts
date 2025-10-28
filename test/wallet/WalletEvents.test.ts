import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WalletEvents } from '../../src/wallet/WalletEvents';
import type { Proof } from '../../src/model/types';
import { hashToCurve } from '../../src/crypto';
import { OperationCounters } from '../../src/wallet';

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
			const proofs: Proof[] = [{ amount: 2, id: '00bd033559de27d0', secret: 's1', C: 'test' }];
			await events.proofStateUpdates(proofs, cb, err);

			const ws = mock.mint.webSocketConnection!;
			const [Y] = ws.firstFilters('proof_state'); // use the Y that WalletEvents subscribed with
			ws.emitProof({ Y, state: 0 });

			expect(cb).toHaveBeenCalledWith(expect.objectContaining({ Y, state: 0 }));
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
		it('yields payloads until error completes the stream, then cancels', async () => {
			const proofs: Proof[] = [
				{ amount: 2, id: '00bd033559de27d0', secret: 's1', C: 'test' },
				{ amount: 2, id: '00bd033559de27d0', secret: 's2', C: 'test2' },
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
			const proofs: Proof[] = [{ amount: 2, id: '00bd033559de27d0', secret: 's1', C: 'test' }];

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

			g.add(c1);
			g.add(c2);
			g.add(c3);

			g(); // invoke the composite canceller directly
			expect(g.cancelled).toBe(true);
			await flushMicrotasks();

			expect(c1).toHaveBeenCalled();
			expect(c2).toHaveBeenCalled();
			await expect(c3).resolves.toBeTypeOf('function');
			const inner = await c3;
			expect(inner).toHaveBeenCalled();

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

			expect(out).toEqual([]);
			const ws = mock.mint.webSocketConnection!;
			await flushMicrotasks();
			expect(ws.cancelSubscription).toHaveBeenCalled();
		});
	});

	describe("proofStatesStream drop:'newest' without onDrop", () => {
		it('drops the incoming payload and does not enqueue it (no onDrop provided)', async () => {
			const proofs: Proof[] = [{ amount: 1, id: 'd', secret: 's', C: 'c' }];
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
			const proofs: Proof[] = [{ amount: 1, id: 'd', secret: 's', C: 'c' }];
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
			g.add(rejected);
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

	describe('WalletEvents.meltBlanksCreated', () => {
		it('invokes handler with payload and supports unsubscribe', () => {
			const we = new WalletEvents({} as any);

			// Shape is intentionally loose ("any") to decouple the test
			const payload: any = {
				method: 'bolt12',
				quoteId: 'Q123',
				keysetId: 'KSET',
				blanks: [{ Y: 'y-blank-1' }, { Y: 'y-blank-2' }],
			};

			let seen: any | null = null;

			// Register and emit
			const cancel = (we as any).meltBlanksCreated((p: any) => {
				seen = p;
			});

			(we as any)._emitMeltBlanksCreated(payload);
			expect(seen).toEqual(payload);

			// Unsubscribe and ensure no further calls
			seen = null;
			cancel();
			(we as any)._emitMeltBlanksCreated(payload);
			expect(seen).toBeNull();
		});

		it('swallows handler errors (does not throw from _emitMeltBlanksCreated)', () => {
			const we = new WalletEvents({} as any);

			(we as any).meltBlanksCreated(() => {
				throw new Error('boom!');
			});

			expect(() => (we as any)._emitMeltBlanksCreated({} as any)).not.toThrow();
		});

		it('multiple handlers all receive; one throwing does not prevent others', () => {
			const we = new WalletEvents({} as any);

			const ok = vi.fn();

			(we as any).meltBlanksCreated(() => {
				throw new Error('bad handler');
			});
			(we as any).meltBlanksCreated(ok);

			const payload: any = { n: 1 };
			(we as any)._emitMeltBlanksCreated(payload);

			expect(ok).toHaveBeenCalledWith(payload);
		});
	});
});
