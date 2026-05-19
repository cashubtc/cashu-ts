# <a href="/">Documents</a> › [Wallet Events](../wallet_events/wallet_events.md) › **Proof State Streams**

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

> **Note:** the subscription is sent to the mint on the first iteration, not when
> `proofStatesStream` is called. Per
> [NUT-17](https://github.com/cashubtc/nuts/blob/main/17.md) the mint replays the
> _current_ state on subscribe, so the latest state is never lost — only intermediate
> transitions before the first iteration are collapsed into that snapshot.
