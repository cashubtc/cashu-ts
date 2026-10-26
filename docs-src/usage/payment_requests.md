# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Payment Requests**

# Payment Requests (NUT-18 / NUT-26)

A **payment request** lets a payee describe a payment they want to be paid, encode it (as a string or QR), and hand it to a payer. The payer decodes it, builds a matching token, and delivers it over the transport the request specifies.

Two encodings are supported and both decode through the same API:

- `creqA…`: CBOR + base64url ([NUT-18][nut18])
- `CREQB1…`: TLV + Bech32m, QR-friendly ([NUT-26][nut26])

The shortest path is three calls: `decodePaymentRequest` → `wallet.ops.sendToRequest` on the payer side, and `wallet.isPaymentRequestSatisfied` on the payee side. Everything else on this page is request authoring, or [manual control](#manual-control) for when you need to apply the rules yourself.

## Paying a request (payer side)

### 1. Decode it

```typescript
import { decodePaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';

const pr = decodePaymentRequest(scanned); // accepts creqA… or CREQB1…

pr.amount; // requested Amount (undefined = payer chooses the amount)
pr.unit; // e.g. 'sat'
pr.description; // human-readable, show to the user
pr.mints; // mints the payee accepts (string[] | undefined)
pr.getTransport(PaymentRequestTransportType.NOSTR); // the transport of a given type, if present
```

### 2. Pay it

`wallet.ops.sendToRequest` builds a send that enforces the request's payer-side rules in one step: the strict/preferred mint list, the unit rule, NUT-05 melt-method support (resolved from the wallet's `MintInfo`), the applicable per-method fee (`mf`), the request's lock, and net-of-input-fees selection. It throws if this wallet's mint cannot fulfil the request.

```typescript
const { keep, send } = await wallet.ops.sendToRequest(pr, proofs).run();

// Amountless request: pass the chosen amount instead.
const result = await wallet.ops.sendToRequest(pr, proofs, 100).run();
```

It returns the normal send builder, so further options (deterministic keep outputs, keyset, offline modes) chain as usual. The request's own terms are fixed: chaining cannot replace its lock or turn off `includeFees`.

### 3. Deliver the payload

`encodePayload` packages the proofs into the default NUT-18 `PaymentRequestPayload`, serialized as JSON with proof amounts as numbers, ready for the wire. Don't use plain `JSON.stringify`: it writes each `Amount` as a quoted string, which `decodePayload` tolerates but other NUT-18 payees may reject. It fills `id` and `unit` from the request and rejects a mint outside the request's strict mint list:

```typescript
const { keep, send } = await wallet.ops.sendToRequest(pr, proofs).run();
const body = pr.encodePayload(wallet.mint.mintUrl, send, { memo: 'thanks' });

// HTTP POST transport; for a Nostr transport, send `body` as the DM content.
const post = pr.getTransport(PaymentRequestTransportType.POST);
if (!post) throw new Error('request has no HTTP POST transport');
await fetch(post.target, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
});
```

> [!IMPORTANT]
> The payee validates the incoming proofs themselves (DLEQ, and that any timelock is long enough) before accepting. Building a payload does not settle the payment.

## Requesting payment (payee side)

### Create and encode a request

The `PaymentRequest` constructor is positional; pass `undefined` for the slots you skip. `amount` and each method `fee` accept any `AmountLike` (number, bigint, string, or `Amount`).

```typescript
import { PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';

const request = new PaymentRequest(
  [{ type: PaymentRequestTransportType.POST, target: 'https://pay.example.com' }], // transport
  'inv-123', // id
  100, // amount
  'sat', // unit (required by NUT-18 with an amount or supported methods)
  ['https://my.mint'], // mints
  'Coffee', // description
  false, // singleUse
  undefined, // nut10 lock, eg { kind: 'P2PK', data: payeePubkey }
  true, // mintsPreferred: the mint list is advisory
  [{ method: 'bolt11' }, { method: 'bolt12', fee: 5 }], // supported methods, with a per-method fee
);

request.toEncodedCreqA(); // 'creqA…'  (CBOR)
request.toEncodedCreqB(); // 'CREQB1…' (TLV + Bech32m, best for QR)
```

### Receive the payload

Payloads arrive as raw text from the payer's wallet, so parse with `decodePayload` rather than `JSON.parse` (which silently corrupts amounts above 2^53). It validates the shape and normalizes proof amounts to `Amount`, so the returned proofs are ready to use; matching the payload to your request is your job:

```typescript
import { PaymentRequest, type PaymentRequestPayload } from '@cashu/cashu-ts';

let payload: PaymentRequestPayload;
try {
  payload = PaymentRequest.decodePayload(body); // POST body or Nostr DM content
} catch {
  return; // malformed: ignore or 400
}

if (payload.id !== request.id) return; // not for this request
// Accept only mints you chose: with a mint list on the request that is
// `request.includesMint(payload.mint)`; without one, check against your own
// accepted set. Never dial an unknown mint URL taken from a payload.
if (!request.includesMint(payload.mint)) return;
```

### Validate a payment

The requested amount is what the payee must **net**, so check incoming proofs against the input fees they will cost to swap, plus any per-method fee the payer owed, before treating the payment as settled. A wallet on the payload's mint has everything needed:

```typescript
try {
  if (!wallet.isPaymentRequestSatisfied(request, payload.proofs)) {
    // Underpaid: sum(proofs) - inputFees < amount + mf. Ignore or refund.
  }
} catch {
  // This mint cannot settle the request (wrong unit, outside a strict mint
  // list, or no melt method the request accepts), a proof does not carry the
  // requested lock, or you cannot spend it. Ignore or refund.
}
```

For an amountless request, pass the amount you expected as the third argument.

A locked request is checked exactly: each proof must carry the `nut10` condition you asked for, so a proof with an extra refund path fails. An unlocked request takes only proofs you can spend, so proofs the payer locked to themselves fail too. Proofs locked to your own key still count once you pass it:

```typescript
wallet.isPaymentRequestSatisfied(request, payload.proofs, undefined, { privkeys: myPrivkey });
```

Proof integrity (DLEQ) remains a separate check.

## Manual control

`sendToRequest` and `isPaymentRequestSatisfied` apply every rule for you. To apply them piecemeal (custom selection, or inspecting a request before paying), the pieces are on `PaymentRequest`: `isMintListStrict` and `includesMint(url)` for the mint list, and `feesFor(mint, meltMethods)` and `amountToSend(mint, meltMethods)` for the per-method fee. Select with `includeFees(true)` so the payee nets the amount after input fees.

[nut18]: https://github.com/cashubtc/nuts/blob/main/18.md
[nut26]: https://github.com/cashubtc/nuts/blob/main/26.md
