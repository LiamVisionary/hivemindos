import { execFile } from "child_process";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { join, resolve } from "path";
import { promisify } from "util";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { RuntimeAdapter, RuntimeRun, RuntimeRunLog } from "./types";
import { runtimeInstallSpec } from "@/lib/services/runtime-install-catalog";

const execFileAsync = promisify(execFile);

// Evo (github.com/evo-hq/evo) is a benchmark-driven optimization orchestrator.
// All durable state lives in `<repo>/.evo/`: `meta.json` names the active run
// (e.g. run_0000) and orchestrator host, each run dir holds `config.json` and
// `graph.json` (the experiment tree), and a running web dashboard stamps its
// actual port into `.evo/dashboard.port`. The adapter reads those files
// directly instead of shelling out to the evo CLI per dashboard refresh.

type EvoMeta = {
  active?: string | null;
  host?: string;
};

type EvoConfig = {
  project_name?: string;
  target?: string;
  benchmark?: string;
  gate?: string | null;
  metric?: string;
  frontier_strategy?: string | Record<string, unknown>;
};

type EvoGraphNode = {
  id: string;
  parent?: string | null;
  status?: string;
  hypothesis?: string;
  created_at?: string;
  updated_at?: string;
  score?: number | null;
  branch?: string | null;
  commit?: string | null;
  pruned_reason?: string | null;
  gates?: unknown[];
};

type EvoGraph = {
  nodes?: Record<string, EvoGraphNode>;
};

function expandHome(path: string) {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function clean(value?: string) {
  return value?.trim() || "";
}

function evoBin() {
  const candidates = [
    process.env.EVO_BIN,
    join(homedir(), ".local", "bin", "evo"),
    "/opt/homebrew/bin/evo",
    "/usr/local/bin/evo",
  ].filter(Boolean) as string[];
  return candidates.find((path) => existsSync(path)) || "evo";
}

function evoWorkspaceRoot(profile?: AgentProfile) {
  const configured = clean(profile?.localDataDir) || clean(process.env.EVO_WORKSPACE_ROOT);
  return resolve(expandHome(configured || process.cwd()));
}

async function readJson<T>(path: string): Promise<T | null> {
  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function activeRunDir(root: string, meta: EvoMeta | null) {
  const evoDir = join(root, ".evo");
  return meta?.active ? join(evoDir, meta.active) : evoDir;
}

async function dashboardUrl(root: string) {
  const raw = await readFile(join(root, ".evo", "dashboard.port"), "utf8").catch(() => "");
  const port = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(port) || port <= 0) return undefined;
  const url = `http://127.0.0.1:${port}`;
  const reachable = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(1_500),
  }).then((response) => response.ok).catch(() => false);
  return reachable ? url : undefined;
}

function runStatus(status?: string): RuntimeRun["status"] {
  if (status === "pending") return "queued";
  if (status === "active") return "active";
  if (status === "committed") return "completed";
  if (status === "pruned" || status === "discarded" || status === "failed") return "failed";
  return "unknown";
}

async function loadActiveGraph(profile?: AgentProfile) {
  const root = evoWorkspaceRoot(profile);
  const meta = await readJson<EvoMeta>(join(root, ".evo", "meta.json"));
  const runDir = activeRunDir(root, meta);
  const graph = await readJson<EvoGraph>(join(runDir, "graph.json"));
  return { root, meta, runDir, graph };
}

function experimentNodes(graph: EvoGraph | null) {
  return Object.values(graph?.nodes ?? {}).filter((node) => node.id !== "root");
}

function nodeToRun(node: EvoGraphNode, runName: string): RuntimeRun {
  const score = typeof node.score === "number" ? ` · score ${node.score}` : "";
  return {
    id: node.id,
    runtime: "evo",
    name: `${runName}/${node.id}: ${node.hypothesis || "experiment"}${score}`,
    status: runStatus(node.status),
    createdAt: node.created_at,
    updatedAt: node.updated_at,
    conclusion: node.pruned_reason || node.status || null,
  };
}

export const evoAdapter: RuntimeAdapter = {
  runtime: "evo",
  label: "Evo",
  kind: "background",
  capabilities: {
    status: true,
    runs: true,
    backgroundTasks: true,
  },
  defaultProfile: {},
  async getStatus(profile) {
    const [{ root, meta, graph }, cli] = await Promise.all([
      loadActiveGraph(profile),
      execFileAsync(evoBin(), ["--version"], { timeout: 3_000, maxBuffer: 200_000 }).catch(() => null),
    ]);
    const config = await readJson<EvoConfig>(join(activeRunDir(root, meta), "config.json"));
    const nodes = experimentNodes(graph);
    const scores = nodes.map((node) => node.score).filter((score): score is number => typeof score === "number");
    return {
      ok: Boolean(cli),
      runtime: "evo",
      kind: "background",
      cliVersion: cli?.stdout.trim().split(/\r?\n/)[0] || undefined,
      workspaceRoot: root,
      hasWorkspace: Boolean(meta || config),
      activeRun: meta?.active ?? null,
      orchestratorHost: meta?.host ?? null,
      projectName: config?.project_name,
      target: config?.target,
      benchmark: config?.benchmark,
      gate: config?.gate ?? null,
      metric: config?.metric,
      frontierStrategy: config?.frontier_strategy,
      experimentCount: nodes.length,
      bestScore: scores.length ? (config?.metric === "min" ? Math.min(...scores) : Math.max(...scores)) : null,
      dashboardUrl: await dashboardUrl(root),
    };
  },
  async listRuns(profile) {
    const { meta, graph } = await loadActiveGraph(profile);
    const runName = meta?.active || "evo";
    return experimentNodes(graph)
      .map((node) => nodeToRun(node, runName))
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  },
  async getRunLog(profile, runId): Promise<RuntimeRunLog> {
    if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("Invalid Evo experiment id.");
    const { graph } = await loadActiveGraph(profile);
    const node = graph?.nodes?.[runId];
    if (!node) throw new Error(`Evo experiment ${runId} not found in the active run graph.`);
    const summary = [
      `${node.id}: ${node.hypothesis || "experiment"}`,
      `status: ${node.status || "unknown"}${typeof node.score === "number" ? ` · score ${node.score}` : ""}`,
      node.pruned_reason ? `pruned: ${node.pruned_reason}` : "",
      node.branch ? `branch: ${node.branch}` : "",
      node.commit ? `commit: ${node.commit}` : "",
    ].filter(Boolean).join("\n");
    return { id: runId, summary, logs: JSON.stringify(node, null, 2) };
  },
  // Drives the in-app installer for Evo on the local machine. Evo runs on top of
  // another runtime's credentials, so it has no runtime-auth step.
  async runIntegrationAction(_profile, action) {
    if (action !== "install-runtime") return { ok: false, error: `Unsupported Evo action: ${action}` };
    const spec = runtimeInstallSpec("evo");
    if (!spec?.uvPackage) return { ok: false, error: "Evo install is not available here." };
    const env = {
      ...process.env,
      PATH: [join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH || ""].filter(Boolean).join(":"),
    };
    const uv = await execFileAsync("uv", ["--version"], { timeout: 5_000, maxBuffer: 100_000, env }).catch(() => null);
    if (!uv) return { ok: false, error: "Evo needs the uv package manager. Install uv (astral.sh/uv) on the machine, then retry." };
    try {
      const out = await execFileAsync("uv", ["tool", "install", spec.uvPackage], { timeout: 300_000, maxBuffer: 2_000_000, env });
      return { ok: true, message: "Evo installed.", output: `${out.stdout}${out.stderr}`.trim() };
    } catch (error: unknown) {
      const maybe = error as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, error: (maybe.stderr || maybe.stdout || maybe.message || "Evo install failed.").slice(0, 1200) };
    }
  },
};
