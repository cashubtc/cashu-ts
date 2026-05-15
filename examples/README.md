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

| File                      | Mint required                                                                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `simpleWallet_example.ts` | `DEV=1 make nutshell-up` (or `cdk-up`)                                            | End-to-end BOLT11 mint, send, receive, and melt against a fake-wallet LN backend.                                                                                                                                                                                                                                                                                                                                                          |
| `bolt12Wallet_example.ts` | `DEV=1 make cdk-up`                                                               | Reusable BOLT12 offer flow: mint via BOLT11, pay the offer, mint again from accumulated payments. CDK's fakewallet handles both BOLT11 and BOLT12.                                                                                                                                                                                                                                                                                         |
| `onchain_example.ts`      | none (uses public test mint)                                                      | Onchain (NUT-30) mint and melt against `https://onchain.cashudevkit.org` on Mutinynet. **Interactive** — pauses while you fund the printed address from the Mutinynet faucet, then continues automatically once the mint detects 2 confirmations.                                                                                                                                                                                          |
| `auth_mint/`              | Keycloak + CDK mint via docker, **or** Keycloak + locally-built Nutshell BLS mint | OAuth2 / OIDC blind-auth (NUT-21 / NUT-22) demos. CDK variant: `make up`, `make demo` (or `demo-device` / `demo-pkce`), `make down`. Nutshell BLS variant (exercises v3 BLS BAT verification): `make nutshell-up`, `make nutshell-demo` (or `nutshell-demo-device` / `nutshell-demo-pkce`), `make nutshell-down` — requires a sibling `../nutshell` checkout on a branch with cashubtc/nutshell#1004 (override path via `NUT_BLS_PATH=…`). |
| `paymentApi_example.js`   | —                                                                                 | Code snippet for receiving locked ecash inside a Firebase Cloud Function. Not runnable standalone.                                                                                                                                                                                                                                                                                                                                         |

## Notes

- `dns.setDefaultResultOrder('ipv4first')` is set in each example to avoid Node's IPv6-first DNS resolution stalling on `localhost` (see Node issue #40537).
- The onchain demo needs Mutinynet sats — log in to https://faucet.mutinynet.com/ via GitHub to claim some.
