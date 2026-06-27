import { VOICE_TOOL_BUNDLES, describeVoiceToolBundles, getVoiceToolBundle } from "@/lib/services/phone/voice-tool-bundles";

export type VoiceRecipe = {
  id: string;
  title: string;
  description: string;
  mode: "byok" | "cloud" | "local-tts" | "queen";
  providerPreference: string[];
  greeting: string;
  toolBundleId: string;
  allowInterruption: boolean;
  contextSources: string[];
  extractionFields: Array<{
    name: string;
    type: "string" | "number" | "boolean";
    prompt: string;
  }>;
  qaRubric: string[];
};

export const DEFAULT_VOICE_RECIPES: VoiceRecipe[] = [
  {
    id: "agent-runtime-bridge",
    title: "Agent Runtime Bridge",
    description: "Default one-to-one call where voice delegates work to the selected computer-side agent.",
    mode: "byok",
    providerPreference: ["openai-realtime", "local-tts"],
    greeting: "Start with the configured agent greeting, then ask what the user wants to do next.",
    toolBundleId: "agent-call-default",
    allowInterruption: true,
    contextSources: ["selected-agent", "selected-machine", "current-task", "repo-context", "shared-memory-summary"],
    extractionFields: [
      { name: "latest_request", type: "string", prompt: "Most recent concrete request the user made." },
      { name: "follow_up_needed", type: "boolean", prompt: "Whether the call ended with work still needing follow-up." },
      { name: "failed_tool", type: "string", prompt: "Name or summary of any tool/runtime failure." },
    ],
    qaRubric: [
      "The call produced at least one user turn or a useful opening status.",
      "Runtime/tool failures are visible in the run timeline.",
      "The spoken agent did not claim it lacked access when runtime context was available.",
      "Any durable memory candidate is captured for review instead of silently saved.",
    ],
  },
  {
    id: "cloud-multi-agent-room",
    title: "Cloud Multi-Agent Room",
    description: "Managed LiveKit room for multi-party human and multi-agent calls.",
    mode: "cloud",
    providerPreference: ["livekit-cloud-room", "openai-realtime"],
    greeting: "Open with room context, name the agent present, and keep turns short enough for group conversation.",
    toolBundleId: "agent-call-default",
    allowInterruption: true,
    contextSources: ["room-participants", "selected-agent", "selected-machine", "call-reason"],
    extractionFields: [
      { name: "participants", type: "string", prompt: "Humans or agents that materially participated." },
      { name: "room_outcome", type: "string", prompt: "What the room decided or accomplished." },
      { name: "follow_up_needed", type: "boolean", prompt: "Whether follow-up work was identified." },
    ],
    qaRubric: [
      "Room credentials and participant state were tracked.",
      "Agent handoffs stayed scoped to the selected runtime.",
      "The call can be reviewed from a timeline after it ends.",
    ],
  },
  {
    id: "queen-bee-control-plane",
    title: "Queen Bee Control Plane",
    description: "Coordinator voice session for dashboard actions, task creation, preference capture, and hive routing.",
    mode: "queen",
    providerPreference: ["openai-realtime"],
    greeting: "Speak as Queen Bee and keep the first turn short, direct, and ready for routing.",
    toolBundleId: "queen-bee-realtime",
    allowInterruption: true,
    contextSources: ["queen-policy", "fleet-snapshot", "voice-preferences", "recent-conversation"],
    extractionFields: [
      { name: "preference_candidate", type: "string", prompt: "Preference the user explicitly asked to remember." },
      { name: "task_created", type: "boolean", prompt: "Whether a hive task was created." },
      { name: "routing_summary", type: "string", prompt: "Where Queen Bee routed the work." },
    ],
    qaRubric: [
      "Conversation and task routing stayed distinct.",
      "Preferences were saved only when explicitly requested.",
      "Tool results include detail for screen review when available.",
    ],
  },
];

export function listVoiceRecipes() {
  return DEFAULT_VOICE_RECIPES.map((recipe) => ({
    ...recipe,
    toolBundle: getVoiceToolBundle(recipe.toolBundleId),
  }));
}

export function getVoiceRecipe(id: string | undefined) {
  return DEFAULT_VOICE_RECIPES.find((recipe) => recipe.id === id) ?? DEFAULT_VOICE_RECIPES[0];
}

export function validateVoiceRecipe(input: unknown) {
  const value = input && typeof input === "object" ? input as Partial<VoiceRecipe> : {};
  const errors: string[] = [];
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const toolBundleId = typeof value.toolBundleId === "string" ? value.toolBundleId.trim() : "agent-call-default";
  const toolBundle = getVoiceToolBundle(toolBundleId);
  const knownToolBundle = VOICE_TOOL_BUNDLES.some((bundle) => bundle.id === toolBundleId);
  if (!title) errors.push("title is required");
  if (!["byok", "cloud", "local-tts", "queen"].includes(String(value.mode || ""))) errors.push("mode must be byok, cloud, local-tts, or queen");
  if (!knownToolBundle) errors.push("toolBundleId is unknown");
  return {
    ok: errors.length === 0,
    errors,
    recipe: {
      id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : "draft-voice-recipe",
      title,
      description: typeof value.description === "string" ? value.description.trim() : "",
      mode: value.mode,
      toolBundleId,
      toolBundle,
      allowInterruption: value.allowInterruption !== false,
    },
    availableToolBundles: describeVoiceToolBundles(),
  };
}
