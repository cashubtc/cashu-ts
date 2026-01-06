[Documents](../index.html) › [Usage Examples](../usage/usage_index.md) › **Get Token**

# Get token data

```typescript
import { getDecodedToken } from '@cashu/cashu-ts';
try {
	const decodedToken = getDecodedToken(token);
	console.log(decodedToken); // { mint: "https://mint.0xchat.com", unit: "sat", proofs: [...] }
} catch (_) {
	console.log('Invalid token');
}
```
