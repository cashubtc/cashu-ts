import { describe, it, expect } from 'vitest';
import { EphemeralCounterSource, type CounterRange } from '../../src/wallet/counters';

describe('EphemeralCounterSource', () => {
	it('constructor seeds initial next values', async () => {
		const src = new EphemeralCounterSource({ a: 5, b: 2 });
		const snap = await src.snapshot();
		expect(snap).toEqual({ a: 5, b: 2 });
	});

	it('reserve(n=0) returns {start:0,count:0} and does not mutate state', async () => {
		const src = new EphemeralCounterSource();
		const r = await src.reserve('k', 0);
		expect(r).toEqual({ start: 0, count: 0 });

		// follow-up reserve(3) should still start at 0 if n=0 was a no-op
		const r2 = await src.reserve('k', 3);
		expect(r2).toEqual({ start: 0, count: 3 });
		const snap = await src.snapshot();
		expect(snap).toEqual({ k: 3 });
	});

	it('reserve throws on negative count', async () => {
		const src = new EphemeralCounterSource();
		await expect(src.reserve('k', -1 as unknown as number)).rejects.toThrow(/negative count/);
	});

	it('reserve increments monotonically per keyset', async () => {
		const src = new EphemeralCounterSource();
		const a = await src.reserve('k', 2); // 0..1
		const b = await src.reserve('k', 1); // 2
		const c = await src.reserve('k', 3); // 3..5
		expect(a).toEqual<CounterRange>({ start: 0, count: 2 });
		expect(b).toEqual<CounterRange>({ start: 2, count: 1 });
		expect(c).toEqual<CounterRange>({ start: 3, count: 3 });
		const snap = await src.snapshot();
		expect(snap).toEqual({ k: 6 });
	});

	it('independent keysets do not interfere', async () => {
		const src = new EphemeralCounterSource();
		const [a1, b1] = await Promise.all([src.reserve('A', 1), src.reserve('B', 2)]);
		expect(a1).toEqual({ start: 0, count: 1 });
		expect(b1).toEqual({ start: 0, count: 2 });

		const [a2, b2] = await Promise.all([src.reserve('A', 3), src.reserve('B', 1)]);
		expect(a2).toEqual({ start: 1, count: 3 });
		expect(b2).toEqual({ start: 2, count: 1 });

		const snap = await src.snapshot();
		expect(snap).toEqual({ A: 4, B: 3 });
	});

	it('handles concurrent reserve calls (serializes per-key)', async () => {
		const src = new EphemeralCounterSource();
		// 10 concurrent reserves of 1 on the same key should produce starts 0..9
		const calls = Array.from({ length: 10 }, () => src.reserve('x', 1));
		const results = await Promise.all(calls);
		const starts = results.map((r) => r.start).sort((u, v) => u - v);
		expect(starts).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		const snap = await src.snapshot();
		expect(snap).toEqual({ x: 10 });
	});

	it('advanceToAtLeast raises next only when larger', async () => {
		const src = new EphemeralCounterSource();
		await src.reserve('k', 2); // next=2
		await src.advanceToAtLeast('k', 1); // no change
		let snap = await src.snapshot();
		expect(snap.k).toBe(2);

		await src.advanceToAtLeast('k', 5); // bump to 5
		snap = await src.snapshot();
		expect(snap.k).toBe(5);

		const r = await src.reserve('k', 2); // should start at 5
		expect(r).toEqual({ start: 5, count: 2 });
		snap = await src.snapshot();
		expect(snap.k).toBe(7);
	});

	it('setNext sets absolute next and rejects negatives', async () => {
		const src = new EphemeralCounterSource();
		await src.setNext!('k', 10);
		const r = await src.reserve('k', 1);
		expect(r).toEqual({ start: 10, count: 1 });
		await expect(src.setNext!('k', -5)).rejects.toThrow(/negative next/);
	});

	it('snapshot returns a shallow copy (mutations to returned object do not affect source)', async () => {
		const src = new EphemeralCounterSource({ a: 1 });
		const snap1 = await src.snapshot();
		snap1.a = 999 as any; // mutate the snapshot
		const snap2 = await src.snapshot();
		expect(snap2).toEqual({ a: 1 }); // source unchanged
	});
});
