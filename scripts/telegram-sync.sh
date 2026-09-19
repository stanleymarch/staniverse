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
npm run telegram:update

# Publish only the generated content: user work in progress in other paths stays untracked.
paths=(src/content/publications/telegram public/media/telegram)
git add -- "${paths[@]}"
if git diff --cached --quiet -- "${paths[@]}"; then
  echo "no new publications"
  exit 0
fi
git commit -q -m "Telegram sync: $(date -u +%Y-%m-%dT%H:%MZ)" -- "${paths[@]}"

# gh's credential helper keeps the token out of the remote URL and of git config.
git -c credential.helper='!gh auth git-credential' push origin HEAD:master
