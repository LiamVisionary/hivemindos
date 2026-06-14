import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const has = (path, needle, label = needle) => {
  assert.ok(read(path).includes(needle), `${path} should contain ${label}`);
};

for (const route of ["status", "install", "connect", "index", "embed", "query"]) {
  assert.ok(existsSync(join(root, `src/app/api/brain/qmd/${route}/route.ts`)), `missing QMD API route: ${route}`);
}

const agentRuntime = read("src/lib/types/agent-runtime.ts");
for (const token of [
  "export interface QmdConfig",
  'export type QmdSearchMode = "bm25" | "vector" | "hybrid" | "hybrid-rerank"',
  'cliPath: process.env.NEXT_PUBLIC_QMD_CLI_PATH ?? "qmd"',
  'collectionName: process.env.NEXT_PUBLIC_QMD_COLLECTION_NAME ?? "brain"',
  'indexName: process.env.NEXT_PUBLIC_QMD_INDEX_NAME ?? "index"',
  'searchMode: "hybrid"',
  "autoEmbed: true",
  "Treat QMD as the optional local markdown search brain service",
]) {
  assert.ok(agentRuntime.includes(token), `shared vault defaults missing ${token}`);
}

has("src/features/dashboard/dashboard-storage.ts", "qmd: { ...DEFAULT_SHARED_VAULT.qmd, ...(storedVault.qmd ?? {}) }", "QMD stored config migration");
has("src/features/dashboard/dashboard-types.ts", "DashboardQmdStatus", "dashboard QMD status type");
has("src/app/api/brain/services/status/route.ts", "getQmdStatus", "aggregate brain-services QMD status");
has("src/app/api/brain/services/status/route.ts", "qmd: entry(qmd)", "aggregate brain-services QMD response");

const qmdService = read("src/lib/services/brain/qmd.ts");
for (const token of [
  "execFile",
  'const QMD_PACKAGE = "@tobilu/qmd"',
  'runShellCommand("npm", ["install", "-g", QMD_PACKAGE]',
  '["collection", "add", vault, "--name", config.collectionName]',
  '["update"]',
  '["embed", "-c", config.collectionName',
  '["search", query, ...base]',
  '["vsearch", query, ...base]',
  '["query", structured, ...base, "--candidate-limit"',
  "--no-rerank",
  "No provider secrets are stored in this note. QMD's SQLite index and local models live outside the vault.",
]) {
  assert.ok(qmdService.includes(token), `QMD service missing ${token}`);
}
assert.ok(!qmdService.includes("exec("), "QMD service should use execFile instead of shell exec");

for (const token of [
  "/api/brain/qmd/status",
  "/api/brain/qmd/query",
  "`/api/brain/qmd/${action}`",
  "runQmdAction",
  "queryQmdFromDashboard",
]) {
  has("src/features/dashboard/DashboardApp.tsx", token, `DashboardApp QMD wiring ${token}`);
}

for (const token of [
  'id: "qmd"',
  "Install QMD",
  "Brain Speed++",
  "Search QMD",
  "Refresh index",
  "Refresh vectors",
  "qmdModuleAvailable",
  "qmdModuleEnabled",
  "qmdSettings",
]) {
  has("src/features/dashboard/views/VaultPanel.tsx", token, `VaultPanel QMD module ${token}`);
}

has("src/features/dashboard/views/brain-services-ui.tsx", "qmdSettings?: ReactNode", "QMD settings deck slot");
has("src/features/dashboard/views/brain-services-ui.tsx", "<small>QMD</small>", "QMD settings card");

for (const token of [
  "## QMD",
  "Operations/Brain Services/QMD.md",
  "src/lib/services/brain/qmd.ts",
  "/api/brain/qmd/*",
]) {
  has("docs/whole-brain/brain-services.md", token, `QMD brain service docs ${token}`);
}
has("docs/features/brain-vault-and-skills.md", "Install or connect QMD.", "feature docs QMD actions");
has("docs/whole-brain/vault-map.md", "QMD.md", "vault map QMD service note");
has("docs/whole-brain/index.md", 'Vault --> QMD["QMD markdown search"]', "whole-brain map QMD edge");

console.log("QMD brain service static checks passed.");
