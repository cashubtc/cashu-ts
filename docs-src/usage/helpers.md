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

## `sha256` and `taggedHash`

The two hash primitives the protocol's byte-level constructions are built on, exported so
verifiers do not need a hash library of their own. `sha256` takes raw bytes; for UTF-8
message strings use `computeMessageDigest` instead. `taggedHash` is the BIP340
construction, `SHA256(SHA256(tag) || SHA256(tag) || messages)`, the one NUT-10 uses for
leaf, branch, tweak and input-digest hashing.

The example hashes a serialized condition leaf as NUT-10 does:

```ts
import { hexToBytes, bytesToHex, sha256, taggedHash } from '@cashu/cashu-ts';

// A threshold leaf, n = 1, for the key G (NUT-10 leaf layout).
const leaf = '0001020001010400210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const leafHash = bytesToHex(taggedHash('Cashu_NutrootLeaf', hexToBytes(leaf)));

sha256(new Uint8Array(0)); // raw bytes in, 32 hash bytes out
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
  // mint you have not loaded, which is the common case for a stranger's paste. Raw binary tokens
  // go through getDecodedTokenBinary(bytes, keysetIds) with the same list.
  const token = getDecodedToken(found.payload, myKeyChain.getAllKeysetIds());
} else if (found?.kind === 'paymentRequest') {
  const pr = decodePaymentRequest(found.payload);
}
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

## `hexToBytes` and `bytesToHex`

Most of the API speaks hex strings, but the crypto entry points take and return `Uint8Array`:
`bip39seed`, the `seed` passed to `deriveKeyPair`, and the digests from `computeMessageDigest`.
These two convert between the forms, so a seed you keep as hex in storage does not need a byte
library of its own.

Both are strict: input is not trimmed, and prefixes, whitespace, odd lengths and non-hex
characters all throw `CTSError`. Uppercase hex is accepted and output is always lowercase.

```ts
import { hexToBytes, bytesToHex, Wallet } from '@cashu/cashu-ts';

const seed = hexToBytes(storedSeedHex); // Uint8Array, ready for the Wallet
const wallet = new Wallet(mintUrl, { bip39seed: seed });

bytesToHex(seed); // back to lowercase hex for storage
hexToBytes('0x00'); // throws CTSError: prefixes are not stripped
```
