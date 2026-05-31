import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AgentProfile, AgentRuntime, RuntimeCapabilities } from "@/lib/types/agent-runtime";
import { RUNTIME_CAPABILITIES } from "@/lib/types/agent-runtime";
import { getRuntimeAdapter } from "@/lib/services/runtime-adapters/registry";
import { mergeRuntimeSessions, previewSessionText } from "@/lib/services/runtime-session-utils";
import type { RuntimeModelSelection } from "./runtime-adapters/types";

const execFileAsync = promisify(execFile);
const HERMES_HOME = join(homedir(), ".hermes");
const HERMES_AGENT_DIR = join(HERMES_HOME, "hermes-agent");
const HERMES_PYTHON = join(HERMES_AGENT_DIR, "venv", "bin", "python");
const HERMES_DB = join(HERMES_HOME, "state.db");
const HIVE_ENV = join(homedir(), ".hivemindos", ".env");
const OPENCLAW_CONFIG = join(homedir(), ".openclaw", "openclaw.json");
const OPENCLAW_AGENTS = join(homedir(), ".openclaw", "agents");
const RUN_LOG_ROOT = join(homedir(), ".hivemindos", "runtime-runs");

export type RuntimeIntegrationKey =
  | "sessionSearch"
  | "backgroundTasks"
  | "xSearch"
  | "socialPosting"
  | "videoGeneration"
  | "codexRuntime"
  | "kanbanDecompose";

export type RuntimeIntegrationStatus = {
  runtime: AgentRuntime;
  capabilities: RuntimeCapabilities;
  integrations: Record<RuntimeIntegrationKey, {
    supported: boolean;
    enabled: boolean;
    detail: string;
  }>;
  diagnostics: string[];
  modelSelection?: RuntimeModelSelection;
  providerStatus?: {
    usePod?: {
      tokenEnvName?: string;
      depositAddress?: string;
      balanceRemaining?: string;
      route?: string;
      checkedAt?: string;
      status?: string;
      message?: string;
      modelCount?: number;
    };
  };
};

export type RuntimeSessionSearchResult = {
  id: string;
  runtime: AgentRuntime;
  title: string;
  source?: string;
  model?: string | null;
  startedAt?: string;
  updatedAt?: string;
  excerpt: string;
  path?: string;
};

type HermesSessionRow = {
  id: string;
  source: string;
  model: string | null;
  title: string | null;
  started_at: number;
  updated_at: number | null;
  system_prompt: string | null;
};

export async function getRuntimeIntegrationStatus(runtime: AgentRuntime, agent?: AgentProfile): Promise<RuntimeIntegrationStatus> {
  const adapter = getRuntimeAdapter(runtime);
  const capabilities = { ...(RUNTIME_CAPABILITIES[runtime] ?? adapter?.capabilities ?? {}), ...(agent?.runtimeCapabilities ?? {}) };
  if (runtime !== "hermes") {
    let modelSelection: RuntimeModelSelection | undefined;
    let providerStatus: RuntimeIntegrationStatus["providerStatus"] | undefined;
    const diagnostics: string[] = [];
    if (adapter?.getStatus && agent) {
      try {
        const status = await adapter.getStatus(agent, {});
        if (status && typeof status === "object" && "modelSelection" in status) {
          modelSelection = (status as { modelSelection?: RuntimeModelSelection }).modelSelection;
        }
        if (status && typeof status === "object" && "providerStatus" in status) {
          providerStatus = (status as { providerStatus?: RuntimeIntegrationStatus["providerStatus"] }).providerStatus;
        }
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : `${adapter.label} status check failed.`);
      }
    }
    return {
      runtime,
      capabilities,
      modelSelection,
      providerStatus,
      integrations: integrationDefaults(capabilities),
      diagnostics,
    };
  }

  const diagnostics: string[] = [];
  const [version, tools, config, modelSelection] = await Promise.all([
    runHermes(["--version"]).catch((error) => {
      diagnostics.push(error instanceof Error ? error.message : "Hermes version check failed.");
      return "";
    }),
    runHermes(["tools", "list"]).catch(() => ""),
    readFile(join(HERMES_HOME, "config.yaml"), "utf8").catch(() => ""),
    getHermesModelSelection().catch((error) => {
      diagnostics.push(error instanceof Error ? error.message : "Hermes model inventory failed.");
      return undefined;
    }),
  ]);
  const toolEnabled = (name: string) => new RegExp(`✓\\s+enabled\\s+${escapeRegExp(name)}\\b`).test(tools);
  const codexConfigured = /provider:\s*openai-codex\b|codex_app_server|codex-runtime/i.test(config);
  const kanbanAuto = /auto_decompose:\s*true/i.test(config);
  if (version.trim()) diagnostics.push(version.trim());

  return {
    runtime,
    capabilities,
    modelSelection,
    integrations: {
      sessionSearch: {
        supported: true,
        enabled: existsSync(HERMES_DB),
        detail: existsSync(HERMES_DB) ? "Hermes session store is readable." : "Hermes session store was not found.",
      },
      backgroundTasks: {
        supported: true,
        enabled: Boolean(version.trim()),
        detail: version.trim() ? "Run Hermes tasks in the background while chat stays available." : "Hermes CLI was not found.",
      },
      xSearch: {
        supported: true,
        enabled: toolEnabled("x_search"),
        detail: toolEnabled("x_search") ? "x_search is enabled for CLI." : "Enable x_search after xAI OAuth or XAI_API_KEY is configured.",
      },
      socialPosting: {
        supported: false,
        enabled: false,
        detail: "Hermes exposes X search natively here; posting should remain a skill/plugin action.",
      },
      videoGeneration: {
        supported: true,
        enabled: toolEnabled("video_gen"),
        detail: toolEnabled("video_gen") ? "video_generate is enabled for CLI." : "Enable video_gen before asking Hermes to create videos.",
      },
      codexRuntime: {
        supported: true,
        enabled: codexConfigured,
        detail: codexConfigured ? "Codex/OpenAI path is present in Hermes config." : "Use Hermes Codex auth/runtime setup before routing coding work through Codex.",
      },
      kanbanDecompose: {
        supported: true,
        enabled: kanbanAuto,
        detail: kanbanAuto ? "Hermes auto_decompose is on." : "Hermes can decompose Kanban triage tasks manually.",
      },
    },
    diagnostics,
  };
}

export async function searchRuntimeSessions(runtime: AgentRuntime, query: string, limit = 20): Promise<RuntimeSessionSearchResult[]> {
  if (runtime === "hermes") return searchHermesSessions(query, limit);
  if (runtime === "openclaw") return searchOpenClawSessions(query, limit);
  return [];
}

export async function runRuntimeIntegrationAction(runtime: AgentRuntime, action: string, input: Record<string, unknown> = {}) {
  if (runtime === "openclaw" && action === "set-model") {
    const provider = String(input.provider ?? "").trim();
    const model = String(input.model ?? "").trim();
    if (!provider || !model) return { ok: false, error: "Provider and model are required." };
    await setOpenClawModel(provider, model);
    return { ok: true, message: `OpenClaw default model set to ${provider}/${model}.` };
  }
  if (runtime !== "hermes") {
    const adapter = getRuntimeAdapter(runtime);
    if (adapter?.runIntegrationAction) {
      return adapter.runIntegrationAction(undefined, action, input, {});
    }
    return { ok: false, error: `${runtime} does not expose this dashboard integration action yet.` };
  }
  if (action === "enable-tool") {
    const tool = String(input.tool ?? "");
    if (!["x_search", "video_gen"].includes(tool)) return { ok: false, error: "Unsupported Hermes tool." };
    await runHermes(["tools", "enable", tool], 20_000);
    return { ok: true, message: `Enabled Hermes ${tool}.` };
  }
  if (action === "disable-tool") {
    const tool = String(input.tool ?? "");
    if (!["x_search", "video_gen"].includes(tool)) return { ok: false, error: "Unsupported Hermes tool." };
    await runHermes(["tools", "disable", tool], 20_000);
    return { ok: true, message: `Disabled Hermes ${tool}.` };
  }
  if (action === "xai-login") {
    const child = spawn("hermes", ["login", "--provider", "xai-oauth"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
    return { ok: true, message: "Started Hermes xAI OAuth login in a separate process." };
  }
  if (action === "hermes-update") {
    const output = await runHermes(["update"], 300_000);
    return { ok: true, message: "Hermes update completed.", output };
  }
  if (action === "set-model") {
    const provider = String(input.provider ?? "").trim();
    const model = String(input.model ?? "").trim();
    if (!provider || !model) return { ok: false, error: "Provider and model are required." };
    await setHermesModel(provider, model);
    return { ok: true, message: `Hermes default model set to ${provider}/${model}.` };
  }
  if (action === "provider-setup-options") {
    const providers = await getHermesProviderSetupOptions();
    return { ok: true, providers };
  }
  if (action === "add-provider") {
    const provider = String(input.provider ?? "").trim();
    const model = String(input.model ?? "").trim();
    if (!provider || !model) return { ok: false, error: "Provider and model are required." };
    await addHermesProvider(provider, model);
    return { ok: true, provider, model, message: `Added Hermes provider ${provider} with ${model}.` };
  }
  if (action === "add-model") {
    const provider = String(input.provider ?? "").trim();
    const model = String(input.model ?? "").trim();
    const contextLength = Number(input.contextLength ?? 0);
    if (!provider || !model) return { ok: false, error: "Provider and model are required." };
    await addHermesModel(provider, model, Number.isFinite(contextLength) && contextLength > 0 ? contextLength : undefined);
    return { ok: true, message: `Added ${model} to Hermes provider ${provider}.` };
  }
  if (action === "background") {
    const prompt = String(input.prompt ?? "").trim();
    if (!prompt) return { ok: false, error: "Background prompt is required." };
    const id = `hermes-${Date.now().toString(36)}`;
    const logPath = join(RUN_LOG_ROOT, `${id}.log`);
    await mkdir(dirname(logPath), { recursive: true });
    const child = spawn("hermes", ["-z", prompt], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    const write = (chunk: Buffer) => void writeFile(logPath, chunk.toString(), { flag: "a" }).catch(() => undefined);
    child.stdout.on("data", write);
    child.stderr.on("data", write);
    child.unref();
    return { ok: true, id, logPath, message: "Started Hermes background task." };
  }
  if (action === "kanban-decompose") {
    const taskId = String(input.taskId ?? "").trim();
    const args = ["kanban", "decompose", "--json"];
    if (taskId) args.push(taskId);
    else args.push("--all");
    const output = await runHermes(args, 120_000);
    return { ok: true, output };
  }
  return { ok: false, error: `Unsupported Hermes action: ${action}` };
}

function integrationDefaults(capabilities: RuntimeCapabilities, overrides: Partial<Record<RuntimeIntegrationKey, string>> = {}) {
  const keys: RuntimeIntegrationKey[] = ["sessionSearch", "backgroundTasks", "xSearch", "socialPosting", "videoGeneration", "codexRuntime", "kanbanDecompose"];
  return Object.fromEntries(keys.map((key) => [
    key,
    {
      supported: Boolean(capabilities[key]),
      enabled: Boolean(capabilities[key]),
      detail: overrides[key] ?? (capabilities[key] ? "Supported by this runtime adapter." : "Not exposed by this runtime adapter."),
    },
  ])) as RuntimeIntegrationStatus["integrations"];
}

async function searchHermesSessions(query: string, limit: number) {
  if (!existsSync(HERMES_DB)) return [];
  const q = query.trim();
  const pattern = `%${q.replace(/'/g, "''")}%`;
  const sql = `
    select id, source, model, title, started_at, coalesce(ended_at, started_at) as updated_at, system_prompt
    from sessions
    ${q ? `where lower(coalesce(title, '') || ' ' || coalesce(system_prompt, '') || ' ' || id) like lower('${pattern}')` : ""}
    order by started_at desc
    limit ${Math.max(1, Math.min(100, limit))};
  `;
  const { stdout } = await execFileAsync("sqlite3", ["-json", HERMES_DB, sql], { timeout: 5_000, maxBuffer: 2_000_000 });
  const rows = JSON.parse(stdout || "[]") as HermesSessionRow[];
  return mergeRuntimeSessions({
    secondary: rows.map((row) => ({
      id: row.id,
      title: row.title || row.id,
      preview: previewSessionText(row.system_prompt),
      lastActive: toIso(row.updated_at || row.started_at),
      messageCount: 0,
      source: row.source,
      sortTimestamp: Number(row.updated_at || row.started_at || 0),
    })),
  }).map((session) => {
    const row = rows.find((item) => item.id === session.id)!;
    return {
    id: row.id,
    runtime: "hermes" as const,
    title: String(session.title || row.id),
    source: row.source,
    model: row.model,
    startedAt: toIso(row.started_at),
    updatedAt: toIso(row.updated_at || row.started_at),
    excerpt: String(session.preview || row.system_prompt || "").replace(/\s+/g, " ").slice(0, 280),
    };
  });
}

async function getHermesModelSelection(): Promise<RuntimeModelSelection | undefined> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_AGENT_DIR)) return undefined;
  const script = `
import json
from hermes_cli.config import load_config
from hermes_cli.inventory import build_models_payload, load_picker_context
cfg = load_config()
payload = build_models_payload(load_picker_context(), max_models=200)
configured = {}
model_cfg = cfg.get("model", {})
if isinstance(model_cfg, dict) and model_cfg.get("provider") and model_cfg.get("default"):
    configured[model_cfg.get("provider")] = True
providers = cfg.get("providers", {})
if isinstance(providers, dict):
    for slug, provider_cfg in providers.items():
        if not isinstance(provider_cfg, dict):
            continue
        models = provider_cfg.get("models")
        has_models = (
            bool(models)
            if isinstance(models, (list, dict))
            else bool(provider_cfg.get("model") or provider_cfg.get("default_model"))
        )
        if has_models:
            configured[slug] = True
payload["configured_providers"] = sorted(configured.keys())
print(json.dumps(payload))
`;
  const { stdout } = await execFileAsync(HERMES_PYTHON, ["-c", script], {
    cwd: HERMES_AGENT_DIR,
    env: { ...process.env, PYTHONPATH: HERMES_AGENT_DIR },
    timeout: 20_000,
    maxBuffer: 5_000_000,
  });
  const payload = JSON.parse(stdout || "{}") as {
    provider?: string;
    model?: string;
    configured_providers?: string[];
    providers?: Array<{
      slug?: string;
      name?: string;
      models?: Array<string | { id?: string; name?: string }>;
      total_models?: number;
      totalModels?: number;
      is_current?: boolean;
      is_user_defined?: boolean;
      source?: string;
    }>;
  };
  const configuredProviders = new Set(payload.configured_providers ?? []);
  return {
    provider: payload.provider ?? "",
    model: payload.model ?? "",
    providers: (payload.providers ?? [])
      .filter((provider) => provider.slug && configuredProviders.has(provider.slug))
      .map((provider) => ({
        slug: provider.slug ?? "",
        name: provider.name || provider.slug || "Provider",
        models: (provider.models ?? []).map((model) => (
          typeof model === "string" ? { id: model } : { id: model.id ?? "", name: model.name }
        )).filter((model) => model.id),
        totalModels: provider.total_models ?? provider.totalModels ?? provider.models?.length ?? 0,
        isCurrent: provider.is_current,
        isUserDefined: provider.is_user_defined,
        source: provider.source,
      })),
  };
}

async function setHermesModel(provider: string, model: string) {
  const script = `
from hermes_cli.config import load_config, save_config
provider = __PROVIDER__
model = __MODEL__
cfg = load_config()
model_cfg = cfg.get("model", {})
if not isinstance(model_cfg, dict):
    model_cfg = {}
model_cfg["provider"] = provider
model_cfg["default"] = model
model_cfg.pop("context_length", None)
if model_cfg.get("base_url"):
    model_cfg["base_url"] = ""
cfg["model"] = model_cfg
save_config(cfg)
`;
  await runHermesPython(script, { __PROVIDER__: provider, __MODEL__: model });
}

async function setOpenClawModel(provider: string, model: string) {
  const raw = await readFile(OPENCLAW_CONFIG, "utf8").catch(() => "{}");
  const config = parseJsonObject(raw.replace(/\/\/[^\n]*/g, "")) ?? {};
  const fullModel = `${provider}/${model}`;
  const agents = isRecord(config.agents) ? config.agents : {};
  const list = Array.isArray(agents.list) ? agents.list.filter(isRecord) : [];
  const agent = list.find((item) => item.default === true) ?? list[0];
  if (agent) agent.model = fullModel;
  if (!isRecord(config.agents)) config.agents = agents;
  if (!Array.isArray(agents.list)) agents.list = list;
  setNested(config, "agents.defaults.model.primary", fullModel);
  await mkdir(dirname(OPENCLAW_CONFIG), { recursive: true, mode: 0o700 });
  await writeFile(OPENCLAW_CONFIG, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function setNested(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(current[part])) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

async function addHermesModel(provider: string, model: string, contextLength?: number) {
  const script = `
from hermes_cli.config import load_config, save_config
provider = __PROVIDER__
model = __MODEL__
context_length = __CONTEXT_LENGTH__
cfg = load_config()
providers = cfg.get("providers")
if not isinstance(providers, dict):
    providers = {}
entry = providers.get(provider)
if not isinstance(entry, dict):
    entry = {"name": provider, "models": {}}
models = entry.get("models")
if isinstance(models, list):
    if model not in models:
        models.append(model)
elif isinstance(models, dict):
    meta = models.get(model)
    if not isinstance(meta, dict):
        meta = {}
    if context_length:
        meta["context_length"] = context_length
    models[model] = meta
else:
    models = {model: {"context_length": context_length} if context_length else {}}
entry["models"] = models
entry.setdefault("default_model", model)
providers[provider] = entry
cfg["providers"] = providers
save_config(cfg)
`;
  await runHermesPython(script, {
    __PROVIDER__: provider,
    __MODEL__: model,
    __CONTEXT_LENGTH__: contextLength ?? 0,
  });
}

async function getHermesProviderSetupOptions() {
  const script = `
import json
from hermes_cli.inventory import build_models_payload, load_picker_context
payload = build_models_payload(
    load_picker_context(),
    include_unconfigured=True,
    picker_hints=True,
    canonical_order=True,
    max_models=24,
)
print(json.dumps(payload.get("providers", [])))
`;
  const stdout = await runHermesPython(script, {});
  const rows = JSON.parse(stdout || "[]") as Array<{
    slug?: string;
    name?: string;
    models?: Array<string | { id?: string; name?: string }>;
    total_models?: number;
    totalModels?: number;
    authenticated?: boolean;
    auth_type?: string;
    key_env?: string;
    warning?: string;
  }>;
  return rows
    .filter((provider) => provider.slug)
    .map((provider) => ({
      slug: provider.slug ?? "",
      name: provider.name || provider.slug || "Provider",
      models: (provider.models ?? []).map((model) => (
        typeof model === "string" ? { id: model } : { id: model.id ?? "", name: model.name }
      )).filter((model) => model.id),
      totalModels: provider.total_models ?? provider.totalModels ?? provider.models?.length ?? 0,
      authenticated: provider.authenticated,
      authType: provider.auth_type,
      keyEnv: provider.key_env,
      warning: provider.warning,
    }));
}

async function addHermesProvider(provider: string, model: string) {
  const script = `
from hermes_cli.config import load_config, save_config
from hermes_cli.models import provider_model_ids
try:
    from hermes_cli.auth import PROVIDER_REGISTRY
except Exception:
    PROVIDER_REGISTRY = {}
provider = __PROVIDER__
model = __MODEL__
provider_defaults = {
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "models": provider_model_ids("openrouter")[:24],
    },
}
cfg_def = PROVIDER_REGISTRY.get(provider)
if cfg_def:
    key_envs = list(getattr(cfg_def, "api_key_env_vars", ()) or ())
    defaults = {
        "name": getattr(cfg_def, "name", provider),
        "base_url": getattr(cfg_def, "inference_base_url", "") or "",
        "key_env": key_envs[0] if key_envs else "",
        "models": provider_model_ids(provider)[:24],
    }
else:
    defaults = provider_defaults.get(provider, {"name": provider, "base_url": "", "key_env": "", "models": [model]})
models = list(dict.fromkeys([model] + [item for item in defaults.get("models", []) if item]))
cfg = load_config()
providers = cfg.get("providers")
if not isinstance(providers, dict):
    providers = {}
entry = providers.get(provider)
if not isinstance(entry, dict):
    entry = {}
entry["name"] = entry.get("name") or defaults.get("name") or provider
if defaults.get("base_url") and not entry.get("base_url"):
    entry["base_url"] = defaults["base_url"]
if defaults.get("key_env") and not entry.get("key_env"):
    entry["key_env"] = defaults["key_env"]
entry["default_model"] = model
current_models = entry.get("models")
if isinstance(current_models, dict):
    for item in models:
        current_models.setdefault(item, {})
elif isinstance(current_models, list):
    current_models = list(dict.fromkeys(current_models + models))
else:
    current_models = {item: {} for item in models}
entry["models"] = current_models
providers[provider] = entry
cfg["providers"] = providers
save_config(cfg)
`;
  await runHermesPython(script, { __PROVIDER__: provider, __MODEL__: model });
}

async function loadHiveEnv() {
  const raw = await readFile(HIVE_ENV, "utf8").catch(() => "");
  const values: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    value = value.replaceAll("\0", "");
    if (value) values[key] = value;
  }
  return { ...values, ...process.env };
}

async function hermesProcessEnv() {
  return {
    ...await loadHiveEnv(),
    PYTHONPATH: HERMES_AGENT_DIR,
  };
}

async function runHermesPython(script: string, values: Record<string, string | number>) {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_AGENT_DIR)) throw new Error("Hermes Python runtime was not found.");
  let rendered = script;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(key, JSON.stringify(value));
  }
  const { stdout } = await execFileAsync(HERMES_PYTHON, ["-c", rendered], {
    cwd: HERMES_AGENT_DIR,
    env: await hermesProcessEnv(),
    timeout: 20_000,
    maxBuffer: 2_000_000,
  });
  return stdout.trim();
}

async function searchOpenClawSessions(query: string, limit: number) {
  const agents = await readdir(OPENCLAW_AGENTS, { withFileTypes: true }).catch(() => []);
  const q = query.trim().toLowerCase();
  const results: RuntimeSessionSearchResult[] = [];
  for (const agent of agents) {
    if (!agent.isDirectory()) continue;
    const sessionsDir = join(OPENCLAW_AGENTS, agent.name, "sessions");
    const files = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !/\.(json|jsonl)$/i.test(file.name)) continue;
      const path = join(sessionsDir, file.name);
      const raw = await readFile(path, "utf8").catch(() => "");
      const text = raw.replace(/\s+/g, " ");
      if (q && !text.toLowerCase().includes(q) && !file.name.toLowerCase().includes(q)) continue;
      results.push({
        id: `${agent.name}:${file.name.replace(/\.(json|jsonl)$/i, "")}`,
        runtime: "openclaw",
        title: `${agent.name} / ${file.name}`,
        source: agent.name,
        excerpt: text.slice(0, 280),
        path,
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

async function runHermes(args: string[], timeout = 10_000) {
  const { stdout, stderr } = await execFileAsync("hermes", args, {
    timeout,
    maxBuffer: 2_000_000,
    env: await loadHiveEnv(),
  });
  return `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
}

function toIso(seconds: number | null | undefined) {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
