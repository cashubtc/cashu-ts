# Grouped cancellers

```ts
const cancelAll = wallet.on.group();
cancelAll.add(wallet.on.mintQuoteUpdates(ids, onMint, onErr));
cancelAll();
// safe to call multiple times
```

