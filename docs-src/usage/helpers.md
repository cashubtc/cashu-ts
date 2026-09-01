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

## `sha256` and `taggedHash`

The two hash primitives the protocol's byte-level constructions are built on, exported so
verifiers do not need a hash library of their own. `sha256` is noble's byte-level hash,
surfaced as-is; for UTF-8 message strings use `computeMessageDigest` instead. `taggedHash`
is the BIP340 construction, `SHA256(SHA256(tag) || SHA256(tag) || messages)`, the one
NUT-10 uses for leaf, branch, tweak and input-digest hashing.

The example recomputes a NUT-07 spend commitment from a check-state entry's published
opening, which is exactly what a third-party verifier of a disclosure spend does:

```ts
import { computeMessageDigest, hexToBytes, bytesToHex, sha256, taggedHash } from '@cashu/cashu-ts';

const commitment = taggedHash(
  'Cashu_SpendCommitment',
  hexToBytes(state.Y),
  hexToBytes(state.input_digest),
  computeMessageDigest(state.witness), // SHA256 over the exact witness string
);
bytesToHex(commitment) === state.commitment; // true for a valid opening

sha256(new Uint8Array(0)); // raw bytes in, 32 hash bytes out
```
