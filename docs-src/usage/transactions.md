# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Transactions**

# Transactions (NUT-XX)

A mint that advertises NUT-XX takes proofs and paid mint quotes in, and issues new proofs and one melt out, in one request. Check `wallet.getMintInfo().transactions.supported` first.

## Pay an invoice straight from a paid mint quote

The mint sees this payment matched to the quote that funded it, which suits a service that forwards in the open (a Lightning address, a payment processor). A wallet paying from its own balance pays from proofs.

```ts
import { Wallet, serializeTransactionPreview } from '@cashu/cashu-ts';

const wallet = new Wallet('http://localhost:3338'); // unseeded: no rotation quote by default
await wallet.loadMint();

const meltQuote = await wallet.createMeltQuoteBolt11(invoice);
const rotation = wallet.createRotationLockKey(meltQuote.quote); // random: store rotation.privkey

const preview = await wallet.prepareTransaction({
  // an existing paid quote locked to privkey, drawn for everything it still has
  mintQuoteInputs: [{ quote, amount: quote.amount_paid.subtract(quote.amount_issued) }],
  meltQuoteOutput: { method: 'bolt11', quote: meltQuote },
  mintQuoteOutputs: [{ pubkey: rotation.pubkey }],
});
// Store this before completing; it holds the proofs in the clear, so treat it like them.
const stored = JSON.stringify(serializeTransactionPreview(preview));

const { response, proofs } = await wallet.completeTransaction(preview, privkey);
if (response.state === 'PAID') {
  // proofs holds what the melt did not spend: keep it like any received proofs.
  // mint_quotes[0] is null unless the outputs could not be signed (see below).
}
```

A quote input needs at least its `quote` and `method`; the wallet reads anything else it needs from the mint. A txout quote is drawn only in full.

### Where the value goes

Inputs must equal outputs: everything the inputs bring in ends up as new proofs, the melt (its amount plus fee reserve) or the fee. New proofs (`proofOutputs`) take what the melt and fee leave by default. Setting `proofOutputs.amount` or a custom `outputType` must use the inputs up exactly.

### Melt change

A melt's unspent fee reserve comes back as proofs: the wallet adds NUT-08 blank outputs and the mint fills them once the payment settles. Custom outputs bring their own blanks.

For a quote offering `fee_options` (NUT-30), pass the chosen option as `meltQuoteOutput.feeIndex`; the transaction commits the reserve it names.

### The rotation quote

If the outputs' keyset rotates while the melt is in flight, the mint cannot sign them. The rotation quote catches that value: the mint creates it, locked to your `pubkey`, only in that case, holding the outputs' amount and the change the blanks would have taken. Without one, that value stays with the mint.

A seeded wallet adds one by default, its key derived from the seed and the melt quote id (`createRotationLockKey` gives you the same key again, with no counter); pass `mintQuoteOutputs: []` to opt out. An unseeded wallet adds none: pass one yourself and store its random key with the transaction. The quote's id derives from the melt quote id, so it is known up front.

## Pending transactions and retries

A transaction with a melt settles through its melt quote. While the response is `PENDING`, poll `wallet.checkTransaction(preview)` (the preview can be rehydrated with `deserializeTransactionPreview`): it reads the melt quote, and once that is `PAID` fetches any rotation quote and builds the new proofs from the melt quote's `change` signatures. Pass `waitForSettlementMs` to `completeTransaction` to have it poll for you. To be pushed updates instead, subscribe with `wallet.on.meltQuoteUpdates` and `wallet.on.mintQuoteUpdates(ids, cb, err, { method: 'txout' })` (NUT-17 `txout_mint_quote`); a rotation quote id can be subscribed before its quote exists.

After a lost response a resent preview succeeds only where the mint caches responses (NUT-19). Otherwise recover as after a swap: NUT-07 shows whether the proofs were spent, NUT-09 restores the new proofs, and `checkTransaction` fetches the rotation quote.

## Redeeming a rotation quote

A rotation quote redeems once and in full: through its own mint route, or as a quote input drawing its whole amount.

```ts
// rotationQuote is response.mint_quotes[0]; rotationPrivkey its lock key.
const proofs = await wallet.completeMint(
  await wallet.prepareMint('txout', rotationQuote.amount_paid, rotationQuote, {
    privkey: rotationPrivkey,
  }),
);
```
