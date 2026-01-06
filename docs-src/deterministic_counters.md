[Documents](../index.html) › **Deterministic Counters**

# Deterministic counters (persist, inspect, bump)

Deterministic outputs use per-keyset counters. The wallet reserves them atomically and emits a single event you can use to persist the "next" value in your storage.

API at a glance:

- `wallet.counters.peekNext(id)` – returns the current "next" for a keyset
- `wallet.counters.advanceToAtLeast(id, n)` – bump forward if behind
- `wallet.on.countersReserved(cb)` – subscribe to reservations (see [WalletEvents](./wallet_events/wallet_events.md) for subscription patterns)

** Optional:** - Depends on CounterSource:

These methods will throw if the CounterSource does not support them.

- `wallet.counters.snapshot()` – inspect current overall state
- `wallet.counters.setNext(id, n)` – hard-set for migrations/tests

```ts
// 1) Seed once at app start if you have previously saved "next" per keyset
const wallet = new Wallet(mintUrl, {
	unit: 'sat',
	bip39seed,
	keysetId: preferredKeysetId, // e.g. '0111111'
	counterInit: loadCountersFromDb(), // e.g. { '0111111': 128 }
});
await wallet.loadMint();

// Alternative to using counterInit for individual keyset allocation
await wallet.counters.advanceToAtLeast('0111111', 128);

// 2) Subscribe once, persist future reservations
wallet.on.countersReserved(({ keysetId, start, count, next }) => {
	// next is start + count (i.e: next available)
	saveNextToDb(keysetId, next); // do an atomic upsert per keysetId
});

// 3) Inspect current state, what will be reserved next
const nextCounter = await wallet.counters.peekNext('0111111'); // 128

// 4) After a restore or cross device sync, bump the cursor forward
const { lastCounterWithSignature } = await wallet.batchRestore();
if (lastCounterWithSignature != null) {
	const next = lastCounterWithSignature + 1; // e.g. 137
	await wallet.counters.advanceToAtLeast('0111111', next);
	await saveNextToDb('0111111', next);
}

// 5) Parallel keysets without mutation
const wA = wallet; // bound to '0111111'
const wB = wallet.withKeyset('0122222'); // bound to '0122222', same CounterSource
await wB.counters.advanceToAtLeast('0122222', 10);
await wA.counters.snapshot(); // { '0111111': 137, '0122222': 10 }
await wB.counters.snapshot(); // { '0111111': 137, '0122222': 10 }
wA.keysetId; // '0111111'
wB.keysetId; // '0122222'

// 6) Switch wallet default keyset and bump counter
await wallet.counters.snapshot(); // { '0111111': 137, '0122222': 10 }
wallet.keysetId; // '0111111'
wallet.bindKeyset('0133333'); // bound to '0133333', same CounterSource
wallet.keysetId; // '0133333'
await wallet.counters.advanceToAtLeast('0133333', 456);

// Counters persist per keyset, so rebinding does not reset the old one
await wallet.counters.snapshot(); // { '0111111': 137, '0122222': 10, '0133333': 456 }
await wA.counters.snapshot(); // { '0111111': 137, '0122222': 10, '0133333': 456 }
await wB.counters.snapshot(); // { '0111111': 137, '0122222': 10, '0133333': 456 }
```

> **Note** The wallet does not await your callback.
> If saveNextToDb (or similar) is async, handle errors to avoid unhandled rejections
> For more on lifecycle management, see [WalletEvents](./wallet_events/wallet_events.md)
