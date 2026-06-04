import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

function has(path, token, label = token) {
  assert.ok(read(path).includes(token), `${path} should contain ${label}`);
}

function lacks(path, token, label = token) {
  assert.ok(!read(path).includes(token), `${path} should not contain ${label}`);
}

const canonicalFolders = [
  "Intake",
  "Intake/Requests",
  "Intake/Sources",
  ".hivemindos-transfers",
  "Memory/Daily Briefings",
  "Memory/Weekly Reviews",
  "Memory/Imported Sources",
  "Memory/Distillations",
  "Projects",
  "Operations/Automations",
  "Operations/Work Board",
  "Operations/Agent Notifications",
  "Operations/Brain Services",
  "Operations/Secure",
  "Operations/Runtime Mirrors",
  "Templates/HivemindOS",
  "Archive/Processed Requests",
  "Skills",
  "Synthesis",
];

for (const [path, tokens] of [
  ["src/lib/types/agent-runtime.ts", [
    'inboxFolder: process.env.NEXT_PUBLIC_OBSIDIAN_INBOX_FOLDER ?? "Intake"',
    'kanbanFolder: process.env.NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER ?? "Operations/Work Board"',
    'notificationsFolder: process.env.NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER ?? "Operations/Agent Notifications"',
    'scheduledFolder: process.env.NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER ?? "Operations/Automations"',
    'synthesisFolder: process.env.NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER ?? "Synthesis"',
    'brainServicesFolder: process.env.NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER ?? "Operations/Brain Services"',
  ]],
  ["src/lib/services/notes/note-task-intake.ts", ['["Projects", "Intake", "Memory"]']],
  ["src/features/dashboard/views/KanbanPanel.tsx", ["Projects&#10;Intake&#10;Memory"]],
  ["src/lib/services/chat/shared-vault-context.ts", ["Operations/Work Board", "Operations/Agent Notifications"]],
  ["src/lib/services/wallet/wallet-vault-backup.ts", ['const DEFAULT_SECURE_FOLDER = "Operations/Secure"']],
  ["src-tauri/src/env.rs", ['.unwrap_or_else(|| "Operations/Secure".to_string())']],
  ["scripts/hive-env-add", ['or "Operations/Secure"']],
]) {
  for (const token of tokens) has(path, token);
}

for (const path of ["setup.sh", "setup.ps1", "uninstall.sh", "uninstall.ps1", "scripts/seed-vault-foundation.mjs"]) {
  for (const folder of canonicalFolders) {
    has(path, folder);
  }
}

for (const path of ["setup.sh", "setup.ps1"]) {
  has(path, "seed-vault-foundation.mjs", "vault foundation initializer");
  has(path, "hive-env-remove", "shared env remove command installer");
  has(path, "hive-env-delete", "shared env delete command installer");
}

for (const path of ["uninstall.sh", "uninstall.ps1"]) {
  has(path, "hive-env-remove", "shared env remove command uninstaller");
  has(path, "hive-env-delete", "shared env delete command uninstaller");
}

has("scripts/seed-vault-foundation.mjs", "vault-health-check");
has("scripts/seed-vault-foundation.mjs", "vault-doctor.mjs");
has("scripts/vault-doctor.mjs", "Operations/Vault Migrations");
has("scripts/vault-doctor.mjs", "Operations/Runtime Mirrors/AEON/.aeon");
has("scripts/vault-doctor.mjs", "hiddenProfileStubs");
has("src/lib/services/obsidian/agent-profiles.ts", 'localName.startsWith(".")');
has("scripts/vault-doctor.mjs", "Memory/Imported Sources/Legacy Notes");
has("scripts/vault-doctor.mjs", "Synthesis/Podcast Clips");
has("scripts/vault-doctor.mjs", "Operations/Automations/Project Autopilot");
has("scripts/vault-doctor.mjs", "Operations/Secure");
has("scripts/e2e-real-fleet.mjs", "cleanupSharedE2eSkill");
has("AGENTS.md", "docs/whole-brain/");
has("AGENTS.md", "scripts/test-vault-structure-contract.mjs");
has("docs/index.md", 'href="whole-brain/"');
has("docs/index.md", 'href="features/hivemind-sync.html"');
has("docs/features/index.md", 'href="../whole-brain/"');
has("docs/features/index.md", 'href="hivemind-sync.html"');
has("docs/_layouts/default.html", "'/whole-brain/'");
has("docs/_layouts/default.html", "'/features/hivemind-sync.html'");
has("README.md", "docs/whole-brain/index.md");
has("README.md", "docs/features/hivemind-sync.md");

for (const path of [
  "docs/whole-brain/index.md",
  "docs/whole-brain/vault-map.md",
  "docs/whole-brain/brain-services.md",
  "docs/whole-brain/shared-skills.md",
  "docs/whole-brain/shared-env.md",
  "docs/whole-brain/sync-and-health.md",
  "docs/whole-brain/architecture-sync.md",
  "docs/whole-brain/code-map.md",
]) {
  assert.ok(existsSync(join(root, path)), `missing whole-brain docs page: ${path}`);
  has(path, "title:", "GitHub Pages front matter");
}

for (const folder of canonicalFolders) {
  has("docs/whole-brain/vault-map.md", folder);
}
has("docs/whole-brain/architecture-sync.md", "setup.sh");
has("docs/whole-brain/architecture-sync.md", "scripts/test-vault-structure-contract.mjs");
has("docs/whole-brain/sync-and-health.md", "Operations/Vault Migrations");
has("docs/whole-brain/sync-and-health.md", ".hivemindos-transfers");
has("docs/whole-brain/shared-skills.md", "Operations/Runtime Mirrors/AEON/.aeon");
has("docs/whole-brain/index.md", "shared-env.html");
has("docs/whole-brain/shared-env.md", "~/.hivemindos/.env");
has("docs/whole-brain/shared-env.md", "hive-env-add");
has("docs/whole-brain/shared-env.md", "hive-env-remove");
has("docs/whole-brain/shared-env.md", "hive-env-delete");
has("docs/whole-brain/shared-env.md", "hive-env-check");
has("docs/whole-brain/shared-env.md", "hive-env-run");
has("docs/whole-brain/shared-env.md", "Operations/Secure/hive.env.gpg");
has("docs/whole-brain/vault-map.md", "## Directory Structure");
has("docs/whole-brain/vault-map.md", "hivemindos-vault/");
has("docs/whole-brain/vault-map.md", ".hivemindos-transfers/");
has("docs/whole-brain/vault-map.md", "|-- Operations/");
has("docs/whole-brain/vault-map.md", "`-- Archive/");
has("docs/features/hivemind-sync.md", "Hivemind Sync");
has("docs/features/hivemind-sync.md", ".hivemindos-transfers/");
has("docs/features/hivemind-sync.md", "collector `/env`");
has("docs/features/hivemind-sync.md", "Tailscale SSH");

for (const path of [
  "src/lib/types/agent-runtime.ts",
  "src/lib/services/wallet/wallet-vault-backup.ts",
  "src-tauri/src/env.rs",
  "scripts/hive-env-add",
  "scripts/hive-env-remove",
  "scripts/hive-env-delete",
  "setup.sh",
  "setup.ps1",
]) {
  lacks(path, "Notes/Secure", "legacy secure note folder default");
}

assert.ok(existsSync(join(root, "scripts/vault-doctor.mjs")), "missing vault doctor script");

console.log("Vault structure contract checks passed.");
