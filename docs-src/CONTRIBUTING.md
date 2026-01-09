[Documents](../index.html) › **Contribution Guide**

# Contribution Guide

This file is contributor-facing: quick setup, how to opt in to local hooks, and a short PR checklist. For detailed developer instructions (environment, hooks internals, release process, CI parity, and troubleshooting) see [the developer guide](./DEVELOPER.md).

## Quickstart

```bash
git clone https://github.com/cashubtc/cashu-ts.git
cd cashu-ts
# install exact deps used by CI
npm ci

# optional: prepare Playwright browsers for integration tests
npm run test:prepare

# optional: opt in to local git hooks
npm run setup-hooks
```

## PR checklist (author)

- Code compiles / build passes: `npm run compile`
- Lint: `npm run lint`
- Format: `npm run format`
- Tests: `npm test`
- If public API changed: run `npm run api:update` and commit `/etc/cashu-ts.api.md`

## Local hooks (short)

We provide an optional hook installer. Run `npm run setup-hooks` to copy tracked hook sources from `scripts/hooks/` into an ignored `.githooks/` folder and activate them locally. Hooks are opt-in; CI still runs the full checks.

If you want the installer behavior or hook internals, see the `Hooks` section in `DEVELOPER.md`.

## Full PR checks

There is a convenience script `npm run prtasks` that runs the full PR/CI suite (lint, format, api:update, tests). The installed `pre-push` hook runs `npm run prtasks` to ensure the full checks before pushing. You may run it manually before opening a PR.

If you need the pre-commit hook to run the full suite for one commit, set `FULL_PRECOMMIT=1` when committing:

```bash
FULL_PRECOMMIT=1 git commit -m "..."
```

Tip: a common local workflow before pushing is to run `npm run prtasks` and, for integration tests, start a local mint using the example `docker-compose` (see `examples/auth_mint/docker-compose.yml`) and then run `npm run test-integration`. This reproduces CI conditions locally and reduces surprises.

## API Extractor

This project uses API-Extractor in CI. For details on `npm run api:check` and `npm run api:update` and the correct workflow for updating API reports, see `DEVELOPER.md`.

## Code documentation conventions

### TSDoc release tags

When adding new features that are subject to change, use the `@experimental` tag in TSDoc comments:

```typescript
/**
 * This function does something new and exciting.
 *
 * @experimental This API is subject to change.
 */
export function myNewFeature(): void {
	// ...
}
```

**Why `@experimental` instead of `@alpha` or `@beta`?**

Our vite build process excludes `@alpha` and `@beta` tagged items from the public API. Using `@experimental` allows us to surface new features while clearly flagging them as subject to change.

### TODO comments

Use `// TODO:` comments to mark areas needing future attention, such as deprecated code blocks or planned improvements:

```typescript
// TODO: Remove this deprecated method in v4.0
export function oldMethod(): void {
	// ...
}
```

This convention allows common editor plugins like [Better Comments](https://marketplace.visualstudio.com/items?itemName=aaron-bond.better-comments) to highlight these areas for easy identification.

## Integration tests

These tests expect a local mint at `http://localhost:3338`. Use the Make targets below to start one, you will need Docker installed locally, for example via Homebrew or Docker Desktop.

```bash
# CDK Mint
DEV=1 make cdk-up
# tear down
DEV=1 make cdk-down

# Nutshell
DEV=1 make nutshell-up
# tear down
DEV=1 make nutshell-down
```

To prevent accidental use, these targets require `DEV=1` to be set, either by prefixing the command as shown above, or by exporting it in your shell:

```bash
export DEV=1
make cdk-up
make nutshell-up
```

On Apple Silicon the Makefile detects arm64 and runs the container with an amd64 image automatically, if you need to override, pass `PLATFORM=linux/amd64` or `PLATFORM=linux/arm64`.

For a faster developer experience, these developer presets enable friendly defaults such as a permissive transaction rate limit and short fake wallet delays.

Then run the tests:

```bash
# full test suite
npm test
# integration only
npm run test-integration
```

### Notes that save time

- Both CDK Mint and Nutshell remember Lightning invoices, so for a fresh run, tear down the container with volumes. The `*-down` targets already do this for you.
- If websocket tests time out or you see rate limit warnings, bump the Nutshell rate limit, for example `MINT_TRANSACTION_RATE_LIMIT_PER_MINUTE=100`. The developer preset sets a higher limit by default.
- The integration project uses websockets, ensure nothing else is bound to port `3338`.

## Build output contracts

- **TS sources** use extensionless imports.
- **Runtime ESM** (`lib/**/*.js`) must have `.js` on relative imports.
- **Runtime CJS** (`lib/**/*.cjs`) may omit extensions, Node does not require them.
- **Type declarations** (`lib/types/**/*.d.ts`) are a rolled up file (no relative imports/re-exports).

---

Thanks for contributing — please open [Issues](https://github.com/cashubtc/cashu-ts/issues) or [Pull Requests](https://github.com/cashubtc/cashu-ts/pulls) if anything is unclear.
