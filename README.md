# Cashu TS

![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/cashubtc/cashu-ts/node.js.yml)
![GitHub issues](https://img.shields.io/github/issues/cashubtc/cashu-ts)
![GitHub package.json version](https://img.shields.io/github/package-json/v/cashubtc/cashu-ts)
![npm](https://img.shields.io/npm/v/@cashu/cashu-ts)
![npm type definitions](https://img.shields.io/npm/types/@cashu/cashu-ts)
![npm bundle size](https://img.shields.io/bundlephobia/min/@cashu/cashu-ts)
[code coverage](https://cashubtc.github.io/cashu-ts/coverage)

⚠️ **Don't be reckless:** This project is in early development, it does however work with real sats! Always use amounts you don't mind losing.

Cashu TS is a JavaScript library for [Cashu](https://github.com/cashubtc) wallets written in TypeScript.

### Install

```shell
npm i @cashu/cashu-ts
```

### Quick Start (Create a wallet)

There are a number of ways to instantiate a wallet, depending on your needs.

Wallet classes are mostly stateless, so you can instantiate and throw them away as needed. Your app must therefore manage state, such as fetching and storing proofs in a database.

NB: You must always call `loadMint()` or `loadMintFromCache` after instantiating a wallet.

```typescript
import { Wallet } from '@cashu/cashu-ts';

// Simplest: With a mint URL
const mintUrl = 'http://localhost:3338';
const wallet1 = new Wallet(mintUrl); // unit is 'sat'
await wallet1.loadMint(); // wallet is now ready to use

// Persist these in your app
const keychainCache = wallet1.keyChain.cache; // KeyChainCache
const mintInfoCache = wallet1.getMintInfo().cache; // GetInfoResponse

// Advanced: With cached mint data (avoids network calls on startup)
const wallet2 = new Wallet(keychainCache.mintUrl, { unit: keychainCache.unit });
wallet2.loadMintFromCache(mintInfoCache, keychainCache);
// wallet2 is now ready to use
```

## Specs and Features:

### [NUTs](https://github.com/cashubtc/nuts/):

This project implements the **7 Mandatory** [NUTs](https://github.com/cashubtc/nuts/) and **15 key** optional NUTs.
View the full roadmap of planned NUTs in our [Roadmap](./docs-src/ROADMAP.md)

### Token Foramts
We currently support **V3 (CashuA)** and **V4 (CashuB)** token formats.

### Key Wallet Features:
|  |  |  |
| :--- | :--- | :--- |
|  connect to mint | [request minting tokens](./docs-src/usage/mint_token.md) | [check spent tokens](./docs-src/usage/get_token.md) |
|  [minting](./docs-src/wallet_ops/melt.md) | [sending](./docs-src/wallet_ops/send.md) / [receiving](./docs-src/wallet_ops/receive.md) | [melting](./docs-src/wallet_ops/melt.md) |
|  AuthManager | AuthProvider | bolt11 / [bolt12](./docs-src/usage/bolt12.md) |
|  [transaction builder](./docs-src/wallet_ops/wallet_ops.md) | [wallet subscriptions](./docs-src/wallet_events/wallet_events.md) | [deterministic counters](./docs-src/deterministic_counters.md) |
|  ... and more | | [View Full List](#detailed-specs) |

## Usage

We provide comprehensive examples categorized by use case:
- **[Basic Guide](./docs-src/usage/usage_index.md)**: Getting Started, and basic token operations.
- **[WalletOps](./docs-src/wallet_ops/wallet_ops.md)**: Translation Builder Usage Recipes.
- **[WalletEvents](./docs-src/wallet_events/wallet_events.md)**: Event Subscriptions
- **[Deterministic Counters](./docs-src/deterministic_counters.md)**: Deterministic counters (persist, inspect, bump).

Go to the [docs](https://cashubtc.github.io/cashu-ts/docs/main) for detailed usage, or have a look at the [integration tests](./test/integration.test.ts) for examples on how to implement a wallet.

### Browser usage (standalone build)

Cashu TS provides a standalone browser build (IIFE) intended for demos and
non-bundler usage. The standalone bundle is published as part of GitHub Releases rather than the npm
package.

### Note: Builder hooks vs Global events

`WalletOps` builders include per-operation hooks (onCountersReserved) that fire during a single transaction build.

`WalletEvents` provides global subscriptions `(wallet.on.*)` that can outlive a single builder call.

Use the builder hooks for transaction-local callbacks, and WalletEvents for app-wide subscriptions.

---

## Contribute

Contributions are very welcome.

If you want to contribute, please open an Issue or a PR.
Please refer to [the contributing guide](./docs-src/CONTRIBUTING.md) for more info.
