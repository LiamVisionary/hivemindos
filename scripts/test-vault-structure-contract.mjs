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
  "Memory/Distillations/Agent Memory",
  "Projects",
  "Operations/Automations",
  "Operations/Work Board",
  "Operations/Agent Notifications",
  "Operations/Brain Services",
  "Operations/Brain Services/Queen Bee",
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
  has(path, "hive-brain", "shared brain command installer");
  has(path, "hive-brain-hook", "shared brain hook command installer");
  has(path, "hive-handoff", "handoff command installer");
  has(path, "hivemind-mcp", "Hivemind MCP command installer");
  has(path, "hive-pulse", "Hive Pulse command installer");
  has(path, "Python 3.12+", "Hive Pulse Python dependency check");
}

for (const path of ["uninstall.sh", "uninstall.ps1"]) {
  has(path, "hive-env-remove", "shared env remove command uninstaller");
  has(path, "hive-env-delete", "shared env delete command uninstaller");
  has(path, "hive-brain", "shared brain command uninstaller");
  has(path, "hive-brain-hook", "shared brain hook command uninstaller");
  has(path, "hive-handoff", "handoff command uninstaller");
  has(path, "hivemind-mcp", "Hivemind MCP command uninstaller");
  has(path, "hive-pulse", "Hive Pulse command uninstaller");
  has(path, path.endsWith(".ps1") ? "Python.Python.3.12" : "python@3.12", "Hive Pulse Python uninstall mirror");
}

assert.ok(existsSync(join(root, "scripts/hive-pulse")), "missing Hive Pulse command shim");

has("scripts/seed-vault-foundation.mjs", "vault-health-check");
has("scripts/seed-vault-foundation.mjs", "vault-doctor.mjs");
has("scripts/seed-vault-foundation.mjs", "Obsidian Native Brain Pack.md");
has("scripts/seed-vault-foundation.mjs", "Agent Memory.base");
has("scripts/seed-vault-foundation.mjs", "Project Brain.base");
has("scripts/seed-vault-foundation.mjs", "Secure References.base");
has("scripts/seed-vault-foundation.mjs", "Whole Brain.canvas");
has("scripts/seed-vault-foundation.mjs", "Operations/Brain Services/Queen Bee/Identity.md");
has("scripts/seed-vault-foundation.mjs", "intent-dedupe.jsonl");
has("scripts/seed-vault-foundation.mjs", "receipts.jsonl");
has("src/lib/services/chat/shared-vault-context.ts", "Operations/Brain Services/Queen Bee");
has("src/lib/services/queen-bee/control-plane.ts", "QUEEN_BEE_FOLDER_NAME");
has("src/lib/services/queen-bee/control-plane.ts", "chooseQueenBeeDelegate");
has("src/lib/services/queen-bee/router.ts", "chooseQueenBeeDelegate");
has("src/lib/services/queen-bee/router.ts", "best available");
has("src/app/api/queen-bee/route.ts", "protocol: \"hivemind-queen-bee\"");
has("src/app/api/queen-bee/route.ts", "/api/fleet/discover");
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
has("AGENTS.md", "/api/brain/memory");
has("AGENTS.md", "Operations/Brain Services/Agent Memory Index.jsonl");
has("setup.ps1", "Write-HivemindManagedBlock");
has("setup.ps1", "/api/brain/memory");
has("setup.ps1", "hive-brain answer");
has("setup.ps1", "UserPromptSubmit");
has("scripts/seed-shared-skills.sh", "hive-brain-hook");
has("scripts/seed-shared-skills.sh", "UserPromptSubmit");
has("scripts/seed-shared-skills.sh", "timeout: 20");
has("scripts/hive-brain-hook", "HIVE_BRAIN_HOOK_TIMEOUT_MS || 20000");
has("setup.ps1", "Operations/Brain Services/Agent Memory Index.jsonl");
has("docs/index.md", 'href="whole-brain/"');
has("docs/index.md", 'href="features/hivemind-sync.html"');
has("docs/index.md", 'href="packaged-skills/"');
has("docs/index.md", 'href="slash-commands.html"');
has("docs/index.md", 'href="features/token-and-cost-savings.html"');
has("docs/features/index.md", 'href="../whole-brain/"');
has("docs/features/index.md", 'href="hivemind-sync.html"');
has("docs/features/index.md", 'href="../packaged-skills/"');
has("docs/features/index.md", 'href="token-and-cost-savings.html"');
has("docs/_layouts/default.html", "'/whole-brain/'");
has("docs/_layouts/default.html", "'/features/hivemind-sync.html'");
has("docs/_layouts/default.html", "'/packaged-skills/'");
has("docs/_layouts/default.html", "'/slash-commands.html'");
has("docs/_layouts/default.html", "'/features/token-and-cost-savings.html'");
has("README.md", "docs/whole-brain/index.md");
has("README.md", "docs/features/hivemind-sync.md");
has("README.md", "docs/packaged-skills/index.md");
has("README.md", "docs/slash-commands.md");
has("README.md", "docs/features/token-and-cost-savings.md");
has("README.md", "pnpm benchmark:context-savings");

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
has("docs/whole-brain/architecture-sync.md", "hive-brain-hook");
has("docs/whole-brain/architecture-sync.md", "shared memory access paths");
has("docs/whole-brain/sync-and-health.md", "Operations/Vault Migrations");
has("docs/whole-brain/sync-and-health.md", ".hivemindos-transfers");
has("docs/whole-brain/shared-skills.md", "Operations/Runtime Mirrors/AEON/.aeon");
has("docs/whole-brain/index.md", "shared-env.html");
has("docs/whole-brain/index.md", "Shared Brain Memory");
has("docs/whole-brain/index.md", "Raw runtime CLIs");
has("docs/whole-brain/vault-map.md", "Agent Memory Proofs.jsonl");
has("docs/whole-brain/vault-map.md", "hive-brain-hook");
has("docs/whole-brain/brain-services.md", "Local-First Memory Benchmarks");
has("docs/whole-brain/brain-services.md", "Obsidian Native Brain Pack");
has("docs/whole-brain/brain-services.md", "Agent Memory.base");
has("docs/whole-brain/brain-services.md", "19.20ms");
has("docs/whole-brain/brain-services.md", "hive-brain answer");
has("docs/whole-brain/brain-services.md", "hive-brain-hook");
has("docs/whole-brain/brain-services.md", "Operations/Brain Services/Queen Bee");
has("docs/whole-brain/brain-services.md", "best available");
has("docs/whole-brain/brain-services.md", "version.projects");
has("docs/whole-brain/brain-services.md", "GitLawb project registry matched");
has("docs/whole-brain/brain-services.md", "Projects/Agent Calls - BYOK vs HivemindOS Cloud.md");
has("docs/integrations/gitlawb.md", "version.projectCheckouts");
has("docs/features/work-and-scheduler.md", "version.projectCheckouts");
has("docs/features/brain-vault-and-skills.md", "Shared Brain Memory Summary");
has("docs/features/brain-vault-and-skills.md", "Obsidian Native Brain Pack");
has("docs/whole-brain/shared-skills.md", "obsidian-markdown");
has("docs/whole-brain/shared-skills.md", "obsidian-bases");
has("docs/whole-brain/shared-skills.md", "json-canvas");
has("docs/whole-brain/shared-skills.md", "defuddle");
has("docs/whole-brain/shared-skills.md", "hive-assimilate");
has("docs/whole-brain/shared-skills.md", "hive-pulse");
has("packaged-skills/README.md", "Obsidian Native Brain Pack");
has("packaged-skills/README.md", "hive-assimilate");
has("packaged-skills/README.md", "hive-pulse");
assert.ok(existsSync(join(root, "packaged-skills/auto-install/hive-assimilate/SKILL.md")), "missing hive-assimilate packaged skill");
assert.ok(existsSync(join(root, "packaged-skills/auto-install/hive-pulse/SKILL.md")), "missing hive-pulse packaged skill");
assert.ok(existsSync(join(root, "packaged-skills/auto-install/hive-pulse/scripts/last30days.py")), "missing bundled Hive Pulse engine");
for (const path of [
  "docs/packaged-skills/index.md",
  "docs/packaged-skills/hive-skills.md",
  "docs/packaged-skills/third-party-skills.md",
  "docs/slash-commands.md",
  "docs/features/token-and-cost-savings.md",
]) {
  assert.ok(existsSync(join(root, path)), `missing docs page: ${path}`);
  has(path, "title:", "GitHub Pages front matter");
}
has("docs/packaged-skills/index.md", "Hive skills");
has("docs/packaged-skills/index.md", "Third-party packaged skills");
has("docs/packaged-skills/hive-skills.md", "hive-assimilate");
has("docs/packaged-skills/hive-skills.md", "hive-pulse");
has("docs/packaged-skills/hive-skills.md", "hive-brain recall");
has("docs/packaged-skills/third-party-skills.md", "Obsidian Native Brain Pack");
has("docs/slash-commands.md", "/handoff-task");
has("docs/slash-commands.md", "/reload-skills");
has("docs/features/token-and-cost-savings.md", "hive-brain answer");
has("docs/features/token-and-cost-savings.md", "karpathy-guidelines");
has("docs/features/token-and-cost-savings.md", "hive-assimilate");
has("docs/features/token-and-cost-savings.md", "pnpm benchmark:context-savings");
has("docs/features/token-and-cost-savings.md", "pnpm benchmark:e2e-token-savings");
has("docs/features/token-and-cost-savings.md", "not a live E2E provider-billing benchmark");
has("package.json", "benchmark:context-savings");
has("package.json", "benchmark:e2e-token-savings");
assert.ok(existsSync(join(root, "scripts/benchmark-context-savings.mjs")), "missing context savings benchmark script");
assert.ok(existsSync(join(root, "scripts/benchmark-e2e-token-savings.mjs")), "missing live e2e token savings benchmark script");
has("docs/features/brain-vault-and-skills.md", "UserPromptSubmit");
has("docs/features/brain-vault-and-skills.md", "Queen Bee control plane");
has("README.md", "19.20ms/31.33ms");
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
  "scripts/hive-brain",
  "scripts/hive-brain-hook",
  "scripts/hive-handoff",
  "scripts/hivemind-mcp",
  "setup.sh",
  "setup.ps1",
]) {
  lacks(path, "Notes/Secure", "legacy secure note folder default");
}

assert.ok(existsSync(join(root, "scripts/vault-doctor.mjs")), "missing vault doctor script");

console.log("Vault structure contract checks passed.");
