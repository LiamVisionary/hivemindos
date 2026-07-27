import "server-only";

import {
  readStoredAgentProfiles,
  removeStoredAgentProfile,
  upsertStoredAgentProfile,
} from "@/lib/services/agent-profile-store";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { Company, CompanyMember } from "@/lib/types/company";

/**
 * Company CEO ("company queen") seeding — every zero-human company owns a real
 * stored AgentProfile cloned from the user's MAIN fleet queen, plus a
 * non-removable "Queen" member row in the company roster. The clone answers
 * the company-scoped Queen chat (typed-chat-turn.ts) as the company's
 * accountable executive.
 *
 * Import shape: companies-store.ts statically imports the pure helpers below
 * (member-list seeding inside its own mutations), so THIS module must only
 * reach companies-store through dynamic import — a static import each way
 * would be a cycle.
 */

const QUEEN_ROLE_RE = /queen/i;

/** Deterministic per-company clone id (companyIds are UUIDs; 8 chars is unique enough and keeps the id readable). */
export function companyQueenAgentId(companyId: string): string {
  return `company-queen-${companyId.slice(0, 8)}`;
}

/** Is this stored profile a company's cloned CEO queen? */
export function isCompanyQueenProfile(profile: Pick<AgentProfile, "companyQueenOf">): boolean {
  return Boolean(profile.companyQueenOf?.trim());
}

/**
 * Pure member-list seeding, used by companies-store inside upsert/set-members
 * so the queen member is impossible to remove through the API:
 * - a member already holding a /queen/i role is RE-POINTED to the clone id,
 *   and any other member reporting to the old queen id is remapped to it;
 * - otherwise the clone member is prepended (CEO first).
 * Idempotent: returns `changed: false` (same array) when already seeded.
 */
export function ensureCompanyQueenMemberList(
  companyId: string,
  members: CompanyMember[],
): { members: CompanyMember[]; changed: boolean } {
  const cloneId = companyQueenAgentId(companyId);
  const clonePresent = members.some((member) => member.agentId === cloneId);
  const queenMember = members.find((member) => QUEEN_ROLE_RE.test(member.roleInCompany ?? ""));
  if (clonePresent && (!queenMember || queenMember.agentId === cloneId)) {
    return { members, changed: false };
  }
  if (queenMember && queenMember.agentId !== cloneId) {
    const oldQueenId = queenMember.agentId;
    const seen = new Set<string>();
    const repointed: CompanyMember[] = [];
    for (const member of members) {
      const next: CompanyMember =
        member === queenMember
          ? {
              ...member,
              agentId: cloneId,
              // A queen that reported to itself would now self-reference; CEOs report to no one.
              reportsTo: member.reportsTo === oldQueenId ? null : (member.reportsTo ?? null),
            }
          : member.reportsTo === oldQueenId
            ? { ...member, reportsTo: cloneId }
            : member;
      // Re-pointing can collide with an existing clone row — first occurrence wins.
      if (seen.has(next.agentId)) continue;
      seen.add(next.agentId);
      repointed.push(next);
    }
    return { members: repointed, changed: true };
  }
  if (clonePresent) return { members, changed: false };
  return {
    members: [{ agentId: cloneId, roleInCompany: "Queen", reportsTo: null }, ...members],
    changed: true,
  };
}

/** Agent-ids variant of the guard for member-free rosters: keeps the clone id on the list. */
export function companyAgentIdsWithQueen(companyId: string, agentIds: string[]): string[] {
  const cloneId = companyQueenAgentId(companyId);
  return agentIds.includes(cloneId) ? agentIds : [cloneId, ...agentIds];
}

/**
 * Ensure the company's cloned CEO AgentProfile exists in the profile store and
 * return it. The clone spreads the FULL main fleet queen profile (runtime,
 * provider/model, gateway, adaptive config, soul…), then overrides identity
 * and strips fleet-crown/session state:
 * - `beeRole` is DELETED — that field is the fleet crown and must never
 *   appear on a company clone;
 * - `queenNameCustomized`, `sessionKey`, `memoryForkedFromAgentId` are
 *   deleted so the clone gets its own name/session/memory lineage.
 */
export async function ensureCompanyQueenAgent(
  company: Pick<Company, "id" | "name">,
): Promise<AgentProfile> {
  const id = companyQueenAgentId(company.id);
  const profiles = await readStoredAgentProfiles();
  const existing = profiles.find((profile) => profile.id === id);
  if (existing) return existing;
  const mainQueen =
    profiles.find((profile) => profile.beeRole === "queen") ??
    // Name fallback must skip other companies' clones ("Acme Queen"), or a
    // crown-less install would chain-clone company queens into each other.
    profiles.find((profile) => !isCompanyQueenProfile(profile) && QUEEN_ROLE_RE.test(profile.name ?? "")) ??
    null;
  // No fleet queen stored yet (fresh install / stripped fixture): fall back to
  // a minimal Hermes-shaped default so the company still gets a working CEO
  // profile; the clone keeps its id, so a later real fleet queen never
  // retroactively rewrites it.
  const base: AgentProfile = mainQueen ?? { id, name: "Queen", runtime: "hermes", gatewayUrl: "" };
  const clone: AgentProfile = {
    ...base,
    id,
    name: `${company.name} Queen`,
    companyQueenOf: company.id,
  };
  delete clone.beeRole;
  delete clone.queenNameCustomized;
  delete clone.sessionKey;
  delete clone.memoryForkedFromAgentId;
  return upsertStoredAgentProfile(clone);
}

/** Companies whose clone profile was confirmed recently — skips the
 *  (potentially very large) dashboard-state read on every subsequent poll.
 *  TTL, not forever: another dashboard server running older code can rewrite
 *  the profile store WITHOUT the seeded queens (observed 2026-07-26 — the
 *  clone vanished between two polls), and a permanent memo would leave this
 *  process believing the profile still exists until restart. */
const ensuredCompanyQueenProfileAt = new Map<string, number>();
const ENSURED_PROFILE_TTL_MS = 60_000;

/**
 * Ensure ONE company's queen: the stored clone profile (re-verified at most
 * once per TTL window) and the non-removable member row (persisted through
 * setCompanyAgents — the store's sanctioned member-replacing mutation — only
 * when something changed). Returns the possibly-updated company.
 */
export async function ensureCompanyQueen(company: Company): Promise<Company> {
  const verifiedAt = ensuredCompanyQueenProfileAt.get(company.id) ?? 0;
  if (Date.now() - verifiedAt > ENSURED_PROFILE_TTL_MS) {
    await ensureCompanyQueenAgent(company);
    ensuredCompanyQueenProfileAt.set(company.id, Date.now());
  }
  const baseline: CompanyMember[] = company.members?.length
    ? company.members
    : (company.agentIds ?? []).map((agentId) => ({ agentId }));
  const ensured = ensureCompanyQueenMemberList(company.id, baseline);
  if (!ensured.changed) return company;
  const { setCompanyAgents } = await import("@/lib/services/companies-store");
  const updated = await setCompanyAgents(company.id, [], ensured.members);
  return updated ?? company;
}

/**
 * Sweep every company (GET /api/companies self-heal): ensure each one's queen
 * agent + member. Cheap once settled — the profile check is memoized and the
 * member check is pure, so a steady-state poll does no store writes.
 * Sequential on purpose: each member fix is a read-modify-write of the shared
 * definitions file (same reasoning as product seeding in the route).
 */
export async function ensureAllCompanyQueens(companies?: Company[]): Promise<Company[]> {
  const list = companies ?? (await (await import("@/lib/services/companies-store")).readCompanies());
  const out: Company[] = [];
  for (const company of list) {
    out.push(await ensureCompanyQueen(company).catch(() => company));
  }
  return out;
}

/**
 * Delete-side cleanup: drop the company's clone profile and its memo entry so
 * a re-created company with the same id re-seeds cleanly.
 */
export async function removeCompanyQueenAgent(companyId: string): Promise<boolean> {
  ensuredCompanyQueenProfileAt.delete(companyId);
  return removeStoredAgentProfile(companyQueenAgentId(companyId));
}
