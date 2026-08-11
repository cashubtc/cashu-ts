# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Inspect Mint Capabilities**

# Inspect mint capabilities

After `loadMint()`, the mint's `/v1/info` response is available through `wallet.getMintInfo()`, which exposes helpers for discovering what the mint supports — the methods you can mint and melt with, and which NUTs it advertises.

```ts
import { Wallet } from '@cashu/cashu-ts';

const wallet = new Wallet('http://localhost:3338');
await wallet.loadMint();

const info = wallet.getMintInfo();

// optional: persist the response for offline use later
// (see "Work offline from a stored response" below)
localStorage.setItem('mintInfo', JSON.stringify(info.cache));
```

Four helpers cover the common questions:

| I want to…                               | Use                                             | Returns                   |
| :--------------------------------------- | :---------------------------------------------- | :------------------------ |
| list the methods I can mint or melt with | `info.supportedMethods(op)`                     | `SwapMethod[]`            |
| check one method/unit pair               | `info.supportsMintMeltMethod(op, method, unit)` | `boolean`                 |
| read one pair's settings and limits      | `info.getMintMeltMethod(op, method, unit)`      | `SwapMethod \| undefined` |
| inspect raw support for any NUT          | `info.isSupported(num)`                         | varies by NUT             |

## List supported methods

`supportedMethods('mint' | 'melt')` returns the method-unit settings the mint advertises for that operation, or an empty array when the operation is **disabled** - so a non-empty result means the methods are usable.

```ts
const mintMethods = info.supportedMethods('mint');
// e.g. [{ method: 'bolt11', unit: 'sat', min_amount: null, max_amount: null }, ...]

for (const m of mintMethods) {
  console.log(`can mint ${m.unit} via ${m.method}`);
}

const meltMethods = info.supportedMethods('melt');
if (meltMethods.length === 0) {
  console.log('This mint cannot melt (no methods, or melting is disabled)');
}
```

Each entry is a `SwapMethod` carrying `method`, `unit`, and the optional `min_amount` / `max_amount` limits (`null` when the mint advertises no bound).

## Check a specific method and unit

When you already know the pair you want, `supportsMintMeltMethod` is a direct boolean check. It accounts for the disabled flag.

```ts
if (info.supportsMintMeltMethod('melt', 'bolt11', 'sat')) {
  // safe to prepare a bolt11 melt in sats
}
```

When you also need the amount limits, `getMintMeltMethod` returns the matched `SwapMethod`
directly (`undefined` means the pair is unsupported or the operation is disabled):

```ts
const melt = info.getMintMeltMethod('melt', 'bolt11', 'sat');
if (melt) {
  console.log('melt limits:', melt.min_amount, '-', melt.max_amount); // null = no bound
}
```

## Work offline from a stored response

`MintInfo` does not need a live connection: its constructor accepts any persisted
`GetInfoResponse`. Store `info.cache` while online (as in the first example above), and rehydrate
later to answer capability questions before (or without) contacting the mint.

```ts
import { MintInfo } from '@cashu/cashu-ts';

// e.g. when building the send screen at startup
const stored = JSON.parse(localStorage.getItem('mintInfo')!);
const offline = new MintInfo(stored);
offline.getMintMeltMethod('melt', 'bolt11', 'sat'); // no network round-trip
```

To seed a whole wallet from persisted data (mint info plus keysets) so it starts without any
network calls, use [`wallet.loadMintFromCache(storedInfo, keyChainCache)`](./create_wallet.md).

## Inspect raw NUT support

`isSupported(num)` reports the mint's advertised support for a given NUT.

For NUT-4 (mint) and NUT-5 (melt) it returns the `disabled` flag and the raw method list:

```ts
const melt = info.isSupported(5);
console.log('melt disabled?', melt.disabled);
console.log('advertised melt methods:', melt.params);
```

> `isSupported(4 | 5).params` returns the advertised methods **even when the operation is disabled**. Prefer `supportedMethods(op)` when you want only the methods you can actually use — it returns `[]` for a disabled operation.

For other NUTs it reports a boolean, and some include params:

```ts
info.isSupported(20); // { supported: boolean }           — locked mint quotes (NUT-20)
info.isSupported(15); // { supported: boolean; params? }  — MPP methods (NUT-15)
info.isSupported(19); // { supported: boolean; params? }  — cached endpoints (NUT-19)
```

See [NUT-19 Cached Responses](./nut19.md) for a worked example of the `isSupported(19)` shape.
