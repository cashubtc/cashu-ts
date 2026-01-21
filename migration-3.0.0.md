# Version 3.0.0 Migration guide

⚠️ Upgrading to version 3.0.0 will come with breaking changes! Please follow the migration guide for a smooth transition to the new version.

## Breaking changes

### Renamed Classes and Streamlined instantiation

Version 3 uses new class names:

`CashuWallet` is now `Wallet`
`CashuMint` is now `Mint`

A wallet can be instantiated by passing a `Mint` instance, as before, or simply by passing in a mintUrl.

You MUST now call the `loadMint()` method to complete wallet init.

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
import { isP2PKSpendAuthorised } from '@cashu/cashu-ts/crypto/mint/NUT11';
```

is now:

```ts
import { signP2PKProofs, isP2PKSpendAuthorised } from '@cashu/cashu-ts';
```

Some crypto types have been deduplicated to the main library types:

- `Proof` is now `RawProof`
- `MintKeys` is now `RawMintKeys`
- `Keyset` and `KeysetWithKeys` have been removed as unused

Function signature changes:

- `signP2PKProofs`: The optional beStrict param has been replaced with a logger.

```ts
// third (optional) param:
signP2PKProofs = (
	proofs: Proof[], privateKey: string | string[], beStrict = false
): Proof[]

// is now a logger:
signP2PKProofs = (
	proofs: Proof[], privateKey: string | string[], logger: Logger = NULL_LOGGER
): Proof[]
```

### New `OutputType` and `OutputConfig`

The output model for `send`, `receive`, `mintProofs`, and `meltProofs` has been simplified.

Instead of juggling `keepFactory`, `outputData`, and multiple option types, you now use:

- **`OutputType`** — a tagged union describing one output strategy (`random`, `deterministic`, `p2pk`, etc).
- **`OutputConfig`** — combines `keep` and `send` `OutputType`s when sending.

These are passed as the **FOURTH** parameter where needed, or expressed more naturally via the new `WalletOps` fluent builder API.

Example:

```ts
// before
const { keep, send } = await wallet.send(amount, proofs, {
	includeFees: true,
	pubkey: bytesToHex(pubKeyBob),
});

// after (using fluent builder)
const { keep, send } = await wallet.ops
	.send(amount, proofs)
	.asP2PK({ pubkey: bytesToHex(pubKeyBob) })
	.includeFees(true)
	.run();

// or using the forth param directly
const customConfig: OutputConfig = {
	send: { type: 'p2pk', options: { pubkey: bytesToHex(pubKeyBob) } },
	keep: { type: 'deterministic', counter: 0 }, // optional keep shaping
};
const { keep, send } = await wallet.send(
	amount,
	proofs,
	{ includeFees: true },
	customConfig, // forth param
);
```

The builder makes intent explicit and eliminates the need for extra boilerplate.

See the [README](./README.md) and [integration tests](./test/integration.test.ts) for more usage examples.

### OutputDataLike / OutputDataFactory

`OutputData` helpers only require `id` and `keys`, so `OutputDataLike` and `OutputDataFactory` now default to `HasKeysetKeys`, which just includes `id` and `keys`.

This may show up as a TypeScript error when assigning a factory that takes `MintKeys` to `OutputDataFactory` without a type argument.

If you want richer typing at the call site, use the new generics: `OutputDataLike<YourType>` and `OutputDataFactory<YourType>`.

For example, if your custom factory is typed to MintKeys, declare it as `OutputDataFactory<MintKeys>`.

```ts
// Factory typed to MintKeys
const customFactory: OutputDataFactory<MintKeys> = (amount, keyset) => {
	return OutputData.createRandomData(amount, keyset)[0];
};

// Factory typed to default (HasKeysetKeys: { id, keys })
const customFactory: OutputDataFactory = (amount, keysetKeys) => {
	return OutputData.createRandomData(amount, keysetKeys)[0];
};
```

### Logger

`LogLevel` is no longer exported as a `const` object with uppercase values.
It is now a simple string union of **lowercase** level names.

Fatal level has also been removed:

```ts
// New LogLevel shape (lowercase, no 'fatal' level)
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

// before
const logger = new ConsoleLogger(LogLevel.DEBUG);

// after
const logger = new ConsoleLogger('debug');
```

This change simplifies the API by removing the enum-like wrapper, avoids the need for extra imports, and makes configuration easier when log levels are provided from JSON or environment variables (which are typically lowercase).

Update any code that referenced LogLevel.XYZ to pass the lowercase string literal instead.

### Keyset methods delegated to KeyChain class

Wallet no longer manages keysets and keys itself. Instead, these are delegated to the KeyChain class, accessed via `wallet.keyChain`.

The following wallet methods are affected:

- `wallet.getKeys(id?)` -> `wallet.keyChain.getKeyset(id?)`
- `wallet.getActiveKeyset()` -> `wallet.keyChain.getCheapestKeyset()`
- `wallet.getKeySets()` -> `wallet.keyChain.getKeysets()`
- `wallet.getAllKeys()` -> `wallet.keyChain.getAllKeys()`

### on[Mint|Melt|Proof]\* events

Wallet no longer manages subscription events itself. Instead, these are delegated to the `WalletEvents` class, accessed via `wallet.on`.

The following wallet methods are affected:

- `wallet.onMintQuoteUpdates()` -> `wallet.on.mintQuoteUpdates()`
- `wallet.onMeltQuotePaid()` -> `wallet.on.meltQuotePaid()`
- `wallet.onMintQuotePaid()` -> `wallet.on.mintQuotePaid()`
- `wallet.onMeltQuoteUpdates()` -> `wallet.on.meltQuoteUpdates()`
- `wallet.onProofStateUpdates()` -> `wallet.on.proofStateUpdates()`

See the [README](./README.md) for full details of the `WalletEvents` API.

### Removed constants

The following constants are no longer available:

- `DEFAULT_DENOMINATION_TARGET`
- `DEFAULT_UNIT`
- `TOKEN_VERSION`
- `TOKEN_PREFIX`

### Method changes in `Mint`

**Static methods** The `Mint` class no longer has static methods. If you wish to call a mint method, simply instantiate a mint first, then call the instance method.

The following method names have changed:

- async createMintQuote -> createMintQuoteBolt11
- async checkMintQuote -> checkMintQuoteBolt11
- async createMeltQuote -> createMeltQuoteBolt11
- async checkMeltQuote -> checkMeltQuoteBolt11
- async melt -> meltBolt11

The second parameter (was `customRequest`) is now an options object in the following methods:

```ts
- async meltBolt11(
		meltPayload: MeltPayload,
		options?: {
			customRequest?: RequestFn;
			preferAsync?: boolean;
		}
	)
- async meltBolt12(
		meltPayload: MeltPayload,
		options?: {
			customRequest?: RequestFn;
			preferAsync?: boolean;
		}
	)
```

### Auth Changes

Clear and Blind authentication have been simplified and enhanced. Here are the highlights:

- Legacy `CashuAuthMint` / `CashuAuthWallet` have been removed.
- A new `AuthManager` provides "Batteries Included" CAT/BAT management.
- `createAuthWallet()` helper wires up a fully authenticated wallet session.
- `OIDCAuth` class handles the mechanics of OIDC authentication
- Mint replaces the `authTokenGetter` param with options, including an `authProvider`.

```ts
Before: new Mint(mintUrl, customRequest?, legacyAuthTokenGetter?)
After:  new Mint(mintUrl, options?: {customRequest?, authProvider?, logger?})
```

See the `examples/auth_mint/` folder for examples of using these in all supported flows.

---
