# <a href="/">Documents</a> › [Wallet Operations](../wallet_ops/wallet_ops.md) › **Send**

# Wallet Operations: Send

## 1) Smallest possible send (policy defaults)

```ts
const { keep, send } = await wallet.ops.send(5, myProofs).run();

// Or use prepare() instead of run() to do a dry run preview first
const preview = await wallet.ops.send(5, myProofs).prepare();
const { keep, send } = await wallet.completeSwap(preview);
```

- Uses wallet policy for both `send` and `keep`.
- If you only customize **send**, `keep` is omitted so the wallet may still attempt an **offline exact match** where possible. This avoids mint fees.

## 2) Deterministic send, random change

```ts
const { keep, send } = await wallet.ops
  .send(15, myProofs)
  .asDeterministic(0, [4, 4]) // counter=0 => auto-reserve; split must include 2x 4's
  .keepAsRandom() // change proofs must have random secrets
  .run();
```

> **Note**
> Passing `counter=0` means "reserve counters automatically" using wallet CounterSource.

## 3) P2PK send with sender-pays fees

```ts
const { keep, send } = await wallet.ops
  .send(10, myProofs)
  .asP2PK({ kind: 'P2PK', data: pubkey, locktime: 1712345678 })
  .includeFees(true) // sender covers receiver’s future spend fee
  .run();
```

## 4) Use a factory for custom OutputData

```ts
const { keep, send } = await wallet.ops
  .send(20, myProofs)
  .asFactory(makeOutputData, [4, 8, 8]) // makeOutputData: OutputDataFactory
  .keepAsDeterministic() // deterministic change, auto-reserve
  .keyset('0123456')
  .onCountersReserved((info) => {
    console.log('Reserved counters', info);
  })
  .run();
```

## 5) Fully custom OutputData (prebuilt)

```ts
const mySendData: OutputData[] = [/* amounts must sum to 15 */];

const { keep, send } = await wallet.ops.send(15, myProofs).asCustom(mySendData).run();
```

## 6) Force pure offline (no mint calls)

**Exact match only (throws on no exact match):**

```ts
const { keep, send } = await wallet.ops
  .send(7, myProofs)
  .offlineExactOnly(/* requireDleq? */ false)
  .includeFees(true) // optional; applied to the offline selection rules
  .run();
```

**Close match allowed (overspend permitted by wallet RGLI):**

```ts
const { keep, send } = await wallet.ops
  .send(7, myProofs)
  .offlineCloseMatch(/* requireDleq? */ true) // only proofs with valid DLEQ
  .run();
```

> **Important**
> Offline modes **cannot** be combined with custom output types (`asXXXX/keepAsXXXX`).
> The builder will throw:
> `Offline selection cannot be combined with custom output types. Remove send/keep output configuration, or use an online swap.`

## 7) Crash-safe send: persist the preview

A one-shot `run()` that dies between the mint's reply and your storage write has spent the
inputs without you ever seeing the new proofs. Persisting the preview closes that window:
`completeSwap` builds its request purely from the preview, so replaying a persisted preview
posts a byte-identical `/v1/swap` body, and a mint that caches the endpoint (NUT-19) returns
the original signatures.

```ts
import { deserializeSwapPreview, serializeSwapPreview } from '@cashu/cashu-ts';

const preview = await wallet.ops.send(21, myProofs).prepare();

// Unselected proofs can go back to storage now; they are not part of the replay.
const backToStorage = preview.unselectedProofs ?? [];

// Persist before completing. Previews contain Amount, bigint and Uint8Array values,
// so use the helper rather than calling JSON.stringify(preview) directly.
const stored = JSON.stringify(serializeSwapPreview(preview));

const { keep, send } = await wallet.completeSwap(preview);

// ... after a restart: load the mint again, then replay the same preview ...
const { keep: change, send: recovered } = await wallet.completeSwap(
  deserializeSwapPreview(JSON.parse(stored)),
);
```

The replay window has bounds:

- The mint must advertise `/v1/swap` in its NUT-19 `cached_endpoints`, and the replay must
  happen inside the advertised TTL. See [NUT-19 Cached Responses](../usage/nut19.md).
- Automatic NUT-19 retries only cover failures inside a running process. The persisted
  preview is what covers a process restart.
- A preview and a seed protect different windows: the preview covers a restart inside the
  TTL; deterministic secrets plus NUT-09 restore cover loss after it.
