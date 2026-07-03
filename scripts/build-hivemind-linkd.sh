#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/macos-background-helpers.sh
. "$ROOT/scripts/macos-background-helpers.sh"
OUT_DIR="$ROOT/bin"
OUT="$OUT_DIR/hivemind-linkd"

if ! command -v go >/dev/null 2>&1; then
  echo "Go is required to build hivemind-linkd." >&2
  echo "Install Go, then rerun: ./scripts/build-hivemind-linkd.sh" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
cd "$ROOT"
# Stamp the build so /version and /_hivemind/version can expose stale daemons.
BUILD_COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
go build -ldflags "-X main.buildCommit=$BUILD_COMMIT -X main.buildTime=$BUILD_TIME" -o "$OUT" ./cmd/hivemind-linkd
hivemindos_sign_macos_binary "$OUT" "com.hivemindos.linkd"
echo "$OUT"
