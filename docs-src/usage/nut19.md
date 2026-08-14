# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **NUT-19 Cached Responses**

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
const states = await wallet.checkProofsStates([
  { id: '00bd033559de27d0', secret: 'my-proof-secret' },
]);

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

## Persist previews for replay-safe mint, melt and swap flows

NUT-19 helps with transport-level retries, but those retries only cover failures inside a
running process. Wallet apps should also persist previews for operations that create blinded
outputs: replaying a persisted preview after a restart posts an identical request body, which
hits the mint's cache and returns the original signatures. The window is bounded by the mint
advertising the endpoint in `cached_endpoints` and by its TTL.

### Mint

```ts
const mintQuote = await wallet.checkMintQuoteBolt11(quoteId);

const mintPreview = await wallet.prepareMint('bolt11', 64, mintQuote, undefined, {
  type: 'deterministic',
  counter: 0,
});

// Persist an app-defined snapshot here.
// Do not call JSON.stringify(mintPreview) directly; preview objects contain
// Amount, bigint, Uint8Array, and class instances that need explicit rehydration.
const proofs = await wallet.completeMint(mintPreview);
```

### Melt

A melt keeps a server-side handle (the quote), so the full preview does not need persisting:
quote state is recoverable from the mint, the inputs are your own proofs, and once the quote
pays, the NUT-08 change signatures ride on it. Persist the quote id plus the serialized change
blanks (the only client-side state you cannot rebuild), then reconstruct change with
`wallet.createMeltChangeProofs` once the quote is paid:

```ts
import { OutputData } from '@cashu/cashu-ts';

const meltPreview = await wallet.prepareMelt('bolt11', meltQuote, proofsToSend, {
  includeFees: true,
});

// Persist before completing.
const stored = JSON.stringify({
  quote: meltQuote.quote,
  blanks: meltPreview.outputData.map((o) => OutputData.serialize(o)),
});

const result = await wallet.completeMelt(meltPreview);
```

See [Melt § 4 (async melt change recovery)](../wallet_ops/melt.md) for the full
recover-after-restart lifecycle.

### Swap

```ts
import { deserializeSwapPreview, serializeSwapPreview } from '@cashu/cashu-ts';

const receivePreview = await wallet.prepareSwapToReceive(token);
const sendPreview = await wallet.prepareSwapToSend(21, proofs, { includeFees: true });

// Swap previews have a serialize helper: persist the JSON-safe form, then
// rehydrate it with deserializeSwapPreview to replay after a restart.
const stored = JSON.stringify(serializeSwapPreview(receivePreview));
const { keep } = await wallet.completeSwap(deserializeSwapPreview(JSON.parse(stored)));
```

`completeSwap` builds its request purely from the preview, so a replayed preview posts a
byte-identical `/v1/swap` body. See [Receive § 5](../wallet_ops/receive.md) and
[Send § 7](../wallet_ops/send.md) for the full serialize-and-rehydrate round trip.

Use the same pattern with `wallet.ops`:

```ts
const mintPreview = await wallet.ops.mintBolt11(64, quoteId).prepare();
const meltPreview = await wallet.ops.meltBolt11(meltQuote, proofsToSend).prepare();
const receivePreview = await wallet.ops.receive(token).prepare();
const sendPreview = await wallet.ops.send(21, myProofs).prepare();
```
