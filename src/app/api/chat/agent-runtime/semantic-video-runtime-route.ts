import {
  classifySemanticVideoIntent,
  type SemanticVideoIntentDecision,
} from "@/lib/services/chat/semantic-video-intent";
import type { IncomingMessage } from "./messages";
import { INVOKE_HIVE_CAPABILITY_TOOL_NAME } from "./invoke-hive-capability-tool";
import { VIDEO_GENERATION_TOOL_NAME } from "./openai-compatible-tools";

type ToolDefinition = {
  function: { name: string };
  [key: string]: unknown;
};

export type SemanticVideoRuntimeRoute<T extends ToolDefinition> = {
  decision: SemanticVideoIntentDecision | null;
  clarifyMethod: boolean;
  toolDefinitions: T[];
  modelContext: string;
};

export async function resolveSemanticVideoRuntimeRoute<T extends ToolDefinition>(input: {
  enabled: boolean;
  url: string;
  headers: Record<string, string>;
  model: string;
  messages: IncomingMessage[];
  signal?: AbortSignal;
  toolDefinitions: T[];
}): Promise<SemanticVideoRuntimeRoute<T>> {
  if (!input.enabled) {
    return { decision: null, clarifyMethod: false, toolDefinitions: input.toolDefinitions, modelContext: "" };
  }
  const decision = await classifySemanticVideoIntent(input);
  if (!decision || decision.confidence < 0.75) {
    return {
      decision,
      clarifyMethod: false,
      toolDefinitions: [],
      modelContext: [
        "HivemindOS semantic video routing was unavailable or uncertain.",
        "Do not call tools or start video generation on this turn.",
        "Interpret the user's latest message as a speech act, not as a keyword trigger.",
        "If it is a concrete request to create a video and the method is unspecified, ask one concise question offering cloud AI, local AI, or HTML / HyperFrames.",
        "If it is discussion, speculation, or a hypothetical about video generation, respond naturally without showing a method picker.",
      ].join("\n"),
    };
  }
  if (decision.intent === "create_unspecified") {
    return { decision, clarifyMethod: true, toolDefinitions: [], modelContext: "" };
  }
  if (decision.intent === "discussion" || decision.intent === "other") {
    return {
      decision,
      clarifyMethod: false,
      toolDefinitions: [],
      modelContext: [
        "HivemindOS semantic video route: this turn is video discussion, not an instruction to create anything.",
        "Respond naturally to what the user said and, when useful, ask what they are considering or hoping to communicate.",
        "Do not call tools, begin a workflow, request command approval, or show the video-method picker unless the user directly asks you to create a video in a later turn.",
      ].join("\n"),
    };
  }
  if (decision.intent === "create_html") {
    return {
      decision,
      clarifyMethod: false,
      toolDefinitions: input.toolDefinitions.filter((definition) => (
        definition.function.name !== VIDEO_GENERATION_TOOL_NAME
        && definition.function.name !== INVOKE_HIVE_CAPABILITY_TOOL_NAME
      )),
      modelContext: [
        "HivemindOS semantic video route: the user selected HTML / HyperFrames rendering.",
        "Selected capability id: skill:packaged:auto-install:hyperframes.",
        "Load packaged-skills/auto-install/hyperframes/SKILL.md (or the synced Shared Brain Skills/hyperframes/SKILL.md) before acting.",
        "Do not call generate_video: that tool routes to cloud/local AI generators, not HyperFrames.",
        "The generic invoke_hive_capability tool does not execute skill files; use the command tool to load and follow the selected skill workflow.",
      ].join("\n"),
    };
  }
  return { decision, clarifyMethod: false, toolDefinitions: input.toolDefinitions, modelContext: "" };
}
