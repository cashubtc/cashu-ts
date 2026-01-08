[Documents](../index.html) › **Wallet Operations**

# WalletOps – Transaction Builder Usage Recipes

Cashu-TS offers a flexible `WalletOps` builder that makes it simple to construct transactions in a readable and intuitive way.

You can access `WalletOps` from inside a wallet instance using: `wallet.ops` or instantiate your own `WalletOps` instance.

> Fluent, single-use builders for **send**, **receive**, **mint** and **melt**.
> If you don’t customize an output side, the wallet’s policy defaults apply.

## Examples

| Recipe                                        |
| :-------------------------------------------- |
| [Send](./send.md)                             |
| [Receive](./receive.md)                       |
| [Mint](./mint.md)                             |
| [Melt](./melt.md)                             |
| [P2PKBuilder](./p2pk_builder.md)              |
| [Error Handling Pattern](./error_handling.md) |

## Notes

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
