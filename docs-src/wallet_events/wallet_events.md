[Documents](../index.html) › **Wallet Events**

# WalletEvents – Event Subscriptions

`wallet.on` exposes event subscriptions for counters, quotes, melts, and proof states. Each method returns a canceller function. You can bind an `AbortSignal`, set a timeout, or group cancellers and dispose them together.

**Subscriptions:**

- `wallet.on.countersReserved(cb, { signal })` – deterministic counter reservations
- `wallet.on.mintQuoteUpdates(ids, onUpdate, onErr, { signal })` – live mint quote updates
- `wallet.on.meltQuoteUpdates(ids, onUpdate, onErr, { signal })` – live melt quote updates
- `wallet.on.proofStateUpdates(proofs, onUpdate, onErr, { signal })` – push updates
- `wallet.on.proofStatesStream(proofs, opts)` – async iterator with bounded buffer

> **Note:** For the 'Updates' subscriptions, the first call auto-establishes a mint WebSocket and errors surface via the onErr callback.

**One-shot helpers:**

- `wallet.on.onceMintPaid(id, { signal, timeoutMs })` – resolve once quote paid
- `wallet.on.onceMeltPaid(id, { signal, timeoutMs })` – resolve once melt paid
- `wallet.on.onceAnyMintPaid(ids, { signal, timeoutMs })` – resolve when any paid

**Grouping:**

- `wallet.on.group()` – collect many cancellers, dispose all at once
