import type { CounterSource } from './CounterSource';

type HasAdvance = {
	advanceToAtLeast: (keysetId: string, minNext: number) => Promise<void>;
};
type HasSetNext = {
	setNext: (keysetId: string, next: number) => Promise<void>;
};
type HasSnapshot = {
	snapshot: () => Promise<Record<string, number>>;
};

/**
 * Developer friendly view of deterministic output counters.
 *
 * Use this to inspect (`snapshot`) or advance/set the "next" counter per keyset. It delegates to
 * the underlying CounterSource; if a method is unsupported it throws a clear error.
 *
 * Notes,
 *
 * - `advanceToAtLeast(id, n)` bumps the cursor if it is behind `n` (no-op if ahead).
 * - `setNext(id, n)` hard-sets the cursor (useful for tests or migrations).
 * - `snapshot()` returns the current "next" per keyset (what will be reserved next).
 */
export class WalletCounters {
	constructor(private readonly src: CounterSource) {}

	async advanceToAtLeast(keysetId: string, minNext: number): Promise<void> {
		const maybe = this.src as Partial<HasAdvance>;
		if ('advanceToAtLeast' in this.src && typeof maybe.advanceToAtLeast === 'function') {
			const s = this.src as HasAdvance;
			await s.advanceToAtLeast(keysetId, minNext);
			return;
		}
		throw new Error('CounterSource does not support advanceToAtLeast()');
	}

	async setNext(keysetId: string, next: number): Promise<void> {
		const maybe = this.src as Partial<HasSetNext>;
		if ('setNext' in this.src && typeof maybe.setNext === 'function') {
			const s = this.src as HasSetNext;
			await s.setNext(keysetId, next);
			return;
		}
		throw new Error('CounterSource does not support setNext()');
	}

	async snapshot(): Promise<Record<string, number>> {
		const maybe = this.src as Partial<HasSnapshot>;
		if ('snapshot' in this.src && typeof maybe.snapshot === 'function') {
			const s = this.src as HasSnapshot;
			return await s.snapshot();
		}
		throw new Error('CounterSource does not support snapshot()');
	}
}
