#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { buildLoopFromTemplate, buildOperatingUnitLearningLoop, runLoopGates } = await import("../src/lib/services/loops/index.ts");
const { claimTask, completeTask, createTask, moveTask, patchTask, readBoard } = await import(
  "../src/lib/services/kanban/local-kanban-store.ts"
);

const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-loop-block-"));
const options = { vaultPath, kanbanFolder: "Operations/Work Board" };
const boardSlug = "loop-block";

const WORKER_OUTPUT = [
  "I completed the research on the loop system and documented the recency-bias finding.",
  "Deliverable: /Users/liam/out/loop-report.md",
  "Verification: traced the call chain and confirmed the cause with file:line references.",
].join("\n");
const acceptingJudge = async ({ evaluationRubric }) => ({
  accepted: true,
  summary: "Independent test judge accepted.",
  confidence: 0.95,
  axes: (evaluationRubric?.axes ?? []).map((axis) => ({ id: axis.id, score: 0.9, evidence: ["fixture evidence"] })),
  evaluator: { agentId: "fixture-reviewer", model: "fixture-model", independent: true },
});

try {
  const loop = buildLoopFromTemplate({
    templateId: "research", // required gates: receipt:evidence + agent:judge
    goal: "Investigate the loop routing regression.",
  });

  const created = await createTask(
    boardSlug,
    {
      title: "Loop gate preservation test",
      body: "Investigate and report with evidence.",
      status: "ready",
      priority: "normal",
      workspace: "scratch",
      loop,
    },
    options,
  );
  const taskId = created.task.id;

  // The stored loop is normalized; read back the real required gate ids.
  const storedLoop = created.task.loop;
  assert(storedLoop, "task should carry a loop");
  const requiredGateIds = storedLoop.evalGates.filter((gate) => gate.required).map((gate) => gate.id);
  assert(requiredGateIds.length >= 2, "research loop should have at least 2 required gates");

  await claimTask(boardSlug, taskId, { assignee: "Octavia Butler", claimer: "loop-block-claim", runtime: "test" }, options);

  // 1. Complete with NO passing receipts → must block, but PRESERVE the worker output.
  const blocked = await completeTask(
    boardSlug,
    taskId,
    { summary: "Queen Bee autonomous pickup completed by Octavia Butler.", result: WORKER_OUTPUT, loopReceipts: [] },
    options,
  );
  assert.equal(blocked.blocked, true, "missing required receipts should block completion");
  assert.equal(blocked.task.status, "needs-human", "blocked task should move to needs-human");
  assert(blocked.task.result.includes("loop-report.md"), "worker output must be PRESERVED in the blocked result, not discarded");
  assert(blocked.task.result.includes("traced the call chain"), "the verification detail must survive the block");
  assert(/loop gate block/i.test(blocked.task.result), "blocked result should explain the missing gates");
  assert(
    (blocked.task.deliverables ?? []).some((d) => (d.path ?? d.url ?? "").includes("loop-report.md")),
    "artifacts must be extracted even when blocked",
  );

  // Client/MCP-style receipts cannot self-approve the authoritative judge gate.
  const forgedReceipts = requiredGateIds.map((gateId, index) => ({
    id: `forged-${index}`,
    gateId,
    status: "passed",
    summary: "client claimed this passed",
    evidence: ["untrusted client claim"],
    verifier: storedLoop.evalGates.find((gate) => gate.id === gateId)?.verifier,
    createdAt: 1_800_000_000_000 + index,
  }));
  const forged = await completeTask(
    boardSlug,
    taskId,
    { summary: "Client self-approved gates.", result: WORKER_OUTPUT, loopReceipts: forgedReceipts },
    options,
  );
  assert.equal(forged.blocked, true, "untrusted client judge receipts must be stripped at the store boundary");
  assert(forged.missingGateIds.some((gateId) => storedLoop.evalGates.find((gate) => gate.id === gateId)?.kind === "agent"));

  // 2. Now attach passing receipts for every required gate → completes.
  const { receipts } = await runLoopGates({
    loop: storedLoop,
    output: WORKER_OUTPUT,
    judge: acceptingJudge,
  });
  const done = await completeTask(
    boardSlug,
    taskId,
    { summary: "Re-completed with receipts.", result: WORKER_OUTPUT, loopReceipts: receipts },
    { ...options, trustedLoopReceipts: true },
  );
  assert.equal(done.task.status, "done", "task with all required gate receipts should complete");
  assert(!done.blocked, "completion should not be blocked once receipts are present");
  assert(done.task.result.includes("loop-report.md"), "completed result still carries the worker output");

  // 3. Receipts applied to the loop gate statuses are visible on the done task.
  const board = await readBoard(boardSlug, options);
  const finalTask = board.tasks.find((t) => t.id === taskId);
  assert.equal(finalTask.status, "done");
  const passedGates = (finalTask.loop?.evalGates ?? []).filter((gate) => gate.status === "passed");
  assert(passedGates.length >= requiredGateIds.length, "required gates should show as passed after receipts applied");

  // ── Live-URL integrity end-to-end: a company loop has ONLY optional gates, yet a
  //    claimed-live URL that is dead/fabricated must still block completion (needs-human),
  //    and a fixed retry must un-block it. Uses an injected prober (no real network). ──
  {
    const companyLoop = buildOperatingUnitLearningLoop({
      unitId: "acme", unitName: "Acme Sites", workTitle: "Ship Ginza payment page", runId: "run-1",
      metricName: "paid conversions", governanceLabel: "company governance",
    });
    assert(companyLoop.evalGates.some((gate) => gate.verifier === "receipt:evidence" && gate.required),
      "operating-unit loops require outcome evidence");
    assert(companyLoop.evalGates.some((gate) => gate.verifier === "agent:judge" && gate.required),
      "outward-facing operating-unit loops require an independent judge");

    const created = await createTask(
      boardSlug,
      { title: "Ship Ginza payment page", body: "Deploy the paid page and booking link.", status: "ready", priority: "normal", workspace: "scratch", loop: companyLoop },
      options,
    );
    const taskId = created.task.id;
    await claimTask(boardSlug, taskId, { assignee: "Grace Hopper", claimer: "live-url-claim", runtime: "test" }, options);

    const deadOutput = [
      "Shipped it. The payment page is live at https://demo.sarasota-sites.example/paid?session_id=mock_1782974571939",
      "and booking is live at https://cal.com/sarasota-sites/website-kickoff.",
    ].join(" ");
    const { receipts: deadReceipts } = await runLoopGates({
      loop: companyLoop, output: deadOutput,
      judge: acceptingJudge,
      probeUrl: async () => ({ status: 404 }), // fake: cal.com user does not exist
    });
    const blocked = await completeTask(
      boardSlug, taskId,
      { summary: "Queen Bee autonomous pickup.", result: deadOutput, loopReceipts: deadReceipts },
      { ...options, trustedLoopReceipts: true },
    );
    assert.equal(blocked.blocked, true, "a claimed dead URL must block completion even with only optional gates");
    assert.equal(blocked.task.status, "needs-human", "the blocked company task moves to needs-human");
    assert(blocked.missingGateIds.includes("live-url-integrity"), "the integrity gate should be the blocker");
    assert(blocked.task.result.includes("payment page is live"), "the worker output must be preserved for the human");
    assert(/example|cal\.com|404/.test(blocked.task.result), "the block note should name the bad URL(s)");

    // Fixed retry: real deploy host + a reachable booking link → integrity passes → done.
    const fixedOutput = "Redeployed. Payment page is live at https://ginza-sites.pages.dev/paid and booking at https://cal.com/acme/website-kickoff.";
    const { receipts: fixedReceipts } = await runLoopGates({
      loop: companyLoop,
      output: fixedOutput,
      judge: acceptingJudge,
      probeUrl: async () => ({ status: 200 }),
    });
    const done = await completeTask(
      boardSlug, taskId,
      { summary: "Re-completed after fixing the links.", result: fixedOutput, loopReceipts: fixedReceipts },
      { ...options, trustedLoopReceipts: true },
    );
    assert.equal(done.task.status, "done", "a fixed retry (stable integrity receipt id) overwrites the failure and completes");
    assert(!done.blocked, "the fixed retry must not be blocked");
  }

  // ── HTTP-path completion integrity: an UNTRUSTED completion (worker lanes, MCP,
  //    external runtimes over POST /api/kanban "complete" — trustedLoopReceipts
  //    unset) must run the same integrity evaluators the in-process runner runs.
  //    Before this, a fabricated "site is live at <url>" moved the card to done
  //    whenever no required server-authoritative gates existed. All probes are
  //    injected fakes via the options.integrityProbes seam — no network. ──
  {
    // 4a. Fabricated dead URL, task with NO loop at all → hard-fails to needs-human.
    const created = await createTask(
      boardSlug,
      { title: "HTTP completion: dead URL", body: "Ship the page.", status: "ready", priority: "normal", workspace: "scratch" },
      options,
    );
    const taskId = created.task.id;
    await claimTask(boardSlug, taskId, { assignee: "External Agent", claimer: "http-claim-1", runtime: "test" }, options);
    const fabricated = "Done. The payment page is live at https://acme-shop.pages.dev/checkout and ready for customers.";
    const blocked = await completeTask(
      boardSlug, taskId,
      { summary: "External agent completion.", result: fabricated },
      { ...options, integrityProbes: { probeUrl: async () => ({ status: 404 }) } },
    );
    assert.equal(blocked.blocked, true, "an untrusted completion claiming a dead URL must block");
    assert.equal(blocked.task.status, "needs-human", "the blocked HTTP completion parks needs-human");
    assert(blocked.missingGateIds.includes("live-url-integrity"), "the live-URL integrity gate is the blocker");
    assert(blocked.task.result.includes("payment page is live"), "the submitted output is preserved for the human");
    const stored = (blocked.task.loopReceipts ?? []).find((r) => r.id === "lr_live-url-integrity");
    assert(stored, "the server-run integrity receipt is stored with the task");
    assert.equal(stored.status, "failed");
    assert.equal(stored.metadata?.hardFail, true, "the stored failure is a HARD fail");
    assert.equal(stored.metadata?.authority, "server", "the receipt is server-authoritative");

    // 4b. A forged client receipt claiming the stable integrity id cannot pre-pass:
    //     the server-run verdict merges LAST and overwrites it.
    const forged = await completeTask(
      boardSlug, taskId,
      {
        summary: "Client forges an integrity pass.",
        result: fabricated,
        loopReceipts: [{
          id: "lr_live-url-integrity", gateId: "live-url-integrity", status: "passed",
          summary: "client says it is fine", evidence: [], createdAt: Date.now(),
        }],
      },
      { ...options, integrityProbes: { probeUrl: async () => ({ status: 404 }) } },
    );
    assert.equal(forged.blocked, true, "a forged integrity pass must not complete the task");
    const forgedStored = (forged.task.loopReceipts ?? []).find((r) => r.id === "lr_live-url-integrity");
    assert.equal(forgedStored.status, "failed", "the server verdict overwrites the forged receipt");

    // 4c. Reserved/mock URL blocks with NO prober at all (pure check), and the
    //     prober is never consulted for a reserved host.
    let probed = false;
    const reserved = await completeTask(
      boardSlug, taskId,
      { summary: "Retry.", result: "Payment page is live at https://demo.acme.example/paid?session_id=mock_99." },
      { ...options, integrityProbes: { probeUrl: async () => { probed = true; return { status: 200 }; } } },
    );
    assert.equal(reserved.blocked, true, "a reserved/mock claimed-live URL blocks without any probe");
    assert.equal(probed, false, "reserved/mock hosts are never probed");

    // 4d. Clean retry through the same untrusted path → completes; the stable-id
    //     receipt overwrites the prior failure.
    const done = await completeTask(
      boardSlug, taskId,
      { summary: "Fixed.", result: "Redeployed. The payment page is live at https://acme-shop.pages.dev/checkout." },
      { ...options, integrityProbes: { probeUrl: async () => ({ status: 200 }) } },
    );
    assert.equal(done.task.status, "done", "a clean untrusted completion completes");
    assert(!done.blocked, "the clean completion is not blocked");
    const doneReceipt = (done.task.loopReceipts ?? []).find((r) => r.id === "lr_live-url-integrity");
    assert.equal(doneReceipt.status, "passed", "the clean retry overwrites the stored hard-fail");
  }

  {
    // 5. Deliverable acceptance through the untrusted path: a placeholder page
    //    hard-fails; real content completes.
    const created = await createTask(
      boardSlug,
      { title: "HTTP completion: placeholder preview", body: "Ship the preview.", status: "ready", priority: "normal", workspace: "scratch" },
      options,
    );
    const taskId = created.task.id;
    await claimTask(boardSlug, taskId, { assignee: "External Agent", claimer: "http-claim-2", runtime: "test" }, options);
    const output = "Shipped. The preview is live at https://acme.pages.dev/";
    const lorem = "<html><body><h1>lorem ipsum dolor sit amet</h1></body></html>";
    const blocked = await completeTask(
      boardSlug, taskId,
      { summary: "External completion.", result: output },
      {
        ...options,
        integrityProbes: {
          probeUrl: async () => ({ status: 200 }),
          fetchContent: async () => ({ body: lorem, contentType: "text/html", status: 200 }),
        },
      },
    );
    assert.equal(blocked.blocked, true, "a placeholder deliverable blocks the untrusted completion");
    assert(blocked.missingGateIds.includes("deliverable-acceptance"), "the acceptance gate is the blocker");

    const real = `<html><body><main><h1>Acme Co</h1><p>${"Real substantive copy about the product and offer. ".repeat(8)}</p><a href="/buy">Buy</a></main></body></html>`;
    const done = await completeTask(
      boardSlug, taskId,
      { summary: "Filled in.", result: output },
      {
        ...options,
        integrityProbes: {
          probeUrl: async () => ({ status: 200 }),
          fetchContent: async () => ({ body: real, contentType: "text/html", status: 200 }),
        },
      },
    );
    assert.equal(done.task.status, "done", "a real deliverable completes through the untrusted path");
  }

  {
    // 6. The trusted in-process path is UNCHANGED: the store must not re-run the
    //    integrity gates (the in-process runner already ran them before completing).
    const created = await createTask(
      boardSlug,
      { title: "Trusted completion untouched", body: "In-process.", status: "ready", priority: "normal", workspace: "scratch" },
      options,
    );
    const taskId = created.task.id;
    await claimTask(boardSlug, taskId, { assignee: "Worker", claimer: "trusted-claim", runtime: "test" }, options);
    const done = await completeTask(
      boardSlug, taskId,
      { summary: "In-process completion.", result: "Deployed. Site is live at https://demo.acme.example/paid." },
      {
        ...options,
        trustedLoopReceipts: true,
        integrityProbes: { probeUrl: async () => { throw new Error("trusted path must not consult the store-level probes"); } },
      },
    );
    assert.equal(done.task.status, "done", "trusted completions skip store-level integrity gating (runLoopGates owns it)");
  }

  // ── Patch-to-done integrity: an agent PATCHing status:"done" (PATCH
  //    /api/kanban body.patch.status, i.e. applyPatchToBoard) is a completion
  //    too — it must run the same untrusted integrity evaluators as POST
  //    "complete" and PARK fabricated evidence needs-human, while status-only
  //    moveTask stays the gate-free human override. ──
  {
    // 7a. Fabricated dead URL via patch-to-done → parks needs-human with the
    //     server-authoritative hard-fail receipt stored (no throw, no completion).
    const created = await createTask(
      boardSlug,
      { title: "Patch-to-done: fabricated URL", body: "Ship the storefront.", status: "ready", priority: "normal", workspace: "scratch" },
      options,
    );
    const taskId = created.task.id;
    await claimTask(boardSlug, taskId, { assignee: "External Agent", claimer: "patch-claim-1", runtime: "test" }, options);
    const fabricated = "Done. The storefront is live at https://acme-store.pages.dev/ and taking orders.";
    const blocked = await patchTask(
      boardSlug, taskId,
      { status: "done", result: fabricated },
      { ...options, integrityProbes: { probeUrl: async () => ({ status: 404 }) } },
    );
    assert.equal(blocked.blocked, true, "a patch-to-done claiming a dead URL must block");
    assert.equal(blocked.task.status, "needs-human", "the blocked patch-to-done parks needs-human, it does not throw");
    assert(blocked.missingGateIds.includes("live-url-integrity"), "the live-URL integrity gate is the blocker");
    assert(blocked.task.result.includes("storefront is live"), "the submitted output is preserved for the human");
    assert(/loop gate block/i.test(blocked.task.result), "the parked result explains the block");
    assert(!blocked.task.completedAt, "a parked patch-to-done must not carry completedAt");
    const stored = (blocked.task.loopReceipts ?? []).find((r) => r.id === "lr_live-url-integrity");
    assert(stored, "the server-run integrity receipt is stored with the task");
    assert.equal(stored.status, "failed");
    assert.equal(stored.metadata?.hardFail, true, "the stored failure is a HARD fail");
    assert.equal(stored.metadata?.authority, "server", "the receipt is server-authoritative");

    // 7b. A forged client receipt inside the patch cannot pre-pass the stable
    //     integrity id: the server verdict merges LAST and overwrites it.
    const forged = await patchTask(
      boardSlug, taskId,
      {
        status: "done",
        result: fabricated,
        loopReceipts: [{
          id: "lr_live-url-integrity", gateId: "live-url-integrity", status: "passed",
          summary: "client says it is fine", evidence: [], createdAt: Date.now(),
        }],
      },
      { ...options, integrityProbes: { probeUrl: async () => ({ status: 404 }) } },
    );
    assert.equal(forged.blocked, true, "a forged integrity pass in the patch must not complete the task");
    assert.equal(
      (forged.task.loopReceipts ?? []).find((r) => r.id === "lr_live-url-integrity")?.status,
      "failed",
      "the server verdict overwrites the forged receipt",
    );

    // 7c. A status-only patch-to-done (no result submitted) verifies the STORED
    //     result — pre-patching the fabricated claim, then patching bare
    //     status:"done", is caught by the stored-text fallback.
    const storedOnly = await patchTask(
      boardSlug, taskId,
      { status: "done" },
      { ...options, integrityProbes: { probeUrl: async () => ({ status: 404 }) } },
    );
    assert.equal(storedOnly.blocked, true, "a status-only patch-to-done verifies the stored result");
    assert.equal(storedOnly.task.status, "needs-human");

    // 7d. Clean retry through the same patch path → completes; the stable-id
    //     receipt overwrites the stored hard-fail.
    const done = await patchTask(
      boardSlug, taskId,
      { status: "done", result: "Redeployed. The storefront is live at https://acme-store.pages.dev/." },
      { ...options, integrityProbes: { probeUrl: async () => ({ status: 200 }) } },
    );
    assert.equal(done.task.status, "done", "a clean patch-to-done completes");
    assert(!done.blocked, "the clean patch is not blocked");
    assert.equal(
      (done.task.loopReceipts ?? []).find((r) => r.id === "lr_live-url-integrity")?.status,
      "passed",
      "the clean retry overwrites the stored hard-fail",
    );
  }

  {
    // 8. The human override is UNTOUCHED: after a fabricated claim parks the
    //    card, a status-only moveTask to done still completes without gating.
    const created = await createTask(
      boardSlug,
      { title: "Patch-to-done: human override", body: "Ship it.", status: "ready", priority: "normal", workspace: "scratch" },
      options,
    );
    const taskId = created.task.id;
    await claimTask(boardSlug, taskId, { assignee: "External Agent", claimer: "patch-claim-2", runtime: "test" }, options);
    const parked = await patchTask(
      boardSlug, taskId,
      { status: "done", result: "Shipped. The page is live at https://acme-two.pages.dev/." },
      { ...options, integrityProbes: { probeUrl: async () => ({ status: 404 }) } },
    );
    assert.equal(parked.task.status, "needs-human", "the fabricated claim parks first");
    const moved = await moveTask(boardSlug, taskId, "done", options);
    assert.equal(moved.task.status, "done", "the status-only moveTask override completes despite the stored hard-fail");
  }

  {
    // 9. Trusted in-process patches skip the store-level probes entirely
    //    (runLoopGates already owns integrity for the in-process runner).
    const created = await createTask(
      boardSlug,
      { title: "Trusted patch untouched", body: "In-process.", status: "ready", priority: "normal", workspace: "scratch" },
      options,
    );
    const taskId = created.task.id;
    await claimTask(boardSlug, taskId, { assignee: "Worker", claimer: "trusted-patch", runtime: "test" }, options);
    const done = await patchTask(
      boardSlug, taskId,
      { status: "done", result: "Deployed. Site is live at https://demo.acme.example/paid." },
      {
        ...options,
        trustedLoopReceipts: true,
        integrityProbes: { probeUrl: async () => { throw new Error("trusted patch must not consult the store-level probes"); } },
      },
    );
    assert.equal(done.task.status, "done", "trusted patches skip store-level integrity gating");
  }

  console.log("loop completion blocking + preservation tests passed");
} finally {
  await rm(vaultPath, { recursive: true, force: true });
}
