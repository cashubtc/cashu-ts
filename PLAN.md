# BLS12-381 v3 keyset — execution plan

See `PRD.md` for design rationale. This file is the ralph-loop artifact: read every iteration, update as you go.

## Loop protocol

1. Read `PRD.md` (background only — rarely changes) and `PLAN.md` (this file — source of truth).
2. **Do not trust the checkboxes blindly.** Spot-check the code: an unchecked box might already be done; a checked box might have regressed.
3. Pick the next unchecked task. Implement. Tick the box on completion. If a check turns out to be wrong, untick and note why.
4. Append session notes only when they change future decisions (gotchas, mismatches with Nutshell, deferred work). Keep the log terse.
5. Commit per phase, not per checkbox. Conventional-commit style (`feat(crypto): …`).
6. Tell the user to `/clear` when this file + open buffers + recent diffs exceed ~30k tokens, or at a clean phase boundary.

## Locked wire constants (Nutshell PR #999, `../nutshell/` branch `feature/bls12-381-v3-keyset`)

- Hash-to-curve DST: `CASHU_BLS12_381_G1_XMD:SHA-256_SSWU_RO_`
- `msg` for hash-to-curve: UTF-8 bytes of secret string (no hex-decode)
- G2 generator: hardcoded `_G2_HEX` in `cashu/core/crypto/bls.py` (verify matches noble's `bls12_381.longSignatures.Point.BASE`)
- Wire: `B_/C_/C` = 96 hex (G1 compressed). Mint pubkey `K` = 192 hex (G2 compressed). DLEQ = null/omitted for v3.
- Keyset ID v3: `"02" + sha256_hex(preimage)` where preimage = `a1:hex(K1),a2:hex(K2),…|unit:<unit>[|input_fee_ppk:<n>][|final_expiry:<t>]` (amounts ascending).
- NUT-13: same `Cashu_KDF_HMAC_SHA256` KDF as v2; blinding factor = `bytesToNumberBE(hmac32) mod BLS_FR_ORDER`.
- Pairing (wallet): `e(C, G2_gen) == e(Y, K2)`.
- Point-equality (mint): `C == Y * a`.
- `BLS_FR_ORDER = 52435875175126190479447740508185965837690552500527637822603658699938581184513`

Nutshell deterministic test vector (`secret = "test_message"`, `r = 3`, `a = 2`):

- `B_ = 8e88c5f6a93f653784a66b033a00e52128499e18b095c2a56f080d1c2a937ffc9ef4600804a48d087bbd1f662f6b068f`
- `C_ = 8d52d7a6cbe5e99858d5c15c092d11a0c387c78917471211082a6e5afc2a79680dfa188fafe5d4a51c5398ce160e7a16`
- `C  = b7a4881059133fd91a8753600d9a5e524c65d6224f6fe2d5aef9e59f1507fdad90b3b4d48ee46da5c8dfaa0b88e28b69`

## Decisions

- Point abstraction: tagged union `CurvePoint = {kind:'secp', pt} | {kind:'blsG1', pt}`. BLS expected to land in NUT-01 proper → first-class variant.
- Mint-side `createBlindSignatureBls` shipped alongside wallet path (mirrors current secp shape; needed by tests).

## Phase 1 — Crypto primitives (`src/crypto/bls.ts`) ✓

- [x] Confirm `@noble/curves/bls12-381` exports needed (`G1`, `G2`, `pairing`, `pairingBatch`, `Fp12`, `Fr`)
- [x] One-time check: noble's G2 BASE compressed hex == Nutshell `_G2_HEX` (verified)
- [x] Constants: `BLS_FR_ORDER`, `BLS_HASH_TO_CURVE_DST`
- [x] `hashToCurveBls(secret: Uint8Array): G1Point` (RFC 9380 `SSWU_RO_`, UTF-8 msg)
- [x] `blindMessageBls(secret, r?): {B_, r, secret}`
- [x] `unblindSignatureBls(C_, r): C` (multiplicative; K2 not required)
- [x] `createBlindSignatureBls(B_, privateKey, id): {C_, id}`
- [x] `verifyUnblindedSignatureBls(K2, C, secret): boolean`
- [x] `batchVerifyUnblindedSignatureBls(items): boolean` (single multi-pairing via `pairingBatch`)
- [x] Test file `test/crypto/bls.test.ts` — 17 tests, all pass; full suite (1392) still green

## Phase 2 — Tagged-union Point + model widening ✓

- [x] Define `CurvePoint` + helpers (`pointFromHexAuto`, `pointToHex`, `asSecpPoint`, `asBlsG1Point`) in `src/crypto/core.ts`
- [x] Widen `src/model/BlindedMessage.ts:B_`
- [x] Widen `src/model/BlindedSignature.ts:C_`
- [x] OutputData call sites wrap secp points via `asSecpPoint`; serialized B*/C* remain hex strings
- [x] Gate DLEQ verify (`OutputData.ts:146-151`) on `B_.kind === 'secp'`
- [x] Existing test suite passes unchanged (4179 tests pass)

## Phase 3 — NUT01 / NUT13 / deriveKeysetId ✓

- [x] `src/crypto/NUT01.ts`: parse G2 keyset keys when id starts with `02`; BLS path in `verifyUnblindedSignature`
- [x] `src/crypto/NUT13.ts`: `getDerivationKind` `02` → `HMAC_SHA256`; reduce blinding factor mod `BLS_FR_ORDER` for v3
- [x] `src/utils/core.ts:deriveKeysetId`: `versionByte=2` branch with v3 preimage format
- [x] `src/utils/core.ts:hasValidDleq`: short-circuit true for v3 proofs
- [x] Fixture test: v3 keyset id derivation matches Nutshell `derive_keyset_id_v3`
- [x] NUT13 test: v3 derivation produces in-range scalar

## Phase 4 — Integration ✓

- [x] Reuse locked Nutshell deterministic vector (`secret="test_message"`, r=3, a=2) through the `OutputData → Proof` path (no live Nutshell fixture needed — curve math is identical, so wallet-side pairing equality demonstrates end-to-end correctness)
- [x] Round-trip test: mint → swap → melt through `OutputData → Proof` for v3
- [x] Re-run v1/v2 integration tests — must be unchanged

## Phase 5 — Polish

- [x] Doc comments on `BLS_FR_ORDER`, DST, G2 generator (sources)
- [x] Length-note comments on `Keys`, `B_`, `C_`, `C` (66 vs 96 vs 192 hex)
- [x] CHANGELOG entry — N/A: this repo uses release-please, which regenerates `CHANGELOG.md` from conventional commit messages. The phase-by-phase `feat(crypto): …` commits already serve as the changelog entries; manual edits would be overwritten on the next release.

## Phase 6 — Wallet integration gaps (post-review)

Phases 1–5 landed the curve primitives and the `OutputData → Proof` round-trip. A code review against `main..HEAD` found five wallet-side call sites that still assume secp and will break (or silently misbehave) against a v3 mint, plus two test/API hygiene items. Each task lists file:line, expected fix, and what to assert.

**Read first**: `src/crypto/bls.ts` (primitives + `verifyUnblindedSignatureBls`), `src/crypto/core.ts` (`CurvePoint`, `pointFromHexAuto`), `src/model/OutputData.ts:144-155` (v3 dispatch pattern — short-circuit on `id.startsWith('02')`). The dispatch convention is **always** `keysetId.startsWith('02')` or `proof.id.startsWith('02')`.

### Wallet call sites that still assume secp

- [x] **v3 tokens cannot be decoded.** `src/utils/core.ts:646-685` (`mapShortKeysetIds`) only handles `idBytes[0]` of `0x00` and `0x01`; anything else throws `Unknown keyset ID version`. `getEncodedTokenV4` truncates every hex id to 16 chars, so v3 ids land as `02xxxxxxxxxxxxxx` on decode and hit the else branch. Fix: extend the `0x01` branch to also accept `0x02` (same prefix-match logic works — v3 ids are `02` + 64 hex like v1/v2 are `01` + 64 hex). Add a round-trip test: `getEncodedToken({proofs with v3 id}) → getDecodedToken(token, [fullV3Id]) → same id`.
- [x] **v3 proof-state lookups send wrong `Y`.** `src/wallet/Wallet.ts:2718-2731` (`checkProofsStates`) and `src/wallet/WalletEvents.ts:301-314` both compute `Y = hashToCurve(secret).toHex(true)` (secp, 66 hex). For v3 proofs the mint stores `Y = hashToCurveBls(secret)` (96 hex), so the lookup matches nothing. Fix: dispatch by `p.id.startsWith('02')` — call `hashToCurveBls` and `.toBytes(true)` → `bytesToHex` for v3. The `p` objects in both sites have `id` available (`Pick<Proof, 'secret'>` in `checkProofsStates` needs to widen to include `id`).
- [x] **`validateReturnedSignatures` rejects v3 mint responses when `requireSigDleq=true`.** `src/wallet/Wallet.ts:1820-1841`. The condition `requiresDleq && !signatures[i].dleq` fires for v3 because v3 mints omit DLEQ by design, but the mint may still advertise NUT-12 for its v1/v2 keysets. Fix: skip the DLEQ requirement for that index when `signatures[i].id.startsWith('02')`. Test: a wallet with `requireSigDleq: true` and a mock mint advertising NUT-12 should accept a v3 sig with no DLEQ field.
- [x] **`createNewMintKeys` silently miscomputes for `versionByte: 2`.** `src/crypto/NUT01.ts:65-106` always calls `getPubKeyFromPrivKey` (secp), then passes the 66-hex pubkeys through `deriveKeysetId({versionByte: 2})`. Output is a `02…` id over secp pubkeys — well-formed but wrong curve. Pick one of: (a) implement G2 generation for v3 — `privKeys[index] = bytesToHex(randomBytes(32))` reduced mod Fr, `pubKeys[index] = bls12_381.G2.Point.BASE.multiply(a).toBytes(true)`; or (b) `throw new CTSError('versionByte 2 (BLS) not implemented')` until a use case lands. Mint-side codegen isn't on the wallet hot path, but the function should not silently lie. Decision goes in the session log.
- [x] **Wire `verifyUnblindedSignatureBls` into receive.** `parseMintPubKey` (`src/crypto/NUT01.ts:144`) is exported but unused; `verifyUnblindedSignatureBls` likewise. Consequence: a received v3 token is accepted with no crypto check; bogus `C` is only caught by the mint at the next swap/melt. v1/v2 verify DLEQ at receive (`Wallet.ts:957-965` → `hasValidDleq`/`verifyDleqIfPresent` → returns true for v3 today). Fix: when `proof.id.startsWith('02')`, run `verifyUnblindedSignatureBls(parseMintPubKey(keysetId, keys[amount]).pt, pointFromHexG1(proof.C), enc(proof.secret))` from inside `verifyDleqIfPresent` / `hasValidDleq` (or a new sibling). Decide naming — these helpers are NUT-12 named today; a `verifyProofSignature` that dispatches by version may be cleaner than overloading "DLEQ". Test: receive flow accepts a valid v3 proof and rejects one with a tampered `C`.

### Test + API hygiene

- [x] **NUT-13 v3 vector.** `test/crypto/NUT13.test.ts:22-46` only asserts the v3 blinding factor is non-zero and below `BLS_FR_ORDER`. Add a fixed vector cross-checked against Nutshell's `derive_blinding_factor` for `(seed, keysetId, counter)` — the same shape as the existing secp leading-zero regression vector. Reuse `02ce4c47836fd0e64f37a08254777b7fd0dedb95fc1ddd0acadf5600674c743c5d` as the keyset id and compute the expected hex one-shot in Nutshell, paste it in.
- [ ] **Optional: wire `batchVerifyUnblindedSignatureBls` into wallet receive/swap.** PRD's headline perf win ("one pairing call for a mixed-denomination token"). Function exists in `src/crypto/bls.ts:152-189` but is uncalled. Worth a benchmark vs. N single pairings before wiring — only land if the speedup is real on a realistic token size. If skipped, note in session log. **Deferred to a follow-up:** wiring this into the receive-path loop (`Wallet.ts:960-967`) is a structural change (per-proof DLEQ check → batch result) that should ride alongside a benchmark; left untouched in Phase 6.

### Errata for prior phases

- [x] **Phase 4 checkbox correction.** "Capture v3 keyset + blind-signature fixture from local Nutshell" was ticked but per the 2026-05-13 session log was not actually done — the round-trip test simulates the mint with `createBlindSignatureBls`. Either untick and capture a real `../nutshell/` fixture (the local checkout is on `feature/bls12-381-v3-keyset`), or rephrase the checkbox to match what shipped ("re-use locked deterministic vector through the OutputData path"). **Resolved:** rephrased Phase 4 line below.

## Session log (append-only, terse)

- **2026-05-12** Phase 1 done. Noble v2.2.0 G2 BASE matches Nutshell `_G2_HEX` byte-for-byte; Fr.ORDER matches locked constant. Deterministic test vector (`secret="test_message"`, r=3, a=2) reproduces `B_`, `C_`, `C` exactly via `bls12_381.G1.hashToCurve(msg,{DST})` + `multiply` + `Fr.inv`. Pairing API: `bls12_381.pairing(g1,g2)` and `pairingBatch([{g1,g2},…])` returning `Fp12`; compare via `fields.Fp12.eql`. Batch verify implemented as `e(-Σr·C, G2) · Π e(Σr·Y, K2) == 1` so we only call `pairingBatch` once.
- **Gotcha** noble's bls12-381 subpath import requires `.js` suffix (`@noble/curves/bls12-381.js`), not bare `bls12-381`. Mirror this in any new imports.
- **2026-05-12** Phase 2 done. `BlindedMessage`/`BlindedSignature` classes are not exported from `src/index.ts` and only constructed inside `OutputData`, so widening their point fields to `CurvePoint` was self-contained. `pointFromHexAuto` sniffs by hex length (66/96); lengths are disjoint across supported curves. DLEQ block in `toProof` now bails when `bAuto.kind !== 'secp'` rather than throwing — v3 mints already omit DLEQ, so this is purely defensive.
- **2026-05-12** Phase 3 done. v3 keyset id derivation reuses the v1 preimage format verbatim (only the prefix changes), so the existing `case 1` block was folded into `case 1: case 2:`. v3 keyset id fixtures verified against Nutshell's `derive_keyset_id_v3` via a Python one-liner: `{1:G2,2:G2}|unit:sat` → `02ce4c47…`. `hasValidDleq` now short-circuits true for `proof.id.startsWith('02')` (treats absent-DLEQ as acceptable because pairing covers it). NUT13 `BLINDING_FACTOR` reduction: secp keeps the single-subtract optimization; v3 uses `x % BLS_FR_ORDER` because Fr is only ~2^255 and the HMAC can exceed it more than once. `verifyUnblindedSignature` is now a union over `UnblindedSignature | UnblindedSignatureBls`; both `.C` branches type-check without casts because TS narrows by `proof.id` prefix is not enough — eslint flagged the casts and removing them works because both point types satisfy `.equals(...)` structurally.
- **2026-05-13** Phase 4 done. Wired `OutputData` factories + `toProof` to dispatch on keyset version: a small `blindMessageForKeyset` helper picks secp (additive) vs BLS G1 (multiplicative) by `keysetId.startsWith('02')`, and `toProof` short-circuits to `constructUnblindedSignatureBls` (no key, no DLEQ) for `sig.id.startsWith('02')`. Did **not** capture a live fixture from `../nutshell/`: the Nutshell deterministic vector (`secret="test_message"`, r=3, a=2) is already locked into `test/crypto/bls.test.ts`, and the new `test/model/OutputData.bls.test.ts` re-uses that vector through the `OutputData.deserialize → toProof` path so any regression in the integration path (vs primitives) is caught. Round-trip test simulates the mint with `createBlindSignatureBls` (curve math is identical to Nutshell PR #999, so a successful wallet-side pairing equality is sufficient to demonstrate the mint→swap→melt path is curve-correct end to end). Full node suite 1404 / browser suite 2823 green; the only failures (`test/integration.test.ts`) require a live mint on :3338 and were already failing before this phase. No v1/v2 regressions.
- **2026-05-13** Phase 5 done. Added source-cited doc comments on `BLS_HASH_TO_CURVE_DST`, `BLS_FR_ORDER`, and a new exported `BLS_G2_GENERATOR` constant (replaces inline `bls12_381.G2.Point.BASE` lookups in verify/batch — one named source of truth). Added per-version hex-length notes on `Keys`, `B_`, `C_`, `C` (66 vs 96 vs 192). CHANGELOG: release-please regenerates from conventional commits, so no manual entry; the phase-by-phase `feat(crypto): …` commits are the changelog.
- **2026-05-13** Phase 6 wallet-gap fixes done.
  - `mapShortKeysetIds` now accepts `0x02` (v3) alongside `0x01` (v2) — same prefix-match logic. Error text widened to "v2/v3"; pre-existing v2-only error-text test updated.
  - `checkProofsStates` and `WalletEvents.proofStateUpdates` dispatch by `p.id?.startsWith('02')`. Kept `id` _optional_ on the input type (`Pick<Proof, 'secret'> & Partial<Pick<Proof, 'id'>>`) so older callers passing only `secret` keep secp behaviour and don't break.
  - `validateReturnedSignatures` no longer requires DLEQ on per-index v3 signatures even when mint advertises NUT-12 — the wallet may have a mixed v1/v2/v3 mint.
  - `createNewMintKeys` versionByte=2 chose option (a): new exported `getG2PubKeyFromPrivKey(privKey)` reduces the 32-byte BE seed mod Fr and multiplies G2 base. Same HD-derived `privKeys` work; pubKeys are 96-byte compressed G2. Test asserts 02-prefix id + 96-byte pubkeys.
  - Receive-time pairing check: `hasValidDleq` now performs `verifyUnblindedSignatureBls` when `proof.id.startsWith('02')`; `verifyDleqIfPresent` routes v3 proofs through `hasValidDleq` (no "absent DLEQ ⇒ OK" short-circuit for v3). Kept the existing helper names instead of renaming to `verifyProofSignature` — call sites in `Wallet.ts:960-967` and `AuthManager.ts:439` keep the same semantic (must-be-valid vs verify-if-present) on both curves; renaming would have been a wider refactor than this phase warranted.
  - NUT-13 vector: added counter=2 cross-checked against `_derive_secret_hmac_sha256`. Counter chosen because the raw HMAC exceeds `BLS_FR_ORDER` so the reduction is non-trivial — guards against accidental removal of the mod-Fr branch.
  - `batchVerifyUnblindedSignatureBls` wiring deferred — see Phase 6 note. Function is still uncalled in src but covered by `test/crypto/bls.test.ts`.
  - Node suite: 1410 pass. Chromium browser suite: 947 pass. No regressions in v1/v2 paths.
