[Documents](../index.html) › [Wallet Operations](../wallet_ops/wallet_ops.md) › **Melt**

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

## Custom payment methods

For custom payment methods (e.g., BACS, SWIFT), use the generic wallet methods directly:
`wallet.createMeltQuote(method, ...)`, `wallet.checkMeltQuote(method, ...)`,
`wallet.meltProofs(method, ...)`, or the two-step `wallet.prepareMelt(method, ...)` /
`wallet.completeMelt(...)`. See [Melt Token – Custom Methods](../usage/melt_token.md) for examples.
