# Version 5.0.0 Migration guide

⚠️ Upgrading to version 5.0.0 will come with breaking changes! Please follow the migration guide for a smooth transition to the new version.

---

## What's new: BLS12-381 v3 keysets

v5 introduces support for **v3 keysets**, identified by a `02` prefix on the keyset id. v3 keysets use BLS12-381 instead of secp256k1 for the BDHKE blinding curve, with multiplicative blinding and pairing-based verification replacing DLEQ. Wire-compatible with Nutshell PR #999.

Existing v0 (legacy base64), v1 (`00…`), and v2 (`01…`) keysets continue to work unchanged. The breaking change below was prompted by adding v3 support but is independent of which curve you target.

---

## Keyset output policy: new proofs require an active, prefixed keyset

Proofs on **any** keyset can still be spent, swapped, and restored. But v5 now enforces a policy on which keysets may be used to **create new proofs**: the output keyset must be active and have a hex-prefixed id (`00…`/`01…`/`02…`).

Previously this was only enforced on the automatic path (the wallet binds to the cheapest active hex keyset). An explicit `config.keysetId` bypassed both checks, so outputs could be created on a deprecated legacy (base64-id) keyset or on an inactive keyset — which the mint would then reject.

- `receive`, `prepareSwap`/`send`, `prepareMint`, `prepareBatchMint`, and `prepareMelt` now throw `Legacy keyset cannot be used to create new proofs` or `Inactive keyset cannot be used to create new proofs` if the resolved output keyset (explicit `keysetId` or wallet-bound) violates the policy.
- `completeSwap`/`completeMint`/`completeBatchMint` are **not** gated: the mint has already signed, so a persisted preview (NUT-19) still completes even if the keyset was deactivated in the meantime.
- `restore()` is **not** gated: proofs on legacy keysets remain recoverable.
- `bindKeyset()`/`withKeyset()` still allow binding to inactive keysets (useful for restore); the policy fires when an output operation is attempted.

No migration is needed unless you deliberately created outputs on inactive or legacy keysets — those calls were already doomed to fail at the mint and now fail earlier with a clearer error.

---

## Mint quotes now require a usable active keyset

All mint-quote creation methods (`createMintQuote`, `createMintQuoteBolt11`, `createLockedMintQuote`, `createMintQuoteBolt12`, `createMintQuoteOnchain`) now throw `no active keyset for unit '…' — a paid mint quote could not be redeemed` if the mint has no usable (active, hex-id, keyed) keyset for the wallet's unit. This prevents paying an invoice for a quote that could never be redeemed for proofs — `loadMint` deliberately tolerates keyset-less mints (e.g. a mint unwinding liabilities) by leaving the wallet unbound, so without this check the failure only surfaced after payment, at minting time.

### Migration

⚠️ The generic `createMintQuote()` previously worked **before** `loadMint()` — it was a thin POST wrapper with no initialization requirement. It now requires an initialized wallet (in v4 the keyset check logs a deprecation warning instead of throwing).

The generic `createMintQuote()` and `createMeltQuote()` also now enforce NUT-04/NUT-05 method support, like the typed helpers always did: the mint must advertise the method for the wallet's unit in its info (`nuts.4.methods` / `nuts.5.methods`), or the call throws `Mint does not support <method> mint for unit '…'`. Custom methods remain fully supported — the spec requires mints to advertise them like any other method.

```ts
// Before (worked without loadMint)
const wallet = new Wallet(mintUrl);
const quote = await wallet.createMintQuote('bolt11', { amount: 21 });

// After: load the mint first (recommended)
const wallet = new Wallet(mintUrl);
await wallet.loadMint();
const quote = await wallet.createMintQuote('bolt11', { amount: 21 });

// Or, for a bare HTTP call with no keyset checks, drop down to the Mint class
const quote = await new Mint(mintUrl).createMintQuote('bolt11', { amount: 21, unit: 'sat' });
```

The typed methods (`createMintQuoteBolt11` etc.) already required `loadMint()` (they check NUT-04/NUT-06 support), so no call-order change is needed there.

---

## Crypto deep imports were reorganized

The internal crypto module layout changed to separate curve-specific primitives from shared
coordination code. The new curve files are implementation modules, not stable import targets. If
you were relying on existing file-level imports such as `crypto/core`, move those imports to the
public package entry point.

Use the public package entry point instead:

```ts
// Before
import { blindMessage, hashToCurve } from '@cashu/cashu-ts/crypto/core';

// After
import { blindMessage, hashToCurve } from '@cashu/cashu-ts';
```

If you were relying on a symbol that is not exported by the package entry point in v5, treat it as internal implementation detail and open an issue before depending on it.

---

## `signMintQuote` / `verifyMintQuoteSignature` now use the amended NUT-20 message

These functions now produce and verify the hardened mint-quote signature message introduced by cashubtc/nuts#375. Legacy signing is supported as an internal transitional fallback and is not exported.

For most consumers this is transparent: `Wallet` signs the amended message by default and automatically retries with the legacy message if a legacy mint rejects it (NUT error 20008), so wallet-level minting needs no changes.

### Migration

If you call `signMintQuote`/`verifyMintQuoteSignature` only to mint against a mint, no change is required — current mints verify the amended message and the wallet's fallback covers older ones. If you depended on the **old** byte format directly, it is no longer reachable from the package entry point: rely on the wallet's built-in fallback rather than calling the primitive, or pin v4 if you must emit the legacy bytes yourself.

---

## `checkProofsStates` now requires `id` on every proof

`Wallet.checkProofsStates` previously accepted `Array<Pick<Proof, 'secret'>>` — only `secret` was required. v5 requires both `id` and `secret`: `Array<Pick<Proof, 'secret' | 'id'>>`.

The `id` selects the hash-to-curve variant used to compute the NUT-07 lookup point `Y` — secp256k1 for v0/v1/v2 keysets, BLS12-381 G1 for v3 (`02…`). Without it, v3 proofs silently miscompute `Y` and the state check returns nothing.

### Migration

```ts
// Before
await wallet.checkProofsStates([{ secret: '…' }]);

// After
await wallet.checkProofsStates([{ id: '00bd033559de27d0', secret: '…' }]);
```

If you were already passing full `Proof` objects (the normal case — `wallet.checkProofsStates(proofs)` where `proofs: Proof[]`), no change is required.

---

## `verifyDleqIfPresent` removed; `hasValidDleq` default flipped to spec semantics

`verifyDleqIfPresent` is removed. Its NUT-12 "verify-if-present" semantic is now the default behavior of `hasValidDleq`, which gains an optional `{ require?: boolean }` argument for the stricter opt-in policy.

- **Default** (`require: false`, or omit `opts`): a v0/v1/v2 proof without a DLEQ returns `true` (NUT-12 "MUST verify-if-present"); present DLEQs are verified. v3 (BLS) proofs always pairing-verify regardless.
- **Strict** (`require: true`): a v0/v1/v2 proof without a DLEQ returns `false` (above-spec policy callers can opt into when they want to require DLEQs on every proof).

The proof's `amount` is now validated against the keyset on every path through `hasValidDleq`, not just when a DLEQ is present. A forged-amount proof with no DLEQ now throws `Undefined key for amount …` instead of silently passing.

### Migration

```ts
// Before
import { verifyDleqIfPresent, hasValidDleq } from '@cashu/cashu-ts';

if (!verifyDleqIfPresent(proof, keyset)) throw new Error('bad DLEQ');
if (!hasValidDleq(proof, keyset)) throw new Error('DLEQ missing or invalid');

// After
import { hasValidDleq } from '@cashu/cashu-ts';

if (!hasValidDleq(proof, keyset)) throw new Error('bad DLEQ');
if (!hasValidDleq(proof, keyset, { require: true })) throw new Error('DLEQ missing or invalid');
```

If you were calling `hasValidDleq(proof, keyset)` and relying on the previous strict semantics (missing DLEQ → `false`), add `{ require: true }`. If you were calling `verifyDleqIfPresent`, drop it for `hasValidDleq` with no `opts` — same behavior.

`Wallet.prepareSwapToReceive`'s `requireDleq` option is unchanged: leave it unset (or `false`) for spec-default verify-if-present, pass `true` for the strict policy.

---

## `proofStatesStream` errors now throw

`wallet.on.proofStatesStream` previously treated a WebSocket failure or mint-side RPC error as a graceful end of the iterator — the `for await` loop would exit normally and the consumer was responsible for inferring a problem via timeout. v5 throws the error from the iterator instead, matching the Node `AsyncIterable` convention (`Readable`, async generators, etc.).

Abort handling is unchanged: aborting the supplied `AbortSignal` still ends the stream cleanly without throwing.

### Migration

Wrap the `for await` in a `try/catch` to recover from wallet errors:

```ts
// Before — silent end on error
for await (const update of wallet.on.proofStatesStream(proofs)) {
  // ...
}
// (a websocket failure here exited the loop cleanly; you'd never know)

// After — error throws
try {
  for await (const update of wallet.on.proofStatesStream(proofs, { signal: ac.signal })) {
    // ...
  }
} catch (e) {
  if ((e as Error).name === 'AbortError') return; // abort, not a real error
  // surface the websocket / mint failure however your app prefers
  console.error('Proof state stream failed', e);
}
```

If your consumer was already wrapping the loop in `try/catch` (e.g. to handle abort), no change is required beyond not assuming silent completion means all expected updates arrived.

---

## `deriveSecret` and `deriveBlindingFactor` removed

The single-value NUT-13 derivation helpers `deriveSecret` and `deriveBlindingFactor` are removed. Use `deriveSecretAndBlindingFactor`, which derives both values for a counter in one call (and, for legacy BIP-32 keysets, avoids repeating the shared path derivation).

### Migration

```ts
// Before
import { deriveSecret, deriveBlindingFactor } from '@cashu/cashu-ts';

const secret = deriveSecret(seed, keysetId, counter);
const blindingFactor = deriveBlindingFactor(seed, keysetId, counter);

// After
import { deriveSecretAndBlindingFactor } from '@cashu/cashu-ts';

const { secret, blindingFactor } = deriveSecretAndBlindingFactor(seed, keysetId, counter);
```

If you only need one of the two values, destructure just that field — `const { secret } = deriveSecretAndBlindingFactor(seed, keysetId, counter)`.

---

## `completeMelt` no longer accepts a boolean third argument

`Wallet.completeMelt`'s deprecated boolean `preferAsync` parameter is removed. Pass the option on the `CompleteMeltOptions` object instead.

### Migration

```ts
// Before
await wallet.completeMelt(meltPreview, privkey, true);

// After
await wallet.completeMelt(meltPreview, privkey, { preferAsync: true });
```

Calls that already pass a `CompleteMeltOptions` object (or omit the third argument) need no change.
