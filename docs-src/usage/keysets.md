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

## Self-repair when the mint rejects a keyset

A wallet loaded before a rotation has nothing unrecognized to trip the repair above: its snapshot
still calls the retired keyset active, so it builds outputs on it and the mint is the only party
that knows better. When `completeSwap`, `completeMint`, `completeBatchMint`, or `completeMelt` is
rejected with a NUT-00 keyset error (the 12xxx class: unknown, inactive, or expired keyset), the
wallet takes that as rotation evidence, refreshes the snapshot, and throws `StaleKeysetError` with
the mint's error as `cause`.

Its `repaired` flag says whether the refresh actually ran. `true` means the snapshot is current
again, so running your call a second time should succeed (a 12001 caused by an input proof from
another mint refreshes cleanly and still fails). `false` means nothing changed (strict mode, a
failed refresh, or the rate limit below) and the next move is yours. Nothing retries for you: the
rejected outputs were built on the stale keyset, so the wallet heals the snapshot and hands the
decision back.

```ts
try {
  return await wallet.receive(token);
} catch (e) {
  if (!(e instanceof StaleKeysetError) || !e.repaired) throw e;
  return wallet.receive(token); // the snapshot is current now
}
```

The same shape applies to the split flow: re-run your `prepare*` before completing again, since the
outputs in hand are the rejected ones. On a seeded wallet that reserves fresh counters; the
abandoned ones are recoverable with a NUT-09 restore.

### Repair rate limit

Internal repairs are limited to one per minute per wallet. Inside that window the wallet skips the
refresh and throws the terminal error immediately (`UnknownKeysetError`, or `StaleKeysetError`
with `repaired: false`), so a service fed a stream of junk keyset ids cannot be turned into a
stream of outbound mint requests. Refreshes you ask for yourself are never rate limited, though a
repair triggered by `ensureOperableKeysets()` does start the window for the next internal one;
`loadMint(true)` does not, since it never goes through the repair path.

## Preparing the snapshot yourself: `ensureOperableKeysets`

`await wallet.ensureOperableKeysets(ids)` runs the same repair on demand: unknown ids get one
`loadMint(true)`, keysets held without keys get theirs fetched, and an id the mint does not know
throws `UnknownKeysetError`. Useful for integrations that verify proofs, or reconstruct persisted
`outputData`, without running a wallet operation.

Because it is an explicit request, it ignores both `strictCachedKeysets` and the repair rate limit:
strict mode exists to stop network calls you did not ask for, and this is one you did. For the same
reason it emits no `keychainUpdated`, so persist `wallet.keyChain.cache` yourself afterwards. It
needs a loaded wallet, and says so rather than quietly doing nothing.

## Refreshing deliberately: `loadMint(true)`

Call `loadMint(true)` yourself to follow a mint proactively, for example on a schedule in a
long-lived service. It:

- refreshes metadata (active flags, fees) from the mint, re-fetching keys for active keysets,
- keeps the keys the wallet already holds for any keyset the mint no longer serves,
- rebinds an auto-bound wallet (constructed without `keysetId`, never `bindKeyset()`-ed) to the
  cheapest active keyset on every refresh, including the internal repair (newest keyset version
  first, then lowest fee, then latest expiry).

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

This event does not fire for `restore`'s own lazy key fetch, or for calls you make yourself
(`loadMint()`, `loadMint(true)`, `ensureOperableKeysets()`): persist `wallet.keyChain.cache`
yourself after those (see [Create Wallet](./create_wallet.md)).

## Strict cached keysets

Set `strictCachedKeysets: true` in the `Wallet` constructor options if you run your own
persistence or state layer (eg a coco-style wallet) and want CTS to operate only on the keyset
state you load, with no network call happening behind your back. With it set, operations never
call `/v1/keysets` or `/v1/keys` on their own; the only calls that touch the network are the ones
you make yourself (`loadMint`, `loadMint(true)`, `keyChain.ensureKeysetKeys`,
`ensureOperableKeysets`). An unrecognized keyset id throws `UnknownKeysetError` immediately, with
no repair attempt; a known keyset with missing keys throws the same typed errors non-strict mode
throws once its own repair path is exhausted (eg `No keys loaded for keyset X` from receive, or
`Keyset has no keys loaded` from `restore`). A mint rejecting a keyset mid-operation throws
`StaleKeysetError` with `repaired: false`, since strict mode does not refresh on its own.
`keychainUpdated` never fires under strict mode, since nothing internal mutates the snapshot. Use
`keyChain.ensureKeysetKeys(id)` or `loadMint(true)` to refresh deliberately; those keep their
normal semantics, including `loadMint(true)`'s carry-forward and rebind rules. `restore` and
`batchRestore` throw on a keyset without loaded keys under strict mode, so restoring across a
rotation needs `keyChain.ensureKeysetKeys` called for each keyset first (or a fresh `loadMint`).
Melt change that arrives on a keyset your snapshot holds keyless throws after the mint has already
spent the inputs; recover with the persisted `outputData` plus an explicit `ensureKeysetKeys` and
`createMeltChangeProofs` call, as documented on that method. Wallets created with `withKeyset()`
inherit the strict flag from their parent, so derived wallets respect the same network constraints.

## Long-lived wallets

A wallet that stays in memory across a mint rotation does not need proactive maintenance: the next
`receive` or melt change that meets an unrecognized keyset id repairs itself. Call `loadMint(true)`
yourself when you want the wallet to reflect a rotation ahead of that, eg to keep
`wallet.getMintInfo()` current, or to follow the mint's cheapest keyset immediately rather than
waiting for an operation to force the issue.

## Related docs

- [Create Wallet](./create_wallet.md) for `loadMint()` / `loadMintFromCache()` and initial setup.
- [WalletEvents](../wallet_events/wallet_events.md) for subscription patterns (`signal`, timeouts,
  grouping).
- Rotation behavior end to end:
  [`wallet-rotation.node.test.ts`](https://github.com/cashubtc/cashu-ts/blob/v4-dev/test/wallet/wallet-rotation.node.test.ts).
