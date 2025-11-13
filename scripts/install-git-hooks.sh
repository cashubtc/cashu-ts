#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.githooks"
HOOKS_SRC="$REPO_ROOT/scripts/hooks"

echo "Setting up git hooks to use $HOOKS_DIR"

# configure locally so this doesn't affect global user config
git config --local core.hooksPath "$HOOKS_DIR"

mkdir -p "$HOOKS_DIR"

if [ -d "$HOOKS_SRC" ]; then
  echo "Copying hook sources from scripts/hooks -> .githooks (tracked sources remain unchanged)"
  # Copy files into .githooks; preserve timestamps where possible, overwrite stably
  cp -a "$HOOKS_SRC"/. "$HOOKS_DIR" || true

  echo "Making copied hooks executable"
  find "$HOOKS_DIR" -type f -exec chmod +x {} \; || true

  echo
  echo "Done. Hooks path set to: $(git config --local --get core.hooksPath)"
  echo "You can opt out by running: git config --local --unset core.hooksPath"
else
  echo "Hooks source directory $HOOKS_SRC not found. Create hook sources in scripts/hooks/ and re-run this installer." >&2
  exit 1
fi