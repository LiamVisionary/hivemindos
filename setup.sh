#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-5020}"
COLLECTOR_PORT="${AGENT_TELEMETRY_PORT:-8787}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_SHARED_SKILLS=""
CLI_SHARED_SKILL_IMPORTS=""
CLI_SHARED_SKILL_TARGETS=""
CLI_INTERACTIVE=""
CLI_FORCE="false"
CLI_SKIP_DEPS="false"
CLI_BUILD_DASHBOARD="${HIVE_SETUP_BUILD_DASHBOARD:-false}"
CLI_SKIP_COLLECTOR="false"
CLI_SKIP_DASHBOARD="false"
CLI_COLLECTOR_ONLY=""
CLI_NETWORK_MODE=""

info() { printf "\033[1;36m%s\033[0m\n" "$*"; }
ok() { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$*"; }
fail() { printf "\033[1;31m✗\033[0m %s\n" "$*"; }

missing=()

prompt_yes_no() {
  local prompt="$1"
  local default="${2:-no}"
  local suffix="[y/N]"
  local answer=""
  if [[ "$default" == "yes" ]]; then suffix="[Y/n]"; fi
  setup_is_interactive || return 1
  read -r -p "$prompt $suffix " answer
  answer="$(printf "%s" "$answer" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  if [[ -z "$answer" ]]; then
    [[ "$default" == "yes" ]]
    return
  fi
  [[ "$answer" == "y" || "$answer" == "yes" ]]
}

load_homebrew_shellenv() {
  local brew_bin=""
  if command -v brew >/dev/null 2>&1; then
    brew_bin="$(command -v brew)"
  elif [[ -x /opt/homebrew/bin/brew ]]; then
    brew_bin="/opt/homebrew/bin/brew"
  elif [[ -x /usr/local/bin/brew ]]; then
    brew_bin="/usr/local/bin/brew"
  fi
  if [[ -n "$brew_bin" ]]; then
    eval "$("$brew_bin" shellenv)"
    return 0
  fi
  return 1
}

offer_homebrew_profile_update() {
  [[ "$(uname -s)" == "Darwin" && -n "${HOME:-}" ]] || return 0
  command -v brew >/dev/null 2>&1 || return 0
  local brew_bin
  brew_bin="$(command -v brew)"
  local profile_file="$HOME/.zprofile"
  local shellenv_line="eval \"\$($brew_bin shellenv zsh)\""
  if [[ -f "$profile_file" ]] && grep -Fqx "$shellenv_line" "$profile_file"; then
    ok "Homebrew shellenv already present in $profile_file"
    return 0
  fi
  if prompt_yes_no "Add Homebrew to your zsh PATH in $profile_file now?" "yes"; then
    touch "$profile_file"
    printf "\n%s\n" "$shellenv_line" >> "$profile_file"
    ok "Homebrew shellenv added to $profile_file"
  else
    warn "Homebrew is available for this setup run, but future terminals may need: $shellenv_line"
  fi
}

ensure_homebrew() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return 1
  fi
  if load_homebrew_shellenv; then
    offer_homebrew_profile_update
    return 0
  fi
  if ! prompt_yes_no "Homebrew is missing. Install Homebrew now so setup can install pnpm, Tailscale, and Syncthing?" "yes"; then
    return 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl is required to install Homebrew automatically"
    return 1
  fi
  info "Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  load_homebrew_shellenv || return 1
  offer_homebrew_profile_update
  ok "Homebrew installed: $(brew --version | head -1)"
}

refresh_tool_paths() {
  load_homebrew_shellenv >/dev/null 2>&1 || true
  if command -v npm >/dev/null 2>&1; then
    local npm_prefix=""
    npm_prefix="$(npm config get prefix 2>/dev/null || true)"
    if [[ -n "$npm_prefix" && "$npm_prefix" != "undefined" && -d "$npm_prefix/bin" ]]; then
      case ":$PATH:" in
        *":$npm_prefix/bin:"*) ;;
        *) export PATH="$npm_prefix/bin:$PATH" ;;
      esac
    fi
  fi
  hash -r 2>/dev/null || true
}

run_privileged() {
  if [[ "$(id -u)" == "0" ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    return 127
  fi
}

apt_install() {
  run_privileged apt-get update
  DEBIAN_FRONTEND=noninteractive run_privileged apt-get install -y "$@"
}

dnf_install() {
  run_privileged dnf install -y "$@"
}

yum_install() {
  run_privileged yum install -y "$@"
}

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

pnpm_version() {
  refresh_tool_paths
  if command -v pnpm >/dev/null 2>&1; then
    pnpm --version 2>/dev/null
    return
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm --version 2>/dev/null
    return
  fi
  return 1
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
  fail "pnpm is still not available on PATH"
  echo "Open a new terminal or run one of:"
  echo "  npm install -g pnpm"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "  brew install pnpm"
  fi
  exit 1
}

node_major_version() {
  node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true
}

node_version_is_supported() {
  local major
  command -v node >/dev/null 2>&1 || return 1
  major="$(node_major_version)"
  [[ "$major" =~ ^[0-9]+$ && "$major" -ge 20 ]]
}

install_node_if_missing() {
  refresh_tool_paths
  if node_version_is_supported; then
    ok "Node found: $(node --version)"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    warn "Node found, but HivemindOS needs Node.js 20+: $(node --version)"
  fi

  if [[ "$(uname -s)" == "Darwin" ]] && { command -v brew >/dev/null 2>&1 || ensure_homebrew; }; then
    if ! setup_is_interactive || prompt_yes_no "Install Node.js 20+ with Homebrew now?" "yes"; then
      info "Installing Node.js with Homebrew"
      brew install node
      refresh_tool_paths
    fi
  elif command -v apt-get >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
    info "Installing Node.js 22 with apt"
    curl -fsSL https://deb.nodesource.com/setup_22.x | run_privileged bash -
    apt_install nodejs
    refresh_tool_paths
  elif command -v dnf >/dev/null 2>&1; then
    info "Installing Node.js with dnf"
    dnf_install nodejs npm
    refresh_tool_paths
  elif command -v yum >/dev/null 2>&1; then
    info "Installing Node.js with yum"
    yum_install nodejs npm
    refresh_tool_paths
  fi

  if node_version_is_supported; then
    ok "Node found: $(node --version)"
    return 0
  fi

  missing+=("Node.js 20+")
  fail "Node.js 20+ is missing"
  return 1
}

usage() {
  cat <<'EOF'
Usage: ./setup.sh [options]

Options:
  --import-skills[=AGENTS]      Import skills into the shared notes hive.
                                With no AGENTS value, imports all supported agents.
                                AGENTS: all,none,codex,claude,hermes,gemini,openclaw,aeon
  --share-skills[=AGENTS]       Advertise/mirror the shared skill shelf to agents.
                                With no AGENTS value, targets all supported agents.
  --no-shared-skills            Seed the shared shelf only; do not import from or advertise to agents.
  --non-interactive             Do not prompt. Uses explicit flags/env or safe defaults.
  --interactive                 Force prompts when running in a TTY.
  --skip-deps                   Skip pnpm install.
  --build                       Run a production Next.js build during setup.
  --skip-build                  Deprecated no-op; production builds are skipped by default.
  --skip-collector              Skip collector service installation/restart.
  --skip-dashboard              Skip starting/restarting the dashboard dev server.
  --collector-only              Agent-bridge machine: install only the telemetry
                                collector and its single npm dependency. Skips the
                                workspace pnpm install, dashboard build, and dashboard
                                server. The mode is persisted; later ./setup.sh and
                                hive-update runs stay collector-only until --full.
  --full                        Clear a persisted collector-only mode and run the
                                full dashboard setup on this machine.
  --link                        Use app-managed Hivemind Link. This is the default.
  --ephemeral-node              Register the Link node as ephemeral (self-deletes from the tailnet when offline). For disposable machines and e2e runs.
  --system-tailscale            Use full system Tailscale setup for Hivemind Sync Syncthing, SSH, and rsync.
  --local-only                  Skip all multi-machine networking.
  --force                       Re-run setup work even when cached checks say it is current.
  -h, --help                    Show this help.

Environment overrides:
  HIVE_SHARED_SKILLS=true|false
  HIVE_SHARED_SKILL_IMPORTS=all|none|codex,hermes,aeon
  HIVE_SHARED_SKILL_TARGETS=all|none|codex,hermes,aeon
  HIVE_SETUP_INTERACTIVE=false
  HIVE_GITLAWB_SETUP=true|false (default true: every machine gets the gl CLI)
  HIVE_GITLAWB_IDENTITY=true|false (default true: per-machine DID)
  HIVE_GITLAWB_REGISTER=true|false (default true: gl register with GITLAWB_NODE)
  GITLAWB_NODE=<node URL, default https://node.gitlawb.com>
  HIVE_NETWORK_MODE=link|system-tailscale|local
  HIVE_TAILSCALE_AUTHKEY=<tailscale auth key for headless tailnet join with Tailscale SSH>
EOF
}

consume_optional_value() {
  local current="$1"
  local next="${2:-}"
  if [[ "$current" == *=* ]]; then
    printf "%s" "${current#*=}"
    return 0
  fi
  if [[ -n "$next" && "$next" != -* ]]; then
    printf "%s" "$next"
    return 0
  fi
  printf "all"
}

parse_args() {
  while (( $# > 0 )); do
    case "$1" in
      --import-skills|--import-skills=*)
        CLI_SHARED_SKILLS="true"
        CLI_SHARED_SKILL_IMPORTS="$(consume_optional_value "$1" "${2:-}")"
        if [[ "$1" != *=* && -n "${2:-}" && "$2" != -* ]]; then shift; fi
        ;;
      --share-skills|--share-skills=*|--shared-skill-agents|--shared-skill-agents=*)
        CLI_SHARED_SKILLS="true"
        CLI_SHARED_SKILL_IMPORTS="${CLI_SHARED_SKILL_IMPORTS:-none}"
        CLI_SHARED_SKILL_TARGETS="$(consume_optional_value "$1" "${2:-}")"
        if [[ "$1" != *=* && -n "${2:-}" && "$2" != -* ]]; then shift; fi
        ;;
      --no-shared-skills)
        CLI_SHARED_SKILLS="false"
        CLI_SHARED_SKILL_IMPORTS="none"
        CLI_SHARED_SKILL_TARGETS="none"
        ;;
      --non-interactive|--yes|-y)
        CLI_INTERACTIVE="false"
        ;;
      --interactive)
        CLI_INTERACTIVE="true"
        ;;
      --skip-deps)
        CLI_SKIP_DEPS="true"
        ;;
      --skip-build)
        CLI_BUILD_DASHBOARD="false"
        ;;
      --build|--production-build)
        CLI_BUILD_DASHBOARD="true"
        ;;
      --skip-collector)
        CLI_SKIP_COLLECTOR="true"
        ;;
      --skip-dashboard|--no-start)
        CLI_SKIP_DASHBOARD="true"
        ;;
      --collector-only)
        CLI_COLLECTOR_ONLY="true"
        ;;
      --full)
        CLI_COLLECTOR_ONLY="false"
        ;;
      --link)
        CLI_NETWORK_MODE="link"
        ;;
      --ephemeral-node)
        # Disposable machines (e2e runs, throwaway VPSes): the Link node
        # self-deletes from the tailnet after going offline, so test runs
        # never leave stale device registrations behind.
        export HIVE_LINK_EPHEMERAL="true"
        ;;
      --system-tailscale|--tailscale)
        CLI_NETWORK_MODE="system-tailscale"
        ;;
      --local-only|--local)
        CLI_NETWORK_MODE="local"
        ;;
      --force)
        CLI_FORCE="true"
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown setup option: $1"
        echo
        usage
        exit 2
        ;;
    esac
    shift
  done
}

cd "$ROOT"

parse_args "$@"

# Resolve collector-only mode: explicit flag wins, then HIVE_COLLECTOR_ONLY env,
# then the mode persisted by a previous --collector-only setup. Sticky so a plain
# ./setup.sh rerun on an agent-bridge machine cannot accidentally start the full
# dashboard install (which OOMs small hosts); use --full to opt back in.
if [[ -z "$CLI_COLLECTOR_ONLY" ]]; then
  CLI_COLLECTOR_ONLY="${HIVE_COLLECTOR_ONLY:-}"
fi
if [[ -z "$CLI_COLLECTOR_ONLY" && -f "$HOME/.hivemindos/collector.env" ]]; then
  CLI_COLLECTOR_ONLY="$(awk -F= '$1=="HIVE_COLLECTOR_ONLY"{print substr($0, index($0, "=") + 1)}' "$HOME/.hivemindos/collector.env" | tail -1)"
fi
case "$CLI_COLLECTOR_ONLY" in
  1|true|TRUE|yes|YES) CLI_COLLECTOR_ONLY="true" ;;
  *) CLI_COLLECTOR_ONLY="false" ;;
esac
if [[ "$CLI_COLLECTOR_ONLY" == "true" ]]; then
  CLI_BUILD_DASHBOARD="false"
  CLI_SKIP_DASHBOARD="true"
fi
export HIVE_COLLECTOR_ONLY="$CLI_COLLECTOR_ONLY"

info "HivemindOS setup"
if [[ "$CLI_COLLECTOR_ONLY" == "true" ]]; then
  info "Collector-only mode: installing the agent bridge without the dashboard (use --full to change)"
fi

install_rsync_if_missing() {
  if command -v rsync >/dev/null 2>&1; then
    ok "rsync found: $(rsync --version 2>/dev/null | head -1)"
    return
  fi
  if ! setup_is_interactive; then
    warn "rsync is missing; skipping optional Hivemind Sync repair install in non-interactive setup"
    return
  fi
  if ! prompt_yes_no "rsync is missing. Install it for Hivemind Sync vault repair?" "yes"; then
    warn "Skipping rsync install; Hivemind Sync rsync repair is disabled"
    return
  fi
  warn "rsync is missing; trying to install it for Hivemind Sync vault repair"
  if [[ "$(uname -s)" == "Darwin" ]] && { command -v brew >/dev/null 2>&1 || ensure_homebrew; }; then
    brew install rsync
  elif command -v apt-get >/dev/null 2>&1; then
    apt_install rsync
  elif command -v dnf >/dev/null 2>&1; then
    dnf_install rsync
  elif command -v yum >/dev/null 2>&1; then
    yum_install rsync
  else
    missing+=("Install rsync for Hivemind Sync vault repair")
    fail "rsync is missing"
    return
  fi
  command -v rsync >/dev/null 2>&1 && ok "rsync installed"
}

install_syncthing_if_missing() {
  if command -v syncthing >/dev/null 2>&1; then
    ok "Syncthing found: $(syncthing --version 2>/dev/null | head -1)"
    return
  fi
  if ! setup_is_interactive; then
    warn "Syncthing is missing; skipping optional Hivemind Sync shared-brain folder sync in non-interactive setup"
    return
  fi
  if ! prompt_yes_no "Syncthing is missing. Install it for Hivemind Sync shared-brain folder sync?" "yes"; then
    warn "Skipping Syncthing install; Hivemind Sync shared-brain folder sync is disabled"
    return
  fi
  warn "Syncthing is missing; trying to install it for Hivemind Sync folder sync"
  if [[ "$(uname -s)" == "Darwin" ]] && { command -v brew >/dev/null 2>&1 || ensure_homebrew; }; then
    brew install syncthing
  elif command -v apt-get >/dev/null 2>&1; then
    apt_install syncthing
  elif command -v dnf >/dev/null 2>&1; then
    dnf_install syncthing
  elif command -v yum >/dev/null 2>&1; then
    yum_install syncthing
  else
    missing+=("Install Syncthing for Hivemind Sync folder sync")
    fail "Syncthing is missing"
    return
  fi
  command -v syncthing >/dev/null 2>&1 && ok "Syncthing installed"
}

install_unison_if_missing() {
  if command -v unison >/dev/null 2>&1; then
    ok "Unison found: $(unison -version 2>/dev/null | head -1)"
    return
  fi
  if ! setup_is_interactive; then
    warn "Unison is missing; skipping optional AEON Obsidian folder mirror install in non-interactive setup"
    return
  fi
  if ! prompt_yes_no "Unison is missing. Install it for bidirectional AEON repo <-> Obsidian folder mirroring?" "yes"; then
    warn "Skipping Unison install; AEON Obsidian folder mirroring can be enabled later"
    return
  fi
  warn "Unison is missing; trying to install it for AEON Obsidian folder mirroring"
  if [[ "$(uname -s)" == "Darwin" ]] && { command -v brew >/dev/null 2>&1 || ensure_homebrew; }; then
    brew install unison
  elif command -v apt-get >/dev/null 2>&1; then
    apt_install unison
  elif command -v dnf >/dev/null 2>&1; then
    dnf_install unison
  elif command -v yum >/dev/null 2>&1; then
    yum_install unison
  else
    missing+=("Install Unison for AEON Obsidian folder mirroring")
    fail "Unison is missing"
    return
  fi
  command -v unison >/dev/null 2>&1 && ok "Unison installed"
}

start_syncthing_if_available() {
  command -v syncthing >/dev/null 2>&1 || return
  syncthing_responds() {
    curl -fsS --max-time 2 http://127.0.0.1:8384/rest/system/ping >/dev/null 2>&1
  }
  wait_for_syncthing() {
    local attempt
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
      syncthing_responds && return 0
      sleep 1
    done
    return 1
  }
  if wait_for_syncthing; then
    ok "Syncthing is running on 127.0.0.1:8384"
    return
  fi

  if [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    brew services start syncthing >/dev/null 2>&1 || true
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl --user enable --now syncthing >/dev/null 2>&1 || true
  fi

  if ! wait_for_syncthing; then
    if command -v syncthing >/dev/null 2>&1 && ! pgrep -x syncthing >/dev/null 2>&1; then
      nohup syncthing --no-browser --gui-address=127.0.0.1:8384 >/dev/null 2>&1 &
    fi
    wait_for_syncthing || true
  fi

  if syncthing_responds; then
    ok "Syncthing is running on 127.0.0.1:8384"
  else
    warn "Syncthing is installed, but its web UI is not responding yet"
    warn "Setup will continue; open Syncthing later at http://127.0.0.1:8384 if shared-brain sync needs pairing"
  fi
}

tailscale_cli_candidates() {
  if [[ -n "${HIVE_TAILSCALE_CLI:-}" && -x "${HIVE_TAILSCALE_CLI:-}" ]]; then
    printf "%s\n" "$HIVE_TAILSCALE_CLI"
  fi
  homebrew_tailscale_cli_candidates
  local path_cli
  path_cli="$(command -v tailscale 2>/dev/null || true)"
  if [[ -n "$path_cli" ]] && ! tailscale_cli_is_macos_app_shim "$path_cli"; then
    printf "%s\n" "$path_cli"
  fi
  [[ -x /Applications/Tailscale.app/Contents/MacOS/tailscale ]] && printf "%s\n" "/Applications/Tailscale.app/Contents/MacOS/tailscale"
  [[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]] && printf "%s\n" "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
}

format_tailscale_error() {
  printf "%s" "$1" | tr '\n' ' ' | sed 's/[[:space:]]\{1,\}/ /g'
}

tailscale_cli_is_macos_app_shim() {
  [[ -f "$1" ]] && grep -q "/Applications/Tailscale.app/Contents/MacOS" "$1" 2>/dev/null
}

tailscale_ssh_error_is_sandboxed() {
  [[ "$1" == *"sandboxed Tailscale GUI builds"* ]]
}

homebrew_tailscale_cli_candidates() {
  local prefix candidate
  for candidate in /opt/homebrew/opt/tailscale/bin/tailscale /opt/homebrew/bin/tailscale /usr/local/opt/tailscale/bin/tailscale /usr/local/bin/tailscale; do
    [[ -x "$candidate" ]] && ! tailscale_cli_is_macos_app_shim "$candidate" && printf "%s\n" "$candidate"
  done
  if command -v brew >/dev/null 2>&1; then
    prefix="$(brew --prefix tailscale 2>/dev/null || true)"
    [[ -n "$prefix" && -x "$prefix/bin/tailscale" ]] && printf "%s\n" "$prefix/bin/tailscale"
  fi
}

homebrew_tailscaled_candidates() {
  local prefix candidate
  for candidate in /opt/homebrew/opt/tailscale/bin/tailscaled /opt/homebrew/bin/tailscaled /usr/local/opt/tailscale/bin/tailscaled /usr/local/bin/tailscaled; do
    [[ -x "$candidate" ]] && printf "%s\n" "$candidate"
  done
  if command -v brew >/dev/null 2>&1; then
    prefix="$(brew --prefix tailscale 2>/dev/null || true)"
    [[ -n "$prefix" && -x "$prefix/bin/tailscaled" ]] && printf "%s\n" "$prefix/bin/tailscaled"
  fi
}

first_homebrew_tailscale_cli() {
  homebrew_tailscale_cli_candidates | awk '!seen[$0]++ { print; exit }'
}

tailscale_cli_socket_arg() {
  local cli="$1"
  [[ "$(uname -s)" == "Darwin" ]] || return 1
  case "$cli" in
    /opt/homebrew/*|/usr/local/*) ;;
    *) return 1 ;;
  esac
  if [[ -S /var/run/tailscaled.socket ]]; then
    printf "%s\n" "--socket=/var/run/tailscaled.socket"
    return 0
  fi
  return 1
}

run_tailscale_cli() {
  local cli="$1"
  shift
  local socket_arg
  socket_arg="$(tailscale_cli_socket_arg "$cli" || true)"
  if [[ -n "$socket_arg" ]]; then
    "$cli" "$socket_arg" "$@"
  else
    "$cli" "$@"
  fi
}

run_tailscale_cli_sudo() {
  local cli="$1"
  shift
  local socket_arg
  socket_arg="$(tailscale_cli_socket_arg "$cli" || true)"
  if [[ -n "$socket_arg" ]]; then
    sudo "$cli" "$socket_arg" "$@"
  else
    sudo "$cli" "$@"
  fi
}

run_tailscale_cli_sudo_noninteractive() {
  local cli="$1"
  shift
  local socket_arg
  socket_arg="$(tailscale_cli_socket_arg "$cli" || true)"
  if [[ -n "$socket_arg" ]]; then
    sudo -n "$cli" "$socket_arg" "$@"
  else
    sudo -n "$cli" "$@"
  fi
}

tailscale_prefs_has() {
  local pattern="$1"
  local cli
  if [[ -z "${HIVE_TAILSCALE_CLI:-}" ]] && command -v tailscale >/dev/null 2>&1 && tailscale debug prefs 2>/dev/null | grep -q "$pattern"; then
    return 0
  fi
  while IFS= read -r cli; do
    [[ -n "$cli" ]] || continue
    run_tailscale_cli "$cli" debug prefs 2>/dev/null | grep -q "$pattern" && return 0
    run_tailscale_cli_sudo_noninteractive "$cli" debug prefs 2>/dev/null | grep -q "$pattern" && return 0
  done < <(tailscale_cli_candidates | awk '!seen[$0]++')
  return 1
}

homebrew_tailscaled_is_available() {
  [[ -n "$(homebrew_tailscaled_candidates | head -1)" ]]
}

homebrew_tailscale_formula_installed() {
  command -v brew >/dev/null 2>&1 && brew list --formula tailscale >/dev/null 2>&1
}

tailscale_up_retry_args_from_error() {
  awk '
    /^[[:space:]]*tailscale up[[:space:]]/ {
      sub(/^[[:space:]]*tailscale up[[:space:]]*/, "");
      print;
      exit;
    }
  '
}

tailscale_auth_url_from_output() {
  awk '/https:\/\/login\.tailscale\.com\/a\// { print $1; exit }'
}

wait_for_tailscale_running() {
  local formula_cli="$1"
  local seconds="${2:-180}"
  local elapsed=0
  while (( elapsed < seconds )); do
    if run_tailscale_cli_sudo "$formula_cli" status >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  return 1
}

wait_for_tailscale_auth_confirmation() {
  setup_is_interactive || return 0
  printf "Press Enter once you've logged in at the above URL. "
  read -r _ || true
}

tailscale_status_connected() {
  local cli
  if [[ -z "${HIVE_TAILSCALE_CLI:-}" ]] && command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
    return 0
  fi
  while IFS= read -r cli; do
    [[ -n "$cli" ]] || continue
    run_tailscale_cli "$cli" status >/dev/null 2>&1 && return 0
    run_tailscale_cli_sudo_noninteractive "$cli" status >/dev/null 2>&1 && return 0
  done < <(tailscale_cli_candidates | awk '!seen[$0]++')
  return 1
}

tailscale_ip4() {
  local cli ip
  if [[ -z "${HIVE_TAILSCALE_CLI:-}" ]] && command -v tailscale >/dev/null 2>&1; then
    ip="$(tailscale ip -4 2>/dev/null | head -1 || true)"
    [[ -n "$ip" ]] && printf "%s\n" "$ip" && return 0
  fi
  while IFS= read -r cli; do
    [[ -n "$cli" ]] || continue
    ip="$(run_tailscale_cli "$cli" ip -4 2>/dev/null | head -1 || true)"
    [[ -n "$ip" ]] && printf "%s\n" "$ip" && return 0
    ip="$(run_tailscale_cli_sudo_noninteractive "$cli" ip -4 2>/dev/null | head -1 || true)"
    [[ -n "$ip" ]] && printf "%s\n" "$ip" && return 0
  done < <(tailscale_cli_candidates | awk '!seen[$0]++')
  return 1
}

connect_existing_tailscale_cli() {
  local cli="$1"
  local output retry_args auth_url
  output="$(run_with_timeout 45 run_tailscale_cli_sudo "$cli" up --timeout=30s 2>&1)" && return 0
  retry_args="$(printf "%s\n" "$output" | tailscale_up_retry_args_from_error)"
  if [[ -n "$retry_args" ]]; then
    # shellcheck disable=SC2086
    output="$(run_with_timeout 45 run_tailscale_cli_sudo "$cli" up $retry_args 2>&1)" && return 0
  fi
  auth_url="$(printf "%s\n" "$output" | tailscale_auth_url_from_output)"
  if [[ -n "$auth_url" ]]; then
    warn "Tailscale sign-in required."
    printf "Open this URL on any device to sign in:\n  %s\n" "$auth_url"
    wait_for_tailscale_auth_confirmation
    if wait_for_tailscale_running "$cli" 180; then
      return 0
    fi
  fi
  printf "%s\n" "$output" >&2
  return 1
}

connect_homebrew_tailscaled() {
  local formula_cli="$1"
  local output retry_args auth_url
  output="$(run_with_timeout 45 run_tailscale_cli_sudo "$formula_cli" up --timeout=30s 2>&1)" && return 0
  retry_args="$(printf "%s\n" "$output" | tailscale_up_retry_args_from_error)"
  if [[ -n "$retry_args" ]]; then
    # shellcheck disable=SC2086
    output="$(run_with_timeout 45 run_tailscale_cli_sudo "$formula_cli" up $retry_args 2>&1)" && return 0
  fi
  auth_url="$(printf "%s\n" "$output" | tailscale_auth_url_from_output)"
  if [[ -n "$auth_url" ]]; then
    warn "Tailscale sign-in required."
    printf "Open this URL on any device to sign in:\n  %s\n" "$auth_url"
    wait_for_tailscale_auth_confirmation
    if wait_for_tailscale_running "$formula_cli" 180; then
      return 0
    fi
  fi
  printf "%s\n" "$output" >&2
  return 1
}

quit_macos_tailscale_gui() {
  [[ "$(uname -s)" == "Darwin" ]] || return 0
  osascript -e 'quit app "Tailscale"' >/dev/null 2>&1 || true
  sleep 2
}

setup_homebrew_tailscaled_for_fleet() {
  [[ "$(uname -s)" == "Darwin" ]] || return 1
  setup_is_interactive || return 1
  [[ "${HIVE_TAILSCALED_SWITCH_ATTEMPTED:-false}" != "true" ]] || return 1
  export HIVE_TAILSCALED_SWITCH_ATTEMPTED="true"
  command -v brew >/dev/null 2>&1 || ensure_homebrew || return 1

  local prompt="Use the Homebrew/open-source Tailscale daemon for reliable Fleet reachability and Tailscale SSH on this Mac?"
  if homebrew_tailscaled_is_available; then
    prompt="Start and connect the installed Homebrew Tailscale daemon for reliable Fleet reachability and Tailscale SSH on this Mac?"
  fi
  if ! prompt_yes_no "$prompt" "yes"; then
    return 1
  fi

  if ! homebrew_tailscale_formula_installed; then
    info "Installing Homebrew Tailscale CLI/daemon"
    HOMEBREW_NO_INSTALL_CLEANUP=1 brew install --formula tailscale
  elif homebrew_tailscaled_is_available; then
    ok "Homebrew tailscaled found: $(homebrew_tailscaled_candidates | head -1)"
  fi

  info "Restarting Homebrew tailscaled service"
  quit_macos_tailscale_gui
  if ! sudo brew services restart tailscale; then
    warn "Could not restart the Homebrew tailscaled service"
    return 1
  fi
  refresh_tool_paths

  local formula_cli
  formula_cli="$(first_homebrew_tailscale_cli)"
  if [[ -z "$formula_cli" ]]; then
    warn "Homebrew tailscale CLI was not found after install/start"
    return 1
  fi
  export HIVE_TAILSCALE_CLI="$formula_cli"

  info "Connecting Homebrew tailscaled"
  if ! connect_homebrew_tailscaled "$formula_cli"; then
    warn "Homebrew tailscaled did not finish connecting"
    warn "Setup waited for Tailscale auth, but the daemon did not become reachable before the timeout."
    return 1
  fi
  if ! run_with_timeout 10 run_tailscale_cli_sudo "$formula_cli" status >/dev/null 2>&1; then
    warn "Homebrew tailscaled started, but status did not respond quickly"
    return 1
  fi
  ok "Homebrew tailscaled is connected"
}

prefer_homebrew_tailscaled_for_macos_fleet() {
  [[ "$(uname -s)" == "Darwin" ]] || return 0
  setup_is_interactive || return 0
  if tailscale_prefs_has '"RunSSH": true'; then
    return 0
  fi
  setup_homebrew_tailscaled_for_fleet || true
  refresh_tool_paths
}

warn_tailscale_ssh_unavailable() {
  if [[ -n "$tailscale_ssh_error" ]]; then
    warn "Tailscale said: $(format_tailscale_error "$tailscale_ssh_error")"
  fi
  if tailscale_ssh_error_is_sandboxed "$tailscale_ssh_error"; then
    warn "This macOS Tailscale build cannot host Tailscale SSH. Shared-brain Syncthing can still work, but Tailscale SSH features from this Mac are disabled."
    if homebrew_tailscaled_is_available; then
      warn "Homebrew tailscaled is installed, but the active CLI call still reached the sandboxed GUI backend."
    else
      warn "Setup can install/start the Homebrew tailscale daemon interactively, or follow: https://github.com/tailscale/tailscale/wiki/Tailscaled-on-macOS"
    fi
  else
    warn "Run this on each sync machine if prompted for admin rights: sudo tailscale set --ssh"
  fi
}

try_homebrew_tailscaled_for_ssh() {
  tailscale_ssh_error_is_sandboxed "$tailscale_ssh_error" || return 1
  setup_homebrew_tailscaled_for_fleet || return 1
  tailscale_ssh_error=""
  run_tailscale_set_ssh false || run_tailscale_set_ssh_sudo_noninteractive || run_tailscale_set_ssh true
}

run_tailscale_set_ssh() {
  local use_sudo="${1:-false}"
  local cli output
  tailscale_ssh_error=""
  while IFS= read -r cli; do
    [[ -n "$cli" ]] || continue
    if [[ "$use_sudo" == "true" ]]; then
      output="$(run_tailscale_cli_sudo "$cli" set --ssh=true 2>&1)" || {
        tailscale_ssh_error="$output"
        continue
      }
    else
      output="$(run_tailscale_cli "$cli" set --ssh=true 2>&1)" || {
        tailscale_ssh_error="$output"
        continue
      }
    fi
    return 0
  done < <(tailscale_cli_candidates | awk '!seen[$0]++')
  return 1
}

run_tailscale_set_ssh_sudo_noninteractive() {
  local cli output
  while IFS= read -r cli; do
    [[ -n "$cli" ]] || continue
    output="$(run_tailscale_cli_sudo_noninteractive "$cli" set --ssh=true 2>&1)" || {
      if ! tailscale_ssh_error_is_sandboxed "$tailscale_ssh_error"; then
        tailscale_ssh_error="$output"
      fi
      continue
    }
    return 0
  done < <(tailscale_cli_candidates | awk '!seen[$0]++')
  return 1
}

enable_tailscale_ssh() {
  if ! tailscale_status_connected; then
    return 1
  fi
  local help_output=""
  while IFS= read -r cli; do
    [[ -n "$cli" ]] || continue
    help_output="$(run_tailscale_cli "$cli" set --help 2>&1 || true)"
    [[ "$help_output" == *"--ssh"* ]] && break
  done < <(tailscale_cli_candidates | awk '!seen[$0]++')
  if [[ "$help_output" != *"--ssh"* ]]; then
    warn "This Tailscale version does not support Tailscale SSH"
    return 1
  fi
  if tailscale_prefs_has '"RunSSH": true'; then
    ok "Tailscale SSH already advertised by this machine"
    return 0
  fi
  tailscale_ssh_error=""
  if run_tailscale_set_ssh false; then
    ok "Tailscale SSH advertised by this machine"
  elif tailscale_ssh_error_is_sandboxed "$tailscale_ssh_error"; then
    if try_homebrew_tailscaled_for_ssh; then
      ok "Tailscale SSH advertised by this machine"
    else
      warn "Could not advertise Tailscale SSH automatically"
      warn_tailscale_ssh_unavailable
      return 1
    fi
  elif command -v sudo >/dev/null 2>&1 && run_tailscale_set_ssh_sudo_noninteractive; then
    ok "Tailscale SSH advertised by this machine"
  elif command -v sudo >/dev/null 2>&1 && setup_is_interactive && prompt_yes_no "Enable optional Hivemind Sync fallback over Tailscale SSH now?" "yes"; then
    if run_tailscale_set_ssh true; then
      ok "Tailscale SSH advertised by this machine"
    else
      warn "Tailscale SSH was not enabled; Fleet HTTP and Syncthing can still work"
      warn_tailscale_ssh_unavailable
      return 1
    fi
  else
    warn "Tailscale SSH was not enabled; Fleet HTTP and Syncthing can still work"
    warn_tailscale_ssh_unavailable
    return 1
  fi
  if ! tailscale_prefs_has '"RunSSH": true'; then
    warn "Tailscale accepted the SSH setting, but verification did not report RunSSH=true yet"
    return 1
  fi
  return 0
}

tailscale_authkey_value() {
  local value="${HIVE_TAILSCALE_AUTHKEY:-${TS_AUTHKEY:-}}"
  if [[ -z "$value" && -f "$HOME/.hivemindos/.env" ]]; then
    value="$(sed -n 's/^\(export \)\{0,1\}HIVE_TAILSCALE_AUTHKEY=//p' "$HOME/.hivemindos/.env" | head -1 | sed "s/^[\"']//; s/[\"']\$//")"
  fi
  printf "%s" "$value"
}

# Join (or re-join) the tailnet headlessly with an auth key and Tailscale SSH
# advertised in the same step. This is what keeps remote/update runs from
# stranding a logged-out node that nobody can SSH back into.
tailscale_up_with_authkey() {
  local cli="$1" authkey
  authkey="$(tailscale_authkey_value)"
  [[ -n "$authkey" ]] || return 1
  run_tailscale_cli_sudo_noninteractive "$cli" up --ssh --authkey "$authkey" >/dev/null 2>&1 \
    || run_tailscale_cli "$cli" up --ssh --authkey "$authkey" >/dev/null 2>&1
}

# Linux servers are administered over Tailscale SSH, so even when HivemindOS
# networking runs in link mode (the default), a setup/update run must never
# leave an installed-but-stopped or logged-out system tailscaled behind.
# Best-effort: warns instead of failing setup.
maintain_system_tailscale_ssh() {
  [[ "$(uname -s)" == "Linux" ]] || return 0
  local cli
  cli="$(tailscale_cli_candidates | awk '!seen[$0]++ { print; exit }')"
  [[ -n "$cli" ]] || return 0
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now tailscaled >/dev/null 2>&1 \
      || sudo -n systemctl enable --now tailscaled >/dev/null 2>&1 \
      || true
  fi
  if ! tailscale_status_connected; then
    if tailscale_up_with_authkey "$cli"; then
      ok "System Tailscale re-joined the tailnet with Tailscale SSH advertised"
      return 0
    fi
    warn "System Tailscale is installed but logged out, so Tailscale SSH to this machine is down."
    warn "Re-join headlessly: set HIVE_TAILSCALE_AUTHKEY in ~/.hivemindos/.env (key from https://login.tailscale.com/admin/settings/keys) and re-run setup,"
    warn "or run once: sudo tailscale up --ssh"
    return 0
  fi
  enable_tailscale_ssh || true
}

install_tailscale_if_missing() {
  if tailscale_status_connected || command -v tailscale >/dev/null 2>&1 || [[ -n "$(tailscale_cli_candidates | head -1)" ]]; then
    return 0
  fi

  if ! setup_is_interactive; then
    return 1
  fi
  if ! prompt_yes_no "Tailscale is missing. Install it for Hivemind Sync between machines?" "yes"; then
    return 1
  fi

  if [[ "$(uname -s)" == "Darwin" ]] && { command -v brew >/dev/null 2>&1 || ensure_homebrew; }; then
    warn "Tailscale is not installed; trying to install it for Hivemind Sync"
    HOMEBREW_NO_INSTALL_CLEANUP=1 brew install --formula tailscale || true
  elif command -v apt-get >/dev/null 2>&1; then
    if command -v curl >/dev/null 2>&1; then
      warn "Tailscale is not installed; trying to install it for Hivemind Sync"
      curl -fsSL https://tailscale.com/install.sh | sh || true
    else
      warn "Install curl first, then run: curl -fsSL https://tailscale.com/install.sh | sh"
    fi
  else
    return 1
  fi

  refresh_tool_paths
  if command -v tailscale >/dev/null 2>&1 || [[ -n "$(tailscale_cli_candidates | head -1)" ]]; then
    ok "Tailscale installed"
    return 0
  fi

  warn "Tailscale install did not put the tailscale CLI on PATH"
  return 1
}

ensure_tailscale_connected() {
  if tailscale_status_connected; then
    return 0
  fi
  install_tailscale_if_missing || return 1
  if tailscale_status_connected; then
    return 0
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    setup_homebrew_tailscaled_for_fleet || true
    refresh_tool_paths
    tailscale_status_connected && return 0
  fi

  local cli
  cli="$(tailscale_cli_candidates | awk '!seen[$0]++ { print; exit }')"
  if [[ -z "$cli" ]]; then
    return 1
  fi
  if tailscale_up_with_authkey "$cli"; then
    ok "Tailscale joined the tailnet with an auth key (Tailscale SSH advertised)"
    return 0
  fi
  if ! setup_is_interactive || ! prompt_yes_no "Tailscale is installed but not logged in. Start Tailscale login now and wait for it to finish?" "yes"; then
    return 1
  fi
  connect_existing_tailscale_cli "$cli"
}

obsidian_is_installed() {
  if command -v obsidian >/dev/null 2>&1; then
    return 0
  fi
  [[ "$(uname -s)" == "Darwin" && -d "/Applications/Obsidian.app" ]]
}

install_obsidian_if_missing() {
  if obsidian_is_installed; then
    ok "Obsidian found"
    return 0
  fi
  if ! setup_is_interactive; then
    warn "Obsidian is missing; skipping optional desktop app install in non-interactive setup"
    return 0
  fi
  if ! prompt_yes_no "Obsidian is missing. Install it for the shared brain desktop app now?" "yes"; then
    warn "Skipping Obsidian install; the shared brain still works as local markdown files"
    return 0
  fi
  if [[ "$(uname -s)" == "Darwin" ]] && { command -v brew >/dev/null 2>&1 || ensure_homebrew; }; then
    info "Installing Obsidian with Homebrew"
    brew install --cask obsidian
  elif command -v flatpak >/dev/null 2>&1; then
    info "Installing Obsidian with Flatpak"
    flatpak install -y flathub md.obsidian.Obsidian
  elif command -v snap >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    info "Installing Obsidian with snap"
    sudo snap install obsidian --classic
  else
    warn "No automatic Obsidian installer found for this OS"
    warn "Install Obsidian later from https://obsidian.md/download"
    return 0
  fi
  if obsidian_is_installed; then
    ok "Obsidian installed"
  else
    warn "Obsidian install finished, but setup could not verify the app on PATH"
  fi
}

install_gpg_if_missing() {
  if command -v gpg >/dev/null 2>&1; then
    ok "GPG found: $(gpg --version 2>/dev/null | head -1)"
    return 0
  fi
  if ! setup_is_interactive; then
    warn "GPG is missing; encrypted hive-env-add note backups are disabled in non-interactive setup"
    return 0
  fi
  if ! prompt_yes_no "GPG is missing. Install GnuPG so hive-env-add can refresh encrypted env backups?" "yes"; then
    warn "Skipping GnuPG install; hive-env-add will still update local env files"
    return 0
  fi
  if [[ "$(uname -s)" == "Darwin" ]] && { command -v brew >/dev/null 2>&1 || ensure_homebrew; }; then
    info "Installing GnuPG with Homebrew"
    brew install gnupg
  elif command -v apt-get >/dev/null 2>&1; then
    info "Installing GnuPG with apt"
    apt_install gnupg
  elif command -v dnf >/dev/null 2>&1; then
    info "Installing GnuPG with dnf"
    dnf_install gnupg2
  elif command -v yum >/dev/null 2>&1; then
    info "Installing GnuPG with yum"
    yum_install gnupg2
  else
    warn "No automatic GnuPG installer found for this OS"
    warn "Install GnuPG later to enable encrypted hive-env-add note backups"
    return 0
  fi
  if command -v gpg >/dev/null 2>&1; then
    ok "GPG installed: $(gpg --version 2>/dev/null | head -1)"
  else
    warn "GnuPG install finished, but setup could not verify gpg on PATH"
  fi
}

python312_command() {
  local py
  for py in python3.14 python3.13 python3.12 python3; do
    command -v "$py" >/dev/null 2>&1 || continue
    "$py" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' >/dev/null 2>&1 || continue
    printf "%s\n" "$py"
    return 0
  done
  return 1
}

ensure_hive_pulse_python() {
  local py
  refresh_tool_paths
  if py="$(python312_command)"; then
    ok "Hive Pulse Python found: $($py --version 2>&1)"
    return 0
  fi
  if ! setup_is_interactive; then
    warn "Python 3.12+ is missing; hive-pulse will need Python 3.12+ before it can run"
    missing+=("Python 3.12+ for hive-pulse")
    return 0
  fi
  if [[ "$(uname -s)" == "Darwin" ]] && { command -v brew >/dev/null 2>&1 || ensure_homebrew; }; then
    if prompt_yes_no "Python 3.12+ is missing. Install python@3.12 so hive-pulse works out of the box?" "yes"; then
      HOMEBREW_NO_INSTALL_CLEANUP=1 brew install python@3.12
      refresh_tool_paths
    fi
  elif command -v apt-get >/dev/null 2>&1; then
    if prompt_yes_no "Python 3.12+ is missing. Try installing python3.12 with apt for hive-pulse?" "yes"; then
      apt_install python3.12 || warn "apt could not install python3.12 from the configured repositories"
    fi
  elif command -v dnf >/dev/null 2>&1; then
    if prompt_yes_no "Python 3.12+ is missing. Try installing python3.12 with dnf for hive-pulse?" "yes"; then
      dnf_install python3.12 || warn "dnf could not install python3.12 from the configured repositories"
    fi
  elif command -v yum >/dev/null 2>&1; then
    if prompt_yes_no "Python 3.12+ is missing. Try installing python3.12 with yum for hive-pulse?" "yes"; then
      yum_install python3.12 || warn "yum could not install python3.12 from the configured repositories"
    fi
  fi
  refresh_tool_paths
  if py="$(python312_command)"; then
    ok "Hive Pulse Python ready: $($py --version 2>&1)"
  else
    warn "Python 3.12+ is still missing; install it or set HIVE_PULSE_PYTHON before running hive-pulse"
    missing+=("Python 3.12+ for hive-pulse")
  fi
}

install_hive_env_add() {
  local bin_dir="${HOME}/.local/bin"
  local command_name command_path script_path
  mkdir -p "$bin_dir"
  for command_name in hive-env-add hive-env-remove hive-env-delete hive-env-run hive-env-check hive-transfer hive-handoff hivemind-mcp hive-update hive-brain hive-brain-hook hive-pulse; do
    command_path="$bin_dir/$command_name"
    script_path="$ROOT/scripts/$command_name"
    chmod +x "$script_path"
    if [[ -L "$command_path" ]]; then
      rm -f "$command_path"
    fi
    cat > "$command_path" <<EOF
#!/usr/bin/env sh
set -eu

command_name="$command_name"

run_helper() {
  root="\$1"
  shift
  helper="\$root/scripts/\$command_name"
  if [ -x "\$helper" ]; then
    HIVE_ENV_PROJECT_ROOT="\$root" exec "\$helper" "\$@"
  fi
  return 1
}

run_helper "$ROOT" "\$@" || true
for root in "\$PWD" "\$HOME/hivemindos" "\$HOME/omni-agent-hivemind" "\$HOME/Documents/code/projects/hivemind-os"; do
  run_helper "\$root" "\$@" || true
done
found="\$(find "\$HOME" -maxdepth 6 -type f -path "*/scripts/\$command_name" 2>/dev/null | head -1 || true)"
if [ -n "\$found" ] && [ -x "\$found" ]; then
  root="\$(cd "\$(dirname "\$found")/.." && pwd)"
  HIVE_ENV_PROJECT_ROOT="\$root" exec "\$found" "\$@"
fi
echo "\$command_name could not find a HivemindOS checkout. Set HIVE_ENV_PROJECT_ROOT or rerun setup.sh from the checkout." >&2
exit 127
EOF
    chmod +x "$command_path"
    ok "$command_name installed: $command_path"
  done
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) warn "Add $bin_dir to PATH to run hive-env-add, hive-env-remove, hive-env-delete, hive-env-run, hive-env-check, hive-transfer, hive-handoff, hivemind-mcp, hive-update, hive-brain, hive-brain-hook, and hive-pulse from any folder" ;;
  esac
}
install_pnpm_if_missing() {
  refresh_tool_paths
  if command -v pnpm >/dev/null 2>&1; then
    ok "pnpm found: $(pnpm --version)"
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    if ! setup_is_interactive || prompt_yes_no "pnpm is missing. Enable pnpm through Corepack now?" "yes"; then
      info "pnpm not found; enabling pnpm through corepack"
      corepack enable
      corepack prepare pnpm@8.6.12 --activate
      ok "pnpm enabled: $(pnpm_version)"
      return 0
    fi
  fi
  if command -v npm >/dev/null 2>&1; then
    if setup_is_interactive && prompt_yes_no "pnpm is missing. Install pnpm globally with npm now?" "yes"; then
      info "Installing pnpm with npm"
      npm install -g pnpm
      ok "pnpm installed: $(pnpm_version)"
      return 0
    fi
  fi
  if setup_is_interactive && [[ "$(uname -s)" == "Darwin" ]] && { command -v brew >/dev/null 2>&1 || ensure_homebrew; }; then
    if prompt_yes_no "pnpm is missing. Install pnpm with Homebrew now?" "yes"; then
      info "Installing pnpm with Homebrew"
      brew install pnpm
      ok "pnpm installed: $(pnpm_version)"
      return 0
    fi
  fi
  missing+=("pnpm or corepack")
  fail "pnpm is missing"
  return 1
}

setup_is_interactive() {
  if [[ "$CLI_INTERACTIVE" == "false" ]]; then return 1; fi
  if [[ "$CLI_INTERACTIVE" == "true" ]]; then [[ -t 0 && -t 1 ]] && return 0 || return 1; fi
  [[ -t 0 && -t 1 && "${CI:-}" != "true" && "${HIVE_SETUP_INTERACTIVE:-true}" != "false" ]]
}

normalize_agent_list() {
  printf "%s" "$1" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]'
}

interactive_skill_multiselect() {
  node "$ROOT/scripts/shared-skill-select.mjs"
}

configure_shared_skills() {
  local enable="${CLI_SHARED_SKILLS:-${HIVE_SHARED_SKILLS:-}}"
  local imports="${CLI_SHARED_SKILL_IMPORTS:-${HIVE_SHARED_SKILL_IMPORTS:-}}"
  local targets="${CLI_SHARED_SKILL_TARGETS:-${HIVE_SHARED_SKILL_TARGETS:-}}"

  if [[ -n "$enable" ]]; then
    case "$(normalize_agent_list "$enable")" in
      0|false|no|off)
        imports="none"
        targets="none"
        ;;
      *)
        imports="${imports:-all}"
        if [[ "$(normalize_agent_list "${imports:-}")" == "all" ]]; then
          targets="${targets:-all}"
        else
          targets="${targets:-$imports}"
        fi
        ;;
    esac
  elif setup_is_interactive; then
    echo
    info "Shared skill setup"
    echo "Share skills between local agent runtimes through the shared notes Skills shelf?"
    read -r -p "Allow shared skills? [Y/n] " enable
    case "$(normalize_agent_list "$enable")" in
      n|no|0|false|off)
        imports="none"
        targets="none"
        ;;
      *)
        selection="$(interactive_skill_multiselect)"
        if [[ "$selection" == "all" ]]; then
          imports="all"
          targets="all"
        else
          imports="$selection"
          targets="$selection"
        fi
        ;;
    esac
  else
    imports="${imports:-none}"
    targets="${targets:-all}"
  fi

  imports="$(normalize_agent_list "${imports:-none}")"
  targets="$(normalize_agent_list "${targets:-none}")"
  info "→ Syncing the shared skill shelf and installing agent hooks… (this can take a moment)"
  ./scripts/seed-shared-skills.sh --import-sources "$imports" --share-targets "$targets"
}

tailnet_peer_collector_urls() {
  local cli
  cli="$(tailscale_cli_candidates | awk '!seen[$0]++ { print; exit }')"
  [[ -n "$cli" ]] || return 0
  run_tailscale_cli "$cli" status --json 2>/dev/null | node -e '
const port = process.argv[2] || "8787";
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  for (const peer of Object.values(data.Peer || {})) {
    if (!peer || peer.Online === false) continue;
    const ip = (peer.TailscaleIPs || []).find((value) => /^\d+\.\d+\.\d+\.\d+$/.test(String(value)));
    if (!ip) continue;
    const name = String(peer.DNSName || peer.HostName || ip).replace(/\.$/, "");
    console.log(`${name}\thttp://${ip}:${port}\t${ip}`);
  }
});
' x "$COLLECTOR_PORT" || true
}

collector_json_field() {
  local url="$1"
  local expr="$2"
  { curl -fsS --max-time 3 "$url/health" 2>/dev/null || true; } | node -e '
const expr = process.argv[1];
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(raw);
    const value = expr.split(".").reduce((acc, key) => acc && acc[key], data);
    if (value !== undefined && value !== null) process.stdout.write(String(value));
  } catch {}
});
' "$expr"
}

env_ready_peer_targets() {
  local name url ip ready user
  while IFS=$'\t' read -r name url ip; do
    [[ -n "$url" ]] || continue
    ready="$(collector_json_field "$url" "envSync.ready")"
    [[ "$ready" == "true" ]] || continue
    user="$(collector_json_field "$url" "envSync.user")"
    [[ -n "$user" ]] || continue
    printf "%s\t%s@%s\t%s\n" "$name" "$user" "$name" "$url"
  done < <(tailnet_peer_collector_urls)
}

configure_env_reconciliation() {
  [[ "$env_tailnet_sync_enabled" == "true" ]] || return 0
  setup_is_interactive || return 0
  command -v hive-env-add >/dev/null 2>&1 || [[ -x "$HOME/.local/bin/hive-env-add" ]] || return 0

  local first_peer=""
  local peer_count=0
  local name target url
  while IFS=$'\t' read -r name target url; do
    [[ -n "$target" ]] || continue
    peer_count=$((peer_count + 1))
    [[ -n "$first_peer" ]] || first_peer="$target"
  done < <(env_ready_peer_targets)

  if (( peer_count == 0 )); then
    warn "No env-ready HivemindOS peers found yet; run hive-env-add --reconcile after another machine finishes setup"
    return 0
  fi

  info "Found $peer_count env-ready HivemindOS peer$( (( peer_count == 1 )) && echo "" || echo "s" )"
  if prompt_yes_no "Pull missing shared env keys from $first_peer now?" "yes"; then
    "$HOME/.local/bin/hive-env-add" --pull-from "$first_peer" || warn "Env pull from $first_peer did not complete"
  fi
  if prompt_yes_no "Push this machine's current shared env keys to ready peers now?" "yes"; then
    "$HOME/.local/bin/hive-env-add" --reconcile || warn "Env reconciliation did not complete"
  fi
}

collector_request() {
  local url="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -fsS --max-time 20 -H "content-type: application/json" -d "$body" "$url$path"
  else
    curl -fsS --max-time 20 "$url$path"
  fi
}

json_get() {
  local expr="$1"
  node -e '
const expr = process.argv[1];
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(raw);
    const value = expr.split(".").reduce((acc, key) => acc && acc[key], data);
    if (value !== undefined && value !== null) process.stdout.write(String(value));
  } catch {}
});
' "$expr"
}

json_escape() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1] || ""))' "$1"
}

verify_syncthing_with_peer() {
  local remote_name="$1"
  local remote_url="$2"
  local remote_ip="$3"
  local local_url="http://127.0.0.1:$COLLECTOR_PORT"
  local local_status remote_status local_device remote_device local_path remote_path id content

  local_status="$(collector_request "$local_url" "/syncthing/status" 2>/dev/null || true)"
  remote_status="$(collector_request "$remote_url" "/syncthing/status" 2>/dev/null || true)"
  local_device="$(printf "%s" "$local_status" | json_get "deviceID")"
  remote_device="$(printf "%s" "$remote_status" | json_get "deviceID")"
  local_path="$(printf "%s" "$local_status" | json_get "defaultSyncPath")"
  remote_path="$(printf "%s" "$remote_status" | json_get "defaultSyncPath")"
  if [[ -z "$local_device" || -z "$remote_device" || -z "$local_path" || -z "$remote_path" ]]; then
    warn "Syncthing is not ready on both collectors; skipping end-to-end sync verification"
    return 1
  fi

  collector_request "$local_url" "/syncthing/configure" "{\"folderId\":\"hivemindos-vault\",\"label\":\"hivemindos-vault\",\"path\":$(json_escape "$local_path"),\"peerDeviceID\":$(json_escape "$remote_device"),\"peerName\":$(json_escape "$remote_name"),\"peerAddresses\":[\"tcp://$remote_ip:22000\",\"dynamic\"]}" >/dev/null || return 1
  collector_request "$remote_url" "/syncthing/configure" "{\"folderId\":\"hivemindos-vault\",\"label\":\"hivemindos-vault\",\"path\":$(json_escape "$remote_path"),\"peerDeviceID\":$(json_escape "$local_device"),\"peerName\":$(json_escape "$(hostname)"),\"peerAddresses\":[\"dynamic\"]}" >/dev/null || return 1

  id="setup-$(date +%s)-$RANDOM"
  content="hivemindos syncthing setup test $id"
  collector_request "$local_url" "/syncthing/test-note" "{\"action\":\"write\",\"root\":$(json_escape "$local_path"),\"id\":$(json_escape "$id"),\"content\":$(json_escape "$content")}" >/dev/null || return 1
  for _ in {1..30}; do
    if [[ "$(collector_request "$remote_url" "/syncthing/test-note" "{\"action\":\"read\",\"root\":$(json_escape "$remote_path"),\"id\":$(json_escape "$id")}" 2>/dev/null | json_get "content")" == "$content" ]]; then
      collector_request "$local_url" "/syncthing/test-note" "{\"action\":\"delete\",\"root\":$(json_escape "$local_path"),\"id\":$(json_escape "$id")}" >/dev/null 2>&1 || true
      collector_request "$remote_url" "/syncthing/test-note" "{\"action\":\"delete\",\"root\":$(json_escape "$remote_path"),\"id\":$(json_escape "$id")}" >/dev/null 2>&1 || true
      ok "Syncthing shared-brain sync verified with $remote_name"
      return 0
    fi
    sleep 2
  done
  warn "Syncthing pairing was configured, but the test note did not appear on $remote_name yet"
  return 1
}

configure_syncthing_verification() {
  [[ "$tailnet_sync_enabled" == "true" ]] || return 0
  setup_is_interactive || return 0
  local name url ip ready count=0
  local peers=()
  while IFS=$'\t' read -r name url ip; do
    [[ -n "$url" ]] || continue
    ready="$(collector_json_field "$url" "capabilities.syncthing")"
    [[ "$ready" == "true" ]] || continue
    count=$((count + 1))
    peers+=("$name"$'\t'"$url"$'\t'"$ip")
  done < <(tailnet_peer_collector_urls)
  (( count > 0 )) || return 0
  if prompt_yes_no "Verify Syncthing shared-brain sync with $count ready peer$( (( count == 1 )) && echo "" || echo "s" ) now?" "yes"; then
    local failures=0
    for peer in "${peers[@]}"; do
      IFS=$'\t' read -r name url ip <<< "$peer"
      verify_syncthing_with_peer "$name" "$url" "$ip" || {
        failures=$((failures + 1))
        warn "Syncthing verification did not complete with $name; the dashboard can retry pairing later"
      }
    done
    (( failures == 0 )) || warn "Syncthing shared-brain sync verified with $(( count - failures )) of $count ready peers"
  fi
}

wait_for_local_collector() {
  local port="$COLLECTOR_PORT"
  if [[ -f "$HOME/.hivemindos/collector.env" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.hivemindos/collector.env" >/dev/null 2>&1 || true
    port="${AGENT_TELEMETRY_PORT:-$port}"
  fi
  local url="http://127.0.0.1:$port/health"
  local body=""
  for _ in {1..15}; do
    body="$(curl -fsS --max-time 2 "$url" 2>/dev/null || true)"
    if [[ -n "$body" ]] && printf "%s" "$body" | node -e '
let d = "";
process.stdin.on("data", c => d += c);
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(d);
    process.exit(j?.version?.appDir || j?.capabilities?.runtimes ? 0 : 1);
  } catch {
    process.exit(1);
  }
});
' >/dev/null 2>&1; then
      COLLECTOR_PORT="$port"
      return 0
    fi
    sleep 1
  done
  return 1
}

install_node_if_missing || true

load_homebrew_shellenv || true
install_pnpm_if_missing || true

if command -v corepack >/dev/null 2>&1; then
  corepack prepare pnpm@8.6.12 --activate >/dev/null 2>&1 || true
  refresh_tool_paths
fi

tailscale_ip=""
tailnet_sync_enabled="false"
env_tailnet_sync_enabled="false"
hivemind_link_enabled="false"
network_mode="${CLI_NETWORK_MODE:-${HIVE_NETWORK_MODE:-link}}"
case "$network_mode" in
  link)
    hivemind_link_enabled="true"
    ok "Network mode: Hivemind Link"
    ok "Remote Fleet/chat will use an app-managed Tailscale node."
    maintain_system_tailscale_ssh || true
    ;;
  system-tailscale)
    if ensure_tailscale_connected; then
      ok "Network mode: system Tailscale"
      tailscale_ip="$(tailscale_ip4 || true)"
      tailnet_sync_enabled="true"
      prefer_homebrew_tailscaled_for_macos_fleet
      tailscale_ip="$(tailscale_ip4 || true)"
      if enable_tailscale_ssh; then
        env_tailnet_sync_enabled="true"
      fi
    else
      warn "Tailscale setup was not completed"
    warn "Hivemind Sync is disabled for this run. Local-only dashboard, agents, and local vault features will still work."
    fi
    ;;
  local)
    ok "Network mode: local only"
    warn "Skipping all multi-machine networking."
    ;;
  *)
    fail "Unknown HIVE_NETWORK_MODE: $network_mode"
    echo "Use one of: link, system-tailscale, local"
    exit 2
    ;;
esac

if [[ "$tailnet_sync_enabled" == "true" ]]; then
  install_rsync_if_missing
  install_syncthing_if_missing
  start_syncthing_if_available
elif [[ "$network_mode" == "system-tailscale" ]]; then
  warn "Skipping Tailnet rsync/Syncthing setup because Tailscale is not connected"
fi

install_obsidian_if_missing
install_gpg_if_missing
install_unison_if_missing

if (( ${#missing[@]} > 0 )); then
  echo
  if (( ${#missing[@]} == 1 )); then
    warn "Setup needs one required dependency first:"
  else
    warn "Setup needs a couple things first:"
  fi
  for item in "${missing[@]}"; do
    echo "  - $item"
  done
  if printf "%s\n" "${missing[@]}" | grep -q "pnpm"; then
    echo
    echo "Install pnpm with one of:"
    if [[ "$(uname -s)" == "Darwin" ]]; then
      echo "  npm install -g pnpm"
      echo "  brew install pnpm"
    else
      echo "  npm install -g pnpm"
    fi
  fi
  echo
  if (( ${#missing[@]} == 1 )); then
    echo "After fixing that, rerun:"
  else
    echo "After fixing those, rerun:"
  fi
  echo "  ./setup.sh"
  exit 1
fi

secure_env_local() {
  local env_file="$ROOT/.env.local"
  [[ -f "$env_file" ]] || return 0
  chmod 600 "$env_file" 2>/dev/null || true
}

set_env_local() {
  local key="$1"
  local value="$2"
  local env_file="$ROOT/.env.local"
  [[ -f "$env_file" ]] || touch "$env_file"
  secure_env_local
  if awk -v key="$key" -v value="$value" -F= '$1 == key && substr($0, length(key) + 2) == value { found=1 } END { exit found ? 0 : 1 }' "$env_file"; then
    secure_env_local
    return 0
  fi
  if grep -q "^${key}=" "$env_file"; then
    local tmp_file
    tmp_file="$(mktemp)"
    awk -v key="$key" -v value="$value" 'BEGIN { replaced=0 } $0 ~ "^" key "=" { print key "=" value; replaced=1; next } { print } END { if (!replaced) print key "=" value }' "$env_file" > "$tmp_file"
    mv "$tmp_file" "$env_file"
  else
    printf "%s=%s\n" "$key" "$value" >> "$env_file"
  fi
  secure_env_local
}

save_shared_hive_env_entries() {
  local input="$1"
  local hive_env_add="$ROOT/scripts/hive-env-add"
  if [[ ! -x "$hive_env_add" ]]; then
    warn "hive-env-add is unavailable; shared hive env keys were not refreshed"
    return 0
  fi
  if printf "%s" "$input" | "$hive_env_add" --import-stdin --scope agent --runtime generic >/dev/null 2>&1; then
    ok "Saved dashboard auth keys to shared hive env"
  else
    warn "Could not save dashboard auth keys to shared hive env; dashboard unlock still works from .env.local"
  fi
}

env_local_value() {
  local key="$1"
  local env_file="$ROOT/.env.local"
  [[ -f "$env_file" ]] || return 0
  awk -v key="$key" -F= '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$env_file"
}

random_dashboard_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi
  node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
}

ensure_gitlawb_code_proof() {
  set_env_local "NEXT_PUBLIC_GITLAWB_PROOF_READY" "true"
  set_env_local "NEXT_PUBLIC_GITLAWB_NODE_URL" "${NEXT_PUBLIC_GITLAWB_NODE_URL:-http://127.0.0.1:7545}"

  mkdir -p "$HOME/.hivemindos/gitlawb"
  if command -v gl >/dev/null 2>&1 && command -v git-remote-gitlawb >/dev/null 2>&1; then
    ok "GitLawb CLI found: $(command -v gl)"
  else
    # GitLawb's model signs work at push time on the machine doing the work, so
    # every machine (including non-interactive collector-only installs) gets the
    # CLI by default. Opt out with HIVE_GITLAWB_SETUP=false.
    local should_install="true"
    if [[ "${HIVE_GITLAWB_SETUP:-}" =~ ^(0|false|no|off)$ ]]; then
      should_install="false"
    elif setup_is_interactive && [[ -z "${HIVE_GITLAWB_SETUP:-}" ]] && ! prompt_yes_no "Install GitLawb CLI for Code Proof now?" "yes"; then
      should_install="false"
    fi

    if [[ "$should_install" == "true" ]]; then
      if command -v curl >/dev/null 2>&1; then
        local installer install_dir
        installer="$(mktemp)"
        install_dir="${GITLAWB_INSTALL_DIR:-$HOME/.local/bin}"
        mkdir -p "$install_dir"
        if curl -fsSL https://gitlawb.com/install.sh -o "$installer" && GITLAWB_INSTALL_DIR="$install_dir" sh "$installer"; then
          printf '{\n  "installDir": "%s",\n  "binaries": ["gl", "git-remote-gitlawb", "gitlawb-node"],\n  "installedAt": "%s"\n}\n' "$install_dir" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$HOME/.hivemindos/gitlawb/installed-by-hivemindos.json"
          ok "GitLawb CLI installed in $install_dir"
          refresh_tool_paths
          export PATH="$install_dir:$PATH"
        else
          warn "GitLawb CLI install failed; HivemindOS setup will continue without Code Proof CLI."
        fi
        rm -f "$installer"
      else
        warn "curl is unavailable; skipped GitLawb CLI install."
      fi
    else
      warn "Skipping GitLawb CLI install; Code Proof can be enabled later from Integrations."
    fi
  fi

  if command -v gl >/dev/null 2>&1; then
    if gl identity show >/dev/null 2>&1; then
      ok "GitLawb DID found"
    else
      # Each machine gets its own DID by default (GitLawb's per-actor identity
      # model); opt out with HIVE_GITLAWB_IDENTITY=false.
      local should_create_identity="true"
      if [[ "${HIVE_GITLAWB_IDENTITY:-}" =~ ^(0|false|no|off)$ ]]; then
        should_create_identity="false"
      elif setup_is_interactive && [[ -z "${HIVE_GITLAWB_IDENTITY:-}" ]] && ! prompt_yes_no "Create this machine's GitLawb DID now?" "yes"; then
        should_create_identity="false"
      fi
      if [[ "$should_create_identity" == "true" ]]; then
        if gl identity new >/dev/null 2>&1; then
          ok "GitLawb DID created locally"
        else
          warn "Could not create GitLawb DID; Code Proof identity can be created later from Integrations."
        fi
      else
        warn "No GitLawb DID created; Code Proof identity can be created later from Integrations."
      fi
    fi

    # Per the GitLawb quickstart, work is pushed to a network node and the DID is
    # registered there (signed ref certificates carry the proof). Default to the
    # public node; override with GITLAWB_NODE, opt out with HIVE_GITLAWB_REGISTER=false.
    if gl identity show >/dev/null 2>&1; then
      local gitlawb_node="${GITLAWB_NODE:-https://node.gitlawb.com}"
      set_env_local "GITLAWB_NODE" "$gitlawb_node"
      printf "%s\n" "$gitlawb_node" > "$HOME/.hivemindos/gitlawb/node-url"
      local should_register="true"
      if setup_is_interactive && [[ -z "${HIVE_GITLAWB_REGISTER:-}" ]]; then
        info "GitLawb (\"Code Proof\") gives this machine a verifiable identity (a DID) so the work"
        info "your agents push can carry a tamper-proof signature of where it came from."
        info "Registering publishes only this machine's PUBLIC id to ${gitlawb_node}; no private"
        info "keys leave this computer. Optional - skip it and set it up later from Integrations."
      fi
      if [[ "${HIVE_GITLAWB_REGISTER:-}" =~ ^(0|false|no|off)$ ]]; then
        should_register="false"
      elif setup_is_interactive && [[ -z "${HIVE_GITLAWB_REGISTER:-}" ]] && ! prompt_yes_no "Register this machine's GitLawb DID with $gitlawb_node?" "yes"; then
        should_register="false"
      fi
      if [[ "$should_register" == "true" ]]; then
        info "→ Registering with the GitLawb network (${gitlawb_node})… (this can take a moment)"
        if GITLAWB_NODE="$gitlawb_node" gl register >/dev/null 2>&1; then
          ok "GitLawb DID registered with $gitlawb_node"
        else
          warn "GitLawb DID registration did not complete; run 'GITLAWB_NODE=$gitlawb_node gl register' later."
        fi
      else
        warn "Skipping GitLawb DID registration; run 'GITLAWB_NODE=$gitlawb_node gl register' to join the network later."
      fi
    fi
  fi

  printf '{\n  "checkedAt": "%s",\n  "proofReadyDefault": true,\n  "nodeStartedBySetup": false\n}\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$HOME/.hivemindos/gitlawb/setup-status.json"
}

set_env_local "NEXT_PUBLIC_TAILNET_SYNC_ENABLED" "$tailnet_sync_enabled"
set_env_local "HIVE_ENV_TAILNET_SYNC" "$env_tailnet_sync_enabled"
set_env_local "HIVE_ENV_TAILNET_USER" "$(id -un 2>/dev/null || printf "%s" "${USER:-}")"
set_env_local "HONEY_LEDGER_REMOTE_URL" "${HONEY_LEDGER_REMOTE_URL:-https://hivemindos-honey-ledger.hivemindos.workers.dev}"
set_env_local "HONEY_LEDGER_ISSUER_ID" "${HONEY_LEDGER_ISSUER_ID:-hivemindos}"
set_env_local "HONEY_COMPUTE_GATEWAY_URL" "${HONEY_COMPUTE_GATEWAY_URL:-https://hivemindos-compute-gateway.hivemindos.workers.dev}"
set_env_local "HIVE_TOKEN_ADDRESS" "${HIVE_TOKEN_ADDRESS:-}"
set_env_local "BANKR_LLM_KEY" "${BANKR_LLM_KEY:-}"
set_env_local "NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER" "${NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER:-Operations/Work Board}"
set_env_local "NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER" "${NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER:-Operations/Agent Notifications}"
set_env_local "NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER" "${NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER:-Operations/Automations}"
set_env_local "NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER" "${NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER:-Synthesis}"
set_env_local "NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER" "${NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER:-Operations/Brain Services}"
set_env_local "HIVE_NOTE_SECURE_FOLDER" "${HIVE_NOTE_SECURE_FOLDER:-Operations/Secure}"
set_env_local "NEXT_PUBLIC_GBRAIN_CLI_PATH" "${NEXT_PUBLIC_GBRAIN_CLI_PATH:-gbrain}"
set_env_local "NEXT_PUBLIC_GBRAIN_SKILLPACK_LOCATION" "${NEXT_PUBLIC_GBRAIN_SKILLPACK_LOCATION:-Skills/GBrain}"
set_env_local "NEXT_PUBLIC_SYNTO_CLI_PATH" "${NEXT_PUBLIC_SYNTO_CLI_PATH:-synto}"
set_env_local "NEXT_PUBLIC_SYNTO_COMPARE_HEAVY_MODEL" "${NEXT_PUBLIC_SYNTO_COMPARE_HEAVY_MODEL:-llama3.1:8b}"
ensure_gitlawb_code_proof

dashboard_auth_secret="${HIVEMINDOS_DASHBOARD_AUTH_SECRET:-$(env_local_value HIVEMINDOS_DASHBOARD_AUTH_SECRET)}"
dashboard_device_token="${HIVEMINDOS_DASHBOARD_DEVICE_TOKEN:-$(env_local_value HIVEMINDOS_DASHBOARD_DEVICE_TOKEN)}"
dashboard_auth_secret="${dashboard_auth_secret:-$(random_dashboard_secret)}"
dashboard_device_token="${dashboard_device_token:-$(random_dashboard_secret)}"
set_env_local "HIVEMINDOS_DASHBOARD_AUTH_SECRET" "$dashboard_auth_secret"
set_env_local "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN" "$dashboard_device_token"
save_shared_hive_env_entries "HIVEMINDOS_DASHBOARD_AUTH_SECRET=$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$dashboard_auth_secret")
HIVEMINDOS_DASHBOARD_DEVICE_TOKEN=$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$dashboard_device_token")
"

shared_vault_path="${NEXT_PUBLIC_OBSIDIAN_VAULT_PATH:-$HOME/Documents/Obsidian/hivemindos-vault}"
if [[ "$shared_vault_path" == "~/"* ]]; then
  shared_vault_path="$HOME/${shared_vault_path#~/}"
fi
scheduled_folder="${NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER:-Operations/Automations}"
kanban_folder="${NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER:-Operations/Work Board}"
notifications_folder="${NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER:-Operations/Agent Notifications}"
synthesis_folder="${NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER:-Synthesis}"
brain_services_folder="${NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER:-Operations/Brain Services}"

mkdir -p \
  "$shared_vault_path/Intake" \
  "$shared_vault_path/Intake/Requests" \
  "$shared_vault_path/Intake/Sources" \
  "$shared_vault_path/.hivemindos-transfers" \
  "$shared_vault_path/Memory" \
  "$shared_vault_path/Memory/Book Notes" \
  "$shared_vault_path/Memory/Daily Briefings" \
  "$shared_vault_path/Memory/Decision Journal" \
  "$shared_vault_path/Memory/Meetings" \
  "$shared_vault_path/Memory/Weekly Reviews" \
  "$shared_vault_path/Memory/Imported Sources" \
  "$shared_vault_path/Memory/Distillations" \
  "$shared_vault_path/Memory/Distillations/Agent Memory" \
  "$shared_vault_path/Projects" \
  "$shared_vault_path/Operations" \
  "$shared_vault_path/Operations/Code Projects" \
  "$shared_vault_path/Operations/Runtime Mirrors" \
  "$shared_vault_path/Operations/Secure" \
  "$shared_vault_path/Agents" \
  "$shared_vault_path/Skills" \
  "$shared_vault_path/Templates/HivemindOS" \
  "$shared_vault_path/$synthesis_folder/raw" \
  "$shared_vault_path/$synthesis_folder/wiki/.drafts" \
  "$shared_vault_path/$synthesis_folder/wiki/sources" \
  "$shared_vault_path/$synthesis_folder/wiki/queries" \
  "$shared_vault_path/$synthesis_folder/wiki/synthesis" \
  "$shared_vault_path/$synthesis_folder/pack" \
  "$shared_vault_path/Archive" \
  "$shared_vault_path/Archive/Processed Requests" \
  "$shared_vault_path/$scheduled_folder" \
  "$shared_vault_path/$kanban_folder" \
  "$shared_vault_path/$notifications_folder" \
  "$shared_vault_path/$brain_services_folder" \
  "$shared_vault_path/$brain_services_folder/Queen Bee" \
  "$shared_vault_path/$brain_services_folder/Queen Bee/nodes" \
  "$shared_vault_path/$brain_services_folder/Queen Bee/inbox" \
  "$shared_vault_path/$brain_services_folder/Queen Bee/outbox" \
  "$shared_vault_path/Operations/Brain Services/Queen Bee"

if [[ ! -f "$shared_vault_path/Shared Context.md" ]]; then
  printf "# Shared Context\n\nCurrent cross-agent context for the HivemindOS vault.\n" > "$shared_vault_path/Shared Context.md"
fi

if [[ ! -f "$shared_vault_path/$scheduled_folder/README.md" ]]; then
  cat > "$shared_vault_path/$scheduled_folder/README.md" <<EOF
# Automations

Shared schedule definitions and run history for HivemindOS agents.

- \`<device>/<schedule>/schedule.md\` stores each schedule snapshot.
- \`run0001-<agent>-<timestamp>.md\` files store execution history.
- Schedules can opt into injecting past run notes for continuity, anti-repetition, and comparisons.
EOF
fi

if [[ ! -f "$shared_vault_path/$synthesis_folder/README.md" ]]; then
  cat > "$shared_vault_path/$synthesis_folder/README.md" <<'EOF'
# Synthesis

Syntho-powered reviewed knowledge layer for raw inputs, drafts, wiki articles, source trails, queries, synthesis notes, and agent packs.
EOF
fi

if [[ ! -f "$shared_vault_path/$brain_services_folder/README.md" ]]; then
  cat > "$shared_vault_path/$brain_services_folder/README.md" <<'EOF'
# Brain Services

Status notes for optional HivemindOS brain services. GBrain and Syntho can be connected from the dashboard without storing provider secrets in the vault.
EOF
fi

set_env_local "NEXT_PUBLIC_HIVE_GBRAIN_SURFACE_ENABLED" "true"
if [[ ! -f "$shared_vault_path/$brain_services_folder/GBrain.md" ]]; then
  cat > "$shared_vault_path/$brain_services_folder/GBrain.md" <<'EOF'
---
type: brain-service
service: gbrain
enabled: false
installMode: optional
searchMode: balanced
providerPolicy: balanced-cloud
mcpMode: stdio
---

# GBrain

Optional HivemindOS retrieval, graph, MCP, and dream-cycle service. Install or connect it from the dashboard when ready.

No provider secrets are stored in this note.
EOF
fi

if [[ ! -f "$shared_vault_path/$brain_services_folder/Syntho.md" ]]; then
  cat > "$shared_vault_path/$brain_services_folder/Syntho.md" <<'EOF'
---
type: brain-service
service: synto
enabled: false
installMode: optional
mcpMode: stdio
sourceAccessMode: deny
compareHeavyModel: llama3.1:8b
autoApprove: false
minConfidence: 0.8
---

# Syntho

Optional HivemindOS compiled-wiki, pack, and MCP service for the Synthesis layer. Install or connect it from the dashboard when ready. Raw-source MCP tools default to denied until source licenses are configured.

No provider secrets are stored in this note.
EOF
fi

info "→ Seeding the shared brain vault (notes, skills, context)… (this can take a moment)"
node "$ROOT/scripts/seed-vault-foundation.mjs" \
  --vault "$shared_vault_path" \
  --scheduled-folder "$scheduled_folder" \
  --synthesis-folder "$synthesis_folder" \
  --brain-services-folder "$brain_services_folder" \
  --kanban-folder "$kanban_folder" \
  --notifications-folder "$notifications_folder" >/dev/null

ensure_hive_pulse_python
install_hive_env_add

configure_shared_skills

setup_cache_dir="$ROOT/.setup-cache"
mkdir -p "$setup_cache_dir"

hash_files() {
  if command -v shasum >/dev/null 2>&1; then
    shasum "$@" | shasum | awk '{print $1}'
  else
    sha256sum "$@" | sha256sum | awk '{print $1}'
  fi
}

deps_stamp="$setup_cache_dir/deps.sha"
deps_hash="$(hash_files package.json pnpm-lock.yaml)"
if [[ "$CLI_COLLECTOR_ONLY" == "true" ]]; then
  info "Installing collector dependency only (no workspace install)"
  ./scripts/ensure-collector-deps.sh
  ok "Collector dependency ready"
elif [[ "$CLI_SKIP_DEPS" == "true" ]]; then
  warn "Skipping dependency install because --skip-deps was provided"
elif [[ "$CLI_FORCE" != "true" && -d "$ROOT/node_modules" && -f "$deps_stamp" && "$(cat "$deps_stamp" 2>/dev/null)" == "$deps_hash" ]]; then
  ok "Dependencies already installed"
else
  info "Installing app dependencies"
  NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--no-deprecation" pnpm_run install --frozen-lockfile
  printf "%s\n" "$deps_hash" > "$deps_stamp"
  ok "Dependencies installed"
fi

if [[ "$CLI_SKIP_COLLECTOR" == "true" ]]; then
  warn "Skipping local telemetry collector because --skip-collector was provided"
else
  info "Installing local telemetry collector"
  hermes_restart_mode="now"
  if setup_is_interactive; then
    hermes_restart_mode="ask"
  fi
  info "→ Building and installing the collector and Hivemind Link… (this can take a minute)"
  HIVE_SETUP_NETWORK_MANAGED="true" HIVE_SETUP_TAILNET_SYNC_ENABLED="$tailnet_sync_enabled" HIVE_LINK_ENABLED="$hivemind_link_enabled" AGENT_TELEMETRY_PORT="$COLLECTOR_PORT" AGENT_TELEMETRY_HERMES_RESTART="${AGENT_TELEMETRY_HERMES_RESTART:-$hermes_restart_mode}" ./scripts/install-telemetry-collector.sh
  # Install + supervise the Claw backend so the Claw Code Mobile app works on a
  # machine that only ran HivemindOS setup (its coding agent runs here, reached
  # by the app over the tailnet). Non-fatal: a failure just leaves the app's
  # remote-agent features unavailable until it's retried.
  ./scripts/install-claw-backend.sh || warn "Claw backend install failed — the Claw Code Mobile app's remote-agent features will be unavailable until it succeeds"
  if [[ -f "$HOME/.hivemindos/collector.env" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.hivemindos/collector.env" >/dev/null 2>&1 || true
    if [[ -n "${AGENT_TELEMETRY_PORT:-}" ]]; then
      set_env_local "AGENT_TELEMETRY_PORT" "$AGENT_TELEMETRY_PORT"
    fi
    if [[ -n "${HIVE_LINK_CONTROL_URL:-}" ]]; then
      set_env_local "HIVE_LINK_CONTROL_URL" "$HIVE_LINK_CONTROL_URL"
    fi
  fi
  if wait_for_local_collector; then
    ok "Collector installed and healthy locally"
    configure_env_reconciliation
    configure_syncthing_verification
  else
    warn "Collector service was installed, but local health is not responding yet"
    warn "Local collector did not respond yet; skipping setup-time env and Syncthing reconciliation prompts"
  fi
fi

build_stamp="$setup_cache_dir/build.sha"
build_hash="$(hash_files package.json pnpm-lock.yaml next.config.ts tsconfig.json)"
if [[ "$CLI_BUILD_DASHBOARD" != "true" ]]; then
  ok "Skipping production dashboard build; dev server will compile on demand"
elif [[ "$CLI_FORCE" != "true" && -d "$ROOT/.next" && -f "$build_stamp" && "$(cat "$build_stamp" 2>/dev/null)" == "$build_hash" ]]; then
  ok "Dashboard build already current"
else
  info "Building dashboard"
  pnpm_run build
  printf "%s\n" "$build_hash" > "$build_stamp"
  ok "Dashboard built"
fi

dashboard_host="${HIVEMINDOS_DASHBOARD_HOST:-127.0.0.1}"
if [[ "$network_mode" == "system-tailscale" && -n "$tailscale_ip" ]]; then
  dashboard_host="${HIVEMINDOS_DASHBOARD_HOST:-0.0.0.0}"
fi

start_dashboard() {
  info "Starting dashboard dev server on port $PORT"
  mkdir -p "$ROOT/.next"
  refresh_tool_paths
  if command -v pnpm >/dev/null 2>&1; then
    nohup ./scripts/run-with-memory-limit.sh --limit-mb 5000 -- pnpm exec next dev --webpack -p "$PORT" -H "$dashboard_host" > "$ROOT/.next/hivemindos.log" 2>&1 &
  else
    nohup ./scripts/run-with-memory-limit.sh --limit-mb 5000 -- corepack pnpm exec next dev --webpack -p "$PORT" -H "$dashboard_host" > "$ROOT/.next/hivemindos.log" 2>&1 &
  fi
  sleep 2
}

open_dashboard_if_requested() {
  local url="$1"
  setup_is_interactive || return 0
  if ! prompt_yes_no "Open the HivemindOS dashboard now?" "yes"; then
    return 0
  fi
  if [[ "$(uname -s)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
    open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser "$url" >/dev/null 2>&1 &
  else
    warn "Could not find a browser opener. Open this URL manually: $url"
    return 0
  fi
  ok "Opened dashboard: $url"
}

copy_dashboard_token_if_requested() {
  local env_file="$ROOT/.env.local"
  local token=""
  [[ -f "$env_file" ]] || return 0
  token="$(awk -F= '$1 == "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN" { sub(/^[^=]*=/, ""); print; exit }' "$env_file")"
  [[ -n "$token" ]] || return 0

  if [[ "$(uname -s)" == "Darwin" && -n "$(command -v pbcopy 2>/dev/null || true)" ]]; then
    if setup_is_interactive && prompt_yes_no "Copy the dashboard unlock token to your clipboard now?" "yes"; then
      printf "%s" "$token" | pbcopy
      ok "Copied dashboard unlock token to clipboard"
    fi
    return 0
  fi

  if [[ -n "$(command -v wl-copy 2>/dev/null || true)" ]]; then
    if setup_is_interactive && prompt_yes_no "Copy the dashboard unlock token to your clipboard now?" "yes"; then
      printf "%s" "$token" | wl-copy
      ok "Copied dashboard unlock token to clipboard"
    fi
    return 0
  fi

  if [[ -n "$(command -v xclip 2>/dev/null || true)" ]]; then
    if setup_is_interactive && prompt_yes_no "Copy the dashboard unlock token to your clipboard now?" "yes"; then
      printf "%s" "$token" | xclip -selection clipboard
      ok "Copied dashboard unlock token to clipboard"
    fi
    return 0
  fi

  if [[ -n "$(command -v xsel 2>/dev/null || true)" ]]; then
    if setup_is_interactive && prompt_yes_no "Copy the dashboard unlock token to your clipboard now?" "yes"; then
      printf "%s" "$token" | xsel --clipboard --input
      ok "Copied dashboard unlock token to clipboard"
    fi
    return 0
  fi

  warn "No clipboard command found; use the copy command printed below."
}

dashboard_openable="false"
if [[ "$CLI_SKIP_DASHBOARD" == "true" ]]; then
  warn "Skipping dashboard start because --skip-dashboard was provided"
else
  port_pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
  if [[ -n "$port_pid" ]]; then
    port_cmd="$(ps -p "$port_pid" -o command= 2>/dev/null || true)"
    port_cwd="$(lsof -a -p "$port_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true)"
    if [[ "$port_cwd" == "$ROOT" && "$port_cmd" == *"next"* ]]; then
      info "Restarting existing dashboard on port $PORT"
      kill "$port_pid"
      sleep 2
      start_dashboard
      dashboard_openable="true"
    else
      warn "Port $PORT is already in use by another process; leaving it alone"
      warn "Use PORT=<free-port> ./setup.sh or stop PID $port_pid first"
    fi
  else
    start_dashboard
    dashboard_openable="true"
  fi
fi

local_url="http://localhost:$PORT"
network_url=""
collector_url=""
link_control_url="${HIVE_LINK_CONTROL_URL:-}"

if [[ -f "$HOME/.hivemindos/collector.env" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.hivemindos/collector.env" >/dev/null 2>&1 || true
  link_control_url="${HIVE_LINK_CONTROL_URL:-$link_control_url}"
fi

if [[ -n "$tailscale_ip" && "$dashboard_host" != "127.0.0.1" && "$dashboard_host" != "localhost" ]]; then
  network_url="http://$tailscale_ip:$PORT"
  collector_url="http://$tailscale_ip:$COLLECTOR_PORT"
fi

echo
ok "Ready"
echo
echo "Dashboard:"
echo "  $local_url"
if [[ -n "$network_url" ]]; then
  echo "  $network_url"
fi
echo "  Unlock token: stored in .env.local and shared hive env as HIVEMINDOS_DASHBOARD_DEVICE_TOKEN"
echo "  Copy token later: pnpm dashboard-auth copy-token"
echo "  Reset lost token: pnpm dashboard-auth reset-token"
copy_dashboard_token_if_requested
echo
echo "Collector:"
if [[ -n "$collector_url" ]]; then
  echo "  $collector_url"
elif [[ "$hivemind_link_enabled" == "true" ]]; then
  echo "  Hivemind Link: ${link_control_url:-http://127.0.0.1:8788}/status"
else
  echo "  http://localhost:$COLLECTOR_PORT"
fi
echo
echo "Code Proof:"
if command -v gl >/dev/null 2>&1; then
  echo "  GitLawb CLI: $(command -v gl)"
else
  echo "  GitLawb CLI: not installed"
fi
echo "  GitLawb node: lazy; not started by setup"
echo
if [[ "$hivemind_link_enabled" == "true" ]]; then
  echo "On other machines that run agents, clone the repo and run:"
  echo "  HIVE_LINK_ENABLED=true ./scripts/install-telemetry-collector.sh"
  echo
  echo "Each machine links to your own Tailscale account through the embedded Hivemind Link node. The dashboard discovers Link peers through the local sidecar."
elif [[ "$tailnet_sync_enabled" == "true" ]]; then
  echo "On other Tailscale machines that run agents, clone the repo and run only:"
  echo "  ./scripts/install-telemetry-collector.sh"
  echo
  echo "The dashboard will discover collectors automatically. Hivemind Sync can move shared brain files with Syncthing, env through collector endpoints, and handoff transfers through the vault."
else
  echo "Local-only mode is ready because Tailscale setup was not completed during this run."
  echo "Hivemind Sync requires completing the guided Tailscale or Hivemind Link step."
fi
echo
if [[ "$dashboard_openable" == "true" ]]; then
  open_dashboard_if_requested "$local_url"
fi
