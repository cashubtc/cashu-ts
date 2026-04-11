[Documents](../index.html) › [Usage Examples](../usage/usage_index.md) › **Create Wallet**

# Create a wallet

There are a number of ways to instantiate a wallet, depending on your needs.

Wallet classes are mostly stateless, so you can instantiate and throw them away as needed. Your app must therefore manage state, such as fetching and storing proofs in a database.

NB: You must always call `loadMint()` or `loadMintFromCache` after instantiating a wallet.

```typescript
import { Wallet } from '@cashu/cashu-ts';

// Simplest: With a mint URL
const mintUrl = 'http://localhost:3338';
const wallet1 = new Wallet(mintUrl); // unit is 'sat'
await wallet1.loadMint(); // wallet is now ready to use

// Persist these in your app
const keychainCache = wallet1.keyChain.cache; // KeyChainCache
const mintInfoCache = wallet1.getMintInfo().cache; // GetInfoResponse

// Advanced: With cached mint data (avoids network calls on startup)
const wallet2 = new Wallet(keychainCache.mintUrl); // unit defaults to 'sat'
wallet2.loadMintFromCache(mintInfoCache, keychainCache);
// wallet2 is now ready to use
```

## Custom output generation

Pass `outputDataCreator` when you need to replace the default output generation logic, for
example to use a platform specific implementation for deterministic secrets.

`OutputDataCreator` is the injectable strategy interface used by `Wallet`. The supported default
creation surface remains `OutputData.create*()`, so custom creators can delegate back to it for the standard random and P2PK behavior.

```typescript
import { OutputData, type OutputDataCreator, Wallet } from '@cashu/cashu-ts';

class CustomOutputDataCreator implements OutputDataCreator {
  createP2PKData(...args: Parameters<OutputDataCreator['createP2PKData']>) {
    const [p2pk, amount, keyset, customSplit] = args;
    return OutputData.createP2PKData(p2pk, amount, keyset, customSplit);
  }

  createSingleP2PKData(...args: Parameters<OutputDataCreator['createSingleP2PKData']>) {
    const [p2pk, amount, keysetId] = args;
    return OutputData.createSingleP2PKData(p2pk, amount, keysetId);
  }

  createRandomData(...args: Parameters<OutputDataCreator['createRandomData']>) {
    const [amount, keyset, customSplit] = args;
    return OutputData.createRandomData(amount, keyset, customSplit);
  }

  createSingleRandomData(...args: Parameters<OutputDataCreator['createSingleRandomData']>) {
    const [amount, keysetId] = args;
    return OutputData.createSingleRandomData(amount, keysetId);
  }

  createDeterministicData(...args: Parameters<OutputDataCreator['createDeterministicData']>) {
    const [amount, seed, counter, keyset, customSplit] = args;
    // Replace this with your runtime-specific implementation.
    return OutputData.createDeterministicData(amount, seed, counter, keyset, customSplit);
  }

  createSingleDeterministicData(
    ...args: Parameters<OutputDataCreator['createSingleDeterministicData']>
  ) {
    const [amount, seed, counter, keysetId] = args;
    // Replace this with your runtime-specific implementation.
    return OutputData.createSingleDeterministicData(amount, seed, counter, keysetId);
  }
}

const wallet = new Wallet('http://localhost:3338', {
  outputDataCreator: new CustomOutputDataCreator(),
});
await wallet.loadMint();
```
