# AGENTS

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

## Security fixes

When a task involves a vulnerability or an uncoordinated security fix, do not
describe the exploit in depth in anything public: PR titles or bodies, commit
messages, review comments, or code comments. Keep the public summary high-level
(state that a security issue was fixed) and leave out reproduction steps, proofs
of concept, root-cause specifics, and attack paths.

Until a fix has been released and disclosure has been coordinated, send the
detailed write-up to the security contact listed under "Reporting a Vulnerability"
in `SECURITY.md`.

## Contributing to Cashu-TS Development

Checkout the git repo at: https://github.com/cashubtc/cashu-ts

**Study** `AGENTS-CONTRIBUTING.md` (alongside this file in a repo checkout).

It contains repo map and conventions, coding guidelines, commit hygiene and more.
