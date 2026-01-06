[Documents](../index.html) › [Wallet Operations](../wallet_ops/wallet_ops.md) › **Receive**

# Receive

## 1) Default receive

```ts
const proofs = await wallet.ops.receive(token).run();

// Or use prepare() instead of run() to do a dry run preview first
const preview = await wallet.ops.receive(token).prepare();
const { keep } = await wallet.completeSwap(preview);
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

```ts
const proofs = await wallet.ops
	.receive(token)
	.asP2PK({ pubkey, locktime }) // NUT-11 options for new proofs
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
