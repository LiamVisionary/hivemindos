import { beeSoulTemplate, renderBeeSoulTemplate } from "@/lib/config/bee-worker-presets";

const LEGACY_WORKER_SOUL_PATTERN =
  /# Soul\s+You are .+?, an? (?:General|Planner|Code|Vision|Writer|Research|Artist|Ops|QA|Security) Bee in HivemindOS\./i;

export const DEFAULT_QUEEN_BEE_PERSONALITY = renderBeeSoulTemplate(
  beeSoulTemplate("queen"),
  "Queen Bee",
);

export function queenBeePersonalityOrDefault(personality?: string | null) {
  const trimmed = typeof personality === "string" ? personality.trim() : "";
  if (!trimmed || LEGACY_WORKER_SOUL_PATTERN.test(trimmed)) {
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
