#!/usr/bin/env bash
set -uo pipefail

mint="${1:-cdk}"
shift || true

browsers=("$@")
if [ "${#browsers[@]}" -eq 0 ]; then
  browsers=(chromium firefox webkit)
fi

active_down_target=""

cleanup() {
  if [ -n "$active_down_target" ]; then
    DEV=1 make "$active_down_target" || true
  fi
}

trap cleanup EXIT

case "$mint" in
  cdk | nutshell) ;;
  *)
    echo "Usage: $0 [cdk|nutshell] [chromium|firefox|webkit ...]" >&2
    exit 2
    ;;
esac

wait_for_mint() {
  local timeout=90
  local interval=2
  local elapsed=0
  local host_url="http://127.0.0.1:3338/v1/info"

  until curl --silent --show-error --fail --max-time 5 "$host_url" > /dev/null; do
    if [ "$elapsed" -ge "$timeout" ]; then
      echo "Timed out waiting for mint at $host_url" >&2
      return 1
    fi
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
}

run_browser() {
  local browser="$1"
  local up_target="${mint}-stable-up"
  local down_target="${mint}-stable-down"
  local status=0

  case "$browser" in
    chromium | firefox | webkit) ;;
    *)
      echo "Unknown browser: $browser" >&2
      return 2
      ;;
  esac

  echo "Starting fresh ${mint} mint for ${browser}..."
  DEV=1 make "$up_target" || return $?
  active_down_target="$down_target"

  wait_for_mint
  status=$?
  if [ "$status" -eq 0 ]; then
    npm run "test-integration:browser:${browser}"
    status=$?
  fi

  echo "Stopping ${mint} mint for ${browser}..."
  DEV=1 make "$down_target"
  active_down_target=""

  return "$status"
}

for browser in "${browsers[@]}"; do
  run_browser "$browser" || exit $?
done
