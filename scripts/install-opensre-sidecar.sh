#!/usr/bin/env bash
# Install the HivemindOS-reviewed OpenSRE commit into an isolated venv and run
# only its loopback HTTP investigation gateway. The interactive shell is never
# launched, and the service starts with a minimal environment so HivemindOS
# shared credentials are not inherited. macOS uses launchd; Linux uses a user
# systemd unit.
set -euo pipefail

PINNED_COMMIT="d3a770c365644bb369b9490588333b0e0309c11c"
PORT="${HIVEMINDOS_OPENSRE_PORT:-8111}"
INSTALL_ROOT="$HOME/.hivemindos/opensre"
VENV="$INSTALL_ROOT/venv-${PINNED_COMMIT:0:12}"
RUNNER="$INSTALL_ROOT/run-sidecar.sh"
MANIFEST="$INSTALL_ROOT/install.json"
TOKEN_FILE="$INSTALL_ROOT/gateway-token"
LABEL="com.hivemindos.opensre-sidecar"

uninstall_service() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1 || true
    rm -f "$plist"
    echo "Removed OpenSRE LaunchAgent $LABEL."
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now hivemindos-opensre.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/hivemindos-opensre.service"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    echo "Removed OpenSRE systemd user service."
  fi
}

if [[ "${1:-}" == "uninstall" ]]; then
  uninstall_service
  exit 0
fi

python_bin=""
for candidate in python3.13 python3.12 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' >/dev/null 2>&1; then
    python_bin="$(command -v "$candidate")"
    break
  fi
done
[[ -n "$python_bin" ]] || { echo "Python 3.12+ is required for the optional OpenSRE sidecar." >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git is required to install the pinned OpenSRE source." >&2; exit 1; }

mkdir -p "$INSTALL_ROOT"
if [[ ! -s "$TOKEN_FILE" ]]; then
  "$python_bin" -c 'import secrets, sys; sys.stdout.write(secrets.token_urlsafe(32))' > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi
if [[ ! -x "$VENV/bin/python" ]]; then
  "$python_bin" -m venv "$VENV"
fi
"$VENV/bin/python" -m pip install --disable-pip-version-check --upgrade pip
"$VENV/bin/python" -m pip install --disable-pip-version-check "git+https://github.com/Tracer-Cloud/opensre.git@$PINNED_COMMIT"

cat > "$RUNNER" <<RUNNER
#!/usr/bin/env bash
set -euo pipefail
cd "$INSTALL_ROOT"
exec env -i \
  HOME="$HOME" \
  USER="${USER:-}" \
  PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  OPENSRE_NO_TELEMETRY=1 \
  OPENSRE_PROMPT_LOG_DISABLED=1 \
  OPENSRE_HISTORY_ENABLED=0 \
  OPENSRE_MASK_ENABLED=true \
  OPENSRE_ALERT_LISTENER_TOKEN="\$(cat "$TOKEN_FILE")" \
  LLM_PROVIDER=ollama \
  OLLAMA_HOST=http://127.0.0.1:11434 \
  "$VENV/bin/python" -m uvicorn gateway.http.webapp:app --host 127.0.0.1 --port "$PORT"
RUNNER
chmod 700 "$RUNNER"

cat > "$MANIFEST" <<MANIFEST
{
  "provider": "opensre",
  "commit": "$PINNED_COMMIT",
  "baseUrl": "http://127.0.0.1:$PORT",
  "entrypoint": "gateway.http.webapp:app",
  "interactiveShell": false,
  "autonomousRemediation": false,
  "telemetry": false,
  "promptLogging": false,
  "history": false
}
MANIFEST
chmod 600 "$MANIFEST"

uninstall_service
if [[ "$(uname -s)" == "Darwin" ]]; then
  plist="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$(dirname "$plist")"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$RUNNER</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$INSTALL_ROOT/sidecar.log</string>
  <key>StandardErrorPath</key><string>$INSTALL_ROOT/sidecar.err.log</string>
</dict></plist>
PLIST
  launchctl bootstrap "gui/$(id -u)" "$plist" >/dev/null 2>&1 || launchctl load "$plist"
  launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
elif command -v systemctl >/dev/null 2>&1; then
  unit_dir="$HOME/.config/systemd/user"
  mkdir -p "$unit_dir"
  cat > "$unit_dir/hivemindos-opensre.service" <<UNIT
[Unit]
Description=HivemindOS pinned OpenSRE RCA sidecar
After=network-online.target

[Service]
Type=simple
ExecStart=$RUNNER
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now hivemindos-opensre.service
else
  echo "No launchd or systemd was found; run $RUNNER manually." >&2
  exit 1
fi

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl --silent --output /dev/null --max-time 1 "http://127.0.0.1:$PORT/health"; then
    echo "Installed pinned OpenSRE sidecar at http://127.0.0.1:$PORT."
    echo "Privacy defaults: telemetry off, prompt logging off, history off, masking on; local Ollama provider."
    exit 0
  fi
  sleep 1
done
echo "OpenSRE was installed and its service registered, but /health is not ready yet. Check $INSTALL_ROOT/sidecar.err.log." >&2
exit 1
