[Documents](../index.html) › [Usage Examples](../usage/usage_index.md) › **NUT-19 Cached Responses**

# NUT-19 Cached Responses

Cashu-TS reads NUT-19 support from the mint's `/v1/info` response and automatically retries requests to cached endpoints when the mint advertises them.

## What retries automatically

- Only endpoints listed in `wallet.getMintInfo().isSupported(19).params.cached_endpoints`
- Only retryable failures:
  - network errors
  - timed out requests
  - HTTP `5xx` responses
- `4xx` responses are returned immediately

The mint advertises `ttl` in seconds. Cashu-TS converts it to milliseconds in the public API.

## Inspect the mint policy

```ts
import { Wallet } from '@cashu/cashu-ts';

const wallet = new Wallet('http://localhost:3338');
await wallet.loadMint();

const nut19 = wallet.getMintInfo().isSupported(19);
if (!nut19.supported) {
	console.log('This mint does not advertise NUT-19 cached endpoints');
} else {
	console.log('TTL (ms):', nut19.params.ttl);
	console.log('Cached endpoints:', nut19.params.cached_endpoints);
}
```

## Set a per-request timeout for retryable endpoints

```ts
import { Wallet, setGlobalRequestOptions } from '@cashu/cashu-ts';

setGlobalRequestOptions({
	requestTimeout: 5_000,
});

const wallet = new Wallet('http://localhost:3338');
await wallet.loadMint();

// If the mint advertises this endpoint in NUT-19, timed out attempts are retried
// until the NUT-19 TTL window is exhausted.
const states = await wallet.checkProofsStates([{ secret: 'my-proof-secret' }]);

// Reset if you only wanted this policy temporarily.
setGlobalRequestOptions({});
```

## Caller aborts vs timeout retries

Use `requestTimeout` for app-wide timeout policy. Use `AbortController` only when you want to
cancel one specific low-level request.

- `requestTimeout` turns a hung request into a retryable network error on NUT-19 cached endpoints
- `signal.abort()` is treated as a caller cancel and stops retries immediately

```ts
import { Wallet, setGlobalRequestOptions } from '@cashu/cashu-ts';

const ac = new AbortController();

setGlobalRequestOptions({
	signal: ac.signal,
});

const wallet = new Wallet('http://localhost:3338');
await wallet.loadMint();

try {
	const pending = wallet.checkProofsStates([{ secret: 'my-proof-secret' }]);

	cancelButton.onclick = () => {
		ac.abort();
	};

	await pending;
} finally {
	setGlobalRequestOptions({});
}
```

If the controller aborts, the request fails immediately instead of being retried.

## Persist previews for replay-safe mint and melt flows

NUT-19 helps with transport-level retries, but wallet apps should still persist previews for
operations that create blinded outputs.

### Mint

```ts
const mintPreview = await wallet.prepareMint('bolt11', 64, quoteId, undefined, {
	type: 'deterministic',
	counter: 0,
});

await saveMintPreview(mintPreview); // your save function
const proofs = await wallet.completeMint(mintPreview);
```

### Melt

```ts
const meltPreview = await wallet.prepareMelt('bolt11', meltQuote, proofsToSend, {
	includeFees: true,
});

await saveMeltPreview(meltPreview); // your save function
const result = await wallet.completeMelt(meltPreview);
```

Use the same pattern with `wallet.ops`:

```ts
const mintPreview = await wallet.ops.mintBolt11(64, quoteId).prepare();
const meltPreview = await wallet.ops.meltBolt11(meltQuote, proofsToSend).prepare();
```
