[Documents](../index.html) › [Wallet Operations](../wallet_ops/wallet_ops.md) › **P2PK Builder API**

# P2PKBuilder API

Small helper that only shapes `P2PKOptions`, it does not create secrets.

```ts
new P2PKBuilder()
  .addLockPubkey(k: string | string[])    // accepts 02|03 compressed, or x only (Nostr)
  .addRefundPubkey(k: string | string[])  // requires lockUntil(...) to be set
  .lockUntil(when: number | Date)         // unix seconds, unix ms, or Date
  .requireLockSignatures(n: number)       // n of m for lock keys
  .requireRefundSignatures(n: number)     // n of m for refund keys
  .addTag(key: string, values?: string[] | string) // add single tag (eg: NutZap 'e')
  .addTags(tags: P2PKTag[]) // add multiple tags at once
  .addHashlock(hashlock: string) // for NUT-14 "HTLC" kind secrets
  .toOptions(): P2PKOptions;

P2PKBuilder.fromOptions(opts: P2PKOptions): P2PKBuilder
```

**Behaviour**

Keys are normalised and de-duplicated, insertion order is preserved, total lock plus refund keys must be ≤ 10, refund keys will throw if no locktime is set.

Example usage:

```ts
import { P2PKBuilder } from '@cashu/cashu-ts';

const p2pk = new P2PKBuilder().addLockPubkey('02abc...').lockUntil(1_712_345_678).toOptions();

await wallet.ops.send(5, proofs).asP2PK(p2pk).run();
```
