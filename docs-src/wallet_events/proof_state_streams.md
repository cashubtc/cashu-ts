[Documents](../index.html) › [Wallet Events](../wallet_events/wallet_events.md) › **Proof State Streams**

# Proof state streams

## Async iterator with buffer control:

```ts
import { CheckStateEnum } from '@cashu/cashu-ts';
const ac = new AbortController();
(async () => {
	for await (const u of wallet.on.proofStatesStream(proofs, { signal: ac.signal })) {
		if (u.state === CheckStateEnum.SPENT) {
			console.log('Spent proof', u.proof.id);
		}
	}
})();

// later
ac.abort();
```
