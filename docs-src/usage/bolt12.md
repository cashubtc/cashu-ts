[Documents](../index.html) › [Usage Examples](../usage/usage_index.md) › **Bolt12**

#### BOLT12 (Reusable Offers)

BOLT12 enables reusable Lightning offers that can be paid multiple times, unlike BOLT11 invoices which are single-use. Key differences:

- **Reusable**: Same offer can receive multiple payments
- **Amount flexibility**: Offers can be amountless (payer chooses amount)

```typescript
// Create reusable BOLT12 offer
const bolt12Quote = await wallet.createMintQuoteBolt12(bytesToHex(pubkey), {
	amount: 1000, // Optional: omit to create an amountless offer
	description: 'My reusable offer', // The mint must signal in their settings that offers with a description are supported
});

// Pay a BOLT12 offer
const meltQuote = await wallet.createMeltQuoteBolt12(offer, 1000000); // amount in msat
const { keep, send } = await wallet.send(meltQuote.amount + meltQuote.fee_reserve, proofs);
const { change } = await wallet.meltProofsBolt12(meltQuote, send);

// Mint from accumulated BOLT12 payments
const updatedQuote = await wallet.checkMintQuoteBolt12(bolt12Quote.quote);
const availableAmount = updatedQuote.amount_paid - updatedQuote.amount_issued;
if (availableAmount > 0) {
	const newProofs = await wallet.mintProofsBolt12(
		availableAmount,
		updatedQuote,
		bytesToHex(privateKey),
	);
}
```
