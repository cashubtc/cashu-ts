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

## `SwapPreview.amount` and `SwapPreview.fees` now return `Amount`

Both fields on the `SwapPreview` type (returned by `Wallet.getSwapPreview()`) previously returned `number`; both now return `Amount`.

```ts
// Before
const net: number = preview.amount - preview.fees;

// After
const net: Amount = preview.amount.subtract(preview.fees);
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

## `OutputDataFactory` callback: `amount` parameter is now `AmountLike`

If you implement a custom `OutputDataFactory`, the `amount` argument previously typed as `number` is now `AmountLike`. Update your callback signature and use `Amount.from(amount)` if you need an `Amount` object.

```ts
// Before
const factory: OutputDataFactory = (amount: number, keys) => { ... };

// After
import { Amount, type AmountLike } from '@cashu/cashu-ts';
const factory: OutputDataFactory = (amount: AmountLike, keys) => {
    const a = Amount.from(amount);
    // ...
};
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
