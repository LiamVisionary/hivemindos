#!/usr/bin/env node
// Hermetic coverage for Shepherd-inspired Zero Human Company run/proposal traces:
// - durable company runs can start/finish and append events
// - needs-human Work Board outcomes file pending human-input proposals
// - pricing, deliverable rejection, revenue, and replay requests enter the ledger
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-company-runs-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-company-runs-vault-"));

process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;
process.env.HIVEMINDOS_TRADING_PLATFORM_FEES_ENABLED = "false";
process.env.QUEEN_BEE_AUTONOMOUS_PICKUP = "0";

const {
  appendCompanyRunEvent,
  finishCompanyRun,
  listCompanyRuns,
  requestCompanyRunReplay,
  startCompanyRun,
} = await import("../src/lib/services/company-runs.ts");
const {
  addCompanyDirective,
  getCompany,
  proposeCompanyPricingChange,
  resolveCompanyPricingProposal,
  setCompanyProducts,
  upsertCompany,
} = await import("../src/lib/services/companies-store.ts");
const { syncCompanyTaskOutcomes } = await import("../src/lib/services/company-memory.ts");
const { recordCompanyRevenue } = await import("../src/lib/services/company-revenue-share.ts");

try {
  const company = await upsertCompany({
    name: "Traceable Company",
    members: [{ agentId: "hermes-alpha", roleInCompany: "Queen" }],
    apexGoal: { title: "Reach $5k weekly revenue", metric: "weekly revenue", target: "5000", unit: "currency" },
  });
  await setCompanyProducts(company.id, {
    items: [{ key: "standard-site", name: "Standard Site", amountUsd: 3000, recommended: true }],
  });

  const run = await startCompanyRun(company.id, {
    kind: "dispatch",
    title: "Dispatch: Reach $5k weekly revenue",
    actor: "test",
    input: { planner: "heuristic", draftTitles: ["Find leads"] },
  });
  assert.match(run.id, /^crun_/);

  await appendCompanyRunEvent(company.id, run.id, {
    kind: "tasks-created",
    title: "Created 1 Work Board task",
    taskId: "t-human",
  });
  await finishCompanyRun(company.id, run.id, { status: "completed", output: { taskCount: 1 } });

  let ledger = await listCompanyRuns(company.id);
  assert.equal(ledger.runs.length, 1, "finished run lands in the ledger");
  assert.equal(ledger.runs[0].status, "completed");
  assert.equal(ledger.runs[0].events.length, 1, "run event is retained");

  await syncCompanyTaskOutcomes([await getCompany(company.id)], [{
    id: "t-human",
    title: "Approve customer preview",
    status: "needs-human",
    source: `company:${company.id}:${run.id}`,
    assignee: "hermes-alpha",
    result: "ACTION NEEDED: approve the preview or request changes.",
    updatedAt: Date.now(),
  }]);

  ledger = await listCompanyRuns(company.id);
  const humanProposal = ledger.proposals.find((proposal) => proposal.idempotencyKey === "task-human:t-human");
  assert.equal(humanProposal?.status, "pending", "needs-human task files a pending human-input proposal");
  assert.equal(ledger.runs[0].events.length, 2, "task outcome appends to the dispatch run");

  await syncCompanyTaskOutcomes([await getCompany(company.id)], [{
    id: "t-human-done",
    title: "Preview sent",
    status: "done",
    source: `company:${company.id}:${run.id}`,
    assignee: "hermes-alpha",
    result: "Sent preview after approval.",
    completedAt: Date.now(),
  }]);
  ledger = await listCompanyRuns(company.id);
  assert.ok(
    ledger.runs[0].events.some((event) => event.title.startsWith("Task completed")),
    "completed task appends a completion event",
  );

  const pricing = await proposeCompanyPricingChange(company.id, {
    productRef: "standard-site",
    proposedAmountUsd: 2400,
    why: "9 of 14 prospects cited price.",
    sourceTaskId: "t-pricing",
    proposedBy: "hermes-alpha",
  });
  assert.ok(pricing, "pricing proposal is accepted against a catalog product");
  ledger = await listCompanyRuns(company.id);
  assert.equal(
    ledger.proposals.find((proposal) => proposal.id === pricing.id)?.status,
    "pending",
    "pricing proposal mirrors into the company proposal ledger",
  );

  await resolveCompanyPricingProposal(company.id, pricing.id, "approve", "Evidence is strong.");
  ledger = await listCompanyRuns(company.id);
  assert.equal(
    ledger.proposals.find((proposal) => proposal.id === pricing.id)?.status,
    "applied",
    "approved pricing proposal is settled as applied",
  );

  await addCompanyDirective(company.id, {
    text: "Use real client photos before sending previews.",
    source: "reject",
    deliverableRef: "Sarasota demo preview",
  });
  ledger = await listCompanyRuns(company.id);
  assert.ok(
    ledger.proposals.some((proposal) => proposal.kind === "deliverable-redirect" && proposal.status === "applied"),
    "deliverable rejection creates an applied redirect proposal",
  );

  await recordCompanyRevenue({
    companyId: company.id,
    amountUsd: 500,
    source: "invoice",
    externalId: "inv-trace-1",
  });
  ledger = await listCompanyRuns(company.id);
  assert.ok(
    ledger.runs.some((item) => item.kind === "revenue" && item.status === "completed"),
    "revenue recording creates a completed run",
  );
  assert.ok(
    ledger.proposals.some((proposal) => proposal.kind === "revenue-share" && proposal.status === "applied"),
    "revenue recording creates an applied revenue proposal",
  );

  const replay = await requestCompanyRunReplay({ companyId: company.id, runId: run.id, requestedBy: "test" });
  assert.equal(replay.kind, "replay");
  assert.equal(replay.status, "pending");
  ledger = await listCompanyRuns(company.id);
  assert.ok(ledger.proposals.some((proposal) => proposal.id === replay.id), "replay request lands in proposals");

  console.log("company runs suite passed");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);
