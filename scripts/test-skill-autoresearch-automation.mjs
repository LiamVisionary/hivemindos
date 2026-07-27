#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-skill-autoresearch-"));
const vaultPath = join(tempHome, "vault");
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;

await mkdir(join(vaultPath, "Skills", "research-brief"), { recursive: true });
await writeFile(join(vaultPath, "Skills", "research-brief", "SKILL.md"), [
  "---",
  "name: research-brief",
  "description: Produce a sourced research brief.",
  "---",
  "",
  "# Research Brief",
  "",
  "Produce a sourced research brief.",
  "",
].join("\n"));
await mkdir(join(vaultPath, "Skills", "generic-ingestion"), { recursive: true });
await writeFile(join(vaultPath, "Skills", "generic-ingestion", "SKILL.md"), "---\nname: generic-ingestion\ndescription: Exercise the generic analytics path.\n---\n");

try {
  const kanbanRoute = await import("../src/app/api/kanban/route.ts");
  const analyticsRoute = await import("../src/app/api/skills/analytics/route.ts");
  const queue = await import("../src/lib/services/brain-review-queue.ts");
  const { NextRequest } = await import("next/server");

  for (let index = 1; index <= 3; index += 1) {
    const source = index === 3 ? "company:company-a:run-1" : `work-board:test-${index}`;
    const createdResponse = await kanbanRoute.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/kanban", {
      action: "create-task",
      title: `Research attempt ${index}`,
      body: "Produce the weekly research brief.",
      status: "ready",
      skills: ["research-brief"],
      source,
      maxAttempts: 1,
      vaultPath,
    }));
    assert.equal(createdResponse.status, 200);
    const created = await createdResponse.json();

    const failedResponse = await kanbanRoute.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/kanban", {
      action: "fail",
      taskId: created.task.id,
      summary: `The research brief failed source-quality checks on attempt ${index}.`,
      failureReason: "verification-failed",
      vaultPath,
    }));
    assert.equal(failedResponse.status, 200);

    const reviews = await queue.readBrainReviewQueue();
    assert.equal(
      reviews.proposals.filter((proposal) => proposal.kind === "skill-evolution").length,
      index === 3 ? 1 : 0,
      "autoresearch should enqueue once at the three-distinct-execution threshold",
    );
  }

  const reviews = await queue.readBrainReviewQueue();
  const proposal = reviews.proposals.find((candidate) => candidate.kind === "skill-evolution");
  assert(proposal, "the third failure should create a skill-evolution review proposal");
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.metadata?.skillSlug, "research-brief");
  assert.deepEqual(proposal.metadata?.companyIds, ["company-a"]);
  assert.match(proposal.proposedContent, /hivemind-native/);

  const analytics = (await readFile(join(tempHome, ".hivemindos", "skill-analytics.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(analytics.filter((event) => event.event === "task-failed").length, 3);
  assert.equal(analytics.filter((event) => event.event === "improvement-suggested").length, 1);

  const boardResponse = await kanbanRoute.GET(new NextRequest(`http://127.0.0.1/api/kanban?vaultPath=${encodeURIComponent(vaultPath)}`));
  const board = await boardResponse.json();
  assert.equal(board.board.tasks.filter((task) => task.source?.startsWith("skill-autoresearch:")).length, 0, "detection should not launch work before review approval");

  await queue.approveBrainReviewProposal(proposal.id);
  await queue.applyBrainReviewProposal(proposal.id, { vaultPath });
  for (let index = 1; index <= 3; index += 1) {
    const response = await analyticsRoute.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/skills/analytics", {
      skillSlug: "research-brief",
      event: "action-failed",
      status: "failure",
      taskSource: `later-cycle:run-${index}`,
      note: `Post-review failure ${index}.`,
      vaultPath,
    }));
    assert.equal(response.status, 200);
  }
  const reviewsAfterLaterCycle = await queue.readBrainReviewQueue();
  assert.equal(
    reviewsAfterLaterCycle.proposals.filter((candidate) => candidate.kind === "skill-evolution").length,
    2,
    "three fresh failures should allow a later review cycle after the prior proposal was applied",
  );

  for (let index = 1; index <= 3; index += 1) {
    const response = await analyticsRoute.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/skills/analytics", {
      skillSlug: "generic-ingestion",
      event: "action-failed",
      status: "failure",
      taskSource: `app-surface:run-${index}`,
      note: `Generic app surface failure ${index}.`,
      vaultPath,
    }));
    assert.equal(response.status, 200);
  }
  const reviewsAfterGenericIngestion = await queue.readBrainReviewQueue();
  assert.equal(
    reviewsAfterGenericIngestion.proposals.filter((candidate) => candidate.kind === "skill-evolution").length,
    3,
    "the generic skill analytics route should feed app-wide autoresearch detection",
  );

  console.log("Work Board, Company, and generic app failures create review-gated skill autoresearch proposals");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

function jsonRequest(NextRequest, url, body) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
