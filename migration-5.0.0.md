# Version 5.0.0 Migration guide

⚠️ Upgrading to version 5.0.0 will come with breaking changes! Please follow the migration guide for a smooth transition to the new version.

---

## What's new: BLS12-381 v3 keysets

v5 introduces support for **v3 keysets**, identified by a `02` prefix on the keyset id. v3 keysets use BLS12-381 instead of secp256k1 for the BDHKE blinding curve, with multiplicative blinding and pairing-based verification replacing DLEQ. Wire-compatible with Nutshell PR #999.

Existing v0 (legacy base64), v1 (`00…`), and v2 (`01…`) keysets continue to work unchanged. The breaking change below was prompted by adding v3 support but is independent of which curve you target.

---

## Legacy (base64-id) keysets are deprecated, removal planned for v6

Base64 keyset ids were removed from the Cashu spec in December 2023 and have never been supported by CDK-based mints and wallets. v5 keeps support for spending and restoring proofs on legacy keysets (see the output policy below), but this is the last major that will: **v6 removes legacy keyset support entirely**.

The wallet now logs a warning at `loadMint()` when a mint lists legacy keysets. If your users may hold pre-2024 proofs (or seeds) from a nutshell mint, sweep them during the v5 cycle: restore and swap so the balance moves onto a hex-id keyset. Note that nutshell mints migrating to CDK drop their legacy keysets in the process, after which such proofs are unredeemable at the mint regardless of wallet library.

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

## `batchRestore` takes an options object and filters spent proofs

`Wallet.batchRestore(gapLimit?, batchSize?, counter?, keysetId?)` is now `batchRestore(config?: BatchRestoreConfig)`. Behavior changes ride along:

- Batches are fetched through a bounded request pool (4 in flight), cutting restore wall-clock to roughly a quarter; the request count is nearly unchanged.
- `batchSize` defaults to 500 (was 300), matching the request size `checkProofsStates` already uses against reference mint caps.
- Spent proofs are dropped by default via a NUT-07 state check before returning; pending proofs are kept. Pass `filterSpent: false` for the old raw output. `lastCounterWithSignature` always reflects all found signatures, so counter advancement is unaffected by filtering.
- `gapLimit` is now a floor rather than an exact ceiling: batches already in flight when the gap closes are still processed, so proofs sitting shortly past the gap limit may still be recovered.
- New `maxCounter` option: an inclusive scan ceiling, nothing above it is probed. Combine with `gapLimit: Infinity` to fetch a known counter range wall to wall.

### Migration

```ts
// Before
const { proofs } = await wallet.batchRestore(300, 100, 0, keysetId);
// ...followed by a manual checkProofsStates to drop spent proofs

// After (spent filtering is built in)
const { proofs } = await wallet.batchRestore({
  gapLimit: 300,
  batchSize: 100,
  counter: 0,
  keysetId,
});

// Bare calls need no change
await wallet.batchRestore();
```

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

---

## `P2PKOptions` is now a `kind` + `data` spending condition

`P2PKOptions` drops `pubkey: string | string[]` and `hashlock?`. It is now the NUT-10 envelope (`kind` + `data`) plus the shared NUT-11 `LockConditions` tags:

```ts
type P2PKOptions = SpendingConditionsBase & LockConditions & { kind: 'P2PK' | 'HTLC' };
```

`data` is the lock pubkey (`'P2PK'`) or the hashlock (`'HTLC'`); extra signers move from the old `pubkey` array to the `pubkeys` tag. This affects every place a lock is built: `asP2PK()`, `OutputData.createP2PKData()`, and `{ type: 'p2pk', options }` output configs. `P2PKBuilder` (`addLockPubkey`/`addHashlock`) is unchanged.

### Migration

```ts
// Before
asP2PK({ pubkey: pk });
asP2PK({ pubkey: [a, b], requiredSignatures: 2 });
asP2PK({ hashlock: h });
asP2PK({ hashlock: h, pubkey: [a] });

// After
asP2PK({ kind: 'P2PK', data: pk });
asP2PK({ kind: 'P2PK', data: a, pubkeys: [b], requiredSignatures: 2 });
asP2PK({ kind: 'HTLC', data: h });
asP2PK({ kind: 'HTLC', data: h, pubkeys: [a] });
```

`PaymentRequest.toP2PKOptions()` already returns the new shape, so pass its result straight to `asP2PK()`.

---

## P2PK lock pubkeys must be 33-byte compressed and on-curve

Authoring a lock (`P2PKBuilder.addLockPubkey`/`addRefundPubkey`, or raw `P2PKOptions` passed to `asP2PK()` and friends) now requires 33-byte compressed hex keys (66 chars, `02`/`03` prefix) that decompress to a valid secp256k1 point, per NUT-11. v4 accepted 32-byte x-only input and silently prefixed `02`; because a SHA-256 hashlock is also 64-hex, that leniency could turn a misplaced hashlock (or corrupt key) into a lock nobody can spend. With the strict rule, 64-hex input is only ever a hashlock and pubkey mistakes fail fast.

The rule applies everywhere a P2PK pubkey is read, including parsing foreign input: `PaymentRequest.toP2PKOptions()` and proof verification (`verifyP2PKSpendingConditions` and friends) throw on a non-compliant key instead of repairing it. Paying a request creates new outputs under its lock, so a lifted key risks burning the payer's funds; and a proof already locked with such a key is rejected by spec-conformant mints anyway (CDK refuses the swap), so failing at parse names the broken proof rather than submitting a doomed spend. If you know such a key is a genuine x-only pubkey, prepend `'02'` and build the `P2PKOptions` yourself.

### Migration

```ts
// Before (x-only, eg a Nostr key)
new P2PKBuilder().addLockPubkey(nostrPubkeyHex);

// After: prepend the even-y prefix (the same rule NIP-61 nutzaps use)
new P2PKBuilder().addLockPubkey('02' + nostrPubkeyHex);
```

---

## Mint quote responses now carry NUT-04 accounting fields

`MintQuoteBaseResponse` (and every method-specific mint quote response) gains five required fields:

- `amount_paid: Amount` — total paid to the mint for this quote
- `amount_issued: Amount` — total ecash issued for this quote
- `updated_at: number | null` — Unix timestamp of the last quote update (`null` when the mint does not report it)
- `expiry: number | null` — moved here from the method-specific response types
- `method: string` — the payment method, populated from the request endpoint when the mint omits it; a reported method that disagrees with the endpoint throws `Invalid response from mint`

The difference `amount_paid − amount_issued` is the amount available to mint. The single-use `state` field is deprecated in NUT-04 in favour of the accounting fields, but cashu-ts always populates it on `MintQuoteBolt11Response` (derived from the accounting fields when the mint omits it).

Quotes returned by `Wallet`/`Mint` methods need no change: normalization fills the fields in, deriving them from the legacy `state` and `amount` for mints that predate quote accounting.

### Migration

Code that constructs mint quote objects (test fixtures, hydrating stored quotes) must supply the new fields:

```ts
// Before
const quote: MintQuoteBolt11Response = {
  quote: 'q1',
  request: 'lnbc…',
  unit: 'sat',
  amount: Amount.from(21),
  state: 'UNPAID',
  expiry: null,
};

// After
const quote: MintQuoteBolt11Response = {
  quote: 'q1',
  request: 'lnbc…',
  unit: 'sat',
  amount: Amount.from(21),
  state: 'UNPAID',
  expiry: null,
  method: 'bolt11',
  amount_paid: Amount.from(0),
  amount_issued: Amount.from(0),
  updated_at: null,
};
```

Generic mint quote responses (custom payment methods) are now base-validated like melt quotes always were: a response missing `quote`, `request` or `unit`, or whose accounting fields are absent and underivable, throws `Invalid response from mint` instead of passing through silently.

---

## Melt quote responses require `request` and carry `method`

`request` (the method-specific payment routing instructions) moved from the bolt11/onchain response types into `MeltQuoteBaseResponse`, and the base type gains an optional `fee_reserve`. Melt quote responses from any method — including custom ones — that lack a `request` string now throw `Invalid response from mint`.

`MeltQuoteBaseResponse` also gains a required `method: string` with the same semantics as on mint quotes: populated from the request endpoint when the mint omits it, throwing on a mismatch.

bolt11, bolt12 and onchain flows are unaffected: those responses already required `request`. Code constructing a plain `MeltQuoteBaseResponse` must include `request` and `method`.

---

## Mintable amount is enforced for every payment method

`prepareMint`/`mintProofs` previously rejected requests above `amount_paid − amount_issued` only for bolt12 and onchain quotes. v5 applies the check to any quote object that carries accounting fields, regardless of method.

Two escape hatches keep stored-quote flows working:

- Quote objects without accounting fields (e.g. minimal `{ quote: '…' }` references) skip the check, as before.
- Quotes reporting `0/0` defer to the mint — a zero snapshot may simply have been fetched before the payment was made, so the create → pay externally → mint flow is unaffected.

The practical change from v4: attempting to re-mint a quote object whose snapshot shows it fully issued (`amount_paid === amount_issued > 0`) now fails fast client-side instead of round-tripping to the mint for a rejection.

---

## `PaymentRequest.singleUse` is now optional (tri-state)

`PaymentRequest.singleUse` is now `boolean | undefined` (was a required `boolean` defaulting to `false`), so the flag can round-trip the absent/`false`/`true` distinction instead of always serializing `single_use=0`. Setting `false` or `true` is unchanged; only decoding shifts — a request that omits the flag now yields `singleUse: undefined` instead of `false`. Replace any `pr.singleUse === false` check with `!pr.singleUse` (true for both absent and explicit `false`).

---

## `PaymentRequest` constructor takes an options object

The v4 constructor was positional (`new PaymentRequest(transport, id, amount, unit, mints, description, singleUse, nut10)`); it now takes a single `PaymentRequestOptions` object whose keys mirror the class properties, so only the fields you set need naming:

```ts
// v4 — unused optional slots need explicit fillers
new PaymentRequest(
  undefined, // transport
  'inv-123',
  100,
  'sat',
  ['https://my.mint'],
  undefined, // description
  true, // singleUse
);

// v5 — name only the fields you set
new PaymentRequest({
  id: 'inv-123',
  amount: 100,
  unit: 'sat',
  mints: ['https://my.mint'],
  singleUse: true,
});
```

Decoding (`decodePaymentRequest`, `PaymentRequest.fromEncodedRequest`, `fromRawRequest`) is unaffected. A positional call fails to type-check.
