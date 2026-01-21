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

## Usage

We provide comprehensive examples categorized by use case:

- **[Basic Guide](./docs-src/usage/usage_index.md)**: Getting Started, and basic token operations.
- **[WalletOps](./docs-src/wallet_ops/wallet_ops.md)**: Translation Builder Usage Recipes.
- **[WalletEvents](./docs-src/wallet_events/wallet_events.md)**: Event Subscriptions
- **[Deterministic Counters](./docs-src/deterministic_counters.md)**: Deterministic counters (persist, inspect, bump).

### Note: Builder hooks vs Global events

`WalletOps` builders include per-operation hooks (onCountersReserved) that fire during a single transaction build.

`WalletEvents` provides global subscriptions `(wallet.on.*)` that can outlive a single builder call.

Use the builder hooks for transaction-local callbacks, and WalletEvents for app-wide subscriptions.

### Browser usage (standalone build)

Cashu TS provides a standalone browser build (IIFE) intended for demos and
non-bundler usage. The standalone bundle is published as part of GitHub Releases rather than the npm
package.

---

## Contribute

Contributions are very welcome.

If you want to contribute, please open an [Issue](https://github.com/cashubtc/cashu-ts/issues) or a [PR](https://github.com/cashubtc/cashu-ts/pulls).
We are also tracking the status with [projects](https://github.com/cashubtc/cashu-ts/projects?query=is%3Aopen).
Please refer to [the contributing guide](./docs-src/CONTRIBUTING.md) for more info.

## Contact & Maintainers

Feel free to join the [matrix server](https://matrix.to/#/#dev:matrix.cashu.space) or [telegram channel](https://t.me/CashuBTC)
