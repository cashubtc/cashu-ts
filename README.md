# Cashu TS

![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/cashubtc/cashu-ts/node.js.yml)
![GitHub issues](https://img.shields.io/github/issues/cashubtc/cashu-ts)
![GitHub package.json version](https://img.shields.io/github/package-json/v/cashubtc/cashu-ts)
![npm](https://img.shields.io/npm/v/@cashu/cashu-ts)
![npm type definitions](https://img.shields.io/npm/types/@cashu/cashu-ts)
![npm bundle size](https://img.shields.io/bundlephobia/min/@cashu/cashu-ts)
[code coverage](https://cashubtc.github.io/cashu-ts/coverage)

⚠️ **Don't be reckless:** This project is in early development, it does however work with real sats! Always use amounts you don't mind losing.

Cashu TS is a JavaScript library for [Cashu](https://github.com/cashubtc) wallets written in TypeScript.

Wallet Features:

- [x] connect to mint (load keys)
- [x] request minting tokens
- [x] minting tokens
- [x] sending tokens (get encoded token for chosen value)
- [x] receiving tokens
- [x] melting tokens
- [x] check if tokens are spent
- [x] payment methods: bolt11, bolt12
- [x] transaction builder (WalletOps)
- [x] deterministic counters (with callbacks for persistence)
- [x] wallet event subscriptions (WalletEvents)
- [ ] ...

Implemented [NUTs](https://github.com/cashubtc/nuts/):

- [x] [NUT-00](https://github.com/cashubtc/nuts/blob/main/00.md)
- [x] [NUT-01](https://github.com/cashubtc/nuts/blob/main/01.md)
- [x] [NUT-02](https://github.com/cashubtc/nuts/blob/main/02.md)
- [x] [NUT-03](https://github.com/cashubtc/nuts/blob/main/03.md)
- [x] [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md)
- [x] [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
- [x] [NUT-06](https://github.com/cashubtc/nuts/blob/main/06.md)
- [x] [NUT-07](https://github.com/cashubtc/nuts/blob/main/07.md)
- [x] [NUT-08](https://github.com/cashubtc/nuts/blob/main/08.md)
- [x] [NUT-09](https://github.com/cashubtc/nuts/blob/main/09.md)
- [x] [NUT-11](https://github.com/cashubtc/nuts/blob/main/11.md)
- [x] [NUT-18](https://github.com/cashubtc/nuts/blob/main/18.md)
- [x] [NUT-23](https://github.com/cashubtc/nuts/blob/main/23.md)
- [x] [NUT-25](https://github.com/cashubtc/nuts/blob/main/25.md)

Supported token formats:

- [ ] v1 obsolete
- [ ] v2 obsolete
- [x] v3 (cashuA) read/write (deprecated)
- [x] v4 (cashuB) read/write

## Usage

Go to the [docs](https://cashubtc.github.io/cashu-ts/docs/main) for detailed usage, or have a look at the [integration tests](./test/integration.test.ts) for examples on how to implement a wallet.

### Install

```shell
npm i @cashu/cashu-ts
```

### Create a wallet

There are a number of ways to instantiate a wallet, depending on your needs.

Wallet classes are mostly stateless, so you can instantiate and throw them away as needed. Your app must therefore manage state, such as fetching and storing proofs in a database.

NB: You must always call `loadMint()` after instantiating a wallet.

```typescript
import { Wallet } from '@cashu/cashu-ts';

// Simplest: With a mint URL
const mintUrl = 'http://localhost:3338';
const wallet1 = new Wallet(mintUrl); // unit is 'sat'
await wallet1.loadMint(); // wallet is now ready to use
const cache = wallet1.keyChain.getCache(); // persist mint data in your app

// Advanced: With cached mint data (reduces API calls)
const wallet2 = new Wallet(cache.mintUrl, {
	unit: cache.unit,
	keysets: cache.keysets,
	keys: cache.keys,
});
await wallet2.loadMint(); // wallet2 is now ready to use
```

### Logging

By default, cashu-ts does not log to the console. If you want to enable logging for debugging purposes, you can set the `logger` option when creating a wallet or mint. A `ConsoleLogger` is provided, or you can wrap your existing logger to conform to the `Logger` interface:

```typescript
import { Mint, Wallet, ConsoleLogger, LogLevel } from '@cashu/cashu-ts';
const mintUrl = 'http://localhost:3338';
const mintLogger = new ConsoleLogger('error');
const mint = new Mint(mintUrl, undefined, { logger: mintLogger }); // Enable logging for the mint
const walletLogger = new ConsoleLogger('debug');
const wallet = new Wallet(mint, { logger: walletLogger }); // Enable logging for the wallet
await wallet.loadMint(); // wallet with logging is now ready to use
```

### Examples

#### Mint tokens

```typescript
import { Wallet, MintQuoteState } from '@cashu/cashu-ts';
const mintUrl = 'http://localhost:3338';
const wallet = new Wallet(mintUrl);
await wallet.loadMint(); // wallet is now ready to use

const mintQuote = await wallet.createMintQuote(64);
// pay the invoice here before you continue...
const mintQuoteChecked = await wallet.checkMintQuote(mintQuote.quote);
if (mintQuoteChecked.state === MintQuoteState.PAID) {
	const proofs = await wallet.mintProofs(64, mintQuote.quote);
}
// store proofs in your app ..
```

#### Melt tokens

```typescript
import { Wallet } from '@cashu/cashu-ts';
const mintUrl = 'http://localhost:3338';
const wallet = new Wallet(mintUrl);
await wallet.loadMint(); // wallet is now ready to use

const invoice = 'lnbc......'; // Lightning invoice to pay
const meltQuote = await wallet.createMeltQuote(invoice);
const amountToSend = meltQuote.amount + meltQuote.fee_reserve;

// Wallet.send performs coin selection and swaps the proofs with the mint
// if no appropriate amount can be selected offline. When selecting coins for a
// melt, we must include the mint and/or lightning fees to ensure there are
// sufficient funds to cover the invoice.
const { keep: proofsToKeep, send: proofsToSend } = await wallet.send(amountToSend, proofs, {
	includeFees: true,
});
const meltResponse = await wallet.meltProofs(meltQuote, proofsToSend);
// store proofsToKeep and meltResponse.change in your app ..
```

#### Create a token and receive it

```typescript
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
// we assume that `wallet` already minted `proofs`, as above
// or you fetched existing proofs from your app database
const proofs = [...]; // array of proofs
const { keep, send } = await wallet.send(32, proofs);
const token = getEncodedTokenV4({ mint: mintUrl, proofs: send });
console.log(token);

const wallet2 = new Wallet(mintUrl); // receiving wallet
await wallet2.loadMint(); // wallet2 is now ready to use
const receiveProofs = await wallet2.receive(token);
// store receiveProofs in your app ..
```

#### Create a P2PK locked token and receive it

```typescript
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
// we assume that `wallet` already minted `proofs`, as above
// or you fetched existing proofs from your app database
const proofs = [...]; // array of proofs
const pubkey = '02...'; // Your public key
const { keep, send } = await wallet.ops.send(32, proofs).asP2PK({pubkey}).run();
const token = getEncodedTokenV4({ mint: mintUrl, proofs: send });
console.log(token);

const wallet2 = new Wallet(mintUrl); // receiving wallet
await wallet2.loadMint(); // wallet2 is now ready to use
const privkey = '5d...'; // private key for pubkey
const receiveProofs = await wallet2.receive(token, {privkey});
// store receiveProofs in your app ..
```

#### Get token data

```typescript
import { getDecodedToken } from '@cashu/cashu-ts';
try {
	const decodedToken = getDecodedToken(token);
	console.log(decodedToken); // { mint: "https://mint.0xchat.com", unit: "sat", proofs: [...] }
} catch (_) {
	console.log('Invalid token');
}
```

#### BOLT12 (Reusable Offers)

BOLT12 enables reusable Lightning offers that can be paid multiple times, unlike BOLT11 invoices which are single-use. Key differences:

- **Reusable**: Same offer can receive multiple payments
- **Amount flexibility**: Offers can be amountless (payer chooses amount)

```typescript
// Create reusable BOLT12 offer
const bolt12Quote = await wallet.createMintQuoteBolt12(bytesToHex(pubkey), {
	amount: 1000, // Optional: omit to create an amountless offer
	description: 'My reusable offer', // The mint must signal in their settings that offers with a description are supported
});

// Pay a BOLT12 offer
const meltQuote = await wallet.createMeltQuoteBolt12(offer, 1000000); // amount in msat
const { keep, send } = await wallet.send(meltQuote.amount + meltQuote.fee_reserve, proofs);
const { change } = await wallet.meltProofsBolt12(meltQuote, send);

// Mint from accumulated BOLT12 payments
const updatedQuote = await wallet.checkMintQuoteBolt12(bolt12Quote.quote);
const availableAmount = updatedQuote.amount_paid - updatedQuote.amount_issued;
if (availableAmount > 0) {
	const newProofs = await wallet.mintProofsBolt12(
		availableAmount,
		updatedQuote,
		bytesToHex(privateKey),
	);
}
```

## WalletOps – Transaction Builder Usage Recipes

Cashu-TS offers a flexible `WalletOps` builder that makes it simple to construct transactions in a readable and intuitive way.

You can access `WalletOps` from inside a wallet instance using: `wallet.ops` or instantiate your own `WalletOps` instance.

> Fluent, single-use builders for **send**, **receive**, **mint** and **melt**.
> If you don’t customize an output side, the wallet’s policy defaults apply.

---

### Send

#### 1) Smallest possible send (policy defaults)

```ts
const { keep, send } = await wallet.ops.send(5, myProofs).run();
```

- Uses wallet policy for both `send` and `keep`.
- If you only customize **send**, `keep` is omitted so the wallet may still attempt an **offline exact match** where possible. This avoids mint fees.

#### 2) Deterministic send, random change

```ts
const { keep, send } = await wallet.ops
	.send(15, myProofs)
	.asDeterministic(0, [4, 4]) // counter=0 => auto-reserve; split must include 2x 4's
	.keepAsRandom() // change proofs must have random secrets
	.run();
```

> **Note**
> Passing `counter=0` means "reserve counters automatically" using wallet CounterSource.

#### 3) P2PK send with sender-pays fees

```ts
const { keep, send } = await wallet.ops
	.send(10, myProofs)
	.asP2PK({ pubkey, locktime: 1712345678 })
	.includeFees(true) // sender covers receiver’s future spend fee
	.run();
```

#### 4) Use a factory for custom OutputData

```ts
const { keep, send } = await wallet.ops
	.send(20, myProofs)
	.asFactory(makeOutputData, [4, 8, 8]) // makeOutputData: OutputDataFactory
	.keepAsDeterministic() // deterministic change, auto-reserve
	.keyset('0123456')
	.onCountersReserved((info) => {
		console.log('Reserved counters', info);
	})
	.run();
```

#### 5) Fully custom OutputData (prebuilt)

```ts
const mySendData: OutputData[] = [
	/* amounts must sum to 15 */
];

const { keep, send } = await wallet.ops.send(15, myProofs).asCustom(mySendData).run();
```

#### 6) Force pure offline (no mint calls)

**Exact match only (throws on no exact match):**

```ts
const { keep, send } = await wallet.ops
	.send(7, myProofs)
	.offlineExactOnly(/* requireDleq? */ false)
	.includeFees(true) // optional; applied to the offline selection rules
	.run();
```

**Close match allowed (overspend permitted by wallet RGLI):**

```ts
const { keep, send } = await wallet.ops
	.send(7, myProofs)
	.offlineCloseMatch(/* requireDleq? */ true) // only proofs with valid DLEQ
	.run();
```

> **Important**
> Offline modes **cannot** be combined with custom output types (`asXXXX/keepAsXXXX`).
> The builder will throw:
> `Offline selection cannot be combined with custom output types. Remove send/keep output configuration, or use an online swap.`

---

### Receive

#### 1) Default receive

```ts
const proofs = await wallet.ops.receive(token).run();
```

#### 2) Deterministic receive with DLEQ requirement

```ts
const proofs = await wallet.ops
	.receive(token)
	.asDeterministic() // counter=0 => auto-reserve
	.requireDleq(true) // reject incoming proofs without DLEQ for the selected keyset
	.keyset('0123456')
	.onCountersReserved((c) => console.log('RX counters', c))
	.run();
```

#### 3) P2PK locked receive (multisig)

```ts
const proofs = await wallet.ops
	.receive(token)
	.asP2PK({ pubkey, locktime }) // NUT-11 options for new proofs
	.privkey(['k1', 'k2', 'k3']) // sign incoming P2PK proofs
	.proofsWeHave(myExistingProofs) // helps denomination selection
	.run();
```

#### 4) Receive with factory/custom splits

```ts
const proofsA = await wallet.ops
	.receive(tokenA)
	.asFactory(makeOutputData, [8, 4, 16]) // split must include these denoms
	.run();

const proofsB = await wallet.ops
	.receive(tokenB)
	.asCustom(prebuiltRxOutputs) // amounts must sum to final received amount after fees
	.run();
```

---

### Mint

#### 1) Default mint (policy outputs)

```ts
const newProofs = await wallet.ops
	.mint(100, quote) // quote: string | MintQuoteResponse
	.run();
```

#### 2) Deterministic mint with keyset + callback

```ts
const newProofs = await wallet.ops
	.mint(250, quote)
	.asDeterministic(0, [128, 64]) // counter=0 => auto-reserve, split must include denoms
	.keyset('0123456')
	.onCountersReserved((info) => console.log(info))
	.run();
```

#### 3) Locked quote signing

```ts
// Create a locked mint quote
const pubkey = '02...'; // Your public key
const quote = await wallet.createLockedMintQuote(64, pubkey);

// Sign and mint
const newProofs = await wallet.ops
	.mint(50, quote)
	.privkey('user-secret-key') // sign locked mint quote
	.run();
```

---

### Melt

#### 1) Basic BOLT11 melt

```ts
// given a bolt11 meltQuote...
const { quote, change } = await wallet.ops.meltBolt11(meltQuote, myProofs).run();
```

- Pays the Lightning invoice in the `meltQuote` using `myProofs`
- Any change is returned using wallet policy defaults.

#### 2) BOLT12 melt with deterministic change + callback

```ts
// given a bolt12 meltQuote...
const { quote, change } = await wallet.ops
	.meltBolt12(meltQuote, myProofs)
	.asDeterministic() // counter=0 => auto-reserve
	.onChangeOutputsCreated((blanks) => {
		// Persist blanks and later call wallet.completeMelt(blanks)
	})
	.onCountersReserved((info) => console.log('Reserved', info))
	.run();
```

- Supports async completion with NUT-08 blanks.
- Change outputs are deterministic.
- Callback hooks let you persist state for retry later.
- If you prefer global subscriptions, use:
  - onChangeOutputsCreated -> wallet.on.meltBlanksCreated()
  - onCountersReserved -> wallet.on.countersReserved()

---

### Notes

- **Counter `0`**
  `asDeterministic(0)` means "reserve counters automatically" using the wallet’s `CounterSource`. You’ll receive `onCountersReserved` when they’re atomically reserved.
  For lifecycle management, see WalletEvents.

- **Two sides in send**
  `send` has **send** and **keep** branches.
  If you only set **send**, the builder omits **keep** so the wallet may still do offline exact-match selection.

- **Offline modes vs custom outputs**
  `offlineExactOnly` / `offlineCloseMatch` work **only** with existing proofs.
  They cannot honor new output types (p2pk/factory/custom/etc). The builder enforces this.

- **Keysets**
  `.keyset(id)` pins all fee lookups to that keyset. If you don’t specify it, the wallet uses its policy default keyset (either supplied at init or cheapest).

- **P2PK**
  You can pass `P2PKOptions` or build them fluently using the `P2PKBuilder` API.

---

### P2PKBuilder API

Small helper that only shapes `P2PKOptions`, it does not create secrets.

```ts
new P2PKBuilder()
  .addLockPubkey(k: string | string[])    // accepts 02|03 compressed, or x only (Nostr)
  .addRefundPubkey(k: string | string[])  // requires lockUntil(...) to be set
  .lockUntil(when: number | Date)      		// unix seconds, unix ms, or Date
  .requireLockSignatures(n: number)       // n of m for lock keys
  .requireRefundSignatures(n: number)     // n of m for refund keys
  .toOptions(): P2PKOptions;

P2PKBuilder.fromOptions(opts: P2PKOptions): P2PKBuilder
```

**Behaviour** Keys are normalised and de-duplicated, insertion order is preserved, total lock plus refund keys must be ≤ 10, refund keys will throw if no locktime is set.

Example usage:

```ts
import { P2PKBuilder } from '@cashu/cashu-ts';

const p2pk = new P2PKBuilder().addLockPubkey('02abc...').lockUntil(1_712_345_678).toOptions();

await wallet.ops.send(5, proofs).asP2PK(p2pk).run();
```

---

### Error handling patterns

```ts
try {
	const res = await wallet.ops.send(5, proofs).offlineExactOnly().run();
	console.log('Sent:', res.send.length, 'Kept:', res.keep.length);
} catch (e) {
	// e is a proper Error (WalletOps normalizes unknowns internally)
	if ((e as Error).message.includes('Timeout')) {
		// …
	}
	throw e;
}
```

## Deterministic counters (persist, inspect, bump)

Deterministic outputs use per-keyset counters. The wallet reserves them atomically and emits a single event you can use to persist the "next" value in your storage.

API at a glance:

- `wallet.counters.snapshot()` – inspect current state
- `wallet.counters.advanceToAtLeast(id, n)` – bump forward if behind
- `wallet.counters.setNext(id, n)` – hard-set for migrations/tests
- `wallet.on.countersReserved(cb)` – subscribe to reservations (see WalletEvents for subscription patterns)

```ts
// 1) Seed once at app start if you have previously saved "next" per keyset
const wallet = new Wallet(mintUrl, {
	unit: 'sat',
	bip39seed,
	keysetId: preferredKeysetId, // e.g. '0111111'
	counterInit: loadCountersFromDb(), // e.g. { '0111111': 128 }
});
await wallet.loadMint();

// Alternative to using counterInit for individual keyset allocation
await wallet.counters.advanceToAtLeast('0111111', 128);

// 2) Subscribe once, persist future reservations
wallet.on.countersReserved(({ keysetId, start, count, next }) => {
	// next is start + count (i.e: next available)
	saveNextToDb(keysetId, next); // do an atomic upsert per keysetId
});

// 3) Inspect current state, what will be reserved next
const snap = await wallet.counters.snapshot(); // { '0111111': 128 }

// 4) After a restore or cross device sync, bump the cursor forward
const { lastCounterWithSignature } = await wallet.batchRestore();
if (lastCounterWithSignature != null) {
	const next = lastCounterWithSignature + 1; // e.g. 137
	await wallet.counters.advanceToAtLeast('0111111', next);
	await saveNextToDb('0111111', next);
}

// 5) Parallel keysets without mutation
const wA = wallet; // bound to '0111111'
const wB = wallet.withKeyset('0122222'); // bound to '0122222', same CounterSource
await wB.counters.advanceToAtLeast('0122222', 10);
await wA.counters.snapshot(); // { '0111111': 137, '0122222': 10 }
await wB.counters.snapshot(); // { '0111111': 137, '0122222': 10 }
wA.keysetId; // '0111111'
wB.keysetId; // '0122222'

// 6) Switch wallet default keyset and bump counter
await wallet.counters.snapshot(); // { '0111111': 137, '0122222': 10 }
wallet.keysetId; // '0111111'
wallet.bindKeyset('0133333'); // bound to '0133333', same CounterSource
wallet.keysetId; // '0133333'
await wallet.counters.advanceToAtLeast('0133333', 456);

// Counters persist per keyset, so rebinding does not reset the old one
await wallet.counters.snapshot(); // { '0111111': 137, '0122222': 10, '0133333': 456 }
await wA.counters.snapshot(); // { '0111111': 137, '0122222': 10, '0133333': 456 }
await wB.counters.snapshot(); // { '0111111': 137, '0122222': 10, '0133333': 456 }
```

> **Note** The wallet does not await your callback.
> If saveNextToDb (or similar) is async, handle errors to avoid unhandled rejections
> For more on lifecycle management, see WalletEvents

## WalletEvents – Event Subscriptions

`wallet.on` exposes event subscriptions for counters, quotes, melts, and proof states. Each method returns a canceller function. You can bind an `AbortSignal`, set a timeout, or group cancellers and dispose them together.

**Subscriptions:**

- `wallet.on.countersReserved(cb, { signal })` – deterministic counter reservations
- `wallet.on.meltBlanksCreated(cb, { signal })` – NUT-08 blanks before melt
- `wallet.on.mintQuoteUpdates(ids, onUpdate, onErr, { signal })` – live mint quote updates
- `wallet.on.meltQuoteUpdates(ids, onUpdate, onErr, { signal })` – live melt quote updates
- `wallet.on.proofStateUpdates(proofs, onUpdate, onErr, { signal })` – push updates
- `wallet.on.proofStatesStream(proofs, opts)` – async iterator with bounded buffer

> **Note:** The first quote subscription auto-establishes a mint WebSocket and errors surface via the onErr callback.

**One-shot helpers:**

- `wallet.on.onceMintPaid(id, { signal, timeoutMs })` – resolve once quote paid
- `wallet.on.onceMeltPaid(id, { signal, timeoutMs })` – resolve once melt paid
- `wallet.on.onceAnyMintPaid(ids, { signal, timeoutMs })` – resolve when any paid

**Grouping:**

- `wallet.on.group()` – collect many cancellers, dispose all at once

### Cancel and Abort

The simplest way to cancel a subscription is to call its cancel handle.

```ts
const cancelSub = wallet.on.countersReserved(({ keysetId, next }) => {
	void saveNextToDb(keysetId, next).catch(console.error);
});

// later
cancelSub();
```

Subscriptions accept an `AbortSignal`. Aborting stops the stream and cleans up.

```ts
const ac = new AbortController();
wallet.on.countersReserved(
	({ keysetId, next }) => {
		void saveNextToDb(keysetId, next).catch(console.error);
	},
	{ signal: ac.signal },
);

// later
ac.abort();
```

Timeouts are built into the `once*` helpers:

```ts
try {
	const paid = await wallet.on.onceMintPaid(quoteId, { timeoutMs: 60_000 });
	console.log('Paid', paid.amount);
} catch (e) {
	console.warn('Not paid in time or aborted', e);
}
```

### Proof state streams

Async iterator with buffer control:

```ts
import { CheckStateEnum } from '@cashu/cashu-ts';
const ac = new AbortController();
(async () => {
	for await (const u of wallet.on.proofStatesStream(proofs, { signal: ac.signal })) {
		if (u.state === CheckStateEnum.SPENT) {
			console.log('Spent proof', u.proof.id);
		}
	}
})();

// later
ac.abort();
```

### Grouped cancellers

```ts
const cancelAll = wallet.on.group();
cancelAll.add(wallet.on.meltBlanksCreated((b) => cacheBlanks(b)));
cancelAll.add(wallet.on.mintQuoteUpdates(ids, onMint, onErr));
cancelAll();
// safe to call multiple times
```

---

### Note: Builder hooks vs Global events

`WalletOps` builders include per-operation hooks (onCountersReserved, onChangeOutputsCreated) that fire during a single transaction build.

`WalletEvents` provides global subscriptions `(wallet.on.*)` that can outlive a single builder call.

Use the builder hooks for transaction-local callbacks, and WalletEvents for app-wide subscriptions.

---

## Contribute

Contributions are very welcome.

If you want to contribute, please open an Issue or a PR.
If you open a PR, please do so from the `development` branch as the base branch.

## Release strategy

Features and fixes should be implemented by branching off `development`. Hotfixes can be implemented by branching off a given `tag`. A new release can be created if at least one new feature or fix has been added to the `development` branch. If the release has breaking API changes, the major version must be incremented (X.0.0). If not, the release can increment the minor version (0.X.0). Patches and hotfixes increment the patch version (0.0.X). To create a new release, the following steps must be taken:

1. `git checkout development && git pull` Checkout and pull latest changes from `development`
2. `npm version <major | minor | patch>` create new release commit & tag
3. `git push && git push --tags` push commit and tag
4. Create a new release on github, targeting the newly created tag
5. The CI will build and deploy to npm, with provenance
6. `git checkout main && git pull && git merge <tag>` After creating a new version, merge the tag into `main`
