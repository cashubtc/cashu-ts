# <a href="/">Documents</a> › [Wallet Events](../wallet_events/wallet_events.md) › **Proof State Streams**

# Proof state streams

## Async iterator with buffer control:

```ts
import { CheckStateEnum } from '@cashu/cashu-ts';
const ac = new AbortController();
(async () => {
  try {
    for await (const u of wallet.on.proofStatesStream(proofs, { signal: ac.signal })) {
      if (u.state === CheckStateEnum.SPENT) {
        console.log('Spent proof', u.proof.id);
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return; // ac.abort() ended the loop
    console.error('Stream error', e); // websocket / mint RPC failure
  }
})();

// later
ac.abort();
```

The iterator ends cleanly when the abort signal fires or the consumer breaks out of the loop. Wallet errors (WebSocket failure, RPC error from the mint) are thrown from the iterator — wrap in `try/catch` to recover.
