#!/usr/bin/env bash
# Build a SIGNED + NOTARIZED macOS bundle for distribution.
#
# Code signing already works from your login keychain (the Developer ID
# identity). The piece that's missing for DISTRIBUTION is notarization — Apple's
# scan-and-staple step, without which other Macs' Gatekeeper refuses to open the
# app. Notarization needs Apple credentials, which live in your shared hive env.
#
# Run it either way (secret values are never printed):
#
#   hive-env-run -- bash scripts/build-notarized-mac.sh     # preferred (managed env)
#   bash scripts/build-notarized-mac.sh                     # falls back to ~/.hivemindos/.env
#
# Pass extra `tauri build` flags through, e.g. `-- --target aarch64-apple-darwin`.
set -euo pipefail
cd "$(dirname "$0")/.."

# If the Apple creds aren't already in the environment (i.e. this wasn't launched
# via hive-env-run), source the shared env file directly. Sourcing exports the
# values into this process only — nothing is persisted or printed.
if [ -z "${APPLE_ID:-}${HIVEMINDOS_APPLE_ID:-}${APPLE_API_KEY:-}${HIVEMINDOS_APPLE_API_KEY:-}" ]; then
  HIVE_ENV="${HIVEMINDOS_ENV_FILE:-$HOME/.hivemindos/.env}"
  if [ -f "$HIVE_ENV" ]; then
    set -a; . "$HIVE_ENV"; set +a
  fi
fi

# The Tauri bundler reads the UNPREFIXED names. Fill each from its
# HIVEMINDOS_APPLE_* variant when only the namespaced one is set, so this works
# whichever way you stored them.
: "${APPLE_ID:=${HIVEMINDOS_APPLE_ID:-}}"
: "${APPLE_PASSWORD:=${HIVEMINDOS_APPLE_PASSWORD:-}}"
: "${APPLE_TEAM_ID:=${HIVEMINDOS_APPLE_TEAM_ID:-}}"
: "${APPLE_SIGNING_IDENTITY:=${HIVEMINDOS_APPLE_SIGNING_IDENTITY:-}}"
# App Store Connect API-key method (alternative to Apple ID + app password).
: "${APPLE_API_KEY:=${HIVEMINDOS_APPLE_API_KEY:-}}"
: "${APPLE_API_ISSUER:=${HIVEMINDOS_APPLE_API_ISSUER:-}}"
: "${APPLE_API_KEY_PATH:=${HIVEMINDOS_APPLE_API_KEY_PATH:-}}"
export APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH
[ -n "${APPLE_SIGNING_IDENTITY}" ] && export APPLE_SIGNING_IDENTITY

# Tauri notarizes if EITHER credential set is complete. Verify presence only.
have_apple_id=0
[ -n "${APPLE_ID}" ] && [ -n "${APPLE_PASSWORD}" ] && [ -n "${APPLE_TEAM_ID}" ] && have_apple_id=1
have_api_key=0
[ -n "${APPLE_API_KEY}" ] && [ -n "${APPLE_API_ISSUER}" ] && [ -n "${APPLE_API_KEY_PATH}" ] && have_api_key=1

if [ "$have_apple_id" -eq 0 ] && [ "$have_api_key" -eq 0 ]; then
  echo "Cannot notarize: no complete Apple credential set found." >&2
  echo "Need either APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID," >&2
  echo "or APPLE_API_KEY + APPLE_API_ISSUER + APPLE_API_KEY_PATH." >&2
  echo "Add them to your hive env, or run via: hive-env-run -- bash scripts/build-notarized-mac.sh" >&2
  exit 1
fi

if [ "$have_apple_id" -eq 1 ]; then
  echo "Notarization: Apple ID method (APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID all set)."
else
  echo "Notarization: App Store Connect API-key method (all three set)."
fi
[ -n "${APPLE_SIGNING_IDENTITY:-}" ] && echo "Signing identity: provided via APPLE_SIGNING_IDENTITY." \
  || echo "Signing identity: auto-detected from the login keychain."

# Embedded Next server (working dashboard) + signed + notarized bundle.
export HIVEMINDOS_TAURI_EMBEDDED_NEXT=1
echo "Starting notarized build (notarization adds a few minutes for Apple's scan)…"
exec pnpm tauri build "$@"
