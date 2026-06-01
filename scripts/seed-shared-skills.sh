#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ok() { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$*"; }

normalize_list() {
  printf "%s" "$1" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]'
}

import_sources="none"
share_targets="all"

while (( $# > 0 )); do
  case "$1" in
    --import-sources)
      import_sources="$(normalize_list "${2:-}")"
      shift 2
      ;;
    --share-targets)
      share_targets="$(normalize_list "${2:-}")"
      shift 2
      ;;
    --help)
      cat <<'EOF'
Usage: seed-shared-skills.sh [--import-sources all|none|codex,claude,hermes,gemini,openclaw,aeon] [--share-targets all|none|codex,claude,hermes,gemini,openclaw,aeon]

Seeds bundled shared skills into the shared notes Skills shelf, optionally imports
existing runtime skills into that shelf, then mirrors the shared baseline skill
and managed skill-shelf instructions into selected runtime homes.
EOF
      exit 0
      ;;
    *)
      warn "Ignoring unknown option: $1"
      shift
      ;;
  esac
done

vault_path="${NEXT_PUBLIC_OBSIDIAN_VAULT_PATH:-$HOME/Documents/Obsidian/hivemindos-vault}"
if [[ "$vault_path" == "~/"* ]]; then
  vault_path="$HOME/${vault_path#~/}"
fi

skills_folder="$vault_path/Skills"
mkdir -p "$skills_folder"

baseline_skill_slug="karpathy-guidelines"
baseline_source_dir="$ROOT/skills/$baseline_skill_slug"
baseline_target_dir="$skills_folder/$baseline_skill_slug"

agent_ids=(codex claude hermes gemini openclaw aeon)

agent_label() {
  case "$1" in
    codex) printf "Codex" ;;
    claude) printf "Claude" ;;
    hermes) printf "Hermes" ;;
    gemini) printf "Gemini" ;;
    openclaw) printf "OpenClaw" ;;
    aeon) printf "Aeon" ;;
    *) printf "%s" "$1" ;;
  esac
}

agent_skill_roots() {
  case "$1" in
    codex)
      printf "%s\n" "$HOME/.codex/skills" "$HOME/.codex/plugins/cache"
      ;;
    claude)
      printf "%s\n" "$HOME/.claude/skills" "$HOME/.claude/plugins"
      ;;
    hermes)
      printf "%s\n" "$HOME/.hermes/skills" "$HOME/.hermes/plugins" "$HOME/.hermes/agents"
      ;;
    gemini)
      printf "%s\n" "$HOME/.gemini/skills" "$HOME/.gemini/extensions"
      ;;
    openclaw)
      printf "%s\n" "$HOME/.openclaw/skills"
      for workspace in "$HOME"/.openclaw/workspace-*; do
        [[ -d "$workspace/skills" ]] && printf "%s\n" "$workspace/skills"
      done
      ;;
    aeon)
      printf "%s\n" "$HOME/.aeon/skills" "$HOME/.aeon/plugins" "$HOME/.aeon/agents"
      [[ -n "${AEON_LOCAL_PATH:-}" && -d "$AEON_LOCAL_PATH/skills" ]] && printf "%s\n" "$AEON_LOCAL_PATH/skills"
      ;;
  esac
}

agent_instruction_files() {
  case "$1" in
    codex)
      printf "%s\n" "$HOME/.codex/AGENTS.md"
      ;;
    claude)
      printf "%s\n" "$HOME/.claude/CLAUDE.md"
      ;;
    hermes)
      # Hermes always loads SOUL.md from HERMES_HOME as identity/persona.
      # AGENTS.md is only loaded as a cwd project-context file, so patching
      # ~/.hermes/AGENTS.md alone does not reach normal Telegram/gateway runs.
      printf "%s\n" "$HOME/.hermes/SOUL.md" "$HOME/.hermes/AGENTS.md"
      ;;
    gemini)
      printf "%s\n" "$HOME/.gemini/GEMINI.md"
      ;;
    openclaw)
      printf "%s\n" "$HOME/.openclaw/AGENTS.md"
      for workspace in "$HOME"/.openclaw/workspace-*; do
        [[ -d "$workspace" ]] && printf "%s\n" "$workspace/AGENTS.md"
      done
      ;;
    aeon)
      printf "%s\n" "$HOME/.aeon/AGENTS.md"
      ;;
  esac
}

list_includes_agent() {
  local list="$1"
  local agent="$2"
  [[ "$list" == "all" ]] && return 0
  [[ "$list" == "none" || -z "$list" ]] && return 1
  case ",$list," in
    *",$agent,"*) return 0 ;;
    *) return 1 ;;
  esac
}

copy_skill_dir() {
  local from_dir="$1"
  local to_dir="$2"
  if [[ ! -f "$from_dir/SKILL.md" ]]; then
    warn "Bundled skill source missing: $from_dir/SKILL.md"
    return
  fi
  if [[ -f "$to_dir/SKILL.md" ]]; then
    return
  fi
  mkdir -p "$to_dir"
  cp -R "$from_dir/." "$to_dir/"
}

copy_provider_skill() {
  local from_dir="$1"
  local provider="$2"
  local slug
  slug="$(basename "$from_dir" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+|-+$//g')"
  [[ -n "$slug" ]] || slug="skill"
  local destination="$skills_folder/$slug"
  if [[ -f "$destination/SKILL.md" ]]; then
    return 1
  fi
  copy_skill_dir "$from_dir" "$destination"
  cat > "$destination/.hivemind-skill-source.json" <<JSON
{
  "provider": "$provider",
  "providerLabel": "$(agent_label "$provider")",
  "sourcePath": "$from_dir",
  "importedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
  return 0
}

import_agent_skills() {
  local agent="$1"
  local imported=0
  while IFS= read -r root_dir; do
    [[ -d "$root_dir" ]] || continue
    while IFS= read -r skill_md; do
      skill_dir="$(dirname "$skill_md")"
      if [[ "$skill_dir" == "$skills_folder"* ]]; then
        continue
      fi
      if copy_provider_skill "$skill_dir" "$agent"; then
        imported=$((imported + 1))
      fi
    done < <(find "$root_dir" -maxdepth 5 -name SKILL.md -type f 2>/dev/null)
  done < <(agent_skill_roots "$agent")

  if (( imported > 0 )); then
    ok "Imported $imported $(agent_label "$agent") skill(s) into the shared hive"
  fi
}

write_source_metadata() {
  local dir="$1"
  local slug="${2:-$(basename "$dir")}"
  local source_path="${3:-$ROOT/skills/$slug}"
  local source_url="https://github.com/LiamVisionary/hivemindos/tree/main/skills/$slug"
  if [[ "$slug" == "karpathy-guidelines" ]]; then
    source_url="https://github.com/multica-ai/andrej-karpathy-skills/tree/main/skills/karpathy-guidelines"
  fi
  cat > "$dir/.hivemind-skill-source.json" <<JSON
{
  "provider": "bundled",
  "providerLabel": "HivemindOS bundled skills",
  "sourcePath": "$source_path",
  "sourceUrl": "$source_url",
  "importedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
}

write_packaged_auto_install_metadata() {
  local dir="$1"
  local slug="$2"
  local source_path="$3"
  cat > "$dir/.hivemind-skill-source.json" <<JSON
{
  "provider": "packaged-auto-install",
  "providerLabel": "HivemindOS auto-installed packaged skills",
  "sourcePath": "$source_path",
  "sourceUrl": "https://github.com/LiamVisionary/hivemindos/tree/main/packaged-skills/auto-install/$slug",
  "importedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
}

write_managed_block() {
  local file="$1"
  local start="<!-- BEGIN HIVEMINDOS_SHARED_SKILLS -->"
  local end="<!-- END HIVEMINDOS_SHARED_SKILLS -->"
  local tmp_file
  tmp_file="$(mktemp)"
  mkdir -p "$(dirname "$file")"

  if [[ -f "$file" ]]; then
    awk -v start="$start" -v end="$end" \
        -v legacy_start="<!-- BEGIN OMNI_AGENT_HIVEMIND_SHARED_SKILLS -->" \
        -v legacy_end="<!-- END OMNI_AGENT_HIVEMIND_SHARED_SKILLS -->" '
      $0 == start || $0 == legacy_start { skip=1; next }
      $0 == end || $0 == legacy_end { skip=0; next }
      skip != 1 { print }
    ' "$file" > "$tmp_file"
  else
    : > "$tmp_file"
  fi

  {
    sed -e '${/^$/d;}' "$tmp_file"
    printf "\n%s\n" "$start"
    printf "## HivemindOS Shared Skills\n\n"
    printf "A shared notes skill shelf is available at:\n\n"
    printf "%s\n" "- Vault: \`$vault_path\`"
    printf "%s\n" "- Skills index: \`$skills_folder/README.md\`"
    printf "%s\n\n" "- Skill files: \`$skills_folder/<slug>/SKILL.md\`"
    printf "Before using a shared skill, read \`%s/README.md\` for the index, then read the relevant \`SKILL.md\`. The bundled baseline skill is \`karpathy-guidelines\`.\n\n" "$skills_folder"
    printf "## Shared Hive Env\n\n"
    printf "Shared credentials live in \`~/.hivemindos/.env\`. Use \`hive-env-check KEY\` to verify presence and \`hive-env-run -- <command>\` to run tools/apps with the shared env loaded. Do not read, print, summarize, or copy secret values; refer to credentials by variable name only. When making a project consume shared credentials, load the \`shared-hive-env\` skill and default project runtime loading to \`~/.hivemindos/.env\` without persisting secrets into project files.\n"
    printf "%s\n" "$end"
  } > "$file"

  rm -f "$tmp_file"
}

write_skills_readme() {
  local tmp_file
  tmp_file="$(mktemp)"
  cat > "$tmp_file" <<EOF
# Skills

Operational know-how distilled into self-contained recipes. Each subfolder is a single skill: a \`SKILL.md\` with frontmatter plus optional helper files.

Agents should read this index before using shared skills, then read the relevant \`<slug>/SKILL.md\` file.

## Index

EOF
  while IFS= read -r skill_md; do
    local slug description
    slug="$(basename "$(dirname "$skill_md")")"
    description="$(awk '
      BEGIN { in_fm=0 }
      NR == 1 && $0 == "---" { in_fm=1; next }
      in_fm && $0 == "---" { exit }
      in_fm && /^description:/ {
        sub(/^description:[[:space:]]*/, "")
        gsub(/^["'\'']|["'\'']$/, "")
        print
        exit
      }
    ' "$skill_md")"
    [[ -n "$description" ]] || description="Shared agent skill."
    printf -- "- [[%s/SKILL]] - %s\n" "$slug" "$description" >> "$tmp_file"
  done < <(find "$skills_folder" -mindepth 2 -maxdepth 2 -name SKILL.md -type f 2>/dev/null | sort)
  mv "$tmp_file" "$skills_folder/README.md"
}

sync_shared_skills_to_aeon() {
  local aeon_root="${AEON_LOCAL_PATH:-${AEON_HOME:-$HOME/.aeon}}"
  local aeon_skills="$aeon_root/skills"
  local manifest="$aeon_root/skills.json"
  mkdir -p "$aeon_skills"

  while IFS= read -r skill_md; do
    local skill_dir slug destination metadata
    skill_dir="$(dirname "$skill_md")"
    slug="$(basename "$skill_dir")"
    destination="$aeon_skills/$slug"
    metadata="$destination/.hivemind-skill-source.json"
    if [[ -f "$destination/SKILL.md" && ! -f "$metadata" ]]; then
      warn "Skipping Aeon skill sync for $slug; unmanaged Aeon skill already exists"
      continue
    fi
    rm -rf "$destination"
    mkdir -p "$destination"
    cp -R "$skill_dir/." "$destination/"
    cat > "$metadata" <<JSON
{
  "managedBy": "hivemindos",
  "provider": "shared-brain",
  "providerLabel": "Shared brain",
  "sourcePath": "$skill_md",
  "syncedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
  done < <(find "$skills_folder" -mindepth 2 -maxdepth 2 -name SKILL.md -type f 2>/dev/null | sort)

  node - "$skills_folder" "$manifest" <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const [skillsFolder, manifestPath] = process.argv.slice(2);
let retained = [];
try {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  retained = Array.isArray(parsed.skills) ? parsed.skills.filter((skill) => skill?.source !== "shared-brain") : [];
} catch {}
const shared = fs.readdirSync(skillsFolder, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const skillPath = path.join(skillsFolder, entry.name, "SKILL.md");
    if (!fs.existsSync(skillPath)) return null;
    const markdown = fs.readFileSync(skillPath, "utf8");
    const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] || "";
    const field = (name) => frontmatter.match(new RegExp(`^${name}:\\\\s*['\\\"]?(.+?)['\\\"]?\\\\s*$`, "m"))?.[1]?.trim() || "";
    return {
      slug: entry.name,
      name: field("name") || entry.name.split(/[-_]/).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" "),
      description: field("description"),
      source: "shared-brain",
      skillMdPath: skillPath,
      checksum: crypto.createHash("sha256").update(markdown).digest("hex"),
    };
  })
  .filter(Boolean);
const manifest = {
  managedBy: "hivemindos",
  updatedAt: new Date().toISOString(),
  skills: [...retained, ...shared].sort((a, b) => String(a.slug).localeCompare(String(b.slug))),
};
fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
  ok "Synced shared skill shelf to Aeon"
}

seed_bundled_skills() {
  local seeded=0
  local refreshed=0
  while IFS= read -r bundled_skill_md; do
    local bundled_dir slug destination
    bundled_dir="$(dirname "$bundled_skill_md")"
    slug="$(basename "$bundled_dir")"
    destination="$skills_folder/$slug"
    if [[ -f "$destination/SKILL.md" ]]; then
      refreshed=$((refreshed + 1))
      # Keep user edits intact, but refresh source metadata so the shelf records
      # that this skill is available from the HivemindOS app bundle.
      write_source_metadata "$destination" "$slug" "$bundled_dir"
      continue
    fi
    mkdir -p "$destination"
    copy_skill_dir "$bundled_dir" "$destination"
    write_source_metadata "$destination" "$slug" "$bundled_dir"
    seeded=$((seeded + 1))
  done < <(find "$ROOT/skills" -mindepth 2 -maxdepth 2 -name SKILL.md -type f 2>/dev/null | sort)

  if (( seeded > 0 )); then
    ok "Seeded $seeded bundled HivemindOS shared skill(s)"
  else
    ok "Bundled HivemindOS shared skills already present"
  fi
}

seed_packaged_auto_install_skills() {
  local seeded=0
  local source_root="$ROOT/packaged-skills/auto-install"
  [[ -d "$source_root" ]] || return 0
  while IFS= read -r packaged_skill_md; do
    local packaged_dir slug destination
    packaged_dir="$(dirname "$packaged_skill_md")"
    slug="$(basename "$packaged_dir")"
    destination="$skills_folder/$slug"
    if [[ -f "$destination/SKILL.md" ]]; then
      write_packaged_auto_install_metadata "$destination" "$slug" "$packaged_dir"
      continue
    fi
    mkdir -p "$destination"
    copy_skill_dir "$packaged_dir" "$destination"
    write_packaged_auto_install_metadata "$destination" "$slug" "$packaged_dir"
    seeded=$((seeded + 1))
  done < <(find "$source_root" -mindepth 2 -maxdepth 2 -name SKILL.md -type f 2>/dev/null | sort)

  if (( seeded > 0 )); then
    ok "Installed $seeded auto-install packaged skill(s) into the shared brain"
  else
    ok "Auto-install packaged skills already present in the shared brain"
  fi
}

seed_bundled_skills
seed_packaged_auto_install_skills

for agent in "${agent_ids[@]}"; do
  if list_includes_agent "$import_sources" "$agent"; then
    import_agent_skills "$agent"
  fi
done

write_skills_readme

write_managed_block "$vault_path/AGENTS.md"

for agent in "${agent_ids[@]}"; do
  if ! list_includes_agent "$share_targets" "$agent"; then
    continue
  fi
  copy_skill_dir "$baseline_target_dir" "$HOME/.$agent/skills/$baseline_skill_slug"
  if [[ "$agent" == "aeon" ]]; then
    sync_shared_skills_to_aeon
  fi
  while IFS= read -r instruction_file; do
    write_managed_block "$instruction_file"
  done < <(agent_instruction_files "$agent")
done

ok "Runtime skill hints installed for selected agents"
