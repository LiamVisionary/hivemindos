import {
  classifySemanticVideoIntent,
  type SemanticVideoIntentDecision,
} from "@/lib/services/chat/semantic-video-intent";
import {
  isConcreteHyperframesVideoRequest,
  isHyperframesRenderRequest,
} from "@/lib/services/chat/hyperframes-prompt";
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
  guideHyperframesPrompt: boolean;
  toolDefinitions: T[];
  modelContext: string;
};

function latestUserText(messages: IncomingMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content.trim();
    if (Array.isArray(message.content)) {
      return message.content.flatMap((part) => {
        if (!part || typeof part !== "object") return [];
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? [text] : [];
      }).join("\n").trim();
    }
  }
  return "";
}

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
    return { decision: null, clarifyMethod: false, guideHyperframesPrompt: false, toolDefinitions: input.toolDefinitions, modelContext: "" };
  }
  const latestRequest = latestUserText(input.messages);
  const approvedHyperframesRender = isHyperframesRenderRequest(latestRequest);
  const explicitHyperframesCreation = isConcreteHyperframesVideoRequest(latestRequest);
  const decision = approvedHyperframesRender || explicitHyperframesCreation
    ? { intent: "create_html" as const, confidence: 1 }
    : await classifySemanticVideoIntent(input);
  if (!decision || decision.confidence < 0.75) {
    return {
      decision,
      clarifyMethod: false,
      guideHyperframesPrompt: false,
      toolDefinitions: [],
      modelContext: [
        "HivemindOS semantic video routing was unavailable or uncertain.",
        "Do not call tools or start video generation on this turn.",
        "Interpret the user's latest message as a speech act, not as a keyword trigger.",
        "If it is a concrete request to create a video and the method is unspecified, ask one explicit preference question, then provide exactly three Markdown bullet options: Cloud AI video, Local AI video, and HTML / HyperFrames.",
        "If it is discussion, speculation, or a hypothetical about video generation, respond naturally without showing a method picker.",
      ].join("\n"),
    };
  }
  if (decision.intent === "create_unspecified") {
    return { decision, clarifyMethod: true, guideHyperframesPrompt: false, toolDefinitions: [], modelContext: "" };
  }
  if (decision.intent === "discussion" || decision.intent === "other") {
    return {
      decision,
      clarifyMethod: false,
      guideHyperframesPrompt: false,
      toolDefinitions: [],
      modelContext: [
        "HivemindOS semantic video route: this turn is video discussion, not an instruction to create anything.",
        "Respond naturally to what the user said and, when useful, ask what they are considering or hoping to communicate.",
        "Do not call tools, begin a workflow, request command approval, or show the video-method picker unless the user directly asks you to create a video in a later turn.",
      ].join("\n"),
    };
  }
  if (decision.intent === "create_html") {
    if (!approvedHyperframesRender) {
      return {
        decision,
        clarifyMethod: false,
        guideHyperframesPrompt: true,
        toolDefinitions: [],
        modelContext: "",
      };
    }
    return {
      decision,
      clarifyMethod: false,
      guideHyperframesPrompt: false,
      toolDefinitions: input.toolDefinitions.filter((definition) => (
        definition.function.name !== VIDEO_GENERATION_TOOL_NAME
        && definition.function.name !== INVOKE_HIVE_CAPABILITY_TOOL_NAME
      )),
      modelContext: [
        "HivemindOS semantic video route: the user selected HTML / HyperFrames rendering.",
        "Selected capability id: skill:packaged:auto-install:hyperframes.",
        "Load packaged-skills/auto-install/hyperframes/SKILL.md (or the synced Shared Brain Skills/hyperframes/SKILL.md) before acting.",
        "Read that exact file with the command tool without adding unsupported flags. After the router selects a workflow slug, load its sibling at packaged-skills/auto-install/<slug>/SKILL.md; never invent a packaged-skills/hyperframes/<slug> path.",
        "Every HyperFrames workflow is bundled. Do not run `npx skills add` or `npx skills update` to obtain one.",
        "The guided card already captured and displayed all six prompt decisions, and its Render button is the user's explicit approval to build and render this local composition. Do not ask for a second render confirmation.",
        "Use command `hyperframes` through the command tool for the pinned managed CLI. Never run `npx hyperframes`, a global `hyperframes`, or any install/update command.",
        "Do not run `hyperframes init`: this pinned upstream release makes an unskippable mutable skills update during init. Create the composition directory and files directly, then use the bundled workflow contract.",
        "Keep the workflow local. Do not use publish, Lambda, cloud rendering, telemetry, upgrade, catalog, add, or skills commands.",
        "Run lint, validate, and inspect before a high-quality render. After rendering, verify the output exists and report its absolute local video path so HivemindOS can show the video card.",
        "Do not call generate_video: that tool routes to cloud/local AI generators, not HyperFrames.",
        "The generic invoke_hive_capability tool does not execute skill files; use the command tool to load and follow the selected skill workflow.",
      ].join("\n"),
    };
  }
  return { decision, clarifyMethod: false, guideHyperframesPrompt: false, toolDefinitions: input.toolDefinitions, modelContext: "" };
}
