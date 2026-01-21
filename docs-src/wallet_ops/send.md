[Documents](../index.html) › [Wallet Operations](../wallet_ops/wallet_ops.md) › **Send**

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
	.asP2PK({ pubkey, locktime: 1712345678 })
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
const mySendData: OutputData[] = [
	/* amounts must sum to 15 */
];

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
