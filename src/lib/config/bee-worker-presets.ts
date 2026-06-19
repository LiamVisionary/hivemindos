import type { BeeWorkerClass } from "@/lib/types/agent-runtime";
import beeWorkerSoulTemplateLines from "./bee-worker-souls.json";
import beeWorkerPresetData from "./bee-worker-presets.generated.json";

export type BeeWorkerPreset = {
  id: BeeWorkerClass;
  label: string;
  summary: string;
  soulTemplate: string;
  modelHint: string;
  taskProfile: string;
  /** What "done" looks like for this class; used as the verification bar, not a capability gate. */
  qualityBar: string;
  skillSlugs: string[];
};

export type BeeSoulTemplateId = BeeWorkerClass | "queen";
export type BeeSoulTemplateMap = Record<BeeSoulTemplateId, string[]>;

export const BEE_SOUL_TEMPLATE_LINES = beeWorkerSoulTemplateLines as BeeSoulTemplateMap;

export function beeSoulTemplate(id: BeeSoulTemplateId) {
  return (BEE_SOUL_TEMPLATE_LINES[id] ?? BEE_SOUL_TEMPLATE_LINES.general).join("\n");
}

export function renderBeeSoulTemplate(template: string, agentName: string) {
  const name = agentName.trim() || "this agent";
  return template.replaceAll("{{agentName}}", name);
}

// Worker classes are priors, not permissions: every agent keeps full capability
// search and can run anything. The class shapes interpretation of ambiguous
// tasks, ranking of retrieved capabilities, and the quality bar for "done".
export const BEE_WORKER_HANDOFF_GUIDANCE =
  "You can run any capability, but specialize by default: if capability search shows the task is strongly shaped for another worker class (for example mostly image generation when you are a research bee), route it back through Queen Bee or the Work Board for a better-matched specialist instead of grinding through it with weaker priors. Handle it yourself when the mismatch is small or routing would cost more than doing.";

// Built-in worker-class presets are AUTHORED in packaged-agents/auto-install/<id>/AGENT.md and
// generated into bee-worker-souls.json + bee-worker-presets.generated.json via
// `node scripts/packaged-agents.mjs build`. Do not hand-edit the generated JSON; edit the AGENT.md
// and rebuild. `npm run test:packaged-agents` gates that the folder and generated data stay in sync.
type BeeWorkerPresetData = Omit<BeeWorkerPreset, "id" | "soulTemplate">;
const presetData = beeWorkerPresetData as unknown as Record<BeeWorkerClass, BeeWorkerPresetData>;

export const BEE_WORKER_PRESETS = Object.fromEntries(
  Object.entries(presetData).map(([id, data]) => [
    id,
    { ...data, id: id as BeeWorkerClass, soulTemplate: beeSoulTemplate(id as BeeSoulTemplateId) },
  ]),
) as Record<BeeWorkerClass, BeeWorkerPreset>;

export const BEE_WORKER_PRESET_LIST = Object.values(BEE_WORKER_PRESETS);

export function beeWorkerPreset(workerClass: BeeWorkerClass) {
  return BEE_WORKER_PRESETS[workerClass] ?? BEE_WORKER_PRESETS.general;
}
