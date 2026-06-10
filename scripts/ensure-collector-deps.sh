#!/usr/bin/env bash
set -euo pipefail

# Installs the telemetry collector's only npm runtime dependency (bonjour-service)
# without running the full workspace pnpm install. Collector-only machines use this
# instead of `pnpm install --frozen-lockfile`, which pulls the entire dashboard
# dependency tree and OOMs small hosts. A no-op when the dependency is already
# present (e.g. after a full install).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f node_modules/bonjour-service/package.json ]]; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "node and npm are required to install the collector dependency (bonjour-service)." >&2
  exit 1
fi

SPEC="$(node -p "require('./package.json').dependencies['bonjour-service']" 2>/dev/null || true)"
SPEC="${SPEC:-^1.4.0}"

echo "Installing collector runtime dependency bonjour-service@$SPEC (collector-only mode skips the full workspace install)"
npm install --no-save --no-audit --no-fund --loglevel=error "bonjour-service@$SPEC"
