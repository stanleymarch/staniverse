#!/usr/bin/env bash
# Nightly Telegram -> site sync, run from a systemd user timer (see ops/systemd/).
#
# The pipeline is machine-local by design: the raw archive (pipeline/telegram/archive,
# ~3.7 GB) and the Telethon session are git-ignored, so this job runs where they live,
# then publishes only what the site needs: materialized publications and their media.
# The push triggers the production deploy (deploy-storage.yml).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${TELEGRAM_API_ID:?TELEGRAM_API_ID is missing — add it to .env (see README, section Telegram)}"
: "${TELEGRAM_API_HASH:?TELEGRAM_API_HASH is missing — add it to .env (see README, section Telegram)}"

# Telethon lives in a repo-local venv (Arch's python carries no pip module);
# without it the system python is used as-is.
if [[ -d pipeline/telegram/.venv/bin ]]; then
  export PATH="$PWD/pipeline/telegram/.venv/bin:$PATH"
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "master" ]]; then
  echo "refusing to publish from branch '$branch' — switch to master first"
  exit 1
fi

# Remote edits through the Sveltia admin land on master between runs: rebase
# onto them so the nightly publisher never loses the push race. A dirty tree
# or a conflict fails loudly here instead of pushing over someone's work.
git pull --rebase origin master

# Fetch new posts, merge the archive, rebuild media and materialize pages.
# Baseline = highest sourceId already committed. state.json will not do here:
# the fetch above bumps it before anything is published, so after a crashed run
# it runs ahead of the site and the restore filter would eat the new pages.
baseline=$(git grep -h '^sourceId: "' HEAD -- src/content/publications/telegram | sed 's/^sourceId: "\([0-9]*\)".*/\1/' | sort -n | tail -1)
baseline=${baseline:-0}

# Posts the normalizer excluded (foreign forwards, vanished albums) are gone
# from canonical.json on purpose: their pages must stay deleted, not be
# resurrected by the restore guards below.
excluded_guard() {
  local file=$1 id
  id=$(sed -n 's/^sourceId: "\([0-9]*\)".*/\1/p' "$file" 2>/dev/null | head -1 || true)
  if [[ -z "$id" ]]; then id=$(git show "HEAD:$file" 2>/dev/null | sed -n 's/^sourceId: "\([0-9]*\)".*/\1/p' | head -1); fi
  if [[ -n "$id" ]] && ! jq -re --arg id "$id" '.publications[].sourceId | select(. == $id)' pipeline/telegram/archive/canonical.json >/dev/null 2>&1; then
    echo "dropping excluded publication: $file"
    return 0
  fi
  return 1
}

# `telegram:materialize` rewrites every publication page from the enrichment
# bundles, but reviewed topics also live in the pages themselves. Publishing
# that wholesale would silently downgrade curated pages, so keep only what this
# run actually brought: pages whose Telegram id is newer than the baseline.
restore_untouched() {
  git status --porcelain -- src/content/publications/telegram | while read -r _status file; do
    if excluded_guard "$file"; then continue; fi
    # A page this run's materialize dropped has no worktree file to read; an empty
    # id must fall through to the restore branch, not kill the script (sed exits 2
    # on a missing input file, which set -e would propagate).
    id=$(sed -n 's/^sourceId: "\([0-9]*\)".*/\1/p' "$file" 2>/dev/null | head -1 || true)
    if [[ -n "$id" && "$id" -gt "$baseline" ]]; then continue; fi
    echo "restoring untouched publication: $file"
    if git ls-files --error-unmatch "$file" >/dev/null 2>&1; then git checkout -- "$file"; else rm -f "$file"; fi
  done
}

# Stage the given paths, commit them alone and push; returns 1 when there was
# nothing to publish. gh's credential helper keeps the token out of the remote
# URL and of git config.
publish() {
  local message=$1
  shift
  git add -- "$@"
  if git diff --cached --quiet -- "$@"; then
    echo "nothing to publish: $*"
    return 1
  fi
  git commit -q -m "$message" -- "$@"
  git -c credential.helper='!gh auth git-credential' push origin HEAD:master
}

npm run telegram:update
restore_untouched
publish "Telegram sync: $(date -u +%Y-%m-%dT%H:%MZ)" src/content/publications/telegram public/media/telegram || true

# Life channel — same pipeline, separate channel and archive, auto-updates with
# labeling. Without a resolved channel entity (see
# pipeline/telegram/private/LIFE-OPS.md) this block is a no-op, so a machine
# without the private channel stays green.
life_id=$(node -e "const fs=require('fs');try{console.log(JSON.parse(fs.readFileSync('pipeline/telegram/archive/life/source/state.json','utf8')).entityId||'')}catch{console.log('')}")
if [[ -n "$life_id" ]]; then
  python3 pipeline/telegram/fetch_new.py --channel "$life_id" --state pipeline/telegram/archive/life/source/state.json --canonical pipeline/telegram/archive/life/canonical.json --output pipeline/telegram/archive/life/incoming
  npm run telegram:life-sync -- pipeline/telegram/archive/life/incoming/result.json
  npm run enrichment:life-label
  npm run telegram:life-media
  npm run telegram:life-materialize
  publish "Telegram life sync: $(date -u +%Y-%m-%dT%H:%MZ)" src/content/publications/telegram-life public/media/telegram-life || true
  mapfile -t life_suspects < <(jq -r '.[]' pipeline/telegram/archive/life/source/suspect.json 2>/dev/null || true)
  if ((${#life_suspects[@]})); then
    echo "SUSPECT EMPTY LIFE STUBS: ${life_suspects[*]} — upgrade telethon and rewind pipeline/telegram/archive/life/source/state.json to re-fetch"
    exit 1
  fi
fi

# Jev catch-up — only the leftovers, never the whole corpus. The chat-model
# full runs (enrichment:prepare-full + openrouter-full + combine) paid per job
# with no cache hits and would respend the key limit monthly; Jev asks only
# about posts generated/full.json does not freshly cover, resumes for free
# from review/jev-cache after a stop, and defers quietly under the budget
# floor (exit 0). merge.ts lands its topics/entities; relations stay gated.
#
# A retag is only published for pages the sync itself had the last word on
# (their latest commit is a `Telegram sync:` one). A page any human commit ever
# curated keeps its committed topics: that covers hand-review fixes on new
# posts and the keyword-tagged backlog alike, while posts the timer published
# still get their pass whenever it first succeeds.
restore_hand_curated() {
  git status --porcelain -- src/content/publications/telegram | while read -r _status file; do
    # The machine may retag a sync-owned page but never delete a published
    # one: a D entry is always resurrected (a dangling relation target is a
    # broken graph, whatever last touched the page).
    if [[ "$_status" == "D" ]]; then
      # A page whose post left the canonical set (excluded foreign forward) is
      # deleted on purpose; only an unexpected drop is resurrected.
      if excluded_guard "$file"; then continue; fi
      echo "restoring dropped publication: $file"
      git checkout -- "$file"
      continue
    fi
    if [[ $(git log -1 --format=%s -- "$file") == "Telegram sync"* ]]; then continue; fi
    if git ls-files --error-unmatch "$file" >/dev/null 2>&1; then git checkout -- "$file"; else rm -f "$file"; fi
  done
}

npm run enrichment:jev
npm run telegram:materialize
restore_hand_curated
# Hand-curated pages are the reviewed truth; mirror their frontmatter into the
# cache so the materialized-only CI audit (and the Pages preview workflow)
# stays green instead of mailing about staleEnrichment.
npm run enrichment:reconcile
# The deterministic sidecar is committed by design (README): CI audits pages
# against the committed bundles, and a never-committed telegram.json leaves
# hand-curated pages matching neither bundle — the Pages preview failures.
publish "Telegram sync: Jev enrichment $(date -u +%Y-%m-%dT%H:%MZ)" src/content/publications/telegram pipeline/enrichment/generated/full.json pipeline/enrichment/generated/telegram.json || true

# Last, not first: everything valid is already published above. Failing here
# turns the unit red so an empty-stub fetch is impossible to miss — most likely
# a Telegram media constructor newer than the Telethon layer; the repair is
# upgrading telethon and rewinding state.json to re-fetch.
mapfile -t suspects < <(jq -r '.[]' pipeline/telegram/archive/incoming/suspect.json 2>/dev/null || true)
if ((${#suspects[@]})); then
  echo "SUSPECT EMPTY STUBS: ${suspects[*]} — content was NOT captured; upgrade telethon (see requirements-telegram.txt) and rewind pipeline/telegram/archive/source/state.json to re-fetch"
  exit 1
fi
