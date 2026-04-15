# <a href="/">Documents</a> › **Deterministic Counters**

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

---

## Shared CounterSource across wallet instances

By default each `new Wallet(...)` creates its own internal counter source. If your app creates multiple wallet instances for the same seed (e.g. short-lived wallets per operation), each instance gets an independent copy seeded from `counterInit` — and concurrent operations can reserve **overlapping counter ranges**, causing "outputs have already been signed" errors.

Use `createEphemeralCounterSource()` to create a single shared source and pass it to every wallet via the `counterSource` option:

```ts
import { Wallet, createEphemeralCounterSource } from '@cashu/cashu-ts';

// Create once at app start, seeded from your persisted counters
const counters = createEphemeralCounterSource(loadCountersFromDb());

// Every wallet instance shares the same source — no overlapping reservations
const walletA = new Wallet(mintA, { unit: 'sat', bip39seed, counterSource: counters });
const walletB = new Wallet(mintB, { unit: 'sat', bip39seed, counterSource: counters });
```

### Persisting counter state

The ephemeral source is memory-only — counters do not survive page reloads. Use `wallet.on.countersReserved` to persist after every operation:

```ts
function wireCounterPersistence(wallet: Wallet) {
  wallet.on.countersReserved(({ keysetId, next }) => {
    saveNextToDb(keysetId, next);
  });
}

wireCounterPersistence(walletA);
wireCounterPersistence(walletB);
```

Because the source is shared, the global event on any wallet instance reflects the true cursor — there is no need for per-operation `onCountersReserved` callbacks in your builder chains.

### counterSource vs counterInit

| Option          | When to use                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `counterInit`   | Single wallet instance, or you don't need cross-wallet coordination. Seeds a wallet-local ephemeral source.               |
| `counterSource` | Multiple wallet instances for the same seed, or you need persistence/custom storage. Takes precedence over `counterInit`. |

### Custom CounterSource implementations

`createEphemeralCounterSource` returns the built-in in-memory implementation. For durable storage you can implement `CounterSource` directly:

```ts
import type { CounterSource, CounterRange } from '@cashu/cashu-ts';

class IndexedDbCounterSource implements CounterSource {
  async reserve(keysetId: string, n: number): Promise<CounterRange> {
    // atomic read-and-increment in your DB
  }
  async advanceToAtLeast(keysetId: string, minNext: number): Promise<void> {
    // conditional update: SET next = max(next, minNext)
  }
  // Optional: snapshot(), setNext()
}
```
