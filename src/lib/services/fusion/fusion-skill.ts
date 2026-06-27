import { invalidateCachedCall } from "@/lib/services/async-cache";
import {
  searchContextIndex,
  type ContextConnectedApp,
  type ContextIndexItem,
  type ContextIndexKind,
} from "@/lib/services/context-index";
import {
  getSharedBrainSkills,
  SHARED_BRAIN_CACHE_PREFIX,
  writeBrainSkill,
  type BrainSkillSummary,
} from "@/lib/services/obsidian/brain-skills";

export type FusionCapabilityIcon =
  | "bot"
  | "brain"
  | "code"
  | "database"
  | "file"
  | "globe"
  | "image"
  | "network"
  | "search"
  | "send"
  | "shield"
  | "sparkles"
  | "terminal"
  | "wallet";

export type FusionCapabilityTone = "teal" | "gold" | "violet" | "blue" | "black";

export type FusionCapabilityRecord = {
  id: string;
  label: string;
  kind: ContextIndexKind | "local-tool";
  machine: string;
  machineLabel: string;
  tone: FusionCapabilityTone;
  icon: FusionCapabilityIcon;
  logo?: string;
  used: boolean;
  meta: string;
  detail: string;
  locator: string;
  score: number;
};

export type FusionSkillResult = {
  prompt: string;
  skill: {
    name: string;
    slug: string;
    description: string;
    path: string;
  };
  capabilities: FusionCapabilityRecord[];
  discoveredCount: number;
  fusedCount: number;
  machineCount: number;
  markdown: string;
};

const CONTEXT_KINDS: ContextIndexKind[] = ["skill", "tool-schema", "api-route", "connected-app", "app-endpoint", "runtime"];
const MAX_CAPABILITIES = 10;
const MAX_FUSED = 5;

function words(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
}

function compact(value: string, max = 180) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function skillNameFromPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();
  if (/\bbase\b/.test(normalized) && /\bx\b|twitter|tweet/.test(normalized) && /telegram|message|send/.test(normalized)) {
    return "Base News Broadcast Skill";
  }
  if (/image|picture|visual|render|generate/.test(normalized) && /send|telegram|message|deliver/.test(normalized)) {
    return "Image Delivery Skill";
  }
  if (/workflow|orchestrate|sequence|handoff/.test(normalized)) return "Hive Workflow Fusion Skill";
  if (/aeon|background|recurring|schedule|cadence|autopilot/.test(normalized)) return "Hive AEON Fusion Skill";
  const meaningful = words(prompt).filter((word) => !["make", "skill", "that", "with", "then", "from", "into", "today"].includes(word)).slice(0, 4);
  return meaningful.length ? `${titleCase(meaningful.join(" "))} Skill` : "Custom Hive Skill";
}

function skillSlugFromName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "custom-hive-skill";
}

function skillDescription(prompt: string) {
  return `A reusable Hive skill generated from this request: ${compact(prompt, 180)}`;
}

function relatedQueries(prompt: string) {
  const normalized = prompt.toLowerCase();
  const queries = [prompt];
  if (/\b(x|twitter|tweet|post|social)\b/.test(normalized)) {
    const socialTerms = ["x", "twitter", "social", "post", "xurl", "writer"];
    if (/news|latest|current|trend|research/.test(normalized)) socialTerms.push("search", "latest", "news");
    queries.push(socialTerms.join(" "));
  }
  if (/image|picture|photo|visual|render|generate|generation/.test(normalized)) {
    queries.push("image generation comfyui zimage imagegen visual creative");
  }
  if (/telegram|message|send|deliver|delivery|notify|notification/.test(normalized)) {
    queries.push("telegram message send notification delivery channel hermes");
  }
  if (/kanban|task|tasks|board|work|priority|prioritized|brief|action item|todo|unfinished/.test(normalized)) {
    queries.push("kanban work board task creation orchestrator create task prioritize action brief");
  }
  if (/brain|memory|vault|rag|style|obsidian|notes/.test(normalized)) {
    queries.push("shared brain obsidian rag memory style guide skill vault");
  }
  if (/agent|worker|specialist|runtime|workflow|aeon/.test(normalized)) {
    queries.push("agent worker runtime capabilities skill workflow aeon scheduler");
  }
  return [...new Set(queries)].slice(0, 5);
}

function requiredQueries(prompt: string) {
  const normalized = prompt.toLowerCase();
  const queries: string[] = [];
  if (/telegram|message|send|deliver|delivery|notify|notification/.test(normalized)) {
    queries.push("telegram message send notification delivery channel hermes");
  }
  if (/kanban|task|tasks|board|work|priority|prioritized|brief|action item|todo|unfinished/.test(normalized)) {
    queries.push("kanban work board task creation orchestrator create task prioritize action brief");
  }
  if (/brain|memory|vault|rag|style|obsidian|notes/.test(normalized)) {
    queries.push("shared brain obsidian rag memory style guide skill vault");
  }
  return queries;
}

function itemSearchText(item: ContextIndexItem) {
  return `${item.id} ${item.title} ${item.summary} ${item.tags.join(" ")} ${item.aliases?.join(" ") ?? ""} ${item.path ?? ""} ${item.route ?? ""}`.toLowerCase();
}

function promptAllowsBaseNews(prompt: string) {
  return /\bbase\b|base chain|onchain|crypto|blockchain|news|latest|current|trend|research|ecosystem/.test(prompt.toLowerCase());
}

function isPromptSpecificNoise(prompt: string, text: string) {
  if (!promptAllowsBaseNews(prompt) && /base[-\s]?news|base ecosystem|base chain|onchain/.test(text)) return true;
  return false;
}

function boostForPrompt(prompt: string, item: ContextIndexItem) {
  const normalized = prompt.toLowerCase();
  const text = itemSearchText(item);
  if (isPromptSpecificNoise(prompt, text)) return -220;
  let boost = 0;
  if (/kanban|task|tasks|board|work|priority|prioritized|brief|action item|todo|unfinished/.test(normalized)) {
    if (/kanban|orchestrator|task|work-history|work board|board/.test(text)) boost += 160;
    if (item.kind === "api-route" && /kanban|orchestrator/.test(text)) boost += 90;
  }
  if (/telegram/.test(normalized) && /telegram|hermes/.test(text)) {
    boost += 140;
  } else if (/message|send|deliver|delivery|notify|notification/.test(normalized) && /send|message|notification|delivery|hermes/.test(text)) {
    boost += 90;
  }
  if (/brain|memory|vault|rag|style|obsidian|notes/.test(normalized) && /obsidian|brain|vault|rag|memory|note/.test(text)) {
    boost += 70;
  }
  if (/\b(x|twitter|tweet|post|social)\b/.test(normalized) && /xurl|twitter|\bx\b|social|post/.test(text)) {
    boost += 90;
  }
  if (/image|picture|photo|visual|render|generate|generation/.test(normalized) && /image|comfy|zimage|visual|render|diffusion/.test(text)) {
    boost += 90;
  }
  return boost;
}

function promptIntentPatterns(prompt: string) {
  const normalized = prompt.toLowerCase();
  const patterns: RegExp[] = [];
  if (/kanban|task|tasks|board|work|priority|prioritized|brief|action item|todo|unfinished/.test(normalized)) {
    patterns.push(/kanban-orchestrator|\/api\/kanban|\/api\/orchestrator|kanban|task|work board/);
  }
  if (/telegram|message|send|deliver|delivery|notify|notification/.test(normalized)) {
    patterns.push(/hermes send|telegram|send|message|notification|delivery/);
  }
  if (/brain|memory|vault|rag|style|obsidian|notes/.test(normalized)) {
    patterns.push(/obsidian|brain|vault|rag|memory|note/);
  }
  if (/image|picture|photo|visual|render|generate|generation/.test(normalized)) {
    patterns.push(/image|comfy|zimage|visual|render|diffusion|creative|generative/);
  }
  if (/\b(x|twitter|tweet|post|social)\b/.test(normalized)) {
    patterns.push(/xurl|twitter|\bx\b|social|post|writer|writing|caption/);
  }
  if (/workflow|orchestrate|sequence|handoff/.test(normalized)) {
    patterns.push(/workflow|orchestrator|sequence|handoff/);
  }
  if (/aeon|background|recurring|schedule|cadence|autopilot/.test(normalized)) {
    patterns.push(/aeon|background|recurring|schedule|cadence|autopilot/);
  }
  return patterns;
}

function matchesPromptIntent(prompt: string, text: string) {
  if (isPromptSpecificNoise(prompt, text)) return false;
  const patterns = promptIntentPatterns(prompt);
  if (!patterns.length) return true;
  return patterns.some((pattern) => pattern.test(text));
}

function iconForItem(item: ContextIndexItem): FusionCapabilityIcon {
  const text = `${item.title} ${item.summary} ${item.tags.join(" ")} ${item.aliases?.join(" ") ?? ""}`.toLowerCase();
  if (/telegram|send|message|delivery|notify/.test(text)) return "send";
  if (/image|comfy|zimage|visual|render|diffusion/.test(text)) return "image";
  if (/obsidian|brain|vault|rag|memory/.test(text)) return "brain";
  if (/wallet|payment|usdc|x402|bankr|moneyclaw|veil/.test(text)) return "wallet";
  if (/xurl|twitter|\bx\b|social|search/.test(text)) return "search";
  if (/code|git|repo|script|terminal|cli|shell/.test(text)) return item.kind === "tool-schema" ? "terminal" : "code";
  if (/shield|safety|approval|private/.test(text)) return "shield";
  if (item.kind === "runtime") return "bot";
  if (item.kind === "api-route" || item.kind === "app-endpoint") return "globe";
  if (item.kind === "connected-app") return "sparkles";
  if (item.kind === "workspace-file") return "file";
  return item.kind === "skill" ? "sparkles" : "network";
}

function toneForItem(item: ContextIndexItem): FusionCapabilityTone {
  if (item.kind === "connected-app" || item.kind === "app-endpoint") return "blue";
  if (item.kind === "skill") return "gold";
  if (item.kind === "runtime") return "violet";
  if (item.kind === "tool-schema") return "teal";
  if (item.kind === "api-route") return "black";
  return "teal";
}

function logoForItem(item: ContextIndexItem) {
  const text = `${item.title} ${item.summary} ${item.tags.join(" ")} ${item.aliases?.join(" ") ?? ""}`.toLowerCase();
  if (/\bcomfyui\b/.test(text)) return "/fusion/logos/comfyui.svg";
  if (/\btelegram\b/.test(text)) return "/fusion/logos/telegram.svg";
  if (/\bobsidian\b/.test(text)) return "/fusion/logos/obsidian.svg";
  if (/\bbase\b/.test(text)) return "/fusion/logos/base-mark.svg";
  if (/\bxurl\b|\btwitter\b|\bx search\b|\bx post\b/.test(text)) return "/fusion/logos/x.svg";
  if (/writer/.test(text)) return "/icons/worker-bee-writer-v2.png";
  if (/code/.test(text)) return "/icons/worker-bee-code-v2.png";
  return undefined;
}

function machineForItem(item: ContextIndexItem) {
  const machineTag = item.tags.find((tag) => /mac|mbp|machine|vps|gpu|host|remote/.test(tag));
  if (item.kind === "connected-app" || item.kind === "app-endpoint") {
    const match = item.summary.match(/Machine:\s*([^.;]+)/i);
    const label = match?.[1]?.trim() || machineTag || "Connected app host";
    return { id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "connected-app-host", label };
  }
  if (item.kind === "runtime") return { id: "runtime", label: "Runtime" };
  return { id: "this-mac", label: "This Mac" };
}

function metaForItem(item: ContextIndexItem) {
  if (item.kind === "skill") return "Skill";
  if (item.kind === "tool-schema") return "Tool";
  if (item.kind === "connected-app") return "App";
  if (item.kind === "app-endpoint") return "Endpoint";
  if (item.kind === "runtime") return "Agent";
  if (item.kind === "api-route") return "API";
  return "Context";
}

function capabilityFromItem(item: ContextIndexItem, index: number, used: boolean): FusionCapabilityRecord {
  const machine = machineForItem(item);
  return {
    id: item.id,
    label: compact(item.title, 34),
    kind: item.kind,
    machine: machine.id,
    machineLabel: machine.label,
    tone: toneForItem(item),
    icon: iconForItem(item),
    logo: logoForItem(item),
    used,
    meta: metaForItem(item),
    detail: compact(item.summary, 180),
    locator: item.path || item.route || item.load.target || item.load.note || "",
    score: item.score ?? Math.max(1, MAX_CAPABILITIES - index),
  };
}

function prioritizeCapabilities(items: ContextIndexItem[], prompt: string) {
  const selected: ContextIndexItem[] = [];
  const seen = new Set<string>();
  const normalized = prompt.toLowerCase();
  const intentPatterns = promptIntentPatterns(prompt);
  const pick = (pattern: RegExp) => {
    const item = items.find((candidate) => {
      const text = itemSearchText(candidate);
      return !seen.has(candidate.id) && pattern.test(text) && !isPromptSpecificNoise(prompt, text);
    });
    if (!item) return;
    selected.push(item);
    seen.add(item.id);
  };
  for (const pattern of intentPatterns) pick(pattern);
  const wantedKinds: ContextIndexKind[] = ["skill", "tool-schema", "connected-app", "app-endpoint", "runtime", "api-route"];
  for (const kind of wantedKinds) {
    const item = items.find((candidate) => {
      const text = itemSearchText(candidate);
      return candidate.kind === kind && !seen.has(candidate.id) && matchesPromptIntent(prompt, text);
    });
    if (!item) continue;
    selected.push(item);
    seen.add(item.id);
  }
  for (const item of items) {
    if (selected.length >= MAX_CAPABILITIES) break;
    if (seen.has(item.id)) continue;
    const text = itemSearchText(item);
    if (!matchesPromptIntent(prompt, text)) continue;
    selected.push(item);
    seen.add(item.id);
  }
  const ensure = (pattern: RegExp, index: number) => {
    if (selected.some((item) => pattern.test(itemSearchText(item)) && !isPromptSpecificNoise(prompt, itemSearchText(item)))) return;
    const item = items.find((candidate) => {
      const text = itemSearchText(candidate);
      return !seen.has(candidate.id) && pattern.test(text) && !isPromptSpecificNoise(prompt, text);
    });
    if (!item) return;
    selected.splice(Math.min(index, selected.length), 0, item);
    seen.add(item.id);
  };
  if (/telegram|message|send|deliver|delivery|notify|notification/.test(normalized)) {
    ensure(/hermes send|telegram/, 1);
  }
  if (/brain|memory|vault|rag|style|obsidian|notes/.test(normalized)) {
    ensure(/obsidian|brain|vault|rag|memory|note/, 2);
  }
  if (/kanban|task|tasks|board|work|priority|prioritized|brief|action item|todo|unfinished/.test(normalized)) {
    ensure(/kanban-orchestrator|\/api\/kanban|\/api\/orchestrator|kanban|task|work board/, 0);
  }
  if (selected.length < MAX_CAPABILITIES && !intentPatterns.length) {
    for (const item of items) {
      if (selected.length >= MAX_CAPABILITIES) break;
      if (seen.has(item.id)) continue;
      if (isPromptSpecificNoise(prompt, itemSearchText(item))) continue;
      selected.push(item);
      seen.add(item.id);
    }
  }
  return selected.slice(0, MAX_CAPABILITIES);
}

function capabilitySearchText(capability: FusionCapabilityRecord) {
  return `${capability.id} ${capability.label} ${capability.meta} ${capability.detail} ${capability.kind}`.toLowerCase();
}

function fusedCapabilities(capabilities: FusionCapabilityRecord[], prompt: string) {
  const normalized = prompt.toLowerCase();
  const selected: FusionCapabilityRecord[] = [];
  const selectedIds = new Set<string>();
  const pick = (pattern: RegExp) => {
    const capability = capabilities.find((candidate) => {
      const text = capabilitySearchText(candidate);
      return !selectedIds.has(candidate.id) && pattern.test(text) && !isPromptSpecificNoise(prompt, text);
    });
    if (!capability) return;
    selected.push(capability);
    selectedIds.add(capability.id);
  };
  if (/kanban|task|tasks|board|work|priority|prioritized|brief|action item|todo|unfinished/.test(normalized)) {
    pick(/kanban-orchestrator|\/api\/kanban|\/api\/orchestrator|kanban|task|work board/);
  }
  if (/telegram|message|send|deliver|delivery|notify|notification/.test(normalized)) {
    pick(/hermes send|telegram/);
  }
  if (/brain|memory|vault|rag|style|obsidian|notes/.test(normalized)) {
    pick(/obsidian|brain|vault|rag|memory|note/);
  }
  if (/image|picture|photo|visual|render|generate|generation/.test(normalized)) {
    pick(/image|comfy|zimage|visual|render|diffusion/);
  }
  if (/\b(x|twitter|tweet|post|social)\b/.test(normalized)) {
    pick(/xurl|twitter|\bx\b|social|post|writer|writing|caption/);
  }
  const preferred = capabilities.filter((capability) =>
    ["skill", "tool-schema", "api-route", "connected-app", "app-endpoint", "runtime"].includes(capability.kind)
    && matchesPromptIntent(prompt, capabilitySearchText(capability)),
  );
  for (const capability of preferred.length ? preferred : capabilities) {
    if (selected.length >= MAX_FUSED) break;
    if (selectedIds.has(capability.id)) continue;
    selected.push(capability);
    selectedIds.add(capability.id);
  }
  return capabilities.map((capability) => ({ ...capability, used: selectedIds.has(capability.id) }));
}

function selectedSkill(after: BrainSkillSummary[], before: BrainSkillSummary[], name: string) {
  const beforeIds = new Set(before.map((skill) => skill.id));
  const created = after.filter((skill) => !beforeIds.has(skill.id));
  const byName = [...created, ...after].filter((skill) => skill.name === name);
  return byName.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? created.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? after[0];
}

function markdownForSkill(input: {
  prompt: string;
  name: string;
  description: string;
  capabilities: FusionCapabilityRecord[];
}) {
  const fused = input.capabilities.filter((capability) => capability.used);
  const all = input.capabilities;
  const discoveryRef = (capability: FusionCapabilityRecord) => {
    if (capability.kind === "connected-app" || capability.kind === "app-endpoint") return "connected-app discovery record";
    if (capability.kind === "skill") return "shared brain skill record";
    if (capability.kind === "tool-schema") return "runtime tool-schema record";
    if (capability.kind === "api-route") return "dashboard API route record";
    if (capability.kind === "runtime") return "runtime capability record";
    return "retrieval record";
  };
  return [
    "---",
    `name: ${JSON.stringify(input.name)}`,
    `description: ${JSON.stringify(input.description)}`,
    "---",
    "",
    `# ${input.name}`,
    "",
    input.description,
    "",
    "## Trigger",
    "",
    "Use this skill when a user asks for this kind of task:",
    "",
    `> ${input.prompt}`,
    "",
    "## Capability Search",
    "",
    "Before execution, search `/api/context-index` with the user's current task. Prefer fresh connected-app and endpoint records from `/api/fleet/apps`; do not hard-code Tailnet URLs.",
    "",
    "## Selected Capabilities",
    "",
    ...(fused.length ? fused.map((capability) => `- **${capability.label}** (${capability.meta}, ${capability.machineLabel}): ${capability.detail}`) : ["- No fused capabilities were selected. Run capability search again before execution."]),
    "",
    "## Available Candidates",
    "",
    ...(all.length ? all.map((capability) => `- ${capability.label} - ${capability.kind} - ${discoveryRef(capability)}`) : ["- No candidates were found."]),
    "",
    "## Workflow",
    "",
    "1. Re-run capability search for the current prompt and confirm the selected parts are still available.",
    "2. Load only the specific skill, tool, runtime, endpoint, or app context needed for the next step.",
    "3. Ask for clarification before side effects when multiple delivery, publishing, payment, or mutation targets are available.",
    "4. Execute through the selected app/tool/runtime using dashboard APIs where possible.",
    "5. Return proof: created files, saved skill path, endpoint receipt, message id, transaction id, or explicit failure reason.",
    "",
    "## Safety",
    "",
    "- Prefer read-only discovery before mutation.",
    "- Do not reveal secrets, tokens, private Tailnet IPs, or raw chat IDs.",
    "- For connected apps, use HivemindOS app discovery/proxy surfaces instead of hard-coded URLs.",
    "",
  ].join("\n");
}

export const fusionSkillTestHooks = {
  capabilityFromItem,
  fusedCapabilities,
  prioritizeCapabilities,
  relatedQueries,
};

export async function createFusionSkill(input: {
  prompt: string;
  vaultPath?: string;
  connectedApps?: ContextConnectedApp[];
}): Promise<FusionSkillResult> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Enter a task before creating a fusion skill.");
  const name = skillNameFromPrompt(prompt);
  const slug = skillSlugFromName(name);

  const before = await getSharedBrainSkills(input.vaultPath);
  const queries = [...new Set([...relatedQueries(prompt), ...requiredQueries(prompt)])];
  const results = await Promise.all(queries.map((query) =>
    searchContextIndex({
      query,
      vaultPath: input.vaultPath,
      connectedApps: input.connectedApps,
      kinds: CONTEXT_KINDS,
      limit: 24,
    }),
  ));
  const ranked = new Map<string, ContextIndexItem>();
  for (const result of results) {
    for (const item of result.items) {
      const existing = ranked.get(item.id);
      if (!existing || (item.score ?? 0) > (existing.score ?? 0)) ranked.set(item.id, item);
    }
  }

  const ownSkillPattern = new RegExp(`(^|[:/])${slug}$`);
  const rankedItems = [...ranked.values()]
    .filter((item) => !(item.kind === "skill" && (ownSkillPattern.test(item.id) || item.title === name)))
    .map((item) => ({ ...item, score: (item.score ?? 0) + boostForPrompt(prompt, item) }))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  const prioritizedItems = prioritizeCapabilities(rankedItems, prompt);
  const capabilities = fusedCapabilities(prioritizedItems.map((item, index) => capabilityFromItem(item, index, index < MAX_FUSED)), prompt);
  const description = skillDescription(prompt);
  const markdown = markdownForSkill({ prompt, name, description, capabilities });
  const afterInventory = await writeBrainSkill({
    vaultPath: input.vaultPath,
    markdown,
    slug,
    replaceExisting: true,
  });
  invalidateCachedCall(SHARED_BRAIN_CACHE_PREFIX);
  const created = selectedSkill(afterInventory.shared, before.shared, name);
  const machineCount = new Set(capabilities.map((capability) => capability.machine)).size;
  return {
    prompt,
    skill: {
      name: created?.name ?? name,
      slug: created?.slug ?? slug,
      description: created?.description ?? description,
      path: created?.path ?? "",
    },
    capabilities,
    discoveredCount: capabilities.length,
    fusedCount: capabilities.filter((capability) => capability.used).length,
    machineCount,
    markdown,
  };
}
