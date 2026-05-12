# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Melt Token**

# Melt tokens

## 1) One-step BOLT11 melt

```ts
import { Wallet } from '@cashu/cashu-ts';

const mintUrl = 'http://localhost:3338';
const wallet = new Wallet(mintUrl);
await wallet.loadMint(); // wallet is now ready to use

const invoice = 'lnbc......'; // Lightning invoice to pay
const meltQuote = await wallet.createMeltQuoteBolt11(invoice);
const amountToSend = meltQuote.amount.add(meltQuote.fee_reserve);

// Wallet.send performs coin selection and swaps the proofs with the mint
// if no appropriate amount can be selected offline. When selecting coins for a
// melt, we must include the mint and/or lightning fees to ensure there are
// sufficient funds to cover the invoice.
const { keep: proofsToKeep, send: proofsToSend } = await wallet.send(amountToSend, proofs, {
  includeFees: true,
});
const meltResponse = await wallet.meltProofsBolt11(meltQuote, proofsToSend);
// store proofsToKeep and meltResponse.change in your app ..
```

## 2) Two-step melt with `prepareMelt()` / `completeMelt()`

The two-step flow lets you persist the preview before paying. This is the recommended pattern when
you want replay-safe recovery alongside NUT-19 transport retries.

```ts
import { Wallet } from '@cashu/cashu-ts';

const wallet = new Wallet('http://localhost:3338');
await wallet.loadMint();

const meltQuote = await wallet.createMeltQuoteBolt11(invoice);
const amountToSend = meltQuote.amount.add(meltQuote.fee_reserve);
const { send: proofsToSend } = await wallet.send(amountToSend, proofs, {
  includeFees: true,
});

const meltPreview = await wallet.prepareMelt('bolt11', meltQuote, proofsToSend);

// Persist an app-defined snapshot here.
// Do not call JSON.stringify(meltPreview) directly; preview objects contain non-JSON-safe values.
const meltResponse = await wallet.completeMelt(meltPreview);
```

## 3) Async melt with later change recovery (NUT-06 `prefer_async`)

For mints that support NUT-06 asynchronous melts, the melt response can return before the
Lightning payment completes, meaning the response will not yet carry NUT-08 change signatures.

To reclaim that change later, persist the prepared output data while the melt is pending, then
hydrate change proofs from the eventual paid quote response.

```ts
import { OutputData, type SerializedOutputData } from '@cashu/cashu-ts';

// 1. Prepare the melt and persist the change-output data alongside the pending quote.
const preview = await wallet.prepareMelt('bolt11', meltQuote, myProofs);
const stored = JSON.stringify(preview.outputData.map((o) => OutputData.serialize(o)));
await wallet.completeMelt(preview, undefined, true); // preferAsync = true

// 2. ... time passes ... use checkMeltQuote*() or wallet.on.onceMeltPaid() to learn the
// quote is paid. The paid response carries the change signatures.

// 3. Restore the output data and reconstruct spendable change proofs.
const restored = (JSON.parse(stored) as SerializedOutputData[]).map((s) =>
  OutputData.deserialize(s),
);
const change = wallet.createMeltChangeProofs(restored, paidQuote.change ?? []);
```

- `OutputData.serialize` / `OutputData.deserialize` are the JSON-safe round-trip primitives
  (decimal-encoded bigints, hex-encoded bytes; preserves `ephemeralE` for P2BK).
- `wallet.createMeltChangeProofs` runs the same validation as the synchronous path and is also
  callable directly if you've persisted output data outside the helpers above (crash recovery,
  process hand-off, etc.).
- For the same pattern using the WalletOps builder (`.prepare()`), see
  [Wallet Operations – Melt § 4](../wallet_ops/melt.md).

## 4) Generic melt for custom payment methods

The generic `createMeltQuote()` / `meltProofs()` methods support arbitrary payment methods without
requiring first-class library support.

The mint must advertise the method at `/v1/melt/quote/{method}`.

```ts
import { Wallet, Amount, type MeltQuoteBaseResponse, type AmountLike } from '@cashu/cashu-ts';

// Define your custom quote response type
type BacsMeltQuoteResponse = MeltQuoteBaseResponse & {
  fee_estimate: Amount;
  reference: string;
};

const wallet = new Wallet('http://localhost:3338');
await wallet.loadMint();

// Create a melt quote using the generic method
const meltQuote = await wallet.createMeltQuote<BacsMeltQuoteResponse>(
  'bacs',
  {
    request: 'GB29NWBK60161331926819', // IBAN
    amount: 5000n,
  },
  {
    normalize: (raw) => ({
      ...(raw as BacsMeltQuoteResponse),
      fee_estimate: Amount.from(raw.fee_estimate as AmountLike),
    }),
  },
);

// Coin select and melt
const totalNeeded = meltQuote.amount.add(meltQuote.fee_estimate);
const { send: proofsToSend } = await wallet.send(totalNeeded, proofs, { includeFees: true });
const meltResponse = await wallet.meltProofs('bacs', meltQuote, proofsToSend);
```
