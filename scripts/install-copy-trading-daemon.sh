#!/usr/bin/env bash
# Install the copy-trading daemon as a background service so configs keep
# mirroring with the HivemindOS app fully closed. macOS → a LaunchAgent;
# Linux → a systemd --user unit. The daemon is the SOLE execution host, so do
# NOT also run `pnpm copy-trading:daemon` in a terminal while the service runs.
#
# Usage:
#   scripts/install-copy-trading-daemon.sh           # bundle + install + start
#   scripts/install-copy-trading-daemon.sh uninstall # stop + remove the service
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.hivemindos.copytrading"
BUNDLE="$REPO_DIR/dist/copy-trading.mjs"
NODE_BIN="$(command -v node || true)"

uninstall() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1 || true
    rm -f "$plist"
    echo "Removed LaunchAgent $LABEL."
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now hivemindos-copy-trading.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/hivemindos-copy-trading.service"
    systemctl --user daemon-reload || true
    echo "Removed systemd unit hivemindos-copy-trading.service."
  fi
}

if [[ "${1:-}" == "uninstall" ]]; then
  uninstall
  exit 0
fi

[[ -n "$NODE_BIN" ]] || { echo "node not found on PATH — install Node 20+ first." >&2; exit 1; }

echo "Bundling daemon → $BUNDLE"
( cd "$REPO_DIR" && npx -y esbuild@0.25.5 scripts/copy-trading-daemon.mjs \
  --bundle --platform=node --format=esm --packages=external \
  --alias:@=./src --alias:server-only=./scripts/shims/empty.mjs \
  --outfile=dist/copy-trading.mjs )

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
  <array>
    <string>$NODE_BIN</string>
    <string>$BUNDLE</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/copy-trading.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/copy-trading.err.log</string>
  </dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
  loaded=""
  for attempt in 1 2 3 4 5; do
    if launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1; then
      loaded="yes"
      break
    fi
    sleep 0.5
  done
  if [[ -z "$loaded" ]] && launchctl load "$PLIST" >/dev/null 2>&1; then
    loaded="yes"
  fi
  if [[ -z "$loaded" ]] || ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    echo "Failed to register LaunchAgent $LABEL." >&2
    exit 1
  fi
  launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null
  echo "Installed + started LaunchAgent $LABEL. Logs: ~/Library/Logs/copy-trading.log"
elif command -v systemctl >/dev/null 2>&1; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/hivemindos-copy-trading.service" <<UNIT
[Unit]
Description=HivemindOS copy-trading daemon
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
  systemctl --user enable --now hivemindos-copy-trading.service
  echo "Installed + started systemd unit hivemindos-copy-trading.service. Logs: journalctl --user -u hivemindos-copy-trading -f"
else
  echo "No launchd or systemd found. Run the daemon manually with: node $BUNDLE" >&2
  exit 1
fi
