import { describe, it, expect } from 'vitest';
import {
	WalletCounters,
	EphemeralCounterSource,
	type CounterSource,
	type CounterRange,
} from '../../src/wallet';

//
// Test double: minimal source with mandatory methods only
//
class MandatoryOnlySource implements CounterSource {
	private next = new Map<string, number>();

	reserve(keysetId: string, n: number): Promise<CounterRange> {
		const cur = this.next.get(keysetId) ?? 0;
		if (n < 0) throw new Error('reserve called with negative count');
		if (n === 0) return Promise.resolve({ start: cur, count: 0 });
		this.next.set(keysetId, cur + n);
		return Promise.resolve({ start: cur, count: n });
	}

	advanceToAtLeast(keysetId: string, minNext: number): Promise<void> {
		const cur = this.next.get(keysetId) ?? 0;
		if (minNext > cur) this.next.set(keysetId, minNext);
		return Promise.resolve();
	}
}

describe('WalletCounters', () => {
	it('snapshot delegates to source when available (EphemeralCounterSource)', async () => {
		const src = new EphemeralCounterSource({ A: 5, B: 1 });
		const counters = new WalletCounters(src);
		const snap = await counters.snapshot();
		expect(snap).toEqual({ A: 5, B: 1 });
	});

	it('snapshot throws when source does not support snapshot', async () => {
		const src = new MandatoryOnlySource();
		const counters = new WalletCounters(src);
		await expect(counters.snapshot()).rejects.toThrow(/snapshot\(\)/);
	});

	it('advanceToAtLeast delegates and is idempotent (EphemeralCounterSource)', async () => {
		const src = new EphemeralCounterSource({ K: 2 });
		const counters = new WalletCounters(src);
		await counters.advanceToAtLeast('K', 10);
		let snap = await counters.snapshot();
		expect(snap.K).toBe(10);
		// no change if asked to bump behind the cursor
		await counters.advanceToAtLeast('K', 5);
		snap = await counters.snapshot();
		expect(snap.K).toBe(10);
	});

	it('advanceToAtLeast delegates on a minimal implementation', async () => {
		const src = new MandatoryOnlySource();
		const counters = new WalletCounters(src);
		await counters.advanceToAtLeast('X', 7);
		const peek = await counters.peekNext('X');
		expect(peek).toEqual(7);
	});

	it('setNext delegates when available (EphemeralCounterSource)', async () => {
		const src = new EphemeralCounterSource({ Z: 0 });
		const counters = new WalletCounters(src);
		await counters.setNext('Z', 42);
		const snap = await counters.snapshot();
		expect(snap.Z).toBe(42);
	});

	it('peekNext and snapshot are in sync (EphemeralCounterSource)', async () => {
		const src = new EphemeralCounterSource({ Z: 0 });
		const counters = new WalletCounters(src);

		await counters.setNext('X', 12);
		await counters.setNext('Y', 42);

		const snap = await counters.snapshot();
		expect(snap.X).toBe(12);
		expect(snap.Y).toBe(42);
		expect(snap.Z).toBe(0);
		expect(snap.A).toBeUndefined();

		expect(await counters.peekNext('X')).toBe(12);
		expect(await counters.peekNext('Y')).toBe(42);
		expect(await counters.peekNext('Z')).toBe(0);
		expect(await counters.peekNext('A')).toBe(0);
	});

	it('setNext throws when source does not implement it, but advance still works', async () => {
		const src = new MandatoryOnlySource();
		const counters = new WalletCounters(src);
		await expect(counters.setNext('Y', 9)).rejects.toThrow(/setNext\(\)/);
		// advance still works
		await counters.advanceToAtLeast('Y', 9);
		const peek = await counters.peekNext('Y');
		expect(peek).toEqual(9);
	});

	it('peekNext falls back to reserve(0) when snapshot is unsupported and does not mutate', async () => {
		const src = new MandatoryOnlySource(); // no snapshot
		const counters = new WalletCounters(src);

		// fresh key, should peek 0
		expect(await counters.peekNext('P')).toBe(0);

		// peek must not mutate, first real reserve should still start at 0
		const r1 = await src.reserve('P', 1);
		expect(r1).toEqual({ start: 0, count: 1 });

		// another peek should now reflect the cursor at 1
		expect(await counters.peekNext('P')).toBe(1);

		// and reserve should start at 1 next
		const r2 = await src.reserve('P', 2);
		expect(r2).toEqual({ start: 1, count: 2 });
		expect(await counters.peekNext('P')).toBe(3);
	});

	it('peekNext reflects advanceToAtLeast updates', async () => {
		const src = new MandatoryOnlySource(); // minimal impl, no snapshot
		const counters = new WalletCounters(src);

		// initial peek
		expect(await counters.peekNext('Q')).toBe(0);

		// bump via advanceToAtLeast
		await counters.advanceToAtLeast('Q', 5);
		expect(await counters.peekNext('Q')).toBe(5);

		// reservation should start at the bumped value
		const r = await src.reserve('Q', 2);
		expect(r).toEqual({ start: 5, count: 2 });

		// cursor advances accordingly
		expect(await counters.peekNext('Q')).toBe(7);

		// idempotent bump behind cursor
		await counters.advanceToAtLeast('Q', 3);
		expect(await counters.peekNext('Q')).toBe(7);
	});
});
