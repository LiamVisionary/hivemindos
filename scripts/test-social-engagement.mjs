#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  bindXDiscoveryStatusToAccount,
  createAccountTwitterCliRun,
  discoverRelevantXPosts,
  extractEngagementTargetHandles,
} = await import("../src/lib/services/socials/social-x-discovery.ts");
const xSessionBindingModule = await import("../src/lib/services/socials/social-x-session-binding.ts").catch(() => null);
assert.ok(xSessionBindingModule, "Socials needs a non-secret per-account X session binding contract");
const {
  SOCIAL_X_SESSION_MODE_BINDING,
  socialXSessionBinding,
  suggestedSocialXSessionEnvKeys,
  withSocialXSessionBinding,
} = xSessionBindingModule;
assert.equal(typeof createAccountTwitterCliRun, "function", "Socials needs an account-scoped twitter-cli runner");
const { generateSocialEngagementDrafts } = await import("../src/lib/services/socials/social-engagement-generator.ts");
const { targetAnchorIsSupported } = await import("../src/lib/services/socials/social-draft-quality.ts");

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

const suggestedKeys = suggestedSocialXSessionEnvKeys("RHSpillover");
assert.deepEqual(suggestedKeys, {
  authTokenEnvKey: "SOCIAL_X_RHSPILLOVER_AUTH_TOKEN",
  ct0EnvKey: "SOCIAL_X_RHSPILLOVER_CT0",
});

const accountA = {
  ...account,
  id: "x:account-a",
  handle: "account_a",
  binding: {
    [SOCIAL_X_SESSION_MODE_BINDING]: "account-env",
    "env:TWITTER_AUTH_TOKEN": "SOCIAL_X_ACCOUNT_A_AUTH_TOKEN",
    "env:TWITTER_CT0": "SOCIAL_X_ACCOUNT_A_CT0",
  },
};
const accountB = {
  ...account,
  id: "x:account-b",
  handle: "account_b",
  binding: {
    [SOCIAL_X_SESSION_MODE_BINDING]: "account-env",
    "env:TWITTER_AUTH_TOKEN": "SOCIAL_X_ACCOUNT_B_AUTH_TOKEN",
    "env:TWITTER_CT0": "SOCIAL_X_ACCOUNT_B_CT0",
  },
};
const sharedXEnv = {
  TWITTER_AUTH_TOKEN: "global-auth",
  TWITTER_CT0: "global-ct0",
  SOCIAL_X_ACCOUNT_A_AUTH_TOKEN: "account-a-auth",
  SOCIAL_X_ACCOUNT_A_CT0: "account-a-ct0",
  SOCIAL_X_ACCOUNT_B_AUTH_TOKEN: "account-b-auth",
  SOCIAL_X_ACCOUNT_B_CT0: "account-b-ct0",
};
const executions = [];
const executeImpl = async (command, args, options) => {
  executions.push({ command, args, env: options.env });
  const handle = options.env.TWITTER_AUTH_TOKEN === "account-a-auth" ? "account_a" : "account_b";
  return {
    stdout: JSON.stringify({ ok: true, data: { authenticated: true, user: { screenName: handle } } }),
  };
};
const [runAccountA, runAccountB] = await Promise.all([
  createAccountTwitterCliRun(accountA, {
    sharedEnv: sharedXEnv,
    baseEnv: { PATH: "/test/bin", TWITTER_AUTH_TOKEN: "process-global-auth", TWITTER_CT0: "process-global-ct0" },
    command: "/test/bin/twitter",
    executeImpl,
  }),
  createAccountTwitterCliRun(accountB, {
    sharedEnv: sharedXEnv,
    baseEnv: { PATH: "/test/bin", TWITTER_AUTH_TOKEN: "process-global-auth", TWITTER_CT0: "process-global-ct0" },
    command: "/test/bin/twitter",
    executeImpl,
  }),
]);
await Promise.all([runAccountA(["status", "--json"]), runAccountB(["status", "--json"])]);
assert.equal(executions.length, 2);
assert.deepEqual(
  executions.map((execution) => ({
    command: execution.command,
    auth: execution.env.TWITTER_AUTH_TOKEN,
    ct0: execution.env.TWITTER_CT0,
    path: execution.env.PATH,
  })),
  [
    { command: "/test/bin/twitter", auth: "account-a-auth", ct0: "account-a-ct0", path: "/test/bin" },
    { command: "/test/bin/twitter", auth: "account-b-auth", ct0: "account-b-ct0", path: "/test/bin" },
  ],
  "concurrent account runners receive isolated cookies instead of the process-global session",
);
assert.deepEqual(socialXSessionBinding(accountA), {
  mode: "account-env",
  authTokenEnvKey: "SOCIAL_X_ACCOUNT_A_AUTH_TOKEN",
  ct0EnvKey: "SOCIAL_X_ACCOUNT_A_CT0",
});
assert.match(
  bindXDiscoveryStatusToAccount(accountA, {
    available: true,
    authenticated: true,
    backend: "agent-reach-twitter-cli",
    checkedAt: "2026-07-27T00:00:00.000Z",
    accountHandle: "account_a",
    detail: "Authenticated X discovery as @account_a.",
  }).detail,
  /isolated session/i,
  "a matching per-account session is visibly distinguished from the machine default",
);
assert.match(
  bindXDiscoveryStatusToAccount(accountA, {
    available: true,
    authenticated: true,
    backend: "agent-reach-twitter-cli",
    checkedAt: "2026-07-27T00:00:00.000Z",
    accountHandle: "someone_else",
    detail: "Authenticated X discovery as @someone_else.",
  }).detail,
  /update this account's Agent Reach X session/i,
  "a mismatched per-account session points back to the account binding instead of global re-authentication",
);
assert.deepEqual(
  withSocialXSessionBinding(
    { connectionSlug: "managed-account-a", creditAccountId: "credits-a" },
    {
      mode: "account-env",
      authTokenEnvKey: "SOCIAL_X_ACCOUNT_A_AUTH_TOKEN",
      ct0EnvKey: "SOCIAL_X_ACCOUNT_A_CT0",
    },
  ),
  {
    connectionSlug: "managed-account-a",
    creditAccountId: "credits-a",
    xSessionMode: "account-env",
    "env:TWITTER_AUTH_TOKEN": "SOCIAL_X_ACCOUNT_A_AUTH_TOKEN",
    "env:TWITTER_CT0": "SOCIAL_X_ACCOUNT_A_CT0",
  },
  "Agent Reach session bindings preserve the managed posting connection",
);
assert.deepEqual(
  withSocialXSessionBinding(accountA.binding, { mode: "machine-default" }),
  undefined,
  "switching an account back to the legacy machine default removes only its X session binding",
);

let missingCredentialExecutions = 0;
const missingCredentialRun = await createAccountTwitterCliRun({
  ...accountA,
  binding: {
    ...accountA.binding,
    "env:TWITTER_CT0": "SOCIAL_X_MISSING_CT0",
  },
}, {
  sharedEnv: sharedXEnv,
  baseEnv: { TWITTER_AUTH_TOKEN: "process-global-auth", TWITTER_CT0: "process-global-ct0" },
  command: "/test/bin/twitter",
  executeImpl: async () => {
    missingCredentialExecutions += 1;
    return { stdout: "{}" };
  },
});
await assert.rejects(
  () => missingCredentialRun(["status", "--json"]),
  /SOCIAL_X_MISSING_CT0/,
  "a broken account binding names the missing env key instead of silently falling back to another account",
);
assert.equal(missingCredentialExecutions, 0, "missing account credentials fail before twitter-cli runs");

const runMachineDefault = await createAccountTwitterCliRun(account, {
  sharedEnv: sharedXEnv,
  baseEnv: { PATH: "/test/bin" },
  command: "/test/bin/twitter",
  executeImpl,
});
await runMachineDefault(["status", "--json"]);
assert.equal(executions.at(-1).env.TWITTER_AUTH_TOKEN, "global-auth", "legacy accounts keep using the machine-default Agent Reach session");
assert.equal(executions.at(-1).env.TWITTER_CT0, "global-ct0");

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

const mismatchedCommands = [];
await assert.rejects(
  () => discoverRelevantXPosts({
    account: { ...account, id: "x:rhspillover", handle: "RHSpillover" },
    contextText,
    queue: [],
    queries: ["agent memory wallets"],
    now,
    runTwitterImpl: async (args) => {
      mismatchedCommands.push(args[0]);
      if (args[0] === "status") {
        return { ok: true, data: { authenticated: true, user: { screenName: "TheHivemindOS" } } };
      }
      throw new Error("account-mismatched discovery must stop before reading X");
    },
  }),
  /authenticated as @TheHivemindOS.*@RHSpillover/i,
  "comment discovery must fail closed when Agent Reach is authenticated as a different X account",
);
assert.deepEqual(mismatchedCommands, ["status"], "a mismatched X session must not perform discovery reads");

assert.equal(
  targetAnchorIsSupported(
    "app sessions",
    "Base is shipping account abstraction for app sessions",
    "session keys are much more useful with scoped budgets",
  ),
  true,
);
assert.equal(
  targetAnchorIsSupported(
    "framework",
    "this framework crossed a new token market cap",
    "the best framework is the one that gets out of the way of execution",
  ),
  false,
  "generic bridge words cannot make an unrelated reply look contextual",
);

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
          { kind: "reply", targetId: "101", targetAnchor: "account abstraction", text: "scoped budgets make sessions much safer", rationale: "Looks relevant but drops the claimed anchor.", relevanceScore: 99 },
          { kind: "reply", targetId: "101", targetAnchor: "app sessions", text: "session keys get much more useful once agents carry scoped budgets too", rationale: "Connects app sessions to governed agent spending.", relevanceScore: 94 },
          { kind: "reply", targetId: "103", targetAnchor: "durable memory", text: "memory without limits is intelligence without accountability. agents need both", rationale: "Adds the governance angle naturally.", relevanceScore: 91 },
          { kind: "quote", targetId: "103", targetAnchor: "spending limits", text: "spending limits are what turn agent money from a demo into something I can leave running", rationale: "A concrete quote-post frame.", relevanceScore: 93 },
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
