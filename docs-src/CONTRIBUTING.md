[Documents](../index.html) > **Contribution Guide**

# Contribution Guide

This file is contributor-facing: quick setup, current hook behavior, and a short PR checklist. For detailed developer instructions (environment, release process, CI parity, and troubleshooting) see [the developer guide](./DEVELOPER.md).

## Quickstart

```bash
git clone https://github.com/cashubtc/cashu-ts.git
cd cashu-ts
# install exact deps used by CI
npm ci

# optional: prepare Playwright browsers for integration tests
npm run test:prepare

```

## PR checklist (author)

- Code compiles / build passes: `npm run compile`
- Lint: `npm run lint`
- Format: `npm run format`
- Tests: `npm test`
- If public API changed: run `npm run api:update` and commit `/etc/cashu-ts.api.md`

Before submitting a PR, please read [COMMUNITY.md](./COMMUNITY.md) to understand our contribution philosophy and review expectations.

## Local hooks (short)

Husky hooks install automatically during local `npm ci` / `npm install` via the `prepare` script.

- `commit-msg` enforces Conventional Commits.
- `pre-commit` runs `lint-staged` on staged files. For `*.{js,ts}` it runs ESLint with `--fix` and Prettier; for `*.{json,md,yml,yaml}` it runs Prettier.
- `pre-push` runs repository-wide `npm run check-lint` and `npm run check-format`.

If you want more detail on the hook behavior, see the `Hooks` section in `DEVELOPER.md`.

## Recommended local checks

The hooks only cover commit message validation plus lint and formatting checks. Before opening a PR, run the checks that match your change:

```bash
# required for most code changes
npm run compile
npm test

# if public API changed
npm run api:update

# if your change depends on a local mint
npm run test-integration
```

We also have an "all-in-one" script that runs all CI tasks sequentially:

```bash
# runs lint, format, compile, api-update and tests
npm run prtasks
```

Tip: if you want to mirror the pre-push checks manually, run `npm run check-lint` and `npm run check-format`.

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
DEV=1 make cdk-stable-up
# tear down
DEV=1 make cdk-stable-down

# Nutshell
DEV=1 make nutshell-stable-up
# tear down
DEV=1 make nutshell-stable-down
```

To prevent accidental use, these targets require `DEV=1` to be set, either by prefixing the command as shown above, or by exporting it in your shell:

```bash
export DEV=1
make cdk-stable-up
make nutshell-stable-up
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

Thanks for contributing - please open [Issues](https://github.com/cashubtc/cashu-ts/issues) or [Pull Requests](https://github.com/cashubtc/cashu-ts/pulls) if anything is unclear.
