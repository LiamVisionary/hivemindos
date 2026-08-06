#!/usr/bin/env node
// Completeness contract for the social platform matrix + adapter registry:
// Every platform, every method reachable (env keys or an OAuth start path),
// every capability declared, posting always gated on queue approval, adapters
// registered for every platform, and connector manifests present for every
// non-managed method's credentials.
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { SOCIAL_PLATFORMS, SOCIAL_CAPABILITIES } = await import("../src/lib/services/socials/socials-types.ts");
const { SOCIAL_PLATFORM_MATRIX, SOCIAL_POST_APPROVAL_GATE, socialPlatformCapabilityDtos } = await import(
  "../src/lib/services/socials/social-platform-matrix.ts"
);
const { SOCIAL_ADAPTERS } = await import("../src/lib/services/socials/adapters/index.ts");
const { accountEnvValue } = await import("../src/lib/services/socials/adapters/types.ts");
const { CONNECTOR_MANIFESTS } = await import("../src/lib/services/integrations/connector-manifests.ts");
const { dedupeManagedXCreditAccountAliases } = await import(
  "../src/lib/services/socials/managed-x-credit-accounts.ts"
);

const SUPPORT_VALUES = new Set(["supported", "limited", "unsupported"]);

assert.deepEqual([...SOCIAL_PLATFORMS].sort(), ["facebook", "farcaster", "linkedin", "reddit", "telegram", "x"], "six platforms (facebook = browser-profile connection rail)");

for (const platform of SOCIAL_PLATFORMS) {
  const row = SOCIAL_PLATFORM_MATRIX[platform];
  assert.ok(row, `matrix row exists: ${platform}`);
  assert.equal(row.platform, platform, `row self-identifies: ${platform}`);
  assert.ok(row.methods.length >= 1, `at least one connect method: ${platform}`);
  for (const method of row.methods) {
    assert.ok(
      method.envKeys.length > 0 || method.oauthStartPath || method.browserProfile,
      `${platform}/${method.method} declares env keys, an OAuth start path, or a managed browser profile`,
    );
    if (method.method === "browser-profile") {
      assert.ok(method.browserProfile?.namePrefix && method.browserProfile?.loginUrl && method.browserProfile?.probeUrl,
        `${platform} browser-profile method carries a complete profile spec`);
    }
    for (const aliasedKey of Object.keys(method.envKeyAliases ?? {})) {
      assert.ok(method.envKeys.includes(aliasedKey), `${platform}/${method.method} alias references declared key: ${aliasedKey}`);
    }
  }
  for (const capability of SOCIAL_CAPABILITIES) {
    assert.ok(SUPPORT_VALUES.has(row.capabilities[capability]), `${platform} declares capability ${capability}`);
  }
  if (row.capabilities.post !== "unsupported") {
    assert.ok(
      row.gatedOps.some((gated) => gated.op === "post" && gated.gate === SOCIAL_POST_APPROVAL_GATE),
      `${platform} gates posting on ${SOCIAL_POST_APPROVAL_GATE}`,
    );
  }
  assert.equal(row.drafting.supported, row.capabilities.post !== "unsupported", `${platform} drafting follows dashboard post capability`);
  assert.ok(row.drafting.maxCharacters >= 0, `${platform} declares a drafting character limit`);
  assert.equal(
    row.drafting.engagement.supported,
    platform === "x",
    `${platform} truthfully declares whether the live relevant-post producer is implemented`,
  );
  if (row.drafting.engagement.supported) {
    assert.notEqual(row.capabilities.search, "unsupported", `${platform} engagement needs search capability`);
    assert.notEqual(row.capabilities.reply, "unsupported", `${platform} engagement needs reply capability`);
  } else {
    assert.equal(row.drafting.engagement.defaultEnabled, false, `${platform} cannot default-enable an unimplemented producer`);
  }
  const adapter = SOCIAL_ADAPTERS[platform];
  assert.ok(adapter, `adapter registered: ${platform}`);
  assert.equal(adapter.platform, platform, `adapter self-identifies: ${platform}`);
  for (const fn of ["connectStatus", "post", "fetchPostMetrics", "fetchAccountMetrics", "capabilities"]) {
    assert.equal(typeof adapter[fn], "function", `${platform} adapter implements ${fn}`);
  }
}

// The X row keeps its documented reply/quote access-level limitation visible.
assert.equal(SOCIAL_PLATFORM_MATRIX.x.capabilities.reply, "limited");
assert.equal(SOCIAL_PLATFORM_MATRIX.x.capabilities.quote, "limited");
assert.deepEqual(
  SOCIAL_PLATFORM_MATRIX.x.drafting.engagement,
  { supported: true, defaultEnabled: true, defaultReplyDraftsPerRun: 3, defaultQuoteDraftsPerRun: 0, defaultLookbackHours: 48 },
  "X defaults to three reply suggestions, opt-in standalone quotes, and fresh two-day targets",
);
assert.ok(
  SOCIAL_PLATFORM_MATRIX.x.limits.some((limit) => /access-limited|Enterprise/i.test(limit)),
  "X row documents why engagement uses the authenticated Agent Reach session",
);
assert.ok(
  SOCIAL_PLATFORM_MATRIX.x.limits.some((limit) => /Multiple accounts.*Shared Hive Env cookie pairs/i.test(limit)),
  "X row documents account-isolated Agent Reach sessions",
);
assert.equal(SOCIAL_PLATFORM_MATRIX.telegram.capabilities.reply, "limited", "Telegram message replies are exposed as limited");
assert.equal(SOCIAL_PLATFORM_MATRIX.linkedin.capabilities.reply, "unsupported", "LinkedIn adapter does not expose reply posting");

// Client projection covers every platform with copied (not shared) rows.
const dtos = socialPlatformCapabilityDtos();
assert.equal(dtos.length, SOCIAL_PLATFORMS.length);
for (const dto of dtos) {
  assert.notEqual(dto.limits, SOCIAL_PLATFORM_MATRIX[dto.platform].limits, "DTO arrays are copies");
}

// X BYO auto-detect aliases: the connect modal prefills from these known
// same-meaning names (consumer-key naming, TWITTER_* legacy), and the DTO
// carries copied (not shared) alias arrays to the client.
const xByo = SOCIAL_PLATFORM_MATRIX.x.methods.find((method) => method.method === "api-token");
assert.ok(xByo?.envKeyAliases?.X_API_KEY?.includes("X_API_CONSUMER_KEY"), "X_API_KEY aliases consumer-key naming");
assert.ok(xByo?.envKeyAliases?.X_API_SECRET?.includes("X_API_SECRET_KEY"), "X_API_SECRET aliases secret-key naming");
const xByoDto = dtos.find((dto) => dto.platform === "x")?.methods.find((method) => method.method === "api-token");
assert.deepEqual(xByoDto?.envKeyAliases, xByo?.envKeyAliases, "DTO carries the alias map");
assert.notEqual(xByoDto?.envKeyAliases?.X_API_KEY, xByo?.envKeyAliases?.X_API_KEY, "DTO alias arrays are copies");

// Every non-managed connect method has a connector manifest able to collect
// its primary credential (managed-oauth and byo X handled by dedicated rails).
const manifestByProvider = new Map(CONNECTOR_MANIFESTS.map((manifest) => [manifest.key, manifest]));
for (const provider of ["telegram-social", "farcaster", "linkedin", "reddit"]) {
  assert.ok(manifestByProvider.has(provider), `connector manifest present: ${provider}`);
}

// Capability projection for a dummy account matches the matrix (spot check).
const dummy = {
  id: "telegram:test",
  platform: "telegram",
  handle: "test",
  method: "api-token",
  status: "disconnected",
  postingMode: "manual",
  drafting: {
    enabled: true,
    cadenceHours: 24,
    draftsPerRun: 3,
    engagementEnabled: false,
    replyDraftsPerRun: 0,
    quoteDraftsPerRun: 0,
    engagementLookbackHours: 48,
    updatedAt: "2026-07-17T00:00:00.000Z",
    updatedBy: "system",
  },
  awakeHours: { enabled: false, start: "09:00", end: "22:00", timezone: "UTC", days: [1] },
  contextSources: [],
  maxDailyReadOps: 0,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
};
assert.deepEqual(SOCIAL_ADAPTERS.telegram.capabilities(dummy), SOCIAL_PLATFORM_MATRIX.telegram.capabilities);

// Per-account env overrides: `env:<CANONICAL_KEY>` bindings re-point a
// credential at a differently-named shared env key; blank overrides and
// absent bindings fall back to the canonical name; values are trimmed.
const envCtx = { env: { TELEGRAM_BOT_TOKEN: " canonical ", MY_OTHER_BOT: "aliased" } };
assert.equal(accountEnvValue(dummy, envCtx, "TELEGRAM_BOT_TOKEN"), "canonical", "no binding → canonical key");
assert.equal(
  accountEnvValue({ ...dummy, binding: { "env:TELEGRAM_BOT_TOKEN": "MY_OTHER_BOT" } }, envCtx, "TELEGRAM_BOT_TOKEN"),
  "aliased",
  "override binding wins",
);
assert.equal(
  accountEnvValue({ ...dummy, binding: { "env:TELEGRAM_BOT_TOKEN": "  " } }, envCtx, "TELEGRAM_BOT_TOKEN"),
  "canonical",
  "blank override falls back to canonical",
);
assert.equal(
  accountEnvValue({ ...dummy, binding: { "env:TELEGRAM_BOT_TOKEN": "UNSET_KEY" } }, envCtx, "TELEGRAM_BOT_TOKEN"),
  "",
  "override pointing at a missing key reads empty (probe reports missing, no silent canonical fallback)",
);

// Managed X credit accounts are local aliases. Collapse only aliases that the
// hosted gateway proves belong to the same account, prefer the canonical
// per-install pool, and preserve separate service rails or unresolved entries.
const managedXCreditAccounts = [
  { accountId: "service:hive-research", hostedAccountId: "pagw_service", balanceUsd: 42.06 },
  { accountId: "agent:hermes-lead", hostedAccountId: "pagw_personal", balanceUsd: 42.06 },
  { accountId: "hmos-model-credits:legacy", hostedAccountId: "pagw_personal", balanceUsd: 42.06 },
  { accountId: "shared:hivemindos-models", hostedAccountId: "pagw_personal", balanceUsd: 42.06 },
  { accountId: "legacy:unresolved", balanceUsd: null },
];
assert.deepEqual(
  dedupeManagedXCreditAccountAliases(managedXCreditAccounts).map((account) => account.accountId),
  ["shared:hivemindos-models", "service:hive-research", "legacy:unresolved"],
  "managed X picker prefers the shared pool, collapses proven aliases, and preserves separate or unresolved accounts",
);
assert.deepEqual(
  managedXCreditAccounts.map((account) => account.accountId),
  [
    "service:hive-research",
    "agent:hermes-lead",
    "hmos-model-credits:legacy",
    "shared:hivemindos-models",
    "legacy:unresolved",
  ],
  "managed X alias deduplication does not mutate discovery order",
);

console.log("socials matrix tests passed");
