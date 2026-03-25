[Documents](../index.html) › [Wallet Operations](../wallet_ops/wallet_ops.md) › **Mint**

# Mint

## 1) Default BOLT11 mint (policy outputs)

```ts
const newProofs = await wallet.ops
	.mintBolt11(100, quote) // quote: string | MintQuoteBolt11Response
	.run();
```

## 2) Two-step BOLT11 mint with `prepare()`

```ts
const preview = await wallet.ops.mintBolt11(100, quote).asDeterministic(0).prepare();

// Persist `preview` if you want to retry safely later.
const newProofs = await wallet.completeMint(preview);
```

- `prepare()` builds the exact mint payload without calling the mint yet.
- `run()` is equivalent to `const preview = await prepare(); await wallet.completeMint(preview)`.

## 3) Deterministic mint with keyset + callback

```ts
const newProofs = await wallet.ops
	.mintBolt11(250, quote)
	.asDeterministic(0, [128, 64]) // counter=0 => auto-reserve, split must include denoms
	.keyset('0123456')
	.onCountersReserved((info) => console.log(info))
	.run();
```

## 4) Locked BOLT11 quote signing

```ts
// Create a locked mint quote
const pubkey = '02...'; // Your public key
const quote = await wallet.createLockedMintQuote(64, pubkey);

// Sign and mint
const newProofs = await wallet.ops
	.mintBolt11(50, quote)
	.privkey('user-secret-key') // sign locked mint quote
	.run();
```

## 5) Two-step BOLT12 mint

```ts
const quote12 = await wallet.createMintQuoteBolt12(pubkeyHex, { amount: 64 });
// pay the BOLT12 offer, then refresh the quote...
const updatedQuote = await wallet.checkMintQuoteBolt12(quote12.quote);
const availableAmount = updatedQuote.amount_paid.subtract(updatedQuote.amount_issued);

const preview = await wallet.ops
	.mintBolt12(availableAmount, updatedQuote)
	.privkey(privkeyHex)
	.asRandom([32, 16, 16])
	.prepare();

const newProofs = await wallet.completeMint(preview);
```

- BOLT12 always requires the full quote object and `.privkey(...)`.
- For custom payment methods (e.g., BACS, SWIFT), use the generic wallet methods directly:
  `wallet.createMintQuote(method, ...)`, `wallet.checkMintQuote(method, ...)`,
  `wallet.mintProofs(method, ...)`, or the two-step `wallet.prepareMint(method, ...)` /
  `wallet.completeMint(...)`. See [Mint Token – Custom Methods](../usage/mint_token.md) for examples.
