# <a href="/">Documents</a> › [Wallet Operations](../wallet_ops/wallet_ops.md) › **Spending Locked Proofs**

# Spending locked v3 proofs

On a v3 keyset the lock lives inside the secret: the proof's secret is a taproot-tweaked pubkey, and any spending conditions are leaves of a tree committed into it (NUT-10). A locked proof can be spent two ways: the **key path** (sign with the internal key, conditions bypassed by consent of all key holders) or a **script path** (satisfy one disclosed leaf). Pre-v3 locked proofs keep NUT-11/14 semantics; see [Receive](./receive.md) and [LockBuilder](./lock_builder.md).

## `spend_info`: what travels with the proof

Everything the next owner needs that the proof itself does not say rides `proof.spend_info`:

```ts
type SpendInfo = {
  k?: string; // bearer key path: the internal secret key itself (32-byte hex)
  E?: string; // receiver-keyed path: ephemeral point; derive your key from your static privkey
  K?: string; // internal pubkey, for script-only transfers where neither k nor E travels
  u?: string; // NUMS offset proving K has no usable key path (K = H + u*G)
  tree?: string[]; // serialized leaves, in slot-map order
};
```

`k` and `E` are mutually exclusive, and the wallet refuses a proof carrying both: that shape leaks the receiver's static key. `spend_info` is local-only, stripped from every mint payload, and **fund-critical**: for a locked proof it belongs in storage and backups, because until the proof is swept it is the only thing that can spend it.

Two stateless helpers dispatch on this without a wallet: `isBlsProof(proof)` gates on the keyset id (nutroot rules apply), and `classifyNutrootSpendInfo(proof)` reads `spend_info` to `'bearer' | 'script-only' | 'receiver-keyed' | 'disclosed' | 'none'`, eg to route a pasted token to the right UI before asking for keys. `script-only` is a NUMS claim (`u` present): only the leaves spend. `disclosed` is `K` without a key for you: the key path is held elsewhere (eg an aggregated key's cosigners), so treat it as theirs to sweep unless a leaf is yours.

## Inspecting: `wallet.spendOptions()`

Reports what this wallet can do with a v3 proof. Offline (apart from a counter lookup) and changes nothing; use it to pick a leaf for a script path plan, or to show a user why a proof is stuck.

```ts
const { keyPath, script } = await wallet.spendOptions(proof, {
  privkeys: myStaticPrivkey, // optional: trial-matched against E and blinded leaf keys
  now: 1_712_345_678, // optional: unix seconds for locktime checks, defaults to now
});

// keyPath: true when a key-path key is recoverable (bearer k, matched E, or own seed)
// script: one entry per disclosed leaf, in tree order:
//   { leafIndex, leaf, keys, satisfiable, blockedBy?, availableAt? }
```

`satisfiable` is this wallet's own assessment from what it holds. `blockedBy` names the first obstacle: `'locktime'` (see `availableAt`), `'threshold'` (key shortfall), or `'preimage'` (a hashlock leaf whose keys are covered; the preimage comes from the caller, so a hashlock leaf is never satisfiable from the wallet alone). The mint judges an `after` leaf against its own clock, so a leaf that unlocked seconds ago may still be refused. A leaf the wallet cannot parse throws rather than reporting as spendable, the same fail-closed rule the receive cascade applies.

## Key path: receiving is the sweep

Receiving swaps locked proofs into your own seed-derived secrets, and that swap is the sweep: do it promptly, whatever the spend info says. A bearer `k` leaves the sender holding the same scalar; a receiver-keyed `E` is wallet data, unrecoverable from your seed until swept.

```ts
// Bearer (k travels with the token): nothing to pass, the wallet signs with it.
const proofs = await wallet.ops.receive(token).run();

// Receiver-keyed (locked to your pubkey): same call as pre-v3 P2PK.
const proofs = await wallet.ops.receive(token).privkey(myStaticPrivkey).run();
```

The same `.privkey(...)` serves send and melt when spending a still-locked proof directly. Every v3 input signs the whole transaction (NUT-10); an input the wallet holds no key for fails the call before the mint sees it.

## Script path: `.scriptPath(plans)`

Available on the send, receive, and melt builders. Each plan spends one input through one leaf of its disclosed tree:

```ts
type ScriptPathPlan = {
  secret: string; // which input, by its point-secret hex
  leafIndex: number; // which disclosed leaf
  preimage?: string; // required for a hashlock leaf
  extraKeys?: string[]; // signing keys beyond those the wallet recovers itself
  cosign?: (request: {
    digest: Uint8Array;
    message: Uint8Array;
    leaf: NutrootLeaf;
  }) => Promise<string[]>;
};
```

```ts
// A refund leaf after its locktime:
const { script } = await wallet.spendOptions(proof, { privkeys: refundPrivkey });
const leafIndex = script.findIndex((o) => o.satisfiable);
const fresh = await wallet.ops
  .receive([proof])
  .privkey(refundPrivkey)
  .scriptPath([{ secret: proof.secret, leafIndex }])
  .run();
```

For the common policy (first satisfiable leaf per proof the key path cannot spend), `wallet.planScriptPaths(proofs, { privkeys })` builds the plans in one call, quietly skipping non-v3 proofs, key path spends, and stuck proofs. Name plans yourself when a later leaf is preferable.

Plans are keyed by `secret`, not input index: proof selection decides input order. Everything except the signatures is checked when the transaction is prepared, so a plan that cannot be honored (undisclosed leaf, missing preimage, key shortfall with no cosigner) fails before any request is built.

**Cosigning.** A leaf whose other keys live elsewhere takes a `cosign` hook. It runs once the transaction is fixed and its digest known (the digest covers the outputs, so it cannot exist earlier), and returns BIP-340 signature hex over `digest`. `message` is the digest's preimage, tagged `Cashu_Transaction_v1`, for a signer that checks what it signs. It is awaited mid-flight: fine for a remote signer measured in seconds, not for approval ceremonies measured in days. Duplicate and non-verifying signatures are trimmed; the leaf still needs `n` valid ones or the spend fails.

## Auditable locks

Nutroot locks are private by default: only the key holder can prove who a receiver-keyed proof belongs to. When a payment wants the opposite (a public tip anyone can attest, eg a nostr Nutzap), lock it **auditable**: NUMS internal key, one threshold leaf of one key.

```ts
const { send } = await wallet.ops.send(21, proofs).asLocked(auditableLock(pubkey)).run();

// Any third party, no keys, no mint round-trip: who is this locked to?
const committedKey = auditableLockKey(proof); // pubkey hex, or undefined for any other shape
```

`auditableLockKey` verifies the full commitment (NUMS offset, recomputed root, tweak against the secret), not just the claimed fields. The leaf has one canonical serialization, so a claimer who knows the expected key can rebuild the spend info from `u` alone if it was mangled in transit. Claim via `planScriptPaths` above.
