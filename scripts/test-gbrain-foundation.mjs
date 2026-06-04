import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const has = (path, needle, label = needle) => {
  assert.ok(read(path).includes(needle), `${path} should contain ${label}`);
};

const agentRuntime = read("src/lib/types/agent-runtime.ts");
for (const token of [
  'inboxFolder: process.env.NEXT_PUBLIC_OBSIDIAN_INBOX_FOLDER ?? "Intake"',
  'notificationsFolder: process.env.NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER ?? "Operations/Agent Notifications"',
  'scheduledFolder: process.env.NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER ?? "Operations/Automations"',
  'kanbanFolder: process.env.NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER ?? "Operations/Work Board"',
  'synthesisFolder: process.env.NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER ?? "Synthesis"',
  'brainServicesFolder: process.env.NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER ?? "Operations/Brain Services"',
  "tradingBrainEnabled: false",
  'skillpackLocation: process.env.NEXT_PUBLIC_GBRAIN_SKILLPACK_LOCATION ?? "Skills/GBrain"',
  'cliPath: process.env.NEXT_PUBLIC_SYNTO_CLI_PATH ?? "synto"',
  'compareHeavyModel: process.env.NEXT_PUBLIC_SYNTO_COMPARE_HEAVY_MODEL ?? "llama3.1:8b"',
  'sourceAccessMode: "deny"',
  'providerPolicy: "balanced-cloud"',
  'searchMode: "balanced"',
  'enabled: false',
]) {
  assert.ok(agentRuntime.includes(token), `agent runtime default missing ${token}`);
}

const storage = read("src/features/dashboard/dashboard-storage.ts");
for (const token of [
  '"Projects/HivemindOS/Kanban"',
  '"agent-notifications"',
  '"Scheduled"',
  '"Team/Shared Context.md"',
  '"HivemindOS/Shared Context.md"',
  'gbrain: { ...DEFAULT_SHARED_VAULT.gbrain, ...(storedVault.gbrain ?? {}) }',
  'synto: { ...DEFAULT_SHARED_VAULT.synto, ...(storedVault.synto ?? {}) }',
]) {
  assert.ok(storage.includes(token), `dashboard storage migration missing ${token}`);
}

for (const route of ["status", "install", "connect", "import", "embed", "dream", "query"]) {
  assert.ok(existsSync(join(root, `src/app/api/brain/gbrain/${route}/route.ts`)), `missing GBrain API route: ${route}`);
}
for (const route of ["status", "install", "connect", "init", "run", "maintain", "compare", "eval", "doctor", "pack", "query"]) {
  assert.ok(existsSync(join(root, `src/app/api/brain/synto/${route}/route.ts`)), `missing Syntho API route: ${route}`);
}

const gbrainService = read("src/lib/services/brain/gbrain.ts");
for (const token of [
  "execFile",
  '["ZEROENTROPY_API_KEY", "OPENAI_API_KEY", "VOYAGE_API_KEY", "ANTHROPIC_API_KEY"]',
  '["import", vault, "--no-embed"]',
  '["embed", "--stale"]',
  '["extract", "links", "--source", "db"]',
  '["extract", "timeline", "--source", "db"]',
  '["skillpack", "scaffold", "--all", "--workspace", tempWorkspace, "--trust"]',
  "No provider secrets are stored in this note.",
  "brainServicesFolder?: string",
]) {
  assert.ok(gbrainService.includes(token), `GBrain service missing ${token}`);
}
assert.ok(!gbrainService.includes("exec("), "GBrain service should use execFile instead of shell exec");

const syntoService = read("src/lib/services/brain/synto.ts");
for (const token of [
  "execFile",
  '["init", root, "--existing", "--non-interactive"]',
  '["maintain", "--vault", root, input.fix ? "--fix" : "--dry-run"]',
  '["compare", "--vault", root, "--format", "both"]',
  '["eval", "--json", "--vault", root]',
  '["pack", "export", "--target", "agents", "--out", out, "--vault", root]',
  "synto serve --vault <synthesis-folder>",
  "sourceAccessMode",
  "No provider secrets are stored in this note.",
]) {
  assert.ok(syntoService.includes(token), `Syntho service missing ${token}`);
}
assert.ok(!syntoService.includes("exec("), "Syntho service should use execFile instead of shell exec");

has("src/lib/services/obsidian/brain-skills.ts", "function namespacedSharedSlug", "namespaced shared skill resolver");
has("src/lib/services/obsidian/brain-skills.ts", 'relativeDir.map((part) => sanitizeSlug(part)).join("/")', "nested GBrain skill namespace");
has("src/lib/services/obsidian/scheduled-runs.ts", "safeVaultFolder", "nested scheduled folder support");
has("src/lib/services/obsidian/brain-graph.ts", "DEFAULT_SHARED_VAULT.brainServicesFolder", "new brain access log path");
has("src/features/dashboard/views/VaultPanel.tsx", '{ id: "brain-services", label: "Brain Services" }', "Brain Services dashboard tab");
has("src/features/dashboard/views/VaultPanel.tsx", "selectVaultPanel", "Vault panel native link fallback");
has("src/features/dashboard/views/VaultPanel.tsx", "Install GBrain", "GBrain install action");
has("src/features/dashboard/views/VaultPanel.tsx", "Install Syntho", "Syntho install action");
has("src/features/dashboard/views/VaultPanel.tsx", "Run pipeline", "Syntho pipeline action");
has("src/features/dashboard/views/VaultPanel.tsx", "Compare model", "Syntho compare model control");
has("src/features/dashboard/views/VaultPanel.tsx", "brainServiceSections", "Brain Services segmented section navigation");
has("src/features/dashboard/views/VaultPanel.tsx", "brainServiceOverviewCards", "Brain Services overview card deck");
has("src/features/dashboard/views/VaultPanel.tsx", "tradingBrainEnabled", "Trading Brain enable toggle");
has("src/features/dashboard/views/VaultPanel.tsx", "Model backend needs attention", "Syntho model repair guidance");
has("src/features/dashboard/brain-modules.tsx", "Advanced actions", "Brain module advanced disclosure");
has("src/features/dashboard/brain-modules.tsx", "brainServicePrimaryActions", "Brain module primary actions");
has("src/features/dashboard/DashboardApp.tsx", 'vaultPanelMode !== "brain-services"', "Brain Services status refresh gate");
has("src/features/dashboard/views/brain-services.module.css", "brainServiceSegmented", "Brain Services segmented pill styling");
has("src/features/dashboard/views/brain-services.module.css", "brainServiceOverviewGrid", "Brain Services overview card grid");
has("src/features/dashboard/views/VaultPanel.tsx", "Synthesis is the curated layer", "Synthesis service card");
has("src/features/dashboard/DashboardApp.tsx", "/api/brain/gbrain/status", "GBrain status API call");
has("src/features/dashboard/DashboardApp.tsx", "/api/brain/synto/status", "Syntho status API call");
has("src/app/DashboardServerHome.tsx", "vaultPanel", "Vault panel deep link query");
has("src/features/dashboard/DashboardApp.tsx", "schedulerVaultAutoSyncKeyRef", "Automations vault auto-sync guard");
has("src/features/dashboard/DashboardApp.tsx", 'activeView !== "scheduler"', "Automations view auto-sync condition");
has("src/features/dashboard/DashboardApp.tsx", "Syncing shared vault automations...", "Automations auto-sync status");

assert.ok(existsSync(join(root, "scripts/seed-vault-foundation.mjs")), "missing vault foundation workflow seeder");
const vaultSeeder = read("scripts/seed-vault-foundation.mjs");
for (const token of [
  "daily-context-generator",
  "connection-finder",
  "queue-processor",
  "weekly-synthesis",
  "project-auto-updater",
  "knowledge-distillation-engine",
  "meeting-processor",
  "research-ingestion",
  "vault-health-check",
  "decision-journal-review",
  "argument-builder",
  "book-notes-processor",
  "feedback-loop-capture",
  "AI-Ready Vault Contract.md",
  "Templates/HivemindOS",
  "Obsidian Plugin Pack.md",
  "Obsidian CLI.md",
  "Foundation Workflows",
  "Intake/Requests",
  "Intake/Sources",
  "Memory/Book Notes",
  "Memory/Daily Briefings",
  "Memory/Decision Journal",
  "Memory/Meetings",
  "Memory/Weekly Reviews",
  "Memory/Distillations",
  "Operations/Secure",
  "Operations/Runtime Mirrors",
  "Archive/Processed Requests",
  "agentName: \"Queen Bee\"",
  "machineName: \"Foundation Workflows\"",
  "runtime: \"openai-compatible\"",
]) {
  assert.ok(vaultSeeder.includes(token), `vault foundation seeder missing ${token}`);
}

const setupSh = read("setup.sh");
const setupPs = read("setup.ps1");
const uninstallSh = read("uninstall.sh");
const uninstallPs = read("uninstall.ps1");
for (const [path, content] of [["setup.sh", setupSh], ["setup.ps1", setupPs]]) {
  for (const token of [
    "Operations/Agent Notifications",
    "Operations/Automations",
    "Operations/Work Board",
    "Operations/Brain Services",
    "Operations/Secure",
    "Operations/Runtime Mirrors",
    "Templates/HivemindOS",
    'NEXT_PUBLIC_HIVE_GBRAIN_SURFACE_ENABLED" "true"',
    "NEXT_PUBLIC_SYNTO_CLI_PATH",
    "NEXT_PUBLIC_SYNTO_COMPARE_HEAVY_MODEL",
    "GBrain.md",
    "Syntho.md",
    "seed-vault-foundation.mjs",
  ]) {
    assert.ok(content.includes(token), `${path} missing setup surface ${token}`);
  }
  assert.ok(!content.includes("Enable optional GBrain integration surface in the shared vault?"), `${path} should seed the disabled GBrain surface without prompting`);
}
for (const [path, content] of [["uninstall.sh", uninstallSh], ["uninstall.ps1", uninstallPs]]) {
  for (const token of [
    "Remove optional GBrain and Syntho config keys from .env.local?",
    "Remove shared vault secure-folder config key from .env.local?",
    "Remove optional GBrain service note from the Obsidian vault?",
    "Remove optional Syntho service note from the Obsidian vault?",
    "Uninstall global Syntho CLI installed by uv?",
    "Remove optional Syntho runtime files from the Synthesis folder?",
    "Remove namespaced GBrain skillpack from the shared Skills shelf?",
    "Remove local GBrain data directory",
    "Remove seeded self-writing vault workflow templates from Operations/Automations?",
    "Remove seeded AI-ready shared-brain contract, templates, and Obsidian service notes?",
    "Remove empty canonical HivemindOS vault folders created by setup?",
    "Foundation Workflows",
    "Intake/Requests",
    "Intake/Sources",
    "Templates",
    "Memory/Daily Briefings",
    "Memory/Decision Journal",
    "Memory/Meetings",
    "Memory/Weekly Reviews",
    "Memory/Distillations",
    "Operations/Secure",
    "Operations/Runtime Mirrors",
    "Archive/Processed Requests",
  ]) {
    assert.ok(content.includes(token), `${path} missing uninstall mirror ${token}`);
  }
}

console.log("GBrain foundation static checks passed.");
