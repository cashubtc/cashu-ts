# Usage Examples

This section collects the shortest paths through the library for common wallet tasks. Use it as an
entry point, then jump into the focused recipe for the exact flow you need.

If you want end-to-end examples with realistic state handling, also inspect the
[integration tests](https://github.com/cashubtc/cashu-ts/blob/main/test/integration.test.ts).

## Start here

If you are building a wallet integration from scratch, read these in order:

1. [Create Wallet](./create_wallet.md) to instantiate a wallet and load mint state.
2. [Mint Token](./mint_token.md) to mint proofs from a paid quote.
3. [Create Token](./create_token.md) or [Create P2PK](./create_p2pk.md) to send value.
4. [Get Token](./get_token.md) to inspect or decode tokens safely.
5. [Melt Token](./melt_token.md) to pay invoices with proofs.

## Recipes

| Recipe                                | Use it for                                                             |
| :------------------------------------ | :--------------------------------------------------------------------- |
| [Create Wallet](./create_wallet.md)   | Initialize a wallet from a mint URL or cached mint state.              |
| [Mint Token](./mint_token.md)         | Create proofs from a paid quote, including two-step mint flows.        |
| [Create Token](./create_token.md)     | Send standard Cashu tokens to another wallet.                          |
| [Create P2PK](./create_p2pk.md)       | Send tokens locked to a public key.                                    |
| [Get Token](./get_token.md)           | Inspect token metadata before wallet creation or decode it after load. |
| [Melt Token](./melt_token.md)         | Pay BOLT11 invoices or other payment methods with wallet proofs.       |
| [Bolt12](./bolt12.md)                 | Work with reusable BOLT12 offers for minting and melting.              |
| [NUT-19 Cached Responses](./nut19.md) | Understand cached endpoint retries and timeout behavior.               |
| [Logging](./logging.md)               | Enable and route library logs while debugging wallet or mint behavior. |

## Related docs

- [Wallet Operations](../wallet_ops/wallet_ops.md) for the builder-style `wallet.ops` API.
- [Wallet Events](../wallet_events/wallet_events.md) for quote and proof state subscriptions.
- [Deterministic Counters](../deterministic_counters.md) for deterministic secret generation flows.
