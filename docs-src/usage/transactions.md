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

const { response, proofs } = await wallet.completeTransaction(preview, privkey);
if (response.state === 'PAID') {
  // proofs holds the change that came back as ecash: keep it like any received proofs.
  // change_quotes[0] is null unless something could not be signed; if set, keep it with change.privkey.
  // or mint it to proofs in a new operation
}
```

### Where the value goes

Everything the inputs bring in ends up as new proofs, the melt, a change quote or the fee.

- **A change quote with an `amount`** takes exactly that amount.
- **The remainder quote** is the one change quote without an `amount` (at most one). It receives what cannot be allocated up front: the value of outputs that cannot be signed, a melt's change the blank outputs do not take, or a fee change before a transaction signed for later is submitted. Lock it to whoever is entitled to that value: if you have outputs beside a melt, that is you.
- **New proofs** (`proofOutputs`) take everything left by default, so change you can compute comes back as proofs. Setting `proofOutputs.amount` yourself (eg `0`) leaves the rest, a melt's change included, to the remainder quote, eg to pay it to another party; the wallet then adds no blank outputs. Without a remainder quote, an `amount` you set must use the inputs up exactly. A custom `outputType` sets its own total.

### Melt change

With a remainder quote, a melt's unspent fee reserve comes back as proofs too: the wallet adds NUT-08 blank outputs and the mint fills them. It adds none when you set `proofOutputs.amount` or a custom `outputType`, which are taken as given. The remainder quote takes the change only if those outputs cannot be signed, because the keyset rotated during the payment.

A melt with a fee reserve needs a remainder quote, or the unspent reserve stays with the mint. `prepareTransaction` refuses such a melt unless you set `forfeitFeeReserve` in the prepare config.

For a quote offering `fee_options` (NUT-30), pass the chosen option as `meltQuoteOutput.feeIndex`; the transaction commits the reserve it names.

### Change quote ids

Each change quote is locked to its `pubkey` and named by an id:

- **With `idPreimage`**, the id derives from it (NUT-04). `createQuoteLockKey` returns a pubkey and preimage from one quote counter step, so a seeded wallet can find its change again from the seed.
- **Without `idPreimage`**, the id is bound to the transaction's inputs, so only a transaction spending exactly those inputs can create the quote. Use this to pay another party in a transaction you sign now and submit later.

Ids are single use, so take a fresh pair for each output. Lock keys may repeat.

### Reading the response

`response.change_quotes` has one entry per change quote output, in order. Each is `null` until the transaction is `PAID`, and stays `null` for a remainder quote with nothing left.

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
