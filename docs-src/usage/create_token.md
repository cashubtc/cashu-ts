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
