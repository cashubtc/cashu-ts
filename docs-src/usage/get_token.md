[Documents](../index.html) › [Usage Examples](../usage/usage_index.md) › **Get Token**

# Getting token data

## Pre-wallet: `getTokenMetadata`

Use `getTokenMetadata` to inspect a token string **before** creating a wallet — for example, to find out which mint and unit the token belongs to.

```typescript
import { getTokenMetadata } from '@cashu/cashu-ts';

try {
	const meta = getTokenMetadata(tokenString);
	console.log(meta.mint); // "https://mint.example.com"
	console.log(meta.unit); // "sat"
	console.log(meta.amount.toNumber()); // e.g. 64  (amount is Amount, not number)
} catch (_) {
	console.log('Invalid token');
}
```

`getTokenMetadata` never needs keyset data — it is always safe to call without a wallet.

## Post-wallet: `wallet.decodeToken`

Once you have a wallet loaded for the correct mint and unit, call `wallet.decodeToken` to get the fully hydrated `Token` with complete `Proof[]` (keyset IDs resolved):

```typescript
import { Wallet } from '@cashu/cashu-ts';

const meta = getTokenMetadata(tokenString);
const wallet = new Wallet(meta.mint, { unit: meta.unit });
await wallet.loadMint();

const token = wallet.decodeToken(tokenString);
// token.proofs — full Proof[] with resolved keyset IDs
// token.mint, token.unit, token.memo
```

## Advanced: `getDecodedToken`

`getDecodedToken(tokenString, keysetIds)` is for advanced flows where you manage your own keyset cache and want to decode outside a wallet instance. The second argument must be the full list of keyset IDs the token might reference:

```typescript
import { getDecodedToken } from '@cashu/cashu-ts';

// Only use this if you already have a keyset ID list:
const token = getDecodedToken(tokenString, myKeyChain.getAllKeysetIds());
```

> ⚠️ Do **not** pass `[]` as the second argument. It will throw if the token contains v2 short keyset IDs.
