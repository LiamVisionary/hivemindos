#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-5020}"
COLLECTOR_PORT="${AGENT_TELEMETRY_PORT:-8787}"
TAILNET_COLLECTOR_PORT="${HIVE_TAILNET_COLLECTOR_PORT:-8787}"

info() { printf "\033[1;36m%s\033[0m\n" "$*"; }
ok() { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$*"; }

yes_all="false"
non_interactive="false"
delete_repo="false"

usage() {
  cat <<'EOF'
Usage: ./uninstall.sh [options]

Interactively removes HivemindOS local setup pieces. Each destructive action is
prompted one by one unless --yes is provided.

Options:
  --yes, -y              Answer yes to all prompts.
  --non-interactive      Do not prompt; only print what can be removed.
  -h, --help             Show this help.
EOF
}

while (( $# > 0 )); do
  case "$1" in
    --yes|-y)
      yes_all="true"
      ;;
    --non-interactive)
      non_interactive="true"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      warn "Ignoring unknown option: $1"
      ;;
  esac
  shift
done

ask() {
  local prompt="$1"
  local default="${2:-no}"
  local suffix="[y/N]"
  local answer=""
  if [[ "$yes_all" == "true" ]]; then return 0; fi
  if [[ "$non_interactive" == "true" ]]; then
    warn "Would ask: $prompt"
    return 1
  fi
  [[ "$default" == "yes" ]] && suffix="[Y/n]"
  read -r -p "$prompt $suffix " answer
  answer="$(printf "%s" "$answer" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  if [[ -z "$answer" ]]; then
    [[ "$default" == "yes" ]]
    return
  fi
  [[ "$answer" == "y" || "$answer" == "yes" ]]
}

run_if_exists() {
  command -v "$1" >/dev/null 2>&1
}

remove_managed_block() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local tmp_file
  tmp_file="$(mktemp)"
  awk '
    $0 == "<!-- BEGIN HIVEMINDOS_SHARED_SKILLS -->" || $0 == "<!-- BEGIN OMNI_AGENT_HIVEMIND_SHARED_SKILLS -->" { skip=1; changed=1; next }
    $0 == "<!-- END HIVEMINDOS_SHARED_SKILLS -->" || $0 == "<!-- END OMNI_AGENT_HIVEMIND_SHARED_SKILLS -->" { skip=0; next }
    skip != 1 { print }
    END { if (changed != 1) exit 3 }
  ' "$file" > "$tmp_file" || {
    rm -f "$tmp_file"
    return 0
  }
  mv "$tmp_file" "$file"
  ok "Removed HivemindOS shared-skill block from $file"
}

remove_claude_brain_hook() {
  local settings_file="$HOME/.claude/settings.json"
  [[ -f "$settings_file" ]] || return 0
  node - "$settings_file" <<'NODE'
const fs = require("fs");
const settingsFile = process.argv[2];
let settings;
try {
  settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
} catch {
  process.exit(0);
}
if (!settings?.hooks || !Array.isArray(settings.hooks.UserPromptSubmit)) process.exit(0);
settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit
  .map((group) => {
    if (!group || typeof group !== "object" || !Array.isArray(group.hooks)) return group;
    return { ...group, hooks: group.hooks.filter((hook) => !String(hook?.command || "").includes("hive-brain-hook")) };
  })
  .filter((group) => !group || typeof group !== "object" || !Array.isArray(group.hooks) || group.hooks.length > 0);
if (settings.hooks.UserPromptSubmit.length === 0) delete settings.hooks.UserPromptSubmit;
if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
NODE
  ok "Removed Claude shared-brain hook from $settings_file"
}

agent_instruction_files() {
  local agent="$1"
  case "$agent" in
    codex) printf "%s\n" "$HOME/.codex/AGENTS.md" ;;
    claude) printf "%s\n" "$HOME/.claude/CLAUDE.md" ;;
    hermes) printf "%s\n" "$HOME/.hermes/SOUL.md" "$HOME/.hermes/AGENTS.md" ;;
    gemini) printf "%s\n" "$HOME/.gemini/GEMINI.md" ;;
    openclaw)
      printf "%s\n" "$HOME/.openclaw/AGENTS.md"
      for workspace in "$HOME"/.openclaw/workspace-*; do
        [[ -d "$workspace" ]] && printf "%s\n" "$workspace/AGENTS.md"
      done
      ;;
    aeon) printf "%s\n" "$HOME/.aeon/AGENTS.md" ;;
  esac
}

agent_skill_dirs() {
  local agent="$1"
  case "$agent" in
    codex) printf "%s\n" "$HOME/.codex/skills/karpathy-guidelines" ;;
    claude) printf "%s\n" "$HOME/.claude/skills/karpathy-guidelines" ;;
    hermes) printf "%s\n" "$HOME/.hermes/skills/karpathy-guidelines" ;;
    gemini) printf "%s\n" "$HOME/.gemini/skills/karpathy-guidelines" ;;
    openclaw)
      printf "%s\n" "$HOME/.openclaw/skills/karpathy-guidelines"
      for workspace in "$HOME"/.openclaw/workspace-*; do
        [[ -d "$workspace/skills" ]] && printf "%s\n" "$workspace/skills/karpathy-guidelines"
      done
      ;;
    aeon)
      printf "%s\n" "$HOME/.aeon/skills/karpathy-guidelines"
      [[ -n "${AEON_LOCAL_PATH:-}" ]] && printf "%s\n" "$AEON_LOCAL_PATH/skills/karpathy-guidelines"
      ;;
  esac
}

vault_path="${NEXT_PUBLIC_OBSIDIAN_VAULT_PATH:-$HOME/Documents/Obsidian/hivemindos-vault}"
if [[ "$vault_path" == "~/"* ]]; then
  vault_path="$HOME/${vault_path#~/}"
fi
brain_services_folder="${NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER:-Operations/Brain Services}"
synthesis_folder="${NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER:-Synthesis}"
scheduled_folder="${NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER:-Operations/Automations}"
kanban_folder="${NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER:-Operations/Work Board}"
notifications_folder="${NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER:-Operations/Agent Notifications}"
secure_folder="${HIVE_NOTE_SECURE_FOLDER:-Operations/Secure}"
gbrain_install_path="${NEXT_PUBLIC_GBRAIN_INSTALL_PATH:-$HOME/gbrain}"
gbrain_data_dir="${NEXT_PUBLIC_GBRAIN_DATA_DIR:-$HOME/.gbrain}"
if [[ "$gbrain_install_path" == "~/"* ]]; then
  gbrain_install_path="$HOME/${gbrain_install_path#~/}"
fi
if [[ "$gbrain_data_dir" == "~/"* ]]; then
  gbrain_data_dir="$HOME/${gbrain_data_dir#~/}"
fi

info "HivemindOS uninstall"
warn "This removes only the pieces you approve. Personal vault notes and third-party apps are left alone unless you say yes."

if ask "Stop HivemindOS dashboard processes for this checkout and port $PORT?" "yes"; then
  if run_if_exists lsof; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true)"
      cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
      if [[ "$cwd" == "$ROOT" || "$cmd" == *"$ROOT"* ]]; then
        kill "$pid" >/dev/null 2>&1 || true
        ok "Stopped dashboard process $pid"
      fi
    done < <(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  else
    warn "lsof is unavailable; skipped process detection"
  fi
fi

if ask "Remove HivemindOS telemetry collector service?" "yes"; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    for plist in "$HOME/Library/LaunchAgents/com.agent-control-room.telemetry.plist" "$HOME/Library/LaunchAgents/com.hivemindos.telemetry.plist"; do
      [[ -f "$plist" ]] || continue
      label="$(/usr/libexec/PlistBuddy -c 'Print :Label' "$plist" 2>/dev/null || basename "$plist" .plist)"
      launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1 || true
      rm -f "$plist"
      ok "Removed LaunchAgent $label"
    done
  elif run_if_exists systemctl; then
    systemctl --user disable --now agent-telemetry.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/agent-telemetry.service"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    ok "Removed systemd user service agent-telemetry.service"
  fi
fi

if ask "Disable HivemindOS Tailscale Serve collector forwarding on port $TAILNET_COLLECTOR_PORT?" "yes"; then
  tailscale_cli=""
  if [[ -n "${HIVE_TAILSCALE_CLI:-}" && -x "${HIVE_TAILSCALE_CLI:-}" ]]; then
    tailscale_cli="$HIVE_TAILSCALE_CLI"
  elif run_if_exists tailscale; then
    tailscale_cli="$(command -v tailscale)"
  elif run_if_exists brew; then
    tailscale_prefix="$(brew --prefix tailscale 2>/dev/null || true)"
    [[ -n "$tailscale_prefix" && -x "$tailscale_prefix/bin/tailscale" ]] && tailscale_cli="$tailscale_prefix/bin/tailscale"
  fi
  if [[ -n "$tailscale_cli" ]]; then
    "$tailscale_cli" serve "--http=$TAILNET_COLLECTOR_PORT" off >/dev/null 2>&1 \
      || sudo -n "$tailscale_cli" serve "--http=$TAILNET_COLLECTOR_PORT" off >/dev/null 2>&1 \
      || true
    ok "Disabled Tailscale Serve collector forwarding on port $TAILNET_COLLECTOR_PORT"
  else
    warn "Tailscale CLI is unavailable; skipped Serve cleanup"
  fi
fi

if ask "Stop and remove the HivemindOS Link sidecar service?" "yes"; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    for label in com.hivemindos.linkd.agent com.hivemindos.linkd; do
      plist="$HOME/Library/LaunchAgents/$label.plist"
      launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1 || true
      if [[ -f "$plist" ]]; then
        rm -f "$plist"
        ok "Removed HivemindOS Link LaunchAgent $label"
      fi
    done
  elif run_if_exists systemctl; then
    systemctl --user disable --now hivemindos-linkd.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/hivemindos-linkd.service"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    ok "Removed HivemindOS Link systemd service"
  fi
fi

if ask "Stop and remove the Claw backend service?" "yes"; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    plist="$HOME/Library/LaunchAgents/com.hivemindos.claw-backend.plist"
    if [[ -f "$plist" ]]; then
      launchctl bootout "gui/$(id -u)/com.hivemindos.claw-backend" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1 || true
      rm -f "$plist"
      ok "Removed Claw backend LaunchAgent"
    fi
  elif run_if_exists systemctl; then
    systemctl --user disable --now hivemindos-claw-backend.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/hivemindos-claw-backend.service"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    ok "Removed Claw backend systemd service"
  fi
fi

if ask "Remove the Claw backend install dir ~/.hivemindos/claw (includes its database + agent workspaces)?" "no"; then
  rm -rf "$HOME/.hivemindos/claw"
  ok "Removed ~/.hivemindos/claw"
fi

if ask "Remove the built hivemind-linkd binary from this checkout?" "yes"; then
  rm -f "$ROOT/bin/hivemind-linkd"
  ok "Removed $ROOT/bin/hivemind-linkd"
fi

if ask "Remove local Hivemind Link Tailscale state from ~/.hivemindos/link?" "no"; then
  rm -rf "$HOME/.hivemindos/link"
  ok "Removed ~/.hivemindos/link"
fi

if ask "Remove HivemindOS collector environment file ~/.hivemindos/collector.env?" "no"; then
  rm -f "$HOME/.hivemindos/collector.env"
  ok "Removed ~/.hivemindos/collector.env"
fi

if ask "Remove HivemindOS GitLawb config/status cache from ~/.hivemindos/gitlawb?" "yes"; then
  rm -rf "$HOME/.hivemindos/gitlawb/status.json" "$HOME/.hivemindos/gitlawb/setup-status.json"
  ok "Removed HivemindOS GitLawb status cache"
fi

if ask "Remove fallback HivemindOS project registry ~/.hivemindos/projects.json?" "no"; then
  rm -f "$HOME/.hivemindos/projects.json"
  ok "Removed ~/.hivemindos/projects.json"
fi

if ask "Remove GitLawb CLI binaries installed by HivemindOS?" "no"; then
  marker="$HOME/.hivemindos/gitlawb/installed-by-hivemindos.json"
  if [[ -f "$marker" ]] && command -v node >/dev/null 2>&1; then
    node - "$marker" <<'NODE'
const fs = require("fs");
const path = require("path");
const marker = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const installDir = String(marker.installDir || "");
const binaries = Array.isArray(marker.binaries) ? marker.binaries : [];
if (!installDir || installDir.includes("\0")) process.exit(0);
for (const binary of binaries) {
  if (!/^[A-Za-z0-9._-]+$/.test(binary)) continue;
  const target = path.join(installDir, binary);
  try {
    fs.rmSync(target, { force: true });
    console.log(target);
  } catch {}
}
NODE
    rm -f "$marker"
    ok "Removed HivemindOS-managed GitLawb binaries listed in $marker"
  else
    warn "No HivemindOS GitLawb install marker found; skipped unmanaged CLI binaries"
  fi
fi

if ask "Remove GitLawb config keys from .env.local?" "no"; then
  env_file="$ROOT/.env.local"
  if [[ -f "$env_file" ]]; then
    tmp_file="$(mktemp)"
    grep -Ev '^(NEXT_PUBLIC_GITLAWB_|GITLAWB_)' "$env_file" > "$tmp_file" || true
    mv "$tmp_file" "$env_file"
    ok "Removed GitLawb config keys from .env.local"
  fi
fi

if ask "DANGEROUS: remove local GitLawb identity directory ~/.gitlawb? This may delete signing identity material." "no"; then
  rm -rf "$HOME/.gitlawb"
  ok "Removed ~/.gitlawb"
fi

if ask "Stop/remove GitLawb node service or container only if HivemindOS created it?" "no"; then
  marker="$HOME/.hivemindos/gitlawb/node-created-by-hivemindos.json"
  if [[ -f "$marker" ]]; then
    if run_if_exists docker; then
      docker rm -f hivemindos-gitlawb-node >/dev/null 2>&1 || true
      ok "Removed HivemindOS GitLawb node container if present"
    fi
    rm -f "$marker"
  else
    warn "No HivemindOS GitLawb node marker found; skipped node cleanup"
  fi
fi

if ask "Stop and remove the HivemindOS Syncthing service wrapper?" "yes"; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    plist="$HOME/Library/LaunchAgents/com.hivemindos.syncthing.plist"
    if [[ -f "$plist" ]]; then
      launchctl bootout "gui/$(id -u)/com.hivemindos.syncthing" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1 || true
      rm -f "$plist"
      ok "Removed HivemindOS Syncthing LaunchAgent"
    fi
  elif run_if_exists systemctl; then
    systemctl --user disable --now hivemindos-syncthing.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/hivemindos-syncthing.service"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    ok "Removed HivemindOS Syncthing systemd service"
  fi
fi

if ask "Remove HivemindOS shared-skill instructions from agent files?" "yes"; then
  [[ -f "$vault_path/AGENTS.md" ]] && remove_managed_block "$vault_path/AGENTS.md"
  for agent in codex claude hermes gemini openclaw aeon; do
    while IFS= read -r file; do
      remove_managed_block "$file"
    done < <(agent_instruction_files "$agent")
  done
  remove_claude_brain_hook
fi

if ask "Remove copied karpathy-guidelines skill from local agent skill folders?" "no"; then
  for agent in codex claude hermes gemini openclaw aeon; do
    while IFS= read -r dir; do
      [[ -d "$dir" ]] || continue
      if [[ -f "$dir/SKILL.md" ]] && grep -q "name: karpathy-guidelines" "$dir/SKILL.md"; then
        rm -rf "$dir"
        ok "Removed $dir"
      else
        warn "Skipped unmanaged skill directory: $dir"
      fi
    done < <(agent_skill_dirs "$agent")
  done
fi

if ask "Remove Aeon shared-brain skill manifest entries created by HivemindOS? This only edits skills.json." "no"; then
  aeon_root="${AEON_LOCAL_PATH:-${AEON_HOME:-$HOME/.aeon}}"
  if [[ -f "$aeon_root/skills.json" ]] && run_if_exists node; then
    node - "$aeon_root/skills.json" <<'NODE'
const fs = require("fs");
const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.skills = Array.isArray(manifest.skills) ? manifest.skills.filter((skill) => skill?.source !== "shared-brain") : [];
manifest.updatedAt = new Date().toISOString();
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
    ok "Removed shared-brain skills from $aeon_root/skills.json"
  fi
fi

if ask "Remove Aeon skill folders mirrored from the shared Skills shelf by HivemindOS?" "no"; then
  aeon_root="${AEON_LOCAL_PATH:-${AEON_HOME:-$HOME/.aeon}}"
  if [[ -d "$aeon_root/skills" ]]; then
    find "$aeon_root/skills" -mindepth 2 -maxdepth 2 -name .hivemind-skill-source.json -type f 2>/dev/null |
      while IFS= read -r marker; do
        if grep -q '"managedBy": "hivemindos"' "$marker" || grep -q '"provider": "shared-brain"' "$marker"; then
          rm -rf "$(dirname "$marker")"
          ok "Removed $(dirname "$marker")"
        fi
      done
  fi
fi

if ask "Remove optional GBrain and Syntho config keys from .env.local?" "no"; then
  env_file="$ROOT/.env.local"
  if [[ -f "$env_file" ]]; then
    tmp_file="$(mktemp)"
    grep -Ev '^(NEXT_PUBLIC_GBRAIN_|NEXT_PUBLIC_SYNTO_|NEXT_PUBLIC_HIVE_GBRAIN_SURFACE_ENABLED=)' "$env_file" > "$tmp_file" || true
    mv "$tmp_file" "$env_file"
    ok "Removed optional GBrain and Syntho config keys from .env.local"
  fi
fi

if ask "Remove shared vault secure-folder config key from .env.local?" "no"; then
  env_file="$ROOT/.env.local"
  if [[ -f "$env_file" ]]; then
    tmp_file="$(mktemp)"
    grep -Ev '^HIVE_NOTE_SECURE_FOLDER=' "$env_file" > "$tmp_file" || true
    mv "$tmp_file" "$env_file"
    ok "Removed shared vault secure-folder config key from .env.local"
  fi
fi

if ask "Remove dashboard auth secret and device token from .env.local and shared hive env?" "no"; then
  env_file="$ROOT/.env.local"
  if [[ -f "$env_file" ]]; then
    tmp_file="$(mktemp)"
    grep -Ev '^(HIVEMINDOS_DASHBOARD_AUTH_SECRET|HIVEMINDOS_DASHBOARD_DEVICE_TOKEN)=' "$env_file" > "$tmp_file" || true
    mv "$tmp_file" "$env_file"
    ok "Removed dashboard auth keys from .env.local"
  fi
  if [[ -x "$ROOT/scripts/hive-env-add" ]]; then
    if printf "HIVEMINDOS_DASHBOARD_AUTH_SECRET=\nHIVEMINDOS_DASHBOARD_DEVICE_TOKEN=\n" | "$ROOT/scripts/hive-env-add" --import-stdin --scope agent --runtime generic >/dev/null 2>&1; then
      ok "Removed dashboard auth keys from shared hive env"
    else
      warn "Could not remove dashboard auth keys from shared hive env"
    fi
  fi
fi

if ask "Remove optional GBrain service note from the Obsidian vault?" "no"; then
  rm -f "$vault_path/$brain_services_folder/GBrain.md"
  ok "Removed $vault_path/$brain_services_folder/GBrain.md"
fi

if ask "Remove optional Syntho service note from the Obsidian vault?" "no"; then
  rm -f "$vault_path/$brain_services_folder/Syntho.md" "$vault_path/$brain_services_folder/Synto.md"
  ok "Removed $vault_path/$brain_services_folder/Syntho.md and any legacy Synto.md"
fi

if ask "Uninstall global Syntho CLI installed by uv?" "no"; then
  if command -v uv >/dev/null 2>&1; then
    uv tool uninstall synto >/dev/null 2>&1 || true
    ok "Requested uv tool removal for synto"
  else
    warn "uv is unavailable; skipped global Syntho CLI removal"
  fi
fi

if ask "Remove optional Syntho runtime files from the Synthesis folder?" "no"; then
  rm -rf "$vault_path/$synthesis_folder/.synto"
  rm -f "$vault_path/$synthesis_folder/synto.toml" "$vault_path/$synthesis_folder/vault-schema.md"
  ok "Removed optional Syntho runtime files from $vault_path/$synthesis_folder"
fi

if ask "Remove namespaced GBrain skillpack from the shared Skills shelf?" "no"; then
  rm -rf "$vault_path/Skills/GBrain"
  ok "Removed $vault_path/Skills/GBrain"
fi

if ask "Uninstall global GBrain CLI installed by Bun?" "no"; then
  if run_if_exists bun; then
    bun remove -g gbrain >/dev/null 2>&1 || true
    ok "Requested Bun global removal for gbrain"
  else
    warn "Bun is unavailable; skipped global GBrain CLI removal"
  fi
fi

if ask "Remove local GBrain checkout at $gbrain_install_path?" "no"; then
  rm -rf "$gbrain_install_path"
  ok "Removed $gbrain_install_path"
fi

if ask "Remove local GBrain data directory at $gbrain_data_dir?" "no"; then
  rm -rf "$gbrain_data_dir"
  ok "Removed $gbrain_data_dir"
fi

if ask "Remove seeded self-writing vault workflow templates from Operations/Automations?" "no"; then
  rm -rf "$vault_path/$scheduled_folder/Foundation Workflows"
  ok "Removed $vault_path/$scheduled_folder/Foundation Workflows"
fi

if ask "Remove seeded AI-ready shared-brain contract, templates, and Obsidian service notes?" "no"; then
  rm -f "$vault_path/Operations/AI-Ready Vault Contract.md"
  rm -f "$vault_path/$brain_services_folder/Obsidian Plugin Pack.md"
  rm -f "$vault_path/$brain_services_folder/Obsidian CLI.md"
  rm -rf "$vault_path/Templates/HivemindOS"
  ok "Removed seeded AI-ready shared-brain files"
fi

if ask "Remove auto-installed packaged HivemindOS skills from the shared Skills shelf?" "no"; then
  if [[ -d "$vault_path/Skills" ]]; then
    find "$vault_path/Skills" -mindepth 2 -maxdepth 2 -name .hivemind-skill-source.json -type f 2>/dev/null |
      while IFS= read -r marker; do
        if grep -q '"provider": "packaged-auto-install"' "$marker"; then
          rm -rf "$(dirname "$marker")"
          ok "Removed $(dirname "$marker")"
        fi
      done
  fi
fi

if ask "Remove the shared Skills shelf created in the Obsidian vault?" "no"; then
  rm -rf "$vault_path/Skills"
  ok "Removed $vault_path/Skills"
fi

if ask "Remove empty canonical HivemindOS vault folders created by setup?" "no"; then
  for dir in \
    "$vault_path/$notifications_folder" \
    "$vault_path/$kanban_folder" \
    "$vault_path/$scheduled_folder/Foundation Workflows" \
    "$vault_path/$scheduled_folder" \
    "$vault_path/$brain_services_folder" \
    "$vault_path/$synthesis_folder/pack" \
    "$vault_path/$synthesis_folder/wiki/synthesis" \
    "$vault_path/$synthesis_folder/wiki/queries" \
    "$vault_path/$synthesis_folder/wiki/sources" \
    "$vault_path/$synthesis_folder/wiki/.drafts" \
    "$vault_path/$synthesis_folder/wiki" \
    "$vault_path/$synthesis_folder/raw" \
    "$vault_path/$synthesis_folder" \
    "$vault_path/Operations/Code Projects" \
    "$vault_path/$secure_folder" \
    "$vault_path/Operations/Runtime Mirrors" \
    "$vault_path/Operations" \
    "$vault_path/Archive/Processed Requests" \
    "$vault_path/Archive" \
    "$vault_path/Agents" \
    "$vault_path/Projects" \
    "$vault_path/Templates/HivemindOS" \
    "$vault_path/Templates" \
    "$vault_path/Memory/Distillations/Agent Memory" \
    "$vault_path/Memory/Distillations" \
    "$vault_path/Memory/Imported Sources" \
    "$vault_path/Memory/Meetings" \
    "$vault_path/Memory/Weekly Reviews" \
    "$vault_path/Memory/Decision Journal" \
    "$vault_path/Memory/Daily Briefings" \
    "$vault_path/Memory/Book Notes" \
    "$vault_path/Memory" \
    "$vault_path/.hivemindos-transfers" \
    "$vault_path/Intake/Sources" \
    "$vault_path/Intake/Requests" \
    "$vault_path/Intake"; do
    if rmdir "$dir" 2>/dev/null; then
      ok "Removed empty folder $dir"
    else
      warn "Skipped non-empty or missing folder: $dir"
    fi
  done
fi

if ask "Remove HivemindOS app cache/build/dependencies from this checkout?" "yes"; then
  rm -rf "$ROOT/.next" "$ROOT/.setup-cache" "$ROOT/node_modules"
  ok "Removed .next, .setup-cache, and node_modules"
fi

if ask "Remove .env.local from this checkout?" "no"; then
  rm -f "$ROOT/.env.local"
  ok "Removed .env.local"
fi

if ask "Remove hive env, transfer, handoff, Hivemind MCP, update, brain, and brain hook commands from ~/.local/bin if they point to this checkout?" "yes"; then
  for command_name in hive-env-add hive-env-remove hive-env-delete hive-env-run hive-env-check hive-transfer hive-handoff hivemind-mcp hive-update hive-brain hive-brain-hook; do
    command_path="$HOME/.local/bin/$command_name"
    script_path="$ROOT/scripts/$command_name"
    if [[ -L "$command_path" && "$(readlink "$command_path")" == "$script_path" ]]; then
      rm -f "$command_path"
      ok "Removed $command_path"
    elif [[ -f "$command_path" && -f "$script_path" ]] && cmp -s "$command_path" "$script_path"; then
      rm -f "$command_path"
      ok "Removed copied $command_path"
    elif [[ -f "$command_path" ]] && grep -q "run_helper \"$ROOT\"" "$command_path" 2>/dev/null; then
      rm -f "$command_path"
      ok "Removed wrapper $command_path"
    else
      warn "Skipped $command_path because it is not managed by this checkout"
    fi
  done
fi
if ask "Remove the Homebrew shellenv line HivemindOS setup may have added to ~/.zprofile?" "no"; then
  profile_file="$HOME/.zprofile"
  if [[ -f "$profile_file" ]]; then
    tmp_file="$(mktemp)"
    grep -Fv 'eval "$(/opt/homebrew/bin/brew shellenv zsh)"' "$profile_file" |
      grep -Fv 'eval "$(/usr/local/bin/brew shellenv zsh)"' > "$tmp_file" || true
    mv "$tmp_file" "$profile_file"
    ok "Removed Homebrew shellenv line from $profile_file"
  fi
fi

if ask "Uninstall Syncthing itself from this machine?" "no"; then
  if [[ "$(uname -s)" == "Darwin" ]] && run_if_exists brew; then
    brew uninstall syncthing || true
  elif run_if_exists apt-get && run_if_exists sudo; then
    sudo apt-get remove -y syncthing || true
  elif run_if_exists dnf && run_if_exists sudo; then
    sudo dnf remove -y syncthing || true
  elif run_if_exists yum && run_if_exists sudo; then
    sudo yum remove -y syncthing || true
  fi
fi

if ask "Uninstall Unison itself from this machine?" "no"; then
  if [[ "$(uname -s)" == "Darwin" ]] && run_if_exists brew; then
    brew uninstall unison || true
  elif run_if_exists apt-get && run_if_exists sudo; then
    sudo apt-get remove -y unison || true
  elif run_if_exists dnf && run_if_exists sudo; then
    sudo dnf remove -y unison || true
  elif run_if_exists yum && run_if_exists sudo; then
    sudo yum remove -y unison || true
  fi
fi

if ask "Uninstall Tailscale itself from this machine?" "no"; then
  if [[ "$(uname -s)" == "Darwin" ]] && run_if_exists brew; then
    brew uninstall --cask tailscale tailscale-app >/dev/null 2>&1 || true
    brew uninstall tailscale >/dev/null 2>&1 || true
  elif run_if_exists apt-get && run_if_exists sudo; then
    sudo apt-get remove -y tailscale || true
  elif run_if_exists dnf && run_if_exists sudo; then
    sudo dnf remove -y tailscale || true
  elif run_if_exists yum && run_if_exists sudo; then
    sudo yum remove -y tailscale || true
  fi
fi

if ask "Uninstall Go itself from this machine?" "no"; then
  if [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    brew uninstall go || true
  elif command -v apt-get >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    sudo apt-get remove -y golang-go || true
  elif command -v dnf >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    sudo dnf remove -y golang || true
  elif command -v yum >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    sudo yum remove -y golang || true
  else
    warn "No automatic Go uninstaller found for this OS"
  fi
fi

if ask "Uninstall pnpm from this machine?" "no"; then
  if run_if_exists npm; then npm uninstall -g pnpm >/dev/null 2>&1 || true; fi
  if [[ "$(uname -s)" == "Darwin" ]] && run_if_exists brew; then brew uninstall pnpm >/dev/null 2>&1 || true; fi
fi

if ask "Uninstall GnuPG/GPG from this machine?" "no"; then
  if [[ "$(uname -s)" == "Darwin" ]] && run_if_exists brew; then
    brew uninstall gnupg >/dev/null 2>&1 || true
  elif run_if_exists apt-get && run_if_exists sudo; then
    sudo apt-get remove -y gnupg >/dev/null 2>&1 || true
  elif run_if_exists dnf && run_if_exists sudo; then
    sudo dnf remove -y gnupg2 >/dev/null 2>&1 || true
  elif run_if_exists yum && run_if_exists sudo; then
    sudo yum remove -y gnupg2 >/dev/null 2>&1 || true
  else
    warn "No automatic GnuPG uninstall path configured for this OS"
  fi
fi

if ask "Uninstall Obsidian from this machine?" "no"; then
  if [[ "$(uname -s)" == "Darwin" ]] && run_if_exists brew; then
    brew uninstall --cask obsidian >/dev/null 2>&1 || true
  elif run_if_exists flatpak; then
    flatpak uninstall -y md.obsidian.Obsidian >/dev/null 2>&1 || true
  elif run_if_exists snap && run_if_exists sudo; then
    sudo snap remove obsidian >/dev/null 2>&1 || true
  else
    warn "No automatic Obsidian uninstall path configured for this OS"
  fi
fi

if ask "Delete this HivemindOS git checkout after uninstall finishes?" "no"; then
  delete_repo="true"
fi

ok "Uninstall prompts complete"
if [[ "$delete_repo" == "true" ]]; then
  parent="$(dirname "$ROOT")"
  repo_name="$(basename "$ROOT")"
  info "Deleting checkout: $ROOT"
  cd "$parent"
  rm -rf "$repo_name"
fi
