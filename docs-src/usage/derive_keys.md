# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Derive Keys**

# Derive deterministic P2PK & quote-locking keys

Derive secp256k1 signing keys deterministically from the wallet seed, so the keys you lock
proofs (NUT-11 P2PK) or mint quotes (NUT-20) to are **recoverable**: no separate key backup,
just the seed. Keys follow the BIP-32 path `m/129373'/{purpose}'/0'/0'/{counter}`, as defined for
[NUT-11](https://github.com/cashubtc/nuts/blob/main/11.md) (P2PK) and
[NUT-20](https://github.com/cashubtc/nuts/blob/main/20.md) (quote locking).

```typescript
import { deriveKeyPair } from '@cashu/cashu-ts';

// `seed` is the same Uint8Array you passed to `new Wallet(url, { bip39seed: seed })`.
// `purpose` is 'P2PK' or 'QuoteLock'; `counter` is yours to allocate and persist (see "Counters").
const { pubkey, privkey } = deriveKeyPair(seed, 'P2PK', counter); // both hex strings
```

`pubkey` and `privkey` are hex, so they drop straight into the lock/quote/sign APIs with no
conversion.

## P2PK: lock a send, recover the key to receive it

```typescript
import { deriveKeyPair, getEncodedToken } from '@cashu/cashu-ts';

const counter = 0; // your next unused P2PK counter
const { pubkey, privkey } = deriveKeyPair(seed, 'P2PK', counter);

const { send } = await wallet.ops.send(32, proofs).asP2PK({ pubkey }).run();
const token = getEncodedToken({ mint: mintUrl, proofs: send });

// Later: re-derive the same key from seed + counter to unlock the proofs:
const { privkey: recovered } = deriveKeyPair(seed, 'P2PK', counter);
const receiveProofs = await wallet.receive(token, { privkey: recovered });
```

## NUT-20: lock a mint quote

```typescript
import { deriveKeyPair } from '@cashu/cashu-ts';

const counter = 0; // your next unused quote-lock counter
const { pubkey, privkey } = deriveKeyPair(seed, 'QuoteLock', counter);

const quote = await wallet.createLockedMintQuote(64, pubkey);
// ...pay the quote's BOLT11 invoice...
const proofs = await wallet.ops.mint(64, quote).privkey(privkey).run();
```

## Find locked quotes by pubkey (experimental)

Mints implementing the draft quote-lookup NUT can return every NUT-20 locked mint quote for
your keys, which pairs well with restore scans:

```typescript
const quotes = await wallet.getMintQuotesByPubkey(privkey); // or [privkeyA, privkeyB]
```

The wallet signs the lookup with each key against the mint's info pubkey; the mint returns the
quotes locked to the corresponding pubkeys. Quotes may span payment methods, so check each
quote's `method` field.

## Counters

A counter only tells you _how many_ keys exist, never _what each was for_, so this library does
**not** track them. You own the allocation and the mapping (`quote -> counter`,
`proof/pubkey -> counter`) in your app storage. Use the next unused integer for each new key, and
persist it alongside whatever the key locks.

## Restore scans

To find which counter a recovered pubkey belongs to, scan counters and match. For tight loops use
`createKeyPairDeriver`, which caches the shared parent derivation (one child derivation per counter
instead of re-walking the full path):

```typescript
import { createKeyPairDeriver } from '@cashu/cashu-ts';

const derive = createKeyPairDeriver(seed, 'P2PK'); // cached; returns (counter) => { pubkey, privkey }
for (let counter = 0; counter < gapLimit; counter++) {
  if (derive(counter).pubkey === targetPubkey) {
    // matched: counter found
    break;
  }
}
```
