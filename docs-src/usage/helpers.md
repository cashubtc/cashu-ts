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

## `findCashuPayload`

Finds the first token or payment request out of a block of text which could be a chat message, a wallet URL with the token in its fragment, a `bitcoin:` URI carrying a request in a query parameter.

A match is found by prefix and then decoded to verify they are correct, so anything that is not really a payload gets skipped and the scan carries on, because we are looking for a correct payload and not the wrapper. What it finds comes back as it appeared, apart from bech32m requests, which are lowercased to their canonical form, and you get `null` if nothing decodes.

```ts
import {
  findCashuPayload,
  getTokenMetadata,
  getDecodedToken,
  decodePaymentRequest,
} from '@cashu/cashu-ts';

const found = findCashuPayload(pastedText);

if (found?.kind === 'token') {
  const meta = getTokenMetadata(found.payload); // mint, unit and amount, no keysets needed
  // getDecodedToken resolves short keyset IDs against the keysets you pass it, so it throws for a
  // mint you have not loaded, which is the common case for a stranger's paste.
  const token = getDecodedToken(found.payload, myKeyChain.getAllKeysetIds());
} else if (found?.kind === 'paymentRequest') {
  const pr = decodePaymentRequest(found.payload);
}
```
