#!/usr/bin/env bash
# ============================================================================
# make-experimental.sh — rebuild the disposable experimental line
# ============================================================================
#
# WHY THIS EXISTS (read this later when you've forgotten):
#
#   The branch/dist-tag layout, whatever the current major happens to be:
#     vN-dev (LTS)  -> @lts            prior major, manual security-only cuts (no RP)
#     main          -> @latest         current major in dev, FINALIZED work, release-please
#     experimental  -> @experimental   main + speculative PRs, THIS SCRIPT, disposable
#
#   (During a pre-GA window @latest may still sit on the previous major on its
#   vN-dev branch and main sits on @next; once the current major ships, @latest
#   moves to main. The roles above don't change — only which major fills each slot.)
#
#   Speculative work tied to unmerged specs (NUTs that might still change) must
#   NOT touch main — once on main it's a compatibility promise you can't walk
#   back. So it rides a throwaway branch published as @experimental for real-world
#   testing, while the PRs stay OPEN against main.
#
# THE RULES:
#   * The experimental branch is THROWAWAY. Rebuilt from scratch every run.
#   * NEVER promote from it. NEVER merge it back to main.
#   * Promote approved work by merging the individual PR into main (normal PR
#     flow, one at a time onto clean main). Then delete it from PRS below and
#     rebuild — @latest gains it, @experimental drops it.
#   * Order into experimental is irrelevant to main: you promote branches individually,
#     so speculative-vs-speculative conflicts here never recur on main.
#   * git rerere banks your conflict fixes and replays them on the next rebuild,
#     so this is usually hands-off.
#
# USAGE:
#   ./scripts/make-experimental.sh 698 712        # rebuild with these PRs
#   PUBLISH=1 ./scripts/make-experimental.sh 698   # …and npm publish --tag experimental
#   ./scripts/make-experimental.sh                 # no args → read the local list
#   REMOTE=fork ./scripts/make-experimental.sh 698 # PRs live on a non-default remote
#
# REMOTE defaults to `origin` (the canonical cashubtc repo). GitHub mirrors
# every PR — yours and contributors' forks alike — as pull/<N>/head on the base
# repo, so fetching PR heads from `origin` Just Works regardless of fork.
#
# TO CHANGE THE BUNDLE: pass PR numbers as args, or keep them (one per line) in
# scripts/.experimental-prs — a gitignored LOCAL file. Either is the memory,
# not your head. Changing the mix is a local edit, NOT a repo change: no PR
# needed. Only edits to this script's logic go through a PR.
# ============================================================================
set -euo pipefail

# --- config ------------------------------------------------------------------
REMOTE="${REMOTE:-origin}"          # remote hosting the canonical repo + PRs (cashubtc)
BASE="${BASE:-main}"                # curated line the experimental branch sits on top of
BRANCH="${BRANCH:-experimental}"    # version-neutral; survives major bumps

# PR list (merge order): CLI args win; else scripts/.experimental-prs, one PR
# number per line ('#' comments ok). Both are LOCAL — changing the mix is not
# a repo change, so no PR needed. Portable to bash 3.2 (macOS).
PRS=("$@")
if [[ ${#PRS[@]} -eq 0 && -f scripts/.experimental-prs ]]; then
  while read -r n _; do [[ $n =~ ^[0-9]+$ ]] && PRS+=("$n"); done < scripts/.experimental-prs
fi
if [[ ${#PRS[@]} -eq 0 ]]; then
  echo "no PRs given — pass numbers as args, or list them in scripts/.experimental-prs" >&2
  exit 1
fi
# -----------------------------------------------------------------------------

git config rerere.enabled true      # bank conflict resolutions, replay on rebuild
git config rerere.autoupdate true   # AND stage the replay, so rebuilds conclude hands-off

if ! git diff-index --quiet HEAD --; then
  echo "working tree dirty — commit or stash first" >&2; exit 1
fi

echo ">> refreshing $BASE from $REMOTE"
git fetch "$REMOTE" "$BASE"
git branch -D "$BRANCH" 2>/dev/null || true
# Base off FETCH_HEAD (the commit we JUST fetched), not "$REMOTE/$BASE": the
# tracking-ref namespace need not match the remote name — e.g. crossed fetch
# refspecs where `origin/*` actually tracks a fork — which would silently build
# on a stale base. FETCH_HEAD is exactly what we just pulled, refspec-agnostic.
git checkout -B "$BRANCH" FETCH_HEAD
BASE_SHA=$(git rev-parse --short HEAD)   # the $BASE commit this build sits on

for pr in "${PRS[@]}"; do
  echo ">> merging PR #$pr"
  git fetch "$REMOTE" "pull/$pr/head:pr-$pr" --force
  if ! git merge --no-edit "pr-$pr"; then
    if [[ -n "$(git ls-files --unmerged)" ]]; then
      echo "" >&2
      echo "!! unresolved conflict merging PR #$pr — fix the files, then:" >&2
      echo "     git add -A && git commit --no-edit --no-verify" >&2
      echo "   then re-run; rerere replays the fix automatically next time." >&2
      exit 1
    fi
    # rerere replayed a known resolution and staged it — just conclude the merge
    git commit --no-edit --no-verify
    echo ">> rerere auto-resolved PR #$pr"
  fi
done

echo ">> $BRANCH rebuilt: $BASE + ${PRS[*]}"

if [[ "${PUBLISH:-}" == "1" ]]; then
  # Version = main's core version + bundle sha, e.g. 5.0.0-beta.a1b2c3d. The
  # -beta identifier + the explicit @experimental tag mean plain `npm i cashu-ts`
  # never picks it up (@latest unaffected). Unique per bundle (sha changes with
  # the PRs); re-publishing an identical bundle is a harmless no-op (npm rejects
  # the duplicate version).
  # compile (nothing else triggers it on publish) + unit tests on the MERGED
  # tree — each PR passed CI alone, but this catches breakage from combining
  # them, which is the whole point of the experimental build. Not full `prtasks`: lint/format/
  # api-report are repo hygiene that don't affect the published lib/, and
  # api:update mutates files mid-publish. Skip tests with SKIP_TEST=1 to iterate.
  echo ">> building + testing merged tree"
  npm run compile
  # node project only: fast, no Playwright browser dep, no coverage report —
  # enough to catch breakage from combining the PRs. SKIP_TEST=1 to skip.
  [[ "${SKIP_TEST:-}" == "1" ]] || npx vitest run --project node
  ver=$(node -p "require('./package.json').version")
  core=${ver%%-*}
  betaver="${core}-beta.$(git rev-parse --short HEAD)"

  # Record what's in this build so testers know what they're testing against.
  # PR numbers (+ titles if `gh` is installed) go into an `experimentalBundle` field that
  # ships in the package — `npm view cashu-ts@experimental experimentalBundle` — and a
  # paste-ready summary is printed at the end for your announcement.
  slug=$(git config --get "remote.$REMOTE.url" | sed -E 's#.*github\.com[:/]##; s#\.git$##')
  summary=""
  for pr in "${PRS[@]}"; do
    title=""
    if command -v gh >/dev/null 2>&1; then
      title=$(gh pr view "$pr" --repo "$slug" --json title -q .title 2>/dev/null || true)
    fi
    summary+="  #$pr${title:+ — $title}  (https://github.com/$slug/pull/$pr)"$'\n'
  done
  prs_csv=$(IFS=,; echo "${PRS[*]}")
  node -e "const fs=require('fs'),p=require('./package.json');p.experimentalBundle={base:'$BASE@$BASE_SHA',prs:[$prs_csv]};fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"

  echo ">> publishing $betaver @experimental"
  npm version "$betaver" --no-git-tag-version --allow-same-version
  git commit -aqm "chore(experimental): $betaver" --no-verify   # throwaway; skip husky/commitlint
  npm publish --tag experimental

  printf '\n=== announce ===\nnpm i cashu-ts@%s   (tag: experimental)\nbundled on %s@%s:\n%s\n' "$betaver" "$BASE" "$BASE_SHA" "$summary"
fi
