# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Helpers**

# Helpers

Small, standalone utility functions that are part of the supported public API. These need no
`Wallet` or `Mint` instance — import and call. This page grows as more helpers are promoted
into core.

## `normalizeMintUrl`

Parses and normalizes a mint URL into its canonical form: validates the scheme (http/https
only), rejects credentials, query parameters, fragments, and encoded path delimiters, lowercases
the host, and strips trailing slashes. Throws `CTSError` on invalid input.

Use it anywhere a mint URL acts as an identity or cache key, two URLs that normalize
identically refer to the same mint. `Wallet` and `Mint` already apply it internally to the
URLs you pass them; call it yourself when you key storage, deduplicate mints, or compare a
token's mint URL against your own records.

```ts
import { normalizeMintUrl } from '@cashu/cashu-ts';

normalizeMintUrl('https://Mint.Example.COM/'); // 'https://mint.example.com'
normalizeMintUrl('https://mint.example.com///'); // 'https://mint.example.com'
normalizeMintUrl('http://abc123.onion/path'); // 'http://abc123.onion/path'
normalizeMintUrl('ftp://mint.example.com'); // throws CTSError
normalizeMintUrl('https://mint.example.com?x=1'); // throws CTSError
```
