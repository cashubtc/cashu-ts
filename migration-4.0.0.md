# Version 4.0.0 Migration guide

⚠️ Upgrading to version 4.0.0 will come with breaking changes! Please follow the migration guide for a smooth transition to the new version.

**TIP**: If you use a coding agent, you can point them to `migration-4.0.0.SKILL.md`.

---

## The `Amount` value object — what changed and what it means for your app

Many v4 APIs that previously returned or accepted `number` now use `Amount`. This avoids silent precision loss above `Number.MAX_SAFE_INTEGER`, which matters for millisatoshi or other high-volume integer accounting.

`Amount` is immutable, bigint-backed, and non-negative. It provides:

- **Arithmetic**: `.add()`, `.subtract()`, `.multiplyBy()`, `.divideBy()`
- **Comparison**: `.lessThan()`, `.greaterThan()`, `.equals()`, etc.
- **Conversion**: `.toNumber()` (throws above `MAX_SAFE_INTEGER`), `.toBigInt()`, `.toString()`, `.toJSON()`
- **Finance**: `.scaledBy()`, `.ceilPercent()`, `.floorPercent()`, `.clamp()`, `.inRange()`
- **Construction**: `Amount.from(x)` accepts `number`, `bigint`, `string`, or another `Amount`

### Choosing your migration strategy

Before you start updating call sites, decide how deeply you want to adopt `Amount`:

**Option A — Adopt `Amount` natively (recommended for new or large-amount apps)**
Keep `Amount` flowing through your own functions and types. Use `Amount` helpers for arithmetic, and convert to `number` only at boundaries that truly require a JavaScript number. For display, prefer string-safe formatting where possible: for integer-unit currencies like SAT, avoid eager `.toNumber()` and use runtime-appropriate bigint/string formatting; for decimal or minor-unit currencies, use formatting helpers that preserve precision instead of eagerly calling `.toNumber()`.

**Option B — Convert at the boundary (simplest for existing number-typed codebases)**
Call `.toNumber()` immediately on every `Amount` the library returns, then leave all your internal types as `number`. Safe as long as your amounts stay within `Number.MAX_SAFE_INTEGER`.

Both strategies are valid. The sections below show the mechanical changes required; the key question is whether you propagate `Amount` inward or flatten it at the edge.

### Practical `Amount` rules

- `Amount` is for non-negative integer magnitudes only. Model sign separately.
- `AmountLike` is a boundary type: `number | bigint | string | Amount`.
- Normalize external input with `Amount.from(...)`, then keep `Amount` in domain logic.
- Plain JSON is acceptable for minimal migrations because `Amount.toJSON()` emits a decimal string.
- If you round-trip an `Amount` through plain JSON, rehydrate it with `Amount.from(...)`.
- Prefer `JSONInt.stringify` / `JSONInt.parse` for persisted or transported integer-bearing payloads when you want numeric/bigint fidelity after parse.
- `toNumber()` is safe-or-throw; `toNumberUnsafe()` is explicitly lossy.
- For display, prefer string-safe formatting and avoid eager `.toNumber()`.

```ts
const raw: AmountLike = getExternalAmount();
const amount = Amount.from(raw);
```

---

## ESM-only package

cashu-ts v4 ships **only ES modules**. The CommonJS build (`lib/cashu-ts.cjs`) has been removed.

Our core dependencies (`@noble/curves`, `@noble/hashes`, `@scure/bip32`) are ESM-only.
Maintaining a dual CJS build required bundling those deps into the CJS output, increasing
complexity and risk of module-duplication bugs.

- `package.json` no longer has a `"require"` condition in `exports` or a `"main"` field pointing to a `.cjs` file.
- `npm run compile` produces only the ESM bundle (`lib/cashu-ts.es.js`).
- The IIFE standalone browser build is unchanged.

### Migration

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

// Amount.toJSON() always emits a decimal string (previously number | string).
// This means JSON.stringify produces a quoted string, not a bare number:
JSON.stringify({ amount: meltQuote.amount }); // → '{"amount":"1000"}' (not '{"amount":1000}')

// Rehydrate a JSON leaf value back to Amount
const parsed = JSON.parse('{"amount":"1000"}');
const amount = Amount.from(parsed.amount);
```

---

## `SerializedBlindedMessage.amount` is now `Amount`

`SerializedBlindedMessage` is the outbound wire type sent to the mint. Its `amount` field is now typed as `Amount` (previously `number`), consistent with the rest of the v4 amount model.

This type is not typically constructed directly by application code; it is produced internally by `BlindedMessage.getSerializedBlindedMessage()`. If you build `SerializedBlindedMessage` objects manually, update the `amount` field:

```ts
// Before
const output: SerializedBlindedMessage = { amount: 1000, id: keysetId, B_: hex };

// After
const output: SerializedBlindedMessage = { amount: Amount.from(1000), id: keysetId, B_: hex };
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

## `SwapPreview.amount` and `SwapPreview.fees` are now `Amount`

Both fields on the `SwapPreview` type (returned by `prepareSwapToSend()` / `prepareSwapToReceive()`) are typed as `Amount`.

If you persist or deserialize previews yourself, rehydrate before calling `Amount` methods. In arithmetic expressions, you only need to rehydrate the operand you are invoking the method on: methods like `.subtract(...)` already accept `AmountLike` for the argument.

```ts
// Before
const net = preview.amount - preview.fees;

// After — if the preview came from JSON/storage
const net = Amount.from(preview.amount).subtract(preview.fees);
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

## Utility functions `splitAmount` and `getKeysetAmounts` now return `Amount[]`

These public functions in `@cashu/cashu-ts` previously returned `number[]`; they now return `Amount[]`.

```ts
// Before
const chunks: number[] = splitAmount(1000, keys);
const denominations: number[] = getKeysetAmounts(keyset);

// After
const chunks: Amount[] = splitAmount(1000, keys);
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

`prepareMint()` previously stored only the quote ID string in `MintPreview.quote`. It now stores the full quote object passed into `prepareMint()`, giving consumers access to informational fields (`expiry`, `request`, `amount`, `unit`) needed for NUT-19 retry flows.

```ts
// Before — quote was stored on the preview as a plain string
const previewV3: MintPreview = { ..., quote: 'q123' };
previewV3.quote; // string (quote ID only)

// After — quote is the full TQuote object when a quote object is passed
const preview = await wallet.prepareMint('bolt11', 1000, quoteResponse);
preview.quote.expiry; // number | null — accessible now
preview.quote.request; // string — Lightning invoice

// prepareMint() now expects a quote object, not a string ID
const preview2 = await wallet.prepareMint('bolt11', 1000, { quote: 'q123' });
preview2.quote; // { quote: 'q123' }
```

The type is `MintPreview<TQuote>` where `TQuote extends { quote: string }` (defaults to `MintQuoteBaseResponse`).

If you only have a bolt11 quote ID string, use `mintProofsBolt11(amount, quoteId)` rather than `prepareMint()`.

If you construct a `MintPreview` manually (e.g., after deserialization), update the `quote` field from a bare string to an object:

```ts
// Before
const preview: MintPreview = { ..., quote: 'q123' };

// After — pass the full quote object returned by createMintQuoteBolt11/12
const preview: MintPreview = { ..., quote: mintQuoteResponse };
```

Also note that preview objects are not intended for direct `JSON.stringify(...)`.
`MintPreview`, `MeltPreview`, `BatchMintPreview`, and `SwapPreview` contain values such as
`Amount`, `bigint`, `Uint8Array`, and class instances that need explicit rehydration. If you
persist previews for replay-safe recovery, serialize them into an app-defined snapshot format and
explicitly rehydrate them before passing them back to `completeMint()`, `completeMelt()`, or
`completeSwap()`.

---

## `Proof.amount` is now `Amount`

The `amount` field on the `Proof` type has changed from `number` to `Amount`. This affects any code that constructs, stores, or compares proof amounts.

```ts
// Before
const proof: Proof = { id, amount: 1000, C, secret };
const total = proofs.reduce((sum, p) => sum + p.amount, 0);

// After
const proof: Proof = { id, amount: Amount.from(1000), C, secret };
const total: Amount = proofs.reduce((sum, p) => sum.add(p.amount), Amount.zero());
// or more simply
const total: Amount = sumProofs(proofs);

// Convert or compare explicitly when needed
const display: number = proof.amount.toNumber();
const isExact = proof.amount.equals(1000);
```

If you persist proofs to JSON or a database, see the [Proof serialization](#proof-serialization) section below for the helper functions provided.

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

## `MessageQueue` and `MessageNode` are no longer public top-level utils

`MessageQueue` and `MessageNode` are no longer exported from `@cashu/cashu-ts` utils. `MessageNode` is no longer part of the public API, and `MessageQueue` should be treated as internal rather than migrated as a supported import.

If you were importing these classes directly:

```ts
// Before
import { MessageQueue, MessageNode } from '@cashu/cashu-ts';

// After
// Use supported WSConnection APIs instead of importing queue internals directly
```

---

## Internal utility functions removed or restricted

Several functions that were intended for internal use have been removed from the public API.

### Removed entirely (dead code)

| Function        | Notes                                                                             |
| --------------- | --------------------------------------------------------------------------------- |
| `checkResponse` | Superseded by the `HttpResponseError` transport refactor in 2023. Had no callers. |
| `deepEqual`     | Generic deep-equality helper. Had no callers inside or outside the library.       |

### Made private (no longer exported)

| Function            | Notes                                                           |
| ------------------- | --------------------------------------------------------------- |
| `mergeUInt8Arrays`  | Internal byte-buffer helper.                                    |
| `hasNonHexId`       | Internal guard used inside token encoding.                      |
| `getKeepAmounts`    | Internal wallet coin-selection algorithm. Removed from `utils`. |
| `getEncodedTokenV4` | Use `getEncodedToken` instead.                                  |

### Marked `@internal`

The following are still exported but are excluded from the trimmed type definitions and not part of the supported public API. Remove any external dependencies on them.

| Function                | Notes                                          |
| ----------------------- | ---------------------------------------------- |
| `isValidHex`            | Internal helper.                               |
| `hexToNumber`           | Crypto scalar helper (hex → bigint).           |
| `numberToHexPadded64`   | Crypto scalar helper (bigint → 64-char hex).   |
| `isObj`                 | HTTP response type guard.                      |
| `joinUrls`              | Mint URL path builder.                         |
| `sanitizeUrl`           | Renamed to `normalizeUrl` (internal).          |
| `invoiceHasAmountInHRP` | BOLT-11 HRP amount detector.                   |
| `bigIntStringify`       | `JSON.stringify` replacer for `bigint` values. |

### `handleTokens` no longer exported

`handleTokens` should always have been an internal function, but was exported. If you used this function, prefer `getTokenMetadata` before a wallet exists, then `wallet.decodeToken(...)` after the wallet is loaded. Use `getDecodedToken(str, keysetIds)` only in advanced flows where you already manage keyset IDs yourself.

---

## Proof serialization

`ProofLike` is a new exported type: a proof-shaped object whose `amount` has not yet been normalized to `Amount` (i.e. `Omit<Proof, 'amount'> & { amount: AmountLike }`). Use it to model proofs from external storage where `amount` may be a `number`, `string`, `bigint`, or `Amount`.

Three helpers cover the common patterns for persisting and restoring proofs:

| Function                     | Use case                                                                                                                                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serializeProofs(proofs)`    | Serialize `Proof \| Proof[]` to `string[]` (one JSON string per proof) without precision loss.                                                                                                                                                                              |
| `deserializeProofs(json)`    | Restore `string \| string[] \| ProofLike[]` back to `Proof[]`, with `amount` normalized to `Amount`. Pass a raw JSON string directly (no `JSON.parse` needed), a `string[]` for individual proof strings (e.g. NutZap tags), or a `ProofLike[]` for already-parsed objects. |
| `normalizeProofAmounts(raw)` | Lower-level building block: convert `ProofLike[]` to `Proof[]` by normalizing `amount` to `Amount`. Called internally by `deserializeProofs`; use directly when you already have typed `ProofLike[]` and want to skip string-detection.                                     |

Migration rule: treat wallet/mint/API/JSON proofs as `ProofLike[]` until normalized. Normalize before app-level arithmetic, encoding, or storage-model conversion.

**Tip**: Core wallet flows now accept `ProofLike[]` directly. If you already have deserialized proof objects from JSON or storage, you can usually pass them straight into wallet APIs such as `wallet.receive(...)`, `wallet.send(...)`, `wallet.sendOffline(...)`, `wallet.prepareSwapToSend(...)`, `wallet.meltProofs...(...)`, and `wallet.signP2PKProofs(...)` without calling `normalizeProofAmounts(...)` yourself first. The same applies to `WalletOps` / builder entry points such as `wallet.ops.send(...)`, `wallet.ops.receive(...)`, and `wallet.ops.meltBolt11(...)`.

`wallet.selectProofsToSend()` and `wallet.groupProofsByState()` also accept `ProofLike[]`, so proofs loaded from storage (with `amount: number`) can be passed directly without conversion. `groupProofsByState` preserves the input type in its output — pass `MyProof[]` in, get `MyProof[]` back.

```ts
import { serializeProofs, deserializeProofs } from '@cashu/cashu-ts';

// localStorage — serializeProofs returns string[], so wrap with JSON.stringify for storage.
localStorage.setItem('proofs', JSON.stringify(serializeProofs(proofs)));
const proofs = deserializeProofs(localStorage.getItem('proofs') ?? '[]');

// NutZap proof tags — one proof string per tag
const proofTags = serializeProofs(proofs).map((s) => ['proof', s]);
const proofs = deserializeProofs(event.tags.filter((t) => t[0] === 'proof').map((t) => t[1]));

// Already-parsed objects (e.g. from a database query) — also accepted directly
const proofs = deserializeProofs(db.query('SELECT * FROM proofs'));
```

Use `getEncodedToken` when you need a full cashu token string (mint URL + unit metadata). Use `serializeProofs` when you only need to store or transmit raw proof arrays.

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

## `getEncodedTokenV3` removed

V3 token encoding (`cashuA…`) is no longer supported. `getEncodedTokenV3` has been removed and the `version` option on `getEncodedToken` has been removed entirely. V3 token **decoding** is unaffected — `getDecodedToken` still handles `cashuA` tokens.

```ts
// Before
import { getEncodedTokenV3, getEncodedToken } from '@cashu/cashu-ts';

getEncodedTokenV3(token);
getEncodedToken(token, { version: 3 });

// After — encoding proofs with legacy base64 keyset IDs throws:
// "Proofs contain a legacy keyset ID and cannot be encoded. Swap them at the mint first."
getEncodedToken({ mint, proofs: proofsWithBase64KeysetIds });
```

To resolve this, swap the proofs at the mint. `wallet.receive()` now accepts proof arrays directly, including deserialized/stored `ProofLike[]`, so no token string is needed:

```ts
const freshProofs = await wallet.receive(legacyProofs);
getEncodedToken({ mint, proofs: freshProofs }); // encodes as cashuB (v4)
```

If you have a stored `cashuA` string, you can pass that instead — v3 decoding still works:

```ts
const freshProofs = await wallet.receive('cashuAeyJ0b2tlbi...');
getEncodedToken({ mint, proofs: freshProofs }); // encodes as cashuB (v4)
```

---

## `getDecodedToken` now requires `keysetIds`

Prefer `getTokenMetadata` + `wallet.decodeToken()`

`getDecodedToken` now requires a second argument: `keysetIds: readonly string[]`. This array is used to resolve v2 short keyset IDs to their full hex counterparts.

**Passing an empty array is unsafe** — it throws the moment a token contains a v2 short keyset ID.

### Recommended migration

Instead of calling `getDecodedToken` directly, use the two-step pattern:

```ts
// Before
import { getDecodedToken } from '@cashu/cashu-ts';
const token = getDecodedToken(tokenString); // TS error in v4 — second arg required

// After — Step 1: metadata before the wallet exists
import { getTokenMetadata } from '@cashu/cashu-ts';
const meta = getTokenMetadata(tokenString);
// meta.mint, meta.unit, meta.amount (Amount), meta.incompleteProofs

// After — Step 2: build and load the wallet
// Validate meta.mint before any network call, especially in server-side code.
const wallet = new Wallet(meta.mint, { unit: meta.unit });
await wallet.loadMint(); // or wallet.loadMintFromCache(mintInfo, keyChainCache)

// After — Step 3: fully hydrate the token
const token = wallet.decodeToken(tokenString); // Token with complete Proof[]
```

### When to use each API

| API                         | When to use                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `getTokenMetadata(str)`     | Before a wallet exists — get mint URL, unit, and amount to decide which wallet to create. Treat the mint URL as untrusted until validated |
| `wallet.decodeToken(str)`   | After wallet is loaded — get the complete `Token` with full `Proof[]`                                                                     |
| `getDecodedToken(str, ids)` | Advanced: you manage your own keyset cache and decode outside a wallet instance                                                           |

### If you only need amount / mint / unit

```ts
const { mint, unit, amount } = getTokenMetadata(tokenString);
const sats = amount.toNumber(); // amount is Amount, not number
```

---

## Deprecated v3 APIs now removed

These APIs were already deprecated in v3. In v4 they have been removed:

- `Wallet` constructor preload options `keys`, `keysets`, and `mintInfo`; use `loadMintFromCache()` after construction.
- Deprecated wallet method alias: `wallet.swap`; use `send`.
- `Keyset` getter aliases `active`, `input_fee_ppk`, and `final_expiry`; use `isActive`, `fee`, and `expiry`. Ensure you are looking at the Cashu-TS `Keyset` domain model: raw API `MintKeyset` / `MintKeys` DTOs may still expose the old field names.
- `preferAsync` on melt option objects; set `prefer_async: true` in the melt payload or call `completeMelt(preview, privkey, true)`.
- `MeltBlanks`, `wallet.on.meltBlanksCreated(cb)`, and `onChangeOutputsCreated`; use `prepareMelt()` / `completeMelt()` with `MeltPreview`.
- Deprecated utility helpers and overloads in `src/utils/core`: `bytesToNumber`, `verifyKeysetId`, the positional `deriveKeysetId(...)` signature, and the `getDecodedToken(..., HasKeysetId[])` overload; use `Bytes.toBigInt`, `Keyset.verifyKeysetId(...)`, the options-based `deriveKeysetId(...)`, and `string[]` keyset IDs.
- Deprecated convenience aliases removed elsewhere in the API: `MintInfo.supportsBolt12Description` and `WSConnection.closeSubscription()`; use `supportsNut04Description('bolt12')` and `cancelSubscription()` instead.
- Deprecated crypto/type aliases removed in the v4 cleanup, including `BlindedMessage`; use the non-deprecated names such as `RawBlindedMessage`.

---

## NUT-11 / P2PK API changes

v4 trims the public NUT-11 surface and moves callers toward two supported entry points:

- `getP2PKExpectedWitnessPubkeys(secret)` if you only need to know which pubkeys can currently sign
- `verifyP2PKSpendingConditions(proof, logger?, message?)` if you need the full lock/refund evaluation result

### Removed deprecated aliases

These older exports are gone in v4:

- `parseP2PKSecret(Uint8Array)` overload
- `WellKnownSecret`
- `signP2PKSecret`
- `verifyP2PKSecretSignature`
- `getP2PKExpectedKWitnessPubkeys`
- `verifyP2PKSig`

Use these instead:

- `parseP2PKSecret(string | Secret)`
- `SecretKind`
- `schnorrSignMessage(...)`
- `schnorrVerifyMessage(...)`
- `getP2PKExpectedWitnessPubkeys(...)`
- `isP2PKSpendAuthorised(...)` or `verifyP2PKSpendingConditions(...)`

### Removed low-level NUT-11 getters

These helpers are no longer public:

- `getP2PKWitnessPubkeys`
- `getP2PKWitnessRefundkeys`
- `getP2PKLocktime`
- `getP2PKLockState`
- `getP2PKNSigs`
- `getP2PKNSigsRefund`

If your code previously called those helpers and stitched the result together manually, migrate to `verifyP2PKSpendingConditions()` and read the returned metadata instead.

```ts
// Before
const lockState = getP2PKLockState(proof.secret);
const locktime = getP2PKLocktime(proof.secret);
const mainKeys = getP2PKWitnessPubkeys(proof.secret);
const refundKeys = getP2PKWitnessRefundkeys(proof.secret);
const required = getP2PKNSigs(proof.secret);
const refundRequired = getP2PKNSigsRefund(proof.secret);

// After
const result = verifyP2PKSpendingConditions(proof);
const { lockState, locktime } = result;
const mainKeys = result.main.pubkeys;
const refundKeys = result.refund.pubkeys;
const required = result.main.requiredSigners;
const refundRequired = result.refund.requiredSigners;
```

### `P2PKVerificationResult` shape changed

`verifyP2PKSpendingConditions()` still returns a detailed result object, but signer metadata is now grouped by path:

```ts
// Before
result.requiredSigners;
result.eligibleSigners;
result.receivedSigners;

// After
result.locktime;
result.main.requiredSigners;
result.main.pubkeys;
result.main.receivedSigners;
result.refund.requiredSigners;
result.refund.pubkeys;
result.refund.receivedSigners;
```

This makes the result unambiguous when both main and refund paths exist.

### `P2PKBuilder` now follows the same pubkey identity rules as NUT-11

`P2PKBuilder.addLockPubkey()` and `addRefundPubkey()` now normalize and deduplicate keys by x-only pubkey identity. In practice, that means `02...` and `03...` encodings of the same x-only key are treated as the same signer, and the first one added wins.

If your code relied on storing both encodings as distinct entries, update those expectations:

```ts
// Before
new P2PKBuilder().addRefundPubkey(['03' + xOnly, '02' + xOnly]).toOptions().refundKeys;
// => ['03' + xOnly, '02' + xOnly]

// After
new P2PKBuilder().addRefundPubkey(['03' + xOnly, '02' + xOnly]).toOptions().refundKeys;
// => ['03' + xOnly]
```

### `P2PKBuilder.requireLockSignatures()` and `requireRefundSignatures()` now throw for invalid input

Previously these methods silently clamped the value to at least 1 and truncated non-integers. They now throw if the argument is not a positive integer (`n < 1` or non-integer).

```ts
// Before — invalid values were silently clamped
builder.requireLockSignatures(0); // stored as 1 (clamped)
builder.requireLockSignatures(1.7); // stored as 1 (truncated)

// After — throws immediately
builder.requireLockSignatures(0); // throws: 'requiredSignatures must be a positive integer'
builder.requireLockSignatures(1.7); // throws: 'requiredSignatures must be a positive integer'
```

Ensure any value passed to these methods is a positive integer, or guard it beforehand:

```ts
const n = Math.max(1, Math.trunc(rawValue));
builder.requireLockSignatures(n);
```

---

## Generic mint/melt quote and proof methods

The v3-deprecated wallet method aliases (`createMintQuote`, `checkMintQuote`, `mintProofs`, `createMeltQuote`, `checkMeltQuote`, `meltProofs`) were removed. v4 also adds new generic methods that accept a `method` string as the first parameter, primarily to support custom payment methods (e.g., BACS, SWIFT) without requiring first-class library support.

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

The existing bolt11/bolt12 convenience methods (`createMintQuoteBolt11`, `meltProofsBolt11`, etc.) remain the recommended APIs for built-in methods. Use the generics when you need custom methods or intentionally want the lower-level method-oriented flow.

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

## Finance Helpers — going further with `Amount`

If you adopt `Amount` natively, it has methods to replace common float-based patterns with exact integer arithmetic:

- `ceilPercent(numerator, denominator = 100)` for rounded-up percentages
- `floorPercent(numerator, denominator = 100)` for conservative lower bounds
- `scaledBy(numerator, denominator)` for proportional rescaling
- `clamp(min, max)` for bounding into a closed range
- `inRange(min, max)` for inclusive range checks

```ts
const fee = amount.ceilPercent(2).clamp(2, amount);
const maxSpend = amount.floorPercent(98);
const adjusted = estInvAmount.scaledBy(tokenAmount, neededAmount).subtract(1);
const bounded = fee.clamp(MIN_FEE, tokenAmount);
if (msats.inRange(data.minSendable, data.maxSendable)) { ... }
```

---

## New: `createEphemeralCounterSource` factory

v4 adds a public factory for the built-in in-memory `CounterSource`:

```ts
import { createEphemeralCounterSource } from '@cashu/cashu-ts';

const counters = createEphemeralCounterSource(loadCountersFromDb());
```

Previously, consumers who needed a shared `CounterSource` across multiple wallet instances had to either deep-import the internal `EphemeralCounterSource` class or reimplement the interface. The factory provides the same capability without exposing the concrete class.

This is useful when your app creates multiple short-lived wallet instances for the same seed — passing a shared `counterSource` prevents concurrent operations from reserving overlapping counter ranges. See the [deterministic counters guide](./docs-src/deterministic_counters.md) for the full pattern.

---
