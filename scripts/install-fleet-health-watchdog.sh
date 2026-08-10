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
PROBE_PROFILE="$HOME/.hermes/profiles/runtime-capability-probe"

run_with_timeout() {
  local seconds="$1"
  shift
  "$@" &
  local pid="$!"
  local elapsed=0
  while kill -0 "$pid" >/dev/null 2>&1; do
    if (( elapsed >= seconds )); then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
      kill -9 "$pid" >/dev/null 2>&1 || true
      wait "$pid" >/dev/null 2>&1 || true
      return 124
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  wait "$pid"
}

launchctl_bounded() {
  local seconds="$1"
  shift
  run_with_timeout "$seconds" launchctl "$@"
}

# The deep /chat liveness probe runs under this RESERVED hermes profile so its
# turns never land in a real agent's history / the dashboard chat tree (the
# collector hides the slug via RESERVED_HERMES_PROFILE_SLUGS). hermes reads
# provider keys from $HERMES_HOME/.env, so symlink the default env in — no secret
# copy, and the link resolves once ~/.hermes/.env exists. Keep in sync with the
# FLEET_WATCHDOG_PROBE_PROFILE default in scripts/fleet-health-watchdog.mjs.
seed_probe_profile() {
  mkdir -p "$PROBE_PROFILE"
  ln -sfn "$HOME/.hermes/.env" "$PROBE_PROFILE/.env"
}
unseed_probe_profile() {
  rm -f "$PROBE_PROFILE/.env"
  rmdir "$PROBE_PROFILE" 2>/dev/null || true
}

uninstall() {
  unseed_probe_profile
  if [[ "$(uname -s)" == "Darwin" ]]; then
    local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
    launchctl_bounded 5 bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl_bounded 5 unload "$plist" >/dev/null 2>&1 || true
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

seed_probe_profile

if [[ "$(uname -s)" == "Darwin" ]]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  PLIST_NEXT="$PLIST.next.$$"
  mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs"
  cat > "$PLIST_NEXT" <<PLIST
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
  if [[ -f "$PLIST" ]] && cmp -s "$PLIST_NEXT" "$PLIST" \
    && launchctl_bounded 2 print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    rm -f "$PLIST_NEXT"
    echo "Fleet health watchdog LaunchAgent is already current and running."
  else
    mv -f "$PLIST_NEXT" "$PLIST"
    launchctl_bounded 5 bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl_bounded 5 unload "$PLIST" >/dev/null 2>&1 || true
    launchctl_bounded 5 bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl_bounded 5 load "$PLIST" >/dev/null 2>&1 || true
    launchctl_bounded 5 kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    echo "Installed + started LaunchAgent $LABEL. Logs: ~/Library/Logs/fleet-health-watchdog.log + ~/.hivemindos/fleet-health-watchdog.log"
  fi
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
