[Documents](../index.html) › [Wallet Events](../wallet_events/wallet_events.md) › **Cancel and Abort**

# Cancel and Abort

Subscriptions should be cancelled when no longer needed to avoid leaks and keep your app tidy.

The simplest way to cancel a subscription is to call its cancel handle.

```ts
const cancelSub = wallet.on.countersReserved(({ keysetId, next }) => {
	void saveNextToDb(keysetId, next).catch(console.error);
});

// later
cancelSub();
```

Subscriptions also accept an `AbortSignal`. Aborting stops the stream and cleans up.

```ts
// Create an abort controller
const ac = new AbortController();

// Setup subscriptions to use abort signal
wallet.on.countersReserved(
	({ keysetId, next }) => {
		void saveNextToDb(keysetId, next).catch(console.error);
	},
	{ signal: ac.signal }, // abort controller
);

// when done... trigger the abort signal
ac.abort();

// eg: via DOM events:
window.addEventListener('pagehide', () => ac.abort(), { once: true });
window.addEventListener('beforeunload', () => ac.abort(), { once: true });
```

The `once*` helpers are always cancelled automatically after resolution or rejection, as well as on timeout or abort:

```ts
try {
	const paid = await wallet.on.onceMintPaid(quoteId, {
		signal: ac.signal,
		timeoutMs: 60_000,
	});
	console.log('Paid', paid.amount);
} catch (e) {
	console.warn('Not paid in time or aborted', e);
}
```
