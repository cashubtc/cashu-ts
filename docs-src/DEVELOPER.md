[Documents](../index.html) › **Developer Guide**

# Developer Guide

This document is a quick reference for maintainers and frequent contributors. It complements [the contributor guide](./CONTRIBUTING.md) (which is contributor-facing) and contains deeper, actionable instructions for setting up, testing, and developing the project.
We use Husky to manage our git hooks. When you install dependencies locally, the environment is configured automatically. See the Hooks section below for more info.

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

### Branching model update

This repository no longer uses a separate development branch. All development now happens directly against main.
The project will continue to support the last prior major release on a version branch. At the time of this change
main tracks v4, while the v3 linage exists on `v3-dev`.

If you are backporting fixes to the v3 line, please open pull requests against the `v3-dev` branch instead.

Notes:

- `npm ci` requires a package-lock.json and produces a reproducible node_modules tree.
- Node requirement: see `package.json` (engine: `node >=22.4.0`). Use `nvm`, `volta`, or `asdf` to pin your local Node version.

### ⚠️ Important — run `npm ci` after switching major branches

When switching between major branches (for example `main` for v4 and `v3-dev` for v3) the lockfile and installed dependencies can differ. This frequently causes confusing failures when compiling or running `api-extractor`.

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

## Hooks internals

During local install, [husky](https://typicode.github.io/husky/) wires up the `pre-commit`, `pre-push`, and `commit-msg` hooks through the `prepare` script.
We also configure your local `git config commit.template` to use the project's `.gitmessage`.

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

#### Pro tip: recover a failed commit

If your commit fails the `commitlint` check, you don't need to retype it.

Git keeps the attempted message in `.git/COMMIT_EDITMSG`. To reopen, fix, and retry it:

```bash
git commit --edit --file=.git/COMMIT_EDITMSG
```

### Pre-commit vs pre-push strategy

- `commit-msg`: validates the commit message with Commitlint and points you at `.git/COMMIT_EDITMSG` if the message needs fixing.
- `pre-commit`: runs `lint-staged` on staged files only.
  - `*.{js,ts}`: `eslint --fix`, then `prettier --write`
  - `*.{json,md,yml,yaml}`: `prettier --write`
- `pre-push`: runs repository-wide `npm run check-lint` and `npm run check-format`.

This keeps commits fast while still blocking pushes with lint or formatting drift.

## Running local validation checks

The hooks do not run compile, unit tests, integration tests, or API Extractor for you. Run the checks that fit your change before opening a PR.

The repo includes a convenience script:

```bash
npm run prtasks
```

This runs (in order): lint, format, api:update (compile + api-extractor), tests, and `git status`

Caution: `api:update` can modify generated files (e.g. API reports). Inspect and commit any intended changes.

### Local validation workflow (recommended)

Many maintainers prefer to run the relevant checks locally before pushing. A common, reliable workflow:

1. Start a local mint (for integration tests). We have make targets for both CDK's mintd, and Nutshell:

```bash
# from the repo root
DEV=1 make cdk-stable-up
# or DEV=1 make nutshell-stable-up
```

1. Run the full PR tasks (lint, format, api:update, tests):

```bash
npm run prtasks
```

1. Run the integration tests against the local mint:

```bash
npm run test-integration
```

3a. (Optional but recommended) Run the consumer smoke tests used by CI:

```bash
# runs all consumer smoke tests (bundler, iife, nodenext, reactnative)
npm run test:consumer
```

**Note**: the consumer smoke tests are run in CI but are not part of the git hooks; running `npm run test:consumer` locally before pushing helps reproduce CI behavior.

The `test:consumer` aggregator runs the following scripts (you can run them individually):

- `npm run test:bundler` — smoke test using the bundler consumer
- `npm run test:iife` — smoke test for IIFE (standalone) build
- `npm run test:nodenext` — smoke test for Node ESM consumers
- `npm run test:reactnative` — smoke test for React Native consumer

Run the individual script if you want to isolate failures or speed up debugging.

1. When finished, stop the local mint:

```bash
DEV=1 make cdk-stable-down
# or DEV=1 make nutshell-stable-down
```

This pattern gives fast, reproducible results and avoids surprises in CI.

## Integration mints (Makefile & CI)

The repository provides Makefile targets that make it easy to spin up the most popular cashu mints (currently cdk and nutshell). These are used in the CI for integration testing and made available locally. Use the Makefile as the single source of truth for the pinned Docker image versions.

Spin up / tear down locally

```bash
# start the mint (uses Makefile defaults unless you override)
DEV=1 make cdk-stable-up

# stop the mint
DEV=1 make cdk-stable-down

# start nutshell
DEV=1 make nutshell-stable-up
# stop nutshell
DEV=1 make nutshell-stable-down
```

#### Override behavior

- To test a different image or container name locally you can override the Makefile variables on the command line. Example:

```bash
# run a specific mint image with a custom container name
# NOTE: cdk-up is the base target, cdk-stable-up/cdk-rc-up use the stable/rc values
CDK_IMAGE=cashubtc/mintd:0.13.4 CDK_NAME=my-local-mint DEV=1 make cdk-up
```

### CI integration notes

- CI workflows call the same Makefile targets (for example `make cdk-stable-up` / `make nutshell-stable-up`) so the runtime behavior in CI matches local usage.
- CI will also run the latest release candidate if one exist of cdk and nutshell. Once the release has been cut, the RC branch will pause until new RC's have been published.
- Renovate is configured to update pinned image tags in the Makefile (the canonical source of truth). The Renovate regex intentionally matches semver-like tags (no `latest`) so PRs will update numeric tags.
- Workflows start containers on the same runner and then run the shared composite action which waits for readiness and runs `npm run test-integration`.

#### Practical checklist before running integration tests locally

1. Ensure dependencies are installed: `npm ci`
2. Prepare browser artifacts if needed: `npm run test:prepare`
3. Start the mint(s): `DEV=1 make cdk-stable-up` (and/or `DEV=1 make nutshell-stable-up`, `DEV=1 make cdk-rc-up`, `DEV=1 make nutshell-rc-up`)
4. Run the integration tests: `npm run test-integration`
5. When finished, tear down: `DEV=1 make cdk-stable-down` / `DEV=1 make nutshell-stable-down`

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

CI uploads coverage to Codecov from the main test workflow, and the README badge/link
points to the latest public report there.

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

### Integration / Playwright tests

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

The repository uses a single primary development branch, `main`, which tracks the current major release (v4).

All new development is merged into `main` via pull requests.

The previous major version (v3) is maintained on the `v3-dev` branch for critical fixes only.

If you need to backport a fix to v3, open a separate PR targeting `v3-dev` (do not mix both in a single PR).

## Releases

### v4 stable releases (release-please)

Stable v4 releases on `main` are automated with [release-please](https://github.com/googleapis/release-please).

#### How it works

- Every pull request merged into `main` is analyzed by release-please.
- release-please automatically creates or updates a **Release PR** targeting `main`.
- The Release PR:
  - Aggregates all `feat` and `fix` commits since the last release
  - Updates `CHANGELOG.md`
  - Calculates the next version using **Semantic Versioning (SemVer)**:
    - `feat` → minor version bump
    - `fix` → patch version bump
    - Breaking changes (`feat!` / `fix!`) → major version bump

#### Cutting a stable release

- A release is created **by merging the Release PR**.
- When the Release PR is merged:
  - A Git tag is created
  - A GitHub Release is published
  - CI builds and publishes the package to npm as `latest` (with provenance)

**Merging the Release PR is the release action. No additional steps are required.**

### v4 release candidates (manual)

Release candidates are cut manually from a branch, keeping `main` clean for the pending release-please PR.

1. Branch off `main` (e.g. `v4-rc1`).
2. Bump `package.json` to the RC version (e.g. `4.0.0-rc.1`).
3. Tag, push, and create a GitHub Release — mark it as a **pre-release**.
4. The publish workflow (`version.yml`) detects the prerelease version and publishes to npm with the `next` dist-tag.
5. For subsequent RCs, either add commits to the same branch or branch fresh from `main`.

When the RC phase is complete, merge the release-please PR on `main` to cut the stable release.

### v3 LTS releases (manual)

v3 maintenance releases are handled manually — release-please only watches `main`.

1. Cherry-pick or commit fixes to `v3-dev`.
2. Bump `package.json` to the next patch version (e.g. `3.6.2`).
3. Tag and push: `git tag v3.6.2 && git push origin v3-dev --tags`
4. Create a GitHub Release from the tag (or use `workflow_dispatch` on the publish workflow with the tag).
5. The publish workflow detects major version 3 and publishes to npm with the `v3-lts` dist-tag.

### npm dist-tags

| Version            | npm dist-tag | Install command                      |
| ------------------ | ------------ | ------------------------------------ |
| v4 stable          | `latest`     | `npm install @cashu/cashu-ts`        |
| v4 RC / prerelease | `next`       | `npm install @cashu/cashu-ts@next`   |
| v3 LTS             | `v3-lts`     | `npm install @cashu/cashu-ts@v3-lts` |

### Notes on Versioning

- Follow **Conventional Commits** to ensure correct version bumps.
- Breaking API changes must be clearly marked to trigger a major version bump.
- Stable version numbers on `main` are determined automatically by release-please; contributors should not attempt to control versions directly.
- RC and v3 LTS versions are bumped manually in `package.json`.

## Troubleshooting (common issues)

- If you see strange compile or api-extractor errors after switching branches: run `npm ci` to ensure `node_modules` matches the checked-in lockfile. If problems persist, try removing `node_modules` and running `npm ci` again.

- To reproduce CI locally, run the same checks your change requires: `npm run check-lint`, `npm run check-format`, `npm run compile`, `npm test`, `npm run api:update` for public API changes, and `npm run test-integration` when mint behavior is involved.

## Contact & maintainers

Feel free to join the [matrix server](https://matrix.to/#/#dev:matrix.cashu.space) or [telegram channel](https://t.me/CashuBTC)
