import { searchContextIndex, type ContextConnectedApp, type ContextIndexItem } from "@/lib/services/context-index";
import type { SharedVaultConfig } from "@/lib/types/agent-runtime";

function compactContextText(value: string, maxLength: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function safeContextTags(item: ContextIndexItem) {
  return item.tags.filter((tag) => !/^\d+$/.test(tag)).slice(0, 8).join(", ");
}

function contextItemLocator(item: ContextIndexItem) {
  if (item.kind === "connected-app" || item.kind === "app-endpoint") {
    return "Use /api/context-index or /api/fleet/apps for current app URLs; do not hard-code Tailnet endpoints.";
  }
  return item.path || item.route || item.load.note || "No direct locator.";
}

type RetrievalHit = {
  item: ContextIndexItem;
  label: string;
};

function formatTaskRetrievalItem(hit: RetrievalHit, index: number) {
  const item = hit.item;
  const methods = item.methods?.length ? ` [${item.methods.join(", ")}]` : "";
  return [
    `${index + 1}. ${item.kind}: ${item.title}${methods}`,
    `   matched: ${hit.label}`,
    `   summary: ${compactContextText(item.summary, 260)}`,
    `   tags: ${safeContextTags(item) || "none"}`,
    `   locator: ${contextItemLocator(item)}`,
  ].join("\n");
}

function taskRetrievalQueries(query: string) {
  const normalized = query.toLowerCase();
  const queries = [{ label: "full task", query }];
  if (/\b(x|twitter|tweet|tweets|post|social)\b/.test(normalized)) {
    queries.push({ label: "x research and writing", query: "x twitter search latest news social post x-post optimizer grok writer" });
  }
  if (/image|picture|photo|visual|render|generate|generation/.test(normalized)) {
    queries.push({ label: "image generation", query: "image generation comfyui zimage imagegen visual creative" });
  }
  if (/telegram|message|send|deliver|delivery|notify|notification/.test(normalized)) {
    queries.push({ label: "delivery channel", query: "telegram message send notification delivery channel configure access bot" });
  }
  if (/\b(wallet|payment|pay|paid|spend|crypto|usdc|x402|usepod|moneyclaw|bankr|trade|trading|fund|funding)\b/.test(normalized)) {
    queries.push({ label: "wallet and payment rails", query: "agent wallet tools payment rails x402 fetch paid api crypto usdc usepod moneyclaw bankr send balance approval" });
  }
  if (/agent|worker|specialist|runtime|workflow|skill/.test(normalized)) {
    queries.push({ label: "agent and workflow routing", query: "agent worker runtime capabilities skill action workflow social posting xSearch writer" });
  }
  const seen = new Set<string>();
  return queries.filter((entry) => {
    const key = entry.query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

async function connectedAppsForTaskRetrieval(origin: string) {
  const url = new URL("/api/fleet/apps", origin);
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(7_000),
  }).catch(() => null);
  if (!response?.ok) return undefined;
  const payload = await response.json().catch(() => null) as { apps?: ContextConnectedApp[] } | null;
  return Array.isArray(payload?.apps) ? payload.apps : undefined;
}

export async function buildTaskRetrievalContext(input: {
  origin: string;
  query: string;
  sharedVault: SharedVaultConfig | null;
}) {
  const trimmed = input.query.trim();
  if (!trimmed) return "";
  const connectedApps = await connectedAppsForTaskRetrieval(input.origin);
  const results = await Promise.all(taskRetrievalQueries(trimmed).map(async (entry) => {
    const result = await searchContextIndex({
      query: entry.query,
      vaultPath: input.sharedVault?.vaultPath,
      connectedApps,
      limit: 8,
    }).catch(() => null);
    return (result?.items ?? []).map((item): RetrievalHit => ({ item, label: entry.label }));
  }));
  const seen = new Set<string>();
  const hits = results.flat().filter((hit) => {
    if (seen.has(hit.item.id)) return false;
    seen.add(hit.item.id);
    return true;
  }).slice(0, 22);
  if (!hits.length) return "";
  return [
    "Task retrieval context from /api/context-index:",
    `- Query: ${compactContextText(trimmed, 240)}`,
    `- HivemindOS dashboard API origin for terminal/http tool calls: ${input.origin.replace(/\/+$/, "")}`,
    "- These are ranked lightweight hits for this exact user message plus targeted subqueries. Prefer these names before inventing generic tools.",
    "- For connected apps and app endpoints, resolve fresh URLs through the Apps view APIs instead of hard-coding local or Tailnet addresses.",
    "- For agent terminal/runtime calls into connected apps, prefer the dashboard proxy: POST /api/fleet/apps/request with { serviceKind or appId, method, path, body }. This lets HivemindOS reach Tailnet apps through the same Apps view logic without exposing or depending on raw Tailnet URLs.",
    ...hits.map(formatTaskRetrievalItem),
  ].join("\n");
}
