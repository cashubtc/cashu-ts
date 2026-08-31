# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Browser Signers (NIP-07)**

# Signing with a browser extension: `CashuNip07`

A NIP-07 extension (`window.nostr`) holds a Nostr key the page never sees. `CashuNip07` adapts what such extensions expose to both Cashu lock families, without pulling any nostr code into the library: no relays, no events, only `window.nostr`.

```ts
import { CashuNip07, type Nip07Like } from '@cashu/cashu-ts';
const nostr: Nip07Like = window.nostr; // every member optional; the adapter degrades to what is present
const pubkey = await CashuNip07.pubkey(nostr); // 02-prefixed, as locks list it
```

## What the extension can do

| Extension method             | Who ships it | Cashu use                                                               |
| :--------------------------- | :----------- | :---------------------------------------------------------------------- |
| `getPublicKey`               | everyone     | which lock keys are the extension's                                     |
| `nip44.decrypt`              | most         | unlock a NIP-60 wallet's keys ([`nip60Keys`](#nip-60-wallet-keys))      |
| `nip60.signSecret(secret)`   | nos2x, ...   | NUT-11 `SIG_INPUTS` signature over `sha256(secret)`                     |
| `signString(secret)`         | AKA Profiles | the same, under its older name                                          |
| `nip60.signTransaction(msg)` | proposed     | nutroot witness; the signer hashes and checks the tagged message itself |
| `signSchnorr(digest)`        | Alby         | either, over a bare 32-byte digest; most signers refuse to ship this    |

`signEvent` is never usable: it signs an event id, which can never equal a Cashu digest.

## NUT-11 proofs (pre-v3 keysets): `signP2PK`

```ts
const signed = await CashuNip07.signP2PK(nostr, proofs);
```

Adds the extension's signature to every `SIG_INPUTS` proof that lists its key and does not already carry its signature. `nip60.signSecret` (or its older name `signString`) is preferred, and its reply is checked against the secret's hash and the extension's key; `signSchnorr` over the hash is the fallback. `SIG_ALL` proofs are skipped (that message covers the transaction: use the SigAll package), blinded (P2BK) keys never match, and v3 proofs pass through untouched, so one call serves a mixed token.

## Nutroot proofs (v3 keysets): `completes` and `cosign`

A nutroot witness signs its input's digest, so the extension can help only where its key appears verbatim in a disclosed leaf: the [auditable lock](../wallet_ops/spend_locked.md#auditable-locks), an unblinded refund or multisig leaf. Blinded leaf keys and the key path (receiver-keyed or tweaked) never match.

```ts
const { script } = await wallet.spendOptions(proof);
const leaf = script.find((o) => CashuNip07.completes(o, pubkey)); // one more signature satisfies it
if (leaf) {
  await wallet.ops
    .receive([proof])
    .scriptPath([
      { secret: proof.secret, leafIndex: leaf.leafIndex, cosign: CashuNip07.cosign(nostr) },
    ])
    .run();
}
```

`cosign` is a [`ScriptPathPlan.cosign`](../wallet_ops/spend_locked.md#script-path-scriptpathplans) hook. It prefers `nip60.signTransaction(messageHex, containerHex)`: the extension receives the tagged pre-hash message (`"Cashu_Transaction_v1" || transcript`) and the input's own container record, derives the input digest itself, and can refuse anything else, so an event id can never pass through it. The reply's `hash` must equal the input digest cts computed. Without it, the hook falls back to `signSchnorr` over the digest.

`CashuNip07.signTransaction(messageHex, containerHex, secretKey)` is the reference implementation of `nip60.signTransaction`, for the extension side of that contract and for tests: it takes the private key, which the page never has, so a page cannot use it in place of the extension's method. It refuses any message without the domain tag and any container the message does not carry, then derives the input digest, signs BIP-340 and returns `{ hash, sig, pubkey }`, the shape `nip60.signSecret` already uses.

## NIP-60 wallet keys

```ts
const { privkeys, mints } = await CashuNip07.nip60Keys(nostr, xOnlyPubkey, walletEvent.content);
```

Decrypts a NIP-60 wallet event's content through the extension's `nip44` and reads its `privkey` and `mint` tags. Fetching the event is the caller's business. The keys then go into `receive({ privkey })`, `spendOptions({ privkeys })` and `planScriptPaths({ privkeys })` like any other, which covers the locks the extension's own key cannot: blinded keys, and the nutroot key path.
