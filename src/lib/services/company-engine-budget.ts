import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Engine-side API budget snapshots, pushed by a company's OWN deterministic
 * engine (e.g. maps-agency's hivemind_bridge.py). This is the engine's local
 * hard-cap meter — every billed provider call is metered in the engine's
 * process, stopped at a per-SKU daily cap and a monthly USD ceiling — surfaced
 * here so the ZHC Limits tab shows one pane of glass. Distinct from
 * company-api-usage.ts (crew-side reserved/observed rows, enforced by
 * company_api_preflight) and from provider-side Google quotas/budgets (the
 * real backstop, managed via the Google Cloud guardrails section).
 */
export interface CompanyEngineBudgetSnapshot {
  /** Engine-facing provider slug, e.g. "google-places". */
  providerKey: string;
  /** Human label for the Limits tab, e.g. "maps-agency Google Places meter". */
  label?: string;
  /** Month the meter is tracking, "YYYY-MM". */
  month: string;
  monthEstCostUsd: number;
  monthlyCeilingUsd: number;
  /** Day the per-SKU counters cover, "YYYY-MM-DD". */
  dayDate: string;
  /** Calls made today, keyed by SKU/metric. */
  dayCalls: Record<string, number>;
  /** Per-day hard caps, keyed by SKU/metric. */
  dailyCallCaps: Record<string, number>;
  /** True when the provider itself is rejecting calls (e.g. PERMISSION_DENIED). */
  lockdown: boolean;
  lockdownReason?: string;
  /** Where the engine's caps are edited (repo-relative), shown as guidance. */
  configPath?: string;
  /** ISO timestamp of the engine's report. */
  updatedAt: string;
}

const STORE_PATH = path.join(homedir(), ".hivemindos", "company-engine-budgets.json");

const MAX_STRING = 300;
const MAX_COUNTER_ENTRIES = 32;

function cleanString(value: unknown, max = MAX_STRING): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function cleanNumber(value: unknown): number | undefined {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) && num >= 0 ? num : undefined;
}

function cleanCounters(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_COUNTER_ENTRIES) break;
    const name = key.trim().slice(0, 64);
    const num = cleanNumber(raw);
    if (name && num !== undefined) out[name] = Math.floor(num);
  }
  return out;
}

/** Bounds-check an engine-pushed snapshot; null when structurally unusable. */
export function validateEngineBudgetSnapshot(raw: unknown): CompanyEngineBudgetSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const providerKey = cleanString(record.providerKey, 64);
  const month = cleanString(record.month, 10);
  const dayDate = cleanString(record.dayDate, 10);
  const updatedAt = cleanString(record.updatedAt, 40);
  const monthEstCostUsd = cleanNumber(record.monthEstCostUsd);
  const monthlyCeilingUsd = cleanNumber(record.monthlyCeilingUsd);
  if (!providerKey || !month || !dayDate || !updatedAt) return null;
  if (monthEstCostUsd === undefined || monthlyCeilingUsd === undefined) return null;
  return {
    providerKey,
    label: cleanString(record.label, 120),
    month,
    monthEstCostUsd,
    monthlyCeilingUsd,
    dayDate,
    dayCalls: cleanCounters(record.dayCalls),
    dailyCallCaps: cleanCounters(record.dailyCallCaps),
    lockdown: record.lockdown === true,
    lockdownReason: cleanString(record.lockdownReason),
    configPath: cleanString(record.configPath, 200),
    updatedAt,
  };
}

async function readStore(): Promise<Record<string, CompanyEngineBudgetSnapshot>> {
  let text: string;
  try {
    text = await fs.readFile(STORE_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.error("[company-engine-budget] unreadable store:", error);
    }
    return {};
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, CompanyEngineBudgetSnapshot> = {};
    for (const [companyId, value] of Object.entries(parsed)) {
      const snapshot = validateEngineBudgetSnapshot(value);
      if (snapshot) out[companyId] = snapshot;
    }
    return out;
  } catch (error) {
    console.error("[company-engine-budget] corrupt store, ignoring:", error);
    return {};
  }
}

export async function readCompanyEngineBudgetSnapshot(
  companyId: string,
): Promise<CompanyEngineBudgetSnapshot | null> {
  return (await readStore())[companyId] ?? null;
}

export async function recordCompanyEngineBudgetSnapshot(
  companyId: string,
  snapshot: CompanyEngineBudgetSnapshot,
): Promise<void> {
  const store = await readStore();
  store[companyId] = snapshot;
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true, mode: 0o700 });
  const tmp = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  await fs.rename(tmp, STORE_PATH);
}
