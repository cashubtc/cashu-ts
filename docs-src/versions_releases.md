# <a href="/">Documents</a> › **Versions and Releases**

# Versions & Releases

This project uses **Semantic Versioning** and a simplified branching model.

- `main` represents the **current major version** and is the only branch for active development.
- Each still-supported prior major is maintained on a long-lived `vN-dev` branch (e.g. `v4-dev`, `v3-dev`), used for critical fixes only.
- Direct commits to protected branches are not allowed; all changes are introduced via pull requests.

### Quick pointers

- Target `main` as the base branch for all feature and fix pull requests.
- Backports to a prior major are label-driven: land the fix on `main`, then add a `backport vN-dev` label to the PR — a bot opens the backport PR automatically.
- Do **not** mix changes for multiple major versions in a single pull request.
- Releases are automated using **release-please** on `main` and each `vN-dev` branch, and are created by merging that branch's Release PR.
- Follow **Conventional Commits** to ensure correct version bumps.
- Breaking API changes must be clearly marked to trigger a major version bump.
- Version numbers are determined automatically by release-please; contributors should not attempt to control versions directly.
- Release notes for every version across all release lines are on the [GitHub Releases page](https://github.com/cashubtc/cashu-ts/releases).

For a fuller developer-focused guide (setup, hooks, release steps and troubleshooting) see [the developer guide](../DEVELOPER.md).
