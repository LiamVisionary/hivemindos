#!/usr/bin/env bash
# Install + supervise the HivemindOS Mobile backend gateway — the service that the mobile
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
#   MOBILE_HOME               install dir (default ~/.hivemindos/claw; legacy
#                             CLAW_HOME is still honored). The on-disk dir name
#                             stays ~/.hivemindos/claw until the app-release that
#                             renames it (the bundled gateway-host + lib.rs still
#                             resolve that path); see docs follow-up.
#
# Artifacts are published to an R2 bucket and served by a small Worker at
#   <public-base>/claw-backend/<version>/claw-backend-<os>-<arch>.tar.gz
# The default base is the project's download Worker (claw-dl, on *.workers.dev),
# used instead of the bucket's r2.dev URL because r2.dev is rate-limited and is
# blocked/filtered on some networks. Override CLAW_BACKEND_PUBLIC_BASE to point
# at your own host — see docs/claw-backend-release.md in the source repo.
set -euo pipefail

MOBILE_HOME="${MOBILE_HOME:-${CLAW_HOME:-$HOME/.hivemindos/claw}}"
CLAW_VERSION="${CLAW_BACKEND_VERSION:-v0.3.0}"
CLAW_PUBLIC_BASE="${CLAW_BACKEND_PUBLIC_BASE:-https://claw-dl.hivemindos.workers.dev}"
CLAW_BASE_URL="${CLAW_BACKEND_BASE_URL:-$CLAW_PUBLIC_BASE/claw-backend/$CLAW_VERSION}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/macos-background-helpers.sh
. "$APP_DIR/scripts/macos-background-helpers.sh"

os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
  Darwin) osn=darwin ;;
  Linux) osn=linux ;;
  *) echo "[mobile] unsupported OS: $os — skipping HivemindOS Mobile backend" >&2; exit 0 ;;
esac
case "$arch" in
  arm64|aarch64) an=arm64 ;;
  x86_64|amd64) an=amd64 ;;
  *) echo "[mobile] unsupported arch: $arch — skipping HivemindOS Mobile backend" >&2; exit 0 ;;
esac
ASSET="claw-backend-$osn-$an.tar.gz"

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "[mobile] Node not found on PATH; cannot run the HivemindOS Mobile backend" >&2; exit 1; }

VOICE_WORKER_LABEL="com.hivemindos.voice-worker"
VOICE_WORKER_LEGACY_LABEL="com.hivemindos.claw-voice-worker"
VOICE_WORKER_HELPER_NAME="HivemindOS Voice Worker"
VOICE_WORKER_HELPER_ID="com.hivemindos.voice-worker-helper"
VOICE_WORKER_HELPER_HOME="$HOME/.hivemindos/bin/$VOICE_WORKER_HELPER_NAME"

mkdir -p "$MOBILE_HOME"

# 1) Obtain the artifact (local override, else download + verify sha256).
if [ -n "${CLAW_BACKEND_ARTIFACT:-}" ]; then
  TARBALL="$CLAW_BACKEND_ARTIFACT"
  echo "[mobile] using local artifact: $TARBALL"
  [ -f "$TARBALL" ] || { echo "[mobile] artifact not found: $TARBALL" >&2; exit 1; }
else
  TARBALL="$MOBILE_HOME/$ASSET"
  echo "[mobile] downloading $CLAW_BASE_URL/$ASSET"
  curl -fsSL "$CLAW_BASE_URL/$ASSET" -o "$TARBALL"
  if curl -fsSL "$CLAW_BASE_URL/$ASSET.sha256" -o "$TARBALL.sha256" 2>/dev/null; then
    echo "[mobile] verifying checksum"
    ( cd "$(dirname "$TARBALL")" \
        && { shasum -a 256 -c "$(basename "$TARBALL").sha256" 2>/dev/null \
             || sha256sum -c "$(basename "$TARBALL").sha256"; } ) \
      || { echo "[mobile] checksum verification FAILED" >&2; exit 1; }
  else
    echo "[mobile] (no .sha256 published; skipping checksum)" >&2
  fi
fi

# 2) Extract and swap into place (leaving DATA_DIR untouched across upgrades).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$TARBALL" -C "$TMP"
SRC="$TMP/claw-backend-$osn-$an"
[ -d "$SRC" ] || SRC="$(find "$TMP" -maxdepth 1 -type d -name 'claw-backend-*' | head -1)"
[ -d "$SRC/backend" ] || { echo "[mobile] unexpected artifact layout under $SRC" >&2; exit 1; }

rm -rf "$MOBILE_HOME/backend" "$MOBILE_HOME/bin"
cp -R "$SRC/backend" "$MOBILE_HOME/backend"
cp -R "$SRC/bin" "$MOBILE_HOME/bin"
cp "$SRC/run.sh" "$MOBILE_HOME/run.sh" 2>/dev/null || true
chmod +x "$MOBILE_HOME/bin/claw" "$MOBILE_HOME/run.sh" 2>/dev/null || true

DATA_DIR="$MOBILE_HOME/data"; mkdir -p "$DATA_DIR"

# 2b) Self-heal the better-sqlite3 native addon ABI. The published bundle ships a
#     better_sqlite3.node prebuild frozen at the release's Node ABI
#     (NODE_MODULE_VERSION). The launcher below execs $NODE_BIN (system node),
#     whose ABI drifts every time Homebrew/nvm bumps node — when it no longer
#     matches the prebuild, dlopen fails (ERR_DLOPEN_FAILED at db/sqlite.ts) and
#     the gateway-host supervisor hot-loops (restarting every few seconds, with a
#     log that grows without bound). Detect the mismatch against the node this
#     launcher will actually use, and rebuild the addon for it before first start.
#     Idempotent: when the addon already loads, this is a no-op.
if [ -d "$MOBILE_HOME/backend/node_modules/better-sqlite3" ]; then
  if ( cd "$MOBILE_HOME/backend" && "$NODE_BIN" -e 'require("better-sqlite3")' ) >/dev/null 2>&1; then
    : # native addon loads under the launcher's node — nothing to do
  else
    NODE_VER="$("$NODE_BIN" -v 2>/dev/null || echo unknown)"
    echo "[mobile] better-sqlite3 native addon is ABI-incompatible with node $NODE_VER — rebuilding it for this node" >&2
    NPM_BIN="$(PATH="$(dirname "$NODE_BIN"):$PATH" command -v npm || true)"
    REBUILD_LOG="${TMPDIR:-/tmp}/hivemindos-mobile-better-sqlite3-rebuild.log"
    if [ -z "$NPM_BIN" ]; then
      echo "[mobile] npm not found next to $NODE_BIN; cannot rebuild better-sqlite3. The mobile/voice gateway may crash-loop until the published bundle matches this node." >&2
    elif ( cd "$MOBILE_HOME/backend" \
            && PATH="$(dirname "$NODE_BIN"):$PATH" npm rebuild better-sqlite3 ) >"$REBUILD_LOG" 2>&1 \
         && ( cd "$MOBILE_HOME/backend" && "$NODE_BIN" -e 'require("better-sqlite3")' ) >/dev/null 2>&1; then
      echo "[mobile] better-sqlite3 rebuilt successfully for node $NODE_VER"
    else
      echo "[mobile] better-sqlite3 rebuild did NOT resolve the ABI mismatch (see $REBUILD_LOG)." >&2
      echo "[mobile] Install Xcode Command Line Tools + python3 (for a source build), or align node to the bundle's ABI. Until then the mobile/voice gateway will keep crash-looping; clear its log with: : > \"\$HOME/Library/Logs/hivemindos-claw-gateway.err.log\"" >&2
    fi
  fi
fi

SERVER_ENTRY="$MOBILE_HOME/backend/src/server.ts"
WORKER_ENTRY="$MOBILE_HOME/backend/src/voice/callAgentWorker.ts"

# 3) Voice/calling config. Proactive + in-app voice calls need LiveKit creds
#    (and, for backgrounded push calls, an Apple VoIP key). These are operator
#    secrets, so they live in a persisted env file that survives upgrades — the
#    backend bundle is wiped+replaced above, but voice.env (like data/) is not.
#    The OpenAI realtime key is NOT needed here: the app syncs it from its Models
#    tab and the gateway forwards it to the worker per call.
VOICE_ENV="$MOBILE_HOME/voice.env"
if [ ! -f "$VOICE_ENV" ]; then
  cat > "$VOICE_ENV" <<'VENV'
# HivemindOS Mobile voice calling — operator secrets (sourced by the gateway + voice worker).
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
  echo "[mobile] wrote voice config template: $VOICE_ENV (fill in LIVEKIT_* to enable calls)"
fi

# Generate self-contained launchers. They bake in the absolute node + paths
# (launchd/systemd run with a minimal PATH) and source voice.env at RUNTIME, so
# editing creds + restarting the service suffices — no reinstall. Generated here
# (not taken from the artifact) so this works with any already-published bundle.
cat > "$MOBILE_HOME/launch-gateway.sh" <<LAUNCH
#!/usr/bin/env bash
set -uo pipefail
export HIVEMIND_MODE=1
export DATA_DIR="$DATA_DIR"
# Honor a CLAW_BINARY supplied by the caller (the app-hosted gateway passes the
# claw bundled inside the signed .app, so its file access inherits the app's TCC
# grant). Fall back to the installed copy for the headless launchd path.
: "\${CLAW_BINARY:=$MOBILE_HOME/bin/claw}"
export CLAW_BINARY
# A malformed voice.env must never take the gateway down — source it tolerantly.
if [ -f "$VOICE_ENV" ]; then set -a; . "$VOICE_ENV" 2>/dev/null || true; set +a; fi
mkdir -p "$DATA_DIR"
cd "$MOBILE_HOME/backend"
# Self-heal the better-sqlite3 native addon at LAUNCH time (the install-time
# check can't catch ABI drift that happens later, e.g. a Homebrew node bump).
# A mismatched prebuild kills the server ~1s into boot, and the supervisor
# would otherwise relaunch it forever — each attempt re-paying a full tsx
# transpile at ~100% CPU and appending a stack trace to the launchd log.
# Rebuild at most once per node version (stamp file); if it still fails,
# sleep long before exiting so the retry loop stays cold and quiet.
if ! "$NODE_BIN" -e 'require("better-sqlite3")' >/dev/null 2>&1; then
  NODE_VER="\$("$NODE_BIN" -v 2>/dev/null || echo unknown)"
  STAMP="$MOBILE_HOME/.better-sqlite3-rebuild-\$NODE_VER"
  if [ ! -f "\$STAMP" ]; then
    rm -f "$MOBILE_HOME"/.better-sqlite3-rebuild-* 2>/dev/null || true
    : > "\$STAMP"
    echo "[gateway] better-sqlite3 ABI mismatch under node \$NODE_VER — rebuilding once" >&2
    ( PATH="\$(dirname "$NODE_BIN"):\$PATH" npm rebuild better-sqlite3 ) >/dev/null 2>&1 || true
  fi
  if ! "$NODE_BIN" -e 'require("better-sqlite3")' >/dev/null 2>&1; then
    echo "[gateway] better-sqlite3 still ABI-incompatible with node \$NODE_VER; install Xcode CLT or align node to the bundle ABI. Idling to avoid a hot restart loop." >&2
    sleep 300
    exit 1
  fi
fi
exec "$NODE_BIN" --import tsx "$SERVER_ENTRY"
LAUNCH

cat > "$MOBILE_HOME/launch-worker.sh" <<LAUNCH
#!/usr/bin/env bash
# The LiveKit voice-agent worker — the SEPARATE process that joins answered call
# rooms and actually speaks. Without it, calls ring and the phone joins but no
# agent is there. LIVEKIT_* come from voice.env; the realtime key + vault path
# arrive per call via the dispatch metadata.
set -uo pipefail
if [ -f "$VOICE_ENV" ]; then set -a; . "$VOICE_ENV" 2>/dev/null || true; set +a; fi
cd "$MOBILE_HOME/backend"
# Same launch-time ABI guard as launch-gateway.sh (launchd KeepAlive would
# otherwise hot-loop this worker too); the gateway launcher owns the rebuild,
# so the worker only waits out a mismatch instead of racing a second rebuild.
if ! "$NODE_BIN" -e 'require("better-sqlite3")' >/dev/null 2>&1; then
  echo "[voice-worker] better-sqlite3 ABI-incompatible with \$("$NODE_BIN" -v 2>/dev/null || echo unknown); idling to avoid a hot restart loop" >&2
  sleep 300
  exit 1
fi
exec "$NODE_BIN" --import tsx "$WORKER_ENTRY" start
LAUNCH
chmod +x "$MOBILE_HOME/launch-gateway.sh" "$MOBILE_HOME/launch-worker.sh"

# Note: no manual Full Disk Access step anymore. On macOS the desktop app runs
# the gateway as an app-signed launchd login item (com.hivemindos.claw-gateway
# -> Contents/MacOS/hivemind-gateway-host), so the gateway inherits the app's
# TCC identity and macOS shows the standard one-click "Allow" folder prompts
# attributed to HivemindOS — no binary needs to be dragged into the FDA list.

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

resolve_voice_worker_helper() {
  hivemindos_resolve_background_helper \
    "$VOICE_WORKER_HELPER_NAME" \
    "$VOICE_WORKER_HELPER_ID" \
    "$APP_DIR/scripts/hivemindos-background-helper.c" \
    "$VOICE_WORKER_HELPER_HOME" \
    "$APP_DIR/src-tauri/resources/hivemindos-voice-worker-helper/$VOICE_WORKER_HELPER_NAME" \
    "$APP_DIR/resources/hivemindos-voice-worker-helper/$VOICE_WORKER_HELPER_NAME"
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
  echo "[mobile] gateway is now hosted by the signed HivemindOS app (one-click folder grant) — headless launchd backend retired"

  WPLIST="$HOME/Library/LaunchAgents/$VOICE_WORKER_LABEL.plist"
  LEGACY_WPLIST="$HOME/Library/LaunchAgents/$VOICE_WORKER_LEGACY_LABEL.plist"
  launchctl bootout "gui/$(id -u)/$VOICE_WORKER_LEGACY_LABEL" >/dev/null 2>&1 || launchctl unload "$LEGACY_WPLIST" >/dev/null 2>&1 || true
  rm -f "$LEGACY_WPLIST"
  if [ "$VOICE_CONFIGURED" = "1" ]; then
    VOICE_WORKER_HELPER="$(resolve_voice_worker_helper || true)"
    if [[ -n "$VOICE_WORKER_HELPER" && -x "$VOICE_WORKER_HELPER" ]]; then
      VOICE_WORKER_PROGRAM_ARGUMENTS="    <string>$VOICE_WORKER_HELPER</string>
    <string>/bin/bash</string>
    <string>$MOBILE_HOME/launch-worker.sh</string>"
    else
      VOICE_WORKER_PROGRAM_ARGUMENTS="    <string>/bin/bash</string>
    <string>$MOBILE_HOME/launch-worker.sh</string>"
    fi
    cat > "$WPLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$VOICE_WORKER_LABEL</string>
  <key>ProgramArguments</key>
  <array>
$VOICE_WORKER_PROGRAM_ARGUMENTS
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/hivemindos-voice-worker.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/hivemindos-voice-worker.err.log</string>
</dict>
</plist>
PLIST
    relaunch_agent "$VOICE_WORKER_LABEL" "$WPLIST"
    echo "[mobile] installed launchd service $VOICE_WORKER_LABEL (voice calling ON)"
  else
    launchctl bootout "gui/$(id -u)/$VOICE_WORKER_LABEL" >/dev/null 2>&1 || launchctl unload "$WPLIST" >/dev/null 2>&1 || true
    rm -f "$WPLIST"
    echo "[mobile] voice calling not configured (no LIVEKIT_* in $VOICE_ENV) — voice worker not started."
  fi
else
  # Migrate the legacy unit name (hivemindos-claw-backend.service) to the
  # HivemindOS Mobile name. Stop+disable+remove the old one first so we don't
  # leave a duplicate/orphaned service running the same gateway.
  if [ -f "$HOME/.config/systemd/user/hivemindos-claw-backend.service" ]; then
    systemctl --user disable --now hivemindos-claw-backend.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/hivemindos-claw-backend.service"
  fi
  SERVICE="$HOME/.config/systemd/user/hivemindos-mobile-backend.service"
  mkdir -p "$(dirname "$SERVICE")"
  cat > "$SERVICE" <<SERVICE
[Unit]
Description=HivemindOS Mobile backend gateway
After=agent-telemetry.service

[Service]
ExecStart=/bin/bash $MOBILE_HOME/launch-gateway.sh
Restart=always

[Install]
WantedBy=default.target
SERVICE
  systemctl --user daemon-reload
  systemctl --user enable hivemindos-mobile-backend.service >/dev/null 2>&1 || true
  systemctl --user restart hivemindos-mobile-backend.service
  echo "[mobile] installed systemd service hivemindos-mobile-backend.service"

  WSERVICE="$HOME/.config/systemd/user/hivemindos-voice-worker.service"
  if [ "$VOICE_CONFIGURED" = "1" ]; then
    cat > "$WSERVICE" <<SERVICE
[Unit]
Description=HivemindOS voice worker (LiveKit realtime)
After=hivemindos-mobile-backend.service

[Service]
ExecStart=/bin/bash $MOBILE_HOME/launch-worker.sh
Restart=always

[Install]
WantedBy=default.target
SERVICE
    systemctl --user daemon-reload
    systemctl --user disable --now hivemindos-claw-voice-worker.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/hivemindos-claw-voice-worker.service"
    systemctl --user enable hivemindos-voice-worker.service >/dev/null 2>&1 || true
    systemctl --user restart hivemindos-voice-worker.service
    echo "[mobile] installed systemd service hivemindos-voice-worker.service (voice calling ON)"
  else
    systemctl --user disable --now hivemindos-voice-worker.service >/dev/null 2>&1 || true
    systemctl --user disable --now hivemindos-claw-voice-worker.service >/dev/null 2>&1 || true
    rm -f "$WSERVICE"
    rm -f "$HOME/.config/systemd/user/hivemindos-claw-voice-worker.service"
    systemctl --user daemon-reload
    echo "[mobile] voice calling not configured (no LIVEKIT_* in $VOICE_ENV) — voice worker not started."
  fi
fi

echo "[mobile] HivemindOS Mobile backend running (defaults :5000, auto-increments if taken; trusts the tailnet)."
echo "[mobile] The HivemindOS Mobile app will auto-discover it on the fleet."
