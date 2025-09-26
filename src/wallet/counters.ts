/**
 * Usable counters in range is [start, start+count-1]
 *
 * @example // Start: 5, count: 3 => 5,6,7.
 */
export interface CounterRange {
	start: number;
	count: number;
}

export interface CounterSource {
	/**
	 * Reserves `n` counters.
	 */
	reserve(keysetId: string, n: number): Promise<CounterRange>;
	/**
	 * Optional introspection.
	 */
	snapshot?(): Promise<Record<string, number>>;
}

export interface MutableCounterSource extends CounterSource {
	/**
	 * Monotonic bump: ensure the next counter is at least `minNext`
	 */
	advanceToAtLeast(keysetId: string, minNext: number): Promise<void>;

	/**
	 * Optional hard set (useful for tests/migrations)
	 */
	setNext?(keysetId: string, next: number): Promise<void>;
}

/**
 * Counter for a transaction.
 *
 * - KeysetID: of the transaction.
 * - Start: of reservation.
 * - Count: of reservations.
 * - Next: counter available.
 *
 * @example // Start: 5, Count: 3 => 5,6,7. Next: 8.
 */
export type OperationCounters = {
	keysetId: string;
	start: number;
	count: number;
	next: number;
};

export class EphemeralCounterSource implements MutableCounterSource {
	private next = new Map<string, number>();
	private locks = new Map<string, Promise<void>>();

	constructor(initial?: Record<string, number>) {
		if (initial) for (const [k, v] of Object.entries(initial)) this.next.set(k, v);
	}

	private async withLock<T>(k: string, fn: () => T | Promise<T>): Promise<T> {
		const prev = this.locks.get(k) ?? Promise.resolve();
		let release!: () => void;
		const p = new Promise<void>((_resolve) => (release = _resolve));
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
		if (n === 0) return { start: 0, count: 0 };
		if (n < 0) throw new Error('reserve called with negative count');
		return this.withLock(keysetId, () => {
			const cur = this.next.get(keysetId) ?? 0;
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

	async setNext?(keysetId: string, next: number): Promise<void> {
		await this.withLock(keysetId, () => {
			if (next < 0) throw new Error('setNext: negative next not allowed');
			this.next.set(keysetId, next);
		});
	}

	async snapshot(): Promise<Record<string, number>> {
		return Promise.resolve(Object.fromEntries(this.next.entries()));
	}
}
