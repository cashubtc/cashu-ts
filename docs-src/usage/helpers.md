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

Finds the first cashu token or payment request inside arbitrary text: a chat message, a clipboard
blob, a `bitcoin:` URI parameter, a wallet URL fragment. Candidates are matched by prefix and then
decoded to validate, so a prefix that does not decode is skipped and the search continues. The
payload is returned exactly as it appeared, ready to hand to `getDecodedToken` or
`decodePaymentRequest`. Scanning for the payload itself covers the wrapper forms, so there is no
table of known wallet URL prefixes to maintain.

```ts
import { findCashuPayload, getDecodedToken, decodePaymentRequest } from '@cashu/cashu-ts';

const found = findCashuPayload(pastedText);

if (found?.kind === 'token') {
  const token = getDecodedToken(found.payload, myKeyChain.getAllKeysetIds());
} else if (found?.kind === 'paymentRequest') {
  const pr = decodePaymentRequest(found.payload);
}
```

Returns `null` when the text carries no payload that decodes.
