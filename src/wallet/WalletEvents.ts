import { hashToCurve, hashToCurveBls, isBlsKeyset } from '../crypto';
import { safeCallback } from '../logger';
import { CTSError, HttpResponseError } from '../model/Errors';
import { MintQuoteState, MeltQuoteState } from '../model/types';
import type {
  Proof,
  ProofLike,
  ProofState,
  MeltQuoteBolt11Response,
  MintQuoteBolt11Response,
  RpcSubKinds,
} from '../model/types';
import type { KeyChainCache } from '../model/types/keyset';

import { type OperationCounters } from './CounterSource';
import type { Wallet } from './Wallet';

export type SubscriptionCanceller = () => void;

export type CancellerLike = SubscriptionCanceller | Promise<SubscriptionCanceller>;

export type SubscribeOpts = { signal?: AbortSignal };

/**
 * Options for a NUT-17 subscription that may fall back to polling.
 */
export type WatchOpts = SubscribeOpts & {
  /**
   * Poll the mint every this many milliseconds instead of, or after, the websocket: when the mint's
   * NUT-17 info does not list the subscription kind, when the socket fails, or when no state replay
   * arrives within `replayTimeoutMs` of subscribing. Unset, the subscription is websocket only and
   * its failure reaches the error callback.
   */
  pollMs?: number;
  /**
   * Grace for NUT-17 state replay before the socket counts as dead, in milliseconds. Default 10000.
   */
  replayTimeoutMs?: number;
  /**
   * Reports the transport in use, once per switch.
   */
  onMode?: (mode: 'websocket' | 'polling') => void;
};

/**
 * Options for {@link WalletEvents.proofStatesStream}.
 */
export type ProofStatesStreamOpts<P extends ProofLike = Proof> = WatchOpts & {
  /**
   * Maximum queued payloads before `drop` applies.
   */
  maxBuffer?: number;
  /**
   * Overflow strategy when `maxBuffer` is reached. Default 'oldest'.
   */
  drop?: 'oldest' | 'newest';
  /**
   * Called with each dropped payload.
   */
  onDrop?: (payload: ProofState & { proof: P }) => void;
};

/**
 * How to poll for what a subscription would push: `fetch` reads the current items, `key` identifies
 * one across polls and `state` is the field a change is judged on.
 */
type Poller<T> = { fetch: () => Promise<T[]>; key: (p: T) => string; state: (p: T) => string };

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

/**
 * A canceller that runs once: the abort hook and a stream's own cleanup can both reach it, and a
 * second unsubscribe for the same id is an RPC error at the mint.
 */
function once(cancel: SubscriptionCanceller): SubscriptionCanceller {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    cancel();
  };
}

/**
 * Resolves after `ms`, or at once when `signal` aborts.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// NUT-17 replays the current state on subscribe; this long without it and the socket counts as dead
const REPLAY_GRACE_MS = 10_000;
// Consecutive failed polls before a watch gives up, each waited out twice as long as the last
const POLL_FAILURE_LIMIT = 3;

export class WalletEvents {
  constructor(private wallet: Wallet) {}

  // Callbacks registered for Counters Reserved events
  private countersReservedHandlers = new Set<(payload: OperationCounters) => void>();

  // Callbacks registered for Keychain Updated events
  private keychainUpdatedHandlers = new Set<(payload: { cache: KeyChainCache }) => void>();

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

  // One NUT-17 subscription, cancelled through `signal`
  private async _subscribe<W>(
    kind: RpcSubKinds,
    filters: string[],
    cb: (wire: W) => void,
    err: (e: Error) => void,
    signal?: AbortSignal,
  ): Promise<SubscriptionCanceller> {
    await this.wallet.mint.connectWebSocket();
    const ws = this.wallet.mint.webSocketConnection;
    if (!ws) throw new CTSError('Failed to establish WebSocket connection.');
    const subId = ws.createSubscription<W>({ kind, filters }, cb, err);
    return this.withAbort(
      signal,
      once(() => ws.cancelSubscription(subId, cb)),
    );
  }

  // Whether the mint says it pushes `kind`. Unknown until mint info is loaded; then the socket decides
  private _pushes(kind: RpcSubKinds): boolean {
    try {
      const nut17 = this.wallet.getMintInfo().isSupported(17);
      return nut17.params?.some((p) => p.commands.includes(kind)) ?? false;
    } catch {
      return true;
    }
  }

  /**
   * A NUT-17 subscription with polling behind it.
   *
   * @remarks
   * The socket is tried first unless the mint's info rules `kind` out, and gives way to polling
   * when it fails to set up, errors later, or stays silent past the replay grace: the mint replays
   * the current state on subscribe, so silence means a dead socket, which the transport may keep
   * quietly reconnecting. Polling reports an item only when its state changes, so callers see the
   * same payloads either way. Without `pollMs` this is the plain subscription.
   */
  private async _watch<T, W = T>(
    socket: { kind: RpcSubKinds; filters: string[]; decode: (wire: W) => T | undefined },
    poll: Poller<T>,
    cb: (p: T) => void,
    err: (e: Error) => void,
    opts?: WatchOpts,
  ): Promise<SubscriptionCanceller> {
    const { kind, filters, decode } = socket;
    const deliver = (wire: W) => {
      const p = decode(wire);
      if (p !== undefined) cb(p);
    };
    const pollMs = opts?.pollMs;
    if (pollMs === undefined) return this._subscribe(kind, filters, deliver, err, opts?.signal);
    if (!(pollMs > 0)) throw new CTSError('pollMs must be a positive number');
    const mode = (m: 'websocket' | 'polling') =>
      safeCallback(opts?.onMode, m, this.wallet.logger, { event: kind });

    const all = new AbortController(); // everything this watch owns
    const sub = new AbortController(); // the subscription alone, so polling can outlive it
    all.signal.addEventListener('abort', () => sub.abort(), { once: true });
    let grace: ReturnType<typeof setTimeout> | undefined;
    const startPolling = once(() => {
      clearTimeout(grace);
      sub.abort();
      if (all.signal.aborted) return;
      mode('polling');
      this._poll(poll, pollMs, all.signal, cb).catch(err);
    });
    const live = once(() => {
      clearTimeout(grace);
      mode('websocket');
    });

    if (this._pushes(kind)) {
      grace = setTimeout(startPolling, opts?.replayTimeoutMs ?? REPLAY_GRACE_MS);
      const onWire = (wire: W) => {
        live();
        deliver(wire);
      };
      this._subscribe(kind, filters, onWire, startPolling, sub.signal).catch(startPolling);
    } else {
      startPolling();
    }
    return this.withAbort(opts?.signal, () => all.abort());
  }

  // One request at a time: a burst is what trips a rate limit, and the first refusal ends the poll
  private async _eachQuote<T>(ids: string[], check: (id: string) => Promise<T>): Promise<T[]> {
    const out: T[] = [];
    for (const id of ids) out.push(await check(id));
    return out;
  }

  // Polling twin of a subscription: the first fetch stands in for the replay, later ones report changes
  private async _poll<T>(
    poll: Poller<T>,
    pollMs: number,
    signal: AbortSignal,
    cb: (p: T) => void,
  ): Promise<void> {
    const seen = new Map<string, string>();
    let failures = 0;
    while (!signal.aborted) {
      const changed: T[] = [];
      try {
        for (const item of await poll.fetch()) {
          const key = poll.key(item);
          const state = poll.state(item);
          if (seen.get(key) === state) continue;
          seen.set(key, state);
          changed.push(item);
        }
        failures = 0;
      } catch (e) {
        if (++failures >= POLL_FAILURE_LIMIT) throw normalizeError(e);
      }
      if (signal.aborted) return;
      for (const item of changed) cb(item);
      // A failed poll is often a rate limit, so back off before the next one
      await sleep(pollMs * 2 ** failures, signal);
    }
  }

  // Subscribe to a quote-paid event and resolve when it fires.
  // Supports AbortSignal and timeout, and always cleans up.
  private waitUntilPaid<T>(
    subscribeFn: (
      id: string,
      cb: (p: T) => void, // called when the entity becomes PAID
      err: (e: Error) => void, // called if the subscription itself errors
      opts?: WatchOpts,
    ) => Promise<SubscriptionCanceller>,
    id: string, // identifier of the mint/melt/etc. to watch
    opts?: WatchOpts & { timeoutMs?: number },
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
        opts, // abort and any polling fallback are the subscription's too
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

  /**
   * Register a callback that fires when the wallet updates its keychain from the network inside an
   * operation (eg after repairing an unknown keyset, or lazily loading keys).
   *
   * Typical use: re-persist `payload.cache` so your stored copy stays complete.
   *
   * @param cb Handler called with { cache }.
   * @returns A function that unsubscribes the handler.
   */
  public keychainUpdated(
    cb: (payload: { cache: KeyChainCache }) => void,
    opts?: SubscribeOpts,
  ): SubscriptionCanceller {
    this.keychainUpdatedHandlers.add(cb);
    const cancel = () => this.keychainUpdatedHandlers.delete(cb);
    return this.withAbort(opts?.signal, cancel);
  }

  /**
   * @internal
   */
  public _emitKeychainUpdated(): void {
    if (this.keychainUpdatedHandlers.size === 0) {
      return; // cache getter allocates; skip when nobody listens
    }
    const payload = { cache: this.wallet.keyChain.cache };
    for (const h of this.keychainUpdatedHandlers) {
      safeCallback(h, payload, this.wallet.logger, { event: 'keychainUpdated' });
    }
  }

  /**
   * Register a callback to be called whenever a mint quote's state changes.
   *
   * @remarks
   * With `opts.pollMs` the subscription falls back to polling: one batched check per poll for
   * several quotes, dropping to one request per quote only on a mint without the batch endpoint;
   * see {@link WatchOpts}.
   * @param ids List of mint quote IDs that should be subscribed to.
   * @param cb Callback function that will be called whenever a mint quote state changes.
   * @param err Called when the subscription fails, or when polling keeps failing.
   * @param opts Abort signal and polling fallback.
   * @returns A function that cancels the subscription.
   */
  async mintQuoteUpdates(
    ids: string[],
    cb: (p: MintQuoteBolt11Response) => void,
    err: (e: Error) => void,
    opts?: WatchOpts,
  ): Promise<SubscriptionCanceller> {
    const uniq = Array.from(new Set(ids));
    let batch = uniq.length > 1;
    const fetch = async () => {
      if (batch) {
        try {
          return await this.wallet.checkMintQuoteBatchBolt11(uniq);
        } catch (e) {
          // Only a missing endpoint means the mint cannot batch; anything else is the poll failing
          if (!(e instanceof HttpResponseError) || e.status !== 404) throw e;
          batch = false;
        }
      }
      return this._eachQuote(uniq, (id) => this.wallet.checkMintQuoteBolt11(id));
    };
    return this._watch<MintQuoteBolt11Response>(
      { kind: 'bolt11_mint_quote', filters: uniq, decode: (q) => q },
      { fetch, key: (q) => q.quote, state: (q) => q.state },
      cb,
      err,
      opts,
    );
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
    opts?: WatchOpts,
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
   * Register a callback to be called whenever a melt quote's state changes.
   *
   * @remarks
   * With `opts.pollMs` the subscription falls back to polling `checkMeltQuoteBolt11`. There is no
   * batched melt check, so that is one request per quote per poll: size `pollMs` to the number
   * watched; see {@link WatchOpts}.
   * @param ids List of melt quote IDs that should be subscribed to.
   * @param cb Callback function that will be called whenever a melt quote state changes.
   * @param err Called when the subscription fails, or when polling keeps failing.
   * @param opts Abort signal and polling fallback.
   * @returns A function that cancels the subscription.
   */
  async meltQuoteUpdates(
    ids: string[],
    cb: (p: MeltQuoteBolt11Response) => void,
    err: (e: Error) => void,
    opts?: WatchOpts,
  ): Promise<SubscriptionCanceller> {
    const uniq = Array.from(new Set(ids));
    return this._watch<MeltQuoteBolt11Response>(
      { kind: 'bolt11_melt_quote', filters: uniq, decode: (q) => q },
      {
        fetch: () => this._eachQuote(uniq, (id) => this.wallet.checkMeltQuoteBolt11(id)),
        key: (q) => q.quote,
        state: (q) => q.state,
      },
      cb,
      err,
      opts,
    );
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
    opts?: WatchOpts,
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
   * Only `secret` is read from each proof to derive the subscription filter; any `ProofLike`-shaped
   * object (e.g. proofs loaded from storage where `amount` has not yet been normalized to `Amount`)
   * may be passed without conversion. The original proof object is echoed back on the callback
   * payload as the inferred input type.
   *
   * @remarks
   * With `opts.pollMs` the subscription falls back to polling `checkProofsStates`; see
   * {@link WatchOpts}.
   * @param proofs List of proofs that should be subscribed to.
   * @param cb Callback function that will be called whenever a proof's state changes.
   * @param err Called when the subscription fails, or when polling keeps failing.
   * @param opts Abort signal and polling fallback.
   * @returns A function that cancels the subscription.
   */
  async proofStateUpdates<T extends ProofLike = Proof>(
    proofs: T[],
    cb: (payload: ProofState & { proof: T }) => void,
    err: (e: Error) => void,
    opts?: WatchOpts,
  ): Promise<SubscriptionCanceller> {
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
    return this._watch<ProofState & { proof: T }, ProofState>(
      {
        kind: 'proof_state',
        filters: Object.keys(proofMap),
        // an unsolicited Y from a misbehaving mint is dropped
        decode: (state) => {
          const proof = proofMap[state.Y];
          return proof ? { ...state, proof } : undefined;
        },
      },
      {
        fetch: async () => {
          const states = await this.wallet.checkProofsStates(proofs);
          return states.map((state, i) => ({ ...state, proof: proofs[i] }));
        },
        key: (p) => p.proof.secret,
        state: (p) => p.state,
      },
      cb,
      err,
      opts,
    );
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
   *   const paid = await wallet.on.onceMintPaid(quoteId, {
   *     signal: ac.signal,
   *     timeoutMs: 60_000,
   *   });
   *   console.log('Mint paid, amount', paid.amount);
   * } catch (e) {
   *   if ((e as Error).name === 'AbortError') {
   *     console.log('User aborted');
   *   } else {
   *     console.error('Mint not paid', e);
   *   }
   * }
   * ```
   *
   * @param id Mint quote id to watch.
   * @param opts Optional controls.
   * @param opts.signal AbortSignal to cancel the wait early.
   * @param opts.timeoutMs Milliseconds to wait before rejecting with a timeout error.
   * @param opts.pollMs Polling fallback interval, see {@link WatchOpts}.
   * @returns A promise that resolves with the latest `MintQuoteBolt11Response` once PAID.
   */
  onceMintPaid(
    id: string,
    opts?: WatchOpts & { timeoutMs?: number },
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
   *   timeoutMs: 120_000,
   * });
   * console.log('First top up paid', id, quote.preimage?.length);
   * ```
   *
   * @param ids Array of mint quote ids (duplicates are ignored).
   * @param opts Optional controls.
   * @param opts.signal AbortSignal to cancel the wait early.
   * @param opts.timeoutMs Milliseconds to wait before rejecting with a timeout error.
   * @param opts.failOnError When true, reject on first error. Default false.
   * @param opts.pollMs Polling fallback interval, see {@link WatchOpts}; `onMode` then reports per
   *   quote.
   * @returns A promise resolving to the id that won and its `MintQuoteBolt11Response`.
   */
  onceAnyMintPaid(
    ids: string[],
    opts?: WatchOpts & { timeoutMs?: number; failOnError?: boolean },
  ): Promise<{ id: string; quote: MintQuoteBolt11Response }> {
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

      // A quote that errors leaves the race; the last one out takes its error with it
      const drop = (quoteId: string, e: unknown) => {
        if (opts?.failOnError) return cleanup(e);
        lastError = e;
        cancelSafely(cancels.get(quoteId));
        cancels.delete(quoteId);
        if (fullyRegistered && cancels.size === 0) {
          cleanup(lastError ?? new CTSError('No subscriptions remaining'));
        }
      };
      const { pollMs, replayTimeoutMs, onMode } = opts ?? {};
      for (const quoteId of unique) {
        const c = this.mintQuotePaid(
          quoteId,
          (p) => {
            cleanup();
            resolve({ id: quoteId, quote: p });
          },
          (e) => drop(quoteId, e),
          { pollMs, replayTimeoutMs, onMode },
        );
        cancels.set(quoteId, c);
        void c.catch((e) => drop(quoteId, e)); // errors setting up
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
   *   const paid = await wallet.on.onceMeltPaid(meltId, { timeoutMs: 45_000 });
   *   console.log('Invoice paid by mint, paid msat', paid.paid ?? 0);
   * } catch (e) {
   *   console.error('Payment did not complete in time', e);
   * }
   * ```
   *
   * @param id Melt quote id to watch.
   * @param opts Optional controls.
   * @param opts.signal AbortSignal to cancel the wait early.
   * @param opts.timeoutMs Milliseconds to wait before rejecting with a timeout error.
   * @param opts.pollMs Polling fallback interval, see {@link WatchOpts}.
   * @returns A promise that resolves with the `MeltQuoteBolt11Response` once PAID.
   */
  onceMeltPaid(
    id: string,
    opts?: WatchOpts & { timeoutMs?: number },
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
   *
   * With `pollMs` the stream degrades instead of failing, see {@link WatchOpts}: payloads look the
   * same in both modes and `onMode` says which one is running. The websocket stays first for a
   * reason: every poll counts against the mint's rate limit.
   * @example
   *
   * ```ts
   * const ac = new AbortController();
   * try {
   *   for await (const update of wallet.on.proofStatesStream(myProofs, { pollMs: 30_000 })) {
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
   * @param opts Optional controls, see {@link ProofStatesStreamOpts}.
   * @returns An async iterable of update payloads. The `proof` field on each payload preserves the
   *   input proof type.
   */
  proofStatesStream<P extends ProofLike = Proof>(
    proofs: P[],
    opts?: ProofStatesStreamOpts<P>,
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
        opts,
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
