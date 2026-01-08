[Documents](../index.html) › [Wallet Operations](../wallet_ops/wallet_ops.md) › **Error Handling Patterns**

# Error handling patterns

```ts
try {
	const res = await wallet.ops.send(5, proofs).offlineExactOnly().run();
	console.log('Sent:', res.send.length, 'Kept:', res.keep.length);
} catch (e) {
	// e is a proper Error (WalletOps normalizes unknowns internally)
	if ((e as Error).message.includes('Timeout')) {
		// …
	}
	throw e;
}
```
