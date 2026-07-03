#!/usr/bin/env node
// Hermetic coverage for the zero-human-company autonomy layer:
// - pending-task deadlock fix (scoped idle check + pending routing)
// - durable company memory (append/read/digest/idempotent outcome sync)
// - generic metric-update rail (derived progress, revenue, memory record)
// - escalation notify dedupe state
// - memory-aware planner prompt
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-company-autonomy-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-company-autonomy-vault-"));
process.env.HOME = tempHome;
process.env.QUEEN_BEE_AUTONOMOUS_PICKUP = "0"; // routing must not fire network pickups in tests

const { companyHasActiveWork } = await import("../src/lib/services/company-autonomy-driver.ts");
const {
  isRoutablePendingQueenBeeTask,
  isRedispatchableReadyTask,
  routePendingQueenBeeTasks,
} = await import("../src/lib/services/queen-bee/control-plane.ts");
const {
  appendCompanyMemory,
  companyMemoryDigest,
  readCompanyMemory,
  syncCompanyTaskOutcomes,
} = await import("../src/lib/services/company-memory.ts");
const { parseMetricNumber, updateCompanyMetric, upsertCompany } = await import("../src/lib/services/companies-store.ts");
const { notifyEscalation, ESCALATION_STATE_PATH } = await import("../src/lib/services/messaging/escalation-notify.ts");
const { userPrompt } = await import("../src/lib/services/companies-goal-planner.ts");
const { createTask, readBoard, completeTask } = await import("../src/lib/services/kanban/local-kanban-store.ts");

const kanbanOptions = { vaultPath, kanbanFolder: "Operations/Work Board" };

try {
  // ── companyHasActiveWork: the cross-company deadlock regression ──────────
  const idents = new Set(["hermes-alpha"]);
  const companyId = "co-one";
  assert.equal(
    companyHasActiveWork([{ status: "ready", assignee: "queen-bee", source: "company:co-two:r1" }], idents, companyId),
    false,
    "another company's pending task must NOT freeze this company",
  );
  assert.equal(
    companyHasActiveWork([{ status: "ready", assignee: "queen-bee", source: "company:co-one:r1" }], idents, companyId),
    true,
    "this company's own pending task counts as active work",
  );
  assert.equal(
    companyHasActiveWork([{ status: "working", assignee: "hermes-alpha", source: "queen-bee" }], idents, companyId),
    true,
    "work delegated to a member counts",
  );
  assert.equal(
    companyHasActiveWork([{ status: "done", assignee: "hermes-alpha", source: "company:co-one:r1" }], idents, companyId),
    false,
    "finished work does not count",
  );

  // ── pending predicate ─────────────────────────────────────────────────────
  const oldEnough = Date.now() - 10 * 60_000;
  assert.equal(
    isRoutablePendingQueenBeeTask({ status: "ready", assignee: "queen-bee", source: "company:co:r", loop: undefined, updatedAt: oldEnough }, Date.now()),
    true,
    "idle pending company task is routable",
  );
  assert.equal(
    isRoutablePendingQueenBeeTask({ status: "ready", assignee: "queen-bee", source: "company:co:r", loop: undefined, updatedAt: Date.now() }, Date.now()),
    false,
    "freshly-created pending task is left for the submit path",
  );
  assert.equal(
    isRoutablePendingQueenBeeTask({ status: "ready", assignee: "hermes-alpha", source: "company:co:r", loop: undefined, updatedAt: oldEnough }, Date.now()),
    false,
    "already-delegated task is not pending",
  );
  assert.equal(
    isRoutablePendingQueenBeeTask({ status: "ready", assignee: "queen-bee", source: "manual", loop: undefined, updatedAt: oldEnough }, Date.now()),
    false,
    "non-autonomous sources are not swept",
  );

  // ── routePendingQueenBeeTasks: pending task gets delegated when fleet returns ──
  const created = await createTask(null, {
    title: "Research Sarasota candidates",
    body: "Find candidate businesses.",
    status: "ready",
    priority: "high",
    workspace: "scratch",
    assignee: "queen-bee",
    source: "company:co-one:r1",
    skills: ["company-goal", "research"],
    targetMachine: null,
  }, kanbanOptions);
  assert.equal(created.task.assignee, "queen-bee", "fixture task starts pending");

  // Fleet has the company MEMBER plus a non-member (a Venice-style outsider). The
  // pending company task must route ONLY to the member — never the outsider.
  const fleet = [{
    key: "test-machine",
    device: { name: "Test Machine", online: true, collectorUrl: "http://127.0.0.1:9/collector" },
    agents: [
      { id: "hermes-alpha", name: "hermes-alpha", runtime: "hermes" },
      { id: "venice-outsider", name: "VeniceAgent", runtime: "hermes" },
    ],
  }];
  const companyMembers = new Map([["co-one", new Set(["hermes-alpha"])]]);
  await routePendingQueenBeeTasks(fleet, { ...kanbanOptions, now: Date.now() + 10 * 60_000, companyMembers });
  const boardAfter = await readBoard(null, kanbanOptions);
  const routedTask = boardAfter.tasks.find((task) => task.id === created.task.id);
  assert.equal(routedTask.assignee, "hermes-alpha", "pending company task routes ONLY to a staffed member, not the outsider");
  assert.equal(routedTask.targetMachine?.collectorUrl, "http://127.0.0.1:9/collector", "delegation records the collector url");
  assert.equal(
    isRedispatchableReadyTask({ ...routedTask, updatedAt: Date.now() - 10 * 60_000 }, Date.now()),
    true,
    "a routed pending task becomes re-dispatchable by the stranded-task recovery",
  );

  // A company with NO online members must NOT leak its task to an outsider — it stays pending.
  const orphan = await createTask(null, {
    title: "Orphan company task", body: "no members online", status: "ready", priority: "high",
    workspace: "scratch", assignee: "queen-bee", source: "company:co-empty:r1", skills: ["company-goal"], targetMachine: null,
  }, kanbanOptions);
  await routePendingQueenBeeTasks(fleet, { ...kanbanOptions, now: Date.now() + 10 * 60_000, companyMembers: new Map([["co-empty", new Set(["nobody-here"])]]) });
  const orphanAfter = (await readBoard(null, kanbanOptions)).tasks.find((t) => t.id === orphan.task.id);
  assert.equal(orphanAfter.assignee, "queen-bee", "a company task with no online members stays pending, never routed to an outsider");

  // ── company memory: append / read / digest / idempotent sync ──────────────
  await appendCompanyMemory("co-one", { kind: "note", title: "Company launched", detail: "First cycle." });
  const companies = [{ id: "co-one", name: "Co One", agentIds: ["hermes-alpha"], frozen: false, createdAt: "", createdAtMs: 0, updatedAt: "" }];
  const boardTasks = [
    { id: "t-done", title: "Email 5 leads", status: "done", source: "company:co-one:r1", result: "Sent 5 personalized emails.", assignee: "hermes-alpha", completedAt: Date.now() },
    { id: "t-blocked", title: "Buy domain", status: "needs-human", source: "company:co-one:r1", result: "Needs card approval.", assignee: "hermes-alpha", updatedAt: Date.now() },
    { id: "t-foreign", title: "Unrelated", status: "done", source: "queen-bee", result: "n/a", assignee: "someone", completedAt: Date.now() },
  ];
  const first = await syncCompanyTaskOutcomes(companies, boardTasks);
  const second = await syncCompanyTaskOutcomes(companies, boardTasks);
  assert.equal(first, 2, "both company task outcomes recorded once");
  assert.equal(second, 0, "outcome sync is idempotent");
  const records = await readCompanyMemory("co-one");
  assert.equal(records.filter((record) => record.taskId).length, 2, "memory holds exactly the two outcomes");
  const digest = await companyMemoryDigest("co-one");
  assert.match(digest, /DONE: Email 5 leads/, "digest carries completions");
  assert.match(digest, /BLOCKED: Buy domain/, "digest carries blocked work");

  // ── metric rail: derived progress + revenue + memory trail ────────────────
  assert.equal(parseMetricNumber("$1,234.50"), 1234.5);
  assert.equal(parseMetricNumber("12k"), 12000);
  assert.equal(parseMetricNumber("not-a-number"), null);
  const company = await upsertCompany({
    name: "Metric Co",
    agentIds: ["hermes-alpha"],
    apexGoal: { title: "Reach 30k weekly revenue", metric: "Weekly Revenue", target: "30k" },
  });
  const updated = await updateCompanyMetric(company.id, { current: "12k", revenueValue: "$12,000", source: "test-suite" });
  assert.equal(updated.apexGoal.current, "12k");
  assert.equal(updated.apexGoal.progress, 40, "progress derived from current/target");
  assert.equal(updated.revenue.value, "$12,000", "revenue headline created");
  const metricRecords = await readCompanyMemory(company.id);
  assert.equal(metricRecords.at(-1).kind, "metric", "metric update recorded in company memory");

  // ── escalation dedupe: one send per key per TTL ───────────────────────────
  await notifyEscalation({ key: "test:dedupe", title: "Test", body: "Body", severity: "high" });
  const stateAfterFirst = JSON.parse(await readFile(ESCALATION_STATE_PATH, "utf8"));
  const firstStamp = stateAfterFirst.sent["test:dedupe"];
  assert.ok(typeof firstStamp === "number" && firstStamp > 0, "first escalation records its dedupe key");
  await notifyEscalation({ key: "test:dedupe", title: "Test", body: "Body", severity: "high" });
  const stateAfterSecond = JSON.parse(await readFile(ESCALATION_STATE_PATH, "utf8"));
  assert.equal(stateAfterSecond.sent["test:dedupe"], firstStamp, "second escalation within TTL is suppressed");

  // ── planner prompt: history section present with guidance ─────────────────
  const prompt = userPrompt(
    { id: "x", name: "Co", agentIds: [], frozen: false, createdAt: "", createdAtMs: 0, updatedAt: "", apexGoal: { title: "Goal" } },
    "[2026-07-02] DONE: Emailed 5 leads",
  );
  assert.match(prompt, /Recent company activity \(newest first\):/, "prompt includes history header");
  assert.match(prompt, /Emailed 5 leads/, "prompt includes history lines");

  // ── deliverable hygiene: fabricated URLs + route patterns are NOT extracted ──
  const realFile = join(vaultPath, "leads.csv");
  await (await import("node:fs/promises")).writeFile(realFile, "name,site\nGinza,none\n");
  const dtask = await createTask(null, {
    title: "Deploy demo pipeline", status: "ready", priority: "normal", workspace: "scratch",
    assignee: "hermes-alpha", source: "company:co-hy:r1",
    targetMachine: { key: "m", name: "Test Machine", collectorUrl: "http://127.0.0.1:9/c" },
  }, kanbanOptions);
  // A real vault path WITH SPACES ("Work Board", "Brain Services") must survive —
  // vault/macOS folders legitimately contain spaces (regression 2026-07-02).
  const spacedVaultFile = "/root/Documents/Obsidian/hivemindos-vault/Operations/Brain Services/Queen Bee/leads-report.md";
  await completeTask(null, dtask.task.id, {
    result: [
      "Deliverables:",
      "- paid checkout: https://demo.sarasota-sites.example/paid?session_id=mock_123&lead=ginza",
      "- preview route: /preview/:slug",
      "- real leads file: " + realFile,
      "- vault report: " + spacedVaultFile,
      "- live worker: https://sarasota-demo-pipeline.hivemindos.workers.dev",
    ].join("\n"),
  }, kanbanOptions);
  const dboard = await readBoard(null, kanbanOptions);
  const done = dboard.tasks.find((t) => t.id === dtask.task.id);
  const targets = (done.deliverables ?? []).map((d) => d.url || d.path);
  assert.ok(!targets.some((t) => (t || "").includes(".example")), "fabricated .example URL must not be a deliverable");
  assert.ok(!targets.some((t) => (t || "").includes("/preview/:slug")), "route pattern must not be a deliverable");
  assert.ok(targets.includes(realFile), "the real file path IS extracted as a deliverable");
  assert.ok(targets.includes(spacedVaultFile), "a real vault path with spaces IS kept as a deliverable");
  assert.ok(targets.some((t) => (t || "").includes("workers.dev")), "the real live worker URL IS a deliverable");

  // ── driver lease: exactly one active driver per machine ─────────────────
  {
    const { acquireOrRenewCompanyDriverLease, releaseCompanyDriverLease, companyDriverLeaseDisabled } =
      await import("../src/lib/services/company-driver-lease.ts");
    const { writeFile: writeLease, readFile: readLease } = await import("node:fs/promises");
    const leaseFile = join(tempHome, ".hivemindos", "company-autonomy-driver.lease.json");
    process.env.HIVEMINDOS_COMPANY_DRIVER_LEASE_FILE = leaseFile;
    process.env.HIVEMINDOS_COMPANY_DRIVER_LEASE_STALE_MS = "60000";

    assert.equal(companyDriverLeaseDisabled(), false, "lease coordination is on by default");

    const first = await acquireOrRenewCompanyDriverLease();
    assert.equal(first.held, true, "a free lease is acquired");
    assert.equal(first.holder?.pid, process.pid, "acquired lease names this process");

    await new Promise((resolve) => setTimeout(resolve, 5));
    const renewed = await acquireOrRenewCompanyDriverLease();
    assert.equal(renewed.held, true, "re-acquiring our own lease renews it");
    assert.ok(renewed.holder.renewedAt >= first.holder.renewedAt, "renewal advances renewedAt");
    assert.equal(renewed.holder.startedAt, first.holder.startedAt, "renewal preserves startedAt");

    // A LIVE foreign holder (the parent process) keeps the lease.
    await writeLease(leaseFile, JSON.stringify({ pid: process.ppid, port: "5555", startedAt: Date.now(), renewedAt: Date.now() }) + "\n");
    const blocked = await acquireOrRenewCompanyDriverLease();
    assert.equal(blocked.held, false, "a live foreign holder keeps the lease");
    assert.equal(blocked.holder?.pid, process.ppid, "standby reports who holds the lease");

    await releaseCompanyDriverLease();
    assert.ok(
      (await readLease(leaseFile, "utf8")).includes(String(process.ppid)),
      "release never deletes another process's lease",
    );

    // A DEAD holder is replaced immediately, even with a fresh renewal stamp.
    await writeLease(leaseFile, JSON.stringify({ pid: 2147480000, port: "", startedAt: Date.now(), renewedAt: Date.now() }) + "\n");
    assert.equal((await acquireOrRenewCompanyDriverLease()).held, true, "a dead holder's lease is taken over");

    // A wedged-but-alive holder ages out via the staleness window.
    await writeLease(leaseFile, JSON.stringify({ pid: process.ppid, port: "", startedAt: 1, renewedAt: Date.now() - 61_000 }) + "\n");
    assert.equal((await acquireOrRenewCompanyDriverLease()).held, true, "a stale holder's lease is taken over");

    // A corrupt lease file self-heals.
    await writeLease(leaseFile, "not json\n");
    assert.equal((await acquireOrRenewCompanyDriverLease()).held, true, "a corrupt lease file is replaced");

    await releaseCompanyDriverLease();
    const gone = await readLease(leaseFile, "utf8").then(() => false).catch(() => true);
    assert.ok(gone, "releasing our own lease removes the file");

    process.env.HIVEMINDOS_COMPANY_DRIVER_LEASE = "0";
    assert.equal(companyDriverLeaseDisabled(), true, "HIVEMINDOS_COMPANY_DRIVER_LEASE=0 disables coordination");
    delete process.env.HIVEMINDOS_COMPANY_DRIVER_LEASE;
  }

  console.log("company autonomy suite passed");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);
