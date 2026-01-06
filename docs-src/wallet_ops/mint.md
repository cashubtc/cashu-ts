[Documents](../index.html) › [Wallet Operations](../wallet_ops/wallet_ops.md) › **Mint**

# Mint

## 1) Default mint (policy outputs)

```ts
const newProofs = await wallet.ops
	.mint(100, quote) // quote: string | MintQuoteResponse
	.run();
```

## 2) Deterministic mint with keyset + callback

```ts
const newProofs = await wallet.ops
	.mint(250, quote)
	.asDeterministic(0, [128, 64]) // counter=0 => auto-reserve, split must include denoms
	.keyset('0123456')
	.onCountersReserved((info) => console.log(info))
	.run();
```

## 3) Locked quote signing

```ts
// Create a locked mint quote
const pubkey = '02...'; // Your public key
const quote = await wallet.createLockedMintQuote(64, pubkey);

// Sign and mint
const newProofs = await wallet.ops
	.mint(50, quote)
	.privkey('user-secret-key') // sign locked mint quote
	.run();
```
