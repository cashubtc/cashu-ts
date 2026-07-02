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

### Branching model

`main` always tracks the **current major** under active development - there is no separate development branch for it. Each still-supported **prior major** is maintained on its own long-lived `vN-dev` branch for fixes only.

Open PRs against the branch for the major you are targeting (don't mix majors in one PR):

- Features and fixes for the current major → `main`
- Backports to a maintained prior major → land the fix on `main` first, then add a `backport vN-dev` label to the PR (before or after merge); a bot opens the backport PR automatically. If it hits a conflict it pushes nothing and files a `backport`-labelled tracking issue for a manual cherry-pick against that `vN-dev` branch.

Current branches:

| Branch   | Major | Status                             |
| -------- | ----- | ---------------------------------- |
| `main`   | v5    | Current - active development       |
| `v4-dev` | v4    | LTS - critical/security fixes only |
| `v3-dev` | v3    | LTS - critical/security fixes only |

Notes:

- `npm ci` requires a package-lock.json and produces a reproducible node_modules tree.
- Node requirement: see `package.json` (engine: `node >=22.4.0`). Use `nvm`, `volta`, or `asdf` to pin your local Node version.

#### The `@experimental` line

Speculative work tied to **unmerged NUTs** (specs that may still change) is **not** merged into `main`, where it would become a compatibility promise we can't walk back. Instead those PRs stay open against `main` and are bundled onto a disposable `experimental` branch, published to npm under the `@experimental` dist-tag for real-world testing:

```bash
./scripts/make-experimental.sh 698 712    # rebuild from main + these PRs
PUBLISH=1 ./scripts/make-experimental.sh 698   # …and npm publish --tag experimental
```

The branch is throwaway, rebuilt from scratch each run, never promoted from and never merged back. Work graduates by merging its individual PR into `main` the normal way. The bundle is passed as PR-number args (or kept in the gitignored `scripts/.experimental-prs`), so changing the mix is a local operation - no PR required. See the script header for the full rationale.

### ⚠️ Important - run `npm ci` after switching major branches

When switching between major branches (for example `main` and a `vN-dev` branch) the lockfile and installed dependencies can differ. This frequently causes confusing failures when compiling or running `api-extractor`.

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

This callout is important - please don't skip it when moving between major branches, it saves a lot of time debugging mysterious build/test failures.

## Environment & toolchain

- Node: >=22.4.0
- Recommended tools: `npm` (node package manager), `git`, optional `nvm`/`volta` for Node version management.
- Optional: Playwright browsers for browser-based tests (`npm run test:prepare`).

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

Run the checks that match the risk of your change before pushing. As a baseline:

```bash
npm run check-lint
npm run check-format
npm test
```

For public API changes, also run:

```bash
npm run api:update
```

For mint, wallet, transport, or event changes, run the Node integration tests against a fresh local mint:

```bash
DEV=1 make cdk-stable-up
npm run test-integration
DEV=1 make cdk-stable-down
```

For browser-facing integration changes, use the local browser wrapper. It starts a fresh mint for each browser because LN invoices must be unique per run:

```bash
npm run test-integration:browser:local:cdk
# or a single browser:
npm run test-integration:browser:local:cdk -- firefox
```

Consumer smoke tests are also run in CI. Run `npm run test:consumer` when packaging, exports, browser bundles, or consumer compatibility are involved.

`npm run prtasks` is available when you want the heavier all-in local sweep. It runs lint, format, `api:update`, tests, and `git status`.

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
- Workflows start containers on the same runner and then run the shared composite action which waits for readiness and runs `npm run test-integration` or the browser integration equivalent.

#### Practical checklist before running integration tests locally

1. Ensure dependencies are installed: `npm ci`
2. Prepare browser artifacts if needed: `npm run test:prepare`
3. Start the mint(s): `DEV=1 make cdk-stable-up` (and/or `DEV=1 make nutshell-stable-up`, `DEV=1 make cdk-rc-up`, `DEV=1 make nutshell-rc-up`)
4. Run the integration tests: `npm run test-integration`
5. When finished, tear down: `DEV=1 make cdk-stable-down` / `DEV=1 make nutshell-stable-down`

For browser integration tests, prefer `npm run test-integration:browser:local:cdk` or `npm run test-integration:browser:local:nutshell`; those commands handle fresh mint setup and teardown per browser.

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
npm run test-integration
```

Browser integration tests can be run against an already-running fresh mint:

```bash
npm run test-integration:browser:firefox
```

For local full-browser runs, prefer the wrapper:

```bash
npm run test-integration:browser:local:cdk
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

`main` is the single primary development branch and tracks the **current major**. All new development is merged into `main` via pull requests. Each supported **prior major** is maintained on its own `vN-dev` branch for critical/security fixes only - open backports as a separate PR against the matching `vN-dev` branch (do not mix majors in a single PR). See [Branching model](#branching-model).

## Releases

### Current-major releases on `main` (release-please)

Releases on `main` are automated with [release-please](https://github.com/googleapis/release-please).

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

#### Cutting a release

- A release is created **by merging the Release PR**.
- When the Release PR is merged:
  - A Git tag is created
  - A GitHub Release is published
  - CI builds and publishes the package to npm via `version.yml` (with provenance)

**Merging the Release PR is the release action. No additional steps are required.**

> **Major bumps:** when breaking changes (`feat!` / `fix!`) land on `main`, release-please proposes the next major automatically. To control the pre-release cadence, add a `Release-As: X.0.0-rc.1` footer to a commit so the Release PR targets that version (it publishes to `next`).

### Pre-releases: `next` (RC) vs `experimental` (unstable)

Two distinct pre-release channels - don't conflate them:

- **`next` - release candidates.** `-rc` versions only. The one pre-release we ship from `main`: finalized work that _will_ become GA barring a blocker. Cut from `main` (via a `Release-As: X.Y.Z-rc.1` footer) or a short-lived branch off `main`. `npm i @cashu/cashu-ts@next`.
- **`experimental` - unstable.** `-experimental` versions (e.g. `5.0.0-experimental.a1b2c3d`). Off the release path: speculative bundles of _unmerged_ PRs for real-world testing; may change or be withdrawn and are **not** guaranteed to ship. Produced by [`scripts/make-experimental.sh`](#the-experimental-line), published under `@experimental`. `npm i @cashu/cashu-ts@experimental`.

From `main` we only ever ship `-rc` (→ `next`) or full GA (→ `latest`); anything `-experimental` (or `-alpha`/`-beta`) is unstable and lives on `experimental`. Rule of thumb: `@next` = "trust it, it's coming"; `@experimental` = "kick the tires, no promises".

### LTS releases on `vN-dev` (manual)

release-please only watches `main`, so prior-major maintenance releases are cut manually:

1. Open a release PR targeting `vN-dev`.
2. Commit or cherry-pick the fix to the `vN-dev` branch.
3. Bump `package.json` to the next patch version (e.g. `4.5.1`).
4. Merge the PR into `v4-dev`.
5. Tag the merged `v4-dev` commit that contains the version bump:
   ```bash
   git fetch origin v4-dev --tags
   git tag -a v4.5.1 origin/v4-dev -m "v4.5.1"
   git push origin v4.5.1
   ```
6. Create a GitHub Release from the tag (or use `workflow_dispatch` on the publish workflow with the tag).
7. The publish workflow detects major version 4 and publishes to npm with the `v4-lts` dist-tag.

### npm dist-tags

`version.yml` derives the dist-tag from the version being published (checked in this order):

- `-experimental` / `-beta` / `-alpha` → `experimental` (unstable)
- `-rc` → `next` (release candidate)
- Major equal to `LATEST_MAJOR` (a workflow-level env var) → `latest`
- Any other major → `vN-lts`

| Version            | Tag            | Stability                     | Install                                    |
| ------------------ | -------------- | ----------------------------- | ------------------------------------------ |
| Current major (GA) | `latest`       | stable                        | `npm install @cashu/cashu-ts`              |
| `-rc`              | `next`         | release candidate - will ship | `npm install @cashu/cashu-ts@next`         |
| `-experimental`    | `experimental` | unstable - may change/vanish  | `npm install @cashu/cashu-ts@experimental` |
| Prior major        | `vN-lts`       | maintenance                   | `npm install @cashu/cashu-ts@v3-lts`       |

> `latest` is governed **solely** by `LATEST_MAJOR` in `version.yml`. Any major that is not `LATEST_MAJOR` (and is not a prerelease) falls through to `vN-lts` and can never accidentally become `latest`. `experimental` and `next` are separate channels: an `-experimental` build never lands on `next`, and neither ever becomes `latest`.

### Major transitions

Promoting a new major happens in two steps:

1. **Incoming major lands on `main`.** release-please proposes the new major; cut release candidates (`-rc`), which publish to `next`. Leave `LATEST_MAJOR` unchanged so `latest` keeps pointing at the outgoing major, and start cutting the outgoing major's maintenance releases from its `vN-dev` branch.
2. **GA.** Bump `LATEST_MAJOR` in `version.yml` (one-line PR) and cut the release on `main` - it publishes to `latest`, and the previous major automatically drops to `vN-lts`. Update the branch table above.

### Notes on Versioning

- Follow **Conventional Commits** to ensure correct version bumps.
- Breaking API changes must be clearly marked (`feat!` / `fix!` or `BREAKING CHANGE:`) to trigger a major version bump.
- Version numbers on `main` are determined automatically by release-please; contributors should not attempt to control versions directly.
- LTS and RC versions are bumped manually in `package.json`.

## Troubleshooting (common issues)

- If you see strange compile or api-extractor errors after switching branches: run `npm ci` to ensure `node_modules` matches the checked-in lockfile. If problems persist, try removing `node_modules` and running `npm ci` again.

- To reproduce CI locally, run the same checks your change requires: `npm run check-lint`, `npm run check-format`, `npm run compile`, `npm test`, `npm run api:update` for public API changes, and `npm run test-integration` when mint behavior is involved.

## Contact & maintainers

Feel free to join the [matrix server](https://matrix.to/#/#dev:matrix.cashu.space) or [telegram channel](https://t.me/CashuBTC)
