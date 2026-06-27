export type VoiceToolId =
  | "ask_computer_agent"
  | "create_hive_task"
  | "remember_preference"
  | "drive_dashboard"
  | "end_call";

export type VoiceToolSchema = {
  type: "function";
  name: VoiceToolId;
  description: string;
  parameters: Record<string, unknown>;
};

export type VoiceToolBundle = {
  id: string;
  label: string;
  description: string;
  phase: "agent-call" | "queen-bee" | "handoff" | "review";
  toolIds: VoiceToolId[];
};

export const ASK_COMPUTER_AGENT_TOOL: VoiceToolSchema = {
  type: "function",
  name: "ask_computer_agent",
  description:
    "Delegate the user's request to the selected HivemindOS computer agent through the paired desktop gateway. Use this whenever the user asks that computer agent to inspect, change, run, schedule, or answer from its runtime context.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The exact request to send to the selected computer-side agent runtime.",
      },
    },
    required: ["message"],
  },
};

export const VOICE_TOOLS: Record<VoiceToolId, VoiceToolSchema> = {
  ask_computer_agent: ASK_COMPUTER_AGENT_TOOL,
  create_hive_task: {
    type: "function",
    name: "create_hive_task",
    description:
      "Create a HivemindOS work-board task when the user clearly asks for work to be delegated to the hive.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task title." },
        message: { type: "string", description: "Full work request in the user's words." },
      },
      required: ["message"],
    },
  },
  remember_preference: {
    type: "function",
    name: "remember_preference",
    description:
      "Save a durable voice preference only when the user explicitly asks HivemindOS to remember a preference for future calls.",
    parameters: {
      type: "object",
      properties: {
        preference: { type: "string", description: "The concise preference to remember." },
      },
      required: ["preference"],
    },
  },
  drive_dashboard: {
    type: "function",
    name: "drive_dashboard",
    description:
      "Drive the visible HivemindOS dashboard when the user asks for an on-screen action during a voice session.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The dashboard action to perform." },
      },
      required: ["command"],
    },
  },
  end_call: {
    type: "function",
    name: "end_call",
    description:
      "End the current voice call after the user asks to hang up or the call's explicit success condition is complete.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Short reason the call is ending." },
      },
    },
  },
};

export const VOICE_TOOL_BUNDLES: VoiceToolBundle[] = [
  {
    id: "agent-call-default",
    label: "Agent Call Default",
    description: "One selected HivemindOS agent can answer and act through its normal runtime context.",
    phase: "agent-call",
    toolIds: ["ask_computer_agent"],
  },
  {
    id: "queen-bee-realtime",
    label: "Queen Bee Realtime",
    description: "Coordinator voice tools for task creation, preference capture, dashboard driving, and agent delegation.",
    phase: "queen-bee",
    toolIds: ["ask_computer_agent", "create_hive_task", "remember_preference", "drive_dashboard"],
  },
  {
    id: "review-only",
    label: "Review Only",
    description: "No live side effects; useful for QA, summaries, and transcript review.",
    phase: "review",
    toolIds: [],
  },
];

export function getVoiceToolBundle(id: string | undefined) {
  return VOICE_TOOL_BUNDLES.find((bundle) => bundle.id === id) ?? VOICE_TOOL_BUNDLES[0];
}

export function toolsForVoiceToolBundle(id: string | undefined) {
  return getVoiceToolBundle(id).toolIds.map((toolId) => VOICE_TOOLS[toolId]);
}

export function describeVoiceToolBundles() {
  return VOICE_TOOL_BUNDLES.map((bundle) => ({
    ...bundle,
    tools: bundle.toolIds.map((toolId) => VOICE_TOOLS[toolId]),
  }));
}
