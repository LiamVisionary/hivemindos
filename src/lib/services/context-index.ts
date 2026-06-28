import { constants } from "fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { basename, dirname, extname, join, relative, sep } from "path";
import {
  BANKR_HIVEMIND_INTEGRATION_FACTS,
  BANKR_PLATFORM_FACTS,
  BANKR_REPO_REFERENCE_PATH,
  BANKR_VAULT_REFERENCE_PATH,
} from "@/lib/services/chat/bankr-capability-context";
import {
  CLAWBANK_HIVEMIND_INTEGRATION_FACTS,
  CLAWBANK_PLATFORM_FACTS,
  CLAWBANK_REPO_REFERENCE_PATH,
  CLAWBANK_VAULT_REFERENCE_PATH,
} from "@/lib/services/chat/clawbank-capability-context";
import { getBrainSkillInventory, getSharedBrainSkillsCached } from "@/lib/services/obsidian/brain-skills";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { externalAgentProviderItems } from "@/lib/services/external-agent-providers";
import { dashboardSwarmGoalContextIndexItem, jsonRenderContextIndexItem, loopEngineeringContextIndexItem } from "@/lib/services/context-index/static-tool-items";
import { hiveActionContextIndexItems, listHiveActions } from "@/lib/services/hive-actions";
import { HIVE_MCP_SERVER_CATALOG } from "@/lib/services/mcp/catalog";
import {
  USEPOD_COMPATIBILITY_MATRIX,
  USEPOD_FUNDING_MATRIX,
  USEPOD_PROVIDER_BOND_USDC,
  USEPOD_PROVIDER_EARN_SHARE,
  USEPOD_SUPPLY_MATRIX,
} from "@/lib/config/usepod-features";
import {
  VEIL_CASH_CHAIN_ID,
  VEIL_CASH_CONTRACTS,
  VEIL_CASH_SDK_PACKAGE,
  VEIL_CASH_TRANSFER_CONFIRMATION_LABEL,
} from "@/lib/config/veil-cash";
import { RUNTIME_DEFINITIONS } from "@/lib/types/agent-runtime";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import { applyAppPreferences, readAppPreferences, type AppModelPreference } from "@/lib/services/fleet/app-preferences";

export type ContextIndexKind =
  | "skill"
  | "tool-schema"
  | "api-route"
  | "connected-app"
  | "app-endpoint"
  | "runtime"
  | "doc"
  | "workspace-file";

export type ContextIndexLoadHint = {
  type: "file" | "api" | "none";
  target?: string;
  note?: string;
};

export type ContextIndexItem = {
  id: string;
  kind: ContextIndexKind;
  title: string;
  summary: string;
  tags: string[];
  aliases?: string[];
  retrievalText?: string;
  path?: string;
  route?: string;
  methods?: string[];
  load: ContextIndexLoadHint;
  updatedAt?: number;
  sizeBytes?: number;
  score?: number;
  /** Rank bonus applied on top of text relevance, e.g. user-pinned priority apps. */
  priorityBoost?: number;
};

export type ContextIndex = {
  generatedAt: string;
  root: string;
  vaultPath?: string;
  items: ContextIndexItem[];
  totals: Record<ContextIndexKind, number>;
};

export type ContextIndexOptions = {
  vaultPath?: string;
  includeRuntimeProviders?: boolean;
  connectedApps?: ContextConnectedApp[];
  kinds?: ContextIndexKind[];
};

export type ContextIndexSearchOptions = ContextIndexOptions & {
  query?: string;
  limit?: number;
};

export type ContextConnectedAppRoute = {
  method?: string;
  path?: string;
  url?: string;
  category?: string;
  summary?: string;
  source?: string;
};

export type ContextConnectedApp = {
  id?: string;
  name?: string;
  description?: string;
  kind?: string;
  machineName?: string;
  machineHost?: string;
  local?: boolean;
  online?: boolean;
  interactive?: boolean;
  serviceKind?: string;
  openUrl?: string;
  apiBaseUrl?: string;
  healthUrl?: string;
  apiRoutes?: ContextConnectedAppRoute[];
  apiRoutesSource?: string;
  priority?: boolean;
  usageNotes?: string;
  preferredModels?: AppModelPreference[];
};

const FS_REFRESH_CHECK_INTERVAL_MS = 15_000;
const MAX_DOC_BYTES = 256 * 1024;
const SKIPPED_DIRS = new Set([".git", ".next", ".next-tauri", ".next-tauri-build", "node_modules", "out", "dist", "build"]);
const WORKSPACE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".sh", ".ps1", ".go", ".rs"]);
const DOC_ROOTS = ["docs"];
const WORKSPACE_ROOTS = ["src/lib", "src/features/dashboard", "src/components", "scripts", "workers", "cmd", "src-tauri/src"];
const TOP_LEVEL_FILES = ["AGENTS.md", "README.md", "ROADMAP.md", "CHANGELOG.md", "package.json", "setup.sh", "setup.ps1", "uninstall.sh", "uninstall.ps1"];
const TOOL_SCHEMA_FILES = ["src/lib/search-tool.ts", "src/app/api/orchestrator/route.ts", "src/app/api/scheduler/skill-action/route.ts"];
const PACKAGED_AUTO_INSTALL_SKILLS_ROOT = "packaged-skills/auto-install";
const CONNECTED_APPS_NOTE = "Connected Apps Context Index.md";

function workspaceRoot() {
  return process.cwd();
}

function toPosix(path: string) {
  return path.split(sep).join("/");
}

function absolutePath(path: string) {
  return join(workspaceRoot(), path);
}

async function canRead(path: string) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function safeStat(path: string) {
  return stat(path).catch(() => null);
}

type FileStatEntry = { path: string; mtimeMs: number; size: number };

async function statPaths(paths: string[]): Promise<FileStatEntry[]> {
  const stats = await Promise.all(paths.map(async (path) => {
    const st = await safeStat(path);
    return st?.isFile() ? { path, mtimeMs: st.mtimeMs, size: st.size } : null;
  }));
  return stats.filter((entry): entry is FileStatEntry => entry !== null);
}

function fileSignature(files: FileStatEntry[]) {
  return files
    .map((file) => `${file.path}\u001f${Math.round(file.mtimeMs)}\u001f${file.size}`)
    .sort()
    .join("\u001e");
}

async function walkFiles(root: string, output: string[] = [], maxFiles = 800): Promise<string[]> {
  if (output.length >= maxFiles || !(await canRead(root))) return output;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (output.length >= maxFiles || SKIPPED_DIRS.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(path, output, maxFiles);
      continue;
    }
    if (entry.isFile() && WORKSPACE_EXTENSIONS.has(extname(entry.name))) output.push(path);
  }
  return output;
}

function firstUsefulParagraph(markdown: string) {
  return markdown
    .replace(/^---\n[\s\S]*?\n---/, "")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim())
    .find((part) => part && !part.startsWith("![")) ?? "";
}

function parseSimpleFrontmatter(markdown: string) {
  const fields = new Map<string, string>();
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return fields;
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (field) fields.set(field[1].toLowerCase(), field[2].replace(/^["']|["']$/g, "").trim());
  }
  return fields;
}

function titleFromMarkdown(path: string, markdown: string) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(path).replace(/\.[^.]+$/, "");
}

function routeFromFile(path: string) {
  const relativePath = toPosix(relative(join(workspaceRoot(), "src/app"), path));
  return `/${relativePath}`
    .replace(/\/route\.ts$/, "")
    .replace(/\[([^\]]+)\]/g, ":$1");
}

function methodNames(source: string) {
  return [...source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1]);
}

function extractToolNames(source: string) {
  const listMatch = source.match(/TOOL_NAMES\s*=\s*\[([\s\S]*?)\]/);
  if (!listMatch) return [];
  return [...listMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function tagParts(...values: Array<string | undefined>) {
  return [...new Set(values
    .filter(Boolean)
    .flatMap((value) => value!.split(/[^A-Za-z0-9_-]+/))
    .map((value) => value.toLowerCase())
    .filter((value) => value.length > 2))].slice(0, 12);
}

function uniqueList(values: Array<string | undefined>) {
  return [...new Set(values
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value)))];
}

function pathWords(path?: string) {
  return (path ?? "")
    .replace(/\{[^}]+\}/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .map((value) => value.toLowerCase())
    .filter((value) => value.length > 2);
}

function categoryAliases(category?: string) {
  const value = category?.toLowerCase() ?? "";
  if (value.includes("template")) return ["templates", "template capabilities", "presets", "scenario templates"];
  if (value.includes("simulation")) return ["simulation", "scenario", "swarm", "run history"];
  if (value.includes("graph")) return ["graph", "ontology", "knowledge graph", "network data"];
  if (value.includes("export")) return ["exports", "download", "artifacts"];
  if (value.includes("observability")) return ["observability", "monitoring", "events", "usage stats"];
  if (value.includes("config")) return ["settings", "configuration", "mcp status"];
  if (value.includes("core")) return ["health", "docs", "openapi", "api reference"];
  return [];
}

function baseConnectedAppAliases(app: ContextConnectedApp) {
  const appHaystack = `${app.name ?? ""} ${app.description ?? ""} ${app.kind ?? ""} ${app.serviceKind ?? ""}`.toLowerCase();
  return uniqueList([
    "connected app",
    "tailnet app",
    "remote app",
    app.kind,
    app.serviceKind,
    app.interactive ? "interactive app" : "api service",
    app.apiRoutes?.length ? "api endpoint catalog" : undefined,
    ...(app.kind === "creative" ? [
      "image",
      "image gen",
      "image generation",
      "text to image",
      "visual generation",
      "creative workflow",
      "diffusion",
      "render",
    ] : []),
    ...(app.kind === "ai" ? ["ai", "chat", "assistant", "llm"] : []),
    ...(app.kind === "media" ? ["media", "video", "render", "generation"] : []),
    ...(app.kind === "service" ? ["api", "endpoint", "service", "automation"] : []),
    ...(appHaystack.includes("workflow") ? ["workflow", "workflow automation"] : []),
    ...(appHaystack.includes("generate") || appHaystack.includes("generation") ? ["generation", "generate"] : []),
    ...(appHaystack.includes("image") ? ["image", "image generation"] : []),
    ...(appHaystack.includes("video") ? ["video", "video generation"] : []),
  ]);
}

function connectedAppAliases(app: ContextConnectedApp) {
  const routeText = (app.apiRoutes ?? [])
    .flatMap((route) => [route.path, route.category, route.summary, route.source])
    .join(" ");
  const routeHaystack = routeText.toLowerCase();
  const aliases = uniqueList([
    ...baseConnectedAppAliases(app),
    ...(routeHaystack.includes("openapi") || routeHaystack.includes("swagger") ? ["openapi", "swagger", "api docs"] : []),
    ...[...new Set((app.apiRoutes ?? []).flatMap((route) => categoryAliases(route.category)))],
  ]);
  return aliases;
}

function endpointAliases(app: ContextConnectedApp, route: ContextConnectedAppRoute) {
  return uniqueList([
    ...baseConnectedAppAliases(app),
    route.method,
    route.category,
    route.source,
    ...(route.summary?.toLowerCase().includes("generate") ? ["generate", "generation"] : []),
    ...(route.summary?.toLowerCase().includes("image") || route.path?.toLowerCase().includes("image") ? ["image", "image generation"] : []),
    ...(route.summary?.toLowerCase().includes("workflow") || route.path?.toLowerCase().includes("workflow") ? ["workflow"] : []),
    ...categoryAliases(route.category),
    ...pathWords(route.path),
  ]).slice(0, 32);
}

function retrievalText(parts: Array<string | undefined | string[]>) {
  return parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function compactCapabilityTags(capabilities: Record<string, unknown>) {
  return Object.entries(capabilities)
    .flatMap(([key, value]) => {
      if (value === true) return [key];
      if (Array.isArray(value)) return value.map(String);
      return [];
    })
    .map((value) => value.toLowerCase())
    .sort();
}

async function skillItems(options: ContextIndexOptions): Promise<ContextIndexItem[]> {
  const sharedInventory = await getSharedBrainSkillsCached(options.vaultPath, { summaryMode: "fast" });
  const shared = sharedInventory.shared.map((skill): ContextIndexItem => ({
    id: `skill:shared:${skill.slug}`,
    kind: "skill",
    title: skill.name,
    summary: skill.description || `Shared skill ${skill.slug}.`,
    tags: tagParts(skill.slug, skill.providerLabel, "shared", "skill"),
    path: skill.path,
    load: {
      type: "file",
      target: skill.path,
      note: "Read Skills/README.md first, then load this SKILL.md only when it matches the task.",
    },
    updatedAt: skill.updatedAt,
  }));

  if (!options.includeRuntimeProviders) return shared;

  const providerInventory = await getBrainSkillInventory(options.vaultPath, undefined, { summaryMode: "fast" });
  const providerSkills = providerInventory.providers.flatMap((provider) => provider.skills.map((skill): ContextIndexItem => ({
    id: `skill:${provider.id}:${skill.slug}:${skill.path}`,
    kind: "skill",
    title: skill.name,
    summary: skill.description || `${provider.label} runtime skill ${skill.slug}.`,
    tags: tagParts(skill.slug, provider.label, "runtime", "skill"),
    path: skill.path,
    load: {
      type: "file",
      target: skill.path,
      note: "Provider skill metadata is indexed; import to the shared brain before durable cross-agent reuse.",
    },
    updatedAt: skill.updatedAt,
  })));

  return [...shared, ...providerSkills];
}

async function packagedSkillFileStats(): Promise<FileStatEntry[]> {
  const root = absolutePath(PACKAGED_AUTO_INSTALL_SKILLS_ROOT);
  if (!(await canRead(root))) return [];
  const files = (await walkFiles(root, [], 200)).filter((file) => basename(file) === "SKILL.md");
  return statPaths(files);
}

async function packagedSkillItem(file: FileStatEntry): Promise<ContextIndexItem> {
  const markdown = await readFile(file.path, "utf8").catch(() => "");
  const frontmatter = parseSimpleFrontmatter(markdown);
  const relativePath = toPosix(relative(workspaceRoot(), file.path));
  const slug = basename(dirname(file.path));
  const description = frontmatter.get("description") || firstUsefulParagraph(markdown) || `Packaged skill ${slug}.`;
  return {
    id: `skill:packaged:auto-install:${slug}`,
    kind: "skill",
    title: frontmatter.get("name") || slug,
    summary: description,
    tags: tagParts(slug, "packaged", "auto-install", "installable", "one-click", "skill"),
    path: file.path,
    retrievalText: retrievalText([description, relativePath, "packaged skill auto-install catalog"]),
    load: {
      type: "file",
      target: file.path,
      note: "Packaged auto-install skill metadata is indexed for setup discovery. Optional packaged skills are excluded until the user installs them into the shared brain.",
    },
    updatedAt: file.mtimeMs,
    sizeBytes: file.size,
  };
}

async function apiRouteFileStats(): Promise<FileStatEntry[]> {
  const files = await walkFiles(join(workspaceRoot(), "src/app/api"), [], 500);
  return statPaths(files.filter((file) => file.endsWith(`${sep}route.ts`)));
}

async function apiRouteItem(file: FileStatEntry): Promise<ContextIndexItem> {
  const source = await readFile(file.path, "utf8").catch(() => "");
  const methods = methodNames(source);
  const route = routeFromFile(file.path);
  return {
    id: `api:${route}`,
    kind: "api-route" as const,
    title: route,
    summary: `${methods.join(", ") || "HTTP"} endpoint for ${route}.`,
    tags: tagParts(route, ...methods),
    path: file.path,
    route,
    methods,
    load: { type: "file" as const, target: file.path, note: "Read the route file for request and response shape before calling." },
    updatedAt: file.mtimeMs,
    sizeBytes: file.size,
  };
}

function toolSchemaFileStats(): Promise<FileStatEntry[]> {
  return statPaths(TOOL_SCHEMA_FILES.map(absolutePath));
}

async function toolSchemaItem(file: FileStatEntry): Promise<ContextIndexItem> {
  const relativePath = toPosix(relative(workspaceRoot(), file.path));
  const source = await readFile(file.path, "utf8").catch(() => "");
  const tools = extractToolNames(source);
  const title = relativePath.endsWith("search-tool.ts")
    ? "web_search"
    : relativePath.includes("orchestrator")
      ? "orchestrator tools"
      : basename(dirname(file.path));
  return {
    id: `tool-schema:${relativePath}`,
    kind: "tool-schema",
    title,
    summary: tools.length
      ? `Tool surface: ${tools.join(", ")}.`
      : "Tool schema or action runtime definitions. Read before exposing tool calls.",
    tags: tagParts(title, relativePath, ...tools),
    path: file.path,
    load: { type: "file", target: file.path, note: "Load only when this tool surface is needed for the task." },
    updatedAt: file.mtimeMs,
    sizeBytes: file.size,
  };
}

function localCliToolItems(): ContextIndexItem[] {
  return [
    {
      id: "tool-schema:local-cli:xurl",
      kind: "tool-schema",
      title: "xurl CLI",
      summary: "Authenticated X/Twitter CLI for search, reads, posting, replies, DMs, media upload, and raw X API requests.",
      tags: ["xurl", "x", "twitter", "search", "post", "social", "cli", "terminal", "tool"],
      aliases: ["x search", "twitter search", "x post", "tweet", "social posting", "xurl search", "xurl post"],
      retrievalText: [
        "Use the terminal tool to run xurl when X/Twitter research or posting is needed.",
        "Examples: xurl search \"Base chain\" -n 20; xurl post \"text\"; xurl read <post_id>.",
        "Prefer xurl when Grok/x_search is not configured or account credits are exhausted.",
      ].join(" "),
      load: {
        type: "none",
        note: "Local CLI capability. Use the agent terminal tool; do not hard-code credentials.",
      },
    },
    {
      id: "tool-schema:hivemind-handoff",
      kind: "tool-schema",
      title: "HivemindOS handoff tools",
      summary: "Fleet-aware file and task handoff through the Obsidian Hivemind Sync transfer folder, fuzzy machine matching, and best-agent selection.",
      tags: ["handoff", "file", "task", "fleet", "syncthing", "obsidian", "transfer", "machine", "agent", "mcp", "cli", "tool"],
      aliases: [
        "handoff file",
        "handoff task",
        "send file to ubuntu",
        "send task to ubuntu",
        "transfer file to machine",
        "delegate task to remote agent",
        "hive handoff",
        "hivemind mcp",
      ],
      retrievalText: [
        "Use this capability when the user asks to hand off a file, artifact, or task to another HivemindOS machine such as Ubuntu, Linux, Mac, or a fuzzy device name.",
        "Preferred CLI: hive-handoff send --to <machine> <file...> for a plain file handoff; hive-handoff send --to <machine> --task \"<task>\" <file...> for a file plus task; hive-handoff task --to <machine> \"<task>\" for task-only delegation.",
        "Dashboard/API path: POST /api/handoff with action send-file, send-file-task, send-task, or plan. The route discovers /api/fleet/discover, fuzzy-matches the machine, selects the best agent using the bee-role worker-class logic, writes hive-transfer manifests, and starts the remote task through the target collector chat bridge when available.",
        "MCP path: run hivemind-mcp as a stdio MCP server. It exposes list_hivemind_machines, plan_handoff, handoff_file, handoff_file_task, and handoff_task tools.",
        "If the user asks for a file handoff but does not say what to do with the file, plain file handoff is allowed. If they ask for a task handoff or file-and-task handoff but omit the task, ask what the receiving agent should do before calling the task tool.",
        "Do not put secrets in handoff payloads; transfers live in the synced Obsidian vault and may be replicated to trusted paired devices.",
      ].join(" "),
      load: {
        type: "api",
        target: "/api/handoff",
        note: "Use plan/dry-run first when the machine match is ambiguous. Use the CLI or MCP tool from raw runtimes.",
      },
    },
    dashboardSwarmGoalContextIndexItem(absolutePath),
    jsonRenderContextIndexItem(absolutePath),
    loopEngineeringContextIndexItem(absolutePath),
    {
      id: "tool-schema:hive-brain-compiled-wiki",
      kind: "tool-schema",
      title: "HivemindOS compiled brain",
      summary: "Compile durable source material into Obsidian entity/concept/summary wiki pages, search the compiled wiki, query the compiled graph, and repair compiled-wiki health.",
      tags: ["brain", "compiled-wiki", "knowledge", "obsidian", "wikilink", "graph", "search", "mcp", "health", "entity", "concept", "summary", "shared-brain"],
      aliases: [
        "compile to brain",
        "save to compiled wiki",
        "knowledge compiler",
        "graph-native brain",
        "compiled brain search",
        "search compiled knowledge",
        "wiki health",
        "brain backlinks",
        "shared brain contract",
        "curator-style brain",
      ],
      retrievalText: [
        "Use /api/brain/knowledge when the user wants durable research findings, source material, or conversation conclusions compiled into HivemindOS' Obsidian brain as entities, concepts, and summaries.",
        "POST /api/brain/knowledge with action compile accepts title, content, optional summary, tags, entities, concepts, domain, actorKind, collaborationMode, and optedInDomain. Generated files live under Synthesis/Compiled Knowledge/<domain>/ with raw input, wiki/entities, wiki/concepts, wiki/summaries, index.md, and log.md.",
        "The same route supports status, graph-overview, graph, search, get-node, get-backlinks, scan-health, fix-health, dismiss-health, and shared-contract actions. GET /api/brain/knowledge?action=search&q=<query> searches compiled wiki pages; POST action search accepts query, limit, and optional types.",
        "MCP path: run hivemind-mcp as a stdio MCP server. It exposes compile_brain_knowledge, brain_search_knowledge, brain_graph_overview, brain_get_node, brain_get_backlinks, scan_brain_wiki_health, fix_brain_wiki_issue, and shared_brain_contract.",
        "Use brain_search_knowledge before broad full-vault recall when the user is looking for synthesized compiled-wiki entities, concepts, or summaries. Use hive-brain answer first for typed preferences, decisions, instructions, commitments, or general project memory.",
        "Human collective shared-brain mode follows the Curator-style contract: write to the contributor's personal opted-in domain, then push/synthesize/pull the shared mirror. This does not restrict ordinary agent-to-agent HivemindOS collaboration; use collaborationMode agent-to-agent for internal agent work.",
      ].join(" "),
      route: "/api/brain/knowledge",
      methods: ["GET", "POST"],
      load: {
        type: "api",
        target: "/api/brain/knowledge",
        note: "Use for durable compiled wiki writes, compiled-wiki search, and graph-native reads. Use /api/brain/memory first for typed preferences, decisions, instructions, and facts.",
      },
    },
    {
      id: "tool-schema:local-cli:hermes-send",
      kind: "tool-schema",
      title: "hermes send CLI",
      summary: "Hermes terminal delivery command for configured messaging platforms such as Telegram, Discord, Slack, Signal, SMS, and WhatsApp.",
      tags: ["hermes", "send", "telegram", "discord", "slack", "message", "delivery", "notification", "cli", "terminal", "tool"],
      aliases: ["telegram send", "send message", "message delivery", "notify user", "hermes send", "delivery channel"],
      retrievalText: [
        "Use the terminal tool to run hermes send for user messaging.",
        "List targets first when a channel/person is not obvious: hermes send --list telegram --json.",
        "If no platform home channel is confirmed, do not send to bare telegram/discord/slack. Send with an explicit listed target such as hermes send --to telegram:<id> \"message\".",
        "After sending, inspect the JSON result and report success plus the returned message_id when present.",
        "Do not reveal numeric chat IDs in final responses.",
      ].join(" "),
      load: {
        type: "none",
        note: "Local CLI capability. Use the agent terminal tool and list targets before sending when needed.",
      },
    },
    {
      id: "tool-schema:bankr-agent-platform",
      kind: "tool-schema",
      title: "Bankr agent platform",
      summary: "Bankr financial rails and agent runtime: cross-chain wallet, token launching with fee share, trading (swaps, limit/stop/DCA/TWAP, leveraged, Polymarket, NFTs), LLM Gateway credits, automations, x402, skills, and the Bankr skill/CLI/Agent API surfaces.",
      tags: ["bankr", "crypto", "wallet", "trading", "swap", "token-launch", "llm-gateway", "llm-credits", "max-mode", "automation", "polymarket", "hyperliquid", "x402", "dca", "limit-order", "nft", "capability", "agent", "tool"],
      aliases: [
        "what can you do with bankr",
        "bankr capabilities",
        "bankr agent",
        "bankr trading",
        "launch a token",
        "token launch fees",
        "bankr llm credits",
        "max mode",
        "bankr cli",
        "bankr skill",
        "bankr agent api",
        "self-funding agent",
      ],
      retrievalText: [
        ...BANKR_PLATFORM_FACTS,
        ...BANKR_HIVEMIND_INTEGRATION_FACTS,
        `Full imported Bankr documentation lives at ${BANKR_VAULT_REFERENCE_PATH} in the shared vault and ${BANKR_REPO_REFERENCE_PATH} in the hivemind-os repo; search those for chain matrices, API references, apps, browser automation, memory, and file-storage details.`,
      ].join(" "),
      load: {
        type: "file",
        target: BANKR_VAULT_REFERENCE_PATH,
        note: "Vault-relative imported Bankr docs. For live readiness use /api/crypto/capabilities; execution uses native Bankr chat actions, /api/bankr/actions, /api/bankr/llm-credits, and explicit approval gates.",
      },
    },
    {
      id: "tool-schema:clawbank-agent-platform",
      kind: "tool-schema",
      title: "ClawBank agent financial + legal OS",
      summary: "ClawBank financial + legal OS for AI agents: self-custody wallet (Base/XRPL), KYC bank rails (Bridge), off-ramp, autonomous trading, real US LLC formation, contracts, comms, fight clubs, and Wise — over REST (/api/clawbank/*) and a discovery-first MCP tool catalog.",
      tags: ["clawbank", "bank", "wallet", "llc", "formation", "off-ramp", "kyc", "bridge", "trading", "swap", "contracts", "coms", "self-custody", "usdc", "capability", "agent", "tool"],
      aliases: [
        "what can you do with clawbank",
        "clawbank capabilities",
        "clawbank wallet",
        "clawbank bank account",
        "form an llc",
        "create a company",
        "clawbank off-ramp",
        "clawbank trading",
        "clawbank contracts",
        "clawbank formation",
        "agent legal entity",
      ],
      retrievalText: [
        ...CLAWBANK_PLATFORM_FACTS,
        ...CLAWBANK_HIVEMIND_INTEGRATION_FACTS,
        `Full imported ClawBank documentation lives at ${CLAWBANK_VAULT_REFERENCE_PATH} in the shared vault and ${CLAWBANK_REPO_REFERENCE_PATH} in the hivemind-os repo; search those for endpoint references, the MCP discovery flow, and capability details.`,
      ].join(" "),
      route: "/api/clawbank",
      methods: ["GET"],
      load: {
        type: "file",
        target: CLAWBANK_VAULT_REFERENCE_PATH,
        note: "Vault-relative imported ClawBank docs. For live readiness use GET /api/clawbank; discover the per-account tool surface with GET /api/clawbank/run; money/entity actions need confirmation tokens.",
      },
    },
    {
      id: "tool-schema:crypto-capability-router",
      kind: "tool-schema",
      title: "crypto capability router",
      summary: "Unified agent-facing crypto router for Bankr, local Hyperliquid, x402, Veil Cash, MoneyClaw, and UsePod readiness, route selection, clear-signing reviews, crosschain intent drafts, identity records, and risk checks.",
      tags: ["crypto", "wallet", "payment", "capability", "router", "bankr", "hyperliquid", "perps", "builder-code", "x402", "veil", "moneyclaw", "usepod", "paid-api", "private-payment", "trade", "crosschain", "bridge", "clear-signing", "agent-identity", "risk", "agent", "tool"],
      aliases: [
        "crypto router",
        "unified crypto mcp",
        "crypto capability search",
        "wallet rail router",
        "which crypto tool",
        "pay with any available rail",
        "private payment",
        "private x402",
        "paid api router",
        "clear signing",
        "crypto risk monitor",
        "agent identity",
        "ENS8004",
        "ERC8004",
        "crosschain intent",
        "bridge crypto",
        "bankr x402 veil moneyclaw",
      ],
      retrievalText: [
        "Use /api/crypto/capabilities as the first stop when a workflow needs crypto, wallet, payments, paid APIs, x402, private transfers, Bankr trading, crosschain swaps, bridge/payment intents, Bankr token launches, Polymarket, Hyperliquid, NFT actions, recurring Bankr automations, MoneyClaw, Veil Cash, or UsePod prepaid rails.",
        "This is the unified capability layer for agent decisions: it reports provider readiness by key name only, selects the best configured rail for an intent, and prepares the existing provider endpoint request body without executing money movement itself.",
        "GET /api/crypto/capabilities?intent=<status|portfolio|receive|send|private-transfer|paid-api|private-paid-api|trade|crosschain-swap|bridge|crosschain-payment|token-launch|polymarket|hyperliquid|automation|nft|agent-job|card-payment|fund-llm-credits>&agentId=<id> returns the capability map. POST { action: 'select', intent, agentId, wallet, preferredProvider? } selects a rail. POST { action: 'prepare', intent, agentId, wallet, url?, recipientAddress?, amountUsd?, asset?, fromChain?, toChain?, fromAsset?, toAsset? } returns the endpoint, draft body, missing readiness, approval requirement, confirmation token, clear-signing review, and crosschain plan when relevant.",
        "MCP path: run hivemind-mcp as a stdio MCP server. It exposes crypto_capabilities for readiness, select_crypto_rail for no-side-effect provider selection, prepare_crypto_action for provider endpoint/request-body drafts, review_crypto_action for clear-signing, agent_crypto_identity for local identity/listing records, and crypto_risk_monitor for DARC-style control checks.",
        "The router covers Bankr for wallet portfolio, swaps/trades, crosschain swaps/bridges/payments, token launches, Polymarket, Hyperliquid fallback, recurring automations, NFT actions, Agent API jobs, and LLM credit funding; local Hyperliquid for governed EVM-wallet perp quotes/orders with server-configured builder codes; x402 for public paid API fetches and local-wallet USDC sends; Veil for private transfers and private x402; MoneyClaw for card/web payment readiness; and UsePod for prepaid provider-managed paid inference/paywalls.",
        "Official trading platform fee policy is fetched from the hosted HivemindOS policy endpoint by default; local HIVEMINDOS_TRADING_PLATFORM_FEES_ENABLED or HIVEMINDOS_PLATFORM_FEE_RECIPIENT_* variables switch an install to self-hosted override policy, while fee-rate defaults alone keep using hosted policy. Locally signed USDC-capable rails such as /api/wallet/send, /api/trading/swap, xStocks, live Alpaca fee collection, /api/wallet/x402, /api/wallet/veil/transfer, and /api/wallet/veil/x402 can quote and collect the policy fee as a separate USDC transfer. Official Hyperliquid builder-code recipient, fee, max approval fee, network, and optional API URL are fetched from the HivemindOS-controlled builder-policy endpoint; client request bodies and shared env never choose the official builder recipient or fee. Bankr and MoneyClaw revenue needs hosted/proxy or provider-native fee enforcement.",
        "Execution remains with hardened routes and gates: /api/bankr/actions, /api/bankr/llm-credits, /api/trading/hyperliquid, /api/wallet/x402, /api/wallet/veil/x402, /api/wallet/veil/transfer, /api/wallet/send, /api/wallet/moneyclaw, /api/usepod/status, /api/usepod/deposit-transaction, /api/crypto/clear-signing, /api/crypto/agent-identity, and /api/crypto/risk-monitor.",
        "Side-effect policy: call status/select/prepare first; do not execute sends, swaps, trades, token launches, bets, leverage positions, NFT mutations, automations, paid API calls, card payments, private transfers, or LLM credit funding unless wallet Spend and caps allow it, the wallet's explicit auto-send/auto-use policy allows that action, or the user has explicitly confirmed the prepared draft. Never ask for, print, store, or summarize private keys, seed phrases, API keys, card details, or wallet secrets.",
      ].join(" "),
      route: "/api/crypto/capabilities",
      methods: ["GET", "POST"],
      load: {
        type: "api",
        target: "/api/crypto/capabilities",
        note: "Use this router before provider-specific wallet routes. It selects and prepares only; execution stays behind existing spend gates.",
      },
    },
    {
      id: "tool-schema:managed-agent-billing",
      kind: "tool-schema",
      title: "managed agent Honey billing",
      summary: "No-BYOK managed-agent billing through spend-only managed HONEY credits, Stripe Checkout funding, signed Honey ledger credit/debit events, and server-side provider markup.",
      tags: ["managed agent", "billing", "honey", "credits", "stripe", "x402", "bankr", "markup", "no api keys", "funding", "spend"],
      aliases: [
        "managed agent credits",
        "honey credits",
        "no api keys",
        "stripe top up",
        "pay with hive",
        "pay with x402",
        "managed compute billing",
        "api key markup",
      ],
      retrievalText: [
        "Use /api/managed-agent/billing when the user wants one-step managed agent usage without bringing their own provider API keys.",
        "GET /api/managed-agent/billing?agentId=<id> returns the Honey ledger, managed Honey balance for the agent, configured funding rails, and provider mode choices.",
        "POST { action: 'quote', intent: 'chat'|'coding'|'research'|'paid-api'|'tool', provider?: 'auto'|'bankr'|'openai'|'x402'|'moneyclaw'|'agent-wallet'|'hive', estimatedTokens?, estimatedCalls? } returns a server-side quote in spend-only managed HONEY credits with markup.",
        "POST { action: 'create-stripe-checkout', agentId, amountUsd, rail?: 'stripe'|'stripe-crypto' } creates a Stripe Checkout top-up session when STRIPE_SECRET_KEY is configured. The Stripe webhook credits managed HONEY only after a verified checkout.session.completed event.",
        "Managed HONEY credits are separate from reward Honey: reward Honey can be claimed to HIVE, but managed HONEY is spend-only service credit for managed agents and cannot be cashed out.",
        "Official spoof resistance lives in the HivemindOS-hosted Honey ledger service: /managed-billing/events requires HONEY_BILLING_SECRET/HONEY_LEDGER_SECRET HMAC or the admin token, is idempotent, and refuses debit events when the managed balance is insufficient.",
        "The compute gateway's shared-key mode uses managed HONEY: if ALLOW_SHARED_BANKR_KEY=true and the caller does not provide a Bankr key, it checks managed Honey budget, calls the provider server-side, then submits a signed debit based on verified token usage.",
        "Never let clients directly claim funded credits. Stripe, x402, Bankr, agent-wallet, and $HIVE funding rails must credit managed HONEY only after a provider-side settlement/webhook/proof is verified by HivemindOS.",
      ].join(" "),
      route: "/api/managed-agent/billing",
      methods: ["GET", "POST"],
      load: {
        type: "api",
        target: "/api/managed-agent/billing",
        note: "Use for no-BYOK managed agent quoting and funding. Side-effectful credit/debit paths require webhook, admin, signer, or internal billing auth.",
      },
    },
    {
      id: "tool-schema:paid-agent-x402-gateway",
      kind: "tool-schema",
      title: "paid agent x402 gateway",
      summary: "OpenAI-compatible per-call paid agent endpoint that verifies x402 payment before calling a curated HivemindOS runtime profile.",
      tags: ["paid agent", "x402", "builder code", "chat completions", "openai compatible", "agent monetization", "honey", "hive", "bankr", "usepod", "venice", "openrouter", "runtime"],
      aliases: [
        "charge per agent call",
        "sell an agent",
        "paid chat completions",
        "x402 agent endpoint",
        "agent api monetization",
        "HONEY paid agent",
        "HIVE paid agent",
      ],
      retrievalText: [
        "Use /api/official-paid-agents/<slug>/chat/completions from downloaded apps when calling official HivemindOS monetized agents. This is a buyer/proxy path to HivemindOS-hosted infrastructure and must not package official payTo, facilitator credentials, provider keys, HONEY/HIVE entitlement logic, or quota authority.",
        "Use /api/paid-agents/<slug>/chat/completions only when exposing a self-hosted curated HivemindOS agent as an OpenAI-compatible seller endpoint that charges the caller's crypto wallet per request through x402.",
        "For the official hosted path, use the HivemindOS-controlled paid-agent gateway service. The gateway verifies and settles x402, records receipt metadata and idempotency keys, then forwards paid OpenAI-compatible chat bodies to its trusted upstream runtime.",
        "Production configuration is fail-closed: set HIVEMINDOS_PAID_AGENT_GATEWAY_ENABLED=true plus HIVEMINDOS_PAID_AGENT_SELLER_MODE=self-hosted, HIVEMINDOS_PAID_AGENT_PAY_TO, CDP_API_KEY_ID, and CDP_API_KEY_SECRET, then define either one default agent with HIVEMINDOS_PAID_AGENT_PROFILE_JSON/HIVEMINDOS_PAID_AGENT_PROFILE_PATH or a catalog with HIVEMINDOS_PAID_AGENT_CATALOG_JSON/HIVEMINDOS_PAID_AGENT_CATALOG_PATH. The default paid-agent seller path is Base mainnet with the CDP facilitator; set HIVEMINDOS_PAID_AGENT_TESTNET_MODE=true only for Base Sepolia development with x402.org.",
        "Optional Base Builder Code attribution is configured with HIVEMINDOS_X402_CLIENT_BUILDER_CODE for compatible local wallet x402 calls and HIVEMINDOS_PAID_AGENT_BUILDER_CODE or per-catalog builderCode for paid-agent seller routes on eip155:8453. Builder Codes are public identifiers, not secrets, and must never replace server-side payTo, amount, network, resource, or entitlement checks.",
        "Do not package an official payTo address into the downloadable app as authoritative. A downloaded app is user-controlled; official monetized agents should use a HivemindOS-hosted resource server or server-side receipt verification against the expected payTo, network, amount, and resource. Local self-hosted seller mode is only for operators selling their own endpoint.",
        "Recommended public runtimes are hivemind-os for local/OpenAI-compatible, Bankr, Venice, UsePod, OpenRouter, and Hive Fusion model routes; Hermes and OpenClaw can be exposed only through curated profiles; Codex, Claude Code, OpenCode, OpenHands, Aider, Aeon, and Evo should stay as managed HONEY jobs with explicit workspace/task scope by default.",
        "The route verifies x402 before invoking /api/chat/agent-runtime, settles after a successful answer, returns a PAYMENT-RESPONSE header, writes a local paid-agent receipt, and can mirror each settled call into managed HONEY credit/debit accounting when HIVEMINDOS_PAID_AGENT_MIRROR_MANAGED_HONEY=true.",
        "Shared vault access and wallet tools are not included by default. Add sharedVault or wallet only inside the curated paid-agent config when that public product intentionally needs them. Never place secrets, provider keys, private wallet material, or local workspace paths in the public config or response.",
        "HONEY/HIVE positioning: x402 is the external per-call charge, managed HONEY is the internal no-BYOK credit/debit ledger, and HIVE can fund Bankr LLM credits or managed HONEY through the managed-agent billing rail.",
      ].join(" "),
      route: "/api/paid-agents/<slug>/chat/completions",
      methods: ["GET", "POST"],
      load: {
        type: "api",
        target: "/api/paid-agents/<slug>/chat/completions",
        note: "Self-hosted seller route. GET reports non-secret readiness and supported runtime/provider matrices. POST accepts OpenAI-style chat completion bodies and requires x402 unless the non-production dev bypass is explicitly enabled. Downloaded apps should use /api/official-paid-agents/<slug>/chat/completions for official HivemindOS hosted agents.",
      },
    },
    {
      id: "tool-schema:wallet-actions",
      kind: "tool-schema",
      title: "agent wallet tools",
      summary: "Provider-specific dashboard wallet routes for read-only balance checks, x402 paid fetches, UsePod prepaid status, Veil Cash privacy setup, and auto-use-gated USDC sends.",
      tags: ["wallet", "payment", "crypto", "usdc", "x402", "usepod", "moneyclaw", "bankr", "veil", "privacy", "spend", "balance", "agent", "tool"],
      aliases: [
        "agent wallet",
        "wallet actions",
        "wallet tools",
        "payment rails",
        "crypto payment",
        "paid api",
        "x402 fetch",
        "x402 payment",
        "send usdc",
        "wallet balance",
        "usepod wallet",
        "moneyclaw",
        "bankr trading",
        "veil cash",
        "privacy pool",
      ],
      retrievalText: [
        "Prefer /api/crypto/capabilities for unified crypto capability selection and safe action preparation. Load this provider-specific wallet surface after the router selects a rail or when debugging a concrete wallet route.",
        "Use this capability when a workflow needs agent wallet, payment, crypto, x402, USDC, UsePod, MoneyClaw, Bankr, Veil Cash, privacy-pool setup, or paid API actions.",
        "Read-only checks: POST /api/wallet/balance for public wallet balance, GET /api/wallet/moneyclaw for MoneyClaw status, POST /api/usepod/status for UsePod token balance/models.",
        "Paid API path: x402_fetch uses POST /api/wallet/x402 with { agentId, url, method, headers, body, policy, confirmation } and signs from the encrypted local wallet vault.",
        "MiroShark buyer path: POST /api/miroshark/x402 with action 'run' to pay the public MiroShark x402 endpoint, using exactly one of prompt, url, or article plus optional deep_research, prediction_market, and affiliate. Use action 'suggest' for free ideas, 'status' with runId, and 'report' with runId and format 'json' or 'md'. Native chat can also run a MiroShark x402 simulation directly from prompts like 'run a sim on this polymarket: <url>' when the agent wallet Spend gate, Allow auto-use, and cap allow the $1 payment; the chat stream emits MiroShark progress events and embeds the final card payload.",
        "Approval gate: when Allow auto-use is off, present a concise payment draft and wait for plain explicit confirmation from the user before x402_fetch. When Allow auto-use is on, x402_fetch can pay without another prompt while staying under the hard per-payment cap.",
        "USDC sends use the same Allow auto-use policy: POST /api/wallet/send can send under the hard per-payment cap when auto-use is on, and requires SEND_USDC for the exact recipient and amount when auto-use is off.",
        "UsePod agents use their prepaid UsePod token balance for inference and provider-managed x402/paywall handling; do not require a separate local wallet for UsePod x402.",
        `Veil Cash runs on Base chain ${VEIL_CASH_CHAIN_ID}; HivemindOS stores the visible funding wallet and setup copy, while registration, deposits, private transfers, withdrawals, and subaccounts use the Veil app or ${VEIL_CASH_SDK_PACKAGE} CLI/SDK with explicit approval. Entry contract ${VEIL_CASH_CONTRACTS.entry}; USDC queue ${VEIL_CASH_CONTRACTS.usdcQueue}. Current docs and deployed source require USDC deposits to clear a 20 USDC shielded minimum after the 0.3% deposit fee: the CLI deposit amount is the net shielded amount, so deposit USDC 20 requires about 20.06 USDC available plus Base gas. Live relay execution currently requires at least 5 USDC for public-recipient USDC withdrawals.`,
        `Private send capability: when a user asks to "send privately" or make a private payment, select the active provider with privateTransferAssets instead of requiring the user to name the provider. Wallet spending must be on before any private-transfer endpoint executes; when Spend is off, prepare a draft only and ask the user to enable spending. Treat public/private/queued Veil state as internal rail inventory and present one agent spend balance to the user. The current Veil implementation supports private USDC and ETH sends through POST /api/wallet/veil/transfer after the user confirms a reviewed transfer draft, or without the internal '${VEIL_CASH_TRANSFER_CONFIRMATION_LABEL}' token only when that wallet's Veil auto-send policy is explicitly enabled; include autoShield for USDC sends. By default it sends privately to any public Ethereum address; if ready private USDC is insufficient, HivemindOS can shield from the agent's encrypted local Base wallet first, subject to the 20 USDC shield minimum and queue acceptance delay, then complete the private withdrawal after acceptance. The wallet duplicate payment guard is on by default and replays a recently completed matching asset, amount, and recipient during its configured time window; if the user turns it off, the same private send may submit again after the previous transfer finishes, while in-flight duplicate locks still apply. Only use registered-recipient mode for an explicit in-pool shielded transfer to a registered Veil recipient. VEIL_KEY and the Veil CLI must be configured on the server. Veil private x402 is a private payment capability: natural chat prompts can draft and confirm it directly, while lower-level POST /api/wallet/veil/x402 maps internal confirmation to VEIL_X402; discover the x402 USDC price, enforce maxPaymentUsd, withdraw from the Veil USDC pool into a fresh derived payer EOA, then sign and settle x402 from that burner. Veil Advanced setup includes Auto Always Private: when on, ordinary pay-this/x402 endpoint requests default to Veil private x402; when off, ordinary pay-this/x402 endpoint requests use the basic public x402 route and only explicit private wording such as privately, in private, private, or Veil selects the private x402 flow. Ask users for plain confirmation such as "confirm", not provider tokens. The dashboard does not expose or store VEIL_KEY in shared notes.`,
        `UsePod drop-in bases: ${USEPOD_COMPATIBILITY_MATRIX.openai.baseUrlTemplate} for OpenAI-compatible clients and ${USEPOD_COMPATIBILITY_MATRIX.anthropic.baseUrlTemplate} for Anthropic-compatible clients; never expose the actual token in shared notes.`,
        `UsePod direct deposits use ${USEPOD_FUNDING_MATRIX.USDC.label} on ${USEPOD_FUNDING_MATRIX.USDC.network} through the UsePod on-chain deposit instruction; do not use a plain SPL transfer memo.`,
        `UsePod provider hosting: ${USEPOD_SUPPLY_MATRIX["provider-agent"].commands?.join(" -> ")}. Enroll at ${USEPOD_SUPPLY_MATRIX["provider-agent"].actionUrl}; providers post a $${USEPOD_PROVIDER_BOND_USDC} USDC bond and earn ${(USEPOD_PROVIDER_EARN_SHARE * 100).toFixed(0)}% of settled inference.`,
        `UsePod key relay: use ${USEPOD_SUPPLY_MATRIX["key-relay"].docsUrl} when a user wants to resell upstream API-key capacity instead of local compute.`,
        "Never request, print, store in shared notes, or reveal private keys, seed phrases, wallet secrets, card details, or API keys.",
      ].join(" "),
      load: {
        type: "none",
        note: "Dashboard wallet capability. Use read-only status first; money movement follows the wallet Allow auto-use setting and hard caps.",
      },
    },
    {
      id: "tool-schema:stock-trading",
      kind: "tool-schema",
      title: "stock trading (buy/sell)",
      summary: "Buy and sell stocks through Alpaca (paper or live brokerage) or on-chain tokenized xStocks via Jupiter, governed by per-trade caps, the company kill switch, and CONFIRM_BUY/CONFIRM_SELL.",
      tags: ["stock", "stocks", "shares", "equities", "trade", "trading", "buy", "sell", "alpaca", "xstocks", "brokerage", "jupiter", "solana", "wallet", "spend", "agent", "tool"],
      aliases: [
        "buy a stock",
        "sell a stock",
        "buy shares",
        "sell shares",
        "stock trade",
        "alpaca order",
        "xstocks swap",
        "tokenized equity",
        "trade tab",
      ],
      retrievalText: [
        "Use this capability when a workflow needs to buy or sell stocks/equities, place a brokerage order, or trade tokenized equities (xStocks).",
        "HTTP surface: POST /api/trading with { action: 'quote'|'execute', side: 'buy'|'sell', agentId, ticker, notionalUsd, confirmation? }. GET /api/trading returns venue readiness (Alpaca key presence, supported xStock tickers) and the trade-ready agents.",
        "The acting wallet is resolved server-side from the agent's persisted wallet config; a request never supplies the trade policy, venue, or live/paper flag. The venue comes from the agent wallet's tradingVenue.",
        "Two venues: 'alpaca' places a market order via the Alpaca Trading API (defaults to PAPER; live only when the wallet sets alpacaPaper:false); 'xstocks' swaps USDC<->the verified xStock SPL mint via Jupiter (a sell sizes the position from the current price then swaps mint->USDC ExactIn) and signs with the agent's local Solana wallet.",
        "Governance: a buy spends USDC and runs the full per-trade cap, rolling-budget, and approval-escalation checks; a sell is an inflow and only enforces the company kill switch. A buy needs CONFIRM_BUY and a sell needs CONFIRM_SELL; both are recorded in the unified spend ledger as trade activity.",
        "Native chat can also buy from prompts like 'buy AAPL for $500'. The Trade dashboard tab exposes a Crypto/Stocks UI over the same governed rails. Crypto trading, swaps, perps, prediction markets, and other rails go through /api/crypto/capabilities, not this stock route.",
        "Never request, print, store, or reveal private keys, seed phrases, or wallet secrets.",
      ].join(" "),
      load: {
        type: "none",
        note: "Stock buy/sell capability. Quote first, then execute with the matching confirmation token; live brokerage orders move real money.",
      },
    },
    {
      id: "tool-schema:hyperliquid-trading",
      kind: "tool-schema",
      title: "Hyperliquid perp trading",
      summary: "Local EVM-wallet Hyperliquid perp quotes, builder-code approvals, and governed order execution through /api/trading/hyperliquid.",
      tags: ["hyperliquid", "perps", "perpetuals", "leverage", "builder-code", "builder-fee", "wallet", "trade", "trading", "agent", "tool"],
      aliases: [
        "hyperliquid trade",
        "hyperliquid order",
        "perp trade",
        "perps",
        "builder codes",
        "approve builder fee",
        "hyperliquid builder",
      ],
      retrievalText: [
        "Use this capability when a workflow needs to trade Hyperliquid spot or perps from a local EVM wallet, inspect account state, manage orders, adjust leverage or isolated margin, transfer/withdraw funds, place/cancel TWAPs, or approve the configured builder fee.",
        "HTTP surface: GET /api/trading/hyperliquid?agentId=<id> returns non-secret readiness, configured builder details, confirmation tokens, and optional account status. POST /api/trading/hyperliquid accepts read actions status, positions, open-orders, fills, fees, order-status; quote/order actions for spot/perp marketType, trigger orders, timeInForce, clientOrderId; and signed actions approve-builder, cancel, cancel-by-cloid, modify, schedule-cancel, leverage, margin, usd-class, usd-send, spot-send, withdraw, twap-order, twap-cancel.",
        "Builder-code policy: builder address, per-order builder fee, max approval fee, testnet flag, and optional API URL are fetched server-side from the official HivemindOS builder-policy endpoint. Client request bodies and local/shared env never choose the official builder recipient or fee; self-hosters replace the policy by forking/rebuilding or pointing their own distribution at their own endpoint.",
        "Approval sequence: first quote the order. If builderApproval.approved is false, action 'approve-builder' signs Hyperliquid ApproveBuilderFee from the selected main local EVM wallet and requires CONFIRM_HYPERLIQUID_BUILDER. Then action 'order' places the order with the configured builder payload and requires CONFIRM_HYPERLIQUID_ORDER.",
        "Execution policy: the route resolves wallet address, network, secret, and max trade/payment caps server-side from the local vault and governed wallet ledger. Orders, transfers, TWAPs, and margin changes pass the company kill switch, rolling budgets, approval escalation, maxTradeUsd/maxPaymentUsd cap, Hyperliquid tick/lot precision, and unified spend-ledger recording.",
        "MCP path: use hyperliquid_trade. quote/status/open-orders/fills/fees/order-status are read-style; approve-builder requires CONFIRM_HYPERLIQUID_BUILDER; order/modify requires CONFIRM_HYPERLIQUID_ORDER; cancels require CONFIRM_HYPERLIQUID_CANCEL; leverage/margin require CONFIRM_HYPERLIQUID_ACCOUNT; transfers/withdrawals require CONFIRM_HYPERLIQUID_TRANSFER; TWAPs require CONFIRM_HYPERLIQUID_TWAP. Never request, print, store, or reveal private keys, seed phrases, or wallet secrets.",
      ].join(" "),
      route: "/api/trading/hyperliquid",
      methods: ["GET", "POST"],
      load: {
        type: "api",
        target: "/api/trading/hyperliquid",
        note: "Quote/status first. Builder approval and orders are separately confirmed signed actions.",
      },
    },
    {
      id: "tool-schema:miroshark-x402-buyer",
      kind: "tool-schema",
      title: "MiroShark x402 buyer",
      summary: "Validated public MiroShark buyer flow for paid social simulations, free idea suggestions, run status, and report retrieval.",
      tags: ["miroshark", "x402", "simulation", "social", "research", "deep-research", "prediction-market", "polymarket", "report", "wallet", "usdc"],
      aliases: [
        "run MiroShark",
        "paid social simulation",
        "simulate reactions",
        "belief drift",
        "MiroShark report",
        "prediction market simulation",
        "x402 MiroShark",
      ],
      retrievalText: [
        "Use POST /api/miroshark/x402 when a user asks to run a MiroShark social simulation over x402, get MiroShark launch ideas, check a run, or retrieve a report. In native chat, direct requests such as 'run a sim on this polymarket: <url>' are intercepted by the runtime when Spend and Allow auto-use are enabled, paid through the configured x402 wallet, streamed as MiroShark progress, and rendered as an embedded simulation card.",
        "For paid runs send { action: 'run', agentId, prompt | url | article, deep_research?, prediction_market?, affiliate?, policy, confirmation? }. Exactly one seed is allowed. The route pays https://x402.miroshark.xyz/run through the encrypted local wallet vault and enforces the agent wallet policy.",
        "For free preflight ideas send { action: 'suggest', prompt }. For polling send { action: 'status', runId }. For report text send { action: 'report', runId, format: 'md' }, or omit format for JSON.",
        "A paid run returns the lower-level x402 result plus MiroShark's run_id, wait_url, status_url, and payer fields when the upstream response includes them.",
        "Before paying, present the seed, expected $1 USDC Base payment, wallet policy cap, and whether deep research is enabled unless wallet auto-use clearly permits this exact spend.",
      ].join(" "),
      route: "/api/miroshark/x402",
      methods: ["POST"],
      load: {
        type: "none",
        note: "Structured MiroShark buyer route backed by the existing x402 wallet executor.",
      },
    },
    {
      id: "tool-schema:shared-brain-memory",
      kind: "tool-schema",
      title: "shared brain memory",
      summary: "Vault-native remember, evolve, recall, and answer primitives for HivemindOS shared brain context.",
      tags: ["memory", "remember", "evolve", "supersedes", "recall", "answer", "obsidian", "vault", "agent", "shared", "brain", "context"],
      aliases: ["remember", "recall", "evolve memory", "update memory", "persistent memory", "shared memory", "agent memory", "memanto style memory", "memory answer", "write shared memory", "rebuild memory index"],
      retrievalText: [
        "Use /api/brain/memory when a workflow needs persistent memory or relevant context over the shared Obsidian brain.",
        "Raw/non-managed agents should use the installed hive-brain CLI: hive-brain answer '<query>' for recall, hive-brain recall '<query>' for hit lists, hive-brain remember --type TYPE --title TITLE --content TEXT for durable writes, and hive-brain evolve --memory-id ID --content TEXT to preserve history while replacing old memory when the app API is reachable.",
        "hive-brain tries the running HivemindOS API first and falls back to local vault/index search for recall/answer, so agents do not need to know the dashboard port.",
        "Default recall/answer is tiered: it checks typed Agent Memory first, returns distilled memory when the top hit is strong, and otherwise augments with full shared-vault markdown. Pass scope: 'agent-memory' for typed/proven memory only, or scope: 'full-vault' to force broad vault recall.",
        "Recall before depending on prior user preferences, decisions, instructions, goals, commitments, artifacts, lessons, or project context; remember only durable reviewed facts, decisions, preferences, goals, instructions, commitments, artifacts, errors, learnings, or reusable context.",
        "POST { action: 'remember', type, title, content, confidence, cognitiveStage, evidenceCount, sourceType, metaTags, tags, source, agentName, agentId, runtime, machineName, machineId, tailnetId, tailnetName, tailnetDnsName, collectorUrl, sessionId, project, vaultPath, proof } to save typed memory with machine provenance. Remember is the fast System 1 capture path by default.",
        "POST { action: 'evolve', memoryId | supersedes, type?, title?, content, confidence?, evolutionType, evolutionReason, cognitiveStage: 'system2', ...provenance } to write a new active memory, mark older memory notes superseded, append replacement index rows, and return the evolution chain.",
        "Recall and answer include evolutionChain for evolved hits. Treat the latest active chain head as current truth and prior versions as history/evidence.",
        "Set proof: true to always append a GitLawb memory receipt, or proof: 'auto' to receipt durable memory types and high-confidence facts.",
        "POST or GET recall with query, type, tags, project, limit, and optional scope to retrieve relevant memories and, when needed, vault notes.",
        "Use action 'answer' or GET mode=answer to return a grounded memory context pack from matching shared-brain memories and vault notes.",
        "Use action 'rebuild-index' to scan existing markdown memory notes once and append rich searchable entries to the private JSONL index.",
        "Supported memory types: instruction, fact, decision, goal, commitment, preference, relationship, context, event, learning, observation, artifact, error.",
        "Memory files live under Memory/Distillations/Agent Memory; private append-only search index entries live under Operations/Brain Services/Agent Memory Index.jsonl. Evolved records use supersedes/supersededBy/evolutionRootId frontmatter instead of overwriting history.",
        "Operations/Secure reference/status notes are included when recall augments with the full vault so agents can see credential names and set/missing status; do not read, print, store, summarize, or copy plaintext secret values.",
        "The search index stores memory content inside the private vault for fast recall; GitLawb proof receipts stay hash-only.",
        "GitLawb memory receipts live under Operations/Brain Services/Agent Memory Proofs.jsonl and store hashes/provenance instead of memory bodies.",
        "Prefer stable machine ids, Tailnet ids, and Tailnet DNS names for provenance; do not store raw Tailnet IPs in shared memory notes.",
      ].join(" "),
      load: {
        type: "api",
        target: "/api/brain/memory",
        note: "Use recall before broad vault reads; default recall is tiered, while remember writes only durable typed Agent Memory records.",
      },
    },
  ];
}

function appPreferenceAliases(app: ContextConnectedApp) {
  if (!app.priority && !app.usageNotes?.trim()) return [];
  const noteWords = (app.usageNotes ?? "")
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((word) => word.length >= 4)
    .slice(0, 16);
  return uniqueList([
    ...(app.priority ? ["priority app", "preferred app", "user preferred"] : []),
    ...noteWords,
  ]);
}

function appPreferenceSummary(app: ContextConnectedApp) {
  return [
    app.priority ? "User-pinned priority app: prefer this app when it matches the task." : "",
    app.usageNotes?.trim() ? `User routing preference: ${app.usageNotes.trim()}` : "",
    app.preferredModels?.length
      ? `Preferred models: ${app.preferredModels.map((entry) => `${entry.task} → ${entry.model}`).join("; ")}.`
      : "",
  ].filter(Boolean).join(" ");
}

function appPriorityBoost(app: ContextConnectedApp) {
  return (app.priority ? 25 : 0) + (app.usageNotes?.trim() ? 5 : 0);
}

function connectedAppItems(apps: ContextConnectedApp[] | undefined): ContextIndexItem[] {
  const items: ContextIndexItem[] = [];
  for (const app of apps ?? []) {
    const name = app.name?.trim() || app.id?.trim() || "Connected app";
    const id = app.id?.trim() || `${name}:${app.machineName ?? ""}:${app.openUrl ?? app.apiBaseUrl ?? ""}`;
    const preferenceAliases = appPreferenceAliases(app);
    const preferenceSummary = appPreferenceSummary(app);
    const aliases = uniqueList([...connectedAppAliases(app), ...preferenceAliases]);
    const appTags = tagParts(name, app.description, app.kind, app.serviceKind, app.machineName, app.machineHost, "connected", "tailnet", "app", ...aliases);
    const summary = [
      app.description?.trim() || "Connected Tailnet app or service discovered from the existing Apps view source.",
      preferenceSummary,
      app.machineName ? `Machine: ${app.machineName}.` : "",
      app.serviceKind ? `Service kind: ${app.serviceKind}.` : "",
      app.kind ? `App kind: ${app.kind}.` : "",
      app.apiRoutes?.length ? `${app.apiRoutes.length} discovered API endpoint${app.apiRoutes.length === 1 ? "" : "s"}.` : "",
      aliases.length ? `Capability aliases: ${aliases.join(", ")}.` : "",
    ].filter(Boolean).join(" ");
    items.push({
      id: `connected-app:${id}`,
      kind: "connected-app",
      title: name,
      summary,
      tags: appTags,
      aliases,
      priorityBoost: appPriorityBoost(app),
      retrievalText: retrievalText([
        `connected app: ${name}`,
        summary,
        `aliases: ${aliases.join(", ")}`,
        `routes: ${(app.apiRoutes ?? []).map((route) => `${route.method ?? "GET"} ${route.path ?? "/"}`).join("; ")}`,
      ]),
      route: app.openUrl,
      load: {
        type: app.openUrl ? "api" : "none",
        target: app.openUrl || app.apiBaseUrl,
        note: "Connected app discovered through /api/fleet/apps. Use read-only discovery first; require approval before mutating external app state.",
      },
    });

    for (const route of app.apiRoutes ?? []) {
      const method = route.method?.trim().toUpperCase() || "GET";
      const path = route.path?.trim() || "/";
      const url = route.url?.trim() || (app.apiBaseUrl ? `${app.apiBaseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}` : "");
      const aliases = uniqueList([...endpointAliases(app, route), ...preferenceAliases]);
      const summary = [
        route.summary?.trim() || `${method} endpoint from ${name}${route.category ? ` (${route.category})` : ""}.`,
        preferenceSummary,
      ].filter(Boolean).join(" ");
      items.push({
        id: `app-endpoint:${id}:${method}:${path}`,
        kind: "app-endpoint",
        title: `${name} ${method} ${path}`,
        summary,
        tags: tagParts(name, app.description, app.kind, app.serviceKind, app.machineName, route.category, method, path, route.source, ...aliases),
        aliases,
        priorityBoost: appPriorityBoost(app),
        retrievalText: retrievalText([
          `connected app endpoint: ${name} ${method} ${path}`,
          summary,
          `category: ${route.category ?? "API"}`,
          `aliases: ${aliases.join(", ")}`,
          `url: ${url || path}`,
        ]),
        route: url || path,
        methods: [method],
        load: {
          type: "api",
          target: url || app.apiBaseUrl || path,
          note: "Endpoint discovered by the existing Apps view route catalog. Prefer documented GET/read routes first; require explicit approval for POST/PUT/PATCH/DELETE.",
        },
      });
    }
  }
  return items;
}

function safeVaultFolder(folder: string, fallback: string) {
  const value = (folder || fallback).trim();
  if (!value) return fallback;
  if (value.split(/[\\/]+/).includes("..")) {
    throw new Error("Connected app context folders must stay inside the shared vault.");
  }
  return value.split(/[\\/]+/).filter(Boolean).join(sep);
}

function markdownList(values: string[]) {
  return values.length ? values.map((value) => `\`${value}\``).join(", ") : "`none`";
}

export async function writeConnectedAppsRagSnapshot(input: {
  apps?: ContextConnectedApp[];
  vaultPath?: string;
  brainServicesFolder?: string;
}) {
  const apps = input.apps ?? [];
  const items = connectedAppItems(apps);
  const appItems = items.filter((item) => item.kind === "connected-app");
  const endpointItems = items.filter((item) => item.kind === "app-endpoint");
  const vault = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const folder = safeVaultFolder(input.brainServicesFolder || DEFAULT_SHARED_VAULT.brainServicesFolder, DEFAULT_SHARED_VAULT.brainServicesFolder);
  const root = join(vault, folder);
  await mkdir(root, { recursive: true });
  const notePath = join(root, CONNECTED_APPS_NOTE);
  const now = new Date().toISOString();
  const sections = apps.map((app) => {
    const name = app.name?.trim() || app.id?.trim() || "Connected app";
    const appItem = appItems.find((item) => item.title === name);
    const routes = (app.apiRoutes ?? []).map((route) => {
      const method = route.method?.trim().toUpperCase() || "GET";
      const path = route.path?.trim() || "/";
      const aliases = endpointAliases(app, route);
      return `- ${method} \`${path}\` - ${route.summary?.trim() || route.category || "API endpoint"}. Aliases: ${markdownList(aliases)}. URL: \`${route.url || app.apiBaseUrl || ""}\``;
    });
    return [
      `## ${name}`,
      "",
      appItem?.summary || app.description || "Connected Tailnet app.",
      "",
      `- Machine: ${app.machineName || "unknown"}`,
      `- App kind: ${app.kind || "app"}`,
      `- Service kind: ${app.serviceKind || "none"}`,
      `- Open URL: \`${app.openUrl || ""}\``,
      `- API base URL: \`${app.apiBaseUrl || ""}\``,
      `- Retrieval aliases: ${markdownList(appItem?.aliases ?? connectedAppAliases(app))}`,
      "",
      "### Endpoints",
      "",
      routes.length ? routes.join("\n") : "- No API endpoints discovered.",
    ].join("\n");
  });
  const body = [
    "---",
    "type: context-index",
    "service: connected-apps",
    "managedBy: hivemindos",
    `updatedAt: ${JSON.stringify(now)}`,
    `appCount: ${appItems.length}`,
    `endpointCount: ${endpointItems.length}`,
    "---",
    "",
    "# Connected Apps Context Index",
    "",
    "Managed retrieval snapshot for Tailnet apps and API endpoints discovered by the HivemindOS Apps view. Agents should use this for intent-based retrieval, then call `/api/context-index` or `/api/fleet/apps` for fresh endpoint details before making requests.",
    "",
    "## Retrieval Contract",
    "",
    "- The app names and endpoints below are discovered, not hand-maintained.",
    "- Capability aliases normalize task language such as image generation, simulation, templates, graph, exports, monitoring, settings, and API docs.",
    "- Prefer read-only endpoints first; require explicit approval before POST, PUT, PATCH, or DELETE.",
    "",
    ...sections,
    "",
  ].join("\n");
  await writeFile(notePath, body, "utf8");
  return {
    path: relative(vault, notePath),
    absolutePath: notePath,
    appCount: appItems.length,
    endpointCount: endpointItems.length,
    updatedAt: now,
  };
}

function runtimeItems(): ContextIndexItem[] {
  return Object.values(RUNTIME_DEFINITIONS).map((definition) => {
    const tags = compactCapabilityTags(definition.capabilities as Record<string, unknown>);
    return {
      id: `runtime:${definition.runtime}`,
      kind: "runtime" as const,
      title: definition.label,
      summary: `${definition.kind} runtime with capabilities: ${tags.join(", ") || "none"}.`,
      tags: tagParts(definition.runtime, definition.label, definition.kind, ...tags),
      path: absolutePath("src/lib/types/agent-runtime.ts"),
      load: {
        type: "file" as const,
        target: absolutePath("src/lib/types/agent-runtime.ts"),
        note: "Load the runtime definition only when routing, setup, or capability details are needed.",
      },
    };
  });
}

function mcpCatalogItems(): ContextIndexItem[] {
  return HIVE_MCP_SERVER_CATALOG.map((server) => ({
    id: `mcp-catalog:${server.id}`,
    kind: "tool-schema",
    title: server.name,
    summary: server.summary,
    tags: tagParts(server.id, server.name, server.source, ...server.categories, ...server.capabilities, "mcp", "catalog"),
    aliases: uniqueList([server.id, server.name, ...server.categories, ...server.capabilities, ...server.credentialKeys]),
    retrievalText: retrievalText([
      server.summary,
      `repo: ${server.repoUrl}`,
      `credential keys: ${server.credentialKeys.join(", ") || "none"}`,
      `side effects: ${server.sideEffects.join(", ")}`,
      `install hint: ${server.installHint}`,
      `safety: ${server.safetyNote}`,
    ]),
    route: "/api/mcp/catalog",
    methods: ["GET"],
    load: {
      type: "api",
      target: `/api/mcp/catalog?q=${encodeURIComponent(server.id)}`,
      note: "Curated MCP catalog entry. Verify credentials and side effects before installing or running the server.",
    },
  }));
}

async function docFileStats(): Promise<FileStatEntry[]> {
  const roots = DOC_ROOTS.map((root) => join(workspaceRoot(), root));
  const files = (await Promise.all(roots.map((root) => walkFiles(root, [], 500)))).flat()
    .filter((file) => file.endsWith(".md"));
  return statPaths(files);
}

async function docItem(file: FileStatEntry): Promise<ContextIndexItem> {
  const content = file.size <= MAX_DOC_BYTES ? await readFile(file.path, "utf8").catch(() => "") : "";
  const title = content ? titleFromMarkdown(file.path, content) : basename(file.path);
  const summary = content ? firstUsefulParagraph(content) : "Documentation file. Load for details.";
  return {
    id: `doc:${toPosix(relative(workspaceRoot(), file.path))}`,
    kind: "doc" as const,
    title,
    summary: summary.slice(0, 280),
    tags: tagParts(title, relative(workspaceRoot(), file.path)),
    path: file.path,
    load: { type: "file" as const, target: file.path, note: "Use as documentation context; prefer the most specific doc first." },
    updatedAt: file.mtimeMs,
    sizeBytes: file.size,
  };
}

async function workspaceFileStats(): Promise<FileStatEntry[]> {
  const topLevel = TOP_LEVEL_FILES.map(absolutePath);
  const roots = WORKSPACE_ROOTS.map((root) => join(workspaceRoot(), root));
  const files = [
    ...topLevel,
    ...(await Promise.all(roots.map((root) => walkFiles(root, [], 800)))).flat(),
  ];
  const unique = [...new Set(files)]
    .filter((file) => !file.includes(`${sep}src${sep}app${sep}api${sep}`) && !file.includes(`${sep}docs${sep}`));
  return statPaths(unique);
}

function workspaceFileItem(file: FileStatEntry): ContextIndexItem {
  const rel = toPosix(relative(workspaceRoot(), file.path));
  return {
    id: `workspace:${rel}`,
    kind: "workspace-file" as const,
    title: rel,
    summary: `Workspace file ${rel}.`,
    tags: tagParts(rel, basename(file.path), dirname(rel)),
    path: file.path,
    load: { type: "file" as const, target: file.path, note: "Load for implementation details only after metadata matches the task." },
    updatedAt: file.mtimeMs,
    sizeBytes: file.size,
  };
}

function totals(items: ContextIndexItem[]) {
  const result = {
    skill: 0,
    "tool-schema": 0,
    "api-route": 0,
    "connected-app": 0,
    "app-endpoint": 0,
    runtime: 0,
    doc: 0,
    "workspace-file": 0,
  } satisfies Record<ContextIndexKind, number>;
  for (const item of items) result[item.kind] += 1;
  return result;
}

// Filesystem-backed sources for the long-lived index. Each source has a cheap
// probe (stat-level fingerprint, no content reads) and a build step that runs
// only when the fingerprint actually changed. Connected apps, runtimes, and
// local CLI tools are intentionally NOT sources: they are cheap synchronous
// items computed fresh per request, so app churn never invalidates this index.
type FsSourceProbe = { signature: string; files?: FileStatEntry[]; items?: ContextIndexItem[] };

type FsSourceDefinition = {
  name: string;
  kinds: ContextIndexKind[];
  probe: (options: ContextIndexOptions) => Promise<FsSourceProbe>;
  build: (probe: FsSourceProbe, options: ContextIndexOptions) => Promise<ContextIndexItem[]>;
};

const FS_SOURCES: FsSourceDefinition[] = [
  {
    // Vault skills have no local stat fingerprint; the inventory calls are
    // cached upstream, so the probe builds the items and signs id + mtime.
    name: "vault-skills",
    kinds: ["skill"],
    probe: async (options) => {
      const items = await skillItems(options);
      return {
        signature: items.map((item) => `${item.id}\u001f${item.updatedAt ?? 0}`).sort().join("\u001e"),
        items,
      };
    },
    build: async (probe) => probe.items ?? [],
  },
  {
    name: "packaged-skills",
    kinds: ["skill"],
    probe: async () => {
      const files = await packagedSkillFileStats();
      return { signature: fileSignature(files), files };
    },
    build: (probe) => Promise.all((probe.files ?? []).map(packagedSkillItem)),
  },
  {
    name: "api-routes",
    kinds: ["api-route"],
    probe: async () => {
      const files = await apiRouteFileStats();
      return { signature: fileSignature(files), files };
    },
    build: (probe) => Promise.all((probe.files ?? []).map(apiRouteItem)),
  },
  {
    name: "tool-schemas",
    kinds: ["tool-schema"],
    probe: async () => {
      const files = await toolSchemaFileStats();
      return { signature: fileSignature(files), files };
    },
    build: (probe) => Promise.all((probe.files ?? []).map(toolSchemaItem)),
  },
  {
    name: "docs",
    kinds: ["doc"],
    probe: async () => {
      const files = await docFileStats();
      return { signature: fileSignature(files), files };
    },
    build: (probe) => Promise.all((probe.files ?? []).map(docItem)),
  },
  {
    name: "workspace-files",
    kinds: ["workspace-file"],
    probe: async () => {
      const files = await workspaceFileStats();
      return { signature: fileSignature(files), files };
    },
    build: async (probe) => (probe.files ?? []).map(workspaceFileItem),
  },
];

type FsSourceSnapshot = { signature: string; items: ContextIndexItem[] };

type FsIndexState = {
  checkedAt: number;
  sources: Map<string, FsSourceSnapshot>;
  building: Map<string, Promise<ContextIndexItem[]>>;
  refreshing: Promise<void> | null;
};

const fsIndexStates = new Map<string, FsIndexState>();

function fsIndexKey(options: ContextIndexOptions) {
  return [
    options.vaultPath ?? "default",
    options.includeRuntimeProviders ? "providers" : "shared",
  ].join(":");
}

function fsIndexState(options: ContextIndexOptions) {
  const key = fsIndexKey(options);
  let state = fsIndexStates.get(key);
  if (!state) {
    state = { checkedAt: Date.now(), sources: new Map(), building: new Map(), refreshing: null };
    fsIndexStates.set(key, state);
  }
  return state;
}

async function probeAndBuildSource(source: FsSourceDefinition, options: ContextIndexOptions): Promise<FsSourceSnapshot> {
  const probe = await source.probe(options);
  return { signature: probe.signature, items: probe.items ?? await source.build(probe, options) };
}

// Cold path only: build a missing source once, de-duping concurrent callers.
// Failures are never stored, so the next request retries the source.
async function ensureSourceItems(state: FsIndexState, source: FsSourceDefinition, options: ContextIndexOptions): Promise<ContextIndexItem[]> {
  const cached = state.sources.get(source.name);
  if (cached) return cached.items;
  const inFlight = state.building.get(source.name);
  if (inFlight) return inFlight;
  const pending = probeAndBuildSource(source, options).then((snapshot) => {
    state.sources.set(source.name, snapshot);
    return snapshot.items;
  });
  state.building.set(source.name, pending);
  try {
    return await pending;
  } finally {
    state.building.delete(source.name);
  }
}

// Stale-while-revalidate: requests always read the in-memory snapshots; this
// background pass re-probes fingerprints and surgically rebuilds only the
// sources whose backing files actually changed.
function scheduleFsSourceRefresh(state: FsIndexState, options: ContextIndexOptions) {
  if (state.refreshing || Date.now() - state.checkedAt < FS_REFRESH_CHECK_INTERVAL_MS) return;
  state.checkedAt = Date.now();
  state.refreshing = Promise.all(FS_SOURCES.map((source) => (async () => {
    const cached = state.sources.get(source.name);
    if (!cached) return;
    const probe = await source.probe(options);
    if (probe.signature === cached.signature) return;
    const items = probe.items ?? await source.build(probe, options);
    state.sources.set(source.name, { signature: probe.signature, items });
  })().catch(() => undefined))).then(() => undefined).finally(() => {
    state.refreshing = null;
  });
}

function perRequestItems(options: ContextIndexOptions, wants: (kind: ContextIndexKind) => boolean): ContextIndexItem[] {
  return [
    ...(wants("tool-schema") ? [...hiveActionContextIndexItems(listHiveActions()), ...localCliToolItems(), ...externalAgentProviderItems(), ...mcpCatalogItems()] : []),
    ...(wants("connected-app") || wants("app-endpoint") ? connectedAppItems(options.connectedApps) : []),
    ...(wants("runtime") ? runtimeItems() : []),
  ].filter((item) => wants(item.kind));
}

function assembleIndex(options: ContextIndexOptions, items: ContextIndexItem[]): ContextIndex {
  return {
    generatedAt: new Date().toISOString(),
    root: workspaceRoot(),
    vaultPath: options.vaultPath,
    items,
    totals: totals(items),
  };
}

async function withAppPreferences(options: ContextIndexOptions): Promise<ContextIndexOptions> {
  if (!options.connectedApps?.length) return options;
  const preferences = await readAppPreferences().catch(() => []);
  if (!preferences.length) return options;
  return { ...options, connectedApps: applyAppPreferences(options.connectedApps, preferences) };
}

export async function buildContextIndex(rawOptions: ContextIndexOptions = {}): Promise<ContextIndex> {
  const options = await withAppPreferences(rawOptions);
  const requestedKinds = options.kinds?.length ? new Set(options.kinds) : null;
  const wants = (kind: ContextIndexKind) => !requestedKinds || requestedKinds.has(kind);
  const fsItems = (await Promise.all(FS_SOURCES
    .filter((source) => source.kinds.some(wants))
    .map((source) => probeAndBuildSource(source, options).then((snapshot) => snapshot.items).catch(() => []))
  )).flat();
  return assembleIndex(options, [...fsItems, ...perRequestItems(options, wants)]);
}

function tokenize(value: string) {
  return value.toLowerCase().split(/[^a-z0-9_-]+/).filter((word) => word.length > 2 && word !== "gen");
}

function expandedQueryWords(query: string) {
  const normalized = query.toLowerCase();
  const words = tokenize(normalized);
  const expansions = [
    /image|picture|photo|visual|render|diffusion|txt2img|text.?to.?image/.test(normalized) ? ["image", "image generation", "image gen", "text to image", "creative", "visual generation", "diffusion", "render"] : [],
    /video|movie|clip|animation/.test(normalized) ? ["video", "media", "render", "generation"] : [],
    /sim|simulation|scenario|swarm/.test(normalized) ? ["simulation", "scenario", "swarm", "swarm-goal", "parallel agents", "run history"] : [],
    /goal|orchestrat|delegate|parallel|spawn|build|implement/.test(normalized) ? ["goal", "swarm-goal", "queen bee", "orchestration", "agent routing", "work board", "parallel agents", "build"] : [],
    /graph|ontology|network/.test(normalized) ? ["graph", "ontology", "knowledge graph"] : [],
    /api|endpoint|route|openapi|swagger|docs/.test(normalized) ? ["api", "endpoint", "openapi", "swagger", "api docs"] : [],
  ].flat();
  return uniqueList([...words, ...expansions]);
}

function scoreItem(query: string, item: ContextIndexItem) {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return 1;
  const aliases = item.aliases ?? [];
  const text = `${item.title} ${item.summary} ${item.tags.join(" ")} ${aliases.join(" ")} ${item.retrievalText ?? ""} ${item.path ?? ""} ${item.route ?? ""}`.toLowerCase();
  let score = text.includes(normalizedQuery) ? 40 : 0;
  if (aliases.some((alias) => alias === normalizedQuery || alias.includes(normalizedQuery))) score += 35;
  if ((item.retrievalText ?? "").toLowerCase().includes(normalizedQuery)) score += 20;
  for (const word of expandedQueryWords(normalizedQuery)) {
    if (item.title.toLowerCase().includes(word)) score += 12;
    if (aliases.some((alias) => alias.includes(word))) score += 11;
    if (item.tags.some((tag) => tag.includes(word))) score += 8;
    if ((item.path ?? "").toLowerCase().includes(word) || (item.route ?? "").toLowerCase().includes(word)) score += 5;
    if ((item.retrievalText ?? "").toLowerCase().includes(word)) score += 4;
    if (item.summary.toLowerCase().includes(word)) score += 3;
  }
  if (item.kind === "skill") score += 2;
  if (item.kind === "tool-schema" || item.kind === "api-route") score += 1;
  return score;
}

// Long-lived index serving: the first request for a source blocks to build it
// once; every later request reads the in-memory snapshot immediately and a
// background pass refreshes only the sources whose fingerprints changed.
// Connected apps never key or invalidate this cache — they merge per request.
export async function getContextIndex(rawOptions: ContextIndexOptions = {}): Promise<ContextIndex> {
  const options = await withAppPreferences(rawOptions);
  const requestedKinds = options.kinds?.length ? new Set(options.kinds) : null;
  const wants = (kind: ContextIndexKind) => !requestedKinds || requestedKinds.has(kind);
  const state = fsIndexState(options);
  const fsItems = (await Promise.all(FS_SOURCES
    .filter((source) => source.kinds.some(wants))
    .map((source) => ensureSourceItems(state, source, options).catch(() => []))
  )).flat();
  scheduleFsSourceRefresh(state, options);
  return assembleIndex(options, [...fsItems, ...perRequestItems(options, wants)]);
}

export async function searchContextIndex(options: ContextIndexSearchOptions = {}) {
  const index = await getContextIndex(options);
  const kinds = options.kinds?.length ? new Set(options.kinds) : null;
  const scored = index.items
    .filter((item) => !kinds || kinds.has(item.kind))
    .map((item) => {
      const base = scoreItem(options.query ?? "", item);
      // Priority boost only re-ranks items that already match the query; it never surfaces irrelevant apps.
      return { ...item, score: base > 0 ? base + (item.priorityBoost ?? 0) : base };
    })
    .filter((item) => !options.query?.trim() || (item.score ?? 0) > 0)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title));
  return {
    ...index,
    query: options.query?.trim() || "",
    items: scored.slice(0, options.limit ?? 40),
    totalMatches: scored.length,
  };
}
