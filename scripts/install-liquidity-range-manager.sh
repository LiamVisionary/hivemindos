#!/usr/bin/env bash
# Install the shadow-only Uniswap v3 range monitor for the current user.
# Usage:
#   scripts/install-liquidity-range-manager.sh
#   scripts/install-liquidity-range-manager.sh uninstall
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.hivemindos.liquidityrange"
BUNDLE="$REPO_DIR/dist/liquidity-range-manager.mjs"
NODE_BIN="$(command -v node || true)"

bootstrap_launch_agent() {
  local domain="$1"
  local plist="$2"
  local attempt
  for attempt in 1 2 3; do
    if launchctl bootstrap "$domain" "$plist"; then
      return 0
    fi
    if [[ "$attempt" -lt 3 ]]; then
      echo "launchd bootstrap attempt $attempt failed; retrying…" >&2
      sleep 1
    fi
  done
  return 1
}

uninstall() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1 || true
    rm -f "$plist"
    echo "Removed LaunchAgent $LABEL."
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now hivemindos-liquidity-range.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/hivemindos-liquidity-range.service"
    systemctl --user daemon-reload || true
    echo "Removed systemd unit hivemindos-liquidity-range.service."
  fi
  rm -f "$BUNDLE"
  echo "Removed the managed liquidity range daemon bundle."
}

if [[ "${1:-}" == "uninstall" ]]; then
  uninstall
  exit 0
fi

[[ -n "$NODE_BIN" ]] || { echo "node not found on PATH — install Node 20+ first." >&2; exit 1; }

( cd "$REPO_DIR" && npx -y esbuild@0.25.5 scripts/liquidity-range-manager-daemon.mjs \
  --bundle --platform=node --format=esm --packages=external \
  --alias:@=./src --alias:server-only=./scripts/shims/empty.mjs \
  --outfile=dist/liquidity-range-manager.mjs )

if [[ "$(uname -s)" == "Darwin" ]]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>$BUNDLE</string></array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/liquidity-range-manager.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/liquidity-range-manager.err.log</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
  bootstrap_launch_agent "gui/$(id -u)" "$PLIST"
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
  echo "Installed + started $LABEL. Logs: ~/Library/Logs/liquidity-range-manager.log"
elif command -v systemctl >/dev/null 2>&1; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/hivemindos-liquidity-range.service" <<UNIT
[Unit]
Description=HivemindOS shadow liquidity range monitor
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
ExecStart=$NODE_BIN $BUNDLE
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now hivemindos-liquidity-range.service
  echo "Installed + started hivemindos-liquidity-range.service."
else
  echo "No launchd or systemd user service found. Run: pnpm liquidity-range:daemon" >&2
  exit 1
fi
