# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Restore Proofs**

# Restore proofs from a seed

Wallets that create outputs deterministically (see [Deterministic Counters](../deterministic_counters.md)) can rebuild their proofs from nothing but the seed: the wallet re-derives the blinded messages for each counter ([NUT-13](https://github.com/cashubtc/nuts/blob/main/13.md)) and asks the mint to replay its signatures for them ([NUT-09](https://github.com/cashubtc/nuts/blob/main/09.md)). Only deterministic outputs are recoverable; proofs created with random secrets are not.

## Quick start: restore everything

`restoreAll` scans every keyset in the wallet's unit (inactive keysets included) and merges the results. Afterwards, bump each keyset's counter past the restored range so new outputs cannot collide with already-signed ones.

```typescript
const wallet = new Wallet(mintUrl, { bip39seed: seed });
await wallet.loadMint();

const { proofs, lastCounters } = await wallet.restoreAll();

// proofs are unspent (spent ones are filtered out by default) - store them
for (const [keysetId, last] of Object.entries(lastCounters)) {
  await wallet.counters.advanceToAtLeast(keysetId, last + 1);
}
```

`lastCounters` maps each keyset id to the highest counter that returned a signature. Keysets with no signatures are absent. Counter advancement uses all found signatures, including any whose proofs were filtered out as spent, so it is always safe to resume from `last + 1`.

## Single keyset and options

`batchRestore` scans one keyset. Both it and `restoreAll` accept the same scan options (`restoreAll` forwards them to every keyset):

```typescript
const { proofs, lastCounterWithSignature } = await wallet.batchRestore({
  keysetId: '00bd033559de27d0', // defaults to the wallet's keyset
  gapLimit: 300, // consecutive empty counters that end the scan
  batchSize: 500, // counters per request (mint caps are typically 1000)
  counter: 0, // starting counter
  filterSpent: true, // drop spent proofs via NUT-07 before returning
});
```

Semantics worth knowing:

- **`gapLimit` is a floor, not an exact ceiling.** Batches are fetched through a small request pool, so a few batches are already in flight when the gap closes. Their results are still processed: proofs sitting shortly past the gap limit are recovered rather than dropped, and the scan may probe up to three extra batches of counters past the gap.
- **`filterSpent` drops SPENT proofs and keeps PENDING ones** (a pending melt can fail and return them to spendable). Pass `filterSpent: false` for the raw output, e.g. for auditing. `lastCounterWithSignature` is never affected by filtering.
- **`maxCounter` bounds the scan** (inclusive); nothing above it is probed. Combine with `gapLimit: Infinity` to fetch a known counter range wall to wall:

```typescript
// You know the last used counter (e.g. from a backup) - skip the gap search entirely
const { proofs } = await wallet.batchRestore({ maxCounter: lastKnown, gapLimit: Infinity });
```

## Low-level: one exact range

`restore(start, count)` performs a single NUT-09 request with no gap logic and no spent filtering. Use it to build custom scan strategies:

```typescript
const { proofs, lastCounterWithSignature } = await wallet.restore(0, 100, { keysetId });
```

## Notes

- Restore replays **issued signatures**, so without `filterSpent` the result includes proofs you have long since spent. Filter before crediting a balance.
- Restoring reveals the derived blinded messages for every scanned counter to the mint. The gap limit exists to bound that reveal; raise it only when you expect large counter gaps.
- Upgrading from v4: `batchRestore` took positional arguments and returned spent proofs. See the [v5 migration guide](https://github.com/cashubtc/cashu-ts/blob/main/migration-5.0.0.md) for the config-object signature and the `filterSpent` default.
