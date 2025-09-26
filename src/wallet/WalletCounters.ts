import type { CounterSource, MutableCounterSource } from './counters';

// Type guards to avoid `any`
function hasSnapshot(
	src: CounterSource,
): src is CounterSource & { snapshot: () => Promise<Record<string, number>> } {
	return typeof (src as { snapshot?: unknown }).snapshot === 'function';
}

function isMutable(src: CounterSource): src is MutableCounterSource {
	return typeof (src as { advanceToAtLeast?: unknown }).advanceToAtLeast === 'function';
}

function hasSetNext(
	src: CounterSource,
): src is MutableCounterSource & { setNext: (keysetId: string, next: number) => Promise<void> } {
	return typeof (src as { setNext?: unknown }).setNext === 'function';
}

/**
 * Developer-friendly view of deterministic output counters.
 *
 * Use this to inspect (`snapshot`) or advance/set the "next" counter per keyset. It delegates to
 * the underlying CounterSource; if a method is unsupported it throws a clear error.
 *
 * Notes,
 *
 * - `snapshot()` returns the current "next" per keyset (what will be reserved next).
 * - `advanceToAtLeast(id, n)` bumps the cursor if it is behind `n` (no-op if ahead).
 * - `setNext(id, n)` hard-sets the cursor (useful for tests or migrations).
 */
export class WalletCounters {
	constructor(private readonly src: CounterSource) {}

	async snapshot(): Promise<Record<string, number>> {
		if (hasSnapshot(this.src)) return this.src.snapshot();
		throw new Error('CounterSource does not support snapshot()');
	}

	async advanceToAtLeast(keysetId: string, minNext: number): Promise<void> {
		if (isMutable(this.src)) return this.src.advanceToAtLeast(keysetId, minNext);
		throw new Error('CounterSource does not support advanceToAtLeast()');
	}

	async setNext(keysetId: string, next: number): Promise<void> {
		if (hasSetNext(this.src)) return this.src.setNext(keysetId, next);
		throw new Error('CounterSource does not support setNext()');
	}
}
