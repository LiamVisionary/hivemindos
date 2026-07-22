#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  discoverRelevantXPosts,
  extractEngagementTargetHandles,
} = await import("../src/lib/services/socials/social-x-discovery.ts");
const { generateSocialEngagementDrafts } = await import("../src/lib/services/socials/social-engagement-generator.ts");

const account = {
  id: "x:thehivemindos",
  platform: "x",
  handle: "TheHivemindOS",
  method: "managed-oauth",
  status: "connected",
  postingMode: "manual",
  drafting: {
    enabled: true,
    cadenceHours: 24,
    draftsPerRun: 3,
    engagementEnabled: true,
    replyDraftsPerRun: 2,
    quoteDraftsPerRun: 1,
    engagementLookbackHours: 48,
    updatedAt: "2026-07-20T00:00:00.000Z",
    updatedBy: "human",
  },
  awakeHours: { enabled: false, start: "09:00", end: "22:00", timezone: "America/New_York", days: [0, 1, 2, 3, 4, 5, 6] },
  contextSources: [{ id: "src-base", kind: "x-account", ref: "@base", addedAt: "2026-07-20T00:00:00.000Z" }],
  maxDailyReadOps: 20,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

const contextText = `
## Voice: MEMORY.md
Tier-1 engagement targets: @0xDeployer, @bankrbot, @jessepollak, @base, @buildonbase.
## Product
HivemindOS is a local-first agent operating system with shared memory, governed wallets, and work routing.
`;

assert.deepEqual(
  extractEngagementTargetHandles(account, contextText),
  ["base", "0xDeployer", "bankrbot", "jessepollak", "buildonbase"],
  "explicit X sources come first, followed by voice-defined engagement targets with self excluded",
);

const now = new Date("2026-07-20T20:00:00.000Z");
const post = (id, handle, text, createdAt, likes, extra = {}) => ({
  id,
  text,
  author: { id: `author-${handle}`, name: handle, screenName: handle, verified: false },
  metrics: { likes, retweets: 2, replies: 3, quotes: 1, views: 100, bookmarks: 0 },
  createdAtISO: createdAt,
  isRetweet: false,
  lang: "en",
  ...extra,
});

const runTwitterImpl = async (args) => {
  if (args[0] === "status") {
    return { ok: true, data: { authenticated: true, user: { screenName: "TheHivemindOS" } } };
  }
  if (args[0] === "user-posts") {
    return { ok: true, data: [
      post("101", args[1], "Base is shipping account abstraction for app sessions", "2026-07-20T14:00:00.000Z", 500),
      post("102", args[1], "Already suggested", "2026-07-20T13:00:00.000Z", 800),
    ] };
  }
  if (args[0] === "search") {
    return { ok: true, data: [
      post("103", "agentbuilder", "Agents need durable memory and explicit spending limits", "2026-07-20T18:00:00.000Z", 80),
      post("104", "TheHivemindOS", "Our own post", "2026-07-20T19:00:00.000Z", 1000),
      post("105", "oldbuilder", "Old but popular", "2026-07-15T19:00:00.000Z", 10000),
      post("106", "resharer", "RT something", "2026-07-20T19:00:00.000Z", 1000, { isRetweet: true }),
    ] };
  }
  throw new Error(`Unexpected twitter args: ${args.join(" ")}`);
};

const queue = [{
  id: "queue-seen",
  accountId: account.id,
  platform: "x",
  state: "canceled",
  text: "Prior suggestion",
  replyTo: "102",
  origin: "agent",
  automated: false,
  stateHistory: [{ state: "suggested", at: "2026-07-20T12:00:00.000Z", by: "agent" }],
  createdAt: "2026-07-20T12:00:00.000Z",
}];

const discovery = await discoverRelevantXPosts({
  account,
  contextText,
  queue,
  queries: ["agent memory wallets"],
  now,
  runTwitterImpl,
});
assert.equal(discovery.backend, "agent-reach-twitter-cli");
assert.equal(discovery.authenticatedAs, "TheHivemindOS");
assert.deepEqual(discovery.candidates.map((candidate) => candidate.externalId).sort(), ["101", "103"]);
assert.ok(discovery.candidates.every((candidate) => candidate.url === `https://x.com/${candidate.authorHandle}/status/${candidate.externalId}`));
assert.equal(discovery.rejected.self, 1);
assert.equal(discovery.rejected.stale, 1);
assert.equal(discovery.rejected.seen, 5, "the seen target returned by each configured timeline is rejected every time");
assert.equal(discovery.rejected.retweet, 1);

const modelStages = [];
const generated = await generateSocialEngagementDrafts({
  account,
  queue,
  context: { text: contextText, contextSourceIds: ["src-base"], warnings: [] },
  now,
  dependencies: {
    runTwitterImpl,
    modelImpl: async ({ stage, candidates }) => {
      modelStages.push(stage);
      if (stage === "plan") {
        return { model: "gpt-5.6-luna", text: JSON.stringify({ queries: ["agent memory wallets"] }) };
      }
      assert.equal(candidates.length, 2);
      return {
        model: "gpt-5.6-luna",
        text: JSON.stringify({ suggestions: [
          { kind: "reply", targetId: "101", text: "session keys get much more useful once agents carry scoped budgets too", rationale: "Connects Base session keys to governed agent spending." },
          { kind: "reply", targetId: "103", text: "memory without limits is intelligence without accountability. agents need both", rationale: "Adds the governance angle naturally." },
          { kind: "quote", targetId: "103", text: "the agent stack is converging on memory + money + limits", rationale: "A concise quote-post frame." },
        ] }),
      };
    },
  },
});

assert.deepEqual(modelStages, ["plan", "draft"]);
assert.equal(generated.model, "gpt-5.6-luna");
assert.equal(generated.backend, "agent-reach-twitter-cli");
assert.equal(generated.candidateCount, 2);
assert.equal(generated.drafts.length, 3);
assert.equal(generated.drafts.filter((draft) => draft.kind === "reply").length, 2);
assert.equal(generated.drafts.filter((draft) => draft.kind === "quote").length, 1);
for (const draft of generated.drafts) {
  assert.ok(draft.target, "every engagement draft carries a durable target snapshot");
  assert.equal(draft.kind === "reply" ? draft.replyTo : draft.quoteOf, draft.target.externalId);
}

console.log("social engagement discovery tests passed");
