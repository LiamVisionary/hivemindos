#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-brain-review-apply-"));
const vaultPath = join(tempHome, "vault");
const authSecret = "c".repeat(40);
const deviceToken = "brain-review-apply-device-token-123";
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;
process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = authSecret;
process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN = deviceToken;

await mkdir(vaultPath, { recursive: true });

try {
  const queue = await import("../src/lib/services/brain-review-queue.ts");
  const route = await import("../src/app/api/brain/review/route.ts");
  const { NextRequest } = await import("next/server");

  const memoryProposal = await queue.createBrainReviewProposal({
    kind: "memory",
    title: "Agent-native review queue adoption",
    summary: "Approved review queue memories should apply through Shared Brain Memory.",
    proposedContent: "HivemindOS review queue proposals apply approved durable memories through the existing Agent Memory writer.",
    risk: "low",
    evidence: [
      {
        sourceType: "manual",
        sourceId: "unit-test",
        excerpt: "The queue stores proposals first, then applies approved memories explicitly.",
      },
    ],
  });

  await assert.rejects(
    () => queue.applyBrainReviewProposal(memoryProposal.proposal.id, { vaultPath }),
    /Approve this brain review proposal/,
  );

  await queue.approveBrainReviewProposal(memoryProposal.proposal.id);
  const appliedMemory = await queue.applyBrainReviewProposal(memoryProposal.proposal.id, {
    vaultPath,
    type: "context",
    project: "HivemindOS",
    agentName: "Codex",
    runtime: "codex",
    tags: ["agent-native"],
    entities: ["Shared Brain Review Queue"],
  });

  assert.equal(appliedMemory.applied, true);
  assert.equal(appliedMemory.action, "remember");
  assert.equal(appliedMemory.proposal.status, "applied");
  assert.equal(appliedMemory.proposal.appliedMemoryId, appliedMemory.memory.record.id);
  assert.equal(appliedMemory.proposal.appliedMemoryPath, appliedMemory.memory.record.notePath);
  assert.equal(appliedMemory.memory.record.source, `brain-review:${memoryProposal.proposal.id}`);
  assert.equal(appliedMemory.memory.record.sourceType, "composite");
  assert.equal(appliedMemory.memory.record.actorRole, "agent");
  assert.equal(appliedMemory.memory.record.memoryOrigin, "agent-action");
  assert.ok(appliedMemory.memory.record.tags.includes("brain-review"));
  assert.ok(appliedMemory.memory.record.tags.includes("reviewed"));
  assert.ok(appliedMemory.memory.record.tags.includes("agent-native"));

  const memoryMarkdown = await readFile(join(vaultPath, appliedMemory.memory.record.notePath), "utf8");
  assert.match(memoryMarkdown, /Agent-native review queue adoption/);
  assert.match(memoryMarkdown, /brain-review/);

  await assert.rejects(
    () => queue.applyBrainReviewProposal(memoryProposal.proposal.id, { vaultPath }),
    /already been applied/,
  );

  const evolutionProposal = await queue.createBrainReviewProposal({
    kind: "memory-evolution",
    title: "Agent-native review queue adoption evolved",
    summary: "The reviewed memory now records that apply also stores a receipt on the proposal.",
    proposedContent: "Approved HivemindOS review queue memory proposals write through Agent Memory and store the applied memory id/path receipt on the proposal.",
    supersedesMemoryId: appliedMemory.memory.record.id,
    risk: "low",
    evidence: [
      {
        sourceType: "agent-run",
        sourceId: "unit-test",
        excerpt: "The apply result includes appliedMemoryId and appliedMemoryPath.",
      },
    ],
  });
  await queue.approveBrainReviewProposal(evolutionProposal.proposal.id);

  const apiApply = await route.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/brain/review", {
    action: "apply",
    id: evolutionProposal.proposal.id,
    vaultPath,
    project: "HivemindOS",
    runtime: "codex",
    evolutionType: "supplement",
    entities: ["Agent-Native"],
  }));
  assert.equal(apiApply.status, 200);
  const apiApplyBody = await apiApply.json();
  assert.equal(apiApplyBody.ok, true);
  assert.equal(apiApplyBody.applied, true);
  assert.equal(apiApplyBody.action, "evolve");
  assert.equal(apiApplyBody.proposal.status, "applied");
  assert.equal(apiApplyBody.memory.record.supersedes[0], appliedMemory.memory.record.id);
  assert.equal(apiApplyBody.memory.superseded[0].status, "superseded");
  assert.equal(apiApplyBody.memory.record.evolutionType, "supplement");

  const skillProposal = await queue.createBrainReviewProposal({
    kind: "skill",
    title: "Manual skill proposal",
    summary: "Skill proposals are reviewed but not auto-applied in v1.",
    proposedContent: "Add a reusable skill after human review.",
    targetPath: "Skills/manual-review/SKILL.md",
    risk: "medium",
  });
  await queue.approveBrainReviewProposal(skillProposal.proposal.id);

  const manualApply = await route.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/brain/review", {
    action: "apply",
    id: skillProposal.proposal.id,
    vaultPath,
  }));
  assert.equal(manualApply.status, 200);
  const manualBody = await manualApply.json();
  assert.equal(manualBody.ok, true);
  assert.equal(manualBody.applied, false);
  assert.equal(manualBody.proposal.status, "approved");
  assert.match(manualBody.reason, /manual review\/application/);

  const autoresearchProposal = await queue.createBrainReviewProposal({
    kind: "skill-evolution",
    title: "Evolve research-brief",
    summary: "Repeated failures qualify research-brief for an isolated optimizer run.",
    proposedContent: "Generate four measured variants and queue the winning diff for review.",
    targetPath: "Skills/research-brief/SKILL.md",
    risk: "medium",
    metadata: {
      skillSlug: "research-brief",
      targetPath: "Skills/research-brief/SKILL.md",
      symptom: "Three failed Work Board tasks.",
      backendPreference: "hivemind-native",
      companyIds: ["company-a"],
    },
  });
  await queue.approveBrainReviewProposal(autoresearchProposal.proposal.id);

  const autoresearchApply = await route.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/brain/review", {
    action: "apply",
    id: autoresearchProposal.proposal.id,
    vaultPath,
    project: "HivemindOS",
    runtime: "dashboard",
  }));
  assert.equal(autoresearchApply.status, 200);
  const autoresearchBody = await autoresearchApply.json();
  assert.equal(autoresearchBody.ok, true);
  assert.equal(autoresearchBody.applied, true);
  assert.equal(autoresearchBody.action, "launch-autoresearch");
  assert.equal(autoresearchBody.proposal.status, "applied");
  assert.equal(autoresearchBody.proposal.appliedTaskId, autoresearchBody.task.id);
  assert.equal(autoresearchBody.task.status, "ready");
  assert.ok(autoresearchBody.task.skills.includes("hive-skill-autoresearch"));
  assert.equal(autoresearchBody.task.tenant, "company-a");

  const unauthorizedList = await route.GET(new NextRequest("http://127.0.0.1/api/brain/review?status=applied"));
  assert.equal(unauthorizedList.status, 401);

  const appliedList = await route.GET(authedRequest(NextRequest, "http://127.0.0.1/api/brain/review?status=applied"));
  assert.equal(appliedList.status, 200);
  const appliedListBody = await appliedList.json();
  assert.equal(appliedListBody.proposals.length, 3);

  console.log("Brain review memory apply tests passed.");
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
