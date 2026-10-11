# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Transactions**

# Transactions (NUT-XX)

A mint that advertises NUT-XX takes proofs and paid mint quotes in, and issues new proofs, one melt and change quotes out, in one request. Check `wallet.getMintInfo().transactions.supported` first.

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
  changeQuoteOutputs: [{ pubkey: change.pubkey, idPreimage: change.idPreimage }], // no amount: the remainder quote
});
// Store this before completing; it holds the proofs in the clear, so treat it like them.
const stored = JSON.stringify(serializeTransactionPreview(preview));

const { response } = await wallet.completeTransaction(preview, privkey);
if (response.state === 'PAID' && response.change_quotes[0]) {
  // keep response.change_quotes[0] with change.privkey
}
```

Each entry of `changeQuoteOutputs` becomes a change quote locked to its `pubkey`, under the id its `idPreimage` derives (NUT-04 derived quote ids). `createQuoteLockKey` returns both from one quote counter step, so a seeded wallet can find the quote again from its seed. Ids are single use: take a fresh pair for each output; lock keys may repeat. One with an `amount` is paid that amount out of the inputs; at most one may omit it, the remainder quote, which takes whatever the new proofs, melt, fee and fixed quotes do not use: the melt's unspent fee reserve and any surplus from the inputs. With a remainder quote the new proofs default to none. Without one, they default to everything else the inputs cover, any amount you set must use it exactly, and a melt with a fee reserve is refused unless the prepare config sets `forfeitFeeReserve`, since its unspent reserve stays with the mint. Either way, `proofOutputs.amount` sets the new proofs, and a custom `proofOutputs.outputType` defaults to its own total. The response's `change_quotes` lists one entry per output in the same order, null until the transaction is `PAID` (and for a remainder quote with nothing left).

For a quote offering `fee_options` (NUT-30), pass the chosen option as `meltQuoteOutput.feeIndex`; the transaction commits the reserve it names.

## Pending transactions and retries

A transaction with a melt settles through its melt quote. While the response is `PENDING`, poll `wallet.checkTransaction(preview)` (the preview can be rehydrated with `deserializeTransactionPreview`): it reads the melt quote, and once that is `PAID` fetches each change quote by id and builds the new proofs from the melt quote's `change` signatures. Pass `waitForSettlementMs` to `completeTransaction` to have it poll for you. To be pushed updates instead, subscribe with `wallet.on.meltQuoteUpdates` and `wallet.on.mintQuoteUpdates(ids, cb, err, { method: 'change' })` (NUT-17 `change_mint_quote`); a change quote id can be subscribed before its quote exists.

The change quote ids are taken once the mint accepts the request, so after a lost response a resent preview succeeds only where the mint caches responses (NUT-19). Otherwise recover as after a swap: NUT-07 shows whether the proofs were spent, NUT-09 restores the new proofs, and each change quote is fetched by its id.

## Redeeming a change quote

A change quote redeems like any locked quote, whole or in parts: as a quote input to another transaction, or through its own mint route.

```ts
// changeQuote is the response.change_quotes[0] kept above; changePrivkey its lock key.
const remaining = changeQuote.amount_paid.subtract(changeQuote.amount_issued);
const proofs = await wallet.completeMint(
  await wallet.prepareMint('change', remaining, changeQuote, { privkey: changePrivkey }),
);
```
