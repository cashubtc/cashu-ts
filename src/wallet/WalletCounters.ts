import type { CounterSource } from './CounterSource';

/**
 * Developer friendly view of the wallet's deterministic output counters.
 */
export class WalletCounters {
	constructor(private readonly src: CounterSource) {}
	/**
	 * Returns the "next" counter for a specified keyset.
	 */
	async peekNext(keysetId: string): Promise<number> {
		const r = await this.src.reserve(keysetId, 0);
		return r.start;
	}

	/**
	 * Bumps the counter if it is behind `minNext` (no-op if ahead).
	 */
	async advanceToAtLeast(keysetId: string, minNext: number): Promise<void> {
		// Mandatory on CounterSource
		await this.src.advanceToAtLeast(keysetId, minNext);
	}

	/**
	 * Hard-sets the cursor (useful for tests or migrations).
	 *
	 * @throws If the CounterSource does not support setNext()
	 */
	async setNext(keysetId: string, next: number): Promise<void> {
		// Optional capability
		if (typeof this.src.setNext === 'function') {
			await this.src.setNext(keysetId, next);
			return;
		}
		throw new Error('CounterSource does not support setNext()');
	}
	/**
	 * Returns the current "next" per keyset (what will be reserved next).
	 *
	 * @throws If the CounterSource does not support snapshot()
	 */
	async snapshot(): Promise<Record<string, number>> {
		// Optional capability
		if (typeof this.src.snapshot === 'function') {
			return await this.src.snapshot();
		}
		throw new Error('CounterSource does not support snapshot()');
	}
}
