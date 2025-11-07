# Contribution Guide

## API-Extractor

This library runs [API-Extractor](https://api-extractor.com/) in its CI pipeline to ensure API changes are intentional and properly reviewed.
The process involves two kinds of reports:

- `/temp/*.md`: The reports in the `temp` directory are created on your local machine and compared against the status quo report. These must not be commited.
- `/etc/cashu-ts.api.md`: This report is the status quo report and is included in the repository. Local versions are compared against this report to detect changes.

There are two scripts to interact with the API-Extractor:

`npm run api:check`
This command will create an API report in the `/temp` directory and compare it against the current status quo report (`/etc/cashu-ts.api.md`). The `/temp` report is not supposed to be commited.
If the two differ, the public API has changed and you will see a warning in the console.

`npm run api:update`
This command will create an API report in the `/temp` directory AND update the status quo report in `/etc`. If there are changes to the status quo report commit the updated report. Otherwise CI will fail.

## Build output contracts

- **TS sources** use extensionless imports.
- **Runtime ESM** (`lib/**/*.js`) must have `.js` on relative imports.
- **Type declarations** (`lib/types/**/*.d.ts`) must stay **extensionless**.
- Our `post-process-dts.js` intentionally skips `.d.ts` to keep API Extractor happy.

## Local git hooks (optional)

This repository provides an optional, repo‑tracked hook _source_ at `scripts/hooks/pre-commit`. Hooks are not enabled by default. To opt in locally, run the installer which copies the tracked sources into an ignored `.githooks/` folder, makes the copies executable, and configures Git to use that folder:

```bash
# from the repository root
chmod +x scripts/install-git-hooks.sh
./scripts/install-git-hooks.sh
```

What the installer does:

- Copies `scripts/hooks/*` -> `.githooks/` (the copies are made executable)
- Sets `git config --local core.hooksPath .githooks`

What the hook does (pre-commit):

- Runs `npm run lint` (must pass)
- Runs `npm run format` (may modify files; modified files are auto-staged)
- Runs `npm test` (must pass)

Notes:

- `.githooks/` is ignored by git (so installer-made executable copies won't be tracked or committed).
- This is a local convenience — CI still enforces the checks server-side. Team members opt in individually by running the installer.
- To opt out / revert the change (remove the custom hooks path):

```bash
git config --local --unset core.hooksPath
```

### Full PR checks

There is a convenience script `npm run prtasks` that runs the full suite used for PRs and CI:

- lint
- format
- api:update (this runs compile + api-extractor and may modify generated files)
- test

This can be slow and may modify files (notably `api:update` and `format`), so it is not run by default on every commit. Instead:

- The installed `pre-commit` hook runs a quick lint+format check (fast feedback).
- The installed `pre-push` hook runs `npm run prtasks` to ensure full checks before code is pushed.
- You can run `npm run prtasks` manually before opening a PR to avoid CI surprises.

If you want the pre-commit hook to run the full tasks for a single commit, set the env var `FULL_PRECOMMIT=1` when committing:

```bash
FULL_PRECOMMIT=1 git commit -m "..."
```
