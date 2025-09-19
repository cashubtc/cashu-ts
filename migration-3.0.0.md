# Version 3.0.0 Migration guide

⚠️ Upgrading to version 3.0.0 will come with breaking changes! Please follow the migration guide for a smooth transition to the new version.

## Breaking changes

### Renamed Classes and Streamlined instantiation

Version 3 uses new class names:

`CashuWallet` is now `Wallet`
`CashuMint` is now `Mint`

A wallet can be instantiated by passig a `Mint` instance, as before, or simply by passing in a mintUrl. You MUST now call the `loadMint()` method to complete wallet init.

example:

```ts
const mintUrl = 'http://localhost:3338';
const wallet1 = new Wallet(mintUrl); // unit is 'sat'
await wallet1.loadMint(); // wallet is now ready to use
```

### Crypto Library

The sub-module exports for the Crypto Library have been removed. All functions are now exported from the main library index.

example:

```ts
import { signP2PKProofs } from '@cashu/cashu-ts/crypto/client/NUT11';
import { verifyP2PKSig } from '@cashu/cashu-ts/crypto/mint/NUT11';
```

is now:

```ts
import { signP2PKProofs, verifyP2PKSig } from '@cashu/cashu-ts';
```

Some crypto types have been deduplicated to the main library types:

- `Proof` is now `RawProof`
- `MintKeys` is now `RawMintKeys`
- `Keyset` and `KeysetWithKeys` have been removed as unused

### `CashuWallet` to `Wallet` API changes

#### New `OutputType` and `OutputConfig` types

`Wallet` now gives you flexibility over how you shape your mint, melt, send and receive outputs.

The `keepFactory` and `outputData` options have been removed, as have the confusing jumble of output options (`SendOptions`, `ReceiveOptions`, etc).

These are replaced with a tagged union parameter called `OutputType`, which defines the shape of outputs (random, deterministic, p2pk, etc).

The `OutputConfig` type combines keep/send OutputTypes for `send` operations.

The `receive`, `send`, `mintProofs`, and `meltProofs` method signatures have therefore changed to accept the output type you wish to use as the THIRD parameter.

Two new constants have been added for convenience:

`DEFAULT_OUTPUT` - specifies default output for receive, mint and melt.
`DEFAULT_OUTPUT_CONFIG` - specifies send/keep outputs for send

example send:

```ts
const { keep: proofsToKeep, send: proofsToSend } = await wallet.send(amountToSend, proofs, {
	includeFees: true,
});
```

is now:

```ts
const { keep: proofsToKeep, send: proofsToSend } = await wallet.send(
	amountToSend,
	proofs,
	DEFAULT_OUTPUT_CONFIG, // uses random proof secrets
	{
		includeFees: true,
	},
);
```

Helper methods are also available to make migration easier:

```ts
const { keep: proofsToKeep, send: proofsToSend } = await wallet.sendAsDefault(
	amountToSend,
	proofs,
	{
		includeFees: true,
	},
);
```

See the README for more examples.

#### Keyset methods delegated to KeyChain class

Wallet no longer manages keysets and keys itself. Instead, these are delegated to the KeyChain class.

The following wallet methods are affected:

- `wallet.getKeys(id?)` -> `wallet.keyChain.getKeyset(id?)`
- `wallet.getActiveKeyset()` -> `wallet.keyChain.getCheapestKeyset()`
- `wallet.getKeySets()` -> `wallet.keyChain.getKeysets()`
- `wallet.getAllKeys()` -> `wallet.keyChain.getCache().keys`

#### Removed constants

The following constants are no longer available:

- `DEFAULT_DENOMINATION_TARGET`
- `DEFAULT_UNIT`
- `TOKEN_VERSION`
- `TOKEN_PREFIX`

#### Removed static methods in `Mint`

The `Mint` class no longer has static methods. If you wish to call a mint method, simply instantiate a mint first, then call the instance method.

---
