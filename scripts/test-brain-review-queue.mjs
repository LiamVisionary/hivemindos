#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile, rm, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-brain-review-"));
const authSecret = "b".repeat(40);
const deviceToken = "brain-review-device-token-123";
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = join(tempHome, "missing-vault");
process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = authSecret;
process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN = deviceToken;

try {
  const queue = await import("../src/lib/services/brain-review-queue.ts");
  const route = await import("../src/app/api/brain/review/route.ts");
  const { NextRequest } = await import("next/server");

  await assert.rejects(
    () =>
      queue.createBrainReviewProposal({
        kind: "memory",
        summary: "Missing title",
        proposedContent: "Remember this.",
      }),
    /title is required/,
  );
  await assert.rejects(
    () =>
      queue.createBrainReviewProposal({
        kind: "memory-evolution",
        title: "Missing supersedes",
        summary: "Evolution needs a target memory.",
        proposedContent: "Better version.",
      }),
    /supersedesMemoryId/,
  );
  await assert.rejects(
    () =>
      queue.createBrainReviewProposal({
        kind: "skill",
        title: "Bad target",
        summary: "Absolute paths should not be accepted.",
        proposedContent: "Skill edit",
        targetPath: "/Users/liam/private.md",
      }),
    /relative project or vault path/,
  );

  const created = await queue.createBrainReviewProposal({
    kind: "memory",
    title: "Remember dashboard pin policy",
    summary: "Dashboard pins are local-first and should not use browser storage.",
    proposedContent: "Dashboard feedback pins live in ~/.hivemindos/dashboard-pins.json and can become Work Board tasks.",
    targetPath: "Memory/Distillations/Agent Memory/context/dashboard-pins.md",
    risk: "low",
    evidence: [
      {
        sourceType: "manual",
        sourceId: "unit-test",
        excerpt: "Pins use a local JSON store and authenticated API.",
      },
    ],
  });
  assert.equal(created.proposal.status, "pending");
  assert.equal(created.proposal.kind, "memory");
  assert.equal(created.proposal.evidence.length, 1);

  const pendingPreview = await queue.previewBrainReviewApply(created.proposal.id);
  assert.equal(pendingPreview.action, "remember");
  assert.equal(pendingPreview.canAutoApply, false);

  const approved = await queue.approveBrainReviewProposal(created.proposal.id);
  assert.equal(approved.proposal.status, "approved");
  const approvedPreview = await queue.previewBrainReviewApply(created.proposal.id);
  assert.equal(approvedPreview.canAutoApply, true);

  const rejectedCandidate = await queue.createBrainReviewProposal({
    kind: "job",
    title: "Review docs",
    summary: "Manual job proposal",
    proposedContent: "Review docs for user-facing wording.",
    risk: "medium",
  });
  const rejected = await queue.rejectBrainReviewProposal(rejectedCandidate.proposal.id, "Not needed now");
  assert.equal(rejected.proposal.status, "rejected");
  assert.equal(rejected.proposal.rejectionReason, "Not needed now");

  const approvedList = await queue.listBrainReviewProposals({ status: "approved" });
  assert.equal(approvedList.proposals.length, 1);

  const rawStore = await readFile(
    join(tempHome, ".hivemindos", "brain-review-queue.json"),
    "utf8",
  );
  assert.match(rawStore, /Remember dashboard pin policy/);

  const unauthorized = await route.GET(new NextRequest("http://127.0.0.1/api/brain/review"));
  assert.equal(unauthorized.status, 401);

  const apiCreate = await route.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/brain/review", {
    action: "create",
    kind: "skill",
    title: "Propose dashboard pin skill note",
    summary: "Skill proposal should remain manual in v1.",
    proposedContent: "Add a dashboard-pin workflow note.",
    targetPath: "Skills/dashboard-pin-workflow/SKILL.md",
    risk: "medium",
  }));
  assert.equal(apiCreate.status, 200);
  const apiCreateBody = await apiCreate.json();
  assert.equal(apiCreateBody.ok, true);
  assert.equal(apiCreateBody.proposal.status, "pending");

  const apiPreview = await route.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/brain/review", {
    action: "preview-apply",
    id: apiCreateBody.proposal.id,
  }));
  assert.equal(apiPreview.status, 200);
  const previewBody = await apiPreview.json();
  assert.equal(previewBody.preview.action, "manual");
  assert.equal(previewBody.preview.canAutoApply, false);

  const apiApprove = await route.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/brain/review", {
    action: "approve",
    id: apiCreateBody.proposal.id,
  }));
  assert.equal(apiApprove.status, 200);
  assert.equal((await apiApprove.json()).proposal.status, "approved");

  const apiList = await route.GET(authedRequest(NextRequest, "http://127.0.0.1/api/brain/review?status=approved"));
  assert.equal(apiList.status, 200);
  const apiListBody = await apiList.json();
  assert.ok(apiListBody.proposals.length >= 2);

  // Two separate OS processes hammer the queue concurrently. Without the
  // cross-process lockfile their read-modify-write cycles interleave and
  // silently drop proposals (each process's in-memory promise queue cannot
  // see the other process).
  const writerCount = 20;
  const runnerPath = join(tempHome, "contention-writer.mjs");
  await writeFile(runnerPath, [
    'import { register } from "node:module";',
    'import { writeFile as fsWriteFile, access as fsAccess } from "node:fs/promises";',
    "register(new URL(process.env.TS_LOADER_URL));",
    "const queue = await import(process.env.QUEUE_MODULE_URL);",
    "const writer = process.env.WRITER_ID;",
    "// Start barrier: both writers finish booting before either writes, so the",
    "// read-modify-write cycles genuinely overlap.",
    "await fsWriteFile(`${process.env.BARRIER_DIR}/ready-${writer}`, writer);",
    "for (let waited = 0; waited < 200; waited += 1) {",
    "  const peers = await Promise.all([\"a\", \"b\"].map((id) => fsAccess(`${process.env.BARRIER_DIR}/ready-${id}`).then(() => true, () => false)));",
    "  if (peers.every(Boolean)) break;",
    "  await new Promise((resolveSleep) => setTimeout(resolveSleep, 25));",
    "}",
    `for (let index = 0; index < ${writerCount}; index += 1) {`,
    "  await queue.createBrainReviewProposal({",
    '    kind: "memory",',
    "    title: `Contention writer ${writer} proposal ${index}`,",
    "    summary: `Cross-process contention proposal ${writer}-${index}.`,",
    "    // Large bodies widen each read-modify-write cycle so an unlocked",
    "    // interleave loses updates reliably instead of only occasionally.",
    '    proposedContent: `Unique cross-process contention content ${writer}-${index}. ${"x".repeat(20000)}`,',
    "  });",
    "}",
    "",
  ].join("\n"), "utf8");
  const runContentionWriter = (writerId) => new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [runnerPath], {
      env: {
        ...process.env,
        WRITER_ID: writerId,
        BARRIER_DIR: tempHome,
        TS_LOADER_URL: new URL("./lib/ts-relative-loader.mjs", import.meta.url).href,
        QUEUE_MODULE_URL: new URL("../src/lib/services/brain-review-queue.ts", import.meta.url).href,
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun(undefined);
      else rejectRun(new Error(`contention writer ${writerId} exited with ${code}`));
    });
  });
  await Promise.all([runContentionWriter("a"), runContentionWriter("b")]);
  const afterContention = await queue.readBrainReviewQueue();
  const contentionTitles = afterContention.proposals
    .map((proposal) => proposal.title)
    .filter((title) => title.startsWith("Contention writer "));
  assert.equal(contentionTitles.length, writerCount * 2,
    `both processes' proposals must survive concurrent writes (got ${contentionTitles.length} of ${writerCount * 2})`);
  await assert.rejects(
    access(join(tempHome, ".hivemindos", "brain-review-queue.json.lock")),
    "the cross-process queue lock must be released after writes",
  );

  console.log("Brain review queue store, API, and cross-process lock tests passed.");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

function authedRequest(NextRequest, url, init = {}) {
  return new NextRequest(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "x-hivemindos-device-token": deviceToken,
    },
  });
}

function jsonRequest(NextRequest, url, body) {
  return authedRequest(NextRequest, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
