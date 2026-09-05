# <a href="/">Documents</a> › [Wallet Operations](../wallet_ops/wallet_ops.md) › **Receive**

# Receive

`wallet.ops.receive(...)` accepts an encoded token string, a decoded `Token`, or raw `Proof[]`.

## 1) Default receive

```ts
const proofs = await wallet.ops.receive(token).run();

// Or use prepare() instead of run() to do a dry run preview first
const preview = await wallet.ops.receive(token).prepare();
const { keep } = await wallet.completeSwap(preview);
```

You can also receive an array of raw proofs directly:

```ts
const oldProofs: Proof[] = [proof1, proof2, proof3, ...];
const freshProofs = await wallet.ops.receive(oldProofs).run();
```

## 2) Deterministic receive with DLEQ requirement

```ts
const proofs = await wallet.ops
  .receive(token)
  .asDeterministic() // counter=0 => auto-reserve
  .requireDleq(true) // reject incoming proofs without DLEQ for the selected keyset
  .keyset('0123456')
  .onCountersReserved((c) => console.log('RX counters', c))
  .run();
```

## 3) P2PK locked receive (multisig)

On a v3 keyset locked proofs arrive as nutroot secrets instead of NUT-11 tags; the same `.privkey(...)` call signs them, and script-path spends are covered in [Spending Locked Proofs](./spend_locked.md).

```ts
const proofs = await wallet.ops
  .receive(token)
  .asLocked({ mainKeys: [pubkey], locktime, refundKeys: [myPubkey] }) // lock options for new proofs
  .privkey(['k1', 'k2', 'k3']) // sign incoming P2PK proofs
  .proofsWeHave(myExistingProofs) // helps denomination selection
  .run();
```

## 4) Receive with factory/custom splits

```ts
const proofsA = await wallet.ops
  .receive(tokenA)
  .asFactory(makeOutputData, [8, 4, 16]) // split must include these denoms
  .run();

const proofsB = await wallet.ops
  .receive(tokenB)
  .asCustom(prebuiltRxOutputs) // amounts must sum to final received amount after fees
  .run();
```

## 5) Crash-safe receive: persist the preview

A one-shot `run()` that dies between the mint's reply and your storage write has spent the
inputs without you ever seeing the new proofs. Persisting the preview closes that window:
`completeSwap` builds its request purely from the preview, so replaying a persisted preview
posts a byte-identical `/v1/swap` body, and a mint that caches the endpoint (NUT-19) returns
the original signatures.

```ts
import { deserializeSwapPreview, serializeSwapPreview } from '@cashu/cashu-ts';

const preview = await wallet.ops.receive(token).prepare();

// Persist before completing. Previews contain Amount, bigint and Uint8Array values,
// so use the helper rather than calling JSON.stringify(preview) directly.
const stored = JSON.stringify(serializeSwapPreview(preview));

const { keep } = await wallet.completeSwap(preview);

// ... after a restart: load the mint again, then replay the same preview ...
const { keep: recovered } = await wallet.completeSwap(deserializeSwapPreview(JSON.parse(stored)));
```

> The serialized preview contains `inputs` in the clear, so it is spendable bearer material.
> Store it with the same protection as the proof database, and delete it once the swap settles.

The replay window has bounds:

- The mint must advertise `/v1/swap` in its NUT-19 `cached_endpoints`, and the replay must
  happen inside the advertised TTL. See [NUT-19 Cached Responses](../usage/nut19.md).
- Automatic NUT-19 retries only cover failures inside a running process. The persisted
  preview is what covers a process restart.
- A preview and a seed protect different windows: the preview covers a restart inside the
  TTL; deterministic secrets plus NUT-09 restore cover loss after it.
