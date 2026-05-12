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

## Phase 2 — Tagged-union Point + model widening

- [ ] Define `CurvePoint` + helpers (`pointFromHexAuto`, `pointToHex`) in `src/crypto/core.ts`
- [ ] Widen `src/model/BlindedMessage.ts:B_`
- [ ] Widen `src/model/BlindedSignature.ts:C_`
- [ ] Widen `src/model/OutputData.ts:C` and call sites
- [ ] Gate DLEQ verify (`OutputData.ts:146-151`) on `B_.kind === 'secp'`
- [ ] Existing test suite passes unchanged

## Phase 3 — NUT01 / NUT13 / deriveKeysetId

- [ ] `src/crypto/NUT01.ts`: parse G2 keyset keys when id starts with `02`; BLS path in `verifyUnblindedSignature`
- [ ] `src/crypto/NUT13.ts`: `getDerivationKind` `02` → `HMAC_SHA256`; reduce blinding factor mod `BLS_FR_ORDER` for v3
- [ ] `src/utils/core.ts:deriveKeysetId`: `versionByte=2` branch with v3 preimage format
- [ ] `src/utils/core.ts:hasValidDleq`: short-circuit true for v3 proofs
- [ ] Fixture test: v3 keyset id derivation matches Nutshell `derive_keyset_id_v3`
- [ ] NUT13 test: v3 derivation produces in-range scalar

## Phase 4 — Integration

- [ ] Capture v3 keyset + blind-signature fixture from local Nutshell
- [ ] Round-trip test: mint → swap → melt through `OutputData → Proof` for v3
- [ ] Re-run v1/v2 integration tests — must be unchanged

## Phase 5 — Polish

- [ ] Doc comments on `BLS_FR_ORDER`, DST, G2 generator (sources)
- [ ] Length-note comments on `Keys`, `B_`, `C_`, `C` (66 vs 96 vs 192 hex)
- [ ] CHANGELOG entry

## Session log (append-only, terse)

- **2026-05-12** Phase 1 done. Noble v2.2.0 G2 BASE matches Nutshell `_G2_HEX` byte-for-byte; Fr.ORDER matches locked constant. Deterministic test vector (`secret="test_message"`, r=3, a=2) reproduces `B_`, `C_`, `C` exactly via `bls12_381.G1.hashToCurve(msg,{DST})` + `multiply` + `Fr.inv`. Pairing API: `bls12_381.pairing(g1,g2)` and `pairingBatch([{g1,g2},…])` returning `Fp12`; compare via `fields.Fp12.eql`. Batch verify implemented as `e(-Σr·C, G2) · Π e(Σr·Y, K2) == 1` so we only call `pairingBatch` once.
- **Gotcha** noble's bls12-381 subpath import requires `.js` suffix (`@noble/curves/bls12-381.js`), not bare `bls12-381`. Mirror this in any new imports.
