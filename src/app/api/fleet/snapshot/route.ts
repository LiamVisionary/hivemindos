import { NextRequest } from "next/server";
import { access, readdir, readFile, stat } from "fs/promises";
import { constants } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import net from "net";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";
import { getRuntimeUrl } from "@/lib/types/agent-runtime";
import { getRuntimeAdapter } from "@/lib/services/runtime-adapters/registry";
import type { RuntimeRun } from "@/lib/services/runtime-adapters/types";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const MAX_FILES_PER_DIR = 20;
const MAX_FILE_CHARS = 4_000;
const SNAPSHOT_CACHE_MS = 10_000;

type FleetTaskStatus = "active" | "completed" | "failed" | "unknown";
const HERMES_EMPTY_TRANSCRIPT_MESSAGE = "Hermes session found. Send a message to resume it.";

type FleetTask = {
  id: string;
  agentId: string;
  title: string;
  lastMessage: string;
  status: FleetTaskStatus;
  source: string;
  updatedAt: number;
  startedAt?: number;
  messages?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
};

type AgentWithLocal = AgentProfile & {
  localDataDir?: string;
  telemetryUrl?: string;
};

type AgentSnapshot = {
  agentId: string;
  ok: boolean;
  runtimeReachable: boolean;
  processRunning: boolean;
  summary: string;
  sources: string[];
  tasks: FleetTask[];
  checkedAt: number;
  error?: string;
};

type SnapshotPayload = {
  ok: true;
  checkedAt: number;
  snapshots: AgentSnapshot[];
};

type SnapshotReadOptions = {
  historyOnly?: boolean;
};

const snapshotCache = new Map<string, { checkedAt: number; payload: SnapshotPayload }>();
const snapshotInFlight = new Map<string, Promise<SnapshotPayload>>();

function pruneSnapshotCache(now = Date.now()) {
  for (const [key, entry] of snapshotCache) {
    if (now - entry.checkedAt >= SNAPSHOT_CACHE_MS) snapshotCache.delete(key);
  }
}

async function pathReadable(path?: string) {
  if (!path) return false;
  return access(resolve(expandHome(path)), constants.R_OK).then(() => true).catch(() => false);
}

function normalizeCollectorUrl(url: string) {
  return url.replace(/\/+$/, "");
}

async function readRemoteSnapshot(agent: AgentWithLocal): Promise<AgentSnapshot | null> {
  const baseUrl = agent.telemetryUrl?.trim();
  if (!baseUrl) return null;
  try {
    const response = await fetch(`${normalizeCollectorUrl(baseUrl)}/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent }),
      signal: AbortSignal.timeout(4_000),
      cache: "no-store",
    });
    const data = await response.json().catch(() => null) as {
      snapshots?: AgentSnapshot[];
      snapshot?: AgentSnapshot;
    } | null;
    const snapshot = data?.snapshot ?? data?.snapshots?.find((item) => item.agentId === agent.id) ?? data?.snapshots?.[0];
    if (!snapshot) {
      return {
        agentId: agent.id,
        ok: false,
        runtimeReachable: false,
        processRunning: false,
        summary: `Agent bridge responded without a snapshot: ${baseUrl}`,
        sources: ["remote agent bridge"],
        tasks: [],
        checkedAt: Date.now(),
        error: "No snapshot in agent bridge response",
      };
    }
    return {
      ...snapshot,
      agentId: agent.id,
      sources: [...new Set(["remote agent bridge", ...snapshot.sources])],
    };
  } catch (error) {
    const reason = error instanceof Error && error.message !== "fetch failed"
      ? error.message
      : "endpoint is not listening";
    const snapshotUrl = `${normalizeCollectorUrl(baseUrl)}/snapshot`;
    return {
      agentId: agent.id,
      ok: false,
      runtimeReachable: false,
      processRunning: false,
      summary: `Remote agent bridge unavailable: ${baseUrl}`,
      sources: ["remote agent bridge"],
      tasks: [],
      checkedAt: Date.now(),
      error: `Remote agent bridge unavailable at ${snapshotUrl}: ${reason}`,
    };
  }
}

function expandHome(path: string) {
  return path.replace(/^~(?=$|\/)/, homedir());
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compact(value: unknown, fallback = "No details reported.", maxLength = 900) {
  if (typeof value === "string") return value.trim().slice(0, maxLength) || fallback;
  if (value && typeof value === "object") return JSON.stringify(value).slice(0, maxLength);
  return fallback;
}

function readableChatContent(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^[\[{]/.test(trimmed)) {
      try {
        return readableChatContent(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    return value.map((item) => readableChatContent(item)).filter(Boolean).join("\n").trim();
  }
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  for (const choice of choices) {
    const content = readableChatContent((choice as Record<string, unknown>)?.message)
      || readableChatContent((choice as Record<string, unknown>)?.delta)
      || readableChatContent((choice as Record<string, unknown>)?.text);
    if (content) return content;
  }
  for (const key of ["response", "answer", "content", "text", "message", "output", "result", "summary"]) {
    const content = readableChatContent(record[key]);
    if (content) return content;
  }
  return "";
}

function titleFromText(text: string) {
  const first = text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "Observed activity";
  return first.replace(/^#+\s*/, "").slice(0, 140);
}

function statusFromPath(path: string): FleetTaskStatus {
  if (path.includes("/working/")) return "active";
  if (path.includes("/outbox/") || path.includes("/archive/")) return "completed";
  if (/\b(error|failed|failure)\b/i.test(path)) return "failed";
  return "unknown";
}

function statusFromSession(endedAt: number | null | undefined, endReason: string | null | undefined): FleetTaskStatus {
  if (!endedAt) return "active";
  if (endReason && /error|fail/i.test(endReason)) return "failed";
  return "completed";
}

function taskFromContent(agentId: string, source: string, filePath: string, content: string, updatedAt: number): FleetTask {
  const status = statusFromPath(filePath);
  const titleMatch = content.match(/(?:^|\n)\s*(?:title|task|current task|summary)\s*:\s*(.+)/i);
  const messageMatch = content.match(/(?:^|\n)\s*(?:message|latest|status|result|body|notes?)\s*:\s*([\s\S]{1,900})/i);
  return {
    id: `${source}:${filePath}`,
    agentId,
    title: (titleMatch?.[1] ?? titleFromText(content)).trim().slice(0, 160),
    lastMessage: compact(messageMatch?.[1] ?? content, "Activity found, but no readable message was reported."),
    status,
    source,
    updatedAt,
  };
}

function tasksFromPayload(agent: AgentProfile, payload: unknown, source: string): FleetTask[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const candidates = [
    record.currentTask,
    record.current_task,
    record.task,
    record.activeTask,
    record.active_task,
    record.latestTask,
    record.latest_task,
    record.status,
  ].filter(Boolean);
  const arrays = [record.tasks, record.activeTasks, record.recentTasks, record.history]
    .filter(Array.isArray)
    .flat() as unknown[];

  return [...candidates, ...arrays].map((candidate, index) => {
    if (typeof candidate === "string") {
      return {
        id: `${source}:${agent.id}:${index}`,
        agentId: agent.id,
        title: titleFromText(candidate),
        lastMessage: candidate,
        status: /done|complete|idle/i.test(candidate) ? "completed" : "active",
        source,
        updatedAt: Date.now(),
      };
    }
    const item = candidate as Record<string, unknown>;
    const rawStatus = compact(item.status ?? item.state ?? "unknown");
    const status: FleetTaskStatus = /work|run|active|progress|started/i.test(rawStatus)
      ? "active"
      : /fail|error/i.test(rawStatus)
        ? "failed"
        : /done|complete|idle|success/i.test(rawStatus)
          ? "completed"
          : "unknown";
    return {
      id: `${source}:${compact(item.id ?? item.runId ?? index)}`,
      agentId: agent.id,
      title: compact(item.title ?? item.task ?? item.name ?? item.summary ?? rawStatus, "Observed activity").slice(0, 160),
      lastMessage: compact(item.lastMessage ?? item.message ?? item.result ?? item.output ?? item.detail ?? item),
      status,
      source,
      updatedAt: Date.now(),
    };
  });
}

function statusFromRuntimeRun(run: RuntimeRun): FleetTaskStatus {
  if (run.status === "active" || run.status === "queued") return "active";
  if (run.status === "failed") return "failed";
  if (run.status === "completed") return "completed";
  return "unknown";
}

function titleFromRuntimeRun(run: RuntimeRun) {
  const name = run.name || "AEON workflow";
  const skill = name.match(/^skill:\s*(.+)$/i)?.[1]?.trim();
  const label = skill ? `${titleFromText(skill)} workflow` : name;
  const titled = label.charAt(0).toUpperCase() + label.slice(1);
  if (run.status === "failed") return `${titled} failed`;
  if (run.status === "active" || run.status === "queued") return `${titled} is running`;
  return titled;
}

function taskFromRuntimeRun(agent: AgentProfile, run: RuntimeRun): FleetTask {
  const detail = [
    `${run.status}${run.conclusion ? ` · ${run.conclusion}` : ""}`,
    run.url,
  ].filter(Boolean).join("\n");
  return {
    id: `github-actions:${run.id}`,
    agentId: agent.id,
    title: titleFromRuntimeRun(run),
    lastMessage: detail || "GitHub Actions workflow run.",
    status: statusFromRuntimeRun(run),
    source: "GitHub Actions",
    updatedAt: Date.parse(run.updatedAt || run.createdAt || "") || Date.now(),
  };
}

async function scanRuntimeRuns(agent: AgentProfile): Promise<{ checked: boolean; tasks: FleetTask[] }> {
  if (agent.runtime !== "aeon") return { checked: false, tasks: [] };
  const adapter = getRuntimeAdapter(agent.runtime);
  if (!adapter?.listRuns) return { checked: false, tasks: [] };
  const runs = await adapter.listRuns(agent, { agents: [agent] }).catch(() => []);
  const currentOrLatestFailure = runs
    .slice(0, 5)
    .filter((run, index) => run.status === "active" || run.status === "queued" || (index === 0 && run.status === "failed"));
  return { checked: runs.length > 0, tasks: currentOrLatestFailure.map((run) => taskFromRuntimeRun(agent, run)) };
}

async function execJson<T>(cmd: string, args: string[], fallback: T): Promise<T> {
  const { stdout } = await execFileAsync(cmd, args, { timeout: 5_000, maxBuffer: 1_200_000 }).catch(() => ({ stdout: "" }));
  if (!stdout.trim()) return fallback;
  try {
    return JSON.parse(stdout) as T;
  } catch {
    return fallback;
  }
}

async function scanHermesStateDb(agent: AgentProfile, hermesDir: string): Promise<FleetTask[]> {
  const dbPath = join(hermesDir, "state.db");
  try {
    await access(dbPath, constants.R_OK);
  } catch {
    return [];
  }

  const sessions = await execJson<Array<{
    id: string;
    source: string;
    started_at: number;
    ended_at: number | null;
    end_reason: string | null;
    title: string | null;
    message_count: number;
    tool_call_count: number;
  }>>("sqlite3", ["-json", dbPath, `
    select id, source, started_at, ended_at, end_reason, title, message_count, tool_call_count
    from sessions
    order by started_at desc
    limit 10;
  `], []);

  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((session) => session.id);
  const sessionIdList = sessionIds.map((id) => `'${id.replaceAll("'", "''")}'`).join(",");
  const messagesBySession = new Map<string, Array<{
    role: string;
    content: string | null;
    tool_name: string | null;
    timestamp: number;
  }>>();
  const allMessages = await execJson<Array<{
    session_id: string;
    role: string;
    content: string | null;
    tool_name: string | null;
    timestamp: number;
  }>>("sqlite3", ["-json", dbPath, `
    select session_id, role, content, tool_name, timestamp
    from (
      select session_id, role, substr(content,1,8000) as content, tool_name, timestamp,
        row_number() over (partition by session_id order by timestamp desc) as row_num
      from messages
      where session_id in (${sessionIdList})
    )
    where row_num <= 30
    order by session_id, timestamp desc;
  `], []);
  for (const message of allMessages) {
    const messages = messagesBySession.get(message.session_id) ?? [];
    messages.push(message);
    messagesBySession.set(message.session_id, messages);
  }

  const tasks = sessions.map((session): FleetTask | null => {
    const messages = messagesBySession.get(session.id) ?? [];
    const readableMessages = messages.map((message) => ({
      ...message,
      content: readableChatContent(message.content),
    })).filter((message) => message.content.trim());
    const latestAssistant = readableMessages.find((message) => message.role === "assistant");
    const latestUser = readableMessages.find((message) => message.role === "user");
    const latestTool = readableMessages.find((message) => message.role === "tool");
    const latest = latestAssistant ?? latestTool ?? readableMessages[0];
    const chatMessages = readableMessages
      .filter((message) => (
        (message.role === "user" || message.role === "assistant")
        && message.content.trim()
      ))
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: compact(message.content, "", 8_000),
      }));
    if (!chatMessages.length) return null;
    return {
      id: `hermes-state:${session.id}`,
      agentId: agent.id,
      title: (session.title || latestUser?.content || `Hermes ${session.source} session`).slice(0, 160),
      lastMessage: compact(latest?.content, HERMES_EMPTY_TRANSCRIPT_MESSAGE),
      status: statusFromSession(session.ended_at, session.end_reason),
      source: "hermes-state",
      startedAt: session.started_at * 1000,
      updatedAt: (latest?.timestamp ?? session.started_at) * 1000,
      messages: chatMessages,
    };
  });

  return tasks.filter((task): task is FleetTask => Boolean(task));
}

async function readIfExists(path: string) {
  try {
    await access(path, constants.R_OK);
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

async function listFilesRecursive(dir: string, depth = 2): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const directFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(dir, entry.name));
  if (depth <= 0) return directFiles;
  const nested = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .slice(0, MAX_FILES_PER_DIR)
    .map((entry) => listFilesRecursive(join(dir, entry.name), depth - 1)));
  return [...directFiles, ...nested.flat()].slice(0, MAX_FILES_PER_DIR * 4);
}

async function parseControlRoomDataDirs(controlRoomPath: string) {
  const yaml = await readIfExists(join(controlRoomPath, "task-bus/agents.yaml"));
  const dataDirs: Record<string, string> = {};
  let current = "";
  for (const line of yaml.split(/\r?\n/)) {
    const agentMatch = line.match(/^\s{2}([a-zA-Z0-9_-]+):\s*$/);
    if (agentMatch) current = agentMatch[1];
    const dataMatch = line.match(/^\s+data_dir:\s*(.+)\s*$/);
    if (current && dataMatch) dataDirs[current] = expandHome(dataMatch[1].trim());
  }
  return dataDirs;
}

async function scanTaskBus(agent: AgentProfile, controlRoomPath: string): Promise<FleetTask[]> {
  const taskBusPath = join(controlRoomPath, "task-bus");
  const dirs = ["working", "inbox", "outbox", "archive"];
  const needles = [agent.id, agent.agentId, agent.name].filter(Boolean).map((value) => normalize(value as string));
  const tasks: FleetTask[] = [];

  await Promise.all(dirs.map(async (dir) => {
    const fullDir = join(taskBusPath, dir);
    const filePaths = await listFilesRecursive(fullDir, 2);
    await Promise.all(filePaths.map(async (filePath) => {
      const content = await readFile(filePath, "utf-8").catch(() => "");
      const haystack = normalize(`${filePath}\n${content}`);
      if (!needles.some((needle) => needle && haystack.includes(needle))) return;
      const stats = await stat(filePath).catch(() => null);
      tasks.push(taskFromContent(agent.id, `task-bus/${dir}`, filePath, content.slice(-MAX_FILE_CHARS), stats?.mtimeMs ?? Date.now()));
    }));
  }));

  return tasks;
}

async function scanAgentDataDir(agent: AgentProfile, dataDir?: string): Promise<FleetTask[]> {
  if (!dataDir) return [];
  const safeDir = resolve(expandHome(dataDir));
  const hasHermesDb = agent.runtime === "hermes"
    ? await access(join(safeDir, "state.db"), constants.R_OK).then(() => true).catch(() => false)
    : false;
  const dirs = hasHermesDb ? ["cron", "tasks", "inbox", "outbox"] : ["logs", "sessions", "cron", "tasks", "inbox", "outbox"];
  const tasks: FleetTask[] = [];
  await Promise.all(dirs.map(async (dir) => {
    const fullDir = join(safeDir, dir);
    const entries = await readdir(fullDir, { withFileTypes: true }).catch(() => []);
    const files = entries
      .filter((entry) => entry.isFile() && /\.(log|md|json|jsonl|txt)$/i.test(entry.name))
      .slice(0, MAX_FILES_PER_DIR);
    await Promise.all(files.map(async (entry) => {
      const filePath = join(fullDir, entry.name);
      const stats = await stat(filePath).catch(() => null);
      const content = await readFile(filePath, "utf-8").catch(() => "");
      if (!content.trim()) return;
      tasks.push(taskFromContent(agent.id, `data/${dir}`, filePath, content.slice(-MAX_FILE_CHARS), stats?.mtimeMs ?? Date.now()));
    }));
  }));
  return tasks;
}

async function checkTcpUrl(url: string) {
  return new Promise<boolean>((resolveResult) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolveResult(false);
      return;
    }
    const port = Number(parsed.port || (parsed.protocol === "wss:" || parsed.protocol === "https:" ? 443 : 80));
    const socket = net.createConnection({ host: parsed.hostname, port, timeout: 1_500 });
    socket.once("connect", () => {
      socket.destroy();
      resolveResult(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolveResult(false);
    });
    socket.once("error", () => resolveResult(false));
  });
}

async function checkRuntime(agent: AgentProfile) {
  if (agent.runtime === "openclaw") {
    const reachable = await checkTcpUrl(agent.gatewayUrl);
    return {
      reachable,
      payload: reachable ? { status: "OpenClaw gateway port is reachable" } : null as unknown,
      error: reachable ? "" : "OpenClaw gateway port is not reachable",
    };
  }
  const statusUrl = getRuntimeUrl(agent, agent.statusPath || "/health");
  try {
    const response = await fetch(statusUrl, {
      method: "GET",
      headers: agent.token ? { Authorization: `Bearer ${agent.token}` } : undefined,
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");
    return { reachable: response.ok, payload, error: response.ok ? "" : `${response.status} ${response.statusText}` };
  } catch (error) {
    const reason = error instanceof Error && error.message !== "fetch failed"
      ? error.message
      : "endpoint is not listening";
    return { reachable: false, payload: null, error: `Runtime status unavailable at ${statusUrl}: ${reason}` };
  }
}

async function processMatches(agent: AgentProfile, includeGenericHermes = false) {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="], { timeout: 4_000, maxBuffer: 800_000 }).catch(() => ({ stdout: "" }));
  const genericNeedles = agent.runtime === "aeon"
    ? [agent.id, agent.agentId, agent.name].filter((value) => normalize(String(value ?? "")) !== "aeon")
    : [agent.id, agent.agentId, agent.name];
  const needles = genericNeedles
    .filter(Boolean)
    .map((value) => normalize(value as string))
    .filter((value) => value.length >= 4 && !["main", "agent"].includes(value));
  const pathNeedles = agent.runtime === "aeon"
    ? [agent.aeonLocalPath, agent.localDataDir]
      .filter(Boolean)
      .flatMap((path) => {
        const trimmed = String(path).trim().replace(/\/+$/, "");
        return trimmed ? [trimmed, resolve(expandHome(trimmed))] : [];
      })
    : [];
  const pathMatchers = [...new Set(pathNeedles)]
    .map((path) => new RegExp(`${escapeRegExp(path)}(?:$|[\\s/])`));
  return stdout
    .split(/\r?\n/)
    .filter((line) => {
      if (/api\/fleet\/snapshot|next start|codex app-server|rg -i|ps -axo/i.test(line)) return false;
      if (agent.runtime === "aeon" && /\b(unison|rsync|syncthing)\b/i.test(line)) return false;
      const text = normalize(line);
      return pathMatchers.some((matcher) => matcher.test(line))
        || needles.some((needle) => needle && text.includes(needle))
        || (includeGenericHermes && /\/\.hermes\/|\/hermes-agent\/|\/bin\/hermes\b/i.test(line));
    })
    .slice(0, 5);
}

function snapshotCacheKey(agents: AgentWithLocal[], sharedVault?: SharedVaultConfig, options: SnapshotReadOptions = {}) {
  return JSON.stringify({
    mode: options.historyOnly ? "history" : "full",
    controlRoomPath: sharedVault?.controlRoomPath ?? "",
    agents: agents.map((agent) => ({
      id: agent.id,
      runtime: agent.runtime,
      gatewayUrl: agent.gatewayUrl,
      statusPath: agent.statusPath,
      aeonLocalPath: agent.aeonLocalPath,
      aeonRepo: agent.aeonRepo,
      aeonBranch: agent.aeonBranch,
      localDataDir: agent.localDataDir,
      telemetryUrl: agent.telemetryUrl,
      agentId: agent.agentId,
      name: agent.name,
    })),
  });
}

async function readSnapshots(agents: AgentWithLocal[], sharedVault?: SharedVaultConfig, options: SnapshotReadOptions = {}): Promise<SnapshotPayload> {
  const controlRoomPath = resolve(expandHome(sharedVault?.controlRoomPath || ""));
  const dataDirs: Record<string, string> = controlRoomPath
    ? await parseControlRoomDataDirs(controlRoomPath).catch(() => ({} as Record<string, string>))
    : {};
  const firstHermesId = agents.find((agent) => agent.runtime === "hermes")?.id;

  const snapshots = await Promise.all(agents.map(async (agent): Promise<AgentSnapshot> => {
    const remoteSnapshot = options.historyOnly ? null : await readRemoteSnapshot(agent);
    const remoteSnapshotHasActivity = Boolean(
      remoteSnapshot?.ok
      || remoteSnapshot?.runtimeReachable
      || remoteSnapshot?.processRunning
      || remoteSnapshot?.tasks?.length,
    );
    if (remoteSnapshotHasActivity) return remoteSnapshot!;

    const checkedAt = Date.now();
    const configuredDataDir = agent.localDataDir
      ?? dataDirs[agent.agentId || agent.id]
      ?? dataDirs[agent.id];
    const hermesHomeDir = agent.runtime === "hermes" && agent.id === firstHermesId ? join(homedir(), ".hermes") : undefined;
    const dataDirsToScan = [...new Set([configuredDataDir, hermesHomeDir].filter(Boolean) as string[])];
    if (options.historyOnly) {
      const hermesDbTaskGroups = await Promise.all(dataDirsToScan.map((dir) => (
        agent.runtime === "hermes" ? scanHermesStateDb(agent, dir) : Promise.resolve([])
      )));
      const tasks = hermesDbTaskGroups.flat()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 12);
      return {
        agentId: agent.id,
        ok: tasks.length > 0,
        runtimeReachable: false,
        processRunning: false,
        summary: tasks[0]?.title ?? "No Hermes chat history found yet.",
        sources: tasks.length ? ["Hermes history"] : [],
        tasks,
        checkedAt,
      };
    }
    const hasReadableDataDir = (await Promise.all(dataDirsToScan.map(pathReadable))).some(Boolean);
    const [runtimeResult, taskBusTasks, dataDirTaskGroups, hermesDbTaskGroups, runtimeRuns, processes] = await Promise.all([
      checkRuntime(agent),
      controlRoomPath ? scanTaskBus(agent, controlRoomPath) : Promise.resolve([]),
      Promise.all(dataDirsToScan.map((dir) => scanAgentDataDir(agent, dir))),
      Promise.all(dataDirsToScan.map((dir) => agent.runtime === "hermes" ? scanHermesStateDb(agent, dir) : Promise.resolve([]))),
      scanRuntimeRuns(agent),
      agent.runtime === "aeon" ? Promise.resolve([]) : processMatches(agent, Boolean(hermesHomeDir)),
    ]);
    const dataDirTasks = dataDirTaskGroups.flat();
    const hermesDbTasks = hermesDbTaskGroups.flat();
    const runtimeTasks = tasksFromPayload(agent, runtimeResult.payload, "runtime-status");
    const priority = (task: FleetTask) => {
      if (task.status === "active") return 4;
      if (task.source === "hermes-state") return 3;
      if (task.source.startsWith("task-bus")) return 2;
      if (task.source === "runtime-status") return 1;
      return 0;
    };
    const tasks = [...runtimeTasks, ...hermesDbTasks, ...taskBusTasks, ...dataDirTasks, ...runtimeRuns.tasks]
      .sort((a, b) => priority(b) - priority(a) || b.updatedAt - a.updatedAt)
      .slice(0, 12);
    const failedTask = tasks.find((task) => task.status === "failed");
    const sources = [
      runtimeResult.reachable ? "runtime reachable" : "",
      remoteSnapshot?.error ? "remote agent bridge" : "",
      taskBusTasks.length ? "task bus" : "",
      hermesDbTasks.length ? "Hermes history" : "",
      dataDirTasks.length ? "runtime files" : "",
      runtimeRuns.checked ? "GitHub Actions" : "",
      processes.length ? "local process" : "",
    ].filter(Boolean);
    return {
      agentId: agent.id,
      ok: runtimeResult.reachable || processes.length > 0 || tasks.length > 0 || runtimeRuns.checked,
      runtimeReachable: runtimeResult.reachable,
      processRunning: processes.length > 0,
      summary: tasks[0]?.title
        ?? (processes.length
          ? "Process is running; no current task exposed yet."
          : configuredDataDir && !hasReadableDataDir
            ? `Configured data dir is not available here: ${configuredDataDir}`
            : agent.runtime === "aeon"
              ? "Idle. No current AEON task detected."
              : "No external activity source exposed a task yet."),
      sources,
      tasks,
      checkedAt,
      error: configuredDataDir && !hasReadableDataDir
        ? `No local runtime files found at ${configuredDataDir}`
        : failedTask
          ? failedTask.title
          : runtimeResult.reachable || tasks.length > 0 || processes.length > 0 || runtimeRuns.checked
            ? undefined
            : agent.runtime === "aeon" && /endpoint is not listening/i.test(runtimeResult.error)
              ? undefined
              : runtimeResult.error || remoteSnapshot?.error || undefined,
    };
  }));

  return { ok: true, checkedAt: Date.now(), snapshots };
}

export async function POST(request: NextRequest) {
  let agents: AgentWithLocal[] = [];
  let sharedVault: SharedVaultConfig | undefined;
  let options: SnapshotReadOptions = {};
  try {
    const body = (await request.json()) as { agents?: AgentProfile[]; sharedVault?: SharedVaultConfig; mode?: "full" | "history" };
    agents = Array.isArray(body.agents) ? body.agents as AgentWithLocal[] : [];
    sharedVault = body.sharedVault;
    options = { historyOnly: body.mode === "history" };
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const cacheKey = snapshotCacheKey(agents, sharedVault, options);
  const now = Date.now();
  pruneSnapshotCache(now);
  const cached = snapshotCache.get(cacheKey);
  if (cached && now - cached.checkedAt < SNAPSHOT_CACHE_MS) {
    return Response.json(cached.payload);
  }

  let inFlight = snapshotInFlight.get(cacheKey);
  if (!inFlight) {
    inFlight = readSnapshots(agents, sharedVault, options)
      .then((payload) => {
        snapshotCache.set(cacheKey, { checkedAt: Date.now(), payload });
        return payload;
      })
      .finally(() => {
        snapshotInFlight.delete(cacheKey);
      });
    snapshotInFlight.set(cacheKey, inFlight);
  }

  return Response.json(await inFlight);
}
