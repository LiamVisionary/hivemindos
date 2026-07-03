#!/usr/bin/env node
// Hermetic coverage for the vault-backed company store + governance trail:
// - legacy ~/.hivemindos/companies.json migrates once into the shared vault
//   (definitions) + per-machine runtime overlay (hot state), legacy kept as backup
// - hot writes (dispatch stamp, metric readings) never rewrite the replicated
//   definitions file (Syncthing churn guard)
// - cold config writes produce config-history entries + hash-chained governance
//   proofs (previousProofHash linkage), and deletes don't resurrect from legacy
// - homeMachineKey gates which machine's driver auto-dispatches; claim-on-launch
// - Company.projectId persists and stamps dispatched Work Board tasks
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hostname, tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-company-vault-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-company-vault-vault-"));
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath; // vault mode BEFORE imports
process.env.QUEEN_BEE_AUTONOMOUS_PICKUP = "0";

// Seed a legacy local company the way a pre-vault machine would have it.
const legacyCompany = {
  id: "co-legacy-1",
  name: "Legacy Outreach Agency",
  agentIds: ["hermes-alpha"],
  charter: "Sell websites to local businesses.",
  frozen: false,
  createdAt: new Date(1_700_000_000_000).toISOString(),
  createdAtMs: 1_700_000_000_000,
  updatedAt: new Date(1_700_000_000_000).toISOString(),
  apexGoal: { title: "Weekly Revenue", metric: "weekly revenue", target: "5000", unit: "currency", current: "120", progress: 2 },
  revenue: { label: "Weekly Revenue", value: "$120", target: "$5,000", pct: 2, delta: "+$120", up: true },
  lastDispatchedAt: 1_750_000_000_000,
  autonomy: true,
};
await mkdir(join(tempHome, ".hivemindos"), { recursive: true });
await writeFile(join(tempHome, ".hivemindos", "companies.json"), JSON.stringify([legacyCompany], null, 2));

const {
  claimCompanyHomeMachine,
  companyRunsOnThisMachine,
  deleteCompany,
  getCompany,
  markCompanyDispatched,
  readCompanies,
  updateCompanyMetric,
  upsertCompany,
} = await import("../src/lib/services/companies-store.ts");
const { readCompanyConfigHistory } = await import("../src/lib/services/company-governance.ts");
const { submitQueenBeeMessage } = await import("../src/lib/services/queen-bee/control-plane.ts");
const { readBoard } = await import("../src/lib/services/kanban/local-kanban-store.ts");

const definitionsFile = join(vaultPath, "Operations", "Companies", "companies.json");
const overlayFile = join(tempHome, ".hivemindos", "companies-runtime.json");
const proofsFile = join(vaultPath, "Operations", "Brain Services", "Company Governance Proofs.jsonl");

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const readProofs = async () =>
  (await readFile(proofsFile, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

try {
  // ── migration: legacy local record lands in the vault, hot state in the overlay ──
  const companies = await readCompanies();
  assert.equal(companies.length, 1, "legacy company migrates into the vault store");
  const merged = companies[0];
  assert.equal(merged.id, "co-legacy-1");
  assert.equal(merged.lastDispatchedAt, 1_750_000_000_000, "hot lastDispatchedAt survives the merge");
  assert.equal(merged.apexGoal?.current, "120", "hot apexGoal.current survives the merge");
  assert.equal(merged.revenue?.value, "$120", "hot revenue survives the merge");
  assert.equal(merged.homeMachineKey, hostname(), "migration claims the local machine as home");

  const definitions = await readJson(definitionsFile);
  assert.equal(definitions.length, 1, "definitions file exists in the vault");
  assert.equal(definitions[0].lastDispatchedAt, undefined, "definitions exclude lastDispatchedAt");
  assert.equal(definitions[0].revenue, undefined, "definitions exclude revenue readings");
  assert.equal(definitions[0].apexGoal.current, undefined, "definitions exclude apexGoal.current");
  assert.equal(definitions[0].apexGoal.target, "5000", "definitions keep the goal target");

  const overlay = await readJson(overlayFile);
  assert.equal(overlay.companies["co-legacy-1"].lastDispatchedAt, 1_750_000_000_000, "overlay holds hot state");
  assert.ok(overlay.migratedCompanyIds.includes("co-legacy-1"), "migration is marked one-shot");

  const migratedHistory = await readCompanyConfigHistory({ companyId: "co-legacy-1" });
  assert.ok(migratedHistory.some((entry) => entry.action === "migrated"), "migration writes a history entry");

  // ── churn guard: hot writes must not rewrite the replicated definitions file ──
  const definitionsBefore = await readFile(definitionsFile, "utf8");
  await markCompanyDispatched("co-legacy-1", 1_750_000_100_000);
  await updateCompanyMetric("co-legacy-1", { current: "480", revenueValue: "$480", revenueDelta: "+$360" });
  assert.equal(await readFile(definitionsFile, "utf8"), definitionsBefore, "dispatch stamp + metric readings leave the definitions file untouched");
  const afterHot = await getCompany("co-legacy-1");
  assert.equal(afterHot.lastDispatchedAt, 1_750_000_100_000, "dispatch stamp lands in the overlay");
  assert.equal(afterHot.apexGoal.current, "480", "metric reading lands in the overlay");
  assert.equal(afterHot.apexGoal.progress, 10, "progress derives from current/target (480/5000)");
  assert.equal(afterHot.revenue.value, "$480", "revenue reading lands in the overlay");

  // ── cold write: definitions change, history + chained proof appended ──
  const proofsBeforeCold = await readProofs();
  await upsertCompany({ id: "co-legacy-1", name: "Legacy Outreach Agency", charter: "Sell better websites.", projectId: "maps-agency-1234" });
  assert.notEqual(await readFile(definitionsFile, "utf8"), definitionsBefore, "config change rewrites the definitions file");
  const afterCold = await getCompany("co-legacy-1");
  assert.equal(afterCold.charter, "Sell better websites.");
  assert.equal(afterCold.projectId, "maps-agency-1234", "projectId persists on the company");
  assert.equal(afterCold.lastDispatchedAt, 1_750_000_100_000, "hot state survives a cold write");
  assert.equal((await readJson(definitionsFile))[0].projectId, "maps-agency-1234", "projectId replicates in the definitions file");

  const history = await readCompanyConfigHistory({ companyId: "co-legacy-1" });
  const updated = history.filter((entry) => entry.action === "updated").at(-1);
  assert.ok(updated, "config change writes an updated history entry");
  assert.ok(updated.changedFields.includes("charter"), "history names the changed field");
  assert.equal(updated.before.charter, "Sell websites to local businesses.");
  assert.equal(updated.after.charter, "Sell better websites.");

  const proofs = await readProofs();
  assert.ok(proofs.length > proofsBeforeCold.length, "config change appends a governance proof");
  for (let i = 1; i < proofs.length; i += 1) {
    assert.equal(
      proofs[i].metadata.previousProofHash,
      proofs[i - 1].metadata.proofHash,
      `proof ${i} chains to proof ${i - 1}`,
    );
  }
  const lastProof = proofs.at(-1);
  assert.equal(lastProof.kind, "company-governance");
  assert.match(lastProof.metadata.contentHash, /^sha256:/);
  assert.ok(
    ["ready", "verified", "unavailable"].includes(lastProof.status),
    "proof status reflects GitLawb availability without failing",
  );

  // ── homeMachineKey gate + claim-on-launch ──
  assert.equal(companyRunsOnThisMachine({ homeMachineKey: hostname() }), true, "home machine dispatches");
  assert.equal(companyRunsOnThisMachine({ homeMachineKey: "some-other-box" }), false, "foreign machine does not");
  assert.equal(companyRunsOnThisMachine({}), false, "unclaimed replicated company waits for a Launch");

  const unclaimed = await upsertCompany({ name: "Unclaimed Co", homeMachineKey: "" });
  assert.equal(unclaimed.homeMachineKey, undefined, "explicit empty homeMachineKey stays unset");
  const claimed = await claimCompanyHomeMachine(unclaimed.id);
  assert.equal(claimed.homeMachineKey, hostname(), "claim-on-launch pins the local machine");
  const defaulted = await upsertCompany({ name: "Fresh Co" });
  assert.equal(defaulted.homeMachineKey, hostname(), "new companies default to the creating machine");

  // ── projectId stamps dispatched Work Board tasks ──
  const kanbanOptions = { vaultPath, kanbanFolder: "Operations/Work Board" };
  await submitQueenBeeMessage({
    message: "Ship the Sarasota template refresh",
    taskTitle: "Template refresh",
    mode: "act",
    source: "company:co-legacy-1:test-run",
    fleetSnapshot: [],
    projectId: "maps-agency-1234",
    ...kanbanOptions,
  });
  const board = await readBoard(null, kanbanOptions);
  const dispatched = (board.tasks ?? []).find((task) => task.title === "Template refresh");
  assert.ok(dispatched, "queen-bee dispatch creates the task");
  assert.equal(dispatched.projectId, "maps-agency-1234", "task carries the company's projectId");

  // ── delete: gone from the vault and NOT resurrected from the legacy backup ──
  assert.equal(await deleteCompany("co-legacy-1"), true);
  const afterDelete = await readCompanies();
  assert.equal(afterDelete.some((company) => company.id === "co-legacy-1"), false, "deleted company stays deleted despite the legacy file");
  const legacyStill = await readJson(join(tempHome, ".hivemindos", "companies.json"));
  assert.equal(legacyStill.length, 1, "legacy file is preserved as the rollback copy");
  const deletedHistory = await readCompanyConfigHistory({ companyId: "co-legacy-1" });
  assert.ok(deletedHistory.some((entry) => entry.action === "deleted"), "delete writes a history entry");

  console.log("company vault store suite passed");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);
