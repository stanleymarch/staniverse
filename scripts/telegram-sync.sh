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

# Fetch new posts, merge the archive, rebuild media and materialize pages.
# Baseline = highest sourceId already committed. state.json will not do here:
# the fetch above bumps it before anything is published, so after a crashed run
# it runs ahead of the site and the restore filter would eat the new pages.
baseline=$(git grep -h '^sourceId: "' HEAD -- src/content/publications/telegram | sed 's/^sourceId: "\([0-9]*\)".*/\1/' | sort -n | tail -1)
baseline=${baseline:-0}

# `telegram:materialize` rewrites every publication page from the enrichment
# bundles, but reviewed topics also live in the pages themselves. Publishing
# that wholesale would silently downgrade curated pages, so keep only what this
# run actually brought: pages whose Telegram id is newer than the baseline.
restore_untouched() {
  git status --porcelain -- src/content/publications/telegram | while read -r _status file; do
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

# LLM catch-up. The OpenRouter run is incremental: answers are cached by
# (source hash, model, prompt), so posts already covered by generated/full.json
# cost nothing and a night with no new posts makes zero paid calls; a failed
# night retries itself, because the cache, not this run's diff, drives the work.
# merge.ts lands LLM topics/entities automatically but keeps LLM relations
# gated on an explicit review accept, so no unreviewed claim reaches the graph.
#
# A retag is only published for pages the sync itself had the last word on
# (their latest commit is a `Telegram sync:` one). A page any human commit ever
# curated keeps its committed topics: that covers hand-review fixes on new
# posts and the keyword-tagged backlog alike, while posts the timer published
# still get their LLM pass whenever it first succeeds.
restore_hand_curated() {
  git status --porcelain -- src/content/publications/telegram | while read -r _status file; do
    if [[ $(git log -1 --format=%s -- "$file") == "Telegram sync"* ]]; then continue; fi
    if git ls-files --error-unmatch "$file" >/dev/null 2>&1; then git checkout -- "$file"; else rm -f "$file"; fi
  done
}

npm run enrichment:prepare-full
# A budget stop (monthly key cap) or a provider error exits 1; the content is
# already published above, so defer the retag to the next run instead of
# failing the whole sync.
if npm run enrichment:openrouter-full; then
  npm run enrichment:combine
  npm run telegram:materialize
  restore_hand_curated
  publish "Telegram sync: LLM enrichment $(date -u +%Y-%m-%dT%H:%MZ)" src/content/publications/telegram pipeline/enrichment/generated/full.json || true
else
  echo "LLM enrichment deferred (budget stop or provider error); retried on the next run"
fi
