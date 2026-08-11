# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Payment Requests**

# Payment Requests (NUT-18 / NUT-26)

A **payment request** lets a payee describe a payment they want to be paid, encode it (as a string or QR), and hand it to a payer. The payer decodes it, builds a matching token, and delivers it over the transport the request specifies.

Two encodings are supported and both decode through the same API:

- `creqA…`: CBOR + base64url ([NUT-18][nut18])
- `CREQB1…`: TLV + Bech32m, more compact and QR-friendly ([NUT-26][nut26])

The shortest path is three calls: `decodePaymentRequest` → `wallet.ops.sendToRequest` on the payer side, and `wallet.isPaymentRequestSatisfied` on the payee side. Everything else on this page is either request authoring or [manual control](#manual-control) for when you need to unpack the rules yourself.

## Paying a request (payer side)

### 1. Decode it

```typescript
import { decodePaymentRequest } from '@cashu/cashu-ts';

const pr = decodePaymentRequest(scanned); // accepts creqA… or CREQB1…

pr.amount; // requested Amount (undefined = payer chooses the amount)
pr.unit; // e.g. 'sat'
pr.description; // human-readable, show to the user
pr.mints; // mints the payee accepts (string[] | undefined)
pr.getTransport('nostr'); // the transport of a given type, if present
```

### 2. Pay it

`wallet.ops.sendToRequest` builds a send that enforces the request's payer-side rules in one step: the strict/preferred mint list, the unit rule, NUT-05 melt-method support (resolved from the wallet's `MintInfo`), the applicable per-method fee (`mf`), the request's lock, and net-of-input-fees selection. It throws if this wallet's mint cannot fulfil the request.

```typescript
const { keep, send } = await wallet.ops.sendToRequest(pr, proofs).run();

// Amountless request: pass the chosen amount instead.
const result = await wallet.ops.sendToRequest(pr, proofs, 100).run();
```

It returns the normal send builder, so further options (deterministic outputs, keyset, offline modes) chain as usual. [Manual control](#manual-control) below unpacks the individual rules.

### 3. Deliver the payload

`encodePayload` packages the proofs into the default NUT-18 `PaymentRequestPayload`, serialized as bigint-safe JSON ready for the wire (plain `JSON.stringify` throws on proof amounts). It fills `id` and `unit` from the request and rejects a mint outside the request's strict mint list:

```typescript
const { keep, send } = await wallet.ops.sendToRequest(pr, proofs).run();
const body = pr.encodePayload(wallet.mint.mintUrl, send, { memo: 'thanks' });

// HTTP POST transport; for a Nostr transport, send `body` as the DM content.
const post = pr.getTransport('post');
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

`PaymentRequest.builder()` handles the fiddly parts for you: transport tag formats, NUT-10 lock serialization, mint URL normalization, and cross-field validation. Setters can be called in any order; `build()` validates (eg `mintsPreferred` without mints throws) and returns the `PaymentRequest`.

```typescript
import { PaymentRequest, P2PKBuilder } from '@cashu/cashu-ts';

const request = PaymentRequest.builder()
  .id('inv-123')
  .amount(100, 'sat') // unit is required with amount (NUT-18)
  .description('Coffee')
  .addMint('https://my.mint')
  .mintsPreferred() // advisory list
  .addNostrTransport(nprofile) // NIP-17 tags applied for you
  .addHttpPostTransport('https://pay.example.com')
  .addSupportedMethod('bolt11')
  .addSupportedMethod('bolt12', 5) // with a per-method fee
  .lock(new P2PKBuilder().addLockPubkey(payeePk).toOptions()) // nut10 from a P2PK/HTLC lock
  .build();

request.toEncodedCreqA(); // 'creqA…'  (CBOR)
request.toEncodedCreqB(); // 'CREQB1…' (TLV + Bech32m, best for QR)
```

`lock()` takes a complete `P2PKOptions` (eg from `P2PKBuilder`, as with `asP2PK()`) and serializes it into the request's `nut10` option (the exact condition `toP2PKOptions()` reconstructs on the payer side). For NUT-10 kinds beyond P2PK/HTLC, pass a raw option with `nut10()`.

Alternatively, the `PaymentRequest` constructor takes an options object whose keys mirror the class properties; set only what you need. `amount` and each method `fee` accept any `AmountLike` (number, bigint, string, or `Amount`).

```typescript
import { PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';

const request = new PaymentRequest({
  transport: [{ type: PaymentRequestTransportType.POST, target: 'https://pay.example.com' }],
  id: 'inv-123',
  amount: 100,
  unit: 'sat',
  mints: ['https://my.mint'],
  description: 'Coffee',
  mintsPreferred: true, // advisory list
  supportedMethods: [{ method: 'bolt11' }, { method: 'bolt12', fee: 5 }],
});
```

### Receive the payload

Payloads arrive as raw text from the payer's wallet, so parse with `decodePayload` rather than `JSON.parse` (which silently corrupts amounts above 2^53). It validates the shape and normalizes proof amounts to `bigint`; matching the payload to your request is your job:

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
if (!wallet.isPaymentRequestSatisfied(pr, payload.proofs)) {
  // Underpaid: sum(proofs) - inputFees < amount + mf. Ignore or refund.
}
```

For an amountless request, pass the amount you expected as the third argument. The check covers the amount only; mint admissibility (`isMintListStrict` / `includesMint`) and proof integrity (DLEQ, locks) remain separate checks.

## Manual control

Everything in this section is enforced for you by `sendToRequest`; skip it unless you need to apply the NUT-18 rules piecemeal (custom selection, offline flows, or inspecting a request before paying).

### Which mint may I pay from?

A request may carry a mint list that is either **strict** (send only from these mints) or **preferred** (prefer these, but others are allowed). `isMintListStrict` resolves the NUT-18 default-to-strict semantic so you do not have to:

```typescript
// undefined = no list (any mint); true = strict; false = preferred/advisory
const allowed = !pr.isMintListStrict || pr.includesMint(myMint); // URL-normalized membership
```

If `supportedMethods` (`sm`) is set, the sending mint must be able to **melt the request's `unit`** via at least one of those methods (`bolt11`, `bolt12`, `onchain`, etc): the check is against the mint's NUT-05 melt methods for that unit, not its NUT-04 mint methods. Checking that requires the sending mint's capabilities. See [Inspect Mint Capabilities](./mint_capabilities.md).

### How much do I send, including fees?

Each supported method can carry a fee (`mf`) that compensates the payee for melting out via it. The fee applies only when paying from a mint outside the request's mint list (or from any mint if no list is set); a payment from a listed mint carries none. When one applies, the payer owes the **lowest** `mf` among the listed methods their mint supports. `amountToSend` computes the total for you: pass the melt methods your mint supports as the second argument.

`amountToSend` returns an `Amount`, so it flows straight into `wallet.ops.send` (which accepts any `AmountLike`). Convert only at the edge, for display or serialization.

```typescript
// list = [in-list.mint], bolt11 carries no fee, bolt12 carries mf=5
pr.amountToSend('https://in-list.mint', ['bolt12']); // listed mint, no fee  → 100
pr.amountToSend('https://other.mint', ['bolt11', 'bolt12']); // lowest = 0   → 100
pr.amountToSend('https://other.mint', ['bolt12']); // + mf                   → 105

const total = pr.amountToSend(myMint, myMeltMethods);
await wallet.ops.send(total, proofs).run(); // Amount passed straight through
```

`amountToSend` only prices the fee that applies; it does not reject a mint or method that is not allowed (that is the caller's decision, see above). It throws if the request has no amount, or no unit: NUT-18 requires `unit` whenever `amount` or `supportedMethods` is set (`mf` is denominated in the request unit), so encoding or pricing such a request fails, while plain decoding stays lenient for inspection.

For an **amountless** request (the payer chooses the amount), use `feesFor` to price the surcharge alone and add it to the chosen amount:

```typescript
const total = chosenAmount.add(pr.feesFor(myMint, ['bolt12'])); // mf, or 0 if none applies
```

The requested amount is **net of input fees** (NUT-18): the payee must be able to swap or melt the proofs without dipping below it. Select proofs with fees included:

```typescript
await wallet.ops.send(total, proofs).includeFees(true).run(); // payer covers the payee's input fee
```

### Locked requests

A request may require the token be locked to a spending condition (P2PK / HTLC). `toP2PKOptions()` converts that condition into the options accepted by the P2PK builder, so you can produce proofs locked exactly as the payee asked:

```typescript
const opts = pr.toP2PKOptions(); // undefined = no lockable nut10 condition
const builder = wallet.ops.send(pr.amountToSend(myMint), proofs);
// Lock only when the request asks for it; otherwise send unlocked.
if (opts) builder.asP2PK(opts);
const { keep, send } = await builder.run();
```

See [Create P2PK](./create_p2pk.md) for the builder.

[nut18]: https://github.com/cashubtc/nuts/blob/main/18.md
[nut26]: https://github.com/cashubtc/nuts/blob/main/26.md
