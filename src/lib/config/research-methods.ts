import type { ResearchMethod } from "@/lib/types/agent-runtime";

export type ResearchMethodDefinition = {
  id: ResearchMethod;
  label: string;
  summary: string;
  promptLayer: string;
};

export const DEFAULT_RESEARCH_METHOD: ResearchMethod = "storm-brief";
export const RESEARCH_STORM_SKILL_SLUG = "storm-research";

export const RESEARCH_OUTPUT_SECTIONS = [
  "Perspectives",
  "Contradictions",
  "Synthesis",
  "Peer Review",
  "Sources",
] as const;

export const RESEARCH_METHODS: ResearchMethodDefinition[] = [
  {
    id: "quick-source-check",
    label: "Quick source check",
    summary: "Fast answer with citations, uncertainty, and the most useful disagreement.",
    promptLayer: "Use the five research sections as a concise source check: name the most relevant lenses, surface only material contradictions, answer directly, score confidence, and cite the sources that carried the answer.",
  },
  {
    id: "storm-brief",
    label: "STORM brief",
    summary: "Multi-perspective scan, contradiction map, synthesis, and self-review.",
    promptLayer: "Use a STORM-style research pass: compare practitioner, academic, skeptic, economist or incentive, and historian lenses; map the contradictions; synthesize ranked findings; then peer-review confidence, weak links, bias, and missing perspectives.",
  },
  {
    id: "full-research-swarm",
    label: "Full research swarm",
    summary: "Deeper multi-agent style research plan with broader source lanes and final synthesis.",
    promptLayer: "Use the full research swarm pattern: split the topic into source lanes and expert lenses, use Queen Bee or Work Board routing when available, collect broader evidence, compare lane outputs, and deliver the same five-section research brief with explicit confidence and source limits.",
  },
];

const RESEARCH_METHOD_BY_ID = new Map(RESEARCH_METHODS.map((method) => [method.id, method]));

export function normalizeResearchMethod(value: unknown): ResearchMethod {
  return typeof value === "string" && RESEARCH_METHOD_BY_ID.has(value as ResearchMethod)
    ? value as ResearchMethod
    : DEFAULT_RESEARCH_METHOD;
}

export function researchMethodDefinition(value: unknown): ResearchMethodDefinition {
  return RESEARCH_METHOD_BY_ID.get(normalizeResearchMethod(value)) ?? RESEARCH_METHODS[1];
}

export function researchMethodPrompt(value: unknown) {
  const method = researchMethodDefinition(value);
  return [
    `- Research method: ${method.label}.`,
    `- Method prompt layer: ${method.promptLayer}`,
    `- Output format: use these exact markdown headings when the answer is a research brief: ${RESEARCH_OUTPUT_SECTIONS.map((section) => `## ${section}`).join(", ")}.`,
  ].join("\n");
}
