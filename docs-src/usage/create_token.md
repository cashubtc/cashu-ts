[Documents](../index.html) › [Usage Examples](../usage/usage_index.md) › **Create Token**

# Create a token and receive it

```typescript
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
// we assume that `wallet` already minted `proofs`, as above
// or you fetched existing proofs from your app database
const proofs = [...]; // array of proofs
const { keep, send } = await wallet.send(32, proofs);
const token = getEncodedTokenV4({ mint: mintUrl, proofs: send });
console.log(token);

const wallet2 = new Wallet(mintUrl); // receiving wallet
await wallet2.loadMint(); // wallet2 is now ready to use
const receiveProofs = await wallet2.receive(token);
// store receiveProofs in your app ..
```
