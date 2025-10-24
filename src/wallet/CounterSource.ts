/**
 * Usable counters in range is [start, start+count-1]
 *
 * @example // Start: 5, count: 3 => 5,6,7.
 */
export interface CounterRange {
	start: number;
	count: number;
}

// CounterSource.ts
export interface CounterSource {
	/**
	 * Reserve n counters for a keyset.
	 *
	 * N may be 0. In that case the call MUST NOT mutate state and MUST return { start: currentNext,
	 * count: 0 }, effectively a read only peek of the cursor.
	 */
	reserve(keysetId: string, n: number): Promise<CounterRange>;
	/**
	 * Monotonic bump, ensure the next counter is at least minNext.
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
		if (n < 0) throw new Error('reserve called with negative count');
		return this.withLock(keysetId, () => {
			const cur = this.next.get(keysetId) ?? 0;
			if (n === 0) return { start: cur, count: 0 }; // report current, do not move
			this.next.set(keysetId, cur + n);
			return { start: cur, count: n };
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
			if (next < 0) throw new Error('setNext: negative next not allowed');
			this.next.set(keysetId, next);
		});
	}

	snapshot(): Promise<Record<string, number>> {
		return Promise.resolve(Object.fromEntries(this.next.entries()));
	}
}
