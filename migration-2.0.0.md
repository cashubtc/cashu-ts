# Version 2.0.0 Migration guide

⚠️ Upgrading to version 2.0.0 will come with breaking changes! Please follow the migration guide for a smooth transition to the new version.

## Breaking changes

### `CashuWallet` interface changes

#### removed `payLnInvoice` helper

The helper function was removed. Instead users will have to manage a melt quote manually:

```ts
const quote = await wallet.createMeltQuote(invoice);
const totalAmount = quote.fee_reserve + invoiceAmount;
const { keep, send } = await wallet.send(totalAmount, proofs);
const payRes = await wallet.meltProofs(quote, send);
```
