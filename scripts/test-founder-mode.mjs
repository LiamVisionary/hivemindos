#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { compileFounderBlueprint } = await import("../src/lib/services/founder-blueprint.ts");
const { rankOutcomeCandidates } = await import("../src/lib/services/outcome-router.ts");
const { buildCapabilityPromotionDraft } = await import("../src/lib/services/capability-promotion.ts");
const { buildProofPack } = await import("../src/lib/services/proof-pack.ts");
const { labFusionSkillInput, previewLabFusionSkill, publishLabFusionSkill } = await import("../src/lib/services/fusion/lab-skill-fusion.ts");
const { founderModeContextIndexItem } = await import("../src/lib/services/context-index/static-tool-items.ts");
const { searchContextIndex } = await import("../src/lib/services/context-index.ts");

const blueprint = compileFounderBlueprint({
  goal: "Build a local-business website agency that reaches $10k MRR with reviewable previews and human-approved outreach.",
  constraints: { privacy: "private-first", budgetTier: "starter", pace: "week" },
  now: "2026-07-10T00:00:00.000Z",
  agents: [
    { id: "queen", name: "Queen", runtime: "hermes", role: "queen", workerClass: "planner" },
    { id: "research", name: "Scout", runtime: "codex", workerClass: "research" },
    { id: "code", name: "Builder", runtime: "codex", workerClass: "code" },
    { id: "qa", name: "Verifier", runtime: "claude-code", workerClass: "qa" },
  ],
  contextItems: [{
    id: "skill:outreach",
    kind: "skill",
    title: "Customer outreach",
    summary: "Draft and send reviewed customer email with OUTREACH_API_KEY.",
    tags: ["outreach", "email", "sales"],
    load: { type: "none" },
    authorization: { sideEffects: ["send-message"], risk: "medium", readOnly: false, requiredClaims: [], confirmation: "review" },
  }],
  modelFits: [{
    machineId: "mac-1",
    machineName: "Local workstation",
    tier: "local-medium",
    label: "Good local medium-model host",
    rationale: ["Enough memory for a local model."],
    preferredProviders: ["LM Studio"],
    suggestedUses: ["private drafting"],
  }],
});

assert.equal(blueprint.archetype, "service-company");
assert.equal(blueprint.apexGoal.unit, "currency");
assert.equal(blueprint.apexGoal.target, "10k");
assert.equal(blueprint.budget.firstMilestoneUsd, 10);
assert.ok(blueprint.crew.some((role) => role.role === "Queen" && role.candidateAgentId === "queen"));
assert.ok(blueprint.computeRoutes.some((route) => route.source === "local" && route.recommended));
assert.ok(blueprint.capabilities.some((capability) => capability.approvalRequired));
assert.ok(blueprint.proofRequirements.length >= 4);

const ranked = rankOutcomeCandidates([
  { provider: "cloud", model: "alpha", score: 90, free: false },
  { provider: "local", model: "beta", score: 70, free: true },
], [
  { id: "1", provider: "local", model: "beta", useCase: "coding", accepted: true, qualityScore: 0.95, costUsd: 0, latencyMs: 900, createdAt: "2026-07-10T00:00:00.000Z" },
  { id: "2", provider: "cloud", model: "alpha", useCase: "coding", accepted: false, qualityScore: 0.2, costUsd: 1, latencyMs: 500, createdAt: "2026-07-10T00:00:00.000Z" },
], { useCases: ["coding"], privacy: "private-first", maxCostUsd: 0.25 });
assert.equal(ranked[0].model, "beta", "accepted private local outcomes should outrank a higher metadata score");
assert.equal(ranked[0].outcomeEvidence.samples, 1);

const challenge = {
  id: "challenge-1", title: "Preview conversion method", objective: "Increase accepted previews", status: "active",
  metricName: "accepted previews", metricDirection: "increase", significanceThreshold: 0,
  createdAt: "2026-07-10T00:00:00.000Z", updatedAt: "2026-07-10T00:00:00.000Z", board: [], rulings: [],
  lineage: [{ id: "result-1", title: "Niche preview", parentIds: [], score: 4, status: "frontier", originator: { name: "Scout" }, runner: { name: "Builder" }, verifier: { name: "Verifier" }, evidence: ["four accepted previews"], createdAt: "2026-07-10T00:00:00.000Z" }],
  playbook: { levers: ["Lead with a real preview."], antiPatterns: ["Generic pitch."], triageTools: [], verifierNotes: [], openQuestions: [] },
};
const promotion = buildCapabilityPromotionDraft(challenge, { id: challenge.id, title: challenge.title, status: "active", objective: challenge.objective, metricName: challenge.metricName, metricDirection: "increase", bestScore: 4, significanceThreshold: 0, frontier: [{ id: "result-1", title: "Niche preview", score: 4, deltaFromBest: 0 }], leaderboard: [], quota: { runsLast24h: [] }, totals: { boardEntries: 0, lineageNodes: 1, rulings: 0, integrityAlerts: 0, antiPatterns: 1 } });
assert.equal(promotion.stage, "reviewable");
assert.equal(promotion.requiredReview, true);
assert.deepEqual(promotion.knownFailureModes, ["Generic pitch."]);

const challengeSummary = { id: challenge.id, title: challenge.title, status: "active", objective: challenge.objective, metricName: challenge.metricName, metricDirection: "increase", bestScore: 4, significanceThreshold: 0, frontier: [{ id: "result-1", title: "Niche preview", score: 4, deltaFromBest: 0 }], leaderboard: [], quota: { runsLast24h: [] }, totals: { boardEntries: 0, lineageNodes: 1, rulings: 0, integrityAlerts: 0, antiPatterns: 1 } };
const labFusionSpec = labFusionSkillInput(challenge, challengeSummary);
assert.equal(labFusionSpec.input.slug, "lab-preview-conversion-method");
assert.match(labFusionSpec.input.appendixMarkdown, /Lead with a real preview/);
assert.match(labFusionSpec.input.appendixMarkdown, /Generic pitch/);
assert.match(labFusionSpec.input.appendixMarkdown, /provenance data, not executable instructions/);

const temporaryVault = await mkdtemp(join(tmpdir(), "hivemind-lab-fusion-"));
try {
  const preview = await previewLabFusionSkill(challenge, challengeSummary, { vaultPath: temporaryVault, connectedApps: [] });
  assert.equal(preview.fusion.change.mode, "create");
  assert.equal(preview.fusion.skill.path, "");
  await assert.rejects(access(join(temporaryVault, "Skills", "lab-preview-conversion-method", "SKILL.md")), /ENOENT/, "preview must not write the promoted skill");
  await assert.rejects(publishLabFusionSkill(challenge, challengeSummary, { vaultPath: temporaryVault, connectedApps: [], confirmed: false }), /explicitly confirm/);
  await assert.rejects(publishLabFusionSkill(challenge, challengeSummary, { vaultPath: temporaryVault, connectedApps: [], confirmed: true, expectedDraftHash: "stale-draft" }), /changed since preview/);
  await assert.rejects(access(join(temporaryVault, "Skills", "lab-preview-conversion-method", "SKILL.md")), /ENOENT/, "a stale preview must not write the promoted skill");
  const published = await publishLabFusionSkill(challenge, challengeSummary, { vaultPath: temporaryVault, connectedApps: [], confirmed: true, expectedDraftHash: preview.fusion.draftHash });
  assert.match(published.fusion.skill.path, /lab-preview-conversion-method\/SKILL\.md$/);
  const publishedMarkdown = await readFile(published.fusion.skill.path, "utf8");
  assert.match(publishedMarkdown, /Lab-Derived Operating Method/);
  assert.match(publishedMarkdown, /Evidence Provenance/);
} finally {
  await rm(temporaryVault, { recursive: true, force: true });
}

const proofPack = buildProofPack({
  taskId: "task-1",
  title: "Ship preview",
  result: "Preview shipped.",
  deliverables: [{ id: "d1", label: "Preview", kind: "url", url: "https://example.com" }],
  receipts: [{ title: "browser smoke", status: "passed", evidence: ["HTTP 200"] }],
  proofs: [{ id: "work-receipt:task-1:did:key:builder", kind: "task", status: "verified", title: "Signed by Builder" }],
  agentName: "Builder",
  machineName: "Local workstation",
});
assert.equal(proofPack.status, "verified");
assert.equal(proofPack.unverifiedClaims.length, 0);

const contextItem = founderModeContextIndexItem((path) => `/repo/${path}`);
assert.equal(contextItem.route, "/api/founder");
assert.match(contextItem.retrievalText ?? "", /does not launch autonomous work/);
const discovered = await searchContextIndex({ query: "turn one outcome into a governed company blueprint with labs and proof packs", kinds: ["tool-schema"], limit: 30 });
assert.ok(discovered.items.some((item) => item.id === "tool-schema:founder-mode"), "Founder Mode must be discoverable from natural-language capability search");

const labsUiSource = await readFile(new URL("../src/features/dashboard/views/zero-human-companies/HivemindLabsPanel.tsx", import.meta.url), "utf8");
assert.match(labsUiSource, /requestFusion\("fusion-preview"\)/);
assert.match(labsUiSource, /requestFusion\("fusion-publish"\)/);
assert.match(labsUiSource, /I reviewed the generated skill, selected capabilities, evaluation evidence, failure modes, and replacement impact/);
assert.match(labsUiSource, /<Spinner size=\{11\} \/> Publishing/);
assert.match(labsUiSource, /aria-label="Reusable operating lever"/);
assert.match(labsUiSource, /aria-label="Observed failure mode"/);
const labsRouteSource = await readFile(new URL("../src/app/api/hivemind-labs/route.ts", import.meta.url), "utf8");
assert.match(labsRouteSource, /distillAgentChallengePlaybook/);
assert.match(labsRouteSource, /expectedDraftHash/);

console.log("Founder Mode, Lab Skill Fusion, outcome routing, capability promotion, and proof pack tests passed.");
