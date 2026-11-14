#!/usr/bin/env bash
# Used in our CI workflows to bring up a playwright container for webkit testing
# Runs a command in Playwright's image, which ships the browsers and their system libraries.
# The tag follows the lockfile; host networking lets the tests reach a mint on 127.0.0.1.
set -euo pipefail

version=$(node -p "require('./package-lock.json').packages['node_modules/playwright'].version")
exec docker run --rm --network host --user "$(id -u)" -e HOME=/tmp \
  -v "$PWD:/work" -w /work "mcr.microsoft.com/playwright:v${version}-noble" "$@"
