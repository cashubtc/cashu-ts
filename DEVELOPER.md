# Developer Guide

This document is a quick reference for maintainers and frequent contributors. It complements `CONTRIBUTING.md` (which is contributor-facing) and contains deeper, actionable instructions for setting up, testing, and developing the project.

## Quickstart (one-time)

```bash
# clone
git clone https://github.com/cashubtc/cashu-ts.git
cd cashu-ts

# install exact dependencies used by CI
npm ci

# prepare browser dependencies for integration tests (one-time)
npm run test:prepare

# opt in to local hooks (optional)
npm run setup-hooks
```

Notes:

- `npm ci` requires a package-lock.json and produces a reproducible node_modules tree.
- Node requirement: see `package.json` (engine: `node >=22.4.0`). Use `nvm`, `volta`, or `asdf` to pin your local Node version.

## Environment & toolchain

- Node: >=22.4.0
- Recommended tools: `npm` (node package manager), `git`, optional `nvm`/`volta` for Node version management.
- Optional: Playwright browsers for integration tests (`npm run test:prepare`).

## Hooks internals (how the installer works)

Layout

- Tracked hook sources: `scripts/hooks/` (kept non-executable in the repo)
- Installer target: `.githooks/` (ignored by git; created by `scripts/install-git-hooks.sh`)
- Installer behaviour:
  - copies `scripts/hooks/*` -> `.githooks/`
  - makes the copied files executable
  - sets `git config --local core.hooksPath .githooks`

Why this pattern

- Avoids mode-only diffs on tracked files while providing a one-command opt-in experience.
- Keeps the repo sources auditable and prevents automatic global changes.

Useful commands

```bash
# opt-in (makes and runs the installer)
npm run setup-hooks

# undo opt-in (revert to default hooks path)
npm run uninstall-hooks
```

Authoring hooks

- Edit tracked sources in `scripts/hooks/` and keep them POSIX-friendly where possible.
- When changing hook behaviour, document the change in `CONTRIBUTING.md` and consider adding tests or examples.

## Pre-commit vs pre-push strategy

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

## Versioning & release strategy

Cashu-TS uses semantic versioning. The repository maintains a `development` branch for the current major (v3) and a `dev-v2` branch for critical fixes to the v2 line.

Guidelines:

- New feature PRs for v3 should target the `development` branch.
- If you need to backport a feature to v2, open a separate PR targeting `dev-v2` (do not mix both in a single PR).

### Releases

Releases should be done by the robots, inside the workflow files.
However, here are the release steps for manual flow.

Release steps (manual flow):

1. `git checkout development && git pull` — ensure development is up to date
2. `npm version <major | minor | patch>` — create a new release commit & tag
3. `git push && git push --tags` — push commit and tag
4. Create a new release on GitHub, targeting the new tag
5. CI will build and publish to npm (with provenance)
6. `git checkout main && git pull && git merge <tag>` — merge the tag into `main`

Note: increment the major if there are breaking API changes. Otherwise increment the minor for new features and patch for hotfixes.

## Troubleshooting (common issues)

## Contact & maintainers

Feel free to join the [matrix server](https://matrix.to/#/#dev:matrix.cashu.space) or [telegram channel](https://t.me/CashuBTC)
