#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { SOCIAL_ADAPTERS } = await import("../src/lib/services/socials/adapters/index.ts");
const { xOAuth1Authorization } = await import("../src/lib/services/socials/adapters/x-oauth1.ts");
const { resolveManagedXCredit } = await import("../src/lib/services/socials/managed-x-credit-binding.ts");
const { fetchManagedXGatewayWithRetry } = await import("../src/lib/services/managed-x-api-client.ts");

// RFC 5849-style query-only signature vector. X v2 create-post uses a JSON
// body, so only URL query and oauth_* fields belong in the OAuth 1.0 base.
const knownOAuthHeader = xOAuth1Authorization({
  method: "GET",
  url: "http://photos.example.net/photos?file=vacation.jpg&size=original",
  consumerKey: "dpf43f3p2l4k3l03",
  consumerSecret: "kd94hf93k423kf44",
  accessToken: "nnch734d00sl2jdk",
  accessTokenSecret: "pfkkdhi9sl3r4s00",
  nonce: "kllo9940pd9333jh",
  timestamp: "1191242096",
});
assert.match(knownOAuthHeader, /oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"/);

const baseAccount = {
  id: "x:test",
  platform: "x",
  handle: "test",
  method: "api-token",
  status: "connected",
  postingMode: "manual",
  awakeHours: { enabled: false, start: "09:00", end: "22:00", timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6] },
  contextSources: [],
  maxDailyReadOps: 20,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

const legacyManagedAccount = {
  ...baseAccount,
  method: "managed-oauth",
  binding: { connectionSlug: "xconn_target" },
};
const creditAccounts = [
  { walletAgentId: "credits:a", slug: "default", updatedAt: "2026-07-20T00:00:00.000Z" },
  { walletAgentId: "credits:b", slug: "default", updatedAt: "2026-07-20T00:00:01.000Z" },
];
const persistedBindings = [];
const managedDependencies = {
  listCreditAccounts: async () => creditAccounts,
  getCreditToken: async (accountId) => `token:${accountId}`,
  getConnections: async (token) => ({
    ok: true,
    connections: token === "token:credits:b" ? [{ id: "xconn_target" }] : [{ id: "xconn_other" }],
  }),
  persistBinding: async (accountId, binding) => persistedBindings.push({ accountId, binding }),
};

const migratedCredit = await resolveManagedXCredit(legacyManagedAccount, managedDependencies);
assert.deepEqual(migratedCredit.credentials, {
  creditToken: "token:credits:b",
  creditSlug: "default",
  connectionId: "xconn_target",
});
assert.deepEqual(persistedBindings, [{
  accountId: "x:test",
  binding: { creditAccountId: "credits:b", creditSlug: "default" },
}], "a unique gateway owner is durably bound before delivery");

const incompleteInspection = await resolveManagedXCredit(legacyManagedAccount, {
  ...managedDependencies,
  getConnections: async (token) => token === "token:credits:a"
    ? { ok: false, status: 503, connections: [] }
    : { ok: true, connections: [{ id: "xconn_target" }] },
  persistBinding: async () => assert.fail("a partial lookup must never persist a guessed payer"),
});
assert.equal(incompleteInspection.credentials, undefined);
assert.equal(incompleteInspection.status, 503);
assert.equal(incompleteInspection.retryable, true);

const ambiguousInspection = await resolveManagedXCredit(legacyManagedAccount, {
  ...managedDependencies,
  getConnections: async () => ({ ok: true, connections: [{ id: "xconn_target" }] }),
  persistBinding: async () => assert.fail("multiple owners must never persist a guessed payer"),
});
assert.equal(ambiguousInspection.credentials, undefined);
assert.match(ambiguousInspection.error, /More than one credit account/);

let storedBindingListedAccounts = false;
const storedBinding = await resolveManagedXCredit({
  ...legacyManagedAccount,
  binding: { connectionSlug: "xconn_target", creditAccountId: "credits:b", creditSlug: "default" },
}, {
  ...managedDependencies,
  listCreditAccounts: async () => {
    storedBindingListedAccounts = true;
    return creditAccounts;
  },
});
assert.equal(storedBinding.credentials?.creditToken, "token:credits:b");
assert.equal(storedBindingListedAccounts, false, "a repaired account never scans unrelated credit accounts again");

let retryableGatewayAttempts = 0;
const recoveredGatewayResponse = await fetchManagedXGatewayWithRetry(new URL("https://gateway.example/health"), {
  method: "GET",
}, {
  retryable: true,
  timeoutMs: 1_000,
  retryDelayMs: 0,
  fetchImpl: async () => {
    retryableGatewayAttempts += 1;
    if (retryableGatewayAttempts < 3) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  },
});
assert.equal(recoveredGatewayResponse.status, 200);
assert.equal(retryableGatewayAttempts, 3, "safe managed-X traffic retries transient pre-response failures");

let unprotectedWriteAttempts = 0;
await assert.rejects(() => fetchManagedXGatewayWithRetry(new URL("https://gateway.example/oauth/start"), {
  method: "POST",
  body: "{}",
}, {
  retryable: false,
  timeoutMs: 1_000,
  retryDelayMs: 0,
  fetchImpl: async () => {
    unprotectedWriteAttempts += 1;
    throw new TypeError("fetch failed");
  },
}), /fetch failed/);
assert.equal(unprotectedWriteAttempts, 1, "a write without idempotency is never retried");

const calls = [];
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", ...headers },
});
const fetchImpl = async (url, init = {}) => {
  const href = String(url);
  calls.push({ href, init, json: typeof init.body === "string" && init.headers?.["Content-Type"] === "application/json" ? JSON.parse(init.body) : null });
  if (href.includes("api.x.com/2/tweets")) return response({ data: { id: "x123" } }, 201);
  if (href.includes("api.telegram.org") && href.endsWith("/sendMessage")) return response({ ok: true, result: { message_id: 88 } });
  if (href.includes("api.neynar.com/v2/farcaster/user/bulk")) {
    return response({ users: [{ username: "test", display_name: "Test Caster", pfp_url: "https://images.example/farcaster.jpg" }] });
  }
  if (href.includes("api.neynar.com/v2/farcaster/cast")) return response({ success: true, cast: { hash: "0xfarcaster" } });
  if (href.endsWith("linkedin.com/v2/userinfo")) {
    return response({ sub: "li123", name: "Test", picture: "https://images.example/linkedin.jpg" });
  }
  if (href.endsWith("linkedin.com/v2/ugcPosts")) return response({}, 201, { "x-restli-id": "urn:li:share:123" });
  if (href.includes("reddit.com/api/v1/access_token")) return response({ access_token: "reddit-token" });
  if (href.endsWith("oauth.reddit.com/api/v1/me")) return response({ name: "user", icon_img: "https://images.example/reddit.jpg" });
  if (href.includes("oauth.reddit.com/api/submit")) return response({ json: { data: { name: "t3_abc", url: "https://reddit.com/r/test/comments/abc" }, errors: [] } });
  if (href.includes("oauth.reddit.com/api/comment")) return response({ json: { data: { things: [{ data: { name: "t1_reply" } }] }, errors: [] } });
  throw new Error(`unexpected fetch ${href}`);
};

const linkedInProbe = await SOCIAL_ADAPTERS.linkedin.connectStatus(
  { ...baseAccount, id: "linkedin:test", platform: "linkedin", method: "oauth" },
  { env: { LINKEDIN_ACCESS_TOKEN: "li-token" }, fetchImpl },
);
assert.equal(linkedInProbe.avatarUrl, "https://images.example/linkedin.jpg");

const farcasterProbe = await SOCIAL_ADAPTERS.farcaster.connectStatus(
  { ...baseAccount, id: "farcaster:test", platform: "farcaster", binding: { fid: "3", signerUuid: "signer" } },
  { env: { NEYNAR_API_KEY: "neynar" }, fetchImpl },
);
assert.equal(farcasterProbe.avatarUrl, "https://images.example/farcaster.jpg");

const redditProbe = await SOCIAL_ADAPTERS.reddit.connectStatus(
  { ...baseAccount, id: "reddit:test", platform: "reddit", binding: { defaultSubreddit: "test" } },
  {
    env: { REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "secret", REDDIT_USERNAME: "user", REDDIT_PASSWORD: "pass" },
    fetchImpl,
  },
);
assert.equal(redditProbe.avatarUrl, "https://images.example/reddit.jpg");

const xAgentReachCalls = [];
const xAgentReachRun = async (args) => {
  xAgentReachCalls.push(args);
  if (args[0] === "status") {
    return { ok: true, data: { authenticated: true, user: { screenName: "test" } } };
  }
  if (args[0] === "reply") {
    return { ok: true, data: { success: true, action: "reply", id: "123", replyTo: "111" } };
  }
  throw new Error(`unexpected Agent Reach X call: ${args.join(" ")}`);
};
const xResult = await SOCIAL_ADAPTERS.x.post({
  account: baseAccount,
  text: "hello",
  replyTo: "111",
  idempotencyKey: "queue-x",
}, {
  env: { X_API_KEY: "key", X_API_SECRET: "secret", X_ACCESS_TOKEN: "token", X_ACCESS_TOKEN_SECRET: "token-secret" },
  fetchImpl,
  xAgentReachRun,
});
assert.equal(xResult.externalId, "123");
assert.deepEqual(xAgentReachCalls, [
  ["status", "--json"],
  ["reply", "111", "hello", "--json"],
]);
assert.equal(calls.some((call) => call.href.includes("api.x.com/2/tweets")), false, "X replies never degrade to standalone API posts");

await assert.rejects(() => SOCIAL_ADAPTERS.x.post({
  account: baseAccount,
  text: "wrong account",
  replyTo: "112",
  idempotencyKey: "queue-x-mismatch",
}, {
  env: {},
  xAgentReachRun: async () => ({ ok: true, data: { authenticated: true, user: { screenName: "someone_else" } } }),
}), /authenticated as @someone_else.*connected as @test/i);

const quoteCalls = [];
const quoteResult = await SOCIAL_ADAPTERS.x.post({
  account: baseAccount,
  text: "native quote",
  quoteOf: "113",
  idempotencyKey: "queue-x-quote",
}, {
  env: {},
  xAgentReachRun: async (args) => {
    quoteCalls.push(args);
    return args[0] === "status"
      ? { ok: true, data: { authenticated: true, user: { screenName: "test" } } }
      : { ok: true, data: { success: true, action: "quote", id: "124", quotedId: "113" } };
  },
});
assert.equal(quoteResult.externalId, "124");
assert.deepEqual(quoteCalls[1], ["quote", "113", "native quote", "--json"]);
assert.doesNotMatch(JSON.stringify(quoteCalls), /i\/web\/status/, "quote delivery never appends a generic status URL");

let transientStatusAttempts = 0;
const recoveredReply = await SOCIAL_ADAPTERS.x.post({
  account: baseAccount,
  text: "retry read-only identity preflight",
  replyTo: "114",
  idempotencyKey: "queue-x-preflight-retry",
}, {
  env: {},
  xAgentReachRun: async (args) => {
    if (args[0] === "status") {
      transientStatusAttempts += 1;
      if (transientStatusAttempts < 3) throw new Error("temporary cookie database contention");
      return { ok: true, data: { authenticated: true, user: { screenName: "test" } } };
    }
    return { ok: true, data: { success: true, action: "reply", id: "125", replyTo: "114" } };
  },
});
assert.equal(recoveredReply.externalId, "125");
assert.equal(transientStatusAttempts, 3, "read-only X identity preflight retries bounded transient command failures before delivery");

const telegramResult = await SOCIAL_ADAPTERS.telegram.post({
  account: { ...baseAccount, id: "telegram:test", platform: "telegram", binding: { chatId: "-1001" } },
  text: "telegram",
  replyTo: "44",
  idempotencyKey: "queue-tg",
}, { env: { TELEGRAM_BOT_TOKEN: "bot" }, fetchImpl });
assert.equal(telegramResult.externalId, "88");
const telegramCall = calls.find((call) => call.href.endsWith("/sendMessage"));
assert.deepEqual(telegramCall.json.reply_parameters, { message_id: 44, allow_sending_without_reply: false });

const farcasterResult = await SOCIAL_ADAPTERS.farcaster.post({
  account: { ...baseAccount, id: "farcaster:test", platform: "farcaster", binding: { fid: "3", signerUuid: "signer" } },
  text: "cast",
  quoteOf: "4:0xabc123",
  idempotencyKey: "queue-fc",
}, { env: { NEYNAR_API_KEY: "neynar" }, fetchImpl });
assert.equal(farcasterResult.externalId, "0xfarcaster");
const castCall = calls.find((call) => call.href.includes("api.neynar.com/v2/farcaster/cast"));
assert.equal(castCall.json.idem, "queue-fc");
assert.deepEqual(castCall.json.embeds, [{ cast_id: { fid: 4, hash: "0xabc123" } }]);

const linkedInResult = await SOCIAL_ADAPTERS.linkedin.post({
  account: { ...baseAccount, id: "linkedin:test", platform: "linkedin", method: "oauth" },
  text: "linkedin",
  idempotencyKey: "queue-li",
}, { env: { LINKEDIN_ACCESS_TOKEN: "li-token" }, fetchImpl });
assert.equal(linkedInResult.externalId, "urn:li:share:123");
const linkedInCall = calls.find((call) => call.href.endsWith("linkedin.com/v2/ugcPosts"));
assert.equal(linkedInCall.json.author, "urn:li:person:li123");
assert.equal(linkedInCall.json.specificContent["com.linkedin.ugc.ShareContent"].shareCommentary.text, "linkedin");

const redditAccount = { ...baseAccount, id: "reddit:test", platform: "reddit", binding: { defaultSubreddit: "test" } };
const redditResult = await SOCIAL_ADAPTERS.reddit.post({
  account: redditAccount,
  title: "A title",
  text: "reddit body",
  idempotencyKey: "queue-r",
}, {
  env: { REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "secret", REDDIT_USERNAME: "user", REDDIT_PASSWORD: "pass" },
  fetchImpl,
});
assert.equal(redditResult.externalId, "t3_abc");
const redditCall = calls.find((call) => call.href.includes("oauth.reddit.com/api/submit"));
assert.match(String(redditCall.init.body), /title=A\+title/);
assert.match(String(redditCall.init.body), /sr=test/);

console.log("social adapter posting tests passed");
