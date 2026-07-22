import "server-only";

import { randomUUID } from "node:crypto";

import { titlesSimilar } from "@/lib/services/company-task-dedup";
import {
  mutateRecordsFile,
  readRecordsFile,
  resolveMarketplaceStorage,
} from "@/lib/services/marketplace/marketplace-store-io";
import { isMarketplaceProvider } from "@/lib/services/marketplace/marketplace-provider-matrix";
import {
  DEFAULT_MARKETPLACE_MONITOR_CONFIG,
  MARKETPLACE_CHAT_AUTONOMY_MODES,
  MARKETPLACE_CONNECT_METHODS,
  normalizeMarketplaceMonitorConfig,
  type MarketplaceAccount,
  type MarketplaceChatAutonomy,
  type MarketplaceConnectMethod,
  type MarketplaceDirective,
  type MarketplaceLocalePreference,
  type MarketplaceMachineBinding,
  type MarketplaceMonitorConfig,
  type MarketplaceNegotiationBounds,
  type MarketplaceProvider,
} from "@/lib/services/marketplace/marketplace-types";

/**
 * Marketplace accounts + standing directives (vault-replicated definitions).
 * Storage model documented in marketplace-store-io.ts.
 *
 * Policy invariants enforced here:
 * - An unknown autonomy value degrades to "review-all" (fail toward MORE human
 *   review, mirroring the socials auto→manual degradation).
 * - A record without a usable machine binding (machineKey + profileName) is
 *   dropped — an account that cannot execute anywhere is malformed.
 */

const ACCOUNTS_FILE = "marketplace.json";
const DIRECTIVES_FILE = "directives.json";

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

function isConnectMethod(value: unknown): value is MarketplaceConnectMethod {
  return typeof value === "string" && (MARKETPLACE_CONNECT_METHODS as readonly string[]).includes(value);
}

function isAutonomy(value: unknown): value is MarketplaceChatAutonomy {
  return typeof value === "string" && (MARKETPLACE_CHAT_AUTONOMY_MODES as readonly string[]).includes(value);
}

function normalizeMachineBinding(raw: unknown): MarketplaceMachineBinding | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const machineKey = typeof record.machineKey === "string" ? record.machineKey.trim() : "";
  const profileName = typeof record.profileName === "string" ? record.profileName.trim() : "";
  if (!machineKey || !profileName) return null;
  return {
    machineKey,
    machineName: typeof record.machineName === "string" && record.machineName.trim() ? record.machineName.trim() : machineKey,
    collectorUrl: typeof record.collectorUrl === "string" ? record.collectorUrl.trim() : "",
    profileName,
  };
}

function normalizeLocale(raw: unknown): MarketplaceLocalePreference {
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    return {
      description: typeof record.description === "string" ? record.description.trim() : "",
      globalComparison: record.globalComparison === true,
    };
  }
  return { description: "", globalComparison: false };
}

function normalizeNegotiation(raw: unknown): MarketplaceNegotiationBounds {
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const pct = record.globalMinOfferPct;
    if (typeof pct === "number" && Number.isFinite(pct) && pct > 0 && pct <= 100) {
      return { globalMinOfferPct: Math.round(pct) };
    }
  }
  return {};
}

export function normalizeMarketplaceAccountRecord(raw: unknown): MarketplaceAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id || !isMarketplaceProvider(record.provider)) return null;
  const machine = normalizeMachineBinding(record.machine);
  if (!machine) return null;
  const status = record.status === "connected" || record.status === "needs-attention" ? record.status : "disconnected";
  return {
    id,
    provider: record.provider,
    method: isConnectMethod(record.method) ? record.method : "browser-profile",
    status,
    ...(typeof record.displayName === "string" && record.displayName.trim() ? { displayName: record.displayName.trim() } : {}),
    ...(typeof record.socialAccountId === "string" && record.socialAccountId.trim() ? { socialAccountId: record.socialAccountId.trim() } : {}),
    ...(typeof record.preferredAgentName === "string" && record.preferredAgentName.trim() ? { preferredAgentName: record.preferredAgentName.trim() } : {}),
    machine,
    autonomy: isAutonomy(record.autonomy) ? record.autonomy : "review-all",
    negotiation: normalizeNegotiation(record.negotiation),
    monitor: normalizeMarketplaceMonitorConfig(record.monitor),
    locale: normalizeLocale(record.locale),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
  };
}

export async function readMarketplaceAccounts(): Promise<MarketplaceAccount[]> {
  const storage = resolveMarketplaceStorage(ACCOUNTS_FILE);
  const records = await readRecordsFile(storage.file, normalizeMarketplaceAccountRecord);
  return records.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
}

export async function getMarketplaceAccount(id: string): Promise<MarketplaceAccount | null> {
  const accounts = await readMarketplaceAccounts();
  return accounts.find((account) => account.id === id) ?? null;
}

export function marketplaceAccountId(provider: MarketplaceProvider, slug: string): string {
  const clean = slug.replace(/^@/, "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "account";
  return `${provider}:${clean}`;
}

export type CreateMarketplaceAccountInput = {
  provider: MarketplaceProvider;
  slug: string;
  method: MarketplaceConnectMethod;
  machine: MarketplaceMachineBinding;
  displayName?: string;
  socialAccountId?: string;
  localeDescription?: string;
};

export async function createMarketplaceAccount(input: CreateMarketplaceAccountInput): Promise<MarketplaceAccount> {
  const now = new Date().toISOString();
  const account: MarketplaceAccount = {
    id: marketplaceAccountId(input.provider, input.slug),
    provider: input.provider,
    method: input.method,
    status: "disconnected",
    ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
    ...(input.socialAccountId?.trim() ? { socialAccountId: input.socialAccountId.trim() } : {}),
    machine: { ...input.machine },
    // Default "autonomous" is an explicit product decision (2026-07-18): the
    // agent replies and negotiates on its own; the connect flow surfaces the
    // knob so the user can tighten it.
    autonomy: "autonomous",
    negotiation: {},
    monitor: { ...DEFAULT_MARKETPLACE_MONITOR_CONFIG, ladder: [...DEFAULT_MARKETPLACE_MONITOR_CONFIG.ladder] },
    locale: { description: input.localeDescription?.trim() ?? "", globalComparison: false },
    createdAt: now,
    updatedAt: now,
  };
  await mutateRecordsFile(ACCOUNTS_FILE, normalizeMarketplaceAccountRecord, (accounts) => {
    if (accounts.some((existing) => existing.id === account.id)) {
      throw new Error(`Marketplace account already exists: ${account.id}`);
    }
    return [...accounts, account];
  });
  return account;
}

export type UpdateMarketplaceAccountPatch = Partial<{
  status: MarketplaceAccount["status"];
  displayName: string;
  preferredAgentName: string;
  autonomy: MarketplaceChatAutonomy;
  negotiation: MarketplaceNegotiationBounds;
  monitor: MarketplaceMonitorConfig;
  locale: MarketplaceLocalePreference;
  machine: MarketplaceMachineBinding;
  socialAccountId: string;
}>;

export async function updateMarketplaceAccount(id: string, patch: UpdateMarketplaceAccountPatch): Promise<MarketplaceAccount | null> {
  let updated: MarketplaceAccount | null = null;
  await mutateRecordsFile(ACCOUNTS_FILE, normalizeMarketplaceAccountRecord, (accounts) =>
    accounts.map((account) => {
      if (account.id !== id) return account;
      const merged: MarketplaceAccount = {
        ...account,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() || undefined } : {}),
        ...(patch.preferredAgentName !== undefined ? { preferredAgentName: patch.preferredAgentName.trim() || undefined } : {}),
        ...(patch.autonomy !== undefined && isAutonomy(patch.autonomy) ? { autonomy: patch.autonomy } : {}),
        ...(patch.negotiation !== undefined ? { negotiation: normalizeNegotiation(patch.negotiation) } : {}),
        ...(patch.monitor !== undefined ? { monitor: normalizeMarketplaceMonitorConfig(patch.monitor) } : {}),
        ...(patch.locale !== undefined ? { locale: normalizeLocale(patch.locale) } : {}),
        ...(patch.machine !== undefined ? { machine: normalizeMachineBinding(patch.machine) ?? account.machine } : {}),
        ...(patch.socialAccountId !== undefined ? { socialAccountId: patch.socialAccountId.trim() || undefined } : {}),
        updatedAt: new Date().toISOString(),
      };
      updated = merged;
      return merged;
    }),
  );
  return updated;
}

export async function deleteMarketplaceAccount(id: string): Promise<boolean> {
  let removed = false;
  await mutateRecordsFile(ACCOUNTS_FILE, normalizeMarketplaceAccountRecord, (accounts) => {
    const next = accounts.filter((account) => account.id !== id);
    removed = next.length !== accounts.length;
    return next;
  });
  return removed;
}

// ---------------------------------------------------------------------------
// Standing directives
// ---------------------------------------------------------------------------

function normalizeDirectiveRecord(raw: unknown): MarketplaceDirective | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!id || !text) return null;
  const scope = record.scope === "account" ? "account" : "global";
  const accountId = typeof record.accountId === "string" ? record.accountId.trim() : "";
  if (scope === "account" && !accountId) return null;
  return {
    id,
    text,
    scope,
    ...(scope === "account" ? { accountId } : {}),
    source: record.source === "decision-note" ? "decision-note" : "inject",
    ...(typeof record.decisionRef === "string" && record.decisionRef.trim() ? { decisionRef: record.decisionRef.trim() } : {}),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
  };
}

export async function readMarketplaceDirectives(): Promise<MarketplaceDirective[]> {
  const storage = resolveMarketplaceStorage(DIRECTIVES_FILE);
  return readRecordsFile(storage.file, normalizeDirectiveRecord);
}

/** Directives that apply to one account: its own plus every global directive. */
export async function listMarketplaceDirectives(accountId: string): Promise<MarketplaceDirective[]> {
  const directives = await readMarketplaceDirectives();
  return directives.filter((directive) => directive.scope === "global" || directive.accountId === accountId);
}

export type AddMarketplaceDirectiveInput = {
  text: string;
  scope: "account" | "global";
  accountId?: string;
  source: MarketplaceDirective["source"];
  decisionRef?: string;
};

/**
 * Evolve, don't append (addCompanyDirective convention): a near-duplicate
 * replaces its older sibling in place so the standing context stays short.
 * High similarity bar (0.75): dropping a genuinely-new instruction is worse
 * than keeping an occasional near-dupe.
 */
export async function addMarketplaceDirective(input: AddMarketplaceDirectiveInput): Promise<MarketplaceDirective> {
  const text = input.text?.trim();
  if (!text) throw new Error("Directive text is required.");
  if (input.scope === "account" && !input.accountId?.trim()) throw new Error("Account-scoped directives need an accountId.");
  const entry: MarketplaceDirective = {
    id: `mdir_${randomUUID()}`,
    text,
    scope: input.scope,
    ...(input.scope === "account" ? { accountId: input.accountId!.trim() } : {}),
    source: input.source,
    ...(input.decisionRef?.trim() ? { decisionRef: input.decisionRef.trim() } : {}),
    createdAt: new Date().toISOString(),
  };
  await mutateRecordsFile(DIRECTIVES_FILE, normalizeDirectiveRecord, (directives) => {
    const duplicateOf = directives.find(
      (directive) =>
        directive.scope === entry.scope &&
        (directive.scope === "global" || directive.accountId === entry.accountId) &&
        titlesSimilar(directive.text, text, 0.75),
    );
    return duplicateOf
      ? directives.map((directive) => (directive.id === duplicateOf.id ? entry : directive))
      : [...directives, entry];
  });
  return entry;
}

export async function removeMarketplaceDirective(id: string): Promise<boolean> {
  let removed = false;
  await mutateRecordsFile(DIRECTIVES_FILE, normalizeDirectiveRecord, (directives) => {
    const next = directives.filter((directive) => directive.id !== id);
    removed = next.length !== directives.length;
    return next;
  });
  return removed;
}
