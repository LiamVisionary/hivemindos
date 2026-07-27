/**
 * Model-strength ranking used to pick the Queen Bee automatically: the agent
 * whose configured model ranks strongest gets crowned when no explicit queen
 * exists. Ranking must work with NO user API key and NO network: the curated
 * matrix below decides for known families, and heuristics (generation number,
 * parameter count, fast/lite suffixes) cover the rest. A keyless, CORS-open
 * OpenRouter listing can refine scores for models the matrix has never heard
 * of, but the crowning result must stay correct when that fetch fails.
 *
 * Scores are a single 0-1000 scale; only the ORDER matters. Update the matrix
 * when a new frontier family ships — patterns match anywhere in the model id
 * so provider prefixes ("anthropic/", "openrouter:", etc.) are irrelevant.
 */

export type ModelStrengthTier = {
  /** Matched against the lowercased model id/name. First match wins. */
  pattern: RegExp;
  score: number;
  label: string;
};

/** Ordered strongest-first; first matching row decides the base score. */
export const MODEL_STRENGTH_MATRIX: readonly ModelStrengthTier[] = [
  { pattern: /fable|mythos/, score: 960, label: "Claude 5 frontier" },
  { pattern: /gpt-?5\.5-?pro/, score: 950, label: "GPT-5.5 Pro" },
  { pattern: /opus-?4\.[89]|opus-?5/, score: 920, label: "Claude Opus latest" },
  { pattern: /gpt-?5\.5/, score: 910, label: "GPT-5.5" },
  { pattern: /gemini-?3\.5-?pro/, score: 900, label: "Gemini 3.5 Pro" },
  { pattern: /grok-?4\.[3-9]/, score: 890, label: "Grok 4.3+" },
  { pattern: /sonnet-?5/, score: 880, label: "Claude Sonnet 5" },
  { pattern: /opus/, score: 860, label: "Claude Opus" },
  { pattern: /gpt-?5/, score: 850, label: "GPT-5" },
  { pattern: /deepseek-?v4-?pro/, score: 840, label: "DeepSeek V4 Pro" },
  { pattern: /qwen-?3\.[67]-?max|qwen-?3\.7/, score: 830, label: "Qwen 3.6+ max" },
  { pattern: /gemini-?3/, score: 820, label: "Gemini 3" },
  { pattern: /kimi-?k2\.[5-9]/, score: 810, label: "Kimi K2.5+" },
  { pattern: /glm-?5/, score: 800, label: "GLM 5" },
  { pattern: /grok-?4/, score: 790, label: "Grok 4" },
  { pattern: /deepseek-?v4/, score: 780, label: "DeepSeek V4" },
  { pattern: /sonnet-?4/, score: 760, label: "Claude Sonnet 4" },
  { pattern: /gpt-?4\.\d|gpt-?4o/, score: 700, label: "GPT-4 class" },
  { pattern: /qwen-?3/, score: 690, label: "Qwen 3" },
  { pattern: /deepseek/, score: 650, label: "DeepSeek" },
  { pattern: /kimi/, score: 640, label: "Kimi" },
  { pattern: /mistral-?medium|magistral/, score: 620, label: "Mistral Medium" },
  { pattern: /gemini-?2\.5-?pro/, score: 610, label: "Gemini 2.5 Pro" },
  { pattern: /sonnet/, score: 600, label: "Claude Sonnet" },
  { pattern: /laguna/, score: 560, label: "Poolside Laguna" },
  { pattern: /haiku-?4/, score: 540, label: "Claude Haiku 4" },
  { pattern: /llama-?4/, score: 520, label: "Llama 4" },
  { pattern: /grok/, score: 500, label: "Grok" },
  { pattern: /gemini/, score: 480, label: "Gemini" },
  { pattern: /haiku/, score: 460, label: "Claude Haiku" },
  { pattern: /gpt/, score: 440, label: "GPT" },
  { pattern: /mistral|ministral|devstral/, score: 420, label: "Mistral" },
  { pattern: /qwen/, score: 400, label: "Qwen" },
  { pattern: /llama/, score: 380, label: "Llama" },
  { pattern: /gemma|phi-?\d|smol/, score: 300, label: "Small open model" },
] as const;

/**
 * "…-mini", ":free", "-flash-lite" and friends demote within a family. Token
 * boundaries are required — a bare /mini/ would demote every geMINI model.
 */
const LIGHTWEIGHT_PATTERN = /(?:^|[-_:./\s])(?:mini|nano|lite|tiny|micro|small|flash|air|free)(?:$|[-_:./\s\d])/;
/** "…-pro", "-max", "-heavy" promote unknown models; curated rows already encode their tier. */
const HEAVYWEIGHT_PATTERN = /(?:^|[-_:./\s])(?:pro|max|heavy|ultra|thinking)(?:$|[-_:./\s\d])/;

export type ModelStrengthResult = {
  score: number;
  /** Curated tier label, or "heuristic" when no matrix row matched. */
  label: string;
};

function parameterCountBonus(id: string): number {
  // "235b" / "70b" / "8b" — bigger open models rank above smaller ones.
  const match = id.match(/(\d{1,4})\s*b(?![a-z0-9])/);
  if (!match) return 0;
  const billions = Number(match[1]);
  if (!Number.isFinite(billions) || billions <= 0) return 0;
  return Math.min(120, Math.round(Math.log10(billions) * 55));
}

/**
 * Deterministic, offline strength score for a model id or display name.
 * Unknown models land in a 200-450 heuristic band, always below the curated
 * frontier, so a typo'd or exotic model never outranks a known flagship.
 */
export function scoreModelStrength(modelId: string | null | undefined): ModelStrengthResult {
  const id = (modelId ?? "").trim().toLowerCase();
  if (!id) return { score: 0, label: "unset" };
  const tier = MODEL_STRENGTH_MATRIX.find((row) => row.pattern.test(id));
  let score = tier?.score ?? 200 + parameterCountBonus(id);
  if (LIGHTWEIGHT_PATTERN.test(id)) score -= 140;
  else if (!tier && HEAVYWEIGHT_PATTERN.test(id)) score += 30;
  return { score: Math.max(1, score), label: tier?.label ?? "heuristic" };
}

export type ModelStrengthCandidate = {
  /** Stable key for the caller (e.g. the agent id). */
  key: string;
  /** The candidate's configured model id/name; empty when unconfigured. */
  modelId?: string | null;
};

export type StrongestModelPick = {
  key: string;
  modelId: string;
  score: number;
  label: string;
};

/**
 * Picks the strongest candidate. Ties break by candidate order, so pass the
 * list in a stable order (the persisted agents array). Candidates without a
 * configured model never win.
 */
export function pickStrongestModelCandidate(
  candidates: readonly ModelStrengthCandidate[],
  liveScores?: ReadonlyMap<string, number>,
): StrongestModelPick | null {
  let best: StrongestModelPick | null = null;
  for (const candidate of candidates) {
    const modelId = candidate.modelId?.trim();
    if (!modelId) continue;
    const base = scoreModelStrength(modelId);
    const live = liveScores?.get(normalizeModelKey(modelId));
    // Live hints only refine within the heuristic band; curated rows are
    // authoritative so an OpenRouter outage can't reorder known families.
    const score = base.label === "heuristic" && typeof live === "number"
      ? Math.max(base.score, Math.min(live, 750))
      : base.score;
    if (!best || score > best.score) {
      best = { key: candidate.key, modelId, score, label: base.label };
    }
  }
  return best;
}

export function normalizeModelKey(modelId: string): string {
  return modelId.trim().toLowerCase().replace(/^[a-z0-9_-]+\//, "").replace(/:free$/, "");
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const LIVE_FETCH_TIMEOUT_MS = 8_000;

type OpenRouterModelEntry = {
  id?: string;
  created?: number;
  context_length?: number;
  pricing?: { prompt?: string };
};

/**
 * Keyless, CORS-open OpenRouter public listing (~500KB) → heuristic scores
 * for models the curated matrix doesn't know: release recency + context
 * length + price band. Returns null on any failure; callers must treat the
 * hints as optional. Never sends credentials.
 */
export async function fetchLiveModelStrengthHints(fetchImpl: typeof fetch = fetch): Promise<Map<string, number> | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIVE_FETCH_TIMEOUT_MS);
    const response = await fetchImpl(OPENROUTER_MODELS_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const payload = await response.json() as { data?: OpenRouterModelEntry[] };
    if (!Array.isArray(payload.data)) return null;
    const nowSeconds = Date.now() / 1000;
    const hints = new Map<string, number>();
    for (const entry of payload.data) {
      if (!entry?.id) continue;
      const ageDays = typeof entry.created === "number" ? Math.max(0, (nowSeconds - entry.created) / 86_400) : 730;
      const recency = Math.max(0, 200 - (ageDays / 365) * 100);
      const context = Math.min(120, Math.round(Math.log10(Math.max(1, entry.context_length ?? 0) / 1000) * 40));
      const promptPrice = Number(entry.pricing?.prompt ?? 0);
      const price = promptPrice >= 0.000005 ? 80 : promptPrice >= 0.000001 ? 50 : promptPrice > 0 ? 20 : 0;
      hints.set(normalizeModelKey(entry.id), Math.round(300 + recency + context + price));
    }
    return hints;
  } catch {
    return null;
  }
}
