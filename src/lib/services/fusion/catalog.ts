import "server-only";

import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { MODEL_PROVIDER_GATEWAYS } from "@/lib/config/model-provider-gateways";
import { resolveAdaptiveOpenRouterModels } from "@/lib/services/chat/adaptive-openrouter-models";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type {
  FusionMemberSpec,
  FusionMessage,
  FusionPlan,
  ResolvedFusionMember,
  ResolvePlanInput,
} from "./types";

/**
 * OpenAI-compatible providers Fusion can recruit into a panel. Each maps a
 * catalog slug to a concrete chat-completions endpoint resolved from the shared
 * hive env (process.env first, then ~/.hivemindos/.env). Keyless providers
 * (local OpenAI-compatible servers) are reachable without a token.
 */
type CatalogProvider = {
  slug: string;
  label: string;
  keyEnv: string;
  keyless?: boolean;
  baseUrl?: string;
  headers?: Record<string, string>;
  resolveBaseUrl?: () => Promise<string | null> | string | null;
};

const VENICE_BASE = MODEL_PROVIDER_GATEWAYS.venice?.hermes?.baseUrl || "https://api.venice.ai/api/v1";
const BANKR_BASE = MODEL_PROVIDER_GATEWAYS.bankr?.hermes?.baseUrl || "https://llm.bankr.bot/v1";

const CATALOG: Record<string, CatalogProvider> = {
  openrouter: {
    slug: "openrouter",
    label: "OpenRouter",
    keyEnv: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    headers: { "HTTP-Referer": "https://hivemindos.local", "X-Title": "HivemindOS Fusion" },
  },
  venice: { slug: "venice", label: "Venice", keyEnv: "VENICE_API_KEY", baseUrl: VENICE_BASE },
  bankr: { slug: "bankr", label: "Bankr", keyEnv: "BANKR_LLM_KEY", baseUrl: BANKR_BASE },
  openai: { slug: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1" },
  groq: { slug: "groq", label: "Groq", keyEnv: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1" },
  local: {
    slug: "local",
    label: "Local",
    keyEnv: "LOCAL_OPENAI_API_KEY",
    keyless: true,
    resolveBaseUrl: () => {
      const base = process.env.LOCAL_OPENAI_BASE_URL || process.env.NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL || "";
      return base ? `${base.replace(/\/+$/, "")}/v1` : null;
    },
  },
};

/** Deterministic single-model defaults per provider for the auto panel. */
const PROVIDER_DEFAULT_MODEL: Record<string, string | (() => string | null)> = {
  venice: MODEL_PROVIDER_GATEWAYS.venice?.defaultModel || "llama-3.3-70b",
  openai: "gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  local: () =>
    process.env.LOCAL_OPENAI_MODEL || process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL || null,
  // bankr models are account-specific and not knowable here, so it is excluded
  // from the auto panel but still usable via an explicit participant override.
};

/** Synthesizer preference order: first configured provider/model wins. */
const SYNTHESIZER_PREFERENCE: FusionMemberSpec[] = [
  { provider: "openai", model: "gpt-4o" },
  { provider: "openrouter", model: "openai/gpt-4o-mini" },
  { provider: "venice", model: "llama-3.3-70b" },
  { provider: "groq", model: "llama-3.3-70b-versatile" },
];

/** Judge preference order: cheaper-but-structured first. */
const JUDGE_PREFERENCE: FusionMemberSpec[] = [
  { provider: "openai", model: "gpt-4o-mini" },
  { provider: "openrouter", model: "openai/gpt-4o-mini" },
  { provider: "groq", model: "llama-3.3-70b-versatile" },
  { provider: "venice", model: "llama-3.3-70b" },
];

/** Static fallback budget panel if OpenRouter's live free inventory is unreachable. */
const OPENROUTER_FALLBACK_PANEL = [
  "deepseek/deepseek-chat:free",
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

const DEFAULT_MAX_PARTICIPANTS = 3;

type ResolvedEndpoint = { baseUrl: string; apiKey: string; headers?: Record<string, string> };

async function resolveEndpoint(slug: string): Promise<ResolvedEndpoint | null> {
  const provider = CATALOG[slug];
  if (!provider) return null;
  const baseUrl = provider.baseUrl ?? (provider.resolveBaseUrl ? await provider.resolveBaseUrl() : null);
  if (!baseUrl) return null;
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  if (provider.keyless) {
    const apiKey = (await hiveEnvValue(provider.keyEnv).catch(() => "")) || "local";
    return { baseUrl: normalizedBase, apiKey, headers: provider.headers };
  }
  const apiKey = await hiveEnvValue(provider.keyEnv).catch(() => "");
  if (!apiKey) return null;
  return { baseUrl: normalizedBase, apiKey, headers: provider.headers };
}

function memberId(provider: string, model: string) {
  return `${provider}:${model}`;
}

function memberLabel(provider: string, model: string) {
  const label = CATALOG[provider]?.label ?? provider;
  return `${model} · ${label}`;
}

function toMember(provider: string, model: string, endpoint: ResolvedEndpoint): ResolvedFusionMember {
  return {
    id: memberId(provider, model),
    label: memberLabel(provider, model),
    provider,
    model,
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey,
    headers: endpoint.headers,
  };
}

/** Resolve an explicit override spec; throws a helpful error if not configured. */
async function resolveMemberStrict(spec: FusionMemberSpec): Promise<ResolvedFusionMember> {
  if (!CATALOG[spec.provider]) {
    throw new Error(`Unknown Fusion provider "${spec.provider}". Supported: ${Object.keys(CATALOG).join(", ")}.`);
  }
  if (!spec.model?.trim()) throw new Error(`Fusion ${spec.provider} member is missing a model id.`);
  const endpoint = await resolveEndpoint(spec.provider);
  if (!endpoint) {
    throw new Error(`Fusion provider "${spec.provider}" is not configured. Set ${CATALOG[spec.provider].keyEnv} in the shared hive env.`);
  }
  return toMember(spec.provider, spec.model.trim(), endpoint);
}

/** Resolve the first configured member from a preference list. */
async function resolveFirstAvailable(prefs: FusionMemberSpec[]): Promise<ResolvedFusionMember | null> {
  for (const spec of prefs) {
    const endpoint = await resolveEndpoint(spec.provider);
    if (endpoint) return toMember(spec.provider, spec.model, endpoint);
  }
  return null;
}

function defaultModelFor(slug: string): string | null {
  const entry = PROVIDER_DEFAULT_MODEL[slug];
  if (typeof entry === "function") return entry();
  return entry ?? null;
}

/** Pick up to n model ids favouring distinct authors (e.g. google/, deepseek/, mistralai/). */
function pickDistinctAuthors(ids: string[], n: number): string[] {
  const seenAuthors = new Set<string>();
  const picked: string[] = [];
  for (const id of ids) {
    const author = id.includes("/") ? id.split("/")[0] : id;
    if (seenAuthors.has(author)) continue;
    seenAuthors.add(author);
    picked.push(id);
    if (picked.length >= n) break;
  }
  // Backfill if author diversity left us short.
  if (picked.length < n) {
    for (const id of ids) {
      if (picked.includes(id)) continue;
      picked.push(id);
      if (picked.length >= n) break;
    }
  }
  return picked;
}

async function openRouterBudgetPanel(slots: number, messages: FusionMessage[]): Promise<{ members: ResolvedFusionMember[]; note?: string }> {
  const endpoint = await resolveEndpoint("openrouter");
  if (!endpoint || slots <= 0) return { members: [] };
  let ids: string[] = [];
  let note: string | undefined;
  try {
    const syntheticProfile = {
      id: "fusion",
      name: "Hive Fusion",
      runtime: "hivemind-os",
      gatewayUrl: "",
      provider: "openrouter",
    } as unknown as AgentProfile;
    ids = await resolveAdaptiveOpenRouterModels(syntheticProfile, messages as never);
  } catch {
    ids = OPENROUTER_FALLBACK_PANEL;
    note = "OpenRouter free-model inventory was unreachable; using a static budget panel that may include unavailable models.";
  }
  if (!ids.length) {
    ids = OPENROUTER_FALLBACK_PANEL;
    note = note ?? "OpenRouter reported no free models; using a static budget panel.";
  }
  const chosen = pickDistinctAuthors(ids, slots);
  return { members: chosen.map((model) => toMember("openrouter", model, endpoint)), note };
}

/**
 * Build the panel. Mirrors the OpenRouter "budget panel" idea: when OpenRouter
 * is configured the panel is filled from diverse budget models, then topped up
 * from any other configured providers; otherwise it is built from whatever
 * configured providers exist. Degrades gracefully — a single configured
 * provider yields a (low-diversity) single-member panel rather than failing.
 */
async function resolveDefaultPanel(
  maxParticipants: number,
  messages: FusionMessage[],
): Promise<{ members: ResolvedFusionMember[]; notes: string[] }> {
  const notes: string[] = [];
  const members: ResolvedFusionMember[] = [];
  const seen = new Set<string>();
  const add = (member: ResolvedFusionMember) => {
    if (seen.has(member.id)) return;
    seen.add(member.id);
    members.push(member);
  };

  const orPanel = await openRouterBudgetPanel(maxParticipants, messages);
  if (orPanel.note) notes.push(orPanel.note);
  orPanel.members.forEach(add);

  if (members.length < maxParticipants) {
    for (const slug of ["venice", "openai", "groq", "local"]) {
      if (members.length >= maxParticipants) break;
      const model = defaultModelFor(slug);
      if (!model) continue;
      const endpoint = await resolveEndpoint(slug);
      if (!endpoint) continue;
      add(toMember(slug, model, endpoint));
    }
  }

  return { members, notes };
}

/** Resolve a full native plan: participants + judge + synthesizer. */
export async function resolveFusionPlan({ config, model, messages }: ResolvePlanInput): Promise<FusionPlan> {
  const mode = config?.mode ?? (model && /openrouter|hosted/i.test(model) ? "openrouter" : "native");
  const notes: string[] = [];

  if (mode === "openrouter") {
    const member = await resolveMemberStrict({ provider: "openrouter", model: "openrouter/fusion" });
    return { mode, participants: [member], judge: null, synthesizer: member, notes };
  }

  const maxParticipants = Math.max(1, Math.min(8, config?.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS));

  let participants: ResolvedFusionMember[];
  if (config?.participants?.length) {
    participants = await Promise.all(config.participants.map(resolveMemberStrict));
  } else {
    const resolved = await resolveDefaultPanel(maxParticipants, messages);
    participants = resolved.members;
    notes.push(...resolved.notes);
  }

  if (!participants.length) {
    throw new Error(
      "Hive Fusion has no configured panel providers. Set at least one of OPENROUTER_API_KEY, VENICE_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, or LOCAL_OPENAI_BASE_URL in the shared hive env.",
    );
  }

  const distinctProviders = new Set(participants.map((member) => member.provider));
  if (participants.length === 1) {
    notes.push("Only one panel model is configured, so Fusion is running in low-diversity mode (the judge and synthesizer still add structure). Configure more providers for the full panel.");
  } else if (distinctProviders.size === 1) {
    notes.push(`All ${participants.length} panel models share one provider; configure additional providers for cross-provider diversity.`);
  }

  const synthesizer = config?.synthesizer
    ? await resolveMemberStrict(config.synthesizer)
    : (await resolveFirstAvailable(SYNTHESIZER_PREFERENCE)) ?? participants[0];

  let judge = config?.judge ? await resolveMemberStrict(config.judge) : await resolveFirstAvailable(JUDGE_PREFERENCE);
  if (!judge) judge = synthesizer;

  return { mode, participants, judge, synthesizer, notes };
}

export const __FUSION_CATALOG_PROVIDERS__ = Object.keys(CATALOG);
