# <a href="/">Documents</a> › [Wallet Operations](../wallet_ops/wallet_ops.md) › **P2PK Builder API**

# P2PKBuilder API

Small helper that shapes a `P2PKOptions` lock, it does not create secrets.

```ts
new P2PKBuilder()
  .addLockPubkey(k: string | string[])    // 02|03 compressed only; for an x-only (Nostr) key prepend '02'
  .addRefundPubkey(k: string | string[])  // requires lockUntil(...) to be set
  .lockUntil(when: number | Date)         // unix seconds, unix ms, or Date
  .requireLockSignatures(n: number)       // n of m for lock keys
  .requireRefundSignatures(n: number)     // n of m for refund keys
  .addTag(key: string, values?: string[] | string) // add single tag (eg: NutZap 'e')
  .addTags(tags: P2PKTag[]) // add multiple tags at once
  .addHashlock(hashlock: string) // for NUT-14 "HTLC" kind secrets
  .toOptions(): P2PKOptions; // { kind, data, ...tags }

P2PKBuilder.fromOptions(opts: P2PKOptions): P2PKBuilder
```

**Behaviour**

Keys must be 33-byte compressed hex and on the secp256k1 curve (NUT-11); a 32-byte x-only key (eg Nostr) throws until you prepend `'02'`, per NIP-61 practice. Keys are de-duplicated, insertion order is preserved, total lock plus refund keys must be ≤ 10, refund keys will throw if no locktime is set.

Example usage:

```ts
import { P2PKBuilder } from '@cashu/cashu-ts';

const p2pk = new P2PKBuilder().addLockPubkey('02abc...').lockUntil(1_712_345_678).toOptions();

// `p2pk` already carries its `kind`, so pass it to `asP2PK`:
await wallet.ops.send(5, proofs).asP2PK(p2pk).run();
```
