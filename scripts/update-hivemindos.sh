#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-5020}"
COLLECTOR_PORT="${AGENT_TELEMETRY_PORT:-8787}"
SKIP_PULL="false"
SKIP_INSTALL="false"
BUILD_DASHBOARD="false"
SKIP_COLLECTOR="false"
SKIP_DASHBOARD="false"

info() { printf "\033[1;36m%s\033[0m\n" "$*"; }
ok() { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$*"; }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*"; }

usage() {
  cat <<'EOF'
Usage: ./scripts/update-hivemindos.sh [options]

Pulls the latest checkout, refreshes dependencies, restarts the telemetry
collector, and restarts the dashboard dev server.

Options:
  --skip-pull        Do not run git pull.
  --skip-install     Do not run pnpm install.
  --build            Run a production dashboard build before restarting.
  --skip-collector   Do not restart the telemetry collector.
  --skip-dashboard   Do not restart the dashboard dev server.
  -h, --help         Show this help.

Environment:
  PORT                Dashboard port. Default: 5020.
  AGENT_TELEMETRY_PORT Collector port. Default: 8787.
EOF
}

while (( $# > 0 )); do
  case "$1" in
    --) ;;
    --skip-pull) SKIP_PULL="true" ;;
    --skip-install) SKIP_INSTALL="true" ;;
    --build|--production-build) BUILD_DASHBOARD="true" ;;
    --skip-build) BUILD_DASHBOARD="false" ;;
    --skip-collector) SKIP_COLLECTOR="true" ;;
    --skip-dashboard|--no-dashboard) SKIP_DASHBOARD="true" ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown update option: $1"
      echo
      usage
      exit 2
      ;;
  esac
  shift
done

cd "$ROOT"

refresh_tool_paths() {
  local brew_bin=""
  if command -v brew >/dev/null 2>&1; then
    brew_bin="$(command -v brew)"
  elif [[ -x /opt/homebrew/bin/brew ]]; then
    brew_bin="/opt/homebrew/bin/brew"
  elif [[ -x /usr/local/bin/brew ]]; then
    brew_bin="/usr/local/bin/brew"
  fi
  if [[ -n "$brew_bin" ]]; then
    eval "$("$brew_bin" shellenv)" >/dev/null 2>&1 || true
  fi
  hash -r 2>/dev/null || true
}

ensure_pnpm() {
  refresh_tool_paths
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm --version >/dev/null 2>&1 || corepack prepare pnpm@8.6.12 --activate
    refresh_tool_paths
    if command -v pnpm >/dev/null 2>&1 || corepack pnpm --version >/dev/null 2>&1; then
      return 0
    fi
  fi
  if command -v npm >/dev/null 2>&1; then
    npm exec --yes --package pnpm@8.6.12 -- pnpm --version >/dev/null 2>&1 && return 0
  fi
  fail "pnpm is not available. Install pnpm or enable corepack, then rerun this command."
  exit 1
}

pnpm_run() {
  refresh_tool_paths
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
    return
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm "$@"
    return
  fi
  if command -v npm >/dev/null 2>&1; then
    npm exec --yes --package pnpm@8.6.12 -- pnpm "$@"
    return
  fi
  fail "pnpm is not available. Install pnpm or enable corepack, then rerun this command."
  exit 1
}

port_listener_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser "$port/tcp" 2>/dev/null || true
  fi
}

pid_cwd() {
  local pid="$1"
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true
}

pid_command() {
  local pid="$1"
  ps -p "$pid" -o command= 2>/dev/null || true
}

start_dashboard() {
  info "Starting dashboard dev server on port $PORT"
  mkdir -p "$ROOT/.next"
  refresh_tool_paths
  local pnpm_cmd=(pnpm)
  if ! command -v pnpm >/dev/null 2>&1; then
    if command -v corepack >/dev/null 2>&1; then
      pnpm_cmd=(corepack pnpm)
    elif command -v npm >/dev/null 2>&1; then
      pnpm_cmd=(npm exec --yes --package pnpm@8.6.12 -- pnpm)
    fi
  fi
  local bundler="${HIVEMINDOS_NEXT_DEV_BUNDLER:-${NEXT_DEV_BUNDLER:-webpack}}"
  local bundler_flag="--turbo"
  if [[ "$bundler" == "webpack" ]]; then
    bundler_flag="--webpack"
  fi
  local source_map_args=()
  if [[ "${NEXT_DEV_SOURCE_MAPS:-}" != "1" ]]; then
    source_map_args=(--disable-source-maps)
  fi
  local node_options="${NODE_OPTIONS:-}"
  if [[ "${NEXT_DEV_EXPOSE_GC:-}" != "0" && " $node_options " != *" --expose-gc "* ]]; then
    node_options="${node_options:+$node_options }--expose-gc"
  fi
  if [[ "${NEXT_DEV_MAX_OLD_SPACE_MB:-1536}" != "0" && " $node_options " != *" --max-old-space-size="* ]]; then
    node_options="${node_options:+$node_options }--max-old-space-size=${NEXT_DEV_MAX_OLD_SPACE_MB:-1536}"
  fi
  NODE_OPTIONS="$node_options" nohup "$ROOT/scripts/run-with-memory-limit.sh" --limit-mb 5000 -- "${pnpm_cmd[@]}" exec next dev "$bundler_flag" "${source_map_args[@]}" -p "$PORT" -H "${HIVEMINDOS_DASHBOARD_HOST:-127.0.0.1}" > "$ROOT/.next/hivemindos.log" 2>&1 &
  sleep 2
}

restart_dashboard() {
  local pids pid cmd cwd restarted="false"
  pids="$(port_listener_pids "$PORT")"
  if [[ -z "$pids" ]]; then
    start_dashboard
    ok "Dashboard started on http://localhost:$PORT"
    return
  fi

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    cmd="$(pid_command "$pid")"
    cwd="$(pid_cwd "$pid")"
    if [[ "$cwd" == "$ROOT" && "$cmd" == *"next"* ]]; then
      info "Restarting dashboard on port $PORT (PID $pid)"
      kill "$pid" >/dev/null 2>&1 || true
      restarted="true"
    else
      warn "Port $PORT is used by PID $pid outside this checkout; leaving it alone"
      warn "Command: ${cmd:-unknown}"
      return 0
    fi
  done <<< "$pids"

  if [[ "$restarted" == "true" ]]; then
    sleep 2
    start_dashboard
    ok "Dashboard restarted on http://localhost:$PORT"
  fi
}

detect_hivemind_link_enabled() {
  if [[ -n "${HIVE_LINK_ENABLED:-}" ]]; then
    printf "%s\n" "$HIVE_LINK_ENABLED"
    return
  fi
  local link_label="${HIVE_LINK_LABEL:-com.hivemindos.linkd.agent}"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if launchctl print "gui/$(id -u)/$link_label" >/dev/null 2>&1 || launchctl print "gui/$(id -u)/com.hivemindos.linkd" >/dev/null 2>&1; then
      printf "true\n"
      return
    fi
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active hivemindos-linkd.service >/dev/null 2>&1; then
    printf "true\n"
    return
  fi
  printf "false\n"
}

restart_collector() {
  if [[ -f "$HOME/.hivemindos/collector.env" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.hivemindos/collector.env" >/dev/null 2>&1 || true
    COLLECTOR_PORT="${AGENT_TELEMETRY_PORT:-$COLLECTOR_PORT}"
  fi
  local link_enabled
  link_enabled="$(detect_hivemind_link_enabled)"
  info "Restarting telemetry collector on port $COLLECTOR_PORT"
  HIVE_LINK_ENABLED="$link_enabled" \
    AGENT_TELEMETRY_PORT="$COLLECTOR_PORT" \
    AGENT_TELEMETRY_HERMES_RESTART="${AGENT_TELEMETRY_HERMES_RESTART:-now}" \
    "$ROOT/scripts/install-telemetry-collector.sh"
  ok "Telemetry collector restart requested"
}

info "Updating HivemindOS in $ROOT"

if [[ "$SKIP_PULL" == "true" ]]; then
  warn "Skipping git pull"
else
  info "Pulling latest git changes"
  node "$ROOT/scripts/pull-with-changelog-preserve.mjs"
  ok "Git checkout is current"
fi

ensure_pnpm

if [[ "$SKIP_INSTALL" == "true" ]]; then
  warn "Skipping dependency install"
else
  info "Installing dependencies"
  NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--no-deprecation" pnpm_run install --frozen-lockfile
  ok "Dependencies installed"
fi

if [[ "$BUILD_DASHBOARD" == "true" ]]; then
  info "Building dashboard"
  pnpm_run build
  ok "Dashboard built"
else
  ok "Skipping production dashboard build; dev server will compile on demand"
fi

if [[ "$SKIP_COLLECTOR" == "true" ]]; then
  warn "Skipping telemetry collector restart"
else
  restart_collector
fi

if [[ "$SKIP_DASHBOARD" == "true" ]]; then
  warn "Skipping dashboard restart"
else
  restart_dashboard
fi

ok "HivemindOS update finished"
