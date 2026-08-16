# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Keysets & Rotation**

# Keysets and mint rotation

A `Wallet` is a snapshot of mint state, taken by `loadMint()` or `loadMintFromCache()`. Mints
rotate keysets (monthly, under proof-of-liabilities schemes), so snapshots go stale. This page is
what the wallet does about that.

## The snapshot

| Part of the snapshot                    | Changes on its own?                           |
| --------------------------------------- | --------------------------------------------- |
| Metadata: active flags, `input_fee_ppk` | No. Only on `loadMint(true)` or a repair.     |
| Bound keyset (`wallet.keysetId`)        | No, same.                                     |
| Keys for a keyset the snapshot knows    | Yes, fetched on demand by ops that need them. |

Keys load lazily because the retired-keyset set only grows: fetching every one up front would cost
an unbounded series of `/v1/keys/{id}` calls per load. Keys are immutable per keyset id and
verified against it, so loading them late is safe.

## When the wallet repairs itself

Two things count as evidence that a rotation happened. Both refresh the snapshot once, then throw:
the wallet heals, you decide what to do next.

**An unknown keyset id.** A proof names a keyset the snapshot has never seen. Every op that reads
input proof ids (`receive`, `send` and `prepareSwapToSend`, `prepareMelt` and the `meltProofs*`
wrappers) and melt change refresh once, then throw `UnknownKeysetError` if the id is still unknown
(or if the refresh itself failed, with that failure as `cause`). `restore` does not take this path:
an unknown id there throws a plain `CTSError`.

`UnknownKeysetError.refreshed` says how much weight to give it:

- **`true`** - the wallet asked the mint and the id is not there. Final.
- **`false`** - no answer from the mint (strict mode, rate limit, or a failed refresh). The id may
  be fine; a `loadMint(true)` or a retry can still resolve it.

**A mint rejection.** Your snapshot still calls a retired keyset active, so outputs get built on
it and only the mint knows better. `completeSwap`, `completeMint`, `completeBatchMint` and
`completeMelt` treat a NUT-00 keyset error (the 12xxx class) as evidence: they refresh, then throw
`StaleKeysetError` with the mint's error as `cause`.

`StaleKeysetError.repaired` tells you what to do:

- **`true`** - snapshot is current again, run your call a second time.
- **`false`** - nothing changed (strict mode, failed refresh, or rate limit). Your move.

```ts
try {
  return await wallet.receive(token);
} catch (e) {
  if (!(e instanceof StaleKeysetError) || !e.repaired) throw e;
  return wallet.receive(token); // the snapshot is current now
}
```

Using the split flow? Re-run your `prepare*` too: the outputs in hand are the rejected ones. On a
seeded wallet that reserves fresh counters, and the abandoned ones are recoverable with a NUT-09
restore.

One caveat on `repaired: true`: a 12001 caused by an input proof from a different mint also
refreshes cleanly, and your retry will still fail.

**Rate limit.** One repair per minute per wallet. Inside the window the wallet skips the refresh
and throws immediately, so a service fed junk keyset ids cannot be turned into a stream of mint
requests. Those errors report that the wallet did not check (`refreshed: false`, `repaired: false`)
rather than blaming the id, because one junk token can burn the window for genuine post-rotation
ones. Calls you make yourself are never rate limited.

**Melt change.** NUT-08 change is built after the mint has spent your inputs, so `completeMelt`
cannot simply fail when the change keyset will not resolve. It throws `MeltChangeError`, which
carries the blank `outputData` and the merged `quote`. The payment stands; rebuild the proofs once
the keys are reachable:

```ts
try {
  const { change } = await wallet.meltProofsBolt11(quote, proofs);
} catch (e) {
  if (!(e instanceof MeltChangeError)) throw e;
  const sigs = e.quote.change ?? [];
  // a permissive mint may sign change across keysets, so cover every id
  await wallet.ensureOperableKeysets(sigs.map((s) => s.id)); // or persist e.outputData for later
  const change = wallet.createMeltChangeProofs(e.outputData, sigs);
}
```

## Upgrading an existing handler

### Keyset rejections throw `StaleKeysetError`

Already branching on the 12xxx codes? That catch stops matching. A test for
`isMintOperationError(e) && e.code === 12002`, or `e instanceof MintOperationError`, around the
four complete-side ops now needs `StaleKeysetError`. The mint's error is still there as `e.cause`.

The class changes too. `MintOperationError` extends `HttpResponseError` and carries `status`;
`StaleKeysetError` extends `CTSError` and does not. Read both `code` and `status` off the cause.

```ts
// Before
if (isMintOperationError(e) && e.code === 12002) log(e.status);

// After
if (e instanceof StaleKeysetError && isMintOperationError(e.cause) && e.cause.code === 12002) {
  log(e.cause.status);
}
```

### Melt change failures throw `MeltChangeError`

A melt whose change could not be rebuilt threw the underlying failure, and the convenience melts
never expose the `MeltPreview`, so the change was lost with it. `completeMelt` now throws
`MeltChangeError` carrying what recovery needs, with the original failure as `cause`. Wrap your
melt calls and rebuild as shown above.

Read the `cause` before you retry. Keys that would not load are transient, and the rebuild works
once they are there. An invalid DLEQ or a signature count the blanks cannot account for will not
fix itself, and on a seeded wallet a NUT-09 restore is the real path.

### Melt inputs are checked against the snapshot

`prepareMelt` and the `meltProofs*` wrappers never looked up an input proof's keyset. `prepareMelt`
takes its fee reserve from `sendAmount - quote.amount` and nothing else, so a bolt11 or bolt12 melt
of proofs on an id the wallet did not hold went through regardless, with NUT-08 blanks bound to a
stale keyset. `meltProofsOnchain` does price its inputs, and failed on the way with a raw
`Could not get fee. No keyset found for keyset id: X`. All of them now resolve their input ids
first, exactly as `receive` does, and refuse an id the mint does not know with
`UnknownKeysetError`.

Melting proofs from an external or restored source, on a wallet whose snapshot may predate them,
means bringing the snapshot up to date first:

```ts
// Refresh, or resolve just the ids you are about to spend
await wallet.ensureOperableKeysets(proofs.map((p) => p.id));
await wallet.meltProofsBolt11(quote, proofs);
```

`loadMint(true)` does the same job wholesale. Under `strictCachedKeysets` nothing is fetched for
you, so load the keysets yourself before melting.

## Refreshing on purpose

### `loadMint(true)`

Follows the mint. Refreshes metadata, re-fetches keys for active keysets, and:

- keeps keys it already holds for keysets the mint still lists but no longer serves keys for,
- drops any keyset the mint stops listing altogether: metadata follows mint truth,
- rebinds an **auto-bound** wallet to the cheapest active keyset (newest version, then lowest fee,
  then latest expiry),
- leaves a **pinned** wallet alone (`keysetId` constructor option or `bindKeyset()`), even if its
  keyset went inactive.

### `ensureOperableKeysets(ids)`

```ts
await wallet.ensureOperableKeysets(proofs.map((p) => p.id));
```

Runs the repair on demand: unknown ids get one refresh, keysets held without keys get theirs
fetched, an id the mint does not know throws `UnknownKeysetError`. For integrations that verify
proofs or reconstruct persisted `outputData` without running a wallet operation.

Key fetches for several ids settle independently. One failure rethrows as-is; two or more throw a
`CTSError` whose `cause` is the array of failures. Either way keys that did land are kept, so
persist the cache even when the call throws.

Being explicit, it ignores `strictCachedKeysets` and the rate limit, and emits no
`keychainUpdated`. Persist `wallet.keyChain.cache` yourself afterwards. It needs a loaded wallet
and throws if it does not have one.

## Keeping a cache in sync

```ts
wallet.on.keychainUpdated(({ cache }) => {
  saveKeychainToDb(cache); // your atomic save, eg IndexedDB or a KV store
});
```

Fires when an operation loads keys or repairs the snapshot on its own. It does **not** fire for
`restore`'s key fetch or for calls you make yourself (`loadMint()`, `loadMint(true)`,
`ensureOperableKeysets()`) - persist after those yourself. See
[Create Wallet](./create_wallet.md).

## Strict mode

```ts
const wallet = new Wallet(mintUrl, { strictCachedKeysets: true });
```

For apps with their own persistence or state layer (eg coco-style) that want no network call
happening behind their back. Operations never call `/v1/keysets` or `/v1/keys` on their own; only
your calls do (`loadMint`, `loadMint(true)`, `keyChain.ensureKeysetKeys`, `ensureOperableKeysets`).

What changes:

| Situation                    | Strict behavior                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------- |
| Unknown keyset id            | `UnknownKeysetError` with `refreshed: false`, no repair attempt.                |
| Known keyset, no keys loaded | `No keys loaded for keyset X` (receive), `Keyset has no keys loaded` (restore). |
| Mint rejects a keyset        | `StaleKeysetError` with `repaired: false`.                                      |
| `keychainUpdated`            | Never fires: nothing internal mutates the snapshot.                             |
| `withKeyset()` derivatives   | Inherit the flag.                                                               |

Two things to plan for:

- `restore` and `batchRestore` throw on a keyset without loaded keys. Call
  `keyChain.ensureKeysetKeys` per keyset (or a fresh `loadMint`) before restoring across a rotation.
- Melt change arriving on a keyset you hold keyless throws `MeltChangeError` after the mint has
  spent the inputs. Recover with its `outputData`, an explicit `ensureKeysetKeys`, and
  `createMeltChangeProofs`.

## Long-lived wallets

No maintenance needed: the next operation that meets rotation evidence repairs itself. Call
`loadMint(true)` on a schedule if you would rather follow the mint ahead of that, eg to keep
`wallet.getMintInfo()` current or to move onto a new keyset before an operation forces it.

## Related docs

- [Create Wallet](./create_wallet.md) for `loadMint()` / `loadMintFromCache()` and initial setup.
- [WalletEvents](../wallet_events/wallet_events.md) for subscription patterns (`signal`, timeouts,
  grouping).
- Rotation behavior end to end:
  [`wallet-rotation.node.test.ts`](https://github.com/cashubtc/cashu-ts/blob/v4-dev/test/wallet/wallet-rotation.node.test.ts).
