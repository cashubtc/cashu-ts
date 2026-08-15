# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Keysets & Rotation**

# Keysets and mint rotation

A `Wallet` is a snapshot of mint state, taken by `loadMint()` or `loadMintFromCache()`. This
recipe covers what the snapshot does and does not track on its own, and how to keep a long-lived
wallet correct as a mint rotates keysets (eg a periodic proof-of-liabilities rotation).

## What never changes on its own

Keyset metadata (active flags, `input_fee_ppk`) and the wallet's bound keyset (`wallet.keysetId`)
are fixed at snapshot time. The mint can activate, retire, or add keysets between snapshots; the
wallet keeps reporting what it last saw until something refreshes it.

## What loads lazily

Key material for a keyset id the snapshot already has as metadata may still complete
asynchronously, inside `receive`, melt change handling, and `restore`. Keys are immutable per
keyset id and are verified against that id once fetched, so completing them lazily is safe.

This is deliberate: the inactive-keyset set only grows as a mint rotates, so eagerly fetching keys
for every retired keyset on each `loadMint()` would cost an unbounded series of
`/v1/keys/{id}` calls. Keys load only for the keysets an operation actually touches.

## Self-repair for an unrecognized keyset id

If an operation meets a proof whose keyset id is not in the snapshot at all, it refreshes once
internally via `loadMint(true)` and retries. If the id is still unknown afterwards, the operation
throws `UnknownKeysetError`. The same error is thrown, with the transport failure as `cause`, if
the refresh itself fails.

The repair runs at most once per operation. It exists to pick up a keyset that rotated in since
your last `loadMint()`, not to tolerate a proof from an unrelated mint.

This applies to `receive` and melt change: both resolve unrecognized keyset ids through this path.
`restore` fetches keys directly and does not go through it, so an unknown keyset id there throws a
plain `CTSError` with no retry.

## Refreshing deliberately: `loadMint(true)`

Call `loadMint(true)` yourself to follow a mint proactively, for example on a schedule in a
long-lived service. It:

- refreshes metadata (active flags, fees) from the mint, re-fetching keys for active keysets,
- keeps the keys the wallet already holds for any keyset the mint no longer serves,
- rebinds an auto-bound wallet (constructed without `keysetId`, never `bindKeyset()`-ed) to the
  cheapest active keyset, but only once its current one is no longer usable (missing, inactive, or
  without keys). A still-usable binding is left alone even if a cheaper keyset is now active.

A wallet pinned via the `keysetId` constructor option or a `bindKeyset()` call stays pinned across
the refresh, even if its keyset has since gone inactive.

## Keeping a cache in sync

Subscribe to `wallet.on.keychainUpdated` to re-persist your cached keychain when `receive` or melt
change completion lazily loads keys or repairs an unrecognized keyset id:

```ts
wallet.on.keychainUpdated(({ cache }) => {
  saveKeychainToDb(cache); // your atomic save, e.g. IndexedDB or a KV store
});
```

This event does not fire for `restore`'s own lazy key fetch, or for your own explicit
`loadMint()` / `loadMint(true)` calls: persist `wallet.keyChain.cache` yourself after those (see
[Create Wallet](./create_wallet.md)).

## Long-lived wallets

A wallet that stays in memory across a mint rotation does not need proactive maintenance: the next
`receive` or melt change that meets an unrecognized keyset id repairs itself. Call `loadMint(true)`
yourself when you want the wallet to reflect a rotation ahead of that, eg to keep
`wallet.getMintInfo()` current, or to rebind sooner once your current keyset stops being usable
rather than waiting for an operation to force the issue.

## Related docs

- [Create Wallet](./create_wallet.md) for `loadMint()` / `loadMintFromCache()` and initial setup.
- [WalletEvents](../wallet_events/wallet_events.md) for subscription patterns (`signal`, timeouts,
  grouping).
- Rotation behavior end to end:
  [`wallet-rotation.node.test.ts`](https://github.com/cashubtc/cashu-ts/blob/main/test/wallet/wallet-rotation.node.test.ts).
