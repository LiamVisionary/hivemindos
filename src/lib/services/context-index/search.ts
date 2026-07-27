import type {
  ContextIndex,
  ContextIndexItem,
  ContextIndexKind,
} from "@/lib/services/context-index";

export type ContextIndexSnapshotSearchOptions = {
  query?: string;
  limit?: number;
  kinds?: ContextIndexKind[];
};

function tokenize(value: string) {
  return value.toLowerCase().split(/[^a-z0-9_-]+/).filter((word) => word.length > 2 && word !== "gen");
}

function uniqueList(values: string[]) {
  return [...new Set(values)];
}

function expandedQueryWords(normalizedQuery: string) {
  const words = tokenize(normalizedQuery);
  const expansions = [
    /image|picture|photo|visual|render|diffusion|txt2img|text.?to.?image/.test(normalizedQuery) ? ["image", "image generation", "image gen", "text to image", "creative", "visual generation", "diffusion", "render"] : [],
    /video|movie|clip|animation/.test(normalizedQuery) ? ["video", "media", "render", "generation"] : [],
    /sim|simulation|scenario|swarm/.test(normalizedQuery) ? ["simulation", "scenario", "swarm", "swarm-goal", "parallel agents", "run history"] : [],
    /goal|orchestrat|delegate|parallel|spawn|build|implement/.test(normalizedQuery) ? ["goal", "swarm-goal", "queen bee", "orchestration", "agent routing", "work board", "parallel agents", "build"] : [],
    /graph|ontology|network/.test(normalizedQuery) ? ["graph", "ontology", "knowledge graph"] : [],
    /api|endpoint|route|openapi|swagger|docs/.test(normalizedQuery) ? ["api", "endpoint", "openapi", "swagger", "api docs"] : [],
  ].flat();
  return uniqueList([...words, ...expansions]);
}

function scoreItem(normalizedQuery: string, queryWords: string[], item: ContextIndexItem) {
  if (!normalizedQuery) return 1;
  const aliases = item.aliases ?? [];
  const retrievalText = (item.retrievalText ?? "").toLowerCase();
  const title = item.title.toLowerCase();
  const summary = item.summary.toLowerCase();
  const path = (item.path ?? "").toLowerCase();
  const route = (item.route ?? "").toLowerCase();
  const text = `${title} ${summary} ${item.tags.join(" ")} ${aliases.join(" ")} ${retrievalText} ${path} ${route}`.toLowerCase();
  let score = text.includes(normalizedQuery) ? 40 : 0;
  if (aliases.some((alias) => alias === normalizedQuery || alias.includes(normalizedQuery))) score += 35;
  if (retrievalText.includes(normalizedQuery)) score += 20;
  for (const word of queryWords) {
    if (title.includes(word)) score += 12;
    if (aliases.some((alias) => alias.includes(word))) score += 11;
    if (item.tags.some((tag) => tag.includes(word))) score += 8;
    if (path.includes(word) || route.includes(word)) score += 5;
    if (retrievalText.includes(word)) score += 4;
    if (summary.includes(word)) score += 3;
  }
  if (item.kind === "skill") score += 2;
  if (item.kind === "tool-schema" || item.kind === "api-route") score += 1;
  return score;
}

export function searchContextIndexSnapshot(index: ContextIndex, options: ContextIndexSnapshotSearchOptions = {}) {
  const normalizedQuery = options.query?.toLowerCase().trim() ?? "";
  const queryWords = expandedQueryWords(normalizedQuery);
  const kinds = options.kinds?.length ? new Set(options.kinds) : null;
  const scored = index.items
    .filter((item) => !kinds || kinds.has(item.kind))
    .map((item) => {
      const base = scoreItem(normalizedQuery, queryWords, item);
      return { ...item, score: base > 0 ? base + (item.priorityBoost ?? 0) : base };
    })
    .filter((item) => !normalizedQuery || (item.score ?? 0) > 0)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title));
  return {
    ...index,
    query: options.query?.trim() || "",
    items: scored.slice(0, options.limit ?? 40),
    totalMatches: scored.length,
  };
}
