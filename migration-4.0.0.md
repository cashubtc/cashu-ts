# Version 4.0.0 Migration guide

⚠️ Upgrading to version 4.0.0 will come with breaking changes! Please follow the migration guide for a smooth transition to the new version.

## Breaking changes

### ESM-only package

cashu-ts v4 ships **only ES modules**. The CommonJS build (`lib/cashu-ts.cjs`) has been removed.

#### Why

Our core dependencies (`@noble/curves`, `@noble/hashes`, `@scure/bip32`) are ESM-only.
Maintaining a dual CJS build required bundling those deps into the CJS output, increasing
complexity and risk of module-duplication bugs.

#### What changed

- `package.json` no longer has a `"require"` condition in `exports` or a `"main"` field pointing to a `.cjs` file.
- `npm run compile` produces only the ESM bundle (`lib/cashu-ts.es.js`).
- The IIFE standalone browser build is unchanged.

#### Migration path for consumers

| Current setup                     | Migration                                     |
| --------------------------------- | --------------------------------------------- |
| `require('@cashu/cashu-ts')`      | Convert to ESM `import` or dynamic `import()` |
| Bundler configured for CJS output | Update bundler config to output ESM           |

```js
// Before (CJS)
const { Wallet } = require('@cashu/cashu-ts');

// After (ESM)
import { Wallet } from '@cashu/cashu-ts';
```

If you must keep a CJS entry point, use a dynamic import wrapper:

```js
// CJS compatibility using an IIFE
(async () => {
	const { Wallet } = await import('@cashu/cashu-ts');
	// ...
})();
```

---

## Amount fields on mint responses now return `Amount` objects

Previously typed as `number`, the following fields now return an `Amount` value object (imported from `@cashu/cashu-ts`):

| Type                         | Field(s)                                 |
| ---------------------------- | ---------------------------------------- |
| `MintQuoteBolt11Response`    | `amount`                                 |
| `MintQuoteBolt12Response`    | `amount`, `amount_paid`, `amount_issued` |
| `MeltQuoteBaseResponse`      | `amount`                                 |
| `MeltQuoteBolt11Response`    | `fee_reserve`                            |
| `MeltQuoteBolt12Response`    | `fee_reserve`                            |
| `SerializedBlindedSignature` | `amount`                                 |

`SwapMethod.min_amount` / `max_amount` (from `GetInfoResponse`) are now typed as `AmountLike` (`number | string | bigint | Amount`).

`expiry` fields on `MintQuoteBolt11Response` and `MintQuoteBolt12Response` now allow `null` (spec-compliant) in addition to `number`.

### Migration

```ts
// Before
const sats = meltQuote.fee_reserve + meltQuote.amount;
const n = meltQuote.amount;

// After
const sats = meltQuote.fee_reserve.add(meltQuote.amount).toNumber();
const n = meltQuote.amount.toNumber(); // throws if value > Number.MAX_SAFE_INTEGER

// Safe JSON serialisation: Amount.toJSON() emits a number for safe values,
// a decimal string for values above MAX_SAFE_INTEGER
JSON.stringify({ amount: meltQuote.amount }); // → '{"amount":1000}'
```

---

## `SerializedBlindedMessage.amount` is now `bigint`

`SerializedBlindedMessage` is the outbound wire type sent to the mint. Its `amount` field is now typed as `bigint` (previously `number`) so that `JSONInt.stringify` always emits a raw numeric token — even for msat values above `Number.MAX_SAFE_INTEGER`.

This type is not typically constructed directly by application code; it is produced internally by `BlindedMessage.getSerializedBlindedMessage()`. If you build `SerializedBlindedMessage` objects manually, update the `amount` field:

```ts
// Before
const output: SerializedBlindedMessage = { amount: 1000, id: keysetId, B_: hex };

// After
const output: SerializedBlindedMessage = { amount: 1000n, id: keysetId, B_: hex };
```

### Removed

- 2024 backwards-compat shims: deprecated `paid` boolean on melt responses, deprecated array-of-arrays `contact` field normalisation, deprecated NUT-04/05/06 response shapes

---

## `sumProofs()` and `TokenMetadata.amount` now return `Amount`

`sumProofs()` (utility function) and the `amount` field on `TokenMetadata` (returned by `getTokenMetadata()`) previously returned `number`; both now return an `Amount` value object.

```ts
// Before
const n: number = sumProofs(proofs);
const m: number = getTokenMetadata(token).amount;

// After
const total: Amount = sumProofs(proofs);
const n: number = total.toNumber(); // throws if value > Number.MAX_SAFE_INTEGER
const m: Amount = getTokenMetadata(token).amount;
```

---

## `OutputData.sumOutputAmounts()` now returns `Amount`

Previously returned `number`; now returns an `Amount` value object to be consistent with the rest of the v4 API.

```ts
// Before
const total: number = OutputData.sumOutputAmounts(outputs);

// After
const total: Amount = OutputData.sumOutputAmounts(outputs);
const n: number = total.toNumber(); // throws if value > Number.MAX_SAFE_INTEGER
```

---

## `SwapPreview.amount` and `SwapPreview.fees` are now `AmountLike`

Both fields on the `SwapPreview` type (returned by `prepareSend()` / `prepareReceive()`) are now typed as `AmountLike` rather than `Amount`. The wallet still returns `Amount` objects at runtime; the looser type allows deserialized previews (where amounts are plain numbers) to satisfy the type without wrapping in `Amount.from()`.

If you call `Amount` methods on these fields, wrap them first:

```ts
// Before — worked because the type was Amount
const net = preview.amount.subtract(preview.fees);

// After — use Amount.from() to restore arithmetic
const net = Amount.from(preview.amount).subtract(Amount.from(preview.fees));
const n: number = net.toNumber();
```

---

## `PaymentRequest.amount` now returns `Amount`

The `amount` field on `PaymentRequest` (and the result of `decodePaymentRequest()`) previously returned `number | undefined`; it now returns `Amount | undefined`.

```ts
// Before
const sats: number | undefined = request.amount;

// After
const sats: number | undefined = request.amount?.toNumber();
```

---

## Utility functions `splitAmount`, `getKeepAmounts`, and `getKeysetAmounts` now return `Amount[]`

These functions in `@cashu/cashu-ts` previously returned `number[]`; they now return `Amount[]`.

```ts
// Before
const chunks: number[] = splitAmount(1000, keys);
const keep: number[] = getKeepAmounts(proofs, 500, keys, 3);
const denominations: number[] = getKeysetAmounts(keyset);

// After
const chunks: Amount[] = splitAmount(1000, keys);
const keep: Amount[] = getKeepAmounts(proofs, 500, keys, 3);
const denominations: Amount[] = getKeysetAmounts(keyset);

// Convert to numbers where needed
chunks.map((a) => a.toNumber());
```

---

## `OutputDataFactory` and `OutputDataLike`: generic removed, `amount` parameter widened

Both types previously carried a `TKeyset extends HasKeysetKeys` generic parameter and the `amount` argument on `OutputDataFactory` was typed as `number`. Both changes are now applied:

- The `<TKeyset>` generic has been removed; the keyset parameter is fixed to `HasKeysetKeys`.
- The `amount` argument on `OutputDataFactory` is now `AmountLike` (was `number`).

```ts
// Before
const factory: OutputDataFactory<MyKeyset> = (amount: number, keys: MyKeyset) => { ... };
class MyOutput implements OutputDataLike<MyKeyset> { ... }

// After
import { Amount, type AmountLike, type HasKeysetKeys } from '@cashu/cashu-ts';
const factory: OutputDataFactory = (amount: AmountLike, keys: HasKeysetKeys) => {
    const a = Amount.from(amount);
    // ...
};
class MyOutput implements OutputDataLike { ... }
```

---

## `SelectProofs` type: `amountToSelect` parameter is now `AmountLike`

If you implement a custom `SelectProofs` function or hold a reference typed as `SelectProofs`, update the `amountToSelect` parameter from `number` to `AmountLike`.

```ts
// Before
const mySelector: SelectProofs = (proofs, amountToSelect: number, ...) => { ... };

// After
import { type AmountLike } from '@cashu/cashu-ts';
const mySelector: SelectProofs = (proofs, amountToSelect: AmountLike, ...) => { ... };
```

---

## `MintPreview.quote` is now the full quote object

`prepareMint()` previously stored only the quote ID string in `MintPreview.quote`. It now stores the full quote object returned by the mint, giving consumers access to informational fields (`expiry`, `request`, `amount`, `unit`) needed for NUT-19 retry flows.

```ts
// Before — quote was a plain string
const preview = await wallet.prepareMint('bolt11', 1000, quoteResponse);
preview.quote; // string (quote ID only)

// After — quote is the full TQuote object when a quote object is passed
const preview = await wallet.prepareMint('bolt11', 1000, quoteResponse);
preview.quote.expiry; // number | null — accessible now
preview.quote.request; // string — Lightning invoice

// If you passed a string quote ID, the field is { quote: string }
const preview2 = await wallet.prepareMint('bolt11', 1000, 'q123');
preview2.quote; // { quote: 'q123' }
```

The type is `MintPreview<TQuote>` where `TQuote extends { quote: string }` (defaults to `MintQuoteBaseResponse`).

If you construct a `MintPreview` manually (e.g., after deserialization), update the `quote` field from a bare string to an object:

```ts
// Before
const preview: MintPreview = { ..., quote: 'q123' };

// After — pass the full quote object returned by createMintQuoteBolt11/12
const preview: MintPreview = { ..., quote: mintQuoteResponse };
```

---

## `Proof.amount` is now `bigint`

The `amount` field on the `Proof` type has changed from `number` to `bigint`. This affects any code that constructs, stores, or compares proof amounts.

```ts
// Before
const proof: Proof = { id, amount: 1000, C, secret };
const total = proofs.reduce((sum, p) => sum + p.amount, 0);

// After
const proof: Proof = { id, amount: 1000n, C, secret };
const total = proofs.reduce((sum, p) => sum + p.amount, 0n);

// Convert to number when needed (e.g. display)
const display: number = Number(proof.amount); // safe for typical sat amounts
```

If you persist proofs to a database or serialize them to JSON, the `amount` field will now serialise as a JSON integer (unchanged over the wire), but your stored TypeScript types need updating to `bigint`.

A `normalizeProofAmounts()` helper is exported for migrating stored proofs that were saved with `number` amounts:

```ts
import { normalizeProofAmounts } from '@cashu/cashu-ts';

const legacyProofs = db.load(); // amount fields are numbers
const proofs = normalizeProofAmounts(legacyProofs); // amount fields are bigints
```

---

## `Wallet.getFeesForProofs()` and `Wallet.getFeesForKeyset()` now return `Amount`

Both methods previously returned `number`; they now return `Amount` value objects, consistent with other fee and amount fields in the v4 API.

```ts
// Before
const fee: number = wallet.getFeesForProofs(proofs);
const total = sendAmount + fee;

const ksFee: number = wallet.getFeesForKeyset(3, keysetId);

// After
const fee: Amount = wallet.getFeesForProofs(proofs);
const total = Amount.from(sendAmount).add(fee);
const n: number = fee.toNumber();

const ksFee: Amount = wallet.getFeesForKeyset(3, keysetId);
```

---

## Crypto primitive renames

The following low-level exports from `@cashu/cashu-ts` (re-exported from the crypto layer) have been renamed for clarity. The old names no longer exist.

| Old name                     | New name                        |
| ---------------------------- | ------------------------------- |
| `RawProof`                   | `UnblindedSignature`            |
| `constructProofFromPromise`  | `constructUnblindedSignature`   |
| `createRandomBlindedMessage` | `createRandomRawBlindedMessage` |
| `verifyProof`                | `verifyUnblindedSignature`      |

These are low-level primitives not typically used by application code. If you use them directly, update your imports:

```ts
// Before
import {
	RawProof,
	constructProofFromPromise,
	createRandomBlindedMessage,
	verifyProof,
} from '@cashu/cashu-ts';

// After
import {
	UnblindedSignature,
	constructUnblindedSignature,
	createRandomRawBlindedMessage,
	verifyUnblindedSignature,
} from '@cashu/cashu-ts';
```

### Removed crypto primitives

The following exports have been removed with no replacement — they were dead code not used outside the library:

| Removed              | Notes                                                           |
| -------------------- | --------------------------------------------------------------- |
| `SerializedProof`    | Hex-serialised proof type; use `Proof` directly                 |
| `serializeProof()`   | Use `Proof` values directly — no serialisation step is needed   |
| `deserializeProof()` | Use `Proof` values directly — no deserialisation step is needed |
| `BlindedMessage`     | Was a deprecated alias for `RawBlindedMessage`; use the latter  |

### `BlindSignature.amount` field removed

`BlindSignature` (the post-blinding crypto primitive) had an `amount` field that was never used in any cryptographic computation. It has been removed. The type is now:

```ts
type BlindSignature = { C_: WeierstrassPoint<bigint>; id: string };
```

### `createBlindSignature` — `amount` parameter removed

The `amount` parameter has been dropped from `createBlindSignature`. Amount is determined at the `OutputData` layer, not the crypto layer.

```ts
// Before
createBlindSignature(B_, privateKey, amount, id);

// After
createBlindSignature(B_, privateKey, id);
```

---

## KeyChain and KeyChainCache: multi-unit support and API cleanup

### `KeyChainCache` — `unit` field removed, `savedAt` field added

The `unit` field has been removed from `KeyChainCache`. The cache now contains keysets for **all** units at the mint. Use an explicit `unit` argument when restoring from cache.

The new `savedAt?: number` field (unix ms) is set automatically when the cache is created. Use it to implement TTL / staleness checks in your app.

```ts
// Before
type KeyChainCache = { keysets: KeysetCache[]; unit: string; mintUrl: string };

// After
type KeyChainCache = { keysets: KeysetCache[]; mintUrl: string; savedAt?: number };
```

### `KeyChain.fromCache` — explicit `unit` parameter

```ts
// Before
const chain = KeyChain.fromCache(mint, cache);

// After — unit is now the second argument
const chain = KeyChain.fromCache(mint, 'sat', cache);
```

### `KeyChain.mintToCacheDTO` — `unit` parameter removed

The first argument (`unit`) has been dropped. The cache is now mint-wide (all units).

```ts
// Before
const cache = KeyChain.mintToCacheDTO(unit, mintUrl, keysets, keys);

// After
const cache = KeyChain.mintToCacheDTO(mintUrl, keysets, keys);
```

### `KeyChain` constructor — `cachedKeysets` and `cachedKeys` removed

The optional `cachedKeysets` and `cachedKeys` constructor parameters have been removed. Use `mintToCacheDTO` + `fromCache` instead:

```ts
// Before
const chain = new KeyChain(mint, unit, keysets, keys);

// After
const cache = KeyChain.mintToCacheDTO(mintUrl, keysets, keys);
const chain = KeyChain.fromCache(mint, unit, cache);
```

### `KeyChain.getCache()` — removed

The v3-deprecated `getCache()` method has been removed. Use the `cache` getter instead.

### `KeyChainCache` now contains all units

Previously, `cache.keysets` only contained keysets for the wallet's unit. It now contains keysets for every unit the mint exposes. If you read `cache.keysets` directly and assumed single-unit contents, filter by `unit` yourself.

---

## Deprecated v3 APIs now removed

These APIs were already deprecated in v3. In v4 they have been removed:

- `Wallet` constructor preload options `keys`, `keysets`, and `mintInfo`; use `loadMintFromCache()` after construction.
- Deprecated wallet method alias: `wallet.swap`; use `send`.
- `Keyset` getter aliases `active`, `input_fee_ppk`, and `final_expiry`; use `isActive`, `fee`, and `expiry`.
- `preferAsync` on melt option objects; set `prefer_async: true` in the melt payload or call `completeMelt(preview, privkey, true)`.
- `MeltBlanks`, `wallet.on.meltBlanksCreated(cb)`, and `onChangeOutputsCreated`; use `prepareMelt()` / `completeMelt()` with `MeltPreview`.
- Deprecated utility helpers and overloads in `src/utils/core`: `bytesToNumber`, `verifyKeysetId`, the positional `deriveKeysetId(...)` signature, and the `getDecodedToken(..., HasKeysetId[])` overload; use `Bytes.toBigInt`, `Keyset.verifyKeysetId(...)`, the options-based `deriveKeysetId(...)`, and `string[]` keyset IDs.
- Deprecated NUT-11 helpers and aliases: the `parseP2PKSecret(Uint8Array)` overload, `WellKnownSecret`, `signP2PKSecret`, `verifyP2PKSecretSignature`, `getP2PKExpectedKWitnessPubkeys`, and `verifyP2PKSig`; use `parseP2PKSecret(string | Secret)`, `SecretKind`, `schnorrSignMessage`, `schnorrVerifyMessage`, `getP2PKExpectedWitnessPubkeys`, and `isP2PKSpendAuthorised()` / `verifyP2PKSpendingConditions()`.
- Deprecated convenience aliases removed elsewhere in the API: `MintInfo.supportsBolt12Description` and `WSConnection.closeSubscription()`; use `supportsNut04Description('bolt12')` and `cancelSubscription()` instead.
- Deprecated crypto/type aliases removed in the v4 cleanup, including `BlindedMessage`; use the non-deprecated names such as `RawBlindedMessage`.

---

## Generic mint/melt quote and proof methods

The v3-deprecated wallet method aliases (`createMintQuote`, `checkMintQuote`, `mintProofs`, `createMeltQuote`, `checkMeltQuote`, `meltProofs`) have been **replaced** — not just removed — with generic versions that accept a `method` string as the first parameter. This enables support for custom payment methods (e.g., BACS, SWIFT) without requiring first-class library support.

### New generic methods on `Wallet`

| Method                                                              | Description                                |
| ------------------------------------------------------------------- | ------------------------------------------ |
| `createMintQuote(method, payload, options?)`                        | Create a mint quote for any payment method |
| `checkMintQuote(method, quote, options?)`                           | Check a mint quote for any payment method  |
| `mintProofs(method, amount, quote, config?, outputType?)`           | Mint proofs for any payment method         |
| `createMeltQuote(method, payload, options?)`                        | Create a melt quote for any payment method |
| `checkMeltQuote(method, quote, options?)`                           | Check a melt quote for any payment method  |
| `meltProofs(method, meltQuote, proofsToSend, config?, outputType?)` | Melt proofs for any payment method         |

### New generic methods on `Mint` (low-level HTTP)

| Method                                       | Description                           |
| -------------------------------------------- | ------------------------------------- |
| `createMintQuote(method, payload, options?)` | POST `/v1/mint/quote/{method}`        |
| `checkMintQuote(method, quote, options?)`    | GET `/v1/mint/quote/{method}/{quote}` |
| `createMeltQuote(method, payload, options?)` | POST `/v1/melt/quote/{method}`        |
| `checkMeltQuote(method, quote, options?)`    | GET `/v1/melt/quote/{method}/{quote}` |

The existing bolt11/bolt12 convenience methods (`createMintQuoteBolt11`, `meltProofsBolt11`, etc.) are unchanged and now delegate to these generics internally.

### `Mint.mint()` and `Mint.melt()` options signature change

The `options` parameter on `Mint.mint()` and `Mint.melt()` has been extended with an optional `normalize` callback. If you spread the options object or type it explicitly, update accordingly:

```ts
// Before
await mint.mint('bolt11', payload, { customRequest: myFetch });
await mint.melt('bolt11', payload, { customRequest: myFetch });

// After — unchanged for basic usage, but the options type now includes `normalize`
await mint.mint('bolt11', payload, { customRequest: myFetch });
await mint.melt('bolt11', payload, { customRequest: myFetch });
```

### Migration for v3 deprecated aliases

If you were still using the v3 deprecated aliases, update to the bolt11-specific methods or the new generics:

```ts
// Before (v3 deprecated aliases — these were bolt11 only)
const quote = await wallet.createMintQuote(64);
const checked = await wallet.checkMintQuote(quote.quote);
const proofs = await wallet.mintProofs(64, quote);
const meltQuote = await wallet.createMeltQuote(invoice);
const meltChecked = await wallet.checkMeltQuote(meltQuote.quote);
const result = await wallet.meltProofs(meltQuote, proofsToSend);

// After — option A: use the bolt11-specific methods (recommended for bolt11)
const quote = await wallet.createMintQuoteBolt11(64);
const checked = await wallet.checkMintQuoteBolt11(quote.quote);
const proofs = await wallet.mintProofsBolt11(64, quote);
const meltQuote = await wallet.createMeltQuoteBolt11(invoice);
const meltChecked = await wallet.checkMeltQuoteBolt11(meltQuote.quote);
const result = await wallet.meltProofsBolt11(meltQuote, proofsToSend);

// After — option B: use the new generics (for custom payment methods)
const quote = await wallet.createMintQuote('bacs', { amount: 5000n, ... });
const checked = await wallet.checkMintQuote('bacs', quote.quote);
const proofs = await wallet.mintProofs('bacs', 5000, quote);
```

### Normalize callback

All generic methods accept an optional `normalize` callback for coercing method-specific response fields (e.g., converting wire numbers to `Amount` objects). The callback receives the raw wire data after base normalization has already been applied:

```ts
type BacsQuoteRes = MintQuoteBaseResponse & { amount: Amount; reference: string };

const quote = await wallet.createMintQuote<BacsQuoteRes>(
	'bacs',
	{
		amount: 5000n,
		sort_code: '12-34-56',
	},
	{
		normalize: (raw) => ({
			...(raw as BacsQuoteRes),
			amount: Amount.from(raw.amount as AmountLike),
		}),
	},
);
```

For melt quotes, base fields (`amount`, `expiry`, `change`) are always normalized automatically. For bolt11/bolt12, `fee_reserve` and `request` are also normalized. The `normalize` callback runs last, after all built-in normalization.

---
