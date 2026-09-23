# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Create Token**

# Create a token and receive it

```typescript
import { getEncodedToken, type Proof } from '@cashu/cashu-ts';
// we assume that `wallet` already minted `proofs`, as above
// or you fetched existing proofs from your app database
const proofs: Proof[] = [];
const { keep, send } = await wallet.send(32, proofs);
const token = getEncodedToken({ mint: mintUrl, proofs: send });
console.log(token);

const wallet2 = new Wallet(mintUrl); // receiving wallet
await wallet2.loadMint(); // wallet2 is now ready to use
const receiveProofs = await wallet2.receive(token);
// store receiveProofs in your app ..
```

`wallet.send()` is the one-shot form: a crash between the swap and storing the result strands the inputs. The recoverable form persists the preview first, then completes it; a persisted preview replays after a restart because `completeSwap` rebuilds the same request from it.

```typescript
import { serializeSwapPreview } from '@cashu/cashu-ts';

const preview = await wallet.prepareSwapToSend(32, proofs);
await savePendingSend(serializeSwapPreview(preview)); // spendable material: protect it like proofs
const { keep, send } = await wallet.completeSwap(preview);
// the swap settled: delete the pending send, and return preview.unselectedProofs to storage
```

Replay and its bounds are in [Crash-safe send](../wallet_ops/send.md#2-crash-safe-send-persist-the-preview) and [NUT-19 replay](./nut19.md).
