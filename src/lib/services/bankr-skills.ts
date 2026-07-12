import { bankrApiKey } from "@/lib/services/bankr-llm";
import type {
  BankrSkillCatalogItem,
  BankrSkillInstallType,
  BankrSkillsSnapshot,
} from "@/lib/types/bankr-skills";

const BANKR_API_BASE = "https://api.bankr.bot";
const BANKR_SKILL_LIMIT = 50;
const BANKR_REQUEST_TIMEOUT_MS = 15_000;

type BankrSkillsDeps = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

type InstalledSkill = {
  slug: string;
  sourceCatalogSlug: string;
};

type InternalCatalogSkill = BankrSkillCatalogItem & { repoUrl: string };

export async function getBankrSkillsSnapshot(deps: BankrSkillsDeps = {}): Promise<BankrSkillsSnapshot> {
  const apiKey = deps.apiKey ?? await bankrApiKey();
  const catalogPromise = readBankrSkillCatalog(deps);
  const installedPromise = apiKey
    ? readBankrInstalledSkills(apiKey, deps).then((skills) => ({ skills, error: "" })).catch((error) => ({
      skills: [] as InstalledSkill[],
      error: error instanceof Error ? error.message : "Could not read installed Bankr skills.",
    }))
    : Promise.resolve({ skills: [] as InstalledSkill[], error: "" });
  const [catalog, installedResult] = await Promise.all([catalogPromise, installedPromise]);
  const installedKeys = new Map<string, string>();
  for (const installed of installedResult.skills) {
    if (installed.slug) installedKeys.set(installed.slug, installed.slug);
    if (installed.sourceCatalogSlug) installedKeys.set(installed.sourceCatalogSlug, installed.slug);
  }
  const skills = catalog.map((skill) => {
    const installedSlug = installedKeys.get(skill.catalogSlug) || installedKeys.get(skill.displaySlug) || "";
    return { ...skill, installed: Boolean(installedSlug), installedSlug };
  });
  return {
    configured: Boolean(apiKey),
    skills,
    installedCount: installedResult.skills.length,
    installedLimit: BANKR_SKILL_LIMIT,
    accountError: installedResult.error,
  };
}

export async function installBankrCatalogSkill(catalogSlug: string, deps: BankrSkillsDeps = {}) {
  const normalizedSlug = catalogSlug.trim();
  if (!normalizedSlug || normalizedSlug.length > 240) throw new Error("Choose a valid Bankr catalogue skill.");
  const apiKey = deps.apiKey ?? await bankrApiKey();
  if (!apiKey) throw new Error("Set BANKR_API_KEY, BANKR_LLM_KEY, or BANKR_MANAGEMENT_KEY before installing Bankr skills.");
  const catalog = await readBankrSkillCatalog(deps);
  const skill = catalog.find((candidate) => candidate.catalogSlug === normalizedSlug);
  if (!skill) throw new Error("That skill is no longer available in the Bankr catalogue.");

  let body: Record<string, string>;
  if (skill.installType === "agent-skill") {
    body = { catalogSlug: skill.catalogSlug };
  } else {
    const repoUrl = skill.repoUrl || skill.sourceUrl;
    if (!repoUrl) throw new Error("Bankr did not provide an install source for this skill.");
    body = { repoUrl, catalogSlug: skill.catalogSlug, provider: skill.provider };
  }
  await bankrRequest("/skills/import", {
    apiKey,
    fetchImpl: deps.fetchImpl,
    init: { method: "POST", body: JSON.stringify(body) },
  });
  return { ...skill, installed: true, installedSlug: skill.displaySlug };
}

async function readBankrSkillCatalog(deps: BankrSkillsDeps) {
  const payload = await bankrRequest("/skills/catalog", { fetchImpl: deps.fetchImpl });
  const skills = asArray(asRecord(payload).skills).map(parseCatalogSkill).filter((skill): skill is InternalCatalogSkill => Boolean(skill));
  if (!skills.length) throw new Error("Bankr returned an empty skills catalogue.");
  return skills;
}

async function readBankrInstalledSkills(apiKey: string, deps: BankrSkillsDeps) {
  const payload = await bankrRequest("/skills", { apiKey, fetchImpl: deps.fetchImpl });
  return asArray(asRecord(payload).skills).map((value) => {
    const record = asRecord(value);
    return {
      slug: stringValue(record.slug),
      sourceCatalogSlug: stringValue(record.sourceCatalogSlug),
    };
  }).filter((skill) => skill.slug || skill.sourceCatalogSlug);
}

function parseCatalogSkill(value: unknown): InternalCatalogSkill | null {
  const record = asRecord(value);
  const catalogSlug = stringValue(record.slug);
  if (!catalogSlug) return null;
  const install = asRecord(record.install);
  const installType = normalizeInstallType(install.type);
  const name = stringValue(record.name) || catalogSlug;
  const provider = stringValue(record.provider) || "Community";
  const repoUrl = safeHttpUrl(record.repoUrl);
  const ownerWallet = stringValue(install.ownerWallet);
  const publicUrl = installType === "agent-skill" && ownerWallet
    ? `https://bankr.bot/skills/${encodeURIComponent(ownerWallet)}/${encodeURIComponent(name)}`
    : "";
  return {
    catalogSlug,
    displaySlug: installType === "agent-skill" ? name : catalogSlug,
    name,
    provider,
    description: stringValue(record.description),
    providerUrl: safeHttpUrl(record.providerUrl),
    sourceUrl: repoUrl || publicUrl,
    publicUrl,
    logoUrl: safeHttpUrl(record.logoUrl),
    installType,
    featured: record.featured === true,
    installCount: finiteNumber(record.installCount),
    installed: false,
    installedSlug: "",
    repoUrl,
  };
}

function normalizeInstallType(value: unknown): BankrSkillInstallType {
  return value === "agent-skill" || value === "external" ? value : "bankr";
}

async function bankrRequest(path: string, options: { apiKey?: string; fetchImpl?: typeof fetch; init?: RequestInit }) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${BANKR_API_BASE}${path}`, {
    ...options.init,
    headers: {
      "Content-Type": "application/json",
      ...(options.apiKey ? { "X-API-Key": options.apiKey } : {}),
      ...(options.init?.headers ?? {}),
    },
    signal: options.init?.signal ?? AbortSignal.timeout(BANKR_REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    const record = asRecord(payload);
    throw new Error(stringValue(record.error) || stringValue(record.message) || `Bankr returned HTTP ${response.status}.`);
  }
  return payload;
}

function safeHttpUrl(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
