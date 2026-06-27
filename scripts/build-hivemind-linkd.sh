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
go build -o "$OUT" ./cmd/hivemind-linkd
hivemindos_sign_macos_binary "$OUT" "com.hivemindos.linkd"
echo "$OUT"
