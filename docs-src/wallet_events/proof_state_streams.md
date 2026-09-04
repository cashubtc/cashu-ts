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

## Polling fallback

Set `pollMs` and the stream polls `checkProofsStates` when the websocket is unavailable, as described under [Wallet Events](../wallet_events/wallet_events.md). Payloads look the same either way; `onMode` reports the transport.

```ts
for await (const u of wallet.on.proofStatesStream(proofs, {
  signal: ac.signal,
  pollMs: 30_000,
  onMode: (mode) => console.log('watching via', mode),
})) {
  if (u.state === CheckStateEnum.SPENT) console.log('Spent proof', u.proof.id);
}
```
