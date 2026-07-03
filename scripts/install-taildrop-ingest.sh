#!/usr/bin/env bash
# Install the Taildrop ingest watcher as a background service: it drains
# Tailscale's Taildrop file inbox into ~/HiveDrop (override with
# HIVE_TAILDROP_INGEST_DIR) and announces arrivals in the dashboard
# notifications feed — making the iOS/Android share sheet (Share → Tailscale →
# this machine) a first-class HiveDrop ingest path.
# macOS → a LaunchAgent; Linux → a systemd --user unit. Pure Node, no build.
#
# Usage:
#   scripts/install-taildrop-ingest.sh           # install + start
#   scripts/install-taildrop-ingest.sh uninstall # stop + remove the service
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.hivemindos.taildrop-ingest"
SCRIPT="$REPO_DIR/scripts/taildrop-ingest-watcher.mjs"
NODE_BIN="$(command -v node || true)"

uninstall() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1 || true
    rm -f "$plist"
    echo "Removed LaunchAgent $LABEL."
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now hivemindos-taildrop-ingest.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/hivemindos-taildrop-ingest.service"
    systemctl --user daemon-reload || true
    echo "Removed systemd unit hivemindos-taildrop-ingest.service."
  fi
}

if [[ "${1:-}" == "uninstall" ]]; then
  uninstall
  exit 0
fi

[[ -n "$NODE_BIN" ]] || { echo "node not found on PATH — install Node 20+ first." >&2; exit 1; }
[[ -f "$SCRIPT" ]] || { echo "watcher script missing at $SCRIPT" >&2; exit 1; }

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
    <string>$SCRIPT</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/taildrop-ingest.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/taildrop-ingest.err.log</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl load "$PLIST" >/dev/null 2>&1 || true
  launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  echo "Installed + started LaunchAgent $LABEL. Files land in \${HIVE_TAILDROP_INGEST_DIR:-~/HiveDrop}; logs: ~/.hivemindos/taildrop-ingest.log"
elif command -v systemctl >/dev/null 2>&1; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/hivemindos-taildrop-ingest.service" <<UNIT
[Unit]
Description=HivemindOS Taildrop ingest watcher
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
ExecStart=$NODE_BIN $SCRIPT
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now hivemindos-taildrop-ingest.service
  echo "Installed + started systemd unit hivemindos-taildrop-ingest.service. Files land in \${HIVE_TAILDROP_INGEST_DIR:-~/HiveDrop}."
else
  echo "No launchd or systemd found. Run the watcher manually with: node $SCRIPT" >&2
  exit 1
fi
