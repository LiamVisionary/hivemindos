import { beeSoulTemplate, renderBeeSoulTemplate } from "@/lib/config/bee-worker-presets";

const LEGACY_WORKER_SOUL_PATTERN =
  /# Soul\s+You are .+?, an? (?:General|Planner|Code|Vision|Writer|Research|Artist|Ops|QA|Security) Bee in HivemindOS\./i;

export const DEFAULT_QUEEN_BEE_NAME = "Solara";

const LEGACY_DEFAULT_QUEEN_BEE_NAMES = new Set([
  "Hermes Lead",
  "Queen",
  "Queen Bee",
]);

const LEGACY_DEFAULT_QUEEN_BEE_PERSONALITY = renderBeeSoulTemplate(
  beeSoulTemplate("queen"),
  "Queen Bee",
);

export const DEFAULT_QUEEN_BEE_PERSONALITY = renderBeeSoulTemplate(
  beeSoulTemplate("queen"),
  DEFAULT_QUEEN_BEE_NAME,
);

export function queenBeeNameOrDefault(name?: string | null, customized = false) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || (!customized && LEGACY_DEFAULT_QUEEN_BEE_NAMES.has(trimmed))) {
    return DEFAULT_QUEEN_BEE_NAME;
  }
  return trimmed;
}

export function queenBeePersonalityOrDefault(personality?: string | null) {
  const trimmed = typeof personality === "string" ? personality.trim() : "";
  if (!trimmed || trimmed === LEGACY_DEFAULT_QUEEN_BEE_PERSONALITY || LEGACY_WORKER_SOUL_PATTERN.test(trimmed)) {
    return DEFAULT_QUEEN_BEE_PERSONALITY;
  }
  return trimmed;
}

export function formatQueenBeePersonalityInstruction(personality?: string | null) {
  return [
    "Queen Bee personality:",
    queenBeePersonalityOrDefault(personality),
  ].join("\n");
}
