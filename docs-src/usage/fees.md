# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Fees**

# Fees

Two separate costs apply when spending proofs:

- **Input fees** (NUT-02): each keyset advertises `input_fee_ppk` (parts per thousand, per input).
  Spending N proofs from that keyset costs `ceil(N * ppk / 1000)`, rounded up once per transaction.
- **Lightning costs** (melt only): a melt quote's `fee_reserve` is the ceiling the mint holds back
  for routing, not an estimate. When the mint supports NUT-08, unused reserve comes back as change.

Most flows need no fee arithmetic at all: pass `includeFees: true` to `send` (or
`.includeFees(true)` on the `wallet.ops` builders) and the wallet inflates the outputs so the
receiver nets the requested amount. The helpers below are for when you budget, validate, or plan
outputs yourself.

## Which helper, when

| Question                                                      | Helper                                              |
| :------------------------------------------------------------ | :-------------------------------------------------- |
| What does it cost to spend these exact proofs?                | `Wallet.getFeesForProofs(proofs)`                   |
| What would N inputs of a keyset cost?                         | `Wallet.getFeesForKeyset(nInputs, keysetId)`        |
| Receiver must net `amount`: what does the sender add on top?  | `Wallet.getFeesToInclude(amount, opts?)`            |
| What is the most this proof set can send or melt, after fees? | `Wallet.maxSpendableAfterFees(proofs, feeReserve?)` |

## Exact-target: the receiver nets a fixed amount

`getFeesToInclude` returns the amount `includeFees` would add: the input fee for spending the
planned outputs, including the fee outputs themselves (fee outputs also incur fees, so the wallet
iterates until the total is stable). Use it to budget before selecting, or to price a custom
denomination plan:

```ts
// Price a sender-pays-fees send before committing to it
const fee = wallet.getFeesToInclude(1000); // eg 2 on a 1000 ppk keyset
// wallet.send(1000, proofs, { includeFees: true }) creates outputs totalling 1000 + fee

// Custom denomination sets: pass the planned output count instead of the default split
wallet.getFeesToInclude(1000, { nOutputs: 4 });
```

`getFeesForProofs` prices a concrete proof set (eg inputs you are about to melt).
`getFeesForKeyset` prices a count when the proofs do not exist yet (eg outputs a swap will create).

## Send-max: "melt everything"

`maxSpendableAfterFees` works in the opposite direction: given a proof set, the largest amount that
remains after input fees and, optionally, a melt quote's `fee_reserve`. Because `fee_reserve`
shrinks with the amount, iterate until the quote stabilizes:

```ts
let target = wallet.maxSpendableAfterFees(proofs); // before any quote: input fees only
let quote;
for (let attempt = 0; attempt < 3; attempt++) {
  const invoice = await getInvoiceFor(target); // from the receiving Lightning wallet
  quote = await wallet.createMeltQuoteBolt11(invoice);
  target = wallet.maxSpendableAfterFees(proofs, quote.fee_reserve);
  if (target.greaterThanOrEqual(quote.amount)) break; // proofs cover amount + fees: pay this quote
  quote = undefined; // reserve ate into the amount: re-quote smaller
}
if (!quote) throw new Error('Melt-all did not converge');
```

## Related docs

- [Melt Token](./melt_token.md) for budgeting melts with `amount + fee_reserve` and `includeFees`.
- [Send](../wallet_ops/send.md) for sender-pays-fees via the ops builder.
- [Amounts](./amounts.md) for the `Amount` value object used throughout.
