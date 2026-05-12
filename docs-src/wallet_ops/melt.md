# <a href="/">Documents</a> › [Wallet Operations](../wallet_ops/wallet_ops.md) › **Melt**

# Melt

## 1) Basic BOLT11 melt

```ts
// given a bolt11 meltQuote...
const { quote, change } = await wallet.ops.meltBolt11(meltQuote, myProofs).run();
```

- Pays the Lightning invoice in the `meltQuote` using `myProofs`
- Any change is returned using wallet policy defaults.

## 2) BOLT12 melt with deterministic change + callback

```ts
// given a bolt12 meltQuote...
const { quote, change } = await wallet.ops
  .meltBolt12(meltQuote, myProofs)
  .asDeterministic() // counter=0 => auto-reserve
  .onCountersReserved((info) => console.log('Reserved', info))
  .run();
```

- Supports async completion with NUT-08 blanks.
- Change outputs are deterministic.
- Callback hooks let you persist state for retry later.
- If you prefer global subscriptions, use:
  - onCountersReserved -> wallet.on.countersReserved()

## 3) Two-step melt with `prepare()`

```ts
const preview = await wallet.ops.meltBolt11(meltQuote, myProofs).asDeterministic().prepare();

// Persist `preview` if you want to retry safely later.
const { quote, change } = await wallet.completeMelt(preview);
```

- `prepare()` creates the `MeltPreview` and any NUT-08 blanks without paying yet.
- `run()` is equivalent to `const preview = await prepare(); await wallet.completeMelt(preview)`.
- This pairs well with NUT-19 cached-response retries on mints that advertise the melt endpoint.

## 4) Async melt with later change recovery (NUT-06 `prefer_async`)

For mints that support NUT-06 async melts, `.prepare()` pairs with `OutputData.serialize` to
persist the change-output blanks while the payment is in flight, and `wallet.createMeltChangeProofs`
reconstructs change proofs once the quote is paid.

```ts
import { OutputData, type SerializedOutputData } from '@cashu/cashu-ts';

const preview = await wallet.ops.meltBolt11(meltQuote, myProofs).asDeterministic().prepare();
const stored = JSON.stringify(preview.outputData.map((o) => OutputData.serialize(o)));
await wallet.completeMelt(preview, undefined, { preferAsync: true });

// ... later, once the quote is paid ...
const restored = (JSON.parse(stored) as SerializedOutputData[]).map((s) =>
  OutputData.deserialize(s),
);
const change = wallet.createMeltChangeProofs(restored, paidQuote.change ?? []);
```

- See [Melt Token § 3 — Async melt with later change recovery](../usage/melt_token.md) for the
  full annotated lifecycle using the low-level wallet methods directly.

## Custom payment methods

For custom payment methods (e.g., BACS, SWIFT), use the generic wallet methods directly:
`wallet.createMeltQuote(method, ...)`, `wallet.checkMeltQuote(method, ...)`,
`wallet.meltProofs(method, ...)`, or the two-step `wallet.prepareMelt(method, ...)` /
`wallet.completeMelt(...)`. See [Melt Token – Custom Methods](../usage/melt_token.md) for examples.
