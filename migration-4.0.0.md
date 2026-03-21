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

## `MeltBlanks`, `meltBlanksCreated`, and `onChangeOutputsCreated` removed

The legacy NUT-08 blanks callback API has been removed entirely. Use `prepareMelt()` + `completeMelt()` to achieve the same NUT-19 retry safety.

### Removed APIs

| API                                              | Replacement                                                   |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `MeltBlanks` type                                | `MeltPreview`                                                 |
| `wallet.on.meltBlanksCreated(cb)`                | `await wallet.prepareMelt(...)` and persist the `MeltPreview` |
| `MeltProofsConfig.onChangeOutputsCreated`        | `prepareMelt()`                                               |
| `ops.meltBolt11(...).onChangeOutputsCreated(cb)` | `.prepare()` to get a `MeltPreview`                           |

### Migration

```ts
// Before — legacy callback pattern
let savedBlanks: MeltBlanks | undefined;
await wallet.meltProofsBolt11(quote, proofs, {
	onChangeOutputsCreated: (blanks) => {
		savedBlanks = blanks;
		persist(blanks); // save for retry
	},
});
// ... later, retry:
if (savedBlanks) await wallet.completeMelt(savedBlanks);

// After — prepare/complete pattern
const preview = await wallet.prepareMelt('bolt11', quote, proofs);
persist(preview); // save for retry
await wallet.completeMelt(preview);
// ... later, retry:
const preview = restore(); // load persisted MeltPreview
await wallet.completeMelt(preview);
```

`prepareMelt()` / `MeltBuilder` only require `{ quote: string, amount: Amount }` on the quote argument — you do not need a full `MeltQuoteBolt11Response`. A persisted quote ID and amount are sufficient:

```ts
// Minimal quote — no need to re-fetch the full quote object
const preview = await wallet.prepareMelt(
	'bolt11',
	{ quote: storedQuoteId, amount: storedAmount },
	proofs,
);
await wallet.completeMelt(preview);
```

`completeMelt()` only requires `{ quote: { quote: string } }` on the input — a deserialized `MeltPreview` satisfies this without needing to reconstruct `Amount` fields on the quote object.

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

## `Wallet.getFeesForProofs()` now returns `Amount`

Previously returned `number`; now returns an `Amount` value object, consistent with other fee fields in the v4 API.

```ts
// Before
const fee: number = wallet.getFeesForProofs(proofs);
const total = sendAmount + fee;

// After
const fee: Amount = wallet.getFeesForProofs(proofs);
const total = Amount.from(sendAmount).add(fee);
const n: number = fee.toNumber();
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

## `preferAsync` option removed from `melt()` / `meltBolt11()` / `meltBolt12()` options

The deprecated `preferAsync` option on `Mint.melt()` and the wallet's `meltBolt11()`/`meltBolt12()` option objects has been removed. It was already marked deprecated (the guidance was to set `prefer_async: true` directly in the `MeltRequest` payload). It is no longer accepted.

If you need NUT-06 async melt, pass `prefer_async: true` in the melt payload, or use `completeMelt(preview, privkey, true)`:

```ts
// Before
await wallet.meltProofsBolt11(quote, proofs, { preferAsync: true });

// After — set in payload directly, or via completeMelt's third argument
const preview = await wallet.prepareMelt('bolt11', quote, proofs);
await wallet.completeMelt(preview, undefined, true);
// or equivalently:
// await wallet.completeMelt(preview, undefined, /* preferAsync */ false);
// and put prefer_async: true in the MeltRequest payload yourself
```

---
