# Changelog

## [4.0.0](https://github.com/cashubtc/cashu-ts/compare/v3.6.1...v4.0.0) (2026-04-04)


### ⚠ BREAKING CHANGES

* **utils:** restrict internal functions from public API surface ([#570](https://github.com/cashubtc/cashu-ts/issues/570))
* remove handleTokens from public API ([#569](https://github.com/cashubtc/cashu-ts/issues/569))
* **p2pk:** add normalizeP2PKOptions ([#564](https://github.com/cashubtc/cashu-ts/issues/564))
* remove v3 token encoding; accept raw proofs in receive flows ([#558](https://github.com/cashubtc/cashu-ts/issues/558))
* generic mint/melt methods for custom payment types ([#544](https://github.com/cashubtc/cashu-ts/issues/544))
* multi-unit KeyChain, cache API cleanup, deprecation removal ([#540](https://github.com/cashubtc/cashu-ts/issues/540))
* Add bigint support to CBOR for creqA payment requests ([#538](https://github.com/cashubtc/cashu-ts/issues/538))
* Proof.amount → bigint, strip crypto primitives, consolidate melt ([#537](https://github.com/cashubtc/cashu-ts/issues/537))
* tighten mint/melt API; remove MeltBlanks and prefer_async ([#534](https://github.com/cashubtc/cashu-ts/issues/534))
* migrate amount-bearing APIs to use Amount VO ([#533](https://github.com/cashubtc/cashu-ts/issues/533))
* remove support for CJS build ([#524](https://github.com/cashubtc/cashu-ts/issues/524))

### Features

* Add bigint support to CBOR for creqA payment requests ([#538](https://github.com/cashubtc/cashu-ts/issues/538)) ([7a54a91](https://github.com/cashubtc/cashu-ts/commit/7a54a91cf550d34b3a005a86db948d0235a4b08e))
* allow consumers to override anti-fingerprinting headers ([#580](https://github.com/cashubtc/cashu-ts/issues/580)) ([31268a1](https://github.com/cashubtc/cashu-ts/commit/31268a15e60bb81bfd64ab3a5ff68812ab5d3302))
* bigint roundtrip for v3/v4 tokens, wire in the enhanced CBOR ([#539](https://github.com/cashubtc/cashu-ts/issues/539)) ([88bffc0](https://github.com/cashubtc/cashu-ts/commit/88bffc01a3d929cef9e86c0bc72532a6c64ddc40))
* extend Amount utils, update migration docs ([#584](https://github.com/cashubtc/cashu-ts/issues/584)) ([4d4529c](https://github.com/cashubtc/cashu-ts/commit/4d4529c2a6e75b3a005891453d3fe13fa8f2fdd2))
* generic mint/melt methods for custom payment types ([#544](https://github.com/cashubtc/cashu-ts/issues/544)) ([6c9121b](https://github.com/cashubtc/cashu-ts/commit/6c9121b3c77803618d3b15a2ab51ff58c91c7bb2))
* migrate amount-bearing APIs to use Amount VO ([#533](https://github.com/cashubtc/cashu-ts/issues/533)) ([ae5d41d](https://github.com/cashubtc/cashu-ts/commit/ae5d41d00ccd309c3fa29a23230354ca8c789c30))
* multi-unit KeyChain, cache API cleanup, deprecation removal ([#540](https://github.com/cashubtc/cashu-ts/issues/540)) ([2ac031d](https://github.com/cashubtc/cashu-ts/commit/2ac031d449321bb79915e639b4806de3a7399c6a))
* Proof.amount → bigint, strip crypto primitives, consolidate melt ([#537](https://github.com/cashubtc/cashu-ts/issues/537)) ([c426323](https://github.com/cashubtc/cashu-ts/commit/c42632321bc9f3e252ba568908f45d9475574370))
* remove v3 token encoding; accept raw proofs in receive flows ([#558](https://github.com/cashubtc/cashu-ts/issues/558)) ([abd1efc](https://github.com/cashubtc/cashu-ts/commit/abd1efc9d62024925238df3f86830487080d0681))
* tighten mint/melt API; remove MeltBlanks and prefer_async ([#534](https://github.com/cashubtc/cashu-ts/issues/534)) ([8ef99c9](https://github.com/cashubtc/cashu-ts/commit/8ef99c90fff8337ff063a9c02218e51997e5c348))
* **utils:** add serializeProofs/deserializeProofs, make getEncodedTokenV4 internal ([2c92842](https://github.com/cashubtc/cashu-ts/commit/2c92842a96e30d6bd850c60d71f3062d015668cf))


### Bug Fixes

* harden fetch RequestInit against client fingerprinting ([#545](https://github.com/cashubtc/cashu-ts/issues/545)) ([2af85d1](https://github.com/cashubtc/cashu-ts/commit/2af85d10fd34c82c84fb7219e7244c723519db0f))
* normalize and dedup p2pk pubkeys / refund keys at edges (was just in P2PKBuilder) ([#546](https://github.com/cashubtc/cashu-ts/issues/546)) ([99964a7](https://github.com/cashubtc/cashu-ts/commit/99964a742f875ac4b04e81764af6edc09ce400d6))
* **p2pk:** add sigflag validation ([#563](https://github.com/cashubtc/cashu-ts/issues/563)) ([b8ad4a9](https://github.com/cashubtc/cashu-ts/commit/b8ad4a9897df7959ff33aa652c728a34c7ddc435))
* prevent getEncodedToken from mutating input token proofs ([#536](https://github.com/cashubtc/cashu-ts/issues/536)) ([dc90078](https://github.com/cashubtc/cashu-ts/commit/dc9007829e6f0fc31dcb0c39d0bb212f512aa5e1)), closes [#535](https://github.com/cashubtc/cashu-ts/issues/535)
* reject zero blinding factor in NUT-13 derivation and blindMessage ([#572](https://github.com/cashubtc/cashu-ts/issues/572)) ([8ad5064](https://github.com/cashubtc/cashu-ts/commit/8ad5064ce91e39140bf4d400081a5da82e84a1d5))
* remove Pragma and Cache-Control headers. These are not supported in CDK cors preflight ([#566](https://github.com/cashubtc/cashu-ts/issues/566)) ([f431bbf](https://github.com/cashubtc/cashu-ts/commit/f431bbfaddb2e7f545128377842e41ab03f152f1))
* switch to GH releases for renovate ([#585](https://github.com/cashubtc/cashu-ts/issues/585)) ([1749279](https://github.com/cashubtc/cashu-ts/commit/174927906825f66d9f465307810a5181e2bdca4e))
* update release-please-action to v4.4.0 for Node.js 24 support ([#583](https://github.com/cashubtc/cashu-ts/issues/583)) ([f45d657](https://github.com/cashubtc/cashu-ts/commit/f45d657037d79126c80a0c377268480cc197bad3))
* use constant time byte check for verifyDLEQProof ([#574](https://github.com/cashubtc/cashu-ts/issues/574)) ([494c969](https://github.com/cashubtc/cashu-ts/commit/494c969a121a2d220ad1b2be351eb397a6a0abc0))
* verify DLEQ proofs and amounts on mint BlindSignature responses (NUT-12) ([#567](https://github.com/cashubtc/cashu-ts/issues/567)) ([0cc9da9](https://github.com/cashubtc/cashu-ts/commit/0cc9da9dce63ad02b9f71e1647d1e9ab081e9707))
* **wallet:** remove witness from plain secret (not nut-10) proofs in normalization ([#579](https://github.com/cashubtc/cashu-ts/issues/579)) ([7d61d7e](https://github.com/cashubtc/cashu-ts/commit/7d61d7e33f8d3355063c86c272cea22fafa667be))


### Miscellaneous Chores

* remove support for CJS build ([#524](https://github.com/cashubtc/cashu-ts/issues/524)) ([b0e417e](https://github.com/cashubtc/cashu-ts/commit/b0e417edbd9cf0e8d358ed2c67525b37d78cdc7c))
* **utils:** restrict internal functions from public API surface ([#570](https://github.com/cashubtc/cashu-ts/issues/570)) ([dff7005](https://github.com/cashubtc/cashu-ts/commit/dff7005b2eb83f0124f4fe1ce02fdc73388fb2ef))


### Code Refactoring

* **p2pk:** add normalizeP2PKOptions ([#564](https://github.com/cashubtc/cashu-ts/issues/564)) ([04c4d92](https://github.com/cashubtc/cashu-ts/commit/04c4d925ee55e0468c508a4329c5614be42b7918))
* remove handleTokens from public API ([#569](https://github.com/cashubtc/cashu-ts/issues/569)) ([19e0830](https://github.com/cashubtc/cashu-ts/commit/19e08309578631ba9e1a307e90a55ca59da003b1))

## [3.6.1](https://github.com/cashubtc/cashu-ts/compare/v3.6.0...v3.6.1) (2026-03-17)


### Bug Fixes

* **auth:** use ensureCAT if available so token is refreshed ([#529](https://github.com/cashubtc/cashu-ts/issues/529)) ([7ba4bbc](https://github.com/cashubtc/cashu-ts/commit/7ba4bbc61a133e61c907408619b17f4903aa04a8))

## [3.6.0](https://github.com/cashubtc/cashu-ts/compare/v3.5.0...v3.6.0) (2026-03-13)


### Features

* **amount:** add Amount value object (bigint support), AmountLike input and refactor internals ([#514](https://github.com/cashubtc/cashu-ts/issues/514)) ([cb5fd22](https://github.com/cashubtc/cashu-ts/commit/cb5fd22d7781ae44ff7a4d627bd44d47202e8f49))
* **core:** add utility functions schnorrSignDigest, computeMessageDigest ([#515](https://github.com/cashubtc/cashu-ts/issues/515)) ([1b201c8](https://github.com/cashubtc/cashu-ts/commit/1b201c8a996215af3259a9567ef3eb098e50fc7c))
* experimental Sig_all signing package ([#485](https://github.com/cashubtc/cashu-ts/issues/485)) ([d8f33f0](https://github.com/cashubtc/cashu-ts/commit/d8f33f0d6e149b4457015d092d5fd0599aa36273))
* **jsonint:** add bigint-safe JSON parsing and mint normalization ([#519](https://github.com/cashubtc/cashu-ts/issues/519)) ([f40fcaf](https://github.com/cashubtc/cashu-ts/commit/f40fcaf09509a35ea3be5961130bb92440ff7a7a))
* **wallet:** add two step minting: prepareMint and completeMint ([#523](https://github.com/cashubtc/cashu-ts/issues/523)) ([39f5568](https://github.com/cashubtc/cashu-ts/commit/39f5568b577a492c375ee09b71b4a8fbc24e12ad))


### Bug Fixes

* **mint:** preserve normalized melt fields ([f40fcaf](https://github.com/cashubtc/cashu-ts/commit/f40fcaf09509a35ea3be5961130bb92440ff7a7a))

## [3.5.0](https://github.com/cashubtc/cashu-ts/compare/v3.4.1...v3.5.0) (2026-02-18)


### Features

* **melt:** replace Prefer header with prefer_async POST request ([#500](https://github.com/cashubtc/cashu-ts/issues/500)) ([efe2550](https://github.com/cashubtc/cashu-ts/commit/efe2550c63136f5d1b51a9d5458ea5cdcd851f5a))
* **p2bk:** update to latest spec - removes Keysetid and NUT-18 flag ([fa26bc5](https://github.com/cashubtc/cashu-ts/commit/fa26bc573bd7348831df64e590ff470d0cfede2c))


### Bug Fixes

* remove unbounded per request cache ([#484](https://github.com/cashubtc/cashu-ts/issues/484)) ([b1d32ab](https://github.com/cashubtc/cashu-ts/commit/b1d32ab8de5b4a0468057a8126ad00ec139c3c48))

## [3.4.1](https://github.com/cashubtc/cashu-ts/compare/v3.4.0...v3.4.1) (2026-02-05)


### Bug Fixes

* restore from inactive keyset ([#486](https://github.com/cashubtc/cashu-ts/issues/486)) ([dd3ee5b](https://github.com/cashubtc/cashu-ts/commit/dd3ee5b0613b3f45d7b9378c1471f14c64090f7d))

## [3.4.0](https://github.com/cashubtc/cashu-ts/compare/v3.3.0...v3.4.0) (2026-02-05)

New style changelog begins, containing features/fixes.

### Features

- add new glob prefix wildcard match for nut-21/22 ([77c544a](https://github.com/cashubtc/cashu-ts/commit/77c544a411b166612fd4797f07836141404607e9))
- **ci:** add release automation and husky ([6bf4492](https://github.com/cashubtc/cashu-ts/commit/6bf44923188defbef2b3a7b98f68fb16d940a6f6))

### Bug Fixes

- **ci:** add missing permission ([05182da](https://github.com/cashubtc/cashu-ts/commit/05182da1807cedea3eab69773eb6f132c5813fe4))
	ts/commit/950ae5495273cea30578a84d67934a42eb140f0d))
- standalone asset build in CI ([2cc1138](https://github.com/cashubtc/cashu-ts/commit/2cc1138bc195edd4566e69c5ef84dc06ef7948ec))

## [v3.0.0](https://github.com/cashubtc/cashu-ts/releases/tag/v3.0.0) (2025-10-24)

### Features

- Transaction builder (WalletOps)
- Deterministic counters (WalletCounters / CounterSource)
- Wallet Event Subscriptions (WalletEvents)
- Clear and Blind Authentication (AuthManager / AuthProvider / OIDCAuth)
- Wallet Keychain with backup (KeyChain)
- Wallet load from cache
- P2PK Settings Builder (P2PKBuilder)
- RGLI Proof Selection (SelectProofs)
- Preview Send/Receive/Melt Transactions
- Bech32 format Payment Requests
- Pay to Blinded Key (P2BK)
- SIG_ALL and HTLC support
- Integrated Crypto Library (replaces @cashu/crypto)
- Easier proof management (groupProofsByState)
- Better output handline (OutputType / OutputConfig)

If upgrading from v2, please review the [migration guide](migration-3.0.0.md) for breaking changes.

## [v2.8.1](https://github.com/cashubtc/cashu-ts/releases/tag/v2.8.1) (2025-11-17)

This release is now obsolete.

If upgrading from v1, please review the [migration guide](migration-2.0.0.md) for breaking changes.

## [v1.2.1](https://github.com/cashubtc/cashu-ts/releases/tag/v1.2.1) (2024-10-24)

This release is now obsolete.

If upgrading from v0, please review the [migration guide](migration-1.0.0.md) for breaking changes.

## [v0.9.0](https://github.com/cashubtc/cashu-ts/releases/tag/v0.9.0) (2024-01-18)

This release is now obsolete.
