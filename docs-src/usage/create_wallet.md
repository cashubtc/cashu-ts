# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Create Wallet**

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

After `loadMint()`, use `wallet.getMintInfo()` to inspect what the mint supports — see [Inspect Mint Capabilities](./mint_capabilities.md).

> ⚠️ **Server-side usage:** If you construct a `Wallet` (or `Mint`) using a URL from untrusted input (e.g. a received token), validate the mint URL against your own trusted-mint allowlist **before** passing it in. The library validates URL structure but cannot know which mints your application trusts.

## Custom mint transport

Pass `requestFetch` when one wallet or mint needs a runtime-specific transport, for example OHTTP, Tor, a native mobile HTTP client, or an application proxy. This keeps the default cashu-ts request behavior for JSON parsing, timeouts, errors, and NUT-19 retries while replacing only the network primitive.

```typescript
import { Wallet, type RequestFetch } from '@cashu/cashu-ts';

const ohttpFetch: RequestFetch = async (input, init) => {
  return fetchThroughOhttp(input, init); // your OHTTP relay client
};

const wallet = new Wallet('http://localhost:3338', {
  unit: 'sat',
  requestFetch: ohttpFetch,
});
await wallet.loadMint();
```

Use `setGlobalRequestOptions({ fetch })` when your whole app uses the same mint transport policy.

Precedence depends on the option. Global values for fetch's own `RequestInit` (`cache`, `credentials`, `redirect` etc) are a process-wide transport policy and override the per-request value. Global values for library options (`requestTimeout`, `fetch`, `maxResponseBytes`, `idempotent`, NUT-19 policy) are defaults that a per-request value overrides. Global and per-request `headers` merge, with the per-request value winning per key. The exception is `redirect`, which is always `error` on a request carrying a NUT-21/22 auth header.

Use `customRequest` when you need to replace the entire request pipeline instead of only the fetch-compatible transport.

`requestFetch` only applies to Cashu mint HTTP requests. OIDC discovery and token requests use `oidc.fetch` because they target the identity provider and use OAuth/OIDC request and error semantics.

```typescript
import { createAuthWallet } from '@cashu/cashu-ts';

const { wallet, oidc } = await createAuthWallet('http://localhost:3338', {
  requestFetch: ohttpFetch,
  oidc: {
    fetch: ohttpFetch,
  },
});
```

## Auth state and application sessions

`createAuthWallet` connects one `AuthManager` and `OIDCAuth` to a mint and wallet. The manager owns the CAT record and BAT pool; your app owns account selection, login flow lifetime, and persistence. Keep separate managers and persisted BAT pools for separate application accounts.

Use the attached OIDC client for sign-in or call `oidc.refresh(savedRefreshToken)` to restore a session. Its listener installs the complete token state. `auth.setCAT(cat)` is manual replacement: it clears the previous refresh token and expiry. A provider refresh keeps the token used for that request if the response omits a replacement; a new sign-in does not inherit it. Attaching a different OIDC instance clears the CAT and refresh state; initial attachment and reattaching the same instance preserve them.

When ending an application session, cancel any device flow with its `cancel()` helper and clear the CAT with `auth.setCAT(undefined)`. Existing BATs remain available; use `auth.importPool([], 'replace')` if they should also be discarded. Clearing the CAT does not cancel an independently started sign-in.

`oidc.onTokens(tokens, origin)` observes provider responses (`origin` is `'signin'` or `'refresh'`), including refresh results the manager may decline after an account change. Persistence callbacks must follow your app's account lifetime; do not use them to call `setCAT` alongside the attached manager.

## Custom output generation

Pass `outputDataCreator` when you need to replace the default output generation logic, for
example to use a platform specific implementation for deterministic secrets.

`OutputDataCreator` is the injectable strategy interface used by `Wallet`. The canonical default
creation surface remains `OutputData.create*()`, so custom creators can delegate back to it for the standard random and P2PK behavior.

> [!CAUTION]
> The only officially supported and maintained `OutputDataCreator` is the default Noble Curves based
> implementation exposed by `OutputData.create*()`. Custom creators are an escape hatch for
> runtime-specific needs, but their compatibility and maintenance are the integrator's
> responsibility.

```typescript
import { OutputData, type OutputDataCreator, Wallet } from '@cashu/cashu-ts';

class CustomOutputDataCreator implements OutputDataCreator {
  createP2PKData(...args: Parameters<OutputDataCreator['createP2PKData']>) {
    const [p2pk, amount, keyset, customSplit] = args;
    return OutputData.createP2PKData(p2pk, amount, keyset, customSplit);
  }

  createSingleP2PKData(...args: Parameters<OutputDataCreator['createSingleP2PKData']>) {
    const [p2pk, amount, keysetId, eBytes] = args;
    // Forward eBytes as-is: a SIG_ALL batch relies on every output sharing this key.
    return OutputData.createSingleP2PKData(p2pk, amount, keysetId, eBytes);
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

The `hashToCurve` option is the same escape hatch for `Y = hash_to_curve(secret)`, used by
`checkProofsStates` and NUT-17 subscriptions. A restore scan hashes every counter it visits, and on
BLS keysets the pure JS hash dominates that cost, so a WASM or native implementation is worth
plugging in there. The keyset id selects the curve: v3 (`02...`) ids are BLS12-381 G1, all others
secp256k1. Hash the secret string as UTF-8 and return the compressed point as hex; `hashToCurveHex`
is the default and can serve the curve you are not replacing.

```typescript
const wallet = new Wallet('http://localhost:3338', {
  hashToCurve: (secret, keysetId) =>
    isBlsKeyset(keysetId)
      ? fastBlsHashToCurveHex(new TextEncoder().encode(secret))
      : hashToCurveHex(secret, keysetId),
});
```
