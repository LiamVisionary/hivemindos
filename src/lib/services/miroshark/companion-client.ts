import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { homedir } from "@/lib/home-dir";
import path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { discoverMiroSharkHivenetService, type DiscoveredMiroSharkService } from "@/lib/services/miroshark/hivenet-discovery";

export type MiroSharkCompanionPhase =
  | "connected"
  | "starting"
  | "installing"
  | "installed-stopped"
  | "not-installed"
  | "needs-config"
  | "unreachable";

export type MiroSharkRequirement = {
  name: string;
  ok: boolean;
  detail: string;
};

export type MiroSharkAction = {
  id: "install" | "start" | "open" | "configure-admin";
  label: string;
  disabled?: boolean;
};

export type MiroSharkInstallState = {
  running: boolean;
  phase?: string;
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number | null;
  logPath: string;
  message?: string;
};

export type MiroSharkCompanionStatus = {
  configured: boolean;
  ok: boolean;
  phase: MiroSharkCompanionPhase;
  baseUrl: string;
  hivenetApp?: {
    id?: string;
    name?: string;
    machineName?: string;
    machineHost?: string;
    healthUrl: string;
  };
  service?: string;
  status?: string;
  installPath?: string;
  installSource?: "env" | "openclaw" | "codex-cache" | "workspace" | "home";
  apiDocsUrl?: string;
  templatesUrl?: string;
  simulationsUrl?: string;
  checkedAt: number;
  latencyMs?: number;
  error?: string;
  requirements: MiroSharkRequirement[];
  install: MiroSharkInstallState;
  adminAuth: {
    configured: boolean;
    source?: "environment" | "miroshark-env";
    hint: string;
  };
  actions: MiroSharkAction[];
  startCommand?: string;
  installCommand?: string;
  configHint?: string;
  endpoints: {
    health: string;
    openapi: string;
    templates: string;
    simulations: string;
    createSimulation: string;
  };
};

const DEFAULT_MIROSHARK_BASE_URL = "http://127.0.0.1:5001";
const OPENCLAW_MIROSHARK_DIR = path.join(homedir(), ".openclaw", "companions", "MiroShark");
const CODEX_CACHED_MIROSHARK_DIR = path.join(homedir(), ".codex", "github-assimilator", "candidates", "aaronjmars-MiroShark");
const SETUP_STATE_PATH = "/tmp/openclaw-miroshark-setup.json";
const SETUP_LOG_PATH = "/tmp/openclaw-miroshark-setup.log";
const BOOTSTRAP_ENV_PATH = "/tmp/openclaw-miroshark.env";
const SCREEN_SESSION_NAME = "miroshark-5101";
const DEFAULT_MANAGED_PORT = "5101";
const REQUIREMENTS_CACHE_MS = 120_000;
const execFileAsync = promisify(execFile);
let cachedRequirements: {
  key: string;
  checkedAt: number;
  requirements: MiroSharkRequirement[];
} | null = null;

// Adapted from MiroShark's documented Flask defaults and HTTP API paths.
const MIROSHARK_ENDPOINTS = {
  health: "/health",
  openapi: "/api/openapi.yaml",
  templates: "/api/templates/list",
  simulations: "/api/simulation/list",
  createSimulation: "/api/simulation/create",
} as const;

function normalizeBaseUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_MIROSHARK_BASE_URL;
  return trimmed.replace(/\/+$/, "");
}

function buildUrl(baseUrl: string, path: string) {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function expandHome(value: string) {
  return value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value;
}

function uniquePaths(paths: string[]) {
  return [...new Set(paths.filter(Boolean).map(expandHome))];
}

function backendDir(installPath: string) {
  return path.join(installPath, "backend");
}

function isMiroSharkInstall(installPath: string) {
  return existsSync(path.join(backendDir(installPath), "run.py"))
    && existsSync(path.join(backendDir(installPath), "pyproject.toml"));
}

function discoverInstall() {
  const candidates = uniquePaths([
    process.env.MIROSHARK_HOME ?? "",
    OPENCLAW_MIROSHARK_DIR,
    CODEX_CACHED_MIROSHARK_DIR,
    path.join(process.cwd(), "MiroShark"),
    path.join(homedir(), "MiroShark"),
  ]);
  const found = candidates.find(isMiroSharkInstall);
  if (!found) return {};
  const source = found === process.env.MIROSHARK_HOME
    ? "env"
    : found === OPENCLAW_MIROSHARK_DIR
      ? "openclaw"
      : found === CODEX_CACHED_MIROSHARK_DIR
        ? "codex-cache"
        : found.startsWith(process.cwd())
          ? "workspace"
          : "home";
  return { installPath: found, installSource: source as MiroSharkCompanionStatus["installSource"] };
}

async function commandExists(command: string) {
  const { stdout } = await execFileAsync("zsh", ["-lc", `command -v ${command}`], {
    timeout: 2_000,
    maxBuffer: 20_000,
  }).catch(() => ({ stdout: "" }));
  return stdout.trim();
}

async function getRequirements(installPath?: string): Promise<MiroSharkRequirement[]> {
  const key = installPath ?? "";
  const now = Date.now();
  if (cachedRequirements && cachedRequirements.key === key && now - cachedRequirements.checkedAt < REQUIREMENTS_CACHE_MS) {
    return cachedRequirements.requirements;
  }
  const [git, uv, docker, screen, python311] = await Promise.all([
    commandExists("git"),
    commandExists("uv"),
    commandExists("docker"),
    commandExists("screen"),
    commandExists("python3.11"),
  ]);
  const requirements = [
    { name: "git", ok: Boolean(git), detail: git || "Required to clone MiroShark" },
    { name: "uv", ok: Boolean(uv), detail: uv || "Required to install the Python backend" },
    { name: "docker", ok: Boolean(docker), detail: docker || "Required for the managed Neo4j container" },
    { name: "screen", ok: Boolean(screen), detail: screen || "Required to keep MiroShark running after start" },
    { name: "python3.11", ok: Boolean(python311), detail: python311 || "Required by the tested MiroShark backend setup" },
    {
      name: "MiroShark .env",
      ok: Boolean(installPath && existsSync(path.join(installPath, ".env"))),
      detail: installPath ? path.join(installPath, ".env") : "Created automatically when an API key is available",
    },
  ];
  cachedRequirements = { key, checkedAt: now, requirements };
  return requirements;
}

function getInstallState(): MiroSharkInstallState {
  const fallback = { running: false, logPath: SETUP_LOG_PATH };
  if (!existsSync(SETUP_STATE_PATH)) return fallback;
  try {
    return { ...fallback, ...JSON.parse(readFileSync(SETUP_STATE_PATH, "utf8")) };
  } catch {
    return fallback;
  }
}

function writeInstallState(state: Partial<MiroSharkInstallState>) {
  writeFileSync(SETUP_STATE_PATH, JSON.stringify({
    ...getInstallState(),
    ...state,
    logPath: SETUP_LOG_PATH,
  }, null, 2));
}

function preferredApiKey() {
  return process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "";
}

function parseEnvValue(raw: string, key: string) {
  const line = raw.split(/\r?\n/).find((item) => item.trim().startsWith(`${key}=`));
  if (!line) return "";
  return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
}

function upsertEnvValue(raw: string, key: string, value: string) {
  const lines = raw.split(/\r?\n/);
  let updated = false;
  const next = lines.map((line) => {
    if (!line.trim().startsWith(`${key}=`)) return line;
    updated = true;
    return `${key}=${value}`;
  });
  if (!updated) next.push(`${key}=${value}`);
  return `${next.join("\n").replace(/\n*$/, "")}\n`;
}

function upsertEnvValueIfMissing(raw: string, key: string, value: string) {
  const current = parseEnvValue(raw, key);
  if (current || !value) return raw;
  return upsertEnvValue(raw, key, value);
}

function managedEnvValues() {
  const apiKey = preferredApiKey();
  if (!apiKey) return [];
  const openRouter = Boolean(process.env.OPENROUTER_API_KEY);
  const baseUrl = openRouter ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1";
  const embeddingBaseUrl = openRouter ? "https://openrouter.ai/api" : "https://api.openai.com/v1";
  const model = openRouter ? "openai/gpt-4o-mini" : (process.env.OPENAI_MODEL || "gpt-4o-mini");
  const internalKeyEnv: [string, string][] = process.env.MIROSHARK_INTERNAL_KEY
    ? [["MIROSHARK_INTERNAL_KEY", process.env.MIROSHARK_INTERNAL_KEY]]
    : [];
  return [
    ["FLASK_HOST", "127.0.0.1"],
    ["FLASK_PORT", DEFAULT_MANAGED_PORT],
    ["FLASK_DEBUG", "True"],
    ["LLM_API_KEY", apiKey],
    ["LLM_BASE_URL", baseUrl],
    ["LLM_MODEL_NAME", model],
    ["SMART_PROVIDER", "openai"],
    ["SMART_API_KEY", apiKey],
    ["SMART_BASE_URL", baseUrl],
    ["SMART_MODEL_NAME", model],
    ["NER_API_KEY", apiKey],
    ["NER_BASE_URL", baseUrl],
    ["NER_MODEL_NAME", model],
    ["WONDERWALL_API_KEY", apiKey],
    ["WONDERWALL_BASE_URL", baseUrl],
    ["WONDERWALL_MODEL_NAME", model],
    ["OPENAI_API_KEY", apiKey],
    ["EMBEDDING_PROVIDER", "openai"],
    ["EMBEDDING_API_KEY", apiKey],
    ["EMBEDDING_BASE_URL", embeddingBaseUrl],
    ["EMBEDDING_MODEL", "openai/text-embedding-3-small"],
    ["EMBEDDING_DIMENSIONS", "768"],
    ["NEO4J_URI", "bolt://localhost:7687"],
    ["NEO4J_USER", "neo4j"],
    ["NEO4J_PASSWORD", "miroshark"],
    ["WEB_ENRICHMENT_ENABLED", "false"],
    ["RERANKER_ENABLED", "false"],
    ["GRAPH_SEARCH_ENABLED", "false"],
    ...internalKeyEnv,
  ] satisfies [string, string][];
}

function adminTokenFromEnvFile(installPath?: string) {
  if (!installPath) return "";
  const envPath = path.join(installPath, ".env");
  if (!existsSync(envPath)) return "";
  return parseEnvValue(readFileSync(envPath, "utf8"), "MIROSHARK_ADMIN_TOKEN");
}

export function getMiroSharkAdminToken(installPath?: string) {
  return (process.env.MIROSHARK_ADMIN_TOKEN || adminTokenFromEnvFile(installPath || discoverInstall().installPath)).trim();
}

function getAdminAuthStatus(installPath?: string): MiroSharkCompanionStatus["adminAuth"] {
  if (process.env.MIROSHARK_ADMIN_TOKEN?.trim()) {
    return {
      configured: true,
      source: "environment",
      hint: "Publish/export auth is configured in the local HivemindOS runtime environment.",
    };
  }
  if (adminTokenFromEnvFile(installPath)) {
    return {
      configured: true,
      source: "miroshark-env",
      hint: "Publish/export auth is configured in MiroShark's .env.",
    };
  }
  return {
    configured: false,
    hint: "Publish/export requires MIROSHARK_ADMIN_TOKEN. HivemindOS can write it to MiroShark's .env, restart MiroShark, and keep using it from the local file.",
  };
}

function writeManagedEnv(installPath: string) {
  const envPath = path.join(installPath, ".env");
  const values = managedEnvValues();
  if (values.length === 0) return;
  let raw = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [key, value] of values) {
    raw = upsertEnvValueIfMissing(raw, key, value);
  }
  writeFileSync(envPath, raw.replace(/\n*$/, "\n"), { mode: 0o600 });
}

export function configureMiroSharkAdminAuth() {
  const discovered = discoverInstall();
  if (!discovered.installPath) {
    throw new Error("MiroShark is not installed yet");
  }

  writeManagedEnv(discovered.installPath);
  const envPath = path.join(discovered.installPath, ".env");
  const raw = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const token = parseEnvValue(raw, "MIROSHARK_ADMIN_TOKEN") || randomBytes(32).toString("base64url");
  writeFileSync(envPath, upsertEnvValue(raw, "MIROSHARK_ADMIN_TOKEN", token), { mode: 0o600 });
  return startMiroSharkSetup("start");
}

function writeBootstrapEnv() {
  const values = managedEnvValues();
  if (values.length === 0) return;
  writeFileSync(BOOTSTRAP_ENV_PATH, `${values.map(([key, value]) => `${key}=${value}`).join("\n")}\n`, { mode: 0o600 });
}

function managedStartCommand(installPath: string) {
  return `cd ${backendDir(installPath)} && nohup .venv/bin/python run.py >/tmp/miroshark-5101.out 2>/tmp/miroshark-5101.err &`;
}

export function startMiroSharkSetup(action: "install" | "start") {
  const current = getInstallState();
  if (current.running) return current;

  const discovered = discoverInstall();
  const installPath = discovered.installPath ?? OPENCLAW_MIROSHARK_DIR;
  mkdirSync(path.dirname(installPath), { recursive: true });
  if (discovered.installPath) writeManagedEnv(discovered.installPath);
  else writeBootstrapEnv();

  const script = `
set -euo pipefail
echo "[$(date)] ${action} requested"
if [ ! -d "${installPath}/.git" ] && [ ! -f "${installPath}/backend/run.py" ]; then
  echo "Cloning MiroShark into ${installPath}"
  git clone https://github.com/aaronjmars/MiroShark "${installPath}"
fi
cd "${installPath}"
if [ ! -f .env ] && [ -f "${BOOTSTRAP_ENV_PATH}" ]; then
  cp "${BOOTSTRAP_ENV_PATH}" .env
  chmod 600 .env
fi
if [ ! -f .env ]; then
  echo "No .env found. HivemindOS will create it if an API key is available in its environment."
fi
cd backend
if command -v docker >/dev/null 2>&1; then
  if docker ps -a --format '{{.Names}}' | grep -qx miroshark-neo4j-e2e; then
    docker start miroshark-neo4j-e2e >/dev/null || true
  else
    docker run -d --name miroshark-neo4j-e2e -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/miroshark neo4j:5.26-community >/dev/null
  fi
fi
UV_PYTHON=python3.11 uv sync
screen -S ${SCREEN_SESSION_NAME} -X quit >/dev/null 2>&1 || true
if command -v lsof >/dev/null 2>&1; then
  existing_pids=$(lsof -tiTCP:${DEFAULT_MANAGED_PORT} -sTCP:LISTEN || true)
  if [ -n "$existing_pids" ]; then
    echo "Stopping existing MiroShark listener(s) on ${DEFAULT_MANAGED_PORT}: $existing_pids"
    kill $existing_pids >/dev/null 2>&1 || true
    sleep 1
  fi
fi
cd "${backendDir(installPath)}"
nohup .venv/bin/python run.py >/tmp/miroshark-5101.out 2>/tmp/miroshark-5101.err &
echo $! >/tmp/miroshark-5101.pid
echo "[$(date)] MiroShark started at http://127.0.0.1:${DEFAULT_MANAGED_PORT}"
`;

  writeInstallState({ running: true, phase: action, startedAt: Date.now(), finishedAt: undefined, exitCode: undefined, message: "Working..." });
  const child = spawn("zsh", ["-lc", script], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const append = (chunk: Buffer) => writeFileSync(SETUP_LOG_PATH, chunk.toString("utf8"), { flag: "a" });
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("exit", (code) => {
    writeInstallState({
      running: false,
      phase: action,
      finishedAt: Date.now(),
      exitCode: code,
      message: code === 0 ? "MiroShark is installed and starting." : `Setup exited with code ${code}`,
    });
  });
  child.unref();
  return getInstallState();
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 3_500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const startedAt = Date.now();
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { response, payload, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

type MiroSharkStatusOptions = {
  requestUrl?: string;
};

function statusOptions(input?: string | MiroSharkStatusOptions): MiroSharkStatusOptions {
  return typeof input === "string" ? { requestUrl: input } : input ?? {};
}

function hivenetStatusApp(discovered?: DiscoveredMiroSharkService | null): MiroSharkCompanionStatus["hivenetApp"] {
  if (!discovered) return undefined;
  return {
    id: discovered.app.id,
    name: discovered.app.name,
    machineName: discovered.app.machineName,
    machineHost: discovered.app.machineHost,
    healthUrl: discovered.healthUrl,
  };
}

export async function getMiroSharkCompanionStatus(input?: string | MiroSharkStatusOptions): Promise<MiroSharkCompanionStatus> {
  const options = statusOptions(input);
  const discoveredService = await discoverMiroSharkHivenetService(options.requestUrl).catch(() => null);
  const envBaseUrl = process.env.MIROSHARK_BASE_URL || process.env.NEXT_PUBLIC_MIROSHARK_BASE_URL;
  const rawBaseUrl = discoveredService?.baseUrl || envBaseUrl;
  const discovered = discoverInstall();
  const setup = getInstallState();
  const baseUrl = normalizeBaseUrl(rawBaseUrl || (discovered.installPath ? `http://127.0.0.1:${DEFAULT_MANAGED_PORT}` : undefined));
  const configured = Boolean(rawBaseUrl?.trim() || discoveredService);
  const requirements = await getRequirements(discovered.installPath);
  const adminAuth = getAdminAuthStatus(discovered.installPath);
  const hasKey = Boolean(preferredApiKey() || (discovered.installPath && existsSync(path.join(discovered.installPath, ".env"))));
  const endpoints = {
    health: buildUrl(baseUrl, MIROSHARK_ENDPOINTS.health),
    openapi: buildUrl(baseUrl, MIROSHARK_ENDPOINTS.openapi),
    templates: buildUrl(baseUrl, MIROSHARK_ENDPOINTS.templates),
    simulations: buildUrl(baseUrl, MIROSHARK_ENDPOINTS.simulations),
    createSimulation: buildUrl(baseUrl, MIROSHARK_ENDPOINTS.createSimulation),
  };

  try {
    const { response, payload, latencyMs } = await fetchJsonWithTimeout(endpoints.health);
    const service = typeof payload?.service === "string" ? payload.service : undefined;
    const status = typeof payload?.status === "string" ? payload.status : undefined;
    const serviceLooksRight = /miroshark/i.test(service ?? "");
    const healthOk = response.ok && status === "ok" && serviceLooksRight;
    let apiReady = healthOk;
    let apiError = "";
    if (healthOk) {
      try {
        const apiCheck = await fetchJsonWithTimeout(endpoints.templates);
        apiReady = apiCheck.response.ok;
        const checkError = typeof apiCheck.payload?.error === "string" ? apiCheck.payload.error : "";
        apiError = apiReady ? "" : checkError || `Templates endpoint returned HTTP ${apiCheck.response.status}`;
      } catch (error) {
        apiReady = false;
        apiError = error instanceof Error ? error.message : "Templates endpoint is unreachable";
      }
    }
    const ok = healthOk && apiReady;

    return {
      configured,
      ok,
      phase: ok ? "connected" : healthOk ? "needs-config" : setup.running ? "starting" : discovered.installPath ? "installed-stopped" : "not-installed",
      baseUrl,
      hivenetApp: hivenetStatusApp(discoveredService),
      service,
      status,
      installPath: discovered.installPath,
      installSource: discovered.installSource,
      apiDocsUrl: buildUrl(baseUrl, "/api/docs"),
      templatesUrl: endpoints.templates,
      simulationsUrl: endpoints.simulations,
      checkedAt: Date.now(),
      latencyMs,
      requirements,
      install: setup,
      adminAuth,
      actions: ok
        ? [
          { id: "open", label: "API Docs" },
          ...(adminAuth.configured ? [] : [{ id: "configure-admin" as const, label: "Configure publish auth", disabled: setup.running }]),
        ]
        : discovered.installPath
          ? [{ id: "start", label: setup.running ? "Starting..." : "Start MiroShark", disabled: setup.running || !hasKey }]
          : [{ id: "install", label: setup.running ? "Installing..." : "Install & start", disabled: setup.running || !requirements.every((item) => item.name === "MiroShark .env" || item.ok) || !hasKey }],
      startCommand: discovered.installPath ? managedStartCommand(discovered.installPath) : undefined,
      installCommand: `git clone https://github.com/aaronjmars/MiroShark ${OPENCLAW_MIROSHARK_DIR}`,
      configHint: hasKey ? undefined : "Add OPENROUTER_API_KEY or OPENAI_API_KEY to the HivemindOS runtime environment so setup can write MiroShark's .env automatically.",
      endpoints,
      error: ok
        ? undefined
        : healthOk && apiError
          ? `MiroShark health is OK, but the API is not ready: ${apiError}`
        : service && !serviceLooksRight
          ? `Port responded as ${service}, not MiroShark`
          : `Unexpected health response: HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      configured,
      ok: false,
      phase: setup.running ? "starting" : discovered.installPath ? "installed-stopped" : "not-installed",
      baseUrl,
      hivenetApp: hivenetStatusApp(discoveredService),
      installPath: discovered.installPath,
      installSource: discovered.installSource,
      checkedAt: Date.now(),
      requirements,
      install: setup,
      adminAuth,
      actions: discovered.installPath
        ? [{ id: "start", label: setup.running ? "Starting..." : "Start MiroShark", disabled: setup.running || !hasKey }]
        : [{ id: "install", label: setup.running ? "Installing..." : "Install & start", disabled: setup.running || !requirements.every((item) => item.name === "MiroShark .env" || item.ok) || !hasKey }],
      startCommand: discovered.installPath ? managedStartCommand(discovered.installPath) : undefined,
      installCommand: `git clone https://github.com/aaronjmars/MiroShark ${OPENCLAW_MIROSHARK_DIR}`,
      configHint: hasKey ? undefined : "Add OPENROUTER_API_KEY or OPENAI_API_KEY to the HivemindOS runtime environment so setup can write MiroShark's .env automatically.",
      endpoints,
      error: error instanceof Error ? error.message : "MiroShark companion is unreachable",
    };
  }
}
