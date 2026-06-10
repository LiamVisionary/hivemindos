#!/usr/bin/env bash
# Install + supervise the Claw backend — the gateway that the Claw Code Mobile
# iPhone app talks to so it can run a coding agent on THIS machine's repos
# (file edit/glob/grep, git, terminal, preview). HivemindOS ships it as a
# managed service so a user who installed only HivemindOS gets it automatically;
# they never touch the app's source repo.
#
# It downloads a prebuilt, self-contained artifact for this OS/arch (Node server
# run via tsx + a per-platform better-sqlite3 prebuild + the Rust `claw` agent
# binary), extracts to ~/.hivemindos/claw, and runs it under launchd/systemd.
# The phone reaches it over the tailnet via the fleet app-proxy; it trusts the
# tailnet (HIVEMIND_MODE=1) so no token is needed.
#
# Voice calling (proactive + in-app calls) is optional: drop LiveKit creds into
# ~/.hivemindos/claw/voice.env and a SECOND managed service (the LiveKit voice
# worker) is installed alongside the gateway so answered calls connect a voice.
# With voice.env blank, only the gateway runs and calling stays off.
#
# Env overrides:
#   CLAW_BACKEND_ARTIFACT     path to a local .tar.gz (skips download — for testing)
#   CLAW_BACKEND_PUBLIC_BASE  R2 public bucket base URL (set this once for your bucket)
#   CLAW_BACKEND_VERSION      pinned version (matches the release tag, e.g. v0.1.0)
#   CLAW_BACKEND_BASE_URL     full base incl. version (overrides the two above)
#   CLAW_HOME                 install dir (default ~/.hivemindos/claw)
#
# Artifacts are published to an R2 bucket and served by a small Worker at
#   <public-base>/claw-backend/<version>/claw-backend-<os>-<arch>.tar.gz
# The default base is the project's download Worker (claw-dl, on *.workers.dev),
# used instead of the bucket's r2.dev URL because r2.dev is rate-limited and is
# blocked/filtered on some networks. Override CLAW_BACKEND_PUBLIC_BASE to point
# at your own host — see docs/claw-backend-release.md in the source repo.
set -euo pipefail

CLAW_HOME="${CLAW_HOME:-$HOME/.hivemindos/claw}"
CLAW_VERSION="${CLAW_BACKEND_VERSION:-v0.3.0}"
CLAW_PUBLIC_BASE="${CLAW_BACKEND_PUBLIC_BASE:-https://claw-dl.hivemindos.workers.dev}"
CLAW_BASE_URL="${CLAW_BACKEND_BASE_URL:-$CLAW_PUBLIC_BASE/claw-backend/$CLAW_VERSION}"

os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
  Darwin) osn=darwin ;;
  Linux) osn=linux ;;
  *) echo "[claw] unsupported OS: $os — skipping Claw backend" >&2; exit 0 ;;
esac
case "$arch" in
  arm64|aarch64) an=arm64 ;;
  x86_64|amd64) an=amd64 ;;
  *) echo "[claw] unsupported arch: $arch — skipping Claw backend" >&2; exit 0 ;;
esac
ASSET="claw-backend-$osn-$an.tar.gz"

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "[claw] Node not found on PATH; cannot run the Claw backend" >&2; exit 1; }

mkdir -p "$CLAW_HOME"

# 1) Obtain the artifact (local override, else download + verify sha256).
if [ -n "${CLAW_BACKEND_ARTIFACT:-}" ]; then
  TARBALL="$CLAW_BACKEND_ARTIFACT"
  echo "[claw] using local artifact: $TARBALL"
  [ -f "$TARBALL" ] || { echo "[claw] artifact not found: $TARBALL" >&2; exit 1; }
else
  TARBALL="$CLAW_HOME/$ASSET"
  echo "[claw] downloading $CLAW_BASE_URL/$ASSET"
  curl -fsSL "$CLAW_BASE_URL/$ASSET" -o "$TARBALL"
  if curl -fsSL "$CLAW_BASE_URL/$ASSET.sha256" -o "$TARBALL.sha256" 2>/dev/null; then
    echo "[claw] verifying checksum"
    ( cd "$(dirname "$TARBALL")" \
        && { shasum -a 256 -c "$(basename "$TARBALL").sha256" 2>/dev/null \
             || sha256sum -c "$(basename "$TARBALL").sha256"; } ) \
      || { echo "[claw] checksum verification FAILED" >&2; exit 1; }
  else
    echo "[claw] (no .sha256 published; skipping checksum)" >&2
  fi
fi

# 2) Extract and swap into place (leaving DATA_DIR untouched across upgrades).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$TARBALL" -C "$TMP"
SRC="$TMP/claw-backend-$osn-$an"
[ -d "$SRC" ] || SRC="$(find "$TMP" -maxdepth 1 -type d -name 'claw-backend-*' | head -1)"
[ -d "$SRC/backend" ] || { echo "[claw] unexpected artifact layout under $SRC" >&2; exit 1; }

rm -rf "$CLAW_HOME/backend" "$CLAW_HOME/bin"
cp -R "$SRC/backend" "$CLAW_HOME/backend"
cp -R "$SRC/bin" "$CLAW_HOME/bin"
cp "$SRC/run.sh" "$CLAW_HOME/run.sh" 2>/dev/null || true
chmod +x "$CLAW_HOME/bin/claw" "$CLAW_HOME/run.sh" 2>/dev/null || true

DATA_DIR="$CLAW_HOME/data"; mkdir -p "$DATA_DIR"
SERVER_ENTRY="$CLAW_HOME/backend/src/server.ts"
WORKER_ENTRY="$CLAW_HOME/backend/src/voice/callAgentWorker.ts"

# 3) Voice/calling config. Proactive + in-app voice calls need LiveKit creds
#    (and, for backgrounded push calls, an Apple VoIP key). These are operator
#    secrets, so they live in a persisted env file that survives upgrades — the
#    backend bundle is wiped+replaced above, but voice.env (like data/) is not.
#    The OpenAI realtime key is NOT needed here: the app syncs it from its Models
#    tab and the gateway forwards it to the worker per call.
VOICE_ENV="$CLAW_HOME/voice.env"
if [ ! -f "$VOICE_ENV" ]; then
  cat > "$VOICE_ENV" <<'VENV'
# Claw voice calling — operator secrets (sourced by the gateway + voice worker).
# Fill these in to enable scheduled/in-app voice calls, then re-run this
# installer (or restart the services). Leaving them blank keeps calling off;
# everything else (the coding agent) works regardless.
#
# LiveKit project (https://cloud.livekit.io -> Settings -> Keys). REQUIRED for calls.
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
#
# Apple VoIP push (only for backgrounded CallKit calls; in-app calls don't need it).
# APNS_AUTH_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
# APNS_KEY_ID=
# APNS_TEAM_ID=
# APNS_BUNDLE_ID=com.liamvisionary.clawcodemobile
# APNS_ENVIRONMENT=sandbox
#
# Optional non-OpenAI realtime voices (OpenAI uses the app-synced key instead):
# XAI_API_KEY=          # grok-voice
# GEMINI_API_KEY=       # gemini-live
#
# Optional: outbound SIP (dial a real phone number when the app is closed).
# LIVEKIT_SIP_TRUNK_ID=
VENV
  chmod 600 "$VOICE_ENV"
  echo "[claw] wrote voice config template: $VOICE_ENV (fill in LIVEKIT_* to enable calls)"
fi

# Generate self-contained launchers. They bake in the absolute node + paths
# (launchd/systemd run with a minimal PATH) and source voice.env at RUNTIME, so
# editing creds + restarting the service suffices — no reinstall. Generated here
# (not taken from the artifact) so this works with any already-published bundle.
cat > "$CLAW_HOME/launch-gateway.sh" <<LAUNCH
#!/usr/bin/env bash
set -uo pipefail
export HIVEMIND_MODE=1
export DATA_DIR="$DATA_DIR"
# Honor a CLAW_BINARY supplied by the caller (the app-hosted gateway passes the
# claw bundled inside the signed .app, so its file access inherits the app's TCC
# grant). Fall back to the installed copy for the headless launchd path.
: "\${CLAW_BINARY:=$CLAW_HOME/bin/claw}"
export CLAW_BINARY
# A malformed voice.env must never take the gateway down — source it tolerantly.
if [ -f "$VOICE_ENV" ]; then set -a; . "$VOICE_ENV" 2>/dev/null || true; set +a; fi
mkdir -p "$DATA_DIR"
cd "$CLAW_HOME/backend"
exec "$NODE_BIN" --import tsx "$SERVER_ENTRY"
LAUNCH

cat > "$CLAW_HOME/launch-worker.sh" <<LAUNCH
#!/usr/bin/env bash
# The LiveKit voice-agent worker — the SEPARATE process that joins answered call
# rooms and actually speaks. Without it, calls ring and the phone joins but no
# agent is there. LIVEKIT_* come from voice.env; the realtime key + vault path
# arrive per call via the dispatch metadata.
set -uo pipefail
if [ -f "$VOICE_ENV" ]; then set -a; . "$VOICE_ENV" 2>/dev/null || true; set +a; fi
cd "$CLAW_HOME/backend"
exec "$NODE_BIN" --import tsx "$WORKER_ENTRY" start
LAUNCH
chmod +x "$CLAW_HOME/launch-gateway.sh" "$CLAW_HOME/launch-worker.sh"

# Record the binary that actually reads the filesystem (the gateway's Node
# process) so the desktop app's "pair your phone" onboarding can point macOS
# Full Disk Access straight at it. The gateway runs as a headless launchd agent,
# which macOS never lets show a permission prompt — so a one-time grant against
# this exact binary is what unblocks phone file browsing of protected folders
# (Downloads/Desktop/Documents).
printf '%s\n' "$NODE_BIN" > "$CLAW_HOME/gateway-fda-target.txt" 2>/dev/null || true

# Run the voice worker only when LiveKit creds are actually present.
VOICE_CONFIGURED=0
if [ -f "$VOICE_ENV" ]; then
  if ( set -a; . "$VOICE_ENV" 2>/dev/null || true; set +a
       [ -n "${LIVEKIT_URL:-}" ] && [ -n "${LIVEKIT_API_KEY:-}" ] && [ -n "${LIVEKIT_API_SECRET:-}" ] ); then
    VOICE_CONFIGURED=1
  fi
fi

# launchctl bootout is asynchronous: an immediate bootstrap can race the still
# tearing-down instance and silently no-op, leaving the service DOWN. Wait for
# the old instance to fully unload, then bootstrap the new plist + kickstart.
relaunch_agent() {
  local label="$1" plist="$2" domain i
  domain="gui/$(id -u)"
  launchctl bootout "$domain/$label" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1 || true
  for i in 1 2 3 4 5 6 7 8; do
    launchctl print "$domain/$label" >/dev/null 2>&1 || break
    sleep 1
  done
  launchctl bootstrap "$domain" "$plist" >/dev/null 2>&1 || launchctl load "$plist" >/dev/null 2>&1 || true
  launchctl kickstart -k "$domain/$label" >/dev/null 2>&1 || true
}

# 4) Register + (re)start the services through the launchers above (which set
#    env, cwd, and source voice.env). The gateway always runs; the voice worker
#    runs only when configured.
if [[ "$os" == "Darwin" ]]; then
  # On macOS the agent gateway is hosted by the signed HivemindOS.app (so claw's
  # file writes are attributed to com.hivemindos.desktop and get a one-click folder
  # grant). A headless launchd gateway must NOT run here: it spawns the EXTERNAL
  # claw as its own TCC-responsible process (denied ~/Downloads etc.) and races the
  # app for the gateway port. Retire any previously-installed backend job and do not
  # recreate it. (launch-gateway.sh stays — the app runs it; the voice worker below
  # is a separate job that doesn't bind the gateway port and is left intact.)
  launchctl bootout "gui/$(id -u)/com.hivemindos.claw-backend" 2>/dev/null || true
  launchctl disable "gui/$(id -u)/com.hivemindos.claw-backend" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.hivemindos.claw-backend.plist"
  echo "[claw] gateway is now hosted by the signed HivemindOS app (one-click folder grant) — headless launchd backend retired"

  WPLIST="$HOME/Library/LaunchAgents/com.hivemindos.claw-voice-worker.plist"
  if [ "$VOICE_CONFIGURED" = "1" ]; then
    cat > "$WPLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.hivemindos.claw-voice-worker</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$CLAW_HOME/launch-worker.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/hivemindos-claw-voice-worker.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/hivemindos-claw-voice-worker.err.log</string>
</dict>
</plist>
PLIST
    relaunch_agent "com.hivemindos.claw-voice-worker" "$WPLIST"
    echo "[claw] installed launchd service com.hivemindos.claw-voice-worker (voice calling ON)"
  else
    launchctl bootout "gui/$(id -u)/com.hivemindos.claw-voice-worker" >/dev/null 2>&1 || launchctl unload "$WPLIST" >/dev/null 2>&1 || true
    rm -f "$WPLIST"
    echo "[claw] voice calling not configured (no LIVEKIT_* in $VOICE_ENV) — voice worker not started."
  fi
else
  SERVICE="$HOME/.config/systemd/user/hivemindos-claw-backend.service"
  mkdir -p "$(dirname "$SERVICE")"
  cat > "$SERVICE" <<SERVICE
[Unit]
Description=Claw Code backend (Claw Code Mobile gateway)
After=agent-telemetry.service

[Service]
ExecStart=/bin/bash $CLAW_HOME/launch-gateway.sh
Restart=always

[Install]
WantedBy=default.target
SERVICE
  systemctl --user daemon-reload
  systemctl --user enable hivemindos-claw-backend.service >/dev/null 2>&1 || true
  systemctl --user restart hivemindos-claw-backend.service
  echo "[claw] installed systemd service hivemindos-claw-backend.service"

  WSERVICE="$HOME/.config/systemd/user/hivemindos-claw-voice-worker.service"
  if [ "$VOICE_CONFIGURED" = "1" ]; then
    cat > "$WSERVICE" <<SERVICE
[Unit]
Description=Claw voice-agent worker (LiveKit realtime)
After=hivemindos-claw-backend.service

[Service]
ExecStart=/bin/bash $CLAW_HOME/launch-worker.sh
Restart=always

[Install]
WantedBy=default.target
SERVICE
    systemctl --user daemon-reload
    systemctl --user enable hivemindos-claw-voice-worker.service >/dev/null 2>&1 || true
    systemctl --user restart hivemindos-claw-voice-worker.service
    echo "[claw] installed systemd service hivemindos-claw-voice-worker.service (voice calling ON)"
  else
    systemctl --user disable --now hivemindos-claw-voice-worker.service >/dev/null 2>&1 || true
    rm -f "$WSERVICE"
    systemctl --user daemon-reload
    echo "[claw] voice calling not configured (no LIVEKIT_* in $VOICE_ENV) — voice worker not started."
  fi
fi

echo "[claw] Claw backend running (defaults :5000, auto-increments if taken; trusts the tailnet)."
echo "[claw] The Claw Code Mobile app will auto-discover it on the fleet."
