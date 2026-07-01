# AGENTS

Using cashu-ts? This file is for you. Developing cashu-ts itself? See
`AGENTS-CONTRIBUTING.md` (alongside this file in a repo checkout, or
[on GitHub](https://github.com/cashubtc/cashu-ts/blob/main/AGENTS-CONTRIBUTING.md)).

TypeScript library for Cashu ecash wallets and mint interaction.

## Before you write code

Check `package.json` `version`. The API changed heavily across majors, and agents
frequently emit outdated (pre-v4) patterns. Don't. The current API is defined by
the bundled types `lib/types/index.d.ts` and demonstrated in `docs-src/usage/` and
`docs-src/wallet_ops/`. Type-check against the shipped `.d.ts`; if it does not
compile, it is not current.

## Upgrading from an older major

Work through the `migration-*.md` guides in order, starting from the major you are
on and ending at the current one. For each step, apply its changes and resolve its
deprecations before moving to the next. Some majors also ship a deeper
`migration-<version>.SKILL.md`.

## Where to look (all shipped in this package)

- Usage recipes: `docs-src/` (contains usage, wallet events, WalletOps builder)
- Full API reference: `etc/cashu-ts.api.md` (or `lib/types/index.d.ts`)
- Migration guides: `migration-*.md` (plus any `.SKILL.md`)
