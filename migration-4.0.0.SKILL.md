---
name: cashu-ts-migrate-v3-to-v4
description: Use this skill to "upgrade cashu-ts from v3 to v4" in a JS/TS codebase. Provides a step-by-step guide to fix every breaking change introduced in v4.
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

v4 introduces an immutable, bigint-backed `Amount` value object wherever the library previously returned or accepted a plain `number`. This avoids silent precision loss above `Number.MAX_SAFE_INTEGER` (for example, large millisatoshi totals).

`Amount` is immutable, bigint-backed, and non-negative. It provides:

- **Arithmetic**: `.add()`, `.subtract()`, `.multiplyBy()`, `.divideBy()`
- **Comparison**: `.lessThan()`, `.greaterThan()`, `.equals()`, etc.
- **Conversion**: `.toNumber()` (throws above `MAX_SAFE_INTEGER`), `.toBigInt()`, `.toString()`, `.toJSON()`
- **Finance**: `.scaledBy()`, `.ceilPercent()`, `.floorPercent()`, `.clamp()`, `.inRange()`
- **Construction**: `Amount.from(x)` accepts `number`, `bigint`, `string`, or another `Amount`

**Ask the user before proceeding:**

> v4 returns `Amount` objects from several APIs (see Step 3). Do you want the app to:
>
> a) **Adopt `Amount` natively** — keep `Amount` flowing through your own functions and types; use `Amount` helpers for arithmetic and call `.toNumber()` only at genuine number-only boundaries. Best for apps that may handle large amounts.
>
> b) **Convert back to `number` at the boundary** — call `.toNumber()` immediately on every `Amount` the library returns, preserving your existing `number`-typed code. Fine if your amounts will always be within safe-integer range.

Record the user's choice. It affects every `Amount` hit in Steps 3–5:

- Choice **a**: propagate `Amount` / `AmountLike` through the app's own functions and types; use `Amount` helpers for arithmetic and call `.toNumber()` only at genuine number-only boundaries. For display, prefer string-safe formatting; for integer units (SAT, JPY), avoid eager `.toNumber()` and use runtime-appropriate bigint/string formatting rather than assuming `Intl.NumberFormat` bigint support.
- Choice **b**: apply `.toNumber()` at each library call-site and leave all internal types as `number`.

---

## Step 0c — Amount, sign, and JSON boundaries

Apply these rules throughout the migration:

### `Amount` is non-negative only

- `Amount` represents a **non-negative integer magnitude**
- `Amount.from(...)` accepts `AmountLike`: `number | bigint | string | Amount`
- string input must be a non-negative decimal integer

Model sign separately; do not use `Amount` itself for signed debit/credit values.

### `AmountLike` is magnitude-only

`AmountLike` is `number | bigint | string | Amount`. It is a magnitude boundary type, not a signed amount type. Use it for integer input from JSON, storage, user input, or external APIs, then normalize back to `Amount` for domain logic.

eg:

```ts
const someinteger: AmountLike = ...; // boundary variable
const amount = Amount.from(someinteger); // bigint backed VO
```

### Keep `Amount` in memory; choose JSON handling deliberately

Default migration posture:

- domain logic: `Amount`
- minimal migrations / app storage: plain JSON is acceptable because `Amount.toJSON()` always emits a decimal string (previously it returned `number` for safe integers, now always `string`)
- integer-preserving transport or persistence: prefer `JSONInt.parse` / `JSONInt.stringify`
- UI formatting: `Amount` or sign + `Amount`

If you round-trip an `Amount` through plain JSON at a leaf field, rehydrate it with `Amount.from(...)`. Do not flatten everything back to `number` unless the user explicitly chose that strategy in Step 0b.

### Choose number conversion deliberately

- `toNumber()` = safe or throw
- `toNumberUnsafe()` = accept precision loss

Use `toNumber()` for boundaries that must not lie. Use `toNumberUnsafe()` only where lossy output is explicitly acceptable.

### Agent guardrails

- Never call `Amount.from()` on a signed string
- Never assume `AmountLike` accepts negative values
- Prefer `JSONInt.stringify` / `JSONInt.parse` for integer-bearing payloads when you want numeric/bigint fidelity after parse
- Prefer bigint/string-safe formatting over eager `.toNumber()` for display

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

## Step 2 — `Proof.amount`: `number` → `Amount`

Search: `\.amount` near proof construction/access; `amount:` in proof literals.

Actions:

- Change proof literal amounts: `amount: 1000` → `amount: Amount.from(1000)`
- Change accumulators: `reduce((sum, p) => sum + p.amount, 0)` → `reduce((sum, p) => sum.add(p.amount), Amount.zero())` or for proofs, use `sumProofs()`.
- Wrap for display or comparisons: `proof.amount.toString()`, `proof.amount.equals(1000)`
- `ProofLike` is `Omit<Proof, 'amount'> & { amount: AmountLike }` — a proof whose `amount` is not yet normalized to `Amount`.
- Use `serializeProofs`/`deserializeProofs` for proof serialization. `serializeProofs` returns `string[]` (one JSON string per proof). `deserializeProofs` accepts `string | string[] | ProofLike[]` — pass the raw JSON string directly (no `JSON.parse` needed), a `string[]` for individual proof strings, or a `ProofLike[]` for already-parsed objects:

```ts
import { serializeProofs, deserializeProofs } from '@cashu/cashu-ts';

// localStorage — serializeProofs returns string[], so wrap with JSON.stringify for storage.
localStorage.setItem('proofs', JSON.stringify(serializeProofs(proofs)));
const proofs = deserializeProofs(localStorage.getItem('proofs') ?? '[]');

// NutZap proof tags — one string per proof, pass string[] directly
const proofTags = serializeProofs(proofs).map((s) => ['proof', s]);
const proofs = deserializeProofs(event.tags.filter((t) => t[0] === 'proof').map((t) => t[1]));

// Already-parsed objects (e.g. from a database query) — also accepted directly
const proofs = deserializeProofs(db.query('SELECT * FROM proofs'));
```

`normalizeProofAmounts(raw: ProofLike[])` is the lower-level helper behind `deserializeProofs`. Use it when you already have typed `ProofLike[]` and just need to normalize `amount` to `Amount`.

Migration rule: treat wallet/mint/API/JSON proofs as `ProofLike[]` until normalized. Normalize before app-level arithmetic, encoding, or storage-model conversion.

Core wallet flows now accept `ProofLike[]` directly. If those proofs are only being passed into wallet APIs such as `send`, `sendOffline`, `receive`, `prepareSwapToSend`, `meltProofs...`, or `signP2PKProofs`, you can often skip manual normalization. The same applies to `WalletOps` / builder entry points such as `wallet.ops.send(...)`, `wallet.ops.receive(...)`, and `wallet.ops.meltBolt11(...)`.

`wallet.selectProofsToSend()` and `wallet.groupProofsByState()` also accept `ProofLike[]`. Proofs from storage with `amount: number` can be passed directly. `groupProofsByState` is generic — it preserves the input type in its output.

---

## Step 3 — `Amount` value object (was `number`)

Many methods now return `Amount` instead of `number`. See `migration-4.0.0.md` for the full table.

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

**Choice a** — propagate `Amount` through your own code; use `Amount` helpers for arithmetic and call `.toNumber()` only at genuine number-only boundaries:

```ts
const fee: Amount = wallet.getFeesForProofs(proofs);
const total = Amount.from(sendAmt).add(fee);
// JSON serialisation is automatic — Amount.toJSON() emits a string
```

If adopting Amount natively, see **Step 9** for Finance Helpers that replace common float patterns (`ceilPercent`, `floorPercent`, `scaledBy`, `clamp`, `inRange`).

---

## Step 4 — `SwapPreview.amount` / `.fees` now `Amount`

Search: `preview\.amount\b`, `preview\.fees\b`

If the preview came directly from the wallet, these fields are already `Amount`. If you persisted and later reloaded the preview, rehydrate before arithmetic. Only wrap the operand you call the method on: methods like `.subtract(...)` already accept `AmountLike` for the argument.

```ts
// Before
const net = preview.amount - preview.fees;
// After
const net = Amount.from(preview.amount).subtract(preview.fees);
```

---

## Step 5 — `MintPreview.quote` is the full quote object

Search: `MintPreview`, `prepareMint`

`preview.quote` is now a quote object. If you only have a quote ID string, wrap it as `{ quote: string }` and access the ID via `preview.quote.quote`:

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

## Step 12 — Deprecated `Keyset` class getters

Search: `\.active\b`, `\.input_fee_ppk\b`, `\.final_expiry\b`

| Old                    | New               |
| ---------------------- | ----------------- |
| `keyset.active`        | `keyset.isActive` |
| `keyset.input_fee_ppk` | `keyset.fee`      |
| `keyset.final_expiry`  | `keyset.expiry`   |

Note: Ensure the app is referring to a Cashu-TS `Keyset` domain model. Some apps may be using the raw API `MintKeyset` / `MintKeys` DTOs, which have the same "old" fields!

---

## Step 13 — Removed utility functions

Search: `bytesToNumber`, `verifyKeysetId`, `deriveKeysetId`, `getDecodedToken.*HasKeysetId`,
`handleTokens`, `checkResponse`, `deepEqual`, `mergeUInt8Arrays`, `hasNonHexId`,
`getKeepAmounts`, `getEncodedTokenV4`, `MessageQueue`, `MessageNode`

See the full replacement table in `migration-4.0.0.md` → "Internal utility functions removed".

Key replacements:

- `bytesToNumber(b)` → `Bytes.toBigInt(b)`
- `verifyKeysetId(id, keys)` → `Keyset.verifyKeysetId(id, keys)`
- `deriveKeysetId(keys, unit)` → `deriveKeysetId({ keys, unit })`
- `handleTokens(token)` → `getTokenMetadata(token)` before a wallet exists, then `wallet.decodeToken(token)` after the wallet is loaded; use `getDecodedToken(token, keysetIds)` only in advanced flows
- `getEncodedTokenV4(token)` → `getEncodedToken(token)`
- `MessageQueue` / `MessageNode` → remove direct imports and use supported `WSConnection` APIs instead

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

## Step 18 — Shared `CounterSource` (optional improvement)

Search: `counterInit`, manual counter increment/persist patterns.

If the app creates multiple wallet instances for the same seed with independent `counterInit` snapshots, consider using `createEphemeralCounterSource()` (new in v4) to share a single counter source:

```ts
import { createEphemeralCounterSource } from '@cashu/cashu-ts';

const counterSource = createEphemeralCounterSource(loadCountersFromDb());
const wallet = new Wallet(mintUrl, { unit, bip39seed, counterSource });
wallet.on.countersReserved(({ keysetId, next }) => saveNextToDb(keysetId, next));
```

This is not a breaking change — existing `counterInit` usage continues to work. The factory is a DX improvement for apps that need shared counter allocation across wallet instances.

---

## Step 19 — Type-check and test

```bash
# Usually, but check your app:
npx tsc --noEmit
npm test
```

Remaining `AmountLike` / `Amount` mismatches on `Proof.amount` indicate stored proofs not yet
normalized — use `deserializeProofs()` for JSON sources or `normalizeProofAmounts()` for
already-parsed objects (e.g. database rows). More generally, `Amount` type errors usually mean
either a boundary value needs `Amount.from(...)`, or code that previously used `number` now needs
to keep an `Amount` rather than converting it.

---

## Reference

For full context, before/after examples, and the complete symbol-removal list, read:

- **`migration-4.0.0.md`** — human-readable reference with rationale for every change
