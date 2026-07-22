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
