[Documents](../index.html) › [Usage Examples](../usage/usage_index.md) › **Melt Token**

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

await saveMeltPreview(meltPreview);
const meltResponse = await wallet.completeMelt(meltPreview);
```

## 3) Generic melt for custom payment methods

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
