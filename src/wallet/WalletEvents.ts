import type { Wallet } from './Wallet';
import type { Proof, ProofState } from '../model/types';
import {
	MintQuoteState,
	MeltQuoteState,
	type MintQuoteResponse,
	type MeltQuoteResponse,
} from '../mint/types';
import type { SubscriptionCanceller } from './types';
import { hashToCurve } from '../crypto';

export type CancellerLike = SubscriptionCanceller | Promise<SubscriptionCanceller>;

type ErrorWithCause = Error & { cause?: unknown };

function safeStringify(obj: unknown): string {
	const seen = new WeakSet<object>();
	try {
		return JSON.stringify(obj, (_k: string, v: unknown) => {
			if (typeof v === 'object' && v !== null) {
				if (seen.has(v)) return '[Circular]';
				seen.add(v);
			}
			return v; // returning `unknown` is fine
		});
	} catch {
		return Object.prototype.toString.call(obj);
	}
}

function normalizeError(err: unknown): Error {
	if (err instanceof Error) return err;
	const message = typeof err === 'string' ? err : safeStringify(err);
	const e: ErrorWithCause = new Error(message);
	e.cause = err;
	return e;
}

function makeAbortError(): Error {
	const e = new Error('Aborted');
	Object.defineProperty(e, 'name', { value: 'AbortError' });
	return e;
}

function cancelSafely(c: CancellerLike | null | undefined): void {
	if (!c) return;
	void (async () => {
		try {
			const fn = await c;
			try {
				fn();
			} catch {
				/* ignore canceller errors */
			}
		} catch {
			/* ignore awaiting-canceller errors */
		}
	})();
}

export class WalletEvents {
	constructor(private wallet: Wallet) {}

	/**
	 * Register a callback to be called whenever a mint quote's state changes.
	 *
	 * @param quoteIds List of mint quote IDs that should be subscribed to.
	 * @param callback Callback function that will be called whenever a mint quote state changes.
	 * @param errorCallback
	 * @returns
	 */
	async mintQuoteUpdates(
		ids: string[],
		cb: (p: MintQuoteResponse) => void,
		err: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		await this.wallet.mint.connectWebSocket();
		const ws = this.wallet.mint.webSocketConnection;
		if (!ws) throw new Error('failed to establish WebSocket connection.');

		const subId = ws.createSubscription({ kind: 'bolt11_mint_quote', filters: ids }, cb, err);
		return () => ws.cancelSubscription(subId, cb);
	}

	/**
	 * Register a callback to be called when a single mint quote gets paid.
	 *
	 * @param quoteId Mint quote id that should be subscribed to.
	 * @param callback Callback function that will be called when this mint quote gets paid.
	 * @param errorCallback
	 * @returns
	 */
	async mintQuotePaid(
		id: string,
		cb: (p: MintQuoteResponse) => void,
		err: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		return this.mintQuoteUpdates(
			[id],
			(p) => {
				if (p.state === MintQuoteState.PAID) cb(p);
			},
			err,
		);
	}

	/**
	 * Register a callback to be called whenever a melt quote’s state changes.
	 *
	 * @param quoteId Melt quote id that should be subscribed to.
	 * @param callback Callback function that will be called when this melt quote gets paid.
	 * @param errorCallback
	 * @returns
	 */
	async meltQuoteUpdates(
		ids: string[],
		cb: (p: MeltQuoteResponse) => void,
		err: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		await this.wallet.mint.connectWebSocket();
		const ws = this.wallet.mint.webSocketConnection;
		if (!ws) throw new Error('failed to establish WebSocket connection.');

		const subId = ws.createSubscription({ kind: 'bolt11_melt_quote', filters: ids }, cb, err);
		return () => ws.cancelSubscription(subId, cb);
	}

	/**
	 * Register a callback to be called when a single melt quote gets paid.
	 *
	 * @param quoteIds List of melt quote IDs that should be subscribed to.
	 * @param callback Callback function that will be called whenever a melt quote state changes.
	 * @param errorCallback
	 * @returns
	 */
	async meltQuotePaid(
		id: string,
		cb: (p: MeltQuoteResponse) => void,
		err: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		return this.meltQuoteUpdates(
			[id],
			(p) => {
				if (p.state === MeltQuoteState.PAID) cb(p);
			},
			err,
		);
	}

	/**
	 * Register a callback to be called whenever a subscribed proof state changes.
	 *
	 * @param proofs List of proofs that should be subscribed to.
	 * @param callback Callback function that will be called whenever a proof's state changes.
	 * @param errorCallback
	 * @returns
	 */
	async proofStateUpdates(
		proofs: Proof[],
		cb: (payload: ProofState & { proof: Proof }) => void,
		err: (e: Error) => void,
	): Promise<SubscriptionCanceller> {
		await this.wallet.mint.connectWebSocket();
		const ws = this.wallet.mint.webSocketConnection;
		if (!ws) throw new Error('failed to establish WebSocket connection.');

		const enc = new TextEncoder();
		const proofMap: Record<string, Proof> = {};
		for (const p of proofs) {
			const y = hashToCurve(enc.encode(p.secret)).toHex(true);
			proofMap[y] = p;
		}
		const ys = Object.keys(proofMap);

		const subId = ws.createSubscription(
			{ kind: 'proof_state', filters: ys },
			(payload: ProofState) => {
				cb({ ...payload, proof: proofMap[payload.Y] });
			},
			err,
		);
		return () => ws.cancelSubscription(subId, cb);
	}

	/**
	 * Resolve once a mint quote transitions to PAID, with automatic unsubscription, optional abort
	 * signal, and optional timeout.
	 *
	 * The underlying subscription is always cancelled after resolution or rejection, including on
	 * timeout or abort.
	 *
	 * @example
	 *
	 * ```ts
	 * const ac = new AbortController();
	 * // Cancel if the user navigates away
	 * window.addEventListener('beforeunload', () => ac.abort(), { once: true });
	 *
	 * try {
	 * 	const paid = await wallet.on.onceMintPaid(quoteId, {
	 * 		signal: ac.signal,
	 * 		timeoutMs: 60_000,
	 * 	});
	 * 	console.log('Mint paid, amount', paid.amount);
	 * } catch (e) {
	 * 	if ((e as Error).name === 'AbortError') {
	 * 		console.log('User aborted');
	 * 	} else {
	 * 		console.error('Mint not paid', e);
	 * 	}
	 * }
	 * ```
	 *
	 * @param id Mint quote id to watch.
	 * @param opts Optional controls.
	 * @param opts.signal AbortSignal to cancel the wait early.
	 * @param opts.timeoutMs Milliseconds to wait before rejecting with a timeout error.
	 * @returns A promise that resolves with the latest `MintQuoteResponse` once PAID.
	 */
	onceMintPaid(
		id: string,
		opts?: { signal?: AbortSignal; timeoutMs?: number },
	): Promise<MintQuoteResponse> {
		return new Promise((resolve, reject) => {
			let cancelP: Promise<SubscriptionCanceller> | null = null;
			let to: ReturnType<typeof setTimeout> | null = null;

			const cleanup = (err?: unknown) => {
				cancelSafely(cancelP);
				if (to) {
					clearTimeout(to);
					to = null;
				}
				if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
				if (err) reject(normalizeError(err));
			};

			const onAbort = () => cleanup(makeAbortError());

			if (opts?.signal) {
				if (opts.signal.aborted) return onAbort();
				opts.signal.addEventListener('abort', onAbort, { once: true });
			}
			if (opts?.timeoutMs && opts.timeoutMs > 0) {
				to = setTimeout(() => cleanup(new Error('Timeout waiting for mint paid')), opts.timeoutMs);
			}

			cancelP = this.mintQuotePaid(
				id,
				(p) => {
					cleanup();
					resolve(p);
				},
				(e) => cleanup(e),
			);
		});
	}

	/**
	 * Resolve when ANY of several mint quotes is PAID, cancelling the rest.
	 *
	 * Subscribes to all distinct ids, resolves with `{ id, quote }` for the first PAID, and cancels
	 * all remaining subscriptions.
	 *
	 * Errors from individual subscriptions are ignored by default so a single noisy stream does not
	 * abort the whole race. Set `failOnError: true` to reject on the first error instead. If all
	 * subscriptions error and none paid, the promise rejects with the last seen error.
	 *
	 * @example
	 *
	 * ```ts
	 * // Race multiple quotes obtained from splitting a large top up
	 * const { id, quote } = await wallet.on.onceAnyMintPaid(batchQuoteIds, {
	 * 	timeoutMs: 120_000,
	 * });
	 * console.log('First top up paid', id, quote.preimage?.length);
	 * ```
	 *
	 * @param ids Array of mint quote ids (duplicates are ignored).
	 * @param opts Optional controls.
	 * @param opts.signal AbortSignal to cancel the wait early.
	 * @param opts.timeoutMs Milliseconds to wait before rejecting with a timeout error.
	 * @param opts.failOnError When true, reject on first error. Default false.
	 * @returns A promise resolving to the id that won and its `MintQuoteResponse`.
	 */
	onceAnyMintPaid(
		ids: string[],
		opts?: { signal?: AbortSignal; timeoutMs?: number; failOnError?: boolean },
	): Promise<{ id: string; quote: MintQuoteResponse }> {
		return new Promise((resolve, reject) => {
			const unique = Array.from(new Set(ids));
			const cancels: Map<string, CancellerLike> = new Map();
			let to: ReturnType<typeof setTimeout> | null = null;
			let lastError: unknown = null;
			let fullyRegistered = false;

			const cleanup = (err?: unknown) => {
				for (const c of cancels.values()) cancelSafely(c);
				cancels.clear();
				if (to) {
					clearTimeout(to);
					to = null;
				}
				if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
				if (err) reject(normalizeError(err));
			};

			const onAbort = () => cleanup(makeAbortError());

			if (opts?.signal) {
				if (opts.signal.aborted) return onAbort();
				opts.signal.addEventListener('abort', onAbort, { once: true });
			}
			if (opts?.timeoutMs && opts.timeoutMs > 0) {
				to = setTimeout(
					() => cleanup(new Error('Timeout waiting for any mint paid')),
					opts.timeoutMs,
				);
			}
			if (unique.length === 0) return cleanup(new Error('No quote ids provided'));

			for (const quoteId of unique) {
				const c = this.mintQuotePaid(
					quoteId,
					(p) => {
						cleanup();
						resolve({ id: quoteId, quote: p });
					},
					(e) => {
						if (opts?.failOnError) {
							cleanup(e);
							return;
						}
						lastError = e;
						const thisCanceller = cancels.get(quoteId);
						if (thisCanceller) {
							cancelSafely(thisCanceller);
							cancels.delete(quoteId);
						}
						// Only decide to fail once we've finished installing all subs
						if (fullyRegistered && cancels.size === 0) {
							cleanup(lastError ?? new Error('No subscriptions remaining'));
						}
					},
				);
				cancels.set(quoteId, c);
			}
			fullyRegistered = true;
		});
	}

	/**
	 * Resolve once a melt quote transitions to PAID, with automatic unsubscription, optional abort
	 * signal, and optional timeout.
	 *
	 * Mirrors onceMintPaid, but for melts.
	 *
	 * @example
	 *
	 * ```ts
	 * try {
	 * 	const paid = await wallet.on.onceMeltPaid(meltId, { timeoutMs: 45_000 });
	 * 	console.log('Invoice paid by mint, paid msat', paid.paid ?? 0);
	 * } catch (e) {
	 * 	console.error('Payment did not complete in time', e);
	 * }
	 * ```
	 *
	 * @param id Melt quote id to watch.
	 * @param opts Optional controls.
	 * @param opts.signal AbortSignal to cancel the wait early.
	 * @param opts.timeoutMs Milliseconds to wait before rejecting with a timeout error.
	 * @returns A promise that resolves with the `MeltQuoteResponse` once PAID.
	 */
	onceMeltPaid(
		id: string,
		opts?: { signal?: AbortSignal; timeoutMs?: number },
	): Promise<MeltQuoteResponse> {
		return new Promise((resolve, reject) => {
			let cancelP: Promise<SubscriptionCanceller> | null = null;
			let to: ReturnType<typeof setTimeout> | null = null;

			const cleanup = (err?: unknown) => {
				cancelSafely(cancelP);
				if (to) {
					clearTimeout(to);
					to = null;
				}
				if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
				if (err) reject(normalizeError(err));
			};

			const onAbort = () => cleanup(makeAbortError());

			if (opts?.signal) {
				if (opts.signal.aborted) return onAbort();
				opts.signal.addEventListener('abort', onAbort, { once: true });
			}
			if (opts?.timeoutMs && opts.timeoutMs > 0) {
				to = setTimeout(() => cleanup(new Error('Timeout waiting for melt paid')), opts.timeoutMs);
			}

			cancelP = this.meltQuotePaid(
				id,
				(p) => {
					cleanup();
					resolve(p);
				},
				(e) => cleanup(e),
			);
		});
	}

	/**
	 * Async iterable that yields proof state updates for the provided proofs.
	 *
	 * Adds a bounded buffer option:
	 *
	 * - If `maxBuffer` is set and the queue is full when a new payload arrives, either drop the oldest
	 *   queued payload (`drop: 'oldest'`, default) or the incoming payload (`drop: 'newest'`). In
	 *   both cases `onDrop` is invoked with the dropped payload.
	 *
	 * The stream ends and cleans up on abort or on the wallet error callback. Errors from the wallet
	 * are treated as a graceful end for this iterator.
	 *
	 * @example
	 *
	 * ```ts
	 * const ac = new AbortController();
	 * try {
	 * 	for await (const update of wallet.on.proofStatesStream(myProofs)) {
	 * 		if (update.state === CheckStateEnum.SPENT) {
	 * 			console.warn('Spent proof', update.proof.id);
	 * 		}
	 * 	}
	 * } catch (e) {
	 * 	if ((e as Error).name !== 'AbortError') {
	 * 		console.error('Stream error', e);
	 * 	}
	 * }
	 * ```
	 *
	 * @param proofs The proofs to subscribe to. Only `secret` is required.
	 * @param opts Optional controls.
	 * @param opts.signal AbortSignal that stops the stream when aborted.
	 * @param opts.maxBuffer Maximum number of queued items before applying the drop strategy.
	 * @param opts.drop Overflow strategy when `maxBuffer` is reached, 'oldest' | 'newest'. Default
	 *   'oldest'.
	 * @param opts.onDrop Callback invoked with the payload that was dropped.
	 * @returns An async iterable of update payloads.
	 */
	proofStatesStream<T = unknown>(
		proofs: Proof[],
		opts?: {
			signal?: AbortSignal;
			maxBuffer?: number;
			drop?: 'oldest' | 'newest';
			onDrop?: (payload: T) => void;
		},
	): AsyncIterable<T> {
		return async function* (this: WalletEvents) {
			const queue: T[] = [];
			let done = false;
			let notify: (() => void) | null = null;

			const max = opts?.maxBuffer && opts.maxBuffer > 0 ? opts.maxBuffer : Infinity;
			const dropMode: 'oldest' | 'newest' = opts?.drop ?? 'oldest';

			const wake = () => {
				const n = notify;
				notify = null;
				if (n) n();
			};

			const push = (payload: T) => {
				if (queue.length >= max) {
					if (dropMode === 'oldest') {
						const dropped = queue.shift();
						if (dropped !== undefined) {
							try {
								opts?.onDrop?.(dropped);
							} catch {
								/* noop */
							}
						}
						queue.push(payload);
					} else {
						try {
							opts?.onDrop?.(payload);
						} catch {
							/* noop */
						}
						return; // drop newest
					}
				} else {
					queue.push(payload);
				}
				wake();
			};

			const cancelP: Promise<SubscriptionCanceller> = this.proofStateUpdates(
				proofs,
				(payload: ProofState & { proof: Proof }) => {
					// Accept wallet payload type and expose as generic T to consumer
					push(payload as unknown as T);
				},
				() => {
					done = true;
					wake();
				},
			);

			const onAbort = () => {
				done = true;
				wake();
			};

			try {
				if (opts?.signal) {
					if (opts.signal.aborted) onAbort();
					else opts.signal.addEventListener('abort', onAbort, { once: true });
				}
				while (!done || queue.length) {
					while (queue.length) yield queue.shift()!;
					if (done) break;
					await new Promise<void>((resolve) => (notify = resolve));
				}
			} finally {
				cancelSafely(cancelP);
				if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
			}
		}.call(this);
	}

	/**
	 * Create a composite canceller that can collect many subscriptions and dispose them all in one
	 * call.
	 *
	 * Accepts both a `SubscriptionCanceller` and a `Promise<SubscriptionCanceller>`. When the
	 * composite canceller is called, all collected cancellations are invoked. Errors from individual
	 * cancellers are caught and ignored.
	 *
	 * The returned function also has an `.add()` method to register more cancellers, and a
	 * `.cancelled` boolean property for debugging.
	 *
	 * @example
	 *
	 * ```ts
	 * const cancelAll = wallet.on.group();
	 * cancelAll.add(wallet.on.mintQuotes(ids, onUpdate, onErr));
	 * cancelAll.add(asyncSubscribeElsewhere());
	 *
	 * // later
	 * cancelAll(); // disposes everything
	 * ```
	 *
	 * @returns Composite canceller function with `.add()` and `.cancelled` members.
	 */
	group(): SubscriptionCanceller & {
		add: (c: CancellerLike) => CancellerLike;
		cancelled: boolean;
	} {
		const cancels: CancellerLike[] = [];
		let cancelled = false;

		const cancelAll = (() => {
			if (cancelled) return;
			cancelled = true;
			while (cancels.length) cancelSafely(cancels.pop());
		}) as SubscriptionCanceller & {
			add: (c: CancellerLike) => CancellerLike;
			cancelled: boolean;
		};

		cancelAll.add = (c: CancellerLike) => {
			if (cancelled) {
				// already cancelled, immediately dispose newly added subscription
				cancelSafely(c);
				return c;
			}
			cancels.push(c);
			return c;
		};

		Object.defineProperty(cancelAll, 'cancelled', {
			get: () => cancelled,
			enumerable: true,
		});

		return cancelAll;
	}
}
