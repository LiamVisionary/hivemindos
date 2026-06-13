#!/usr/bin/env bash
# Tauri `--runner` shim used by `pnpm tauri:dev` (see scripts/tauri-dev-signed.mjs).
#
# THE PROBLEM IT SOLVES
#   `tauri dev` produces a raw, ad-hoc-signed `target/debug/HivemindOS` launched from a
#   terminal, with `claw` sitting next to it as a separate external binary. Two TCC
#   consequences:
#     1. The dev app's "designated requirement" is a bare cdhash that changes every
#        rebuild, so folder grants approved for the released `com.hivemindos.desktop`
#        app never apply to dev (and a terminal launch makes Terminal the responsible
#        process anyway).
#     2. Even after we fix the app's identity, `claw` is an EXTERNAL, separately-signed
#        binary — macOS makes it its OWN TCC responsible process, so the agent's writes
#        to ~/Downloads get a silent EPERM ("Operation not permitted (os error 1)") with
#        no one-click "Allow" prompt. Only a claw NESTED inside the app bundle inherits
#        the app's grant (this is exactly why the release app can write and dev can't).
#
# THE FIX (dev == prod)
#   Assemble a real `HivemindOS.app` bundle around the freshly-built dev binary, with
#   `claw` nested at Contents/MacOS/claw — byte-for-byte the structure of the release
#   app. Sign inside-out (claw first, then the bundle) with the SAME Developer ID
#   identity + bundle id as prod, so:
#     • the designated requirement becomes identical to prod
#         identifier "com.hivemindos.desktop" and anchor apple generic
#           and certificate leaf[subject.OU] = L7XLLTV3X7
#       — TCC keys grants on that requirement (not the cdhash), so dev and prod are ONE
#       app; a single "Allow Downloads" covers both on every rebuild.
#     • `claw` is sealed as part of the app, so the agent (spawned by the app-hosted
#       gateway) inherits the app's folder grant instead of being denied.
#   We then launch the bundle's executable disclaimed (scripts/disclaim-launch.c) so the
#   app is its own responsible process, exactly like a Finder/LaunchServices launch.
#   `lib.rs` resolves CLAW_BINARY from current_exe()'s directory, so launching from
#   inside the bundle makes it pick the nested claw automatically — no Rust change.
#
#   Tauri v2 dev invokes this shim as `cargo run …`, which builds AND launches in one
#   step. So we intercept `run`: `cargo build`, assemble+sign the bundle, then `exec` the
#   bundled (signed, disclaimed) binary. Tauri's watcher still works — on a source change
#   it kills this process and re-invokes the shim -> rebuild + reassemble + relaunch.
#
#   Hardened runtime is intentionally NOT applied — it is irrelevant to the TCC identity
#   (the requirement above is identity-based, not runtime-flag-based; dev-no-runtime and
#   prod-with-runtime share the SAME requirement) and would only risk breaking the dev
#   binary's library loading. Notarization stays a release concern.
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="$ROOT/src-tauri/target/debug"
APP_BIN="$TARGET_DIR/HivemindOS"
ENTITLEMENTS="$ROOT/src-tauri/Entitlements.plist"
SIGN_ID="Developer ID Application: Rizzma, Inc. (L7XLLTV3X7)"
BUNDLE_ID="com.hivemindos.desktop"

# The dev .app we assemble. Tauri's own release bundle lives under target/release/bundle,
# so this name doesn't collide with anything Tauri produces in debug.
BUNDLE="$TARGET_DIR/HivemindOS.app"
BUNDLE_MACOS="$BUNDLE/Contents/MacOS"
BUNDLE_BIN="$BUNDLE_MACOS/HivemindOS"
BUNDLE_CLAW="$BUNDLE_MACOS/claw"
# The gateway-host helper nested beside claw, so the dev login-item gateway runs
# the app-identity-signed helper exactly like prod (see lib.rs install_gateway_login_item).
BUNDLE_GW="$BUNDLE_MACOS/hivemind-gateway-host"

# Pick a claw to nest: the dev tree's own copy first (what the gateway already used),
# then the release app's bundled claw, then the installed copy. First hit wins.
find_claw_source() {
  local c
  for c in \
    "$TARGET_DIR/claw" \
    "$ROOT/src-tauri/target/release/bundle/macos/HivemindOS.app/Contents/MacOS/claw" \
    "$HOME/.hivemindos/claw/bin/claw"; do
    if [ -f "$c" ]; then printf '%s' "$c"; return 0; fi
  done
  return 1
}

# The gateway-host helper: the freshly built standalone crate first, then the
# staged externalBin copy, then a prior release bundle. First hit wins.
find_gateway_host_source() {
  local g
  for g in \
    "$ROOT/src-tauri/gateway-host/target/release/hivemind-gateway-host" \
    "$ROOT/src-tauri/binaries/hivemind-gateway-host-aarch64-apple-darwin" \
    "$ROOT/src-tauri/binaries/hivemind-gateway-host-x86_64-apple-darwin" \
    "$ROOT/src-tauri/target/release/bundle/macos/HivemindOS.app/Contents/MacOS/hivemind-gateway-host"; do
    if [ -f "$g" ]; then printf '%s' "$g"; return 0; fi
  done
  return 1
}

write_info_plist() {
  cat > "$BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>HivemindOS</string>
	<key>CFBundleIdentifier</key>
	<string>com.hivemindos.desktop</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>HivemindOS</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>0.0.0-dev</string>
	<key>CFBundleVersion</key>
	<string>0</string>
	<key>LSMinimumSystemVersion</key>
	<string>10.15</string>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
PLIST
}

# WebKit disables navigator.mediaDevices / getUserMedia when the responsible
# app's Info.plist lacks NSMicrophoneUsageDescription, which silently kills the
# mic in every dev-webview voice feature (Queen Bee voice chat, agent calls).
# Merge the canonical custom keys (mic + folder usage strings) from
# src-tauri/Info.plist so the dev bundle matches the release bundle.
merge_custom_info_plist() {
  local src="$ROOT/src-tauri/Info.plist"
  [ -f "$src" ] || return 0
  /usr/libexec/PlistBuddy -c "Merge $src" "$BUNDLE/Contents/Info.plist" >/dev/null 2>&1 \
    || printf '[dev-codesign] WARNING: could not merge src-tauri/Info.plist into the dev bundle; webview mic will stay disabled\n' >&2
}

# Sign just the raw binary in place — the pre-bundle fallback (also used for `tauri build`
# pre-steps). Keeps dev usable even if bundle assembly fails for some reason.
sign_raw_binary() {
  [ -f "$APP_BIN" ] || return 0
  local ent_args=()
  [ -f "$ENTITLEMENTS" ] && ent_args=(--entitlements "$ENTITLEMENTS")
  if codesign --force --timestamp=none -s "$SIGN_ID" -i "$BUNDLE_ID" "${ent_args[@]}" "$APP_BIN" >/dev/null 2>&1; then
    printf '[dev-codesign] re-signed %s as %s — TCC-matched to the release app\n' "${APP_BIN##*/}" "$BUNDLE_ID" >&2
  else
    printf '[dev-codesign] WARNING: could not re-sign %s; dev file-permissions will not match prod\n' "$APP_BIN" >&2
  fi
}

# Assemble target/debug/HivemindOS.app { Contents/Info.plist, MacOS/HivemindOS, MacOS/claw },
# sign inside-out, and echo the bundled executable path on success. Returns non-zero (and
# leaves $LAUNCH_BIN untouched) if anything fails, so the caller falls back to the raw binary.
assemble_and_sign_bundle() {
  [ -f "$APP_BIN" ] || return 1
  command -v codesign >/dev/null 2>&1 || return 1

  mkdir -p "$BUNDLE_MACOS" || return 1
  write_info_plist || return 1
  merge_custom_info_plist

  # Copy (not symlink) the executable so current_exe() resolves INSIDE the bundle and the
  # copy carries its own signature. cp -f over a running prior copy is fine (new inode).
  cp -f "$APP_BIN" "$BUNDLE_BIN" || return 1

  local src_claw
  if src_claw="$(find_claw_source)"; then
    cp -f "$src_claw" "$BUNDLE_CLAW" || return 1
  else
    printf '[dev-codesign] WARNING: no claw binary found to nest — agent writes to protected folders will fail\n' >&2
  fi

  local src_gw
  if src_gw="$(find_gateway_host_source)"; then
    cp -f "$src_gw" "$BUNDLE_GW" || return 1
  else
    printf '[dev-codesign] WARNING: no gateway-host helper found to nest — dev login-item gateway will lack the app TCC identity\n' >&2
  fi

  local ent_args=()
  [ -f "$ENTITLEMENTS" ] && ent_args=(--entitlements "$ENTITLEMENTS")

  # Inside-out: sign the nested claw first (its own Developer ID seal), then the bundle,
  # which seals claw into the app's CodeResources so macOS treats it as part of the app.
  if [ -f "$BUNDLE_CLAW" ]; then
    codesign --force --timestamp=none -s "$SIGN_ID" -i claw "$BUNDLE_CLAW" >/dev/null 2>&1 \
      || printf '[dev-codesign] WARNING: could not sign nested claw\n' >&2
  fi
  if [ -f "$BUNDLE_GW" ]; then
    codesign --force --timestamp=none -s "$SIGN_ID" -i hivemind-gateway-host "$BUNDLE_GW" >/dev/null 2>&1 \
      || printf '[dev-codesign] WARNING: could not sign nested gateway-host helper\n' >&2
  fi

  if codesign --force --timestamp=none -s "$SIGN_ID" -i "$BUNDLE_ID" "${ent_args[@]}" "$BUNDLE" >/dev/null 2>&1; then
    printf '[dev-codesign] assembled + signed HivemindOS.app (claw nested) — claw inherits the app TCC grant, like prod\n' >&2
    return 0
  fi
  printf '[dev-codesign] WARNING: could not sign the dev .app bundle; falling back to the raw binary\n' >&2
  return 1
}

# Intercept the build-and-launch step so we can bundle+sign in between.
if [ "${1:-}" = "run" ]; then
  shift
  cargo_flags=()
  app_args=()
  seen_dd=0
  for a in "$@"; do
    if [ "$seen_dd" -eq 0 ] && [ "$a" = "--" ]; then
      seen_dd=1
      continue
    fi
    if [ "$seen_dd" -eq 0 ]; then cargo_flags+=("$a"); else app_args+=("$a"); fi
  done

  cargo build "${cargo_flags[@]}"
  code=$?
  [ "$code" -ne 0 ] && exit "$code"

  # Prefer launching the bundled binary (claw nested -> inherits the grant). Fall back to
  # the raw, re-signed binary if bundling fails (dev still runs, just without claw writes).
  LAUNCH_BIN="$APP_BIN"
  if assemble_and_sign_bundle; then
    LAUNCH_BIN="$BUNDLE_BIN"
  else
    sign_raw_binary
  fi

  # Launch the app so it becomes its OWN TCC "responsible process" — exactly like a
  # Finder/LaunchServices (release) launch. Without this, the app launched from `tauri dev`
  # inherits the TERMINAL's responsibility, so every file the agent writes is checked against
  # Terminal's folder permissions (none) and fails with EPERM and no prompt. The disclaim shim
  # (scripts/disclaim-launch.c) replicates what `open`/Finder does. Compile once, then reuse.
  HELPER_SRC="$SCRIPT_DIR/disclaim-launch.c"
  HELPER_BIN="$ROOT/src-tauri/target/dev-disclaim-launch"
  if [ -f "$HELPER_SRC" ] && { [ ! -x "$HELPER_BIN" ] || [ "$HELPER_SRC" -nt "$HELPER_BIN" ]; }; then
    cc -O2 -o "$HELPER_BIN" "$HELPER_SRC" 2>/dev/null \
      && printf '[dev-codesign] built disclaim launcher\n' >&2 \
      || printf '[dev-codesign] WARNING: could not build disclaim launcher (cc missing?)\n' >&2
  fi

  launcher=()
  if [ -x "$HELPER_BIN" ]; then
    launcher=("$HELPER_BIN")
    printf '[dev-codesign] launching dev app disclaimed — own TCC identity, like the release app\n' >&2
  else
    printf '[dev-codesign] WARNING: no disclaim launcher; agent writes to protected folders will fail in dev\n' >&2
  fi

  # Replace this process with the (signed, disclaimed) app. Tauri waits on / watches it.
  if [ "${#app_args[@]}" -gt 0 ]; then
    exec "${launcher[@]}" "$LAUNCH_BIN" "${app_args[@]}"
  else
    exec "${launcher[@]}" "$LAUNCH_BIN"
  fi
fi

# Any other cargo subcommand (build / metadata / rustc / …): pass straight through,
# signing after a successful plain `build`.
cargo "$@"
code=$?
if [ "$code" -eq 0 ] && [ "${1:-}" = "build" ]; then
  sign_raw_binary
fi
exit "$code"
