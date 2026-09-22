# <a href="/">Documents</a> › [Wallet Operations](../wallet_ops/wallet_ops.md) › **Error Handling Patterns**

# Error handling patterns

```ts
try {
  const res = await wallet.ops.send(5, proofs).offlineExactOnly().run();
  console.log('Sent:', res.send.length, 'Kept:', res.keep.length);
} catch (e) {
  // e is a proper Error (WalletOps normalizes unknowns internally)
  if ((e as Error).message.includes('Timeout')) {
    // …
  }
  throw e;
}
```

## Concurrent operations

cashu-ts does not lock proof sets. Each call only sees the proofs it is given, and your proof store is invisible to the library, so nothing stops two operations (in one `Wallet`, in two instances, or in two tabs or processes) from spending the same proofs at once. Serialising operations on the same proofs is the app's job. When two operations race on overlapping proofs, one succeeds and the other fails at the mint with `11001` (token already spent) or, while the winner's swap is still settling, `11002` (token pending). Treat `11002` as "check again": re-run `checkProofsStates` before deciding anything, and never delete proofs on it. Each losing attempt also consumes deterministic counters, which is harmless but visible in a restore.
