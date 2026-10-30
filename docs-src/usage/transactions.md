# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Transactions**

# Transactions (NUT-XX)

A mint that advertises NUT-XX takes proofs and paid mint quotes in, and issues new proofs, one melt and txout quotes out, in one request. Check `wallet.getMintInfo().transactions.supported` first.

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

Inputs must equal outputs: everything the inputs bring in ends up as new proofs, the melt (its amount plus fee reserve), txout quotes or the fee. New proofs (`proofOutputs`) take what the melt, txout quotes and fee leave by default. Setting `proofOutputs.amount` or a custom `outputType` must use the inputs up exactly.

### Melt change

A melt's unspent fee reserve comes back as proofs: the wallet adds NUT-08 blank outputs and the mint fills them once the payment settles. Custom outputs bring their own blanks.

For a quote offering `fee_options` (NUT-30), pass the chosen option as `meltQuoteOutput.feeIndex`; the transaction commits the reserve it names.

## Fixed txout quotes

A mint advertising `fixed_txout_quotes` (`wallet.getMintInfo().transactions.fixedTxoutQuotes`) also takes mint quote outputs: each creates a txout quote for exactly its `amount`, locked to its `pubkey`, paid out of the inputs like a melt.

```ts
const lock = await wallet.createQuoteLockKey(); // keep lock.privkey: it redeems the quote
const preview = await wallet.prepareTransaction({
  proofInputs: proofs,
  mintQuoteOutputs: [{ pubkey: lock.pubkey, idPreimage: lock.idPreimage, amount: 5 }],
});
```

- **With `idPreimage`**, the id derives from it (NUT-04). `createQuoteLockKey` returns a pubkey and preimage from one quote counter step, so a seeded wallet can find the quote again from the seed. Ids are single use; lock keys may repeat.
- **Without `idPreimage`**, the id is bound to the transaction's inputs, so only a transaction spending exactly those inputs can create the quote. Use this to pay another party in a transaction you sign now and submit later.

The quotes come back in `response.mint_quotes`, in request order. A txout quote redeems once and in full, through `prepareMint('txout', ...)` with its lock key or as a quote input drawing its whole amount, and value in one cannot move straight into another: a transaction with a txout quote input takes no mint quote outputs. A `template` leaf ([lock builder](../wallet_ops/lock_builder.md)) spends only into fixed txout quotes to its destinations, at a mint listing it in NUT-10 `leaves`.

## Pending transactions and retries

A transaction with a melt settles through its melt quote. While the response is `PENDING`, poll `wallet.checkTransaction(preview)` (the preview can be rehydrated with `deserializeTransactionPreview`): it reads the melt quote, and once that is `PAID` fetches any txout quotes and builds the new proofs from the melt quote's `change` signatures. Pass `waitForSettlementMs` to `completeTransaction` to have it poll for you. To be pushed updates instead, subscribe with `wallet.on.meltQuoteUpdates` and `wallet.on.mintQuoteUpdates(ids, cb, err, { method: 'txout' })` (NUT-17 `txout_mint_quote`); a txout quote id can be subscribed before its quote exists.

After a lost response a resent preview succeeds only where the mint caches responses (NUT-19). Otherwise recover as after a swap: NUT-07 shows whether the proofs were spent, and NUT-09 restores the new proofs, and `checkTransaction` fetches the txout quotes.
