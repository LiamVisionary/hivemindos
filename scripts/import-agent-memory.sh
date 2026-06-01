#!/usr/bin/env bash
set -euo pipefail

sources="none"

while (( $# > 0 )); do
  case "$1" in
    --sources)
      sources="${2:-none}"
      shift 2
      ;;
    --help)
      cat <<'EOF'
Usage: import-agent-memory.sh --sources codex,claude,hermes,gemini,openclaw,aeon

Copies conservative, text-based memory/context files from local agent homes into
the shared HivemindOS vault for review. Existing imports are preserved.
EOF
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

vault_path="${NEXT_PUBLIC_OBSIDIAN_VAULT_PATH:-$HOME/Documents/Obsidian/hivemindos-vault}"
if [[ "$vault_path" == "~/"* ]]; then
  vault_path="$HOME/${vault_path#~/}"
fi

target_root="$vault_path/Memory/Imported Agent Memory"
mkdir -p "$target_root"

agent_home() {
  case "$1" in
    codex) printf "%s\n" "$HOME/.codex" ;;
    claude) printf "%s\n" "$HOME/.claude" ;;
    hermes) printf "%s\n" "$HOME/.hermes" ;;
    gemini) printf "%s\n" "$HOME/.gemini" ;;
    openclaw) printf "%s\n" "$HOME/.openclaw" ;;
    aeon) printf "%s\n" "$HOME/.aeon" ;;
  esac
}

safe_copy_name() {
  printf "%s" "$1" | sed -E 's#[~/ ]+#-#g; s#[^A-Za-z0-9._-]+#-#g; s#^-+|-+$##g'
}

IFS=',' read -r -a agents <<< "$sources"
for agent in "${agents[@]}"; do
  agent="$(printf "%s" "$agent" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  [[ -n "$agent" && "$agent" != "none" ]] || continue
  home_dir="$(agent_home "$agent" || true)"
  [[ -d "$home_dir" ]] || continue
  destination="$target_root/$agent"
  mkdir -p "$destination"
  imported=0
  while IFS= read -r file; do
    [[ -f "$file" ]] || continue
    name="$(safe_copy_name "${file#$home_dir/}")"
    [[ -n "$name" ]] || name="$(basename "$file")"
    if [[ ! -f "$destination/$name" ]]; then
      cp "$file" "$destination/$name"
      imported=$((imported + 1))
    fi
  done < <(find "$home_dir" -maxdepth 4 -type f \( \
    -iname '*memory*.md' -o -iname '*memory*.json' -o -iname 'AGENTS.md' -o -iname 'CLAUDE.md' -o -iname 'GEMINI.md' -o -iname 'SOUL.md' \
  \) 2>/dev/null)
  printf "Imported %s %s memory/context file(s) into %s\n" "$imported" "$agent" "$destination"
done
