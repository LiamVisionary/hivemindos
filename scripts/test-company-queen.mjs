#!/usr/bin/env node
// Hermetic coverage for the company CEO ("company queen") seeding rail:
// - deterministic clone-id derivation (companyQueenAgentId / companyAgentIdsWithQueen)
// - ensureCompanyQueenAgent clones the MAIN fleet queen (identity overridden,
//   fleet crown + session/memory lineage stripped), is idempotent, and never
//   chain-clones another company's queen when the crown is absent
// - ensureCompanyQueenMemberList prepends or re-points the Queen member,
//   remaps reportsTo, dedupes collisions, and is idempotent
// - the queen member is impossible to remove through the store API
//   (upsertCompany seeding + the setCompanyAgents guard, both member-list and
//   agentIds-only shapes), and deleteCompany removes the cloned profile
// - the company CEO chat tool defs keep their contract (names, required params,
//   chat-completions nesting)
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

// Isolate every store BEFORE the imports below: the dashboard-state and
// companies stores bind HOME at module load, and vault mode is decided by
// NEXT_PUBLIC_OBSIDIAN_VAULT_PATH (the established company-suite pattern).
const tempHome = await mkdtemp(join(tmpdir(), "hivemind-company-queen-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-company-queen-vault-"));
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;
process.env.QUEEN_BEE_AUTONOMOUS_PICKUP = "0";
await mkdir(join(tempHome, ".hivemindos"), { recursive: true });

const {
  companyAgentIdsWithQueen,
  companyQueenAgentId,
  ensureAllCompanyQueens,
  ensureCompanyQueenAgent,
  ensureCompanyQueenMemberList,
  isCompanyQueenProfile,
} = await import("../src/lib/services/company-queen.ts");
const {
  readStoredAgentProfiles,
  removeStoredAgentProfile,
  upsertStoredAgentProfile,
} = await import("../src/lib/services/agent-profile-store.ts");
const { deleteCompany, getCompany, setCompanyAgents, upsertCompany } = await import(
  "../src/lib/services/companies-store.ts"
);
const { COMPANY_CEO_CHAT_TOOL_DEFS, companyCeoChatTools } = await import(
  "../src/lib/services/queen-bee/queen-brain.ts"
);

// ---------------------------------------------------------------------------
// Clone-id derivation
// ---------------------------------------------------------------------------
{
  assert.equal(companyQueenAgentId("0a1b2c3d-4e5f-6789-abcd-ef0123456789"), "company-queen-0a1b2c3d");
  assert.equal(companyQueenAgentId("co-x"), "company-queen-co-x", "short ids stay intact");
  assert.deepEqual(
    companyAgentIdsWithQueen("co-x", ["w1"]),
    ["company-queen-co-x", "w1"],
    "agentIds guard prepends the clone id",
  );
  const already = ["company-queen-co-x", "w1"];
  assert.equal(companyAgentIdsWithQueen("co-x", already), already, "present clone id → same array back");
}

// ---------------------------------------------------------------------------
// ensureCompanyQueenMemberList: prepend / re-point / remap / dedupe / idempotent
// ---------------------------------------------------------------------------
{
  const cloneId = companyQueenAgentId("co-x");

  // No queen-role member → clone prepended (CEO first).
  const prepended = ensureCompanyQueenMemberList("co-x", [{ agentId: "w1" }]);
  assert.equal(prepended.changed, true);
  assert.deepEqual(prepended.members[0], { agentId: cloneId, roleInCompany: "Queen", reportsTo: null });
  assert.equal(prepended.members[1].agentId, "w1");

  // Existing /queen/i member → re-pointed to the clone id; reportsTo remapped.
  const repointed = ensureCompanyQueenMemberList("co-x", [
    { agentId: "old-queen", roleInCompany: "Queen Bee", reportsTo: "old-queen", companyCap: 25 },
    { agentId: "w1", reportsTo: "old-queen" },
    { agentId: "w2", reportsTo: "w1" },
  ]);
  assert.equal(repointed.changed, true);
  assert.deepEqual(
    repointed.members.map((m) => m.agentId),
    [cloneId, "w1", "w2"],
    "queen re-pointed in place, no member dropped",
  );
  assert.equal(repointed.members[0].companyCap, 25, "re-point keeps the member's metadata");
  assert.equal(repointed.members[0].reportsTo, null, "a self-reporting queen ends up reporting to no one");
  assert.equal(repointed.members[1].reportsTo, cloneId, "reportsTo remapped from the old queen id");
  assert.equal(repointed.members[2].reportsTo, "w1", "unrelated reportsTo untouched");

  // Re-point collision with an existing clone row → exactly one clone row survives.
  const collided = ensureCompanyQueenMemberList("co-x", [
    { agentId: cloneId },
    { agentId: "impostor", roleInCompany: "Queen" },
    { agentId: "w3", reportsTo: "impostor" },
  ]);
  assert.equal(collided.changed, true);
  assert.deepEqual(collided.members.map((m) => m.agentId), [cloneId, "w3"]);
  assert.equal(collided.members[1].reportsTo, cloneId, "reportsTo remapped even when the re-point collides");

  // Idempotent: a seeded list comes back unchanged (same array identity).
  const settled = ensureCompanyQueenMemberList("co-x", prepended.members);
  assert.equal(settled.changed, false);
  assert.equal(settled.members, prepended.members, "no-op returns the same array");
}

// ---------------------------------------------------------------------------
// ensureCompanyQueenAgent: clones the main fleet queen, idempotently
// ---------------------------------------------------------------------------
await upsertStoredAgentProfile({
  id: "agent-queen-main",
  name: "Solara",
  runtime: "hermes",
  gatewayUrl: "http://127.0.0.1:9",
  provider: "venice",
  model: "sol-1",
  beeRole: "queen",
  queenNameCustomized: true,
  sessionKey: "sess-main",
  memoryForkedFromAgentId: "elder-queen",
  soulPrompt: "Royal soul",
});

const acme = await upsertCompany({ name: "Acme Web", agentIds: ["w1"] });
const acmeCloneId = companyQueenAgentId(acme.id);
{
  // upsertCompany seeded the member on creation…
  assert.equal(acme.members?.[0]?.agentId, acmeCloneId, "created company leads with its queen member");
  assert.equal(acme.members?.[0]?.roleInCompany, "Queen");
  assert.ok(acme.agentIds.includes(acmeCloneId), "agentIds kept in sync with the seeded member");
  assert.ok(acme.agentIds.includes("w1"));

  // …and the cloned profile after the write.
  const profiles = await readStoredAgentProfiles();
  const clone = profiles.find((p) => p.id === acmeCloneId);
  assert.ok(clone, "cloned CEO profile persisted");
  assert.equal(clone.name, "Acme Web Queen");
  assert.equal(clone.companyQueenOf, acme.id);
  assert.ok(isCompanyQueenProfile(clone));
  assert.equal(clone.provider, "venice", "clone inherits the main queen's provider");
  assert.equal(clone.model, "sol-1", "clone inherits the main queen's model");
  assert.equal(clone.soulPrompt, "Royal soul", "clone inherits the soul");
  assert.equal(clone.beeRole, undefined, "the fleet crown is never cloned");
  assert.equal(clone.queenNameCustomized, undefined, "rename marker stripped");
  assert.equal(clone.sessionKey, undefined, "session identity stripped");
  assert.equal(clone.memoryForkedFromAgentId, undefined, "memory lineage stripped");
  assert.equal(
    profiles.filter((p) => p.beeRole === "queen").length,
    1,
    "exactly one fleet queen remains",
  );

  // Idempotent: a second ensure returns the stored clone, no duplicate row.
  const again = await ensureCompanyQueenAgent(acme);
  assert.equal(again.id, acmeCloneId);
  assert.equal(again.name, "Acme Web Queen");
  const recount = await readStoredAgentProfiles();
  assert.equal(recount.filter((p) => p.id === acmeCloneId).length, 1, "no duplicate clone rows");
}

// ---------------------------------------------------------------------------
// Non-removable guard: the queen member survives every member-replacing write
// ---------------------------------------------------------------------------
{
  // Member-list write that drops the queen → re-added.
  const replaced = await setCompanyAgents(acme.id, [], [{ agentId: "w2" }]);
  assert.ok(replaced, "company found");
  assert.equal(replaced.members?.[0]?.agentId, acmeCloneId, "queen re-added when the incoming list dropped it");
  assert.deepEqual(
    replaced.members?.map((m) => m.agentId),
    [acmeCloneId, "w2"],
  );

  // agentIds-only write → clone id kept on the roster, member metadata survives.
  const idsOnly = await setCompanyAgents(acme.id, ["w3"], undefined);
  assert.ok(idsOnly.agentIds.includes(acmeCloneId), "agentIds-only write keeps the clone id");
  assert.ok(idsOnly.agentIds.includes("w3"));
  assert.equal(
    idsOnly.members?.some((m) => m.agentId === acmeCloneId),
    true,
    "queen member row survives the agentIds-only reshape",
  );

  // A member list nominating an impostor queen → re-pointed to the clone.
  const impostor = await setCompanyAgents(acme.id, [], [
    { agentId: "impostor", roleInCompany: "Queen" },
    { agentId: "w5", reportsTo: "impostor" },
  ]);
  assert.deepEqual(impostor.members?.map((m) => m.agentId), [acmeCloneId, "w5"]);
  assert.equal(impostor.members?.[1]?.reportsTo, acmeCloneId, "reportsTo follows the re-point");

  // upsertCompany update path with a queen-less member list → re-added too.
  const upserted = await upsertCompany({ id: acme.id, name: "Acme Web", members: [{ agentId: "w6" }] });
  assert.deepEqual(upserted.members?.map((m) => m.agentId), [acmeCloneId, "w6"]);
}

// ---------------------------------------------------------------------------
// ensureAllCompanyQueens: heals a legacy company that predates the rail
// ---------------------------------------------------------------------------
{
  // Simulate a pre-rail company by writing it straight into the replicated
  // definitions file (no queen member, no cloned profile).
  const definitionsFile = join(vaultPath, "Operations", "Companies", "companies.json");
  const definitions = JSON.parse(await readFile(definitionsFile, "utf8"));
  definitions.push({
    id: "co-legacy-9",
    name: "Legacy Lawn Care",
    agentIds: ["legacy-worker"],
    frozen: false,
    createdAt: new Date(1_700_000_000_000).toISOString(),
    createdAtMs: 1_700_000_000_000,
    updatedAt: new Date(1_700_000_000_000).toISOString(),
  });
  await writeFile(definitionsFile, JSON.stringify(definitions, null, 2));

  await ensureAllCompanyQueens();
  const healed = await getCompany("co-legacy-9");
  const legacyCloneId = companyQueenAgentId("co-legacy-9");
  assert.equal(healed?.members?.[0]?.agentId, legacyCloneId, "sweep seeded the queen member");
  assert.ok(healed?.agentIds.includes("legacy-worker"), "existing roster preserved");
  const profiles = await readStoredAgentProfiles();
  assert.ok(profiles.some((p) => p.id === legacyCloneId), "sweep created the cloned profile");

  // Steady state: a second sweep changes nothing.
  const before = JSON.stringify(await getCompany("co-legacy-9"));
  await ensureAllCompanyQueens();
  assert.equal(JSON.stringify(await getCompany("co-legacy-9")), before, "sweep is idempotent");
}

// ---------------------------------------------------------------------------
// deleteCompany removes the cloned profile; crown-less fallback never
// chain-clones another company's queen
// ---------------------------------------------------------------------------
{
  assert.equal(await deleteCompany(acme.id), true);
  const profiles = await readStoredAgentProfiles();
  assert.ok(!profiles.some((p) => p.id === acmeCloneId), "clone profile dies with its company");
  assert.ok(profiles.some((p) => p.id === "agent-queen-main"), "the fleet queen is untouched");
  assert.equal(await removeStoredAgentProfile("never-existed"), false, "missing id removal reports false");

  // Crown-less install: with no fleet queen stored, a new company falls back to
  // the minimal default instead of cloning "Legacy Lawn Care Queen".
  assert.equal(await removeStoredAgentProfile("agent-queen-main"), true);
  const fallbackCo = await upsertCompany({ name: "Fallback Co" });
  const fallbackClone = (await readStoredAgentProfiles()).find(
    (p) => p.id === companyQueenAgentId(fallbackCo.id),
  );
  assert.ok(fallbackClone, "crown-less install still seeds a CEO profile");
  assert.equal(fallbackClone.name, "Fallback Co Queen");
  assert.equal(fallbackClone.runtime, "hermes", "minimal default runtime");
  assert.equal(fallbackClone.provider, undefined, "did NOT clone another company's queen");
  assert.equal(fallbackClone.companyQueenOf, fallbackCo.id);
}

// ---------------------------------------------------------------------------
// Company CEO chat tool contract
// ---------------------------------------------------------------------------
{
  assert.deepEqual(
    COMPANY_CEO_CHAT_TOOL_DEFS.map((t) => t.name),
    ["company_add_directive", "company_update_charter", "company_dispatch_goal"],
  );
  const byName = Object.fromEntries(COMPANY_CEO_CHAT_TOOL_DEFS.map((t) => [t.name, t]));
  assert.deepEqual(byName.company_add_directive.parameters.required, ["text"]);
  assert.equal(byName.company_add_directive.parameters.properties.skills.type, "array");
  assert.deepEqual(byName.company_update_charter.parameters.required, ["charter"]);
  assert.deepEqual(byName.company_dispatch_goal.parameters.required, []);
  assert.ok("note" in byName.company_dispatch_goal.parameters.properties);

  for (const tool of companyCeoChatTools()) {
    assert.equal(tool.type, "function", "chat-completions nesting");
    assert.ok(tool.function.name && tool.function.description && tool.function.parameters);
  }
}

console.log("test-company-queen: all assertions passed");
