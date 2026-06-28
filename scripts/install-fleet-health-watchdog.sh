#!/usr/bin/env bash
# Install the fleet health watchdog as a background service so it keeps the
# connected machines' agent collectors alive with the HivemindOS app fully
# closed. It probes each machine's collector and force-restarts it via the
# hive-native linkd shell when it's functionally down (covering the case launchd
# KeepAlive / systemd Restart cannot: alive-but-broken, e.g. spawn EBADF). Run
# this on the machine that hosts the dashboard (it watches the OTHER machines).
# macOS → a LaunchAgent; Linux → a systemd --user unit. The watchdog is pure
# Node (no build step). No SSH and no pinned tailnet IPs.
#
# Usage:
#   scripts/install-fleet-health-watchdog.sh           # install + start
#   scripts/install-fleet-health-watchdog.sh uninstall # stop + remove the service
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.hivemindos.fleet-health-watchdog"
SCRIPT="$REPO_DIR/scripts/fleet-health-watchdog.mjs"
NODE_BIN="$(command -v node || true)"

uninstall() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1 || true
    rm -f "$plist"
    echo "Removed LaunchAgent $LABEL."
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now hivemindos-fleet-health-watchdog.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/hivemindos-fleet-health-watchdog.service"
    systemctl --user daemon-reload || true
    echo "Removed systemd unit hivemindos-fleet-health-watchdog.service."
  fi
}

if [[ "${1:-}" == "uninstall" ]]; then
  uninstall
  exit 0
fi

[[ -n "$NODE_BIN" ]] || { echo "node not found on PATH — install Node 20+ first." >&2; exit 1; }
[[ -f "$SCRIPT" ]] || { echo "watchdog script missing at $SCRIPT" >&2; exit 1; }

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
  <key>StandardOutPath</key><string>$HOME/Library/Logs/fleet-health-watchdog.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/fleet-health-watchdog.err.log</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl load "$PLIST" >/dev/null 2>&1 || true
  launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  echo "Installed + started LaunchAgent $LABEL. Logs: ~/Library/Logs/fleet-health-watchdog.log + ~/.hivemindos/fleet-health-watchdog.log"
elif command -v systemctl >/dev/null 2>&1; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/hivemindos-fleet-health-watchdog.service" <<UNIT
[Unit]
Description=HivemindOS fleet health watchdog
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
  systemctl --user enable --now hivemindos-fleet-health-watchdog.service
  echo "Installed + started systemd unit hivemindos-fleet-health-watchdog.service. Logs: journalctl --user -u hivemindos-fleet-health-watchdog -f"
else
  echo "No launchd or systemd found. Run the watchdog manually with: node $SCRIPT" >&2
  exit 1
fi
