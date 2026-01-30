[Documents](../index.html) › **Developer Guide**

# Developer Guide

This document is a quick reference for maintainers and frequent contributors. It complements [the contributor guide](./CONTRIBUTING.md) (which is contributor-facing) and contains deeper, actionable instructions for setting up, testing, and developing the project.
We use Husky to manage our git hooks. When you install dependencies, the environment is automatically configured. See the Hooks section below for more info.

## Quickstart (one-time)

```bash
# clone
git clone https://github.com/cashubtc/cashu-ts.git
cd cashu-ts

# install exact dependencies used by CI
npm ci

# prepare browser dependencies for integration tests (one-time)
npm run test:prepare

```

### Branching model update:

This repository no longer uses a separate development branch. All development now happens directly against main.
The project will continue to support the last prior major release on a version branch. At the time of this change
main tracks v3, while the v2 linage exists on `dev-v2`.

If you are backporting fixes to the v2 line, please open pull requests against the `dev-v2` branch instead.

Notes:

- `npm ci` requires a package-lock.json and produces a reproducible node_modules tree.
- Node requirement: see `package.json` (engine: `node >=22.4.0`). Use `nvm`, `volta`, or `asdf` to pin your local Node version.

### ⚠️ Important — run `npm ci` after switching major branches

When switching between major branches (for example `main` for v3 and `dev-v2` for v2) the lockfile and installed dependencies can differ. This frequently causes confusing failures when compiling or running `api-extractor`.

Always run a clean install after switching major branches to ensure `node_modules` matches the checked-in lockfile:

```bash
# after checkout
npm ci
```

If you still see strange build or extractor errors, do a full refresh of dependencies:

```bash
rm -rf node_modules
npm ci
```

This callout is important — please don't skip it when moving between major branches, it saves a lot of time debugging mysterious build/test failures.

## Environment & toolchain

- Node: >=22.4.0
- Recommended tools: `npm` (node package manager), `git`, optional `nvm`/`volta` for Node version management.
- Optional: Playwright browsers for integration tests (`npm run test:prepare`).

## Hooks internals (how the installer works)

During the install process [husky](https://typicode.github.io/husky/) was installed and setup for pre-commit, pre-push, and commit-msg hooks.
We also automatically configured your local `git config commit.template` to use our project's `.gitmessage`.

### Commit Message Convention

This project follows the [Conventional Commits](https://www.conventionalcommits.org/) specification. This is **required** because it powers our automated versioning and changelog generation.

- **Format:** `<type>(<scope>): <description>`
- **Common Types:**
  - `feat`: A new feature (triggers a MINOR version bump).
  - `fix`: A bug fix (triggers a PATCH version bump).
  - `docs`: Documentation changes only.
  - `chore`: Maintenance tasks or library updates.
- **Commit Template:** We provide a `.gitmessage` template to help you structure your messages. This is automatically configured as your local `commit.template` when you run `npm install`.

If your message doesn't fit the format, the commit-msg hook will prevent the commit.

#### Pro-Tip: Recovering a Failed Commit

If your commit fails the `commitlint` check, don't worry—you don't have to retype it!

**The Quick Fix:**
Git saves your last failed commit message in `.git/COMMIT_EDITMSG`. You can quickly recover it with:

```bash
git commit -t .git/COMMIT_EDITMSG
```

### Migrate Hooks

We previously offered hooks as opt-in. If you had that configured we offer a migrate-hooks command.

```bash
npm run migrate-hooks
```

This runs `npm run uninstall-hooks` and `npm install`.

### Pre-commit vs pre-push strategy

- `pre-commit`: quick feedback (lint + format) — fast to avoid blocking developers.
  - Opt-in full run: set `FULL_PRECOMMIT=1` for a single commit when you want the full suite locally.
- `pre-push`: runs full PR checks (`npm run prtasks`) to ensure the full suite runs before pushing.

This keeps commits fast while ensuring pushes execute the heavier checks.

## Running the full PR checks locally

The repo includes a convenience script:

```bash
npm run prtasks
```

This runs (in order): lint, format, api:update (compile + api-extractor), tests, and `git status`.

Caution: `api:update` can modify generated files (e.g. API reports). Inspect and commit any intended changes.

### Local pre-push workflow (recommended)

Many maintainers prefer to run the full PR checks locally before pushing. A common, reliable workflow:

1. Start a local mint (for integration tests). An example docker-compose is available at `examples/auth_mint/docker-compose.yml`:

```bash
# from the repo root
docker compose -f examples/auth_mint/docker-compose.yml up -d
```

2. Run the full PR tasks (lint, format, api:update, tests):

```bash
npm run prtasks
```

3. Run the integration tests against the local mint:

```bash
npm run test-integration
```

3a. (Optional but recommended) Run the consumer smoke tests used by CI:

```bash
# runs all consumer smoke tests (bundler, commonjs, iife, nodenext, reactnative)
npm run test:consumer
```

**Note**: the consumer smoke tests are run in CI but are intentionally not part of `prtasks` to avoid adding noise to every local run; running `npm run test:consumer` locally before pushing helps reproduce CI behavior.

The `test:consumer` aggregator runs the following scripts (you can run them individually):

- `npm run test:bundler` — smoke test using the bundler consumer
- `npm run test:commonjs` — smoke test for CommonJS consumers
- `npm run test:iife` — smoke test for IIFE (standalone) build
- `npm run test:nodenext` — smoke test for Node ESM consumers
- `npm run test:reactnative` — smoke test for React Native consumer

Run the individual script if you want to isolate failures or speed up debugging.

4. When finished, stop the local mint:

```bash
docker compose -f examples/auth_mint/docker-compose.yml down
```

This pattern (run `npm run prtasks` and integration tests against a local mint) gives fast, reproducible results and avoids surprises in CI.

## Integration mints (Makefile & CI)

The repository provides Makefile targets that make it easy to spin up the most popular cashu mints (currently cdk and nutshell). These are used in the CI for integration testing and made available locally. Use the Makefile as the single source of truth for the pinned Docker image versions.

Spin up / tear down locally

```bash
# start the mint (uses Makefile defaults unless you override)
DEV=1 make cdk-up

# stop the mint
DEV=1 make cdk-down

# start nutshell
DEV=1 make nutshell-up
# stop nutshell
DEV=1 make nutshell-down
```

#### Override behavior

- To test a different image or container name locally you can override the Makefile variables on the command line. Example:

```bash
# run a specific mint image with a custom container name
CDK_IMAGE=cashubtc/mintd:0.13.4 CDK_NAME=my-local-mint DEV=1 make cdk-up
```

### CI integration notes

- CI workflows call the same Makefile targets (for example `make cdk-up` / `make nutshell-up`) so the runtime behavior in CI matches local usage.
- Renovate is configured to update pinned image tags in the Makefile (the canonical source of truth). The Renovate regex intentionally matches semver-like tags (no `latest`) so PRs will update numeric tags.
- Workflows start containers on the same runner and then run the shared composite action which waits for readiness and runs `npm run test-integration`.

#### Practical checklist before running integration tests locally:

1. Ensure dependencies are installed: `npm ci`
2. Prepare browser artifacts if needed: `npm run test:prepare`
3. Start the mint(s): `DEV=1 make cdk-up` (and/or `DEV=1 make nutshell-up`)
4. Run the integration tests: `npm run test-integration`
5. When finished, tear down: `DEV=1 make cdk-down` / `DEV=1 make nutshell-down`

## API Extractor workflow

- Use `npm run api:check` to create a temporary API report and compare it to the recorded status-quo at `/etc/cashu-ts.api.md`.
- Use `npm run api:update` to update the `/etc` status-quo when a public API change is intended.

When running `api:update` locally:

```bash
npm run api:update
# inspect changes under /etc
git add /etc/cashu-ts.api.md
git commit -m "docs(api): update API report"
```

If `api:update` modifies generated code or types, run the test/build steps and ensure CI passes.

## Tests and debugging

Run unit tests (node + browser) locally:

```bash
npm test
```

### Code coverage

The `npm test` script runs Vitest with coverage enabled (`--coverage`) and emits reports
into the `coverage/` directory.

After the run you can open the HTML report locally (`coverage/index.html`) in
your browser to inspect per-file metrics.

CI also publishes code coverage; the project site hosts the latest report (see the
README badge/link for the public report).

### Test file naming convention

If a test requires Node-only features, name the file with `.node.` in the filename
(for example `cbor.node.test.ts`). The Vite/Vitest configuration will then
skip browser testing for that file and run it only in the Node environment.
Likewise, you can use `.browser.` in the filename to mark a test as
browser-only (we currently don't have any browser-only tests, but the convention is supported).

### Focused Testing

Run only node tests or a single test file with vitest (useful for rapid iteration):

```bash
npx vitest --run --filter <pattern>
```

### Integration / Playwright tests:

```bash
npm run test:prepare
# then run the integration tests
npm run test-integration
```

If tests are flaky locally, run with increased verbosity or use `--run --inspect` / `--watch` where supported.

## Updating dependencies

- To add a dependency and update the lockfile:

```bash
npm install <pkg> --save
# or for dev dependencies
npm install <pkg> --save-dev
```

- Commit the updated `package-lock.json` (CI will use that exact lockfile).
- In CI and reproducible environments, prefer `npm ci`.

## Versioning & Release Strategy

Cashu-TS uses semantic versioning.
The repository uses a single primary development branch, `main`, which represents the current major release (v3).
All new development is merged into `main` via pull requests.

The previous major version (v2) is supported via a long-lived maintenance branch, which is used only for critical fixes.

If you need to backport a feature to v2, open a separate PR targeting `dev-v2` (do not mix both in a single PR).

## Releases

Releases are automated and managed by CI. Maintainers should **not** create releases manually.

### Automated Releases (release-please)

We use [release-please](https://github.com/googleapis/release-please) to automate our release cycle.

#### How it works

- Every pull request merged into `main` is analyzed by release-please.
- release-please automatically creates or updates a **Release PR** targeting `main`.
- The Release PR:
  - Aggregates all `feat` and `fix` commits since the last release
  - Updates `CHANGELOG.md`
  - Calculates the next version using **Semantic Versioning (SemVer)**:
    - `feat` → minor version bump
    - `fix` → patch version bump
    - Breaking changes → major version bump

#### Cutting a release

- A release is created **by merging the Release PR**.
- When the Release PR is merged:
  - A Git tag is created
  - A GitHub Release is published
  - CI builds and publishes the package to npm (with provenance)

**Merging the Release PR is the release action. No additional steps are required.**

### Notes on Versioning

- Follow **Conventional Commits** to ensure correct version bumps.
- Breaking API changes must be clearly marked to trigger a major version bump.
- Version numbers are determined automatically by release-please; contributors should not attempt to control versions directly.

## Troubleshooting (common issues)

- If you see strange compile or api-extractor errors after switching branches: run `npm ci` to ensure `node_modules` matches the checked-in lockfile. If problems persist, try removing `node_modules` and running `npm ci` again.

- To reproduce CI locally (fast): run `npm run prtasks`. This runs the same suite used for PRs and helps surface issues that CI would catch.

## Contact & maintainers

Feel free to join the [matrix server](https://matrix.to/#/#dev:matrix.cashu.space) or [telegram channel](https://t.me/CashuBTC)
