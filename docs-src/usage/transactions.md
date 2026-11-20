# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Transactions**

# Transactions (NUT-XX)

A mint that advertises NUT-XX takes proofs and paid mint quotes in, and issues new proofs and one melt out, in one request. Check `wallet.getMintInfo().transactions.supported` first.

## Pay an invoice straight from a paid mint quote

The mint sees this payment matched to the quote that funded it, which suits a service that forwards in the open (a Lightning address, a payment processor). A wallet paying from its own balance pays from proofs.

```ts
import { Wallet, serializeTransactionPreview } from '@cashu/cashu-ts';

const wallet = new Wallet('http://localhost:3338');
await wallet.loadMint();

const meltQuote = await wallet.createMeltQuoteBolt11(invoice);

const preview = await wallet.prepareTransaction({
  // an existing paid quote locked to privkey, drawn for everything it still has
  mintQuoteInputs: [{ quote, amount: quote.amount_paid.subtract(quote.amount_issued) }],
  meltQuoteOutput: { method: 'bolt11', quote: meltQuote },
});
// Store this before completing; it holds the proofs in the clear, so treat it like them.
const stored = JSON.stringify(serializeTransactionPreview(preview));

const { response, proofs } = await wallet.completeTransaction(preview, privkey);
if (response.state === 'PAID') {
  // proofs holds what the melt did not spend: keep it like any received proofs.
}
```

A quote input needs at least its `quote` and `method`; the wallet reads anything else it needs from the mint.

### Where the value goes

Inputs must equal outputs: everything the inputs bring in ends up as new proofs, the melt (its amount plus fee reserve) or the fee. New proofs (`proofOutputs`) take what the melt and fee leave by default. Setting `proofOutputs.amount` or a custom `outputType` must use the inputs up exactly.

### Melt change

A melt's unspent fee reserve comes back as proofs: the wallet adds NUT-08 blank outputs and the mint fills them once the payment settles. Custom outputs bring their own blanks.

For a quote offering `fee_options` (NUT-30), pass the chosen option as `meltQuoteOutput.feeIndex`; the transaction commits the reserve it names.

## Pending transactions and retries

A transaction with a melt settles through its melt quote. While the response is `PENDING`, poll `wallet.checkTransaction(preview)` (the preview can be rehydrated with `deserializeTransactionPreview`): it reads the melt quote, and once that is `PAID` builds the new proofs from the melt quote's `change` signatures. Pass `waitForSettlementMs` to `completeTransaction` to have it poll for you. To be pushed updates instead, subscribe with `wallet.on.meltQuoteUpdates`.

After a lost response a resent preview succeeds only where the mint caches responses (NUT-19). Otherwise recover as after a swap: NUT-07 shows whether the proofs were spent, and NUT-09 restores the new proofs.
