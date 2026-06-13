import { execFile } from "child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { promisify } from "util";
import { homedir } from "@/lib/home-dir";
import { MODEL_PROVIDER_GATEWAYS } from "@/lib/config/model-provider-gateways";
import { readStoredAgentProfiles } from "@/lib/services/agent-profile-store";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { SkillAuditFinding, SkillAuditSeverity } from "@/lib/types/skill-os";

const execFileAsync = promisify(execFile);

/**
 * Adapter around NVIDIA SkillSpector (https://github.com/NVIDIA/SkillSpector), a
 * security scanner for AI-agent skills. We run it as a CLI sidecar and fold its
 * findings into the existing HivemindOS skill-audit contract; the built-in regex
 * rules in skill-os.ts remain the fallback when the binary is absent.
 *
 * The optional LLM semantic pass has no hardcoded provider. It routes through the
 * user's agent: a subagent whose workerClass === "security" if one exists, else
 * the Queen Bee. That agent's provider/model/credential is mapped onto
 * SkillSpector's provider env vars, so the LLM pass uses exactly the model the
 * user already configured for security/coordination work.
 *
 * Install once on a machine: `git clone https://github.com/NVIDIA/SkillSpector
 * && cd SkillSpector && make install` (Python 3.12+), or point
 * HIVEMINDOS_SKILLSPECTOR_BIN at a wrapper. Detection degrades gracefully.
 */

export const SKILL_SECURITY_SETTINGS_FILE = join(homedir(), ".hivemindos", "skill-security.json");
const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");

export type SkillSecurityEngine = "auto" | "regex" | "skillspector";

export type SkillSecuritySettings = {
  /** auto = use SkillSpector when available, else regex; regex/skillspector force one engine. */
  engine: SkillSecurityEngine;
  /** Static analysis only by default; enable the slower/billed LLM semantic pass explicitly. */
  llm: boolean;
};

export const DEFAULT_SKILL_SECURITY_SETTINGS: SkillSecuritySettings = {
  engine: "auto",
  llm: false,
};

const SKILLSPECTOR_BIN = process.env.HIVEMINDOS_SKILLSPECTOR_BIN || "skillspector";
const SCAN_TIMEOUT_MS = 120_000;
const LLM_SCAN_TIMEOUT_MS = 300_000;

let availabilityCache: { value: boolean; checkedAt: number } | null = null;
const AVAILABILITY_TTL_MS = 60_000;

export async function readSkillSecuritySettings(): Promise<SkillSecuritySettings> {
  try {
    const raw = await readFile(SKILL_SECURITY_SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<SkillSecuritySettings>;
    return {
      engine: parsed.engine === "regex" || parsed.engine === "skillspector" ? parsed.engine : "auto",
      llm: parsed.llm === true,
    };
  } catch {
    return { ...DEFAULT_SKILL_SECURITY_SETTINGS };
  }
}

export async function writeSkillSecuritySettings(
  patch: Partial<SkillSecuritySettings>,
): Promise<SkillSecuritySettings> {
  const current = await readSkillSecuritySettings();
  const next: SkillSecuritySettings = {
    engine: patch.engine ?? current.engine,
    llm: patch.llm ?? current.llm,
  };
  await mkdir(dirname(SKILL_SECURITY_SETTINGS_FILE), { recursive: true });
  await writeFile(SKILL_SECURITY_SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/** Whether the SkillSpector CLI resolves on PATH (cached briefly). */
export async function isSkillSpectorAvailable(): Promise<boolean> {
  if (availabilityCache && Date.now() - availabilityCache.checkedAt < AVAILABILITY_TTL_MS) {
    return availabilityCache.value;
  }
  let value = false;
  try {
    await execFileAsync(SKILLSPECTOR_BIN, ["--version"], { timeout: 10_000 });
    value = true;
  } catch {
    value = false;
  }
  availabilityCache = { value, checkedAt: Date.now() };
  return value;
}

/** Minimal reader for the shared ~/.hivemindos/.env (never returns values to clients). */
async function loadSharedEnvValue(name: string): Promise<string | undefined> {
  if (!name) return undefined;
  if (process.env[name]) return process.env[name];
  const raw = await readFile(HIVE_ENV_FILE, "utf8").catch(() => "");
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    if (key !== name) continue;
    let value = line.slice(equals + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    return value || undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// LLM routing through the user's Queen Bee / security-subclass agent
// ---------------------------------------------------------------------------

/** Public (secret-free) description of which agent the LLM pass would route through. */
export type SecurityLlmRoutingInfo = {
  source: "security-subclass" | "queen-bee";
  agentId: string;
  agentName: string;
  /** SkillSpector provider id the agent maps to. */
  provider: string;
  model?: string;
  /** True when the provider credential resolves from the shared env / profile. */
  credentialReady: boolean;
};

type ResolvedSecurityRouting =
  | { ok: true; info: SecurityLlmRoutingInfo; env: Record<string, string> }
  | { ok: false; reason: string; info?: Omit<SecurityLlmRoutingInfo, "credentialReady"> };

function pickRoutingAgent(agents: AgentProfile[]):
  | { agent: AgentProfile; source: "security-subclass" | "queen-bee" }
  | null {
  const security = agents.find((agent) => agent.workerClass === "security");
  if (security) return { agent: security, source: "security-subclass" };
  const queen =
    agents.find((agent) => agent.beeRole === "queen") ??
    agents.find((agent) => /queen|orchestrat|lead|main/i.test(agent.name ?? ""));
  if (queen) return { agent: queen, source: "queen-bee" };
  return null;
}

/**
 * Map an agent's provider/model/credential onto SkillSpector's provider env.
 * SkillSpector speaks anthropic / openai (OpenAI-compatible) / nv_build, so
 * OpenAI-compatible gateways (venice, bankr, lm-studio, openrouter) route via
 * the openai provider with OPENAI_BASE_URL pointed at the gateway.
 */
async function mapAgentToSkillSpectorEnv(
  agent: AgentProfile,
): Promise<{ provider: string; model?: string; env: Record<string, string>; missing?: string }> {
  const provider = (agent.provider ?? "").trim().toLowerCase();
  const model = (agent.model || "").trim() || undefined;
  const env: Record<string, string> = {};
  if (model) env.SKILLSPECTOR_MODEL = model;

  // Native Anthropic.
  if (provider === "anthropic" || provider === "claude") {
    const key = (await loadSharedEnvValue("ANTHROPIC_API_KEY")) || agent.token;
    env.SKILLSPECTOR_PROVIDER = "anthropic";
    if (key) env.ANTHROPIC_API_KEY = key;
    return { provider: "anthropic", model, env, missing: key ? undefined : "ANTHROPIC_API_KEY" };
  }

  // Native NVIDIA build.
  if (provider === "nv_build" || provider === "nvidia" || provider === "nvidia-build") {
    const key = (await loadSharedEnvValue("NVIDIA_INFERENCE_KEY")) || agent.token;
    env.SKILLSPECTOR_PROVIDER = "nv_build";
    if (key) env.NVIDIA_INFERENCE_KEY = key;
    return { provider: "nv_build", model, env, missing: key ? undefined : "NVIDIA_INFERENCE_KEY" };
  }

  // Plain OpenAI.
  if (provider === "openai") {
    const key = (await loadSharedEnvValue("OPENAI_API_KEY")) || agent.token;
    env.SKILLSPECTOR_PROVIDER = "openai";
    if (key) env.OPENAI_API_KEY = key;
    return { provider: "openai", model, env, missing: key ? undefined : "OPENAI_API_KEY" };
  }

  // OpenRouter (OpenAI-compatible).
  if (provider === "openrouter") {
    const key = (await loadSharedEnvValue("OPENROUTER_API_KEY")) || agent.token;
    env.SKILLSPECTOR_PROVIDER = "openai";
    env.OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
    if (key) env.OPENAI_API_KEY = key;
    return { provider: "openai", model, env, missing: key ? undefined : "OPENROUTER_API_KEY" };
  }

  // Known OpenAI-compatible gateways (venice, bankr, lm-studio, usepod).
  const gateway = MODEL_PROVIDER_GATEWAYS[provider]?.hermes;
  if (gateway) {
    const baseUrl = gateway.baseUrl?.replace(/\/+$/, "");
    if (!baseUrl) {
      return { provider: "openai", model, env, missing: `${provider}-base-url` };
    }
    const keyEnvName = provider === "venice" ? agent.venice?.apiKeyEnvName || gateway.keyEnv : gateway.keyEnv;
    const key = (keyEnvName ? await loadSharedEnvValue(keyEnvName) : undefined) || agent.token;
    env.SKILLSPECTOR_PROVIDER = "openai";
    env.OPENAI_BASE_URL = baseUrl;
    // Local OpenAI gateways (lm-studio) accept any non-empty key.
    env.OPENAI_API_KEY = key || (keyEnvName ? "" : "local");
    if (!model && MODEL_PROVIDER_GATEWAYS[provider]?.defaultModel) {
      env.SKILLSPECTOR_MODEL = MODEL_PROVIDER_GATEWAYS[provider]!.defaultModel;
    }
    return {
      provider: "openai",
      model: env.SKILLSPECTOR_MODEL,
      env,
      missing: env.OPENAI_API_KEY ? undefined : keyEnvName || `${provider}-key`,
    };
  }

  return { provider: provider || "unknown", model, env, missing: provider ? `unsupported-provider:${provider}` : "no-provider" };
}

/** Resolve the full LLM routing (with secret env) for a scan. Server-only. */
export async function resolveSecurityLlmRouting(): Promise<ResolvedSecurityRouting> {
  const agents = await readStoredAgentProfiles().catch(() => [] as AgentProfile[]);
  const picked = pickRoutingAgent(agents);
  if (!picked) {
    return { ok: false, reason: "No security-subclass agent or Queen Bee is configured to route the LLM pass through." };
  }
  const mapped = await mapAgentToSkillSpectorEnv(picked.agent);
  const base: Omit<SecurityLlmRoutingInfo, "credentialReady"> = {
    source: picked.source,
    agentId: picked.agent.id,
    agentName: picked.agent.name || picked.agent.id,
    provider: mapped.provider,
    model: mapped.model,
  };
  if (mapped.missing) {
    return {
      ok: false,
      reason:
        mapped.missing.startsWith("unsupported-provider") || mapped.missing === "no-provider"
          ? `${base.agentName} has no SkillSpector-compatible LLM provider configured (${mapped.missing}).`
          : `${base.agentName}'s LLM credential is not set (${mapped.missing}).`,
      info: base,
    };
  }
  return { ok: true, info: { ...base, credentialReady: true }, env: mapped.env };
}

/** Secret-free routing summary for the dashboard toggle / status UI. */
export async function describeSecurityLlmRouting(): Promise<SecurityLlmRoutingInfo | { unavailable: string }> {
  const resolved = await resolveSecurityLlmRouting();
  if (resolved.ok) return resolved.info;
  if (resolved.info) return { ...resolved.info, credentialReady: false };
  return { unavailable: resolved.reason };
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export type SkillSpectorScanResult = {
  riskScore: number;
  riskSeverity: string;
  riskRecommendation?: string;
  findings: SkillAuditFinding[];
  usedLlm: boolean;
};

type RawSkillSpectorFinding = {
  severity?: string;
  rule_id?: string;
  message?: string;
  file?: string;
  path?: string;
  line?: number;
  category?: string;
  title?: string;
};

type RawSkillSpectorReport = {
  risk_score?: number;
  risk_severity?: string;
  risk_recommendation?: string;
  filtered_findings?: RawSkillSpectorFinding[];
  findings?: RawSkillSpectorFinding[];
};

function mapSeverity(severity: string | undefined): SkillAuditSeverity {
  switch ((severity ?? "").toUpperCase()) {
    case "CRITICAL":
    case "HIGH":
      return "high";
    case "MEDIUM":
    case "MODERATE":
      return "medium";
    default:
      return "low";
  }
}

function normalizeFinding(raw: RawSkillSpectorFinding): SkillAuditFinding {
  const ruleId = (raw.rule_id || "").trim();
  return {
    id: `skillspector:${ruleId || "finding"}`,
    title: raw.title?.trim() || (raw.category ? `${raw.category} (SkillSpector)` : "SkillSpector finding"),
    severity: mapSeverity(raw.severity),
    detail: [raw.message?.trim(), ruleId ? `(rule ${ruleId})` : ""].filter(Boolean).join(" "),
    file: raw.file || raw.path || undefined,
    match: typeof raw.line === "number" ? `line ${raw.line}` : undefined,
  };
}

/**
 * Materialize the in-memory skill files to a temp dir, scan it with SkillSpector,
 * and return normalized findings. Returns null when the engine is unavailable so
 * the caller can fall back to the regex rules. When `llmEnv` is provided the LLM
 * semantic pass runs with that agent-derived provider env; otherwise --no-llm.
 */
export async function scanWithSkillSpector(input: {
  files: Array<{ path: string; content: string }>;
  llmEnv?: Record<string, string> | null;
}): Promise<SkillSpectorScanResult | null> {
  if (!(await isSkillSpectorAvailable())) return null;
  if (!input.files.length) return null;

  const workdir = await mkdtemp(join(tmpdir(), "skillspector-"));
  const reportPath = join(workdir, "__skillspector-report.json");
  const skillDir = join(workdir, "skill");
  const useLlm = Boolean(input.llmEnv);

  try {
    for (const file of input.files) {
      // Keep writes inside skillDir; reject path traversal from untrusted skill content.
      const safeRelative = file.path.replace(/^(\.\.([/\\]|$))+/, "").replace(/^[/\\]+/, "");
      const target = join(skillDir, safeRelative);
      if (!target.startsWith(skillDir)) continue;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content ?? "", "utf8");
    }

    const args = ["scan", skillDir, "--format", "json", "--output", reportPath];
    if (!useLlm) args.push("--no-llm");

    const env = { ...process.env, ...(input.llmEnv ?? {}) };

    await execFileAsync(SKILLSPECTOR_BIN, args, {
      timeout: useLlm ? LLM_SCAN_TIMEOUT_MS : SCAN_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env,
    });

    const raw = await readFile(reportPath, "utf8");
    const report = JSON.parse(raw) as RawSkillSpectorReport;
    const rawFindings = report.filtered_findings ?? report.findings ?? [];

    return {
      riskScore: typeof report.risk_score === "number" ? report.risk_score : 0,
      riskSeverity: report.risk_severity ?? "UNKNOWN",
      riskRecommendation: report.risk_recommendation,
      findings: rawFindings.map(normalizeFinding),
      usedLlm: useLlm,
    };
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }
}
