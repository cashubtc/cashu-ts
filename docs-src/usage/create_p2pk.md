[Documents](../index.html) › [Usage Examples](../usage/usage_index.md) › **Create P2PK**

# Create a P2PK locked token and receive it

```typescript
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
// we assume that `wallet` already minted `proofs`, as above
// or you fetched existing proofs from your app database
const proofs = [...]; // array of proofs
const pubkey = '02...'; // Your public key
const { keep, send } = await wallet.ops.send(32, proofs).asP2PK({pubkey}).run();
const token = getEncodedTokenV4({ mint: mintUrl, proofs: send });
console.log(token);

const wallet2 = new Wallet(mintUrl); // receiving wallet
await wallet2.loadMint(); // wallet2 is now ready to use
const privkey = '5d...'; // private key for pubkey
const receiveProofs = await wallet2.receive(token, {privkey});
// store receiveProofs in your app ..
```
