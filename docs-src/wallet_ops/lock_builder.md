# <a href="/">Documents</a> › [Wallet Operations](../wallet_ops/wallet_ops.md) › **Lock Builder API**

# LockBuilder API

Small helper that shapes a semantic `LockOptions` lock, it does not create secrets. The wallet encodes the result for whichever keyset is active: NUT-11/14 tags on pre-v3 keysets, a nutroot tree on v3.

```ts
new LockBuilder()
  .addMainPubkey(k: string | string[])    // 02|03 compressed only; for an x-only (Nostr) key prepend '02'
  .addRefundPubkey(k: string | string[])  // requires lockUntil(...) to be set
  .lockUntil(when: number | Date)         // unix seconds, unix ms, or Date
  .requireMainSignatures(n: number)       // n of m for main keys
  .requireRefundSignatures(n: number)     // n of m for refund keys
  .addTag(key: string, values?: string[] | string) // extra NUT-11 tag (eg: NutZap 'e'); pre-v3 only
  .addTags(tags: P2PKTag[]) // add multiple tags at once
  .addHashlock(hashlock: string) // preimage required alongside signatures (NUT-14 semantics)
  .addLeaf(leaf: NutrootLeaf) // explicit tree leaf (eg staged reclaim); v3 only
  .blindKeys(keys?: string | string[]) // blind every key, or exactly the listed keys (list is v3 only)
  .sigAll() // NUT-11 SIG_ALL; on v3 this is the default and only behavior
  .toOptions(): LockOptions;

LockBuilder.fromOptions(lock: LockOptions): LockBuilder
```

**Behaviour**

Keys must be 33-byte compressed hex and on the secp256k1 curve (NUT-11); a 32-byte x-only key (eg Nostr) throws until you prepend `'02'`, per NIP-61. Keys are de-duplicated, insertion order is preserved, total main plus refund keys must be ≤ 11 for a plain lock or ≤ 10 with a hashlock (the hashlock takes a slot, NUT-28), refund keys will throw if no locktime is set.

Shapes only one encoding can express refuse at encode time, naming the reason: extra tags, anyone-after-locktime, and keyless hashlocks do not fit v3; explicit leaves and partial blind lists do not fit pre-v3. See the [v5 migration guide](../../migration-5.0.0.md) for the full matrix. The spending side (inspecting, receiving, and script-path spends of locked proofs) is covered in [Spending Locked Proofs](./spend_locked.md).

Example usage:

```ts
import { LockBuilder } from '@cashu/cashu-ts';

const lock = new LockBuilder()
  .addMainPubkey('02abc...')
  .lockUntil(1_712_345_678)
  .addRefundPubkey('02def...')
  .toOptions();

// pass the options (or the builder itself) to `asLocked`:
await wallet.ops.send(5, proofs).asLocked(lock).run();
```
