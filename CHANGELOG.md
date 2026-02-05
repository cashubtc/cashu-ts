# Changelog

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

This release is in maintenance mode.

It receives critical fixes only, via the [v2-dev branch](https://github.com/cashubtc/cashu-ts/tree/v2-dev).

If upgrading from v1, please review the [migration guide](migration-2.0.0.md) for breaking changes.

## [v1.2.1](https://github.com/cashubtc/cashu-ts/releases/tag/v1.2.1) (2024-10-24)

This release is now obsolete.

If upgrading from v0, please review the [migration guide](migration-1.0.0.md) for breaking changes.

## [v0.9.0](https://github.com/cashubtc/cashu-ts/releases/tag/v0.9.0) (2024-01-18)

This release is now obsolete.
