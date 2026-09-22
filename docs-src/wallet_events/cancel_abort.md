# <a href="/">Documents</a> › [Wallet Events](../wallet_events/wallet_events.md) › **Cancel and Abort**

# Cancel and Abort

Subscriptions should be cancelled when no longer needed to avoid leaks and keep your app tidy.

The simplest way to cancel a subscription is to call its cancel handle.

```ts
const cancelSub = wallet.on.countersReserved(({ counterKey, next }) => {
  void saveNextToDb(counterKey, next).catch(console.error);
});

// later
cancelSub();
```

Subscriptions also accept an `AbortSignal`. Aborting stops the stream and cleans up.

```ts
// Create an abort controller
const ac = new AbortController();

// Setup subscriptions to use abort signal
wallet.on.countersReserved(
  ({ counterKey, next }) => {
    void saveNextToDb(counterKey, next).catch(console.error);
  },
  { signal: ac.signal }, // abort controller
);

// when done... trigger the abort signal
ac.abort();

// eg: via DOM events:
window.addEventListener('pagehide', () => ac.abort(), { once: true });
window.addEventListener('beforeunload', () => ac.abort(), { once: true });
```

The `once*` helpers are always cancelled automatically after resolution or rejection, as well as on timeout or abort:

```ts
try {
  const paid = await wallet.on.onceMintPaid(quoteId, {
    signal: ac.signal,
    timeoutMs: 60_000,
  });
  console.log('Paid', paid.amount);
} catch (e) {
  console.warn('Not paid in time or aborted', e);
}
```

## Cancelling wallet operations

Wallet operations take the same `AbortSignal`. Reads and quote checks take it as a trailing options argument, the operation configs and builders carry it as `signal`, and an aborted call rejects with `CallerAbortError`.

```ts
const ac = new AbortController();

// A read or a quote check: the signal covers the whole call.
const quote = await wallet.checkMintQuoteBolt11(quoteId, { signal: ac.signal });

// A one-shot operation honours the signal only until preparation finishes, so a swap the
// mint may already have processed is never abandoned with its outputs unknown.
const { keep, send } = await wallet.ops.send(5, myProofs).signal(ac.signal).run();

// To be able to cancel the commit itself, prepare first. The preview holds the outputs, so a
// cancelled complete can be retried with the same preview (NUT-19 replay) or restored (NUT-09).
const preview = await wallet.ops.send(5, myProofs).prepare();
const result = await wallet.completeSwap(preview, undefined, { signal: ac.signal });
```

`completeMint`, `completeBatchMint` and `completeMelt` take the signal the same way. Lazy key fetches inside the keychain are not covered; they are single idempotent GETs bounded by the request timeout.
