import type { Wallet } from './Wallet';
import type {
	Proof,
	ProofState,
	MeltQuoteBaseResponse,
	MeltQuoteBolt11Response,
	MintQuoteBolt11Response,
} from '../model/types';
import { MintQuoteState, MeltQuoteState } from '../model/types';
import type { MeltBlanks, SubscriptionCanceller } from './types';
import { hashToCurve } from '../crypto';
import { type OperationCounters } from './CounterSource';
import { safeCallback } from '../logger';

export type CancellerLike = SubscriptionCanceller | Promise<SubscriptionCanceller>;

export type SubscribeOpts = { signal?: AbortSignal };

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
	void Promise.resolve(c)
		.then((fn) => {
			try {
				fn();
			} catch {
				/* ignore canceller errors */
			}
			return;
		})
		.catch(() => {
			/* ignore awaiting-canceller errors */
		});
}

export class WalletEvents {
	constructor(private wallet: Wallet) {}

	// Callbacks registered for Counters Reserved events
	private countersReservedHandlers = new Set<(payload: OperationCounters) => void>();

	// Callbacks registered for Melt blanks created events
	private meltBlanksHandlers = new Set<(payload: MeltBlanks<MeltQuoteBaseResponse>) => void>();

	// Binds an abort signal to each subscription canceller
	private withAbort(
		signal: AbortSignal | undefined,
		cancel: SubscriptionCanceller,
	): SubscriptionCanceller {
		if (!signal) return cancel;
		if (signal.aborted) {
			cancel();
			return () => {
				/* noop */
			};
		}
		const onAbort = () => cancel();
		signal.addEventListener('abort', onAbort, { once: true });
		return () => {
			signal.removeEventListener('abort', onAbort);
			cancel();
		};
	}

	// Subscribe to a quote-paid event and resolve when it fires.
	// Supports AbortSignal and timeout, and always cleans up.
	private waitUntilPaid<T>(
		subscribeFn: (
			id: string,
			cb: (p: T) => void, // called when the entity becomes PAID
			err: (e: Error) => void, // called if the subscription itself errors
			opts?: { signal?: AbortSignal },
		) => Promise<SubscriptionCanceller>,
		id: string, // identifier of the mint/melt/etc. to watch
		opts?: SubscribeOpts & { timeoutMs?: number },
		timeoutMsg = 'Timeout waiting for paid',
	): Promise<T> {
		return new Promise((resolve, reject) => {
			let cancelP: Promise<SubscriptionCanceller> | null = null; // handle to unsub later
			let to: ReturnType<typeof setTimeout> | null = null; // optional timeout timer

			// Common cleanup: cancels subscription, clears timer, detaches abort listener.
			// If an error is provided, rejects the promise with it.
			const cleanup = (err?: unknown) => {
				cancelSafely(cancelP);
				if (to) {
					clearTimeout(to);
					to = null;
				}
				if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
				if (err) reject(normalizeError(err));
			};

			// Abort handler produces a standardized AbortError and rejects.
			const onAbort = () => cleanup(makeAbortError());

			// Hook up AbortSignal if provided.
			if (opts?.signal) {
				if (opts.signal.aborted) return onAbort(); // already aborted
				opts.signal.addEventListener('abort', onAbort, { once: true });
			}

			// Start a timeout if requested.
			if (opts?.timeoutMs && opts.timeoutMs > 0) {
				to = setTimeout(() => cleanup(new Error(timeoutMsg)), opts.timeoutMs);
			}

			// Subscribe to the actual event. Canceller returned is saved to cancelP.
			cancelP = subscribeFn(
				id,
				(p) => {
					cleanup(); // clean up resources
					resolve(p); // resolve promise with payload
				},
				(e) => cleanup(e), // reject if subscription itself errors
				{ signal: opts?.signal }, // delegate abort to subscription as well
			);
		});
	}

	/**
	 * Register a callback that fires whenever deterministic counters are reserved.
	 *
	 * Timing: the callback is invoked synchronously _after_ a successful reservation and _before_ the
	 * enclosing wallet method returns. The wallet does **not** await your callback, it is
	 * fire-and-forget.
	 *
	 * Responsibility for async work is on the consumer. If your handler calls an async function (e.g.
	 * persisting `start + count` to storage), make sure to handle errors inside it to avoid unhandled
	 * rejections.
	 *
	 * Typical use: persist `start + count` for the `keysetId` so counters survive restarts.
	 *
	 * @example
	 *
	 * ```ts
	 * wallet.on.countersReserved(({ keysetId, start, count, next }) => {
	 * 	saveNextToDb(keysetId, start + count); // handle async errors inside saveNextToDb
	 * });
	 * ```
	 *
	 * @param cb Handler called with { keysetId, start, count }.
	 * @returns A function that unsubscribes the handler.
	 */
	public countersReserved(
		cb: (payload: OperationCounters) => void,
		opts?: SubscribeOpts,
	): SubscriptionCanceller {
		this.countersReservedHandlers.add(cb);
		const cancel = () => this.countersReservedHandlers.delete(cb);
		return this.withAbort(opts?.signal, cancel);
	}
	/**
	 * @internal
	 */
	public _emitCountersReserved(payload: OperationCounters) {
		for (const h of this.countersReservedHandlers) {
			safeCallback(h, payload, this.wallet.logger, { event: 'countersReserved' });
		}
	}

	/**
	 * Register a callback fired whenever NUT-08 blanks are created during a melt.
	 *
	 * Called synchronously right after blanks are prepared (before the melt request), and the wallet
	 * does not await your handler.
	 *
	 * Typical use: persist `payload` so you can later call `wallet.completeMelt(payload)`.
	 *
	 * @deprecated Use wallet.prepareMelt() and store the MeltPreview instead.
	 */
	public meltBlanksCreated(
		cb: (payload: MeltBlanks<MeltQuoteBaseResponse>) => void,
		opts?: SubscribeOpts,
	): SubscriptionCanceller {
		this.meltBlanksHandlers.add(cb);
		const cancel = () => this.meltBlanksHandlers.delete(cb);
		return this.withAbort(opts?.signal, cancel);
	}

	/**
	 * @internal
	 */
	public _emitMeltBlanksCreated(payload: MeltBlanks<MeltQuoteBaseResponse>) {
		for (const h of this.meltBlanksHandlers) {
			safeCallback(h, payload, this.wallet.logger, { event: 'meltBlanksCreated' });
		}
	}

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
		cb: (p: MintQuoteBolt11Response) => void,
		err: (e: Error) => void,
		opts?: SubscribeOpts,
	): Promise<SubscriptionCanceller> {
		await this.wallet.mint.connectWebSocket();
		const ws = this.wallet.mint.webSocketConnection;
		if (!ws) throw new Error('Failed to establish WebSocket connection.');

		const uniq = Array.from(new Set(ids));
		const subId = ws.createSubscription({ kind: 'bolt11_mint_quote', filters: uniq }, cb, err);
		const cancel = () => ws.cancelSubscription(subId, cb);
		return this.withAbort(opts?.signal, cancel);
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
		cb: (p: MintQuoteBolt11Response) => void,
		err: (e: Error) => void,
		opts?: SubscribeOpts,
	): Promise<SubscriptionCanceller> {
		return this.mintQuoteUpdates(
			[id],
			(p) => {
				if (p.state === MintQuoteState.PAID) cb(p);
			},
			err,
			opts,
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
		cb: (p: MeltQuoteBolt11Response) => void,
		err: (e: Error) => void,
		opts?: SubscribeOpts,
	): Promise<SubscriptionCanceller> {
		await this.wallet.mint.connectWebSocket();
		const ws = this.wallet.mint.webSocketConnection;
		if (!ws) throw new Error('Failed to establish WebSocket connection.');

		const uniq = Array.from(new Set(ids));
		const subId = ws.createSubscription({ kind: 'bolt11_melt_quote', filters: uniq }, cb, err);
		const cancel = () => ws.cancelSubscription(subId, cb);
		return this.withAbort(opts?.signal, cancel);
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
		cb: (p: MeltQuoteBolt11Response) => void,
		err: (e: Error) => void,
		opts?: SubscribeOpts,
	): Promise<SubscriptionCanceller> {
		return this.meltQuoteUpdates(
			[id],
			(p) => {
				if (p.state === MeltQuoteState.PAID) cb(p);
			},
			err,
			opts,
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
		opts?: SubscribeOpts,
	): Promise<SubscriptionCanceller> {
		await this.wallet.mint.connectWebSocket();
		const ws = this.wallet.mint.webSocketConnection;
		if (!ws) throw new Error('Failed to establish WebSocket connection.');

		const enc = new TextEncoder();
		const proofMap: Record<string, Proof> = {};
		for (const p of proofs) {
			const y = hashToCurve(enc.encode(p.secret)).toHex(true);
			proofMap[y] = p;
		}
		const ys = Object.keys(proofMap);

		const handler = (payload: ProofState) => {
			cb({ ...payload, proof: proofMap[payload.Y] });
		};
		const subId = ws.createSubscription({ kind: 'proof_state', filters: ys }, handler, err);
		const cancel = () => ws.cancelSubscription(subId, handler);

		return this.withAbort(opts?.signal, cancel);
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
	 * @returns A promise that resolves with the latest `MintQuoteBolt11Response` once PAID.
	 */
	onceMintPaid(
		id: string,
		opts?: { signal?: AbortSignal; timeoutMs?: number },
	): Promise<MintQuoteBolt11Response> {
		return this.waitUntilPaid<MintQuoteBolt11Response>(
			this.mintQuotePaid.bind(this),
			id,
			opts,
			'Timeout waiting for mint paid',
		);
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
	 * @returns A promise resolving to the id that won and its `MintQuoteBolt11Response`.
	 */
	onceAnyMintPaid(
		ids: string[],
		opts?: { signal?: AbortSignal; timeoutMs?: number; failOnError?: boolean },
	): Promise<{ id: string; quote: MintQuoteBolt11Response }> {
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
	 * @returns A promise that resolves with the `MeltQuoteBolt11Response` once PAID.
	 */
	onceMeltPaid(
		id: string,
		opts?: { signal?: AbortSignal; timeoutMs?: number },
	): Promise<MeltQuoteBolt11Response> {
		return this.waitUntilPaid<MeltQuoteBolt11Response>(
			this.meltQuotePaid.bind(this),
			id,
			opts,
			'Timeout waiting for melt paid',
		);
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
				{ signal: opts?.signal },
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
