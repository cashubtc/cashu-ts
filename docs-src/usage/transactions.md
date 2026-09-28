# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Transactions**

# Transactions (NUT-XX)

A mint that advertises NUT-XX takes proofs and paid mint quotes in, and issues new proofs, one melt and a change quote out, in one request. Check `wallet.getMintInfo().transactions.supported` first.

## Pay an invoice straight from a paid mint quote

```ts
import { Wallet, serializeTransactionPreview } from '@cashu/cashu-ts';

const wallet = new Wallet('http://localhost:3338');
await wallet.loadMint();

const meltQuote = await wallet.createMeltQuoteBolt11(invoice);
const change = await wallet.createQuoteLockKey(); // keep change.privkey: it redeems the change

const preview = await wallet.prepareTransaction({
  // an existing paid quote locked to privkey, drawn for everything it still has
  mintQuoteInputs: [{ quote, amount: quote.amount_paid.subtract(quote.amount_issued) }],
  meltQuoteOutput: { method: 'bolt11', quote: meltQuote },
  changePubkey: change.pubkey,
});
// Store this before completing; it holds the proofs in the clear, so treat it like them.
const stored = JSON.stringify(serializeTransactionPreview(preview));

const { response } = await wallet.completeTransaction(preview, privkey);
if (response.state === 'PAID' && response.change_quote) {
  // keep response.change_quote with change.privkey
}
```

With a `changePubkey`, whatever the new proofs, melt and fee do not use goes to the change quote: the melt's unspent fee reserve and any surplus from the inputs, and the new proofs default to none. Without one, the new proofs default to everything the melt and fee leave, any amount you set must use it exactly, and a melt with a fee reserve is refused unless the prepare config sets `forfeitFeeReserve`, since its unspent reserve stays with the mint. Either way, `proofOutputs.amount` sets the new proofs, and a custom `proofOutputs.outputType` defaults to its own total.

For a quote offering `fee_options` (NUT-30), pass the chosen option as `meltQuoteOutput.feeIndex`; the transaction commits the reserve it names.

## Pending transactions and retries

Completing the same preview again (for example rehydrated with `deserializeTransactionPreview`) posts the same transaction, and the mint returns its record rather than spending twice, so a lost response is recovered by retrying.

While the response is `PENDING`, poll `wallet.checkTransaction(preview)`: it returns the mint's record, with the new proofs once it is `PAID`.

## Redeeming a change quote

A change quote redeems like any locked quote, whole or in parts: as a quote input to another transaction, or through its own mint route.

```ts
// changeQuote is the response.change_quote kept above; changePrivkey its lock key.
const remaining = changeQuote.amount_paid.subtract(changeQuote.amount_issued);
const proofs = await wallet.completeMint(
  await wallet.prepareMint('change', remaining, changeQuote, { privkey: changePrivkey }),
);
```
