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
  addCompanyMembers,
  addCompanyDirective,
  claimCompanyHomeMachine,
  companyRunsOnThisMachine,
  CompaniesFileCorruptError,
  deleteCompany,
  getCompany,
  markCompanyDispatched,
  readCompanies,
  setCompanyAgents,
  setCompanyApprovalPolicy,
  setCompanyProducts,
  updateCompanyMetric,
  upsertCompany,
} = await import("../src/lib/services/companies-store.ts");
const { ensureCompanyProductsSeeded, extractPricingProposalMarkers } = await import("../src/lib/services/company-products.ts");
const { proposeCompanyPricingChange, resolveCompanyPricingProposal } = await import("../src/lib/services/companies-store.ts");
const { companyWorkerContext } = await import("../src/lib/services/companies-orchestration.ts");
const membershipModule = await import("../src/lib/services/company-membership.ts");
const { readCompanyMemory, syncCompanyTaskOutcomes } = await import("../src/lib/services/company-memory.ts");
const { readCompanyConfigHistory } = await import("../src/lib/services/company-governance.ts");
const { submitQueenBeeMessage } = await import("../src/lib/services/queen-bee/control-plane.ts");
const { readBoard } = await import("../src/lib/services/kanban/local-kanban-store.ts");
const { appendSpend } = await import("../src/lib/services/wallet/spend-ledger.ts");
const { evaluateSpend, resolveSpendGovernance } = await import("../src/lib/services/wallet/spend-governance.ts");
const { createTask } = await import("../src/lib/services/kanban/local-kanban-store.ts");

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

  // ── membership identity: one operational agent belongs to one company ────
  const exclusiveOwner = await upsertCompany({ name: "Exclusive Owner", agentIds: ["shared-agent"] });
  await assert.rejects(
    upsertCompany({ name: "Rejected Shared Identity", agentIds: ["shared-agent"] }),
    /already belongs to .*Exclusive Owner.*Duplicate the agent/i,
    "creating a second company with the same operational agent identity is rejected",
  );
  const exclusiveCandidate = await upsertCompany({ name: "Exclusive Candidate" });
  await assert.rejects(
    addCompanyMembers(exclusiveCandidate.id, [{ agentId: "shared-agent" }]),
    /already belongs to .*Exclusive Owner.*Duplicate the agent/i,
    "add-members rejects an agent identity already owned by another company",
  );
  await assert.rejects(
    setCompanyAgents(exclusiveCandidate.id, ["shared-agent"]),
    /already belongs to .*Exclusive Owner.*Duplicate the agent/i,
    "set-agents rejects an agent identity already owned by another company",
  );
  const ownerStillValid = await setCompanyAgents(exclusiveOwner.id, ["shared-agent"]);
  assert.deepEqual(ownerStillValid.agentIds, ["shared-agent"], "saving the existing owner is still allowed");
  assert.deepEqual((await getCompany(exclusiveCandidate.id)).agentIds, [], "rejected membership never mutates the target company");
  assert.equal(typeof membershipModule.companyMembershipOwners, "function", "membership module exposes the ownership map used by the company picker");
  const membershipOwners = membershipModule.companyMembershipOwners(await readCompanies());
  assert.deepEqual(
    membershipOwners.get("shared-agent"),
    [{ id: exclusiveOwner.id, name: "Exclusive Owner" }],
    "the picker can explain which company owns an unavailable agent identity",
  );
  assert.equal(typeof membershipModule.findDuplicateCompanyMemberships, "function", "membership module exposes manual-edit conflict detection");
  assert.deepEqual(
    membershipModule.findDuplicateCompanyMemberships([
      { id: "co-a", name: "A", agentIds: ["duplicate-agent"] },
      { id: "co-b", name: "B", agentIds: ["duplicate-agent"] },
      { id: "co-c", name: "C", agentIds: ["unique-agent"] },
    ]),
    [{ agentId: "duplicate-agent", companies: [{ id: "co-a", name: "A" }, { id: "co-b", name: "B" }] }],
    "manual duplicate membership is reported without hiding the rest of the portfolio",
  );
  const companyPickerSource = await readFile(new URL("../src/features/dashboard/views/zero-human-companies/Modals.tsx", import.meta.url), "utf8");
  assert.match(companyPickerSource, /Assigned to/, "company picker names the existing owner instead of offering an unsafe add");
  assert.match(companyPickerSource, /Duplicate agent/, "company picker offers the established safe identity-duplication path");
  const companiesRouteSource = await readFile(new URL("../src/app/api/companies/route.ts", import.meta.url), "utf8");
  assert.match(companiesRouteSource, /CompanyMembershipConflictError/, "companies API recognizes exclusive-membership conflicts");
  assert.match(companiesRouteSource, /error\.status/, "companies API returns the conflict status instead of a generic bad request");
  const founderRouteSource = await readFile(new URL("../src/app/api/founder/route.ts", import.meta.url), "utf8");
  assert.match(founderRouteSource, /companyMembershipOwners/, "Founder Mode excludes identities already owned by a company");
  assert.match(founderRouteSource, /unassignedProfiles/, "Founder Mode compiles its crew only from unassigned operational identities");
  const companyDocs = await readFile(new URL("../docs/for-users/features/zero-human-companies.md", import.meta.url), "utf8");
  assert.match(companyDocs, /one company at a time/i, "public docs state the operational identity boundary");
  assert.match(companyDocs, /duplicate agent/i, "public docs explain how to reuse an agent blueprint safely");

  // The member-level company cap shown in the crew picker is a real hard guard,
  // not presentation-only. With $8 already spent, a $3 request exceeds a $10 cap.
  await setCompanyAgents(exclusiveOwner.id, [], [{ agentId: "shared-agent", companyCap: 10 }]);
  await appendSpend({
    agentId: "shared-agent",
    companyId: exclusiveOwner.id,
    kind: "api",
    asset: "USDC",
    amountUsd: 8,
    status: "executed",
  });
  const memberCapDecision = await evaluateSpend({
    wallet: { agentId: "shared-agent", approvalRequiredOverUsd: 0 },
    kind: "api",
    asset: "USDC",
    amountUsd: 3,
    companyId: exclusiveOwner.id,
  });
  assert.equal(memberCapDecision.decision, "block", "company member daily cap blocks excess spend");
  assert.match(memberCapDecision.reason, /company member daily budget/i, "member-cap block explains the governing company-specific limit");
  await appendSpend({
    agentId: "shared-agent",
    kind: "x402",
    asset: "USDC",
    amountUsd: 50,
    status: "executed",
  });
  const unrelatedSpendDecision = await evaluateSpend({
    wallet: { agentId: "shared-agent", approvalRequiredOverUsd: 0 },
    kind: "api",
    asset: "USDC",
    amountUsd: 1,
    companyId: exclusiveOwner.id,
  });
  assert.equal(
    unrelatedSpendDecision.decision,
    "allow",
    "a member's personal or unrelated spend does not consume the company-specific member cap",
  );
  const walletOnlySpendDecision = await evaluateSpend({
    wallet: { agentId: "shared-agent", approvalRequiredOverUsd: 0 },
    kind: "x402",
    asset: "USDC",
    amountUsd: 50,
  });
  assert.equal(
    walletOnlySpendDecision.decision,
    "allow",
    "a wallet-only product action does not inherit company member budgets",
  );
  assert.equal(walletOnlySpendDecision.companyId, undefined, "wallet-only spend is never tagged to a company");
  const companyTask = await createTask(null, {
    title: "Company spend context",
    status: "working",
    assignee: "shared-agent",
    source: `company:${exclusiveOwner.id}:run-test`,
  }, { vaultPath });
  const companyTaskGovernance = await resolveSpendGovernance("shared-agent", { companyTaskId: companyTask.task.id });
  assert.equal(companyTaskGovernance?.companyId, exclusiveOwner.id, "active company task resolves explicit company governance");
  await assert.rejects(
    resolveSpendGovernance("shared-agent", { companyTaskId: "missing-task" }),
    /does not exist/i,
    "invented company task ids fail closed",
  );
  const inactiveCompanyTask = await createTask(null, {
    title: "Inactive company spend context",
    status: "ready",
    assignee: "shared-agent",
    source: `company:${exclusiveOwner.id}:run-test`,
  }, { vaultPath });
  await assert.rejects(
    resolveSpendGovernance("shared-agent", { companyTaskId: inactiveCompanyTask.task.id }),
    /actively working/i,
    "inactive company tasks cannot attach company restrictions",
  );
  const ordinaryTask = await createTask(null, {
    title: "Ordinary product work",
    status: "working",
    assignee: "shared-agent",
    source: "chat:test",
  }, { vaultPath });
  await assert.rejects(
    resolveSpendGovernance("shared-agent", { companyTaskId: ordinaryTask.task.id }),
    /not company work/i,
    "ordinary Work Board tasks cannot be mislabeled as company work",
  );
  const otherAgentCompanyTask = await createTask(null, {
    title: "Another agent's company spend context",
    status: "working",
    assignee: "different-agent",
    source: `company:${exclusiveOwner.id}:run-test`,
  }, { vaultPath });
  await assert.rejects(
    resolveSpendGovernance("shared-agent", { companyTaskId: otherAgentCompanyTask.task.id }),
    /not assigned to this wallet agent/i,
    "an agent cannot borrow another agent's active company task context",
  );

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

  // ── standing directives: multi-skill browser selections persist + reach worker context ──
  const withDirective = await addCompanyDirective("co-legacy-1", {
    text: "Use the new portfolio offer flow.",
    skills: ["self-serve-payment-funnel", "liam-writing-style", " self-serve-payment-funnel "],
    skill: "startup-customer-acquisition-sprint",
  });
  const directive = withDirective.directives.at(-1);
  assert.deepEqual(
    directive.skills,
    ["self-serve-payment-funnel", "liam-writing-style", "startup-customer-acquisition-sprint"],
    "directive skills are deduped and keep the legacy single skill",
  );
  assert.equal(directive.skill, "self-serve-payment-funnel", "legacy first-skill field stays populated");
  const directiveContext = companyWorkerContext(withDirective, "");
  assert.ok(
    directiveContext.includes("use skills: self-serve-payment-funnel, liam-writing-style, startup-customer-acquisition-sprint"),
    "worker context lists every directive skill",
  );

  const withApprovalPolicy = await setCompanyApprovalPolicy("co-legacy-1", {
    id: "customer-email-send",
    subject: "sending customer-facing emails",
    mode: "ask",
    source: "default",
  });
  assert.equal(withApprovalPolicy.approvalPolicies?.[0]?.mode, "ask", "approval policy is saved on the company");
  const definitionWithPolicy = (await readJson(definitionsFile)).find((record) => record.id === "co-legacy-1");
  assert.equal(
    definitionWithPolicy.approvalPolicies?.[0]?.mode,
    "ask",
    "approval policies replicate in the cold company definitions file",
  );
  assert.ok(
    companyWorkerContext(withApprovalPolicy, "").includes("Before sending customer-facing emails, ask the human first"),
    "approval policies reach the worker context after persistence",
  );

  const history = await readCompanyConfigHistory({ companyId: "co-legacy-1" });
  const updated = history.filter((entry) => entry.action === "updated").find((entry) => entry.changedFields.includes("charter"));
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

  // ── products: catalog persists in the replicated definitions + reaches agents ──
  const shop = await upsertCompany({ name: "Catalog Co", sector: "Web Development" });
  const withProducts = await setCompanyProducts(shop.id, {
    items: [
      { key: "", name: "Standard Site", amountUsd: 3000, recommended: true, description: "Full site." },
      { name: "Care Plan", amountUsd: 99.999, interval: "month", kind: "addon" },
      { name: "", amountUsd: 500 }, // no name → dropped
      { name: "Bad Price", amountUsd: "not-a-number" }, // invalid price → dropped
    ],
  });
  assert.equal(withProducts.products.items.length, 2, "invalid product rows are dropped");
  assert.equal(withProducts.products.items[0].key, "standard-site", "missing key is slugged from the name");
  assert.equal(withProducts.products.items[1].amountUsd, 100, "prices round to cents");

  // At most ONE recommended per group (packages / add-ons) — first wins.
  const multiRecommended = await setCompanyProducts(shop.id, {
    items: [
      { name: "Pack A", amountUsd: 100, recommended: true },
      { name: "Pack B", amountUsd: 200, recommended: true },
      { name: "Addon A", amountUsd: 10, kind: "addon", recommended: true },
      { name: "Addon B", amountUsd: 20, kind: "addon", recommended: true },
    ],
  });
  assert.deepEqual(
    multiRecommended.products.items.map((item) => item.recommended === true),
    [true, false, true, false],
    "extra recommended flags clear per group; the first marked one wins",
  );
  await setCompanyProducts(shop.id, {
    items: [
      { key: "standard-site", name: "Standard Site", amountUsd: 3000, recommended: true, description: "Full site." },
      { key: "care-plan", name: "Care Plan", amountUsd: 100, interval: "month", kind: "addon" },
    ],
  });
  const productDefs = await readJson(definitionsFile);
  const shopDef = productDefs.find((entry) => entry.id === shop.id);
  assert.equal(shopDef.products.items.length, 2, "catalog replicates via the vault definitions file");
  const productContext = companyWorkerContext(withProducts, "");
  assert.ok(productContext.includes("Standard Site (key: standard-site) — $3,000 (recommended default)"), "worker context quotes the catalog");
  assert.ok(productContext.includes("Care Plan (key: care-plan) — $100/mo (add-on)"), "worker context marks recurring add-ons");
  const productHistory = await readCompanyConfigHistory({ companyId: shop.id });
  assert.ok(
    productHistory.some((entry) => (entry.changedFields ?? []).includes("products")),
    "catalog writes land in the governance trail",
  );

  // Emptied catalog keeps its marker → never re-seeded behind the human's back.
  const emptied = await setCompanyProducts(shop.id, { items: [] });
  assert.equal(emptied.products.items.length, 0, "catalog can be emptied");
  assert.ok(emptied.products.seededFrom, "emptied catalog keeps its seed marker");
  const notReseeded = await ensureCompanyProductsSeeded(emptied);
  assert.equal(notReseeded.products.items.length, 0, "an emptied catalog is not re-seeded");

  // ── pricing proposals: crew-raised requests → Approvals → human decision → memory ──
  const markers = extractPricingProposalMarkers(
    [
      "Analyzed 14 replies; 9 cited cost.",
      "PRICING PROPOSAL: standard-site $2,400",
      "WHY: 9 of 14 replies called $3,000 too expensive; two cited competitor quotes near $2,500.",
      "PRICING PROPOSAL: Care Plan -> $79/mo",
      "some trailing text",
    ].join("\n"),
  );
  assert.equal(markers.length, 2, "both marker lines parse");
  assert.deepEqual(markers[0], {
    productRef: "standard-site",
    amountUsd: 2400,
    why: "9 of 14 replies called $3,000 too expensive; two cited competitor quotes near $2,500.",
  });
  assert.equal(markers[1].productRef, "Care Plan", "name-based reference parses");
  assert.equal(markers[1].amountUsd, 79, "arrow + /mo cadence suffix parses");

  assert.equal(
    await proposeCompanyPricingChange(shop.id, { productRef: "standard-site", proposedAmountUsd: 2400 }),
    null,
    "no proposal against an emptied catalog",
  );
  await setCompanyProducts(shop.id, {
    items: [
      { key: "standard-site", name: "Standard Site", amountUsd: 3000, recommended: true },
      { key: "care-plan", name: "Care Plan", amountUsd: 99, interval: "month", kind: "addon" },
    ],
  });
  assert.equal(
    await proposeCompanyPricingChange(shop.id, { productRef: "standard-site", proposedAmountUsd: 3000 }),
    null,
    "same-price proposal is a no-op",
  );
  assert.equal(
    await proposeCompanyPricingChange(shop.id, { productRef: "no-such-product", proposedAmountUsd: 100 }),
    null,
    "unknown product reference is skipped",
  );

  // A finished company task carrying markers files proposals EXACTLY once.
  const proposalTask = {
    id: "t-pricing-1",
    title: "Review pricing evidence",
    status: "done",
    source: `company:${shop.id}:run-9`,
    assignee: "hermes-ada",
    result: "Reviewed replies.\nPRICING PROPOSAL: standard-site $2,400\nWHY: 9 of 14 replies said too expensive.",
    completedAt: Date.now(),
  };
  await syncCompanyTaskOutcomes([await getCompany(shop.id)], [proposalTask]);
  let pricingCo = await getCompany(shop.id);
  assert.equal(pricingCo.pricingProposals?.length, 1, "marker in a done task files one proposal");
  assert.equal(pricingCo.pricingProposals[0].productKey, "standard-site");
  assert.equal(pricingCo.pricingProposals[0].proposedAmountUsd, 2400);
  assert.equal(pricingCo.pricingProposals[0].sourceTaskId, "t-pricing-1");
  assert.equal(pricingCo.pricingProposals[0].proposedBy, "hermes-ada");
  await syncCompanyTaskOutcomes([pricingCo], [proposalTask]);
  pricingCo = await getCompany(shop.id);
  assert.equal(pricingCo.pricingProposals?.length, 1, "re-syncing the same task does not duplicate the proposal");

  // A newer proposal for the same product replaces the pending one.
  await proposeCompanyPricingChange(shop.id, { productRef: "Standard Site", proposedAmountUsd: 2200, why: "fresher evidence" });
  pricingCo = await getCompany(shop.id);
  assert.equal(pricingCo.pricingProposals?.length, 1, "one pending proposal per product");
  assert.equal(pricingCo.pricingProposals[0].proposedAmountUsd, 2200, "newest proposal wins");

  // Pending proposals ride the replicated definitions + the worker context.
  const pricingDefs = await readJson(definitionsFile);
  assert.equal(pricingDefs.find((entry) => entry.id === shop.id).pricingProposals.length, 1, "proposals replicate via the vault");
  const pendingContext = companyWorkerContext(pricingCo, "");
  assert.ok(pendingContext.includes("already awaiting the human's decision"), "worker context lists pending proposals");
  assert.ok(pendingContext.includes("PRICING PROPOSAL:"), "worker context teaches the marker protocol");

  // Reject: price unchanged, proposal removed, decision recorded for the crew.
  const rejectId = pricingCo.pricingProposals[0].id;
  const rejected = await resolveCompanyPricingProposal(shop.id, rejectId, "reject");
  assert.equal(rejected.pricingProposals?.length ?? 0, 0, "rejected proposal is removed");
  assert.equal(rejected.products.items.find((item) => item.key === "standard-site").amountUsd, 3000, "reject keeps the price");

  // Approve: the catalog (the shared-brain price every agent quotes) changes.
  const approveTarget = await proposeCompanyPricingChange(shop.id, { productRef: "care-plan", proposedAmountUsd: 79, why: "add-on stalls at $99" });
  const approved = await resolveCompanyPricingProposal(shop.id, approveTarget.id, "approve");
  assert.equal(approved.products.items.find((item) => item.key === "care-plan").amountUsd, 79, "approve applies the new price");
  assert.equal(approved.pricingProposals?.length ?? 0, 0, "approved proposal is removed");
  const pricingMemory = await readCompanyMemory(shop.id);
  assert.ok(pricingMemory.some((entry) => entry.title.startsWith("Pricing change requested")), "request lands in company memory");
  assert.ok(pricingMemory.some((entry) => entry.title.startsWith("Pricing change rejected")), "rejection lands in company memory");
  assert.ok(pricingMemory.some((entry) => entry.title.startsWith("Pricing approved")), "approval lands in company memory");

  // ── repo seeding: a never-configured company inherits the repo's default pricing once ──
  const repoDir = await mkdtemp(join(tmpdir(), "hivemind-company-pricing-repo-"));
  await mkdir(join(repoDir, "config"), { recursive: true });
  await writeFile(
    join(repoDir, "config", "pricing.json"),
    JSON.stringify({ packages: [{ name: "Repo Starter", price: "$1,500", recommended: true }] }),
  );
  await mkdir(join(vaultPath, "Operations", "Code Projects"), { recursive: true });
  await writeFile(
    join(vaultPath, "Operations", "Code Projects", "projects.json"),
    JSON.stringify({ projects: [{ id: "pricing-repo-1", name: "Pricing Repo", localPath: repoDir }], updatedAt: Date.now() }),
  );
  const seedable = await upsertCompany({ name: "Repo Seeded Co", projectId: "pricing-repo-1" });
  const seeded = await ensureCompanyProductsSeeded(seedable);
  assert.equal(seeded.products.items.length, 1, "repo pricing seeds the catalog");
  assert.equal(seeded.products.items[0].name, "Repo Starter");
  assert.equal(seeded.products.items[0].amountUsd, 1500, "loose $1,500 string parses");
  assert.equal(seeded.products.seededFrom, "repo:config/pricing.json", "seed provenance is recorded");
  const seededAgain = await ensureCompanyProductsSeeded(await getCompany(seedable.id));
  assert.equal(seededAgain.products.items.length, 1, "seeding is write-once");
  await rm(repoDir, { recursive: true, force: true }).catch(() => {});

  // ── delete: gone from the vault and NOT resurrected from the legacy backup ──
  assert.equal(await deleteCompany("co-legacy-1"), true);
  const afterDelete = await readCompanies();
  assert.equal(afterDelete.some((company) => company.id === "co-legacy-1"), false, "deleted company stays deleted despite the legacy file");
  const legacyStill = await readJson(join(tempHome, ".hivemindos", "companies.json"));
  assert.equal(legacyStill.length, 1, "legacy file is preserved as the rollback copy");
  const deletedHistory = await readCompanyConfigHistory({ companyId: "co-legacy-1" });
  assert.ok(deletedHistory.some((entry) => entry.action === "deleted"), "delete writes a history entry");

  // ── state integrity: rotated backups, corrupt file fails closed, bad records drop ──
  // A definitions write leaves a rotated backup so a bad overwrite is recoverable.
  await upsertCompany({ name: "Backup Probe Co" });
  const backupExists = await readFile(`${definitionsFile}.bak.0`, "utf8").then(() => true).catch(() => false);
  assert.ok(backupExists, "a definitions write leaves a rotated .bak.0 backup");

  // A malformed record (no id) is dropped; a record with an id but no name is kept
  // with a placeholder so the whole-portfolio read (.sort by name) can't crash.
  const goodDefs = await readJson(definitionsFile);
  await writeFile(definitionsFile, JSON.stringify([...goodDefs, { junk: true }, { id: "co-nameless-1" }], null, 2));
  const normalized = await readCompanies();
  assert.equal(normalized.some((company) => company.junk === true), false, "a record with no id is dropped on read");
  const nameless = normalized.find((company) => company.id === "co-nameless-1");
  assert.ok(nameless, "a record with an id but no name is kept, not dropped");
  assert.ok(typeof nameless.name === "string" && nameless.name.length > 0, "the kept record gets a sort-safe placeholder name");

  // A corrupt definitions file fails CLOSED: the read throws instead of returning
  // an empty portfolio, and the next write refuses to overwrite it — the exact
  // path that used to silently wipe (and Syncthing-replicate) the whole portfolio.
  await writeFile(definitionsFile, "{ not valid json ]");
  const corruptBytes = await readFile(definitionsFile, "utf8");
  await assert.rejects(
    readCompanies(),
    (error) => error instanceof CompaniesFileCorruptError,
    "a corrupt definitions file throws instead of reading as an empty portfolio",
  );
  await assert.rejects(
    upsertCompany({ name: "Should Not Persist" }),
    (error) => error instanceof CompaniesFileCorruptError,
    "a write refuses to overwrite a corrupt definitions file",
  );
  assert.equal(await readFile(definitionsFile, "utf8"), corruptBytes, "the corrupt file is left intact, not wiped");

  console.log("company vault store suite passed");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);
