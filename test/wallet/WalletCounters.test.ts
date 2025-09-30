import { describe, it, expect } from 'vitest';
import {
	WalletCounters,
	EphemeralCounterSource,
	type CounterSource,
	type MutableCounterSource,
	type CounterRange,
} from '../../src/wallet';

//
// Test doubles
//

/**
 * Minimal immutable source: only reserve, no snapshot/advance/setNext.
 */
class ReserveOnlySource implements CounterSource {
	private next = new Map<string, number>();
	async reserve(keysetId: string, n: number): Promise<CounterRange> {
		const cur = this.next.get(keysetId) ?? 0;
		this.next.set(keysetId, cur + n);
		return { start: cur, count: n };
	}
}

/**
 * Mutable source without setNext: reserve + advanceToAtLeast only.
 */
class AdvanceOnlySource implements MutableCounterSource {
	private next = new Map<string, number>();
	async reserve(keysetId: string, n: number): Promise<CounterRange> {
		const cur = this.next.get(keysetId) ?? 0;
		this.next.set(keysetId, cur + n);
		return { start: cur, count: n };
	}
	async advanceToAtLeast(keysetId: string, minNext: number): Promise<void> {
		const cur = this.next.get(keysetId) ?? 0;
		if (minNext > cur) this.next.set(keysetId, minNext);
	}
	async snapshot(): Promise<Record<string, number>> {
		return Object.fromEntries(this.next.entries());
	}
	// setNext intentionally omitted to test unsupported path
}

describe('WalletCounters', () => {
	it('snapshot delegates to source (EphemeralCounterSource)', async () => {
		const src = new EphemeralCounterSource({ A: 5, B: 1 });
		const counters = new WalletCounters(src);
		const snap = await counters.snapshot();
		expect(snap).toEqual({ A: 5, B: 1 });
	});

	it('snapshot throws when source does not support snapshot', async () => {
		const src = new ReserveOnlySource();
		const counters = new WalletCounters(src);
		await expect(counters.snapshot()).rejects.toThrow(/snapshot\(\)/);
	});

	it('advanceToAtLeast delegates for mutable source (EphemeralCounterSource)', async () => {
		const src = new EphemeralCounterSource({ K: 2 });
		const counters = new WalletCounters(src);
		// bump forward
		await counters.advanceToAtLeast('K', 10);
		let snap = await counters.snapshot();
		expect(snap.K).toBe(10);
		// no-op if behind
		await counters.advanceToAtLeast('K', 5);
		snap = await counters.snapshot();
		expect(snap.K).toBe(10);
	});

	it('advanceToAtLeast throws when source is immutable', async () => {
		const src = new ReserveOnlySource();
		const counters = new WalletCounters(src);
		await expect(counters.advanceToAtLeast('X', 7)).rejects.toThrow(/advanceToAtLeast\(\)/);
	});

	it('setNext delegates when available (EphemeralCounterSource)', async () => {
		const src = new EphemeralCounterSource({ Z: 0 });
		const counters = new WalletCounters(src);
		await counters.setNext('Z', 42);
		const snap = await counters.snapshot();
		expect(snap.Z).toBe(42);
	});

	it('setNext throws when source does not implement it (advance only)', async () => {
		const src = new AdvanceOnlySource();
		const counters = new WalletCounters(src);
		await expect(counters.setNext('Y', 9)).rejects.toThrow(/setNext\(\)/);
		// advance still works
		await counters.advanceToAtLeast('Y', 9);
		const snap = await counters.snapshot();
		expect(snap.Y).toBe(9);
	});
});
