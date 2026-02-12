[Documents](../index.html) › **Versions and Releases**

# Versions & Releases

This project uses **Semantic Versioning** and a simplified branching model.

- `main` represents the current major version (v3) and is the only branch for active development.
- The previous major version (v2) is supported via a long-lived **maintenance branch**, used for critical fixes only.
- Direct commits to protected branches are not allowed; all changes are introduced via pull requests.

### Quick pointers

- Target `main` as the base branch for all v3 feature and fix pull requests.
- Target the v2 maintenance branch only for critical fixes to the previous major version.
- Do **not** mix changes for multiple major versions in a single pull request.
- Releases are automated using **release-please** and are created by merging the Release PR.
- Follow **Conventional Commits** to ensure correct version bumps.
- Breaking API changes must be clearly marked to trigger a major version bump.
- Version numbers are determined automatically by release-please; contributors should not attempt to control versions directly.

For a fuller developer-focused guide (setup, hooks, release steps and troubleshooting) see [the developer guide](./doc-src/DEVELOPER.md).
