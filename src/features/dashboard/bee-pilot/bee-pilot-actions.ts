import { DASHBOARD_ROUTE_CATALOG, isDashboardView } from "@/features/dashboard/dashboard-navigation";

/**
 * Shared Bee Pilot action catalog. Imported by both the client executor and
 * the /api/queen-bee/pilot route, so it must stay pure data + pure functions
 * (no DOM, no React, no node-only imports).
 */

export const BEE_PILOT_ACTION_IDS = [
  "navigate",
  "open-agent-create",
  "open-agent-settings",
  "chat-with-agent",
  "create-wallet",
  "open-wallet",
  "add-kanban-task",
  "search-kanban",
  "open-kanban-task",
  "create-schedule",
  "open-skill-browser",
  "queen-task",
] as const;

export type BeePilotActionId = (typeof BEE_PILOT_ACTION_IDS)[number];

export type BeePilotStep = {
  action: BeePilotActionId;
  params?: Record<string, string>;
};

export type BeePilotPlan = {
  reply: string;
  steps: BeePilotStep[];
};

export type BeePilotContext = {
  agentNames: string[];
  machineNames: string[];
  kanbanColumns: string[];
  activeView?: string;
};

type BeePilotActionSpec = {
  id: BeePilotActionId;
  summary: string;
  params: string;
  examples: string[];
};

const VIEW_IDS = DASHBOARD_ROUTE_CATALOG.map((item) => item.id).join(" | ");

export const BEE_PILOT_ACTION_CATALOG: BeePilotActionSpec[] = [
  {
    id: "navigate",
    summary: "Switch the dashboard to a view (screen/route).",
    params: `{"view": one of ${VIEW_IDS}}`,
    examples: ["show me my wallets", "open the kanban board", "go to settings for env vars"],
  },
  {
    id: "open-agent-create",
    summary: "Open the add-agent modal, then (when asked) pick a runtime and provider by clicking their tiles. Omit machine to use this machine; pass \"phone\" only when explicitly asked; pass \"remote\" for another computer (fewest agents); or a known machine name. runtime is one of: hermes, openclaw, opencode, codex, claude-code, aeon, evo, hivemind-os. provider is one of: venice, usepod, bankr, adaptive, lm-studio, openrouter, openai, anthropic. Omit runtime to keep the user's most-recent runtime.",
    params: '{"machine"?: string, "runtime"?: string, "provider"?: string, "model"?: string, "name"?: string}',
    examples: ["create an agent", "create a venice agent", "create a hermes agent with venice", "create an opencode openrouter agent named Scout on my remote machine", "add an agent on my phone"],
  },
  {
    id: "open-agent-settings",
    summary: "Open the settings modal for an existing agent.",
    params: '{"agent": string}',
    examples: ["open settings for Hermes", "configure my research agent"],
  },
  {
    id: "chat-with-agent",
    summary: "Open the chat view with an agent. Optionally pre-type a message; set send to \"true\" only when the user clearly wants it sent.",
    params: '{"agent": string, "message"?: string, "send"?: "true"}',
    examples: ["chat with Athena", "ask Hermes to summarize today's tasks"],
  },
  {
    id: "create-wallet",
    summary: "Create a wallet for an agent: opens the wallets view, finds the agent's wallet card, and confirms creation.",
    params: '{"agent": string}',
    examples: ["create a wallet for my research agent"],
  },
  {
    id: "open-wallet",
    summary: "Open the wallets view; when an agent is given, expand that agent's wallet.",
    params: '{"agent"?: string}',
    examples: ["show me my wallets", "open Athena's wallet"],
  },
  {
    id: "add-kanban-task",
    summary: "Add a task to the kanban work board by typing into the quick-add input and submitting it. Default column is ideas.",
    params: '{"text": string, "column"?: "ideas" | "ready" | "working" | "needs-human" | "done"}',
    examples: ["draft up an x post about agent swarms", "add a task to fix the login bug"],
  },
  {
    id: "search-kanban",
    summary: "Open the work board filtered by a search query.",
    params: '{"query": string}',
    examples: ["find the task about release builds"],
  },
  {
    id: "open-kanban-task",
    summary: "Open an existing kanban task by an approximate title.",
    params: '{"task": string}',
    examples: ["open the tip bot task"],
  },
  {
    id: "create-schedule",
    summary: "Open the scheduler with a fresh schedule draft modal.",
    params: "{}",
    examples: ["create a schedule", "set up a recurring job"],
  },
  {
    id: "open-skill-browser",
    summary: "Open the shared skill browser.",
    params: "{}",
    examples: ["browse skills", "open the skill library"],
  },
  {
    id: "queen-task",
    summary: "Delegate actual work (research, build, fix, write, automate) to the hive via the Queen Bee control plane. Use this when the user asks for work to be DONE rather than UI to be operated.",
    params: '{"title": string, "message": string}',
    examples: ["research the best lottie libraries and report back"],
  },
];

export function describeBeePilotActions(): string {
  return BEE_PILOT_ACTION_CATALOG
    .map((action) => `- ${action.id}: ${action.summary} params=${action.params}`)
    .join("\n");
}

export function isBeePilotActionId(value: unknown): value is BeePilotActionId {
  return typeof value === "string" && (BEE_PILOT_ACTION_IDS as readonly string[]).includes(value);
}

const MAX_PLAN_STEPS = 6;

/** Extracts and validates a Bee Pilot plan from raw model text (strict-JSON-with-slack). */
export function parseBeePilotPlan(text: string): BeePilotPlan | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { reply?: unknown; steps?: unknown };
    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const steps: BeePilotStep[] = [];
    for (const raw of rawSteps.slice(0, MAX_PLAN_STEPS)) {
      if (!raw || typeof raw !== "object") continue;
      const record = raw as { action?: unknown; params?: unknown };
      if (!isBeePilotActionId(record.action)) continue;
      const params: Record<string, string> = {};
      if (record.params && typeof record.params === "object") {
        for (const [key, value] of Object.entries(record.params as Record<string, unknown>)) {
          if (typeof value === "string" && value.trim()) params[key] = value.trim();
          else if (typeof value === "number" || typeof value === "boolean") params[key] = String(value);
        }
      }
      steps.push({ action: record.action, params });
    }
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim().slice(0, 300) : "";
    if (!reply && !steps.length) return null;
    return { reply: reply || "On it.", steps };
  } catch {
    return null;
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

// Canonical runtime ids keyed by the words a user might say.
const RUNTIME_ALIASES: Array<[RegExp, string]> = [
  [/\b(hermes)\b/, "hermes"],
  [/\b(openclaw|open claw|claw)\b/, "openclaw"],
  [/\b(opencode|open code)\b/, "opencode"],
  [/\b(codex)\b/, "codex"],
  [/\b(claude[\s-]?code|claudecode|claude)\b/, "claude-code"],
  [/\b(aeon)\b/, "aeon"],
  [/\b(evo)\b/, "evo"],
  [/\b(hivemind[\s-]?os|hivemindos|hivemind|on[\s-]?device)\b/, "hivemind-os"],
];

// Canonical provider slugs keyed by the words a user might say. Order matters:
// more specific phrases first so "local openai" beats a bare "openai".
const PROVIDER_ALIASES: Array<[RegExp, string]> = [
  [/\b(venice)\b/, "venice"],
  [/\b(usepod|use pod)\b/, "usepod"],
  [/\b(bankr)\b/, "bankr"],
  [/\b(adaptive)\b/, "adaptive"],
  [/\b(local openai|lm[\s-]?studio|lmstudio)\b/, "lm-studio"],
  [/\b(open ?router)\b/, "openrouter"],
  [/\b(anthropic|claude api)\b/, "anthropic"],
  [/\b(openai|chat ?gpt|gpt)\b/, "openai"],
];

/** Resolve a runtime word/phrase to a canonical runtime id, or null. */
export function resolveRuntimeId(value: string | undefined): string | null {
  const text = normalize(value ?? "");
  if (!text) return null;
  for (const [pattern, id] of RUNTIME_ALIASES) {
    if (pattern.test(text)) return id;
  }
  return null;
}

/** Resolve a provider word/phrase to a canonical provider slug, or null. */
export function resolveProviderSlug(value: string | undefined): string | null {
  const text = normalize(value ?? "");
  if (!text) return null;
  for (const [pattern, slug] of PROVIDER_ALIASES) {
    if (pattern.test(text)) return slug;
  }
  return null;
}

// A model name looks like one of these families or carries a size/version digit.
const MODEL_TOKEN = /\b(gpt[\w.-]*|o[134][\w.-]*|claude[\w.-]*|opus[\w.-]*|sonnet[\w.-]*|haiku[\w.-]*|llama[\w.-]*|mistral[\w.-]*|mixtral[\w.-]*|qwen[\w.-]*|gemini[\w.-]*|deepseek[\w.-]*|grok[\w.-]*|kimi[\w.-]*|nemotron[\w.-]*|phi[\w.-]*|[\w.-]*\d+b)\b/;

/**
 * Pull a model hint out of the descriptor of a "create ... agent" command,
 * after the runtime and provider words have been resolved. Conservative: only
 * returns a token that looks like a model family/size, so stray words never
 * get mistaken for a model.
 */
export function extractModelHint(
  descriptor: string,
  runtime: string | null,
  provider: string | null,
): string | null {
  let rest = ` ${normalize(descriptor)} `;
  for (const [pattern, id] of RUNTIME_ALIASES) {
    if (id === runtime) rest = rest.replace(pattern, " ");
  }
  for (const [pattern, slug] of PROVIDER_ALIASES) {
    if (slug === provider) rest = rest.replace(pattern, " ");
  }
  rest = rest.replace(/\b(a|an|the|new|with|using|on|model)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!rest) return null;
  const match = rest.match(MODEL_TOKEN);
  return match ? match[0] : null;
}

function matchName(names: string[], query: string): string | null {
  const needle = normalize(query);
  if (!needle) return null;
  const exact = names.find((name) => normalize(name) === needle);
  if (exact) return exact;
  return names.find((name) => normalize(name).includes(needle) || needle.includes(normalize(name))) ?? null;
}

function matchView(phrase: string): string | null {
  const needle = normalize(phrase).replace(/^(the|my)\s+/, "").replace(/\s+(view|screen|page|panel|tab|board)$/, "");
  if (!needle) return null;
  if (isDashboardView(needle)) return needle;
  for (const item of DASHBOARD_ROUTE_CATALOG) {
    const candidates = [item.label, ...item.keywords].map(normalize);
    if (candidates.some((candidate) => candidate === needle || candidate === `${needle}s` || `${candidate}s` === needle)) {
      return item.id;
    }
  }
  for (const item of DASHBOARD_ROUTE_CATALOG) {
    if ([item.label, ...item.keywords].map(normalize).some((candidate) => needle.includes(candidate))) {
      return item.id;
    }
  }
  return null;
}

/**
 * Deterministic tier of the resolver: covers the common explicit phrasings
 * instantly so the LLM round-trip is only paid for fuzzy requests.
 */
export function localBeePilotPlan(input: string, context: BeePilotContext): BeePilotPlan | null {
  const command = input.trim();
  const lower = normalize(command);
  if (!lower) return null;

  // "create [a] [runtime] [provider] agent [named <name>] [on <machine>]"
  const createAgent = command.match(/^(?:create|add|make|new)\s+(?:a\s+|an\s+|new\s+)*(?<desc>[a-z0-9 -]*?)\s*agent\b(?<rest>.*)$/i);
  if (createAgent) {
    const params: Record<string, string> = {};
    const rest = createAgent.groups?.rest ?? "";
    const nameMatch = rest.match(/\b(?:named|called)\s+(?<name>.+?)(?:\s+on\b.*)?$/i);
    if (nameMatch?.groups?.name) params.name = nameMatch.groups.name.trim();
    const machineMatch = rest.match(/\bon\s+(?:my\s+)?(?<machine>.+?)(?:\s+(?:named|called)\b.*)?$/i);
    if (machineMatch?.groups?.machine) params.machine = machineMatch.groups.machine.trim();
    const desc = createAgent.groups?.desc ?? "";
    const runtime = resolveRuntimeId(desc);
    if (runtime) params.runtime = runtime;
    const provider = resolveProviderSlug(desc);
    if (provider) params.provider = provider;
    const model = extractModelHint(desc, runtime, provider);
    if (model) params.model = model;
    const detail = model || provider;
    const reply = detail || runtime
      ? `Opening the new agent setup${detail ? ` with ${detail}` : ""}.`
      : "Opening the new agent setup.";
    return { reply, steps: [{ action: "open-agent-create", params }] };
  }

  // "create a wallet for [my] <agent>"
  const createWallet = lower.match(/^(?:create|add|make|set\s*up)\s+(?:a\s+)?(?:new\s+)?wallet\s+for\s+(?:my\s+)?(?<agent>.+)$/);
  if (createWallet?.groups?.agent) {
    const agent = matchName(context.agentNames, createWallet.groups.agent);
    if (agent) return { reply: `Creating a wallet for ${agent}.`, steps: [{ action: "create-wallet", params: { agent } }] };
  }

  // "draft up an x post about <topic>" -> kanban task
  const draftPost = command.match(/^draft\s+(?:up\s+)?(?:an?\s+)?(?:x|tweet|twitter|social)?\s*post\s+(?:about|on|for)\s+(?<topic>.+)$/i);
  if (draftPost?.groups?.topic) {
    const topic = draftPost.groups.topic.trim();
    return {
      reply: `Adding a draft task for an X post about ${topic}.`,
      steps: [{ action: "add-kanban-task", params: { text: `Draft an X post about ${topic}`, column: "ideas" } }],
    };
  }

  // "add a task [to <column>] <text>" / "add <text> to the board"
  const addTask = command.match(/^(?:add|create)\s+(?:a\s+)?(?:new\s+)?task\s*(?::\s*|to\s+do\s+)?(?<text>.+)$/i);
  if (addTask?.groups?.text) {
    return { reply: "Adding that to the work board.", steps: [{ action: "add-kanban-task", params: { text: addTask.groups.text.trim() } }] };
  }

  // "chat with <agent>" / "talk to <agent>"
  const chatWith = lower.match(/^(?:chat|talk|speak)\s+(?:with|to)\s+(?:my\s+)?(?<agent>.+)$/);
  if (chatWith?.groups?.agent) {
    const agent = matchName(context.agentNames, chatWith.groups.agent);
    if (agent) return { reply: `Opening a chat with ${agent}.`, steps: [{ action: "chat-with-agent", params: { agent } }] };
  }

  // "open <agent>'s wallet"
  const agentWallet = lower.match(/^(?:open|show)\s+(?:me\s+)?(?<agent>.+?)(?:\s+s)?\s+wallet$/);
  if (agentWallet?.groups?.agent) {
    const agent = matchName(context.agentNames, agentWallet.groups.agent);
    if (agent) return { reply: `Opening ${agent}'s wallet.`, steps: [{ action: "open-wallet", params: { agent } }] };
  }

  // "show me my wallets" and other navigation phrasings
  const navigate = lower.match(/^(?:open|show(?:\s+me)?|go\s+to|take\s+me\s+to|view|switch\s+to|bring\s+up)\s+(?<rest>.+)$/);
  const navPhrase = navigate?.groups?.rest ?? lower;
  const view = matchView(navPhrase);
  if (view) {
    const label = DASHBOARD_ROUTE_CATALOG.find((item) => item.id === view)?.label ?? view;
    return { reply: `Taking you to ${label}.`, steps: [{ action: "navigate", params: { view } }] };
  }

  if (/^(?:create|add|new)\s+(?:a\s+)?schedule\b/.test(lower)) {
    return { reply: "Opening a new schedule draft.", steps: [{ action: "create-schedule", params: {} }] };
  }

  if (/skill(s)?\s*(browser|library|shelf)?$/.test(lower) && /^(open|show|browse)/.test(lower)) {
    return { reply: "Opening the skill browser.", steps: [{ action: "open-skill-browser", params: {} }] };
  }

  return null;
}
