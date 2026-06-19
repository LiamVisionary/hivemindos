#!/usr/bin/env bash
set -euo pipefail

limit_mb="${MEMORY_LIMIT_MB:-5000}"
timeout_seconds="${MEMORY_TIMEOUT_SECONDS:-0}"

usage() {
  cat <<'EOF'
Usage: run-with-memory-limit.sh [--limit-mb MB] [--timeout-seconds SEC] -- command [args...]

Runs a command and kills its process tree if total resident memory exceeds the
limit. The default limit is 5000 MB. A timeout of 0 disables the wall-clock cap.
EOF
}

while (( $# > 0 )); do
  case "$1" in
    --limit-mb)
      limit_mb="${2:-}"
      shift 2
      ;;
    --timeout-seconds)
      timeout_seconds="${2:-}"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

if (( $# == 0 )); then
  usage >&2
  exit 2
fi

if ! [[ "$limit_mb" =~ ^[0-9]+$ ]] || (( limit_mb <= 0 )); then
  echo "Invalid --limit-mb value: $limit_mb" >&2
  exit 2
fi

if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]]; then
  echo "Invalid --timeout-seconds value: $timeout_seconds" >&2
  exit 2
fi

limit_kb=$((limit_mb * 1024))
memory_monitor_available=1

if ! ps -axo pid=,ppid= >/dev/null 2>&1; then
  memory_monitor_available=0
  echo "Memory monitor unavailable: ps is blocked in this shell; continuing with timeout guard only." >&2
fi

child_pids() {
  local parent="$1"
  ps -axo pid=,ppid= | awk -v p="$parent" '$2 == p { print $1 }'
}

process_tree() {
  local root="$1"
  local queue=("$root")
  local pid child
  for ((i = 0; i < ${#queue[@]}; i++)); do
    pid="${queue[$i]}"
    printf "%s\n" "$pid"
    while IFS= read -r child; do
      [[ -n "$child" ]] && queue+=("$child")
    done < <(child_pids "$pid")
  done
}

tree_rss_kb() {
  local root="$1"
  local total=0
  local pid rss
  while IFS= read -r pid; do
    rss="$(ps -o rss= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)"
    [[ "$rss" =~ ^[0-9]+$ ]] || rss=0
    total=$((total + rss))
  done < <(process_tree "$root")
  printf "%s\n" "$total"
}

kill_tree() {
  local root="$1"
  local pids
  if (( memory_monitor_available == 0 )); then
    kill "$root" >/dev/null 2>&1 || true
    sleep 2
    kill -9 "$root" >/dev/null 2>&1 || true
    return 0
  fi
  pids="$(process_tree "$root" | sort -rn | tr '\n' ' ')"
  [[ -n "$pids" ]] || return 0
  kill $pids >/dev/null 2>&1 || true
  sleep 2
  kill -9 $pids >/dev/null 2>&1 || true
}

"$@" &
root_pid="$!"
started_at="$(date +%s)"

while kill -0 "$root_pid" >/dev/null 2>&1; do
  if (( memory_monitor_available == 1 )); then
    rss_kb="$(tree_rss_kb "$root_pid")"
    if (( rss_kb > limit_kb )); then
      printf "Memory limit exceeded: %d MB > %d MB. Killing process tree rooted at %s.\n" "$((rss_kb / 1024))" "$limit_mb" "$root_pid" >&2
      kill_tree "$root_pid"
      wait "$root_pid" >/dev/null 2>&1 || true
      exit 137
    fi
  fi

  if (( timeout_seconds > 0 )); then
    now="$(date +%s)"
    if (( now - started_at >= timeout_seconds )); then
      printf "Timeout exceeded: %d seconds. Killing process tree rooted at %s.\n" "$timeout_seconds" "$root_pid" >&2
      kill_tree "$root_pid"
      wait "$root_pid" >/dev/null 2>&1 || true
      exit 124
    fi
  fi

  sleep 1
done

wait "$root_pid"
