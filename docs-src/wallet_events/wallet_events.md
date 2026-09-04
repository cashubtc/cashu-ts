# <a href="/">Documents</a> › **Wallet Events**

# WalletEvents – Event Subscriptions

`wallet.on` exposes event subscriptions for counters, quotes, melts, and proof states. Each method returns a canceller function. You can bind an `AbortSignal`, set a timeout, or group cancellers and dispose them together.

**Subscriptions:**

- `wallet.on.countersReserved(cb, { signal })` – deterministic counter reservations
- `wallet.on.mintQuoteUpdates(ids, onUpdate, onErr, { signal })` – live mint quote updates
- `wallet.on.meltQuoteUpdates(ids, onUpdate, onErr, { signal })` – live melt quote updates
- `wallet.on.proofStateUpdates(proofs, onUpdate, onErr, { signal })` – push updates
- `wallet.on.proofStatesStream(proofs, opts)` – async iterator with bounded buffer

> **Note:** For the 'Updates' subscriptions, the first call auto-establishes a mint WebSocket and errors surface via the onErr callback.

**Polling fallback:** every subscription and one-shot helper takes `pollMs`. Set it and the watch degrades instead of failing: it polls the matching check endpoint at that interval when the mint's NUT-17 info does not list the subscription kind, when the socket fails, or when no state replay arrives within `replayTimeoutMs` (default 10 s) of subscribing. Polling reports an item only when its state changes, so callbacks see the same payloads either way; `onMode` says which transport is running. Keep the interval generous, every poll counts against the mint's rate limit, which is why the socket is tried first. Several mint quotes poll through the batched check where the mint has it; melt quotes have no batched check, so they cost one request each per poll. A failed poll doubles the wait before the next; three in a row surface the last error.

```ts
const paid = await wallet.on.onceMintPaid(quoteId, { pollMs: 15_000, timeoutMs: 600_000 });
```

**One-shot helpers:**

- `wallet.on.onceMintPaid(id, { signal, timeoutMs })` – resolve once quote paid
- `wallet.on.onceMeltPaid(id, { signal, timeoutMs })` – resolve once melt paid
- `wallet.on.onceAnyMintPaid(ids, { signal, timeoutMs })` – resolve when any paid

**Grouping:**

- `wallet.on.group()` – collect many cancellers, dispose all at once
