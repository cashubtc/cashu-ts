[Documents](../index.html) › [Wallet Events](../wallet_events/wallet_events.md) › **Grouped Cancellers**

# Grouped cancellers

```ts
const cancelAll = wallet.on.group();
cancelAll.add(wallet.on.mintQuoteUpdates(ids, onMint, onErr));
cancelAll();
// safe to call multiple times
```
