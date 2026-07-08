# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Mint Token**

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

const preview = await wallet.prepareMint('bolt11', 64, mintQuoteChecked, undefined, {
  type: 'deterministic',
  counter: 0,
});

// Persist an app-defined snapshot here if you want to retry safely later.
// Do not call JSON.stringify(preview) directly; preview objects contain non-JSON-safe values.
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

The NUT-04 base fields (`quote`, `request`, `unit`, `method`, `amount_paid`, `amount_issued`, `updated_at`, `expiry`) are normalized and validated automatically for every method — the optional `normalize` callback is only needed for method-specific fields. Without a type parameter, the generic methods return `MintQuoteGenericResponse`, which exposes method-specific fields as `unknown`.

```ts
import { Wallet, Amount, type MintQuoteBaseResponse, type AmountLike } from '@cashu/cashu-ts';

// Define your custom quote response type
type BacsMintQuoteResponse = MintQuoteBaseResponse & {
  amount: Amount;
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

// Mint once the bank transfer is confirmed. The accounting fields are the
// method-independent way to read quote progress: paid minus issued is mintable.
const available = updated.amount_paid.subtract(updated.amount_issued);
if (available.greaterThanOrEqual(5000)) {
  const proofs = await wallet.mintProofs('bacs', 5000, updated);
}
```

## 5) Batch check and batch mint (NUT-29)

Mints that support NUT-29 can check and mint multiple quotes in single requests.

```ts
const checked = await wallet.checkMintQuoteBatchBolt11(['quote-1', 'quote-2']);

// prepareBatchMint() fails if any quote is unpaid, so batch the paid ones only
const paid = checked.filter((quote) => quote.state === MintQuoteState.PAID);

const preview = await wallet.prepareBatchMint(
  'bolt11',
  paid.map((quote) => ({ amount: quote.amount, quote })),
);

const newProofs = await wallet.completeBatchMint(preview);
```

- `checkMintQuoteBatch*()` returns quote objects in the same order as the request.
- Custom methods use `wallet.checkMintQuoteBatch(method, quotes)` with the same `normalize`
  callback as `checkMintQuote()` (see section 4).
- Mints that predate the batch check endpoint return an error; fall back to the per-quote
  `checkMintQuote*()` methods.
