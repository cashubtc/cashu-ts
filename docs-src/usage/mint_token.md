[Documents](../index.html) › [Usage Examples](../usage/usage_index.md) › **Mint Token**

# Mint tokens

## 1) One-step BOLT11 mint

```ts
import { Wallet, MintQuoteState } from '@cashu/cashu-ts';

const mintUrl = 'http://localhost:3338';
const wallet = new Wallet(mintUrl);
await wallet.loadMint(); // wallet is now ready to use

const mintQuote = await wallet.createMintQuoteBolt11(64);
// pay the invoice here before you continue...
const mintQuoteChecked = await wallet.checkMintQuoteBolt11(mintQuote.quote);
if (mintQuoteChecked.state === MintQuoteState.PAID) {
	const proofs = await wallet.mintProofsBolt11(64, mintQuote.quote);
}
// store proofs in your app ..
```

## 2) Two-step BOLT11 mint with `prepareMint()` / `completeMint()`

The two-step process gives you a chance to persist the preview before calling the mint. This works
well with NUT-19 transport retries and lets you recover safely if your app restarts between steps.

```ts
import { Wallet, MintQuoteState } from '@cashu/cashu-ts';

const wallet = new Wallet('http://localhost:3338');
await wallet.loadMint();

const mintQuote = await wallet.createMintQuoteBolt11(64);
// pay the invoice here before continuing...

const mintQuoteChecked = await wallet.checkMintQuoteBolt11(mintQuote.quote);
if (mintQuoteChecked.state !== MintQuoteState.PAID) {
	throw new Error('Mint quote is not paid yet');
}

const preview = await wallet.prepareMint('bolt11', 64, mintQuote.quote, undefined, {
	type: 'deterministic',
	counter: 0,
});

// Persist `preview` here if you want to retry safely later.
const proofs = await wallet.completeMint(preview);
```

## 3) Two-step BOLT12 mint

```ts
import { Wallet } from '@cashu/cashu-ts';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';

const wallet = new Wallet('http://localhost:3338');
await wallet.loadMint();

const privkey = randomBytes(32);
const pubkey = bytesToHex(secp256k1.getPublicKey(privkey, true));

const mintQuote = await wallet.createMintQuoteBolt12(pubkey, {
	amount: 64,
	description: 'Top up wallet',
});

// pay the BOLT12 offer here, then re-check the quote...
const updatedQuote = await wallet.checkMintQuoteBolt12(mintQuote.quote);
const availableAmount = updatedQuote.amount_paid.subtract(updatedQuote.amount_issued);
if (availableAmount.lessThanOrEqual(0)) {
	throw new Error('No paid amount available to mint');
}

const preview = await wallet.prepareMint('bolt12', availableAmount, updatedQuote, {
	privkey: bytesToHex(privkey),
});
const proofs = await wallet.completeMint(preview);
```

## 4) Generic mint for custom payment methods

The generic `createMintQuote()` / `mintProofs()` methods support arbitrary payment methods without requiring first-class library support.

The mint must advertise the method at `/v1/mint/quote/{method}`.

```ts
import {
	Wallet,
	Amount,
	MintQuoteState,
	type MintQuoteBaseResponse,
	type AmountLike,
} from '@cashu/cashu-ts';

// Define your custom quote response type
type BacsMintQuoteResponse = MintQuoteBaseResponse & {
	amount: Amount;
	state: MintQuoteState;
	reference: string; // bank transfer reference
};

const wallet = new Wallet('http://localhost:3338');
await wallet.loadMint();

// Create a mint quote using the generic method
const mintQuote = await wallet.createMintQuote<BacsMintQuoteResponse>(
	'bacs',
	{
		amount: 5000n,
		sort_code: '12-34-56',
		account_number: '12345678',
	},
	{
		normalize: (raw) => ({
			...(raw as BacsMintQuoteResponse),
			amount: Amount.from(raw.amount as AmountLike),
		}),
	},
);

// mintQuote.reference → "CASHU-ABC123" (bank transfer reference to show user)
// mintQuote.request   → payment instructions from the mint

// Check the quote status
const updated = await wallet.checkMintQuote<BacsMintQuoteResponse>('bacs', mintQuote.quote, {
	normalize: (raw) => ({
		...(raw as BacsMintQuoteResponse),
		amount: Amount.from(raw.amount as AmountLike),
	}),
});

// Mint once the bank transfer is confirmed
if (updated.state === MintQuoteState.PAID) {
	const proofs = await wallet.mintProofs('bacs', 5000, updated);
}
```
