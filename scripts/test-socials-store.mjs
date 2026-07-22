#!/usr/bin/env node
// Contract coverage for the Socials account store: vault-primary definitions,
// runtime queue overlay, fail-closed corruption, rotated backups, and the
// no-silent-auto-posting policy (auto mode is unwritable without an opt-in
// trail and degrades to manual on read). Runs against an isolated HOME and an
// isolated vault so the real store is never read or mutated.
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-socials-store-"));
const tempVault = join(tempHome, "vault");
await mkdir(tempVault, { recursive: true });
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = tempVault;

const {
  DEFAULT_MAX_DAILY_READ_OPS,
  SocialsFileCorruptError,
  connectSocialAccount,
  createSocialAccount,
  deleteSocialAccount,
  getSocialAccount,
  mutateSocialQueue,
  mutateSocialDraftingRuntime,
  newContextSource,
  readSocialAccounts,
  readSocialQueue,
  readSocialQueueMeta,
  readSocialDraftingRuntime,
  readSocialReadBudget,
  reserveSocialReadOps,
  socialAccountId,
  updateSocialAccount,
} = await import("../src/lib/services/socials/socials-store.ts");

const DEFINITIONS_FILE = join(tempVault, "Operations", "Socials", "socials.json");
const RUNTIME_FILE = join(tempHome, ".hivemindos", "socials-runtime.json");

// ── create + defaults ───────────────────────────────────────────────────────
const created = await createSocialAccount({ platform: "x", handle: "@TestHandle", method: "api-token" });
assert.equal(created.id, "x:testhandle");
assert.equal(socialAccountId("x", "@TestHandle"), "x:testhandle");
assert.equal(created.handle, "TestHandle");
assert.equal(created.postingMode, "manual", "new accounts default to manual posting");
assert.deepEqual(
  {
    enabled: created.drafting.enabled,
    cadenceHours: created.drafting.cadenceHours,
    draftsPerRun: created.drafting.draftsPerRun,
    engagementEnabled: created.drafting.engagementEnabled,
    replyDraftsPerRun: created.drafting.replyDraftsPerRun,
    quoteDraftsPerRun: created.drafting.quoteDraftsPerRun,
    engagementLookbackHours: created.drafting.engagementLookbackHours,
  },
  {
    enabled: true,
    cadenceHours: 24,
    draftsPerRun: 3,
    engagementEnabled: true,
    replyDraftsPerRun: 3,
    quoteDraftsPerRun: 0,
    engagementLookbackHours: 48,
  },
  "X accounts start with a daily standalone and live-engagement review pack",
);
assert.equal(created.maxDailyReadOps, DEFAULT_MAX_DAILY_READ_OPS);
assert.equal(created.awakeHours.enabled, false);
assert.deepEqual(created.contextSources, []);
await assert.rejects(
  () => createSocialAccount({ platform: "telegram", handle: "invalid-hours", method: "api-token", awakeHours: { timezone: "bad-zone" } }),
  /Awake hours need valid/,
);

// Definitions landed in the vault file, not the local fallback.
await access(DEFINITIONS_FILE);
const onDisk = JSON.parse(await readFile(DEFINITIONS_FILE, "utf8"));
assert.equal(onDisk.length, 1);
assert.equal(onDisk[0].id, "x:testhandle");

// Duplicate create is refused.
await assert.rejects(() => createSocialAccount({ platform: "x", handle: "testhandle", method: "api-token" }), /already exists/);

// Connect is intentionally idempotent: reconnecting upgrades the rail binding
// without deleting queue policy, context, or the original creation receipt.
const reconnected = await connectSocialAccount({
  platform: "x",
  handle: "@TestHandle",
  method: "managed-oauth",
  binding: { connectionSlug: "xconn_repaired", creditAccountId: "credits:shared", creditSlug: "default" },
});
assert.equal(reconnected.id, created.id);
assert.equal(reconnected.method, "managed-oauth");
assert.equal(reconnected.createdAt, created.createdAt);
assert.equal(reconnected.binding?.creditAccountId, "credits:shared");
assert.equal((await readSocialAccounts()).length, 1, "reconnect updates the existing account instead of duplicating it");

// ── update + auto-mode policy ───────────────────────────────────────────────
const withSoul = await updateSocialAccount("x:testhandle", (account) => ({ ...account, soulPath: "Skills/liam-x-soul" }));
assert.equal(withSoul.soulPath, "Skills/liam-x-soul");

await assert.rejects(
  () => updateSocialAccount("x:testhandle", (account) => ({ ...account, postingMode: "auto" })),
  /autoOptIn/,
  "auto mode without an opt-in trail must be rejected",
);

const optedIn = await updateSocialAccount("x:testhandle", (account) => ({
  ...account,
  postingMode: "auto",
  autoOptIn: { enabledAt: new Date("2026-07-17T12:00:00Z").toISOString(), enabledBy: "human" },
}));
assert.equal(optedIn.postingMode, "auto");

// A hand-edited record claiming auto with no opt-in degrades to manual on read.
const raw = JSON.parse(await readFile(DEFINITIONS_FILE, "utf8"));
raw[0].postingMode = "auto";
delete raw[0].autoOptIn;
await writeFile(DEFINITIONS_FILE, JSON.stringify(raw));
const reread = await readSocialAccounts();
assert.equal(reread[0].postingMode, "manual", "auto without opt-in must degrade to manual on read");

raw[0].drafting = {
  enabled: true,
  cadenceHours: 24,
  draftsPerRun: 3,
  updatedAt: "2026-07-17T12:00:00.000Z",
  updatedBy: "human",
};
await writeFile(DEFINITIONS_FILE, JSON.stringify(raw));
assert.deepEqual(
  (({ engagementEnabled, replyDraftsPerRun, quoteDraftsPerRun, engagementLookbackHours }) => ({ engagementEnabled, replyDraftsPerRun, quoteDraftsPerRun, engagementLookbackHours }))((await readSocialAccounts())[0].drafting),
  { engagementEnabled: true, replyDraftsPerRun: 3, quoteDraftsPerRun: 0, engagementLookbackHours: 48 },
  "pre-engagement account records migrate to the X platform defaults",
);

raw[0].drafting = { enabled: "yes", cadenceHours: 1, draftsPerRun: 99 };
await writeFile(DEFINITIONS_FILE, JSON.stringify(raw));
assert.equal((await readSocialAccounts())[0].drafting.enabled, false, "a present malformed drafting policy fails closed");

// ── context sources ─────────────────────────────────────────────────────────
const source = newContextSource({ kind: "github", ref: "https://github.com/LiamVisionary/hivemindos", note: "recent commits" });
assert.ok(source.id.startsWith("src_"));
const withSources = await updateSocialAccount("x:testhandle", (account) => ({
  ...account,
  contextSources: [...account.contextSources, source],
}));
assert.equal(withSources.contextSources.length, 1);
assert.equal((await getSocialAccount("x:testhandle"))?.contextSources[0]?.note, "recent commits");

// ── rotated backups ─────────────────────────────────────────────────────────
await access(`${DEFINITIONS_FILE}.bak.0`);

// ── queue overlay (per-machine, never the vault) ────────────────────────────
const queueItem = {
  id: "post_1",
  accountId: "x:testhandle",
  platform: "x",
  state: "suggested",
  text: "draft",
  origin: "agent",
  automated: false,
  stateHistory: [{ state: "suggested", at: new Date("2026-07-17T12:00:00Z").toISOString(), by: "agent" }],
  createdAt: new Date("2026-07-17T12:00:00Z").toISOString(),
};
await mutateSocialQueue((queue) => [...queue, queueItem], { markTick: true });
assert.equal((await readSocialQueue()).length, 1);
assert.ok((await readSocialQueueMeta()).lastTickAt, "markTick records queue liveness");
await access(RUNTIME_FILE);
const runtimeOnDisk = JSON.parse(await readFile(RUNTIME_FILE, "utf8"));
assert.equal(runtimeOnDisk.version, 6, "the next mutation migrates older runtime overlays to version 6");
assert.deepEqual(runtimeOnDisk.readUsage, []);
assert.deepEqual(runtimeOnDisk.drafting, {}, "version 6 carries per-producer drafting and engagement runtime");
const vaultHasQueue = JSON.parse(await readFile(DEFINITIONS_FILE, "utf8"));
assert.ok(Array.isArray(vaultHasQueue) && vaultHasQueue.every((record) => !record.queue), "queue never replicates into the vault file");

const target = {
  platform: "x",
  externalId: "1900000000000000001",
  url: "https://x.com/base/status/1900000000000000001",
  authorHandle: "base",
  authorName: "Base",
  authorVerified: true,
  text: "Agents need scoped sessions and clear limits.",
  createdAt: "2026-07-20T16:00:00.000Z",
  discoveredAt: "2026-07-20T17:00:00.000Z",
  source: "timeline",
  metrics: { likes: 50, reposts: 4, replies: 7, quotes: 1, views: 1000 },
};
const engagementQueueItem = {
  ...queueItem,
  id: "post_reply_1",
  text: "the limits are what make the session useful",
  replyTo: target.externalId,
  generation: {
    generatedAt: "2026-07-20T17:00:00.000Z",
    model: "gpt-5.6-luna",
    contextSourceIds: ["src-base"],
    kind: "reply",
    relevanceScore: 91,
    target,
  },
};
await mutateSocialQueue((queue) => [engagementQueueItem, ...queue]);
const savedEngagement = (await readSocialQueue()).find((item) => item.id === engagementQueueItem.id);
assert.equal(savedEngagement?.generation?.target?.url, target.url, "review provenance retains the exact public target snapshot");
assert.equal(savedEngagement?.generation?.kind, "reply");
await mutateSocialDraftingRuntime("x:testhandle", () => ({
  lastSuccessAt: engagementQueueItem.generation.generatedAt,
  nextRunAt: "2026-07-21T17:00:00.000Z",
  lastGeneratedCount: 1,
  totalGenerated: 1,
  consecutiveFailures: 0,
}));
const migratedKindReceipt = await readSocialDraftingRuntime("x:testhandle");
assert.equal(migratedKindReceipt.lastEngagementGeneratedAt, engagementQueueItem.generation.generatedAt, "version 6 reconstructs per-producer timestamps from queue provenance");
assert.equal(migratedKindReceipt.lastReplyGeneratedCount, 1);

// Deleting the account clears its queue items.
await deleteSocialAccount("x:testhandle");
assert.equal((await readSocialAccounts()).length, 0);
assert.equal((await readSocialQueue()).length, 0);
assert.equal((await readSocialDraftingRuntime("x:testhandle")).totalGenerated, 0);

// Metered read reservations are atomic and bounded in the account's local day.
assert.deepEqual(
  await reserveSocialReadOps("x:testhandle", 2, 3, "America/New_York", new Date("2026-07-20T15:00:00.000Z")),
  { limit: 3, used: 2, remaining: 1 },
);
assert.deepEqual(
  await readSocialReadBudget("x:testhandle", 3, "America/New_York", new Date("2026-07-20T23:00:00.000Z")),
  { limit: 3, used: 2, remaining: 1 },
);
await assert.rejects(
  () => reserveSocialReadOps("x:testhandle", 2, 3, "America/New_York", new Date("2026-07-20T20:00:00.000Z")),
  /budget exhausted/,
);

// Valid JSON with a malformed queue item also fails closed. In particular, an
// unrecognized approval shape must never be treated as permission to post.
await writeFile(RUNTIME_FILE, JSON.stringify({
  version: 2,
  queue: [{ ...queueItem, state: "scheduled", approval: { at: queueItem.createdAt, by: "forged" } }],
  metricSnapshots: [],
  engine: { settings: { enabled: true, updatedAt: queueItem.createdAt, updatedBy: "system" } },
}));
await assert.rejects(() => readSocialQueue(), SocialsFileCorruptError);
await writeFile(RUNTIME_FILE, JSON.stringify({
  version: 2,
  queue: [],
  metricSnapshots: [],
  engine: { settings: { enabled: "yes", updatedAt: queueItem.createdAt, updatedBy: "system" } },
}));
await assert.rejects(() => readSocialQueueMeta(), SocialsFileCorruptError, "malformed engine settings must not enable delivery");
await writeFile(RUNTIME_FILE, JSON.stringify({
  version: 6,
  queue: [{ ...engagementQueueItem, generation: { ...engagementQueueItem.generation, target: { ...target, url: "https://evil.example/redirect" } } }],
  metricSnapshots: [],
  readUsage: [],
  drafting: {},
  engine: { settings: { enabled: true, updatedAt: queueItem.createdAt, updatedBy: "system" } },
}));
await assert.rejects(() => readSocialQueue(), SocialsFileCorruptError, "engagement provenance rejects a non-canonical target URL");

// ── corruption fails closed ─────────────────────────────────────────────────
await writeFile(DEFINITIONS_FILE, "{not json");
await assert.rejects(() => readSocialAccounts(), SocialsFileCorruptError);
await assert.rejects(
  () => createSocialAccount({ platform: "telegram", handle: "chan", method: "api-token" }),
  SocialsFileCorruptError,
  "writes must refuse to clobber a corrupt definitions file",
);
assert.equal(await readFile(DEFINITIONS_FILE, "utf8"), "{not json", "corrupt file left untouched");

console.log("socials store tests passed");
