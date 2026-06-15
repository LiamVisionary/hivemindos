#!/usr/bin/env bash
# One-command deploy for the Telegram $HIVE tip bot to the Hetzner VPS.
#
# Run this ON THE MAC (the source tree lives here). It:
#   1. runs the fast ledger/parse tests as a gate,
#   2. rsyncs the repo to the VPS (code only — never .env or secrets),
#   3. rebuilds the standalone esbuild bundle on the VPS,
#   4. restarts the systemd service and verifies it polls cleanly.
#
# Usage:
#   scripts/deploy-telegram-tip-bot.sh            # full deploy
#   scripts/deploy-telegram-tip-bot.sh --skip-tests
#
# Overridable via env: TIPBOT_HOST, TIPBOT_SSH_KEY, TIPBOT_REMOTE_DIR, TIPBOT_SERVICE
set -euo pipefail

HOST="${TIPBOT_HOST:-root@77.42.92.236}"
SSH_KEY="${TIPBOT_SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_DIR="${TIPBOT_REMOTE_DIR:-/root/hivemind-os}"
SERVICE="${TIPBOT_SERVICE:-hivemind-tipbot}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes)

skip_tests=0
[[ "${1:-}" == "--skip-tests" ]] && skip_tests=1

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mDEPLOY ABORTED: %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f "$SSH_KEY" ]] || die "SSH key not found at $SSH_KEY — run this on the Mac that has VPS access."
[[ -d "$REPO_DIR/src/lib/services/telegram-tip-bot" ]] || die "Tip bot source not found — are you in the hivemind-os repo?"

if [[ "$skip_tests" -eq 0 ]]; then
  say "Running tip-bot tests (gate)"
  node --test "$REPO_DIR/scripts/test-telegram-tip-bot.mjs" || die "tests failed — fix before deploying (or pass --skip-tests)."
fi

say "Syncing code to $HOST:$REMOTE_DIR (secrets excluded)"
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude .next --exclude src-tauri/target \
  --exclude out --exclude coverage --exclude "*.log" --exclude ".env*" \
  -e "ssh ${SSH_OPTS[*]}" \
  "$REPO_DIR/" "$HOST:$REMOTE_DIR/" || die "rsync failed."

say "Rebuilding bundle + restarting $SERVICE on the VPS"
ssh "${SSH_OPTS[@]}" "$HOST" bash -s <<REMOTE || die "remote build/restart failed."
set -euo pipefail
cd "$REMOTE_DIR"
npx -y esbuild@0.25.5 scripts/telegram-tip-bot-daemon.mjs \
  --bundle --platform=node --format=esm --alias:@=./src \
  --alias:server-only=./scripts/shims/empty.mjs \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' \
  --outfile=dist/telegram-tip-bot.mjs
systemctl restart $SERVICE
REMOTE

say "Verifying (15s settle)"
sleep 15
ssh "${SSH_OPTS[@]}" "$HOST" bash -s <<REMOTE
set -uo pipefail
state="\$(systemctl show $SERVICE -p ActiveState --value)"
echo "service: \$state"
journalctl -u $SERVICE --no-pager --since "20 seconds ago" -o cat | grep -vE "Deprecation|trace-deprecation" | tail -5
if journalctl -u $SERVICE --no-pager --since "20 seconds ago" -o cat | grep -qi "Conflict"; then
  echo "WARNING: 409 Conflict — another poller holds the token (check the Mac app / stale process)."
fi
[ "\$state" = "active" ] && echo "OK: $SERVICE is active." || { echo "FAIL: $SERVICE not active."; exit 1; }
REMOTE

say "Deploy complete."
