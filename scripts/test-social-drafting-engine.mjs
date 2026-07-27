#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-social-drafting-engine-"));
const tempVault = join(tempHome, "vault");
const tempSoul = join(tempVault, "Skills", "test-x-soul");
await mkdir(join(tempSoul, "data"), { recursive: true });
await writeFile(join(tempSoul, "SOUL.md"), "Use the authored corpus as voice evidence, never as a phrase bank.\n");
await writeFile(join(tempSoul, "data", "liam_corpus.jsonl"), `${JSON.stringify({
  id: "voice-1",
  text: "spent half the morning tracing one broken callback. fixed it, added the regression test, and the desktop app finally catches the deep link again",
  time: "2026-07-21T15:00:00.000Z",
})}\n`);
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = tempVault;

const store = await import("../src/lib/services/socials/socials-store.ts");
const { buildSocialDraftContext } = await import("../src/lib/services/socials/social-draft-context.ts");
const {
  socialDraftCadenceFamily,
  socialDraftQualityIssues,
  socialDraftSimilarity,
  sourceAnchorIsSupported,
} = await import("../src/lib/services/socials/social-draft-quality.ts");
const { generateSocialDraftPack } = await import("../src/lib/services/socials/social-draft-generator.ts");
const { runSocialDraftingCycle } = await import("../src/lib/services/socials/social-drafting-engine.ts");
const { startSocialQueueEngine, stopSocialQueueEngine } = await import("../src/lib/services/socials/social-queue-engine.ts");

const created = await store.createSocialAccount({
  platform: "x",
  handle: "draft-test",
  method: "api-token",
  soulPath: "Skills/test-x-soul",
});
assert.equal(created.drafting.enabled, true, "posting-capable accounts start with daily drafting enabled");
assert.equal(created.drafting.draftsPerRun, 3);

const draftContext = await buildSocialDraftContext(created, []);
assert.match(draftContext.voiceCorpusText ?? "", /spent half the morning tracing one broken callback/);
assert.match(draftContext.text, /Anti-repetition memory/);
assert.ok(sourceAnchorIsSupported("broken callback", `${draftContext.voiceCorpusText}\n${draftContext.sourceText}`));

assert.equal(
  socialDraftCadenceFamily("an agent wallet without a hard cap is just a liability"),
  "abstract-agent-thesis",
);
assert.ok(
  socialDraftQualityIssues({
    text: "an agent browser without approvals is just a liability",
    maxCharacters: 280,
    priorTexts: ["an agent wallet without a hard cap is just a liability"],
  }).some((issue) => issue.startsWith("repeated-cadence:")),
  "noun-swapped manifesto openings are rejected even when their topics differ",
);
assert.ok(
  socialDraftSimilarity(
    "we shipped the desktop callback fix and added a regression test",
    "added a regression test after shipping the desktop callback fix",
  ) >= 0.72,
  "near-copy detection ignores word order and common account vocabulary",
);

const qualityGatedPreview = await generateSocialDraftPack({
  account: created,
  queue: [],
  count: 3,
  mode: "posts",
  now: new Date("2026-07-22T15:00:00.000Z"),
  dependencies: {
    standaloneModelImpl: async () => ({
      model: "test-luna",
      text: JSON.stringify({ drafts: [
        {
          shape: "receipt",
          sourceAnchor: "broken callback",
          text: "spent half the morning on one callback. the desktop catches it again, and the regression test is staying forever",
          rationale: "Concrete repair receipt from the authored corpus.",
        },
        {
          shape: "reaction",
          sourceAnchor: "broken callback",
          text: "the future of desktop callbacks is here",
          rationale: "Quota filler that should be rejected.",
        },
        {
          shape: "lesson",
          sourceAnchor: "a made up launch",
          text: "made up evidence should never reach the queue",
          rationale: "Unsupported source anchor that should be rejected.",
        },
        {
          shape: "walkthrough",
          sourceAnchor: "regression test",
          text: "callback opens the browser, desktop catches the deep link, test pins the route. small chain, very annoying bug",
          rationale: "Specific walkthrough with a separate cadence.",
        },
      ] }),
    }),
  },
});
assert.equal(qualityGatedPreview.model, "test-luna");
assert.equal(qualityGatedPreview.drafts.length, 2, "unsupported and generic quota filler is dropped instead of backfilled");
assert.ok(qualityGatedPreview.drafts.every((draft) => draft.kind === "post"));

let generationCalls = 0;
const generateImpl = async ({ count }) => {
  generationCalls += 1;
  return {
    model: "test-model",
    contextSourceIds: ["source:test"],
    drafts: Array.from({ length: count }, (_, index) => ({
      text: `Generated review draft ${index + 1}`,
      rationale: `Angle ${index + 1}`,
    })),
  };
};

const first = await runSocialDraftingCycle({
  now: new Date("2026-07-20T14:00:00.000Z"),
  generateImpl,
  connectionProbeImpl: async () => ({ ok: true, detail: "connected" }),
});
assert.equal(first.generated.length, 3, "a new connected account gets its first draft pack immediately");
assert.equal(generationCalls, 1);
let queue = await store.readSocialQueue();
assert.deepEqual(queue.map((item) => item.state), ["suggested", "suggested", "suggested"]);
assert.ok(queue.every((item) => item.origin === "agent" && !item.approval), "manual-mode generation is review-only");
assert.ok(queue.every((item) => item.generation?.model === "test-model"), "generation provenance is durable");

const runtimeAfterFirst = await store.readSocialDraftingRuntime(created.id);
assert.equal(runtimeAfterFirst.lastGeneratedCount, 3);
assert.equal(runtimeAfterFirst.lastPostGeneratedAt, "2026-07-20T14:00:00.000Z");
assert.equal(runtimeAfterFirst.lastPostGeneratedCount, 3);
assert.equal(runtimeAfterFirst.lastError, undefined);
assert.equal(runtimeAfterFirst.nextRunAt, "2026-07-21T14:00:00.000Z");

// A stale dev/HMR writer from the prior overlay schema may preserve the queue
// while dropping the new drafting receipt. Provenance repairs the receipt and
// prevents a duplicate pack on the next worker tick.
const oldOverlay = JSON.parse(await readFile(store.SOCIALS_RUNTIME_PATH, "utf8"));
delete oldOverlay.drafting;
oldOverlay.version = 2;
await writeFile(store.SOCIALS_RUNTIME_PATH, JSON.stringify(oldOverlay));

const notDue = await runSocialDraftingCycle({
  now: new Date("2026-07-20T14:05:00.000Z"),
  generateImpl,
  connectionProbeImpl: async () => ({ ok: true, detail: "connected" }),
});
assert.equal(notDue.generated.length, 0, "ordinary worker ticks do not duplicate a not-yet-due pack");
assert.equal(generationCalls, 1);
assert.equal((await store.readSocialDraftingRuntime(created.id)).nextRunAt, "2026-07-21T14:00:00.000Z");

const forced = await runSocialDraftingCycle({
  now: new Date("2026-07-20T15:00:00.000Z"),
  accountId: created.id,
  force: true,
  generateImpl: async () => ({
    model: "test-model",
    contextSourceIds: [],
    drafts: [{ text: "A genuinely new forced draft" }],
  }),
  connectionProbeImpl: async () => ({ ok: true, detail: "connected" }),
});
assert.equal(forced.generated.length, 1, "Generate now bypasses cadence without publishing");
queue = await store.readSocialQueue();
assert.equal(queue.find((item) => item.text === "A genuinely new forced draft")?.state, "suggested");

await store.updateSocialAccount(created.id, (account) => ({
  ...account,
  drafting: { ...account.drafting, enabled: false, updatedAt: "2026-07-20T15:01:00.000Z", updatedBy: "human" },
}));
const engagementTarget = {
  platform: "x",
  externalId: "1900000000000000001",
  url: "https://x.com/base/status/1900000000000000001",
  authorHandle: "base",
  text: "Agent sessions need scoped permissions.",
  createdAt: "2026-07-22T14:00:00.000Z",
  discoveredAt: "2026-07-22T15:00:00.000Z",
  source: "timeline",
  metrics: { likes: 40, reposts: 3, replies: 5, quotes: 1 },
};
const engagementOnly = await runSocialDraftingCycle({
  now: new Date("2026-07-22T15:00:00.000Z"),
  generateImpl: async ({ mode }) => {
    assert.equal(mode, "engagement", "the background worker keeps comment discovery active when standalone drafting is paused");
    return {
      model: "test-model",
      contextSourceIds: ["src-base"],
      contextWarnings: [],
      engagement: {
        backend: "agent-reach-twitter-cli",
        authenticatedAs: "draft-test",
        candidateCount: 8,
        queries: ["agent sessions"],
        targetHandles: ["base"],
      },
      drafts: [{ kind: "reply", text: "permissions are what turn a session into a safe capability", replyTo: engagementTarget.externalId, target: engagementTarget }],
    };
  },
  connectionProbeImpl: async () => ({ ok: true, detail: "connected" }),
});
assert.equal(engagementOnly.generated.length, 1);
const engagementRuntime = await store.readSocialDraftingRuntime(created.id);
assert.equal(engagementRuntime.lastPostGeneratedAt, "2026-07-20T15:00:00.000Z");
assert.equal(engagementRuntime.lastPostGeneratedCount, 1, "an engagement-only cycle preserves the most recent standalone receipt");
assert.equal(engagementRuntime.lastEngagementGeneratedAt, "2026-07-22T15:00:00.000Z");
assert.equal(engagementRuntime.lastReplyGeneratedCount, 1);
assert.equal(engagementRuntime.lastDiscoveredCount, 8);

await store.updateSocialAccount(created.id, (account) => ({
  ...account,
  drafting: { ...account.drafting, engagementEnabled: false, updatedAt: "2026-07-22T15:01:00.000Z", updatedBy: "human" },
}));
const disabled = await runSocialDraftingCycle({
  now: new Date("2026-07-23T15:00:00.000Z"),
  generateImpl,
  connectionProbeImpl: async () => ({ ok: true, detail: "connected" }),
});
assert.equal(disabled.generated.length, 0, "the background producer stops only when standalone drafting and comment discovery are both paused");

await store.updateSocialAccount(created.id, (account) => ({
  ...account,
  drafting: { ...account.drafting, enabled: true, updatedAt: "2026-07-22T15:01:00.000Z", updatedBy: "human" },
}));
const failed = await runSocialDraftingCycle({
  now: new Date("2026-07-22T16:00:00.000Z"),
  accountId: created.id,
  force: true,
  generateImpl: async () => { throw new Error("model unavailable"); },
  connectionProbeImpl: async () => ({ ok: true, detail: "connected" }),
});
assert.equal(failed.generated.length, 0);
assert.match((await store.readSocialDraftingRuntime(created.id)).lastError ?? "", /model unavailable/);
assert.equal((await store.readSocialDraftingRuntime(created.id)).nextRunAt, "2026-07-22T16:15:00.000Z");

const staleRunner = {
  schemaVersion: 1,
  stopRequested: false,
  loop: Promise.resolve(),
  startedAt: "2026-07-20T00:00:00.000Z",
  tickInFlight: false,
};
globalThis.__hivemindSocialQueueRunner = staleRunner;
const replaced = startSocialQueueEngine();
assert.equal(staleRunner.stopRequested, true, "a retained pre-HMR worker is retired before it can keep writing an old schema");
assert.notEqual(replaced.startedAt, staleRunner.startedAt);
await stopSocialQueueEngine();

console.log("social drafting engine tests passed");
