---
name: cashu-ts-migrate-v3-to-v4
description: This skill should be used when an agent needs to "upgrade cashu-ts from v3 to v4", "migrate @cashu/cashu-ts to version 4", "apply the cashu-ts v4 breaking changes", or "update a codebase to use cashu-ts 4.0.0". Provides a step-by-step mechanical recipe to locate and fix every breaking change introduced in v4.
version: 1.0.0
---

# Migrate cashu-ts v3 → v4

Work through every step in order. Record "no matches" and continue when a step finds nothing.
Consult `migration-4.0.0.md` (the human-readable reference) for deeper context on any change.

---

## Step 0 — Confirm scope

```bash
grep -r "@cashu/cashu-ts" package.json
grep -rn "from '@cashu/cashu-ts'" src/ --include="*.ts" -l
grep -rn "require('@cashu/cashu-ts')" src/ -l
```

Flag any `require(...)` hits — v4 is **ESM-only** (Step 1).

---

## Step 0b — Confirm `Amount` strategy

v4 introduces an `Amount` value object (bigint-backed, immutable) wherever the library previously returned or accepted a plain `number`. This is intentional: it supports amounts above `Number.MAX_SAFE_INTEGER` (e.g. millisatoshi accumulations) without silent precision loss.

`Amount` is immutable, bigint-backed, and non-negative. It provides:

- **Arithmetic**: `.add()`, `.subtract()`, `.multiplyBy()`, `.divideBy()`
- **Comparison**: `.lessThan()`, `.greaterThan()`, `.equals()`, etc.
- **Conversion**: `.toNumber()` (throws above `MAX_SAFE_INTEGER`), `.toBigInt()`, `.toString()`, `.toJSON()`
- **Finance**: `.scaledBy()`, `.ceilPercent()`, `.floorPercent()`, `.clamp()`, `.inRange()`
- **Construction**: `Amount.from(x)` accepts `number`, `bigint`, `string`, or another `Amount`

**Ask the user before proceeding:**

> v4 returns `Amount` objects from several APIs (see Step 3). Do you want the app to:
>
> a) **Adopt `Amount` natively** — keep `Amount` flowing through your own functions and types; call `.toNumber()` only at genuine display/float-math boundaries. Best for apps that may handle large amounts.
>
> b) **Convert back to `number` at the boundary** — call `.toNumber()` immediately on every `Amount` the library returns, preserving your existing `number`-typed code. Fine if your amounts will always be within safe-integer range.

Record the user's choice. It affects how you handle every `Amount` hit in Steps 3–5:

- Choice **a**: propagate `Amount` / `AmountLike` through the app's own functions and types; use `.toNumber()` only for float arithmetic (fee percentages etc.) and `Intl.NumberFormat` display of decimal units. Use `.toBigInt()` for integer units (SAT, JPY) passed to `Intl.NumberFormat` — it supports `bigint` natively.
- Choice **b**: apply `.toNumber()` at each library call-site and leave all internal types as `number`.

---

## Step 1 — ESM-only: eliminate CJS imports

Search: `require\(['"]@cashu/cashu-ts['"]\)`

For each match, convert the file to ESM (`import … from '@cashu/cashu-ts'`).
If the file must stay CJS, wrap in an async IIFE:

```js
(async () => {
	const { Wallet } = await import('@cashu/cashu-ts');
})();
```

Ensure `package.json` has `"type": "module"` or the bundler outputs ESM.

---

## Step 2 — `Proof.amount`: `number` → `bigint`

Search: `\.amount` near proof construction/access; `amount:` in proof literals.

Actions:

- Change proof literal amounts: `amount: 1000` → `amount: 1000n`
- Change accumulator seeds: `reduce((sum, p) => sum + p.amount, 0)` → `…, 0n)`
- Wrap for display: `Number(proof.amount)`
- Migrate stored proofs with `number` amounts on load:

```ts
import { normalizeProofAmounts } from '@cashu/cashu-ts';
const proofs = normalizeProofAmounts(legacyProofs); // converts number → bigint
```

---

## Step 3 — `Amount` value object (was `number`)

Many methods now return `Amount` instead of `number`. See the full table in `migration-4.0.0.md`.

Key affected symbols:
`sumProofs`, `getTokenMetadata().amount`, `OutputData.sumOutputAmounts`,
`wallet.getFeesForProofs`, `wallet.getFeesForKeyset`, `splitAmount`,
`getKeysetAmounts`, `MeltQuote.fee_reserve`, `MeltQuote.amount`,
`MintQuote.amount`, `PaymentRequest.amount`

**Choice b** — call `.toNumber()` at each site and leave internal types as `number`:

```ts
const fee: number = wallet.getFeesForProofs(proofs).toNumber();
const total = sendAmt + fee;
```

**Choice a** — propagate `Amount` through your own code; apply `.toNumber()` only at display and float-math boundaries:

```ts
const fee: Amount = wallet.getFeesForProofs(proofs);
const total = Amount.from(sendAmt).add(fee);
// JSON serialisation is automatic — Amount.toJSON() emits a plain number
```

If adopting Amount natively, see **Step 9** for Finance Helpers that replace common float patterns (`ceilPercent`, `floorPercent`, `scaledBy`, `clamp`, `inRange`).

---

## Step 4 — `SwapPreview.amount` / `.fees` now `AmountLike`

Search: `preview\.amount\b`, `preview\.fees\b`

Wrap before arithmetic:

```ts
// Before
const net = preview.amount.subtract(preview.fees);
// After
const net = Amount.from(preview.amount).subtract(Amount.from(preview.fees));
```

---

## Step 5 — `MintPreview.quote` is the full quote object

Search: `MintPreview`, `prepareMint`

`preview.quote` is now the full quote object (or `{ quote: string }` if a string ID was passed).
Access the ID via `preview.quote.quote`. Update any manually constructed `MintPreview` values:

```ts
// Before
const preview: MintPreview = { …, quote: 'q123' };
// After
const preview: MintPreview = { …, quote: { quote: 'q123' } };
```

---

## Step 6 — `KeyChain` / `KeyChainCache` multi-unit API

Search: `KeyChain`, `KeyChainCache`, `fromCache`, `mintToCacheDTO`, `getCache`

| Old call                                            | New call                                                     |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `KeyChain.fromCache(mint, cache)`                   | `KeyChain.fromCache(mint, 'sat', cache)`                     |
| `KeyChain.mintToCacheDTO(unit, url, keysets, keys)` | `KeyChain.mintToCacheDTO(url, keysets, keys)`                |
| `new KeyChain(mint, unit, keysets, keys)`           | `KeyChain.fromCache(mint, unit, KeyChain.mintToCacheDTO(…))` |
| `chain.getCache()`                                  | `chain.cache`                                                |

Remove `unit` from stored `KeyChainCache` objects. `keysets` now covers all units.

---

## Step 7 — V3 token encoding removed

Search: `getEncodedTokenV3`, `version.*3`, `cashuA`

- Remove `getEncodedTokenV3(…)` calls.
- Remove `{ version: 3 }` from `getEncodedToken(…)`.
- Upgrade stored v3 proofs before encoding:

```ts
const freshProofs = await wallet.receive(legacyProofsOrCashuAString);
getEncodedToken({ mint, proofs: freshProofs }); // outputs cashuB
```

`getDecodedToken` still decodes `cashuA` — no change needed for decoding.

---

## Step 8 — `getDecodedToken` now requires `keysetIds`; use `getTokenMetadata` + `wallet.decodeToken()` instead

Search: `getDecodedToken(`

`getDecodedToken` now requires a second argument — the wallet's full keyset ID list. Passing `[]` is **unsafe**: it throws the moment a token contains a v2 short keyset ID.

**The correct two-step pattern:**

```ts
// Step 1 — Before the wallet: extract mint and unit from the token string
import { getTokenMetadata } from '@cashu/cashu-ts';
const meta = getTokenMetadata(tokenString); // { mint, unit, amount: Amount, incompleteProofs }

// Step 2 — Build the wallet for that mint/unit
const wallet = new Wallet(meta.mint, { unit: meta.unit });
await wallet.loadMint(); // or loadMintFromCache if you have cached data

// Step 3 — Fully hydrate the token (maps short keyset IDs, validates, returns Token)
const token = wallet.decodeToken(tokenString); // Token with full Proof[]
```

`getTokenMetadata` is the **primary pre-wallet decoder**. It is always safe — it never needs keyset IDs. Use it whenever you need to know the mint URL or unit before a wallet exists.

`wallet.decodeToken(token)` is the **primary post-wallet decoder**. Use it after the wallet is loaded to get a fully-hydrated `Token` with complete `Proof[]`.

`getDecodedToken(string, keysetIds)` is for advanced flows where you already manage your own keyset cache and want to decode outside a wallet instance. Passing `[]` works only for tokens with standard hex keyset IDs (0x00-prefix).

**If you only need amount / mint / unit (no proofs):**

```ts
const { mint, unit, amount } = getTokenMetadata(tokenString);
const sats = amount.toNumber();
```

---

## Step 9 — (Choice a) Replace float arithmetic with Finance Helpers

Skip if the user chose Choice b.

Search for remaining `.toNumber()` calls in arithmetic context (not display), and float multiplications on amounts: `amount \* 0\.`, `Math\.ceil.*amount`, `Math\.floor.*amount`, `Math\.round.*amount`.

`Amount` provides Finance Helpers for the most common payment-domain patterns — all integer arithmetic, no floats, chainable:

| Pattern                                   | Replace with                           |
| ----------------------------------------- | -------------------------------------- |
| `Math.ceil(Math.max(min, amt * pct/100))` | `amt.ceilPercent(pct).clamp(min, amt)` |
| `Math.floor(amt * pct / 100)`             | `amt.floorPercent(pct)`                |
| `Math.round(a * b / c)`                   | `a.scaledBy(b, c)`                     |
| `Amount.max(lo, Amount.min(hi, val))`     | `val.clamp(lo, hi)`                    |
| `min <= x && x <= max`                    | `x.inRange(min, max)`                  |

Fractional percentages use a larger denominator — no floats needed:

```ts
amount.ceilPercent(1, 200); // ceil(0.5%)
amount.floorPercent(3, 200); // floor(1.5%)
```

---

## Step 10 — Removed deprecated v3 wallet methods

Search: `wallet\.swap\b`, `\.createMintQuote\b`, `\.checkMintQuote\b`, `\.mintProofs\b`,
`\.createMeltQuote\b`, `\.checkMeltQuote\b`, `\.meltProofs\b`,
`MeltBlanks`, `meltBlanksCreated`, `onChangeOutputsCreated`, `preferAsync`

| Removed                            | Replacement                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `wallet.swap(…)`                   | `wallet.send(…)`                                                            |
| `wallet.createMintQuote(amt)`      | `wallet.createMintQuoteBolt11(amt)`                                         |
| `wallet.checkMintQuote(id)`        | `wallet.checkMintQuoteBolt11(id)`                                           |
| `wallet.mintProofs(amt, q)`        | `wallet.mintProofsBolt11(amt, q)`                                           |
| `wallet.createMeltQuote(inv)`      | `wallet.createMeltQuoteBolt11(inv)`                                         |
| `wallet.checkMeltQuote(id)`        | `wallet.checkMeltQuoteBolt11(id)`                                           |
| `wallet.meltProofs(q, ps)`         | `wallet.meltProofsBolt11(q, ps)`                                            |
| `MeltBlanks` / `meltBlanksCreated` | `prepareMelt()` / `completeMelt()`                                          |
| `preferAsync: true`                | `prefer_async: true` in melt payload, or `completeMelt(preview, key, true)` |

---

## Step 11 — Wallet constructor preload options removed

Search: `new Wallet(`, constructor calls with `keys`, `keysets`, or `mintInfo` options.

```ts
// Before
const wallet = new Wallet(mint, { unit: 'sat', keys, keysets, mintInfo });
// After
const wallet = new Wallet(mint, { unit: 'sat' });
await wallet.loadMintFromCache(cache);
```

---

## Step 12 — Deprecated `Keyset` getters

Search: `\.active\b`, `\.input_fee_ppk\b`, `\.final_expiry\b`

| Old                    | New               |
| ---------------------- | ----------------- |
| `keyset.active`        | `keyset.isActive` |
| `keyset.input_fee_ppk` | `keyset.fee`      |
| `keyset.final_expiry`  | `keyset.expiry`   |

---

## Step 13 — Removed utility functions

Search: `bytesToNumber`, `verifyKeysetId`, `deriveKeysetId`, `getDecodedToken.*HasKeysetId`,
`handleTokens`, `checkResponse`, `deepEqual`, `mergeUInt8Arrays`, `hasNonHexId`,
`getKeepAmounts`, `MessageQueue`, `MessageNode`

See the full replacement table in `migration-4.0.0.md` → "Internal utility functions removed".

Key replacements:

- `bytesToNumber(b)` → `Bytes.toBigInt(b)`
- `verifyKeysetId(id, keys)` → `Keyset.verifyKeysetId(id, keys)`
- `deriveKeysetId(keys, unit)` → `deriveKeysetId({ keys, unit })`
- `handleTokens(token)` → `getDecodedToken(token)` or `getTokenMetadata(token)`
- `MessageQueue` (from utils) → `import { MessageQueue } from '@cashu/cashu-ts/transport/WSConnection'`

---

## Step 14 — Crypto primitive renames

Search: `RawProof`, `constructProofFromPromise`, `createRandomBlindedMessage`, `verifyProof`,
`SerializedProof`, `serializeProof`, `deserializeProof`, `BlindedMessage\b`

| Old                                                       | New                             |
| --------------------------------------------------------- | ------------------------------- |
| `RawProof`                                                | `UnblindedSignature`            |
| `constructProofFromPromise`                               | `constructUnblindedSignature`   |
| `createRandomBlindedMessage`                              | `createRandomRawBlindedMessage` |
| `verifyProof`                                             | `verifyUnblindedSignature`      |
| `BlindedMessage`                                          | `RawBlindedMessage`             |
| `SerializedProof` / `serializeProof` / `deserializeProof` | use `Proof` directly            |

`BlindSignature.amount` removed. `createBlindSignature` — drop the `amount` argument:

```ts
// Before
createBlindSignature(B_, privateKey, amount, id);
// After
createBlindSignature(B_, privateKey, id);
```

---

## Step 15 — NUT-11 / P2PK API

Search: `signP2PKSecret`, `verifyP2PKSecretSignature`, `getP2PKExpectedKWitnessPubkeys`,
`verifyP2PKSig`, `WellKnownSecret`, `getP2PKWitnessPubkeys`, `getP2PKWitnessRefundkeys`,
`getP2PKLocktime`, `getP2PKLockState`, `getP2PKNSigs`, `getP2PKNSigsRefund`

Replace low-level getter calls with `verifyP2PKSpendingConditions`:

```ts
// Before
const lockState = getP2PKLockState(proof.secret);
const mainKeys = getP2PKWitnessPubkeys(proof.secret);
const refundKeys = getP2PKWitnessRefundkeys(proof.secret);
const required = getP2PKNSigs(proof.secret);

// After
const result = verifyP2PKSpendingConditions(proof);
const { lockState, locktime } = result;
const mainKeys = result.main.pubkeys;
const refundKeys = result.refund.pubkeys;
const required = result.main.requiredSigners;
```

Other replacements: `signP2PKSecret` → `schnorrSignMessage`, `WellKnownSecret` → `SecretKind`,
`getP2PKExpectedKWitnessPubkeys` → `getP2PKExpectedWitnessPubkeys`.

Also update `P2PKVerificationResult` field reads:
`result.requiredSigners` → `result.main.requiredSigners`,
`result.eligibleSigners` → `result.main.pubkeys`,
`result.receivedSigners` → `result.main.receivedSigners`

### `P2PKBuilder` validation change

Search: `requireLockSignatures`, `requireRefundSignatures`

These now **throw** for non-positive-integer input (previously clamped silently).
Guard the value before passing:

```ts
const n = Math.max(1, Math.trunc(rawN));
builder.requireLockSignatures(n);
```

---

## Step 16 — Misc deprecated aliases

Search: `supportsBolt12Description`, `closeSubscription`

| Old                                  | New                                           |
| ------------------------------------ | --------------------------------------------- |
| `mintInfo.supportsBolt12Description` | `mintInfo.supportsNut04Description('bolt12')` |
| `wsConnection.closeSubscription(id)` | `wsConnection.cancelSubscription(id)`         |

---

## Step 17 — `OutputDataFactory` / `OutputDataLike` generic removed

Search: `OutputDataFactory`, `OutputDataLike`

Remove the `<TKeyset>` generic. Change `amount: number` → `amount: AmountLike` on factory signatures.

```ts
// Before
const factory: OutputDataFactory<MyKeyset> = (amount: number, keys: MyKeyset) => { … };
// After
import { Amount, type AmountLike, type HasKeysetKeys } from '@cashu/cashu-ts';
const factory: OutputDataFactory = (amount: AmountLike, keys: HasKeysetKeys) => { … };
```

---

## Step 18 — Type-check and test

```bash
npx tsc --noEmit
npm test
```

Remaining `number` / `bigint` mismatches on `Proof.amount` indicate stored proofs not yet
passed through `normalizeProofAmounts()`. `Amount` type errors indicate `.toNumber()` or
`Amount.from()` wrapping is missing.

---

## Reference

For full context, before/after examples, and the complete symbol-removal list, read:

- **`migration-4.0.0.md`** — human-readable reference with rationale for every change
