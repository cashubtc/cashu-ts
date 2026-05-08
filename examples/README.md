# cashu-ts examples

Runnable demos of common cashu-ts flows. Examples are TypeScript files run directly with `tsx` — no build step needed.

## Running

From the repo root:

```sh
npx tsx examples/<example>.ts
```

`tsx` is already a devDependency (no global install needed). If you're outside the repo, copy the example and replace the `'../src'` import with `'@cashu/cashu-ts'`.

## Local mints

The repo's top-level `Makefile` spins up local CDK or Nutshell mints with a fake-wallet LN backend (auto-pays invoices). It requires `DEV=1` as an explicit opt-in. Both bind to `127.0.0.1:3338` by default — override with `PORT=...`.

```sh
DEV=1 make cdk-up        # then: DEV=1 make cdk-down
DEV=1 make nutshell-up   # then: DEV=1 make nutshell-down
```

Run `make print-mint-images` to see which versions are pinned. The auth demos have their own docker setup — see `auth_mint/Makefile`.

## Examples

| File                      | Mint required                          | Description                                                                                                                                        |
| ------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `simpleWallet_example.ts` | `DEV=1 make nutshell-up` (or `cdk-up`) | End-to-end BOLT11 mint, send, receive, and melt against a fake-wallet LN backend.                                                                  |
| `bolt12Wallet_example.ts` | `DEV=1 make cdk-up`                    | Reusable BOLT12 offer flow: mint via BOLT11, pay the offer, mint again from accumulated payments. CDK's fakewallet handles both BOLT11 and BOLT12. |
| `auth_mint/`              | Keycloak + CDK mint via docker         | OAuth2 / OIDC blind-auth (NUT-21 / NUT-22) demos. See `auth_mint/Makefile` (`make up`, `make demo-device`, `make down`).                           |
| `paymentApi_example.js`   | —                                      | Code snippet for receiving locked ecash inside a Firebase Cloud Function. Not runnable standalone.                                                 |

## Notes

- `dns.setDefaultResultOrder('ipv4first')` is set in each example to avoid Node's IPv6-first DNS resolution stalling on `localhost` (see Node issue #40537).
