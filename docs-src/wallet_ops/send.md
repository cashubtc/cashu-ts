# <a href="/">Documents</a> › [Wallet Operations](../wallet_ops/wallet_ops.md) › **Send**

# Wallet Operations: Send

## 1) Smallest possible send (policy defaults)

```ts
const { keep, send } = await wallet.ops.send(5, myProofs).run();
```

- Uses wallet policy for both `send` and `keep`.
- If the wallet's default policy is random, the wallet may attempt an **offline exact match** first, which avoids the swap fee if `send` and `keep` are also policy default.
- `keep` is the full remainder: the change from the swap plus every proof that was not selected. Storing it wholesale is correct.

A crash or disconnect between the swap and your proof store strands the inputs. Anything that must survive that uses the two-step form in the next section.

## 2) Crash-safe send: persist the preview

A one-shot `run()` that dies between the mint's reply and your storage write has spent the inputs without you ever seeing the new proofs. Persisting the preview closes that window: `completeSwap` builds its request purely from the preview, so replaying a persisted preview posts a byte-identical `/v1/swap` body, and a mint that caches the endpoint (NUT-19) returns the original signatures. `prepare()` is also the dry run: `preview.fees` is the input fee the swap will charge you, see [Fees](../usage/fees.md).

`keep` means something different here. Proofs that were not selected sit in `preview.unselectedProofs`. A live preview still carries them and `completeSwap()` merges them into `keep`, but a preview that has been through `serializeSwapPreview` does not, so after a replay `keep` is the change only. Code that moved from `run()` to this form and kept storing `keep` wholesale will drop those proofs on the first replay. The pattern below behaves the same way on both paths.

```ts
import { deserializeSwapPreview, serializeSwapPreview } from '@cashu/cashu-ts';

const preview = await wallet.ops.send(21, myProofs).prepare();

// Unselected proofs take no part in the swap: back to storage now, not into the blob.
returnToStore(preview.unselectedProofs ?? []);

// Persist before completing. Previews hold Amount, bigint and Uint8Array values, so use
// the serialization helper before stringify.
const stored = JSON.stringify(serializeSwapPreview(preview));

// Complete from the deserialized copy so keep is the change only, as it will be on a replay.
const { keep, send } = await wallet.completeSwap(deserializeSwapPreview(JSON.parse(stored)));
storeChange(keep);

// ... after a restart: load the mint again, then replay the same preview ...
const { keep: change, send: recovered } = await wallet.completeSwap(
  deserializeSwapPreview(JSON.parse(stored)),
);
```

Completing from the deserialized copy rather than the live preview is what makes the two paths match: the live preview would merge `unselectedProofs` back into `keep`, and a store that already took them back would hold them twice.

> The serialized preview contains `inputs` in the clear, so it is spendable bearer material.
> Store it with the same protection as the proof database, and delete it once the swap settles.

The replay window has bounds:

- The mint must advertise `/v1/swap` in its NUT-19 `cached_endpoints`, and the replay must happen inside the advertised TTL. See [NUT-19 Cached Responses](../usage/nut19.md).
- Automatic NUT-19 retries only cover failures inside a running process. The persisted preview is what covers a process restart.
- A preview and a seed protect different windows: the preview covers a restart inside the TTL; deterministic secrets plus NUT-09 restore cover loss after it.

## 3) Deterministic send, random change

```ts
const { keep, send } = await wallet.ops
  .send(15, myProofs)
  .asDeterministic(0, [4, 4]) // counter=0 => auto-reserve; split must include 2x 4's
  .keepAsRandom() // change proofs must have random secrets
  .run();
```

> **Note**
> Passing `counter=0` means "reserve counters automatically" using wallet CounterSource.

## 4) P2PK send with sender-pays fees

```ts
const { keep, send } = await wallet.ops
  .send(10, myProofs)
  .asLocked({ mainKeys: [pubkey], locktime: 1712345678, refundKeys: [myPubkey] })
  .includeFees(true) // sender covers receiver’s future spend fee
  .run();
```

## 5) Use a factory for custom OutputData

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

## 6) Fully custom OutputData (prebuilt)

```ts
const mySendData: OutputData[] = [/* amounts must sum to 15 */];

const { keep, send } = await wallet.ops.send(15, myProofs).asCustom(mySendData).run();
```

Custom data may name any active keyset of the wallet unit, per output. The wallet checks each keyset before the swap and unblinds every output with the keyset the mint signed under.

Normal sends swap v3 proofs that lack transferable bearer keys, even when the amounts match exactly. Supplying a script-path plan also forces a swap.

## 7) Force pure offline (no mint calls)

Explicit offline modes forward existing proofs without unlocking them. They reject script-path plans because v3 transaction signatures require an online swap.

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
