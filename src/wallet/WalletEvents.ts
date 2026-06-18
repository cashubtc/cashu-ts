import { hashToCurve, hashToCurveBls, isBlsKeyset } from '../crypto';
import { safeCallback } from '../logger';
import { Amount, type AmountLike } from '../model/Amount';
import { CTSError } from '../model/Errors';
import { MintQuoteState, MeltQuoteState } from '../model/types';
import type {
  Proof,
  ProofLike,
  ProofState,
  MintQuoteGenericResponse,
  MeltQuoteGenericResponse,
  RpcSubKinds,
} from '../model/types';

import { type OperationCounters } from './CounterSource';
import type { Wallet } from './Wallet';

export type SubscriptionCanceller = () => void;

export type CancellerLike = SubscriptionCanceller | Promise<SubscriptionCanceller>;

export type SubscribeOpts = { signal?: AbortSignal };

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
  return new CTSError(message, { cause: err });
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

// Mint quote has funds available to mint: `amount_paid` > `amount_issued`, falling back to legacy
// `state` for pre-accounting mints. Payloads are raw JSON (not `Amount`), hence `Amount.from` and
// `!= null` (a real 0 is not absent).
function isMintQuotePaid(p: MintQuoteGenericResponse): boolean {
  const paid = (p as { amount_paid?: AmountLike }).amount_paid;
  const issued = (p as { amount_issued?: AmountLike }).amount_issued;
  if (paid != null && issued != null) {
    return Amount.from(paid).greaterThan(Amount.from(issued));
  }
  return (p as { state?: MintQuoteState }).state === MintQuoteState.PAID;
}

// Melt quote payment completed. `state` is a base field on every melt quote, so no accounting fallback.
function isMeltQuotePaid(p: MeltQuoteGenericResponse): boolean {
  return p.state === MeltQuoteState.PAID;
}

export class WalletEvents {
  constructor(private wallet: Wallet) {}

  // Callbacks registered for Counters Reserved events
  private countersReservedHandlers = new Set<(payload: OperationCounters) => void>();

  // NUT-17 kind(s) to open for a quote subscription, independent of payment method: the generic
  // kind if the mint advertises it, else every per-method kind it advertises for this unit (fanned
  // out and merged). Falls back to the generic kind when mint info is unavailable.
  private quoteSubKinds(type: 'mint' | 'melt'): RpcSubKinds[] {
    const generic: RpcSubKinds = type === 'mint' ? 'mint_quote' : 'melt_quote';
    const suffix = type === 'mint' ? '_mint_quote' : '_melt_quote';

    try {
      const { supported, params } = this.wallet.getMintInfo().isSupported(17);
      if (!supported) return [generic];

      const commands = Array.from(
        new Set(
          params?.filter((p) => p.unit === this.wallet.unit).flatMap((p) => p.commands) ?? [],
        ),
      );

      if (commands.includes(generic)) return [generic];

      // `endsWith(suffix)` excludes the bare generic kind (no leading method prefix). The cast
      // forwards any advertised per-method kind, including custom ones not enumerated by RpcSubKinds.
      const perMethod = commands.filter((c) => c.endsWith(suffix)) as RpcSubKinds[];
      if (perMethod.length > 0) return perMethod;
    } catch {
      // WalletEvents is also used in tests with a minimal mocked Wallet surface.
    }

    return [generic];
  }

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
      let done = false;

      // Common cleanup: cancels subscription, clears timer, detaches abort listener.
      // If an error is provided, rejects the promise with it.
      const cleanup = (err?: unknown) => {
        if (done) return;
        done = true;
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
        to = setTimeout(() => cleanup(new CTSError(timeoutMsg)), opts.timeoutMs);
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

      // catch errors starting the subscription
      void cancelP.catch((e) => cleanup(e));
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
   *   saveNextToDb(keysetId, start + count); // handle async errors inside saveNextToDb
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

  // Core quote-subscription primitive: opens one sub per kind from `quoteSubKinds` (usually one),
  // routes each to `cb`, and returns a canceller that tears all of them down.
  private async quoteUpdates<T>(
    type: 'mint' | 'melt',
    ids: string[],
    cb: (p: T) => void,
    err: (e: Error) => void,
    opts?: SubscribeOpts,
  ): Promise<SubscriptionCanceller> {
    await this.wallet.mint.connectWebSocket();
    const ws = this.wallet.mint.webSocketConnection;
    if (!ws) throw new CTSError('Failed to establish WebSocket connection.');

    const uniq = Array.from(new Set(ids));
    const kinds = this.quoteSubKinds(type);
    // Fanned-out kinds share one stream but isolate errors. A quote id belongs to a single method,
    // so only one kind ever delivers; don't let another kind's error (e.g. a mint that advertises a
    // kind but rejects the subscribe) tear down the sibling that works. Surface `err` only once
    // every kind has failed.
    let alive = kinds.length;
    const onErr = (e: Error) => {
      if (--alive <= 0) err(e);
    };
    const subIds = kinds.map((kind) =>
      ws.createSubscription<T>({ kind, filters: uniq }, cb, onErr),
    );
    const cancel = () => {
      for (const subId of subIds) ws.cancelSubscription(subId, cb);
    };
    return this.withAbort(opts?.signal, cancel);
  }

  /**
   * Subscribe to mint quote state changes for any payment method.
   *
   * @remarks
   * Payload defaults to {@link MintQuoteGenericResponse}; narrow via `T` (e.g.
   * `MintQuoteBolt12Response`) when you know the quotes' method.
   * @param ids Mint quote ids to subscribe to.
   * @param cb Called whenever a subscribed mint quote changes.
   * @param err Called if the subscription errors.
   * @returns A canceller that unsubscribes.
   */
  async mintQuoteUpdates<T extends MintQuoteGenericResponse = MintQuoteGenericResponse>(
    ids: string[],
    cb: (p: T) => void,
    err: (e: Error) => void,
    opts?: SubscribeOpts,
  ): Promise<SubscriptionCanceller> {
    return this.quoteUpdates<T>('mint', ids, cb, err, opts);
  }

  /**
   * Subscribe to a single mint quote and fire once it is mintable.
   *
   * @remarks
   * "Mintable" means `amount_paid` > `amount_issued`, falling back to legacy `state` PAID for
   * pre-accounting mints.
   * @param id Mint quote id to subscribe to.
   * @param cb Called once the quote becomes mintable.
   * @param err Called if the subscription errors.
   * @returns A canceller that unsubscribes.
   */
  async mintQuotePaid<T extends MintQuoteGenericResponse = MintQuoteGenericResponse>(
    id: string,
    cb: (p: T) => void,
    err: (e: Error) => void,
    opts?: SubscribeOpts,
  ): Promise<SubscriptionCanceller> {
    return this.mintQuoteUpdates<T>(
      [id],
      (p) => {
        if (isMintQuotePaid(p)) cb(p);
      },
      err,
      opts,
    );
  }

  /**
   * Subscribe to melt quote state changes for any payment method.
   *
   * @remarks
   * Payload defaults to {@link MeltQuoteGenericResponse}; narrow via `T` when you know the quotes'
   * method.
   * @param ids Melt quote ids to subscribe to.
   * @param cb Called whenever a subscribed melt quote changes.
   * @param err Called if the subscription errors.
   * @returns A canceller that unsubscribes.
   */
  async meltQuoteUpdates<T extends MeltQuoteGenericResponse = MeltQuoteGenericResponse>(
    ids: string[],
    cb: (p: T) => void,
    err: (e: Error) => void,
    opts?: SubscribeOpts,
  ): Promise<SubscriptionCanceller> {
    return this.quoteUpdates<T>('melt', ids, cb, err, opts);
  }

  /**
   * Subscribe to a single melt quote and fire once it reaches PAID.
   *
   * @param id Melt quote id to subscribe to.
   * @param cb Called once the quote is PAID.
   * @param err Called if the subscription errors.
   * @returns A canceller that unsubscribes.
   */
  async meltQuotePaid<T extends MeltQuoteGenericResponse = MeltQuoteGenericResponse>(
    id: string,
    cb: (p: T) => void,
    err: (e: Error) => void,
    opts?: SubscribeOpts,
  ): Promise<SubscriptionCanceller> {
    return this.meltQuoteUpdates<T>(
      [id],
      (p) => {
        if (isMeltQuotePaid(p)) cb(p);
      },
      err,
      opts,
    );
  }

  /**
   * Register a callback to be called whenever a subscribed proof state changes.
   *
   * Only `secret` is read from each proof to derive the subscription filter; any `ProofLike`-shaped
   * object (e.g. proofs loaded from storage where `amount` has not yet been normalized to `Amount`)
   * may be passed without conversion. The original proof object is echoed back on the callback
   * payload as the inferred input type.
   *
   * @param proofs List of proofs that should be subscribed to.
   * @param callback Callback function that will be called whenever a proof's state changes.
   * @param errorCallback
   * @returns
   */
  async proofStateUpdates<T extends ProofLike = Proof>(
    proofs: T[],
    cb: (payload: ProofState & { proof: T }) => void,
    err: (e: Error) => void,
    opts?: SubscribeOpts,
  ): Promise<SubscriptionCanceller> {
    await this.wallet.mint.connectWebSocket();
    const ws = this.wallet.mint.webSocketConnection;
    if (!ws) throw new CTSError('Failed to establish WebSocket connection.');

    const enc = new TextEncoder();
    // Object.create(null) avoids prototype-key collisions: a mint sending
    // payload.Y === '__proto__' (or 'constructor', etc.) would otherwise
    // resolve to an inherited property and bypass the unknown-Y guard below.
    const proofMap = Object.create(null) as Record<string, T>;
    for (const p of proofs) {
      const y = isBlsKeyset(p.id)
        ? hashToCurveBls(enc.encode(p.secret)).toHex(true)
        : hashToCurve(enc.encode(p.secret)).toHex(true);
      if (proofMap[y]) {
        throw new CTSError('Duplicate proof secret in proofStateUpdates input');
      }
      proofMap[y] = p;
    }
    const ys = Object.keys(proofMap);

    const handler = (payload: ProofState) => {
      const proof = proofMap[payload.Y];
      if (!proof) return; // ignore unsolicited Y from a misbehaving mint
      cb({ ...payload, proof });
    };
    const subId = ws.createSubscription({ kind: 'proof_state', filters: ys }, handler, err);
    const cancel = () => ws.cancelSubscription(subId, handler);

    return this.withAbort(opts?.signal, cancel);
  }

  /**
   * Resolve once a mint quote becomes mintable, then auto-unsubscribe.
   *
   * @remarks
   * The subscription is always cancelled after resolution, rejection, timeout, or abort. "Mintable"
   * is defined as in `mintQuotePaid`.
   * @param id Mint quote id to watch.
   * @param opts Optional controls.
   * @param opts.signal AbortSignal to cancel the wait early.
   * @param opts.timeoutMs Milliseconds to wait before rejecting with a timeout error.
   * @returns A promise that resolves with the mint quote once it is mintable.
   */
  onceMintPaid<T extends MintQuoteGenericResponse = MintQuoteGenericResponse>(
    id: string,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T> {
    return this.waitUntilPaid<T>(
      (qid, cb, err, o) => this.mintQuotePaid<T>(qid, cb, err, o),
      id,
      opts,
      'Timeout waiting for mint paid',
    );
  }

  /**
   * Resolve when ANY of several mint quotes becomes mintable, cancelling the rest.
   *
   * @remarks
   * Resolves with `{ id, quote }` for the first mintable quote. Per-subscription errors are ignored
   * by default (set `failOnError` to reject on the first); if all error and none resolve, rejects
   * with the last error.
   * @param ids Array of mint quote ids (duplicates are ignored).
   * @param opts Optional controls.
   * @param opts.signal AbortSignal to cancel the wait early.
   * @param opts.timeoutMs Milliseconds to wait before rejecting with a timeout error.
   * @param opts.failOnError When true, reject on first error. Default false.
   * @returns A promise resolving to the id that won and its mint quote.
   */
  onceAnyMintPaid<T extends MintQuoteGenericResponse = MintQuoteGenericResponse>(
    ids: string[],
    opts?: { signal?: AbortSignal; timeoutMs?: number; failOnError?: boolean },
  ): Promise<{ id: string; quote: T }> {
    return new Promise((resolve, reject) => {
      const unique = Array.from(new Set(ids));
      const cancels: Map<string, CancellerLike> = new Map();
      let to: ReturnType<typeof setTimeout> | null = null;
      let lastError: unknown = null;
      let fullyRegistered = false;
      let done = false;

      const cleanup = (err?: unknown) => {
        if (done) return;
        done = true;
        for (const c of cancels.values()) {
          cancelSafely(c);
        }
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
          () => cleanup(new CTSError('Timeout waiting for any mint paid')),
          opts.timeoutMs,
        );
      }

      if (unique.length === 0) return cleanup(new CTSError('No quote ids provided'));

      for (const quoteId of unique) {
        const c = this.mintQuotePaid<T>(
          quoteId,
          (p) => {
            cleanup();
            resolve({ id: quoteId, quote: p });
          },
          (e) => {
            // Catch errors after setup
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

            if (fullyRegistered && cancels.size === 0) {
              cleanup(lastError ?? new CTSError('No subscriptions remaining'));
            }
          },
        );

        cancels.set(quoteId, c);

        // Catch errors setting up
        void c.catch((e) => {
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

          if (fullyRegistered && cancels.size === 0) {
            cleanup(lastError ?? new CTSError('No subscriptions remaining'));
          }
        });
      }

      fullyRegistered = true;
    });
  }

  /**
   * Resolve once a melt quote reaches PAID, then auto-unsubscribe.
   *
   * @remarks
   * Mirrors `onceMintPaid`, but for melts. The subscription is always cancelled after resolution,
   * rejection, timeout, or abort.
   * @param id Melt quote id to watch.
   * @param opts Optional controls.
   * @param opts.signal AbortSignal to cancel the wait early.
   * @param opts.timeoutMs Milliseconds to wait before rejecting with a timeout error.
   * @returns A promise that resolves with the melt quote once PAID.
   */
  onceMeltPaid<T extends MeltQuoteGenericResponse = MeltQuoteGenericResponse>(
    id: string,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T> {
    return this.waitUntilPaid<T>(
      (qid, cb, err, o) => this.meltQuotePaid<T>(qid, cb, err, o),
      id,
      opts,
      'Timeout waiting for melt paid',
    );
  }

  /**
   * Async iterable that yields proof state updates for the provided proofs.
   *
   * @remarks
   * Adds a bounded buffer option:
   *
   * - If `maxBuffer` is set and the queue is full when a new payload arrives, either drop the oldest
   *   queued payload (`drop: 'oldest'`, default) or the incoming payload (`drop: 'newest'`). In
   *   both cases `onDrop` is invoked with the dropped payload.
   *
   * The stream ends and cleans up on abort. Errors from the wallet (e.g. a WebSocket failure or an
   * RPC error from the mint) are thrown from the iterator — wrap the `for await` in `try/catch` to
   * recover. Normal completion happens only when the consumer breaks out of the loop or the abort
   * signal fires.
   *
   * The subscription is sent to the mint on the first iteration, not when this method is called.
   * Per NUT-17 the mint replays the current state on subscribe, so the latest state is never lost;
   * only intermediate transitions before the first iteration are collapsed into that snapshot.
   * @example
   *
   * ```ts
   * const ac = new AbortController();
   * try {
   *   for await (const update of wallet.on.proofStatesStream(myProofs)) {
   *     if (update.state === CheckStateEnum.SPENT) {
   *       console.warn('Spent proof', update.proof.id);
   *     }
   *   }
   * } catch (e) {
   *   if ((e as Error).name !== 'AbortError') {
   *     console.error('Stream error', e);
   *   }
   * }
   * ```
   *
   * @param proofs The proofs to subscribe to. Only `secret` is required, so any `ProofLike`-shaped
   *   object may be passed without first normalizing `amount` to `Amount`.
   * @param opts Optional controls.
   * @param opts.signal AbortSignal that stops the stream when aborted.
   * @param opts.maxBuffer Maximum number of queued items before applying the drop strategy.
   * @param opts.drop Overflow strategy when `maxBuffer` is reached, 'oldest' | 'newest'. Default
   *   'oldest'.
   * @param opts.onDrop Callback invoked with the payload that was dropped.
   * @returns An async iterable of update payloads. The `proof` field on each payload preserves the
   *   input proof type.
   */
  proofStatesStream<P extends ProofLike = Proof>(
    proofs: P[],
    opts?: {
      signal?: AbortSignal;
      maxBuffer?: number;
      drop?: 'oldest' | 'newest';
      onDrop?: (payload: ProofState & { proof: P }) => void;
    },
  ): AsyncIterable<ProofState & { proof: P }> {
    type Payload = ProofState & { proof: P };
    return async function* (this: WalletEvents) {
      const queue: Payload[] = [];
      let done = false;
      let notify: (() => void) | null = null;

      const max = opts?.maxBuffer && opts.maxBuffer > 0 ? opts.maxBuffer : Infinity;
      const dropMode: 'oldest' | 'newest' = opts?.drop ?? 'oldest';

      const wake = () => {
        const n = notify;
        notify = null;
        if (n) n();
      };

      const push = (payload: Payload) => {
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
      // Captures errors from either source so a single throw at the end of the loop surfaces
      // them: (1) setup-promise rejection (e.g. duplicate proof secrets) via cancelP.catch, or
      // (2) runtime wallet/websocket error via the proofStateUpdates err callback.
      let streamErr: Error | null = null;
      const cancelP: Promise<SubscriptionCanceller> = this.proofStateUpdates<P>(
        proofs,
        push,
        (e: Error) => {
          streamErr = e;
          done = true;
          wake();
        },
        { signal: opts?.signal },
      );
      // Attach in the same tick so a synchronous setup failure cannot escape as an unhandled
      // rejection. The error is surfaced once the loop drains.
      cancelP.catch((e: unknown) => {
        streamErr = normalizeError(e);
        done = true;
        wake();
      });

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
        // Check after the loop, not inside. The error sources above set done=true before waking
        // the awaited notify, so the next loop iteration exits immediately and an in-loop throw
        // would never be reached.
        if (streamErr) {
          const err: Error = streamErr;
          throw err;
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
