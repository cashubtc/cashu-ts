[Documents](../index.html) › [Usage Examples](../usage/usage_index.md) › **Get Token**

# Get token data

```typescript
import { getTokenMetadata } from '@cashu/cashu-ts';
try {
	const tokenMetadata = getTokenMetadata(token);
	console.log(tokenMetadata); // { mint: "https://mint.0xchat.com", unit: "sat", amount: 1n, ... }
} catch (_) {
	console.log('Invalid token');
}
```
