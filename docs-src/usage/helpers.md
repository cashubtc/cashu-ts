# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Helpers**

# Helpers

Standalone utility functions in the public API. No `Wallet` or `Mint` instance needed.

## `normalizeMintUrl`

Returns the canonical form of a mint URL, or throws `CTSError` if it is not a clean
http(s) URL (exact rules in the API reference). `Wallet` and `Mint` already normalize
the URLs you pass them; call it yourself when a mint URL is a storage key, or when
comparing a token's mint against your own records.

```ts
import { normalizeMintUrl } from '@cashu/cashu-ts';

normalizeMintUrl('https://Mint.Example.COM/'); // 'https://mint.example.com'
normalizeMintUrl('ftp://mint.example.com'); // throws CTSError
```

## `findLegacyDerivationCollisions`

Call with the keyset IDs of every mint the seed is used with, including inactive keysets,
when adding a mint or refreshing keysets. The derivation path does not include the mint, so
keysets from different mints can collide. Returns groups of distinct legacy IDs (base64 or
hex version `00`) that share a NUT-13 BIP-32 path integer, or `[]` when none collide.
Repeated identical IDs do not form a collision, nor do hex casing or URL-safe base64
spellings; returned IDs retain their first spelling. Other hex versions, including future
versions, and unrecognized forms are skipped without throwing. How to handle a reported
collision is wallet policy.

```ts
import { findLegacyDerivationCollisions } from '@cashu/cashu-ts';

// One wallet per mint, all on the same seed
const collisions = findLegacyDerivationCollisions(
  [walletA, walletB].flatMap((w) => w.keyChain.getAllKeysetIds()),
);
```
