import { constants } from "fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { basename, dirname, extname, join, relative, sep } from "path";
import { cachedCall } from "@/lib/services/async-cache";
import { getBrainSkillInventory } from "@/lib/services/obsidian/brain-skills";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { RUNTIME_DEFINITIONS } from "@/lib/types/agent-runtime";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";

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
};

export type ContextIndexSearchOptions = ContextIndexOptions & {
  query?: string;
  kinds?: ContextIndexKind[];
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
};

const CACHE_TTL_MS = 30_000;
const MAX_DOC_BYTES = 256 * 1024;
const SKIPPED_DIRS = new Set([".git", ".next", ".next-tauri", ".next-tauri-build", "node_modules", "out", "dist", "build"]);
const WORKSPACE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".sh", ".ps1", ".go", ".rs"]);
const DOC_ROOTS = ["docs"];
const WORKSPACE_ROOTS = ["src/lib", "src/features/dashboard", "src/components", "scripts", "workers", "cmd", "src-tauri/src"];
const TOP_LEVEL_FILES = ["AGENTS.md", "README.md", "ROADMAP.md", "CHANGELOG.md", "package.json", "setup.sh", "setup.ps1", "uninstall.sh", "uninstall.ps1"];
const TOOL_SCHEMA_FILES = ["src/lib/search-tool.ts", "src/app/api/orchestrator/route.ts", "src/app/api/scheduler/skill-action/route.ts"];
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
  const inventory = await getBrainSkillInventory(options.vaultPath);
  const shared = inventory.shared.map((skill): ContextIndexItem => ({
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

  const providerSkills = inventory.providers.flatMap((provider) => provider.skills.map((skill): ContextIndexItem => ({
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

async function apiRouteItems(): Promise<ContextIndexItem[]> {
  const files = await walkFiles(join(workspaceRoot(), "src/app/api"), [], 500);
  const routes = files.filter((file) => file.endsWith(`${sep}route.ts`));
  return Promise.all(routes.map(async (path) => {
    const source = await readFile(path, "utf8").catch(() => "");
    const methods = methodNames(source);
    const route = routeFromFile(path);
    const st = await safeStat(path);
    return {
      id: `api:${route}`,
      kind: "api-route" as const,
      title: route,
      summary: `${methods.join(", ") || "HTTP"} endpoint for ${route}.`,
      tags: tagParts(route, ...methods),
      path,
      route,
      methods,
      load: { type: "file" as const, target: path, note: "Read the route file for request and response shape before calling." },
      updatedAt: st?.mtimeMs,
      sizeBytes: st?.size,
    };
  }));
}

async function toolSchemaItems(): Promise<ContextIndexItem[]> {
  const items: ContextIndexItem[] = [];
  for (const relativePath of TOOL_SCHEMA_FILES) {
    const path = absolutePath(relativePath);
    if (!(await canRead(path))) continue;
    const source = await readFile(path, "utf8").catch(() => "");
    const st = await safeStat(path);
    const tools = extractToolNames(source);
    const title = relativePath.endsWith("search-tool.ts")
      ? "web_search"
      : relativePath.includes("orchestrator")
        ? "orchestrator tools"
        : basename(dirname(path));
    items.push({
      id: `tool-schema:${relativePath}`,
      kind: "tool-schema",
      title,
      summary: tools.length
        ? `Tool surface: ${tools.join(", ")}.`
        : "Tool schema or action runtime definitions. Read before exposing tool calls.",
      tags: tagParts(title, relativePath, ...tools),
      path,
      load: { type: "file", target: path, note: "Load only when this tool surface is needed for the task." },
      updatedAt: st?.mtimeMs,
      sizeBytes: st?.size,
    });
  }
  return items;
}

function connectedAppItems(apps: ContextConnectedApp[] | undefined): ContextIndexItem[] {
  const items: ContextIndexItem[] = [];
  for (const app of apps ?? []) {
    const name = app.name?.trim() || app.id?.trim() || "Connected app";
    const id = app.id?.trim() || `${name}:${app.machineName ?? ""}:${app.openUrl ?? app.apiBaseUrl ?? ""}`;
    const aliases = connectedAppAliases(app);
    const appTags = tagParts(name, app.description, app.kind, app.serviceKind, app.machineName, app.machineHost, "connected", "tailnet", "app", ...aliases);
    const summary = [
      app.description?.trim() || "Connected Tailnet app or service discovered from the existing Apps view source.",
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
      const aliases = endpointAliases(app, route);
      const summary = route.summary?.trim() || `${method} endpoint from ${name}${route.category ? ` (${route.category})` : ""}.`;
      items.push({
        id: `app-endpoint:${id}:${method}:${path}`,
        kind: "app-endpoint",
        title: `${name} ${method} ${path}`,
        summary,
        tags: tagParts(name, app.description, app.kind, app.serviceKind, app.machineName, route.category, method, path, route.source, ...aliases),
        aliases,
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

async function docItems(): Promise<ContextIndexItem[]> {
  const roots = DOC_ROOTS.map((root) => join(workspaceRoot(), root));
  const files = (await Promise.all(roots.map((root) => walkFiles(root, [], 500)))).flat()
    .filter((file) => file.endsWith(".md"));
  return Promise.all(files.map(async (path) => {
    const st = await safeStat(path);
    const content = st && st.size <= MAX_DOC_BYTES ? await readFile(path, "utf8").catch(() => "") : "";
    const title = content ? titleFromMarkdown(path, content) : basename(path);
    const summary = content ? firstUsefulParagraph(content) : "Documentation file. Load for details.";
    return {
      id: `doc:${toPosix(relative(workspaceRoot(), path))}`,
      kind: "doc" as const,
      title,
      summary: summary.slice(0, 280),
      tags: tagParts(title, relative(workspaceRoot(), path)),
      path,
      load: { type: "file" as const, target: path, note: "Use as documentation context; prefer the most specific doc first." },
      updatedAt: st?.mtimeMs,
      sizeBytes: st?.size,
    };
  }));
}

async function workspaceFileItems(): Promise<ContextIndexItem[]> {
  const topLevel = TOP_LEVEL_FILES.map(absolutePath);
  const roots = WORKSPACE_ROOTS.map((root) => join(workspaceRoot(), root));
  const files = [
    ...topLevel,
    ...(await Promise.all(roots.map((root) => walkFiles(root, [], 800)))).flat(),
  ];
  const unique = [...new Set(files)]
    .filter((file) => !file.includes(`${sep}src${sep}app${sep}api${sep}`) && !file.includes(`${sep}docs${sep}`));

  return Promise.all(unique.map(async (path) => {
    const st = await safeStat(path);
    const rel = toPosix(relative(workspaceRoot(), path));
    return {
      id: `workspace:${rel}`,
      kind: "workspace-file" as const,
      title: rel,
      summary: `Workspace file ${rel}.`,
      tags: tagParts(rel, basename(path), dirname(rel)),
      path,
      load: { type: "file" as const, target: path, note: "Load for implementation details only after metadata matches the task." },
      updatedAt: st?.mtimeMs,
      sizeBytes: st?.size,
    };
  }));
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

export async function buildContextIndex(options: ContextIndexOptions = {}): Promise<ContextIndex> {
  const root = workspaceRoot();
  const items = (await Promise.all([
    skillItems(options).catch(() => []),
    apiRouteItems(),
    toolSchemaItems(),
    Promise.resolve(connectedAppItems(options.connectedApps)),
    Promise.resolve(runtimeItems()),
    docItems(),
    workspaceFileItems(),
  ])).flat();

  return {
    generatedAt: new Date().toISOString(),
    root,
    vaultPath: options.vaultPath,
    items,
    totals: totals(items),
  };
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
    /sim|simulation|scenario|swarm/.test(normalized) ? ["simulation", "scenario", "swarm", "run history"] : [],
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

function cacheKey(options: ContextIndexOptions) {
  return `context-index:${options.vaultPath ?? "default"}:${options.includeRuntimeProviders === false ? "shared" : "providers"}`;
}

export function getContextIndex(options: ContextIndexOptions = {}) {
  if (options.connectedApps?.length) return buildContextIndex(options);
  return cachedCall(cacheKey(options), CACHE_TTL_MS, () => buildContextIndex(options));
}

export async function searchContextIndex(options: ContextIndexSearchOptions = {}) {
  const index = await getContextIndex(options);
  const kinds = options.kinds?.length ? new Set(options.kinds) : null;
  const scored = index.items
    .filter((item) => !kinds || kinds.has(item.kind))
    .map((item) => ({ ...item, score: scoreItem(options.query ?? "", item) }))
    .filter((item) => !options.query?.trim() || (item.score ?? 0) > 0)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title));
  return {
    ...index,
    query: options.query?.trim() || "",
    items: scored.slice(0, options.limit ?? 40),
    totalMatches: scored.length,
  };
}
