[Documents](../index.html) › [Usage Examples](../usage/usage_index.md) › **Mint Token**

# Mint tokens

```typescript
import { Wallet, MintQuoteState } from '@cashu/cashu-ts';
const mintUrl = 'http://localhost:3338';
const wallet = new Wallet(mintUrl);
await wallet.loadMint(); // wallet is now ready to use

const mintQuote = await wallet.createMintQuoteBolt11(64);
// pay the invoice here before you continue...
const mintQuoteChecked = await wallet.checkMintQuoteBolt11(mintQuote.quote);
if (mintQuoteChecked.state === MintQuoteState.PAID) {
	const proofs = await wallet.mintProofsBolt11(64, mintQuote.quote);
}
// store proofs in your app ..
```
