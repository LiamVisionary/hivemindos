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
  createSocialAccount,
  deleteSocialAccount,
  getSocialAccount,
  mutateSocialQueue,
  newContextSource,
  readSocialAccounts,
  readSocialQueue,
  readSocialQueueMeta,
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
assert.equal(created.maxDailyReadOps, DEFAULT_MAX_DAILY_READ_OPS);
assert.equal(created.awakeHours.enabled, false);
assert.deepEqual(created.contextSources, []);

// Definitions landed in the vault file, not the local fallback.
await access(DEFINITIONS_FILE);
const onDisk = JSON.parse(await readFile(DEFINITIONS_FILE, "utf8"));
assert.equal(onDisk.length, 1);
assert.equal(onDisk[0].id, "x:testhandle");

// Duplicate create is refused.
await assert.rejects(() => createSocialAccount({ platform: "x", handle: "testhandle", method: "api-token" }), /already exists/);

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
const vaultHasQueue = JSON.parse(await readFile(DEFINITIONS_FILE, "utf8"));
assert.ok(Array.isArray(vaultHasQueue) && vaultHasQueue.every((record) => !record.queue), "queue never replicates into the vault file");

// Deleting the account clears its queue items.
await deleteSocialAccount("x:testhandle");
assert.equal((await readSocialAccounts()).length, 0);
assert.equal((await readSocialQueue()).length, 0);

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
