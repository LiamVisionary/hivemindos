export const CHAT_APP_ARTIFACT_PROTOCOL = "hivemindos.chat-app/v1" as const;

export type ChatAppArtifactStatus = "creating" | "stopped" | "running" | "error";

export type ChatAppArtifact = {
  protocol: typeof CHAT_APP_ARTIFACT_PROTOCOL;
  projectId: string;
  name: string;
  directory: string;
  templateId: "nextjs" | "static";
  machineKey: string;
  machineName: string;
  status: ChatAppArtifactStatus;
  dependenciesReady: boolean;
  port?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type ChatAppArtifactMessage = {
  role?: string;
  content?: string;
  appArtifact?: ChatAppArtifact;
};

type ChatWorkingDirectoryRow = {
  storageKey?: string;
  workingDirectoryPath?: string;
};

type LocalAppProjectLike = {
  id?: unknown;
  name?: unknown;
  directory?: unknown;
  templateId?: unknown;
  status?: unknown;
  dependenciesReady?: unknown;
  port?: unknown;
  lastError?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function timestamp(value: unknown, fallback = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function normalizeChatAppArtifact(value: unknown): ChatAppArtifact | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<ChatAppArtifact>;
  const projectId = clean(item.projectId, 200);
  const name = clean(item.name, 100);
  const directory = clean(item.directory, 2_000);
  const machineKey = clean(item.machineKey, 500);
  const machineName = clean(item.machineName, 200);
  const templateId = item.templateId === "static" || item.templateId === "nextjs" ? item.templateId : undefined;
  const status = item.status === "creating" || item.status === "stopped" || item.status === "running" || item.status === "error"
    ? item.status
    : undefined;
  if (item.protocol !== CHAT_APP_ARTIFACT_PROTOCOL || !projectId || !name || !directory || !templateId || !status) return undefined;
  const port = Number(item.port);
  return {
    protocol: CHAT_APP_ARTIFACT_PROTOCOL,
    projectId,
    name,
    directory,
    templateId,
    machineKey,
    machineName,
    status,
    dependenciesReady: item.dependenciesReady === true,
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : undefined,
    error: clean(item.error, 1_000) || undefined,
    createdAt: timestamp(item.createdAt),
    updatedAt: timestamp(item.updatedAt),
  };
}

export function latestChatAppArtifact(messages: readonly ChatAppArtifactMessage[] = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const artifact = normalizeChatAppArtifact(messages[index]?.appArtifact);
    if (artifact) return artifact;
  }
  return undefined;
}

export function chatAppArtifactFromProject(
  project: LocalAppProjectLike,
  machine: { key?: string; name?: string },
  previous?: ChatAppArtifact,
): ChatAppArtifact {
  const now = Date.now();
  const artifact = normalizeChatAppArtifact({
    protocol: CHAT_APP_ARTIFACT_PROTOCOL,
    projectId: clean(project.id, 200),
    name: clean(project.name, 100),
    directory: clean(project.directory, 2_000),
    templateId: project.templateId,
    machineKey: clean(machine.key, 500),
    machineName: clean(machine.name, 200),
    status: project.status,
    dependenciesReady: project.dependenciesReady === true,
    port: project.port,
    error: project.lastError,
    createdAt: previous?.createdAt ?? timestamp(project.createdAt, now),
    updatedAt: timestamp(project.updatedAt, now),
  });
  if (!artifact) throw new Error("App Builder returned an invalid project identity.");
  return artifact;
}

export function chatAppTemplateForTask(task: string): "nextjs" | "static" {
  const value = task.toLowerCase();
  if (/\b(next(?:\.js)?|react|full[-\s]?stack|api|database|server action)\b/.test(value)) return "nextjs";
  return /\b(html|css|javascript|vanilla|static|game|clone|canvas)\b/.test(value) ? "static" : "nextjs";
}

export function chatAppProjectName(task: string) {
  const cleaned = task
    .replace(/^\s*(?:please\s+)?(?:build|create|make|prototype|develop|code)\s+(?:me\s+)?/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.?!]+$/, "")
    .trim();
  return (cleaned || "HivemindOS App").slice(0, 80);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42) || "app";
}

export function chatAppProjectDirectory(baseDirectory: string, task: string, planId: string) {
  const base = baseDirectory.trim().replace(/[\\/]+$/, "");
  if (!base) throw new Error("Choose a working directory before building an app.");
  const separator = /^[a-z]:[\\/]/i.test(base) || base.includes("\\") ? "\\" : "/";
  const suffix = clean(planId, 32).replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "project";
  return [base, "scratchpad", `${slug(chatAppProjectName(task))}-${suffix}`].join(separator);
}

export function chatWorkingDirectoryForThread(
  rows: readonly ChatWorkingDirectoryRow[] = [],
  storageKey = "",
  fallbackDirectory = "",
) {
  const directory = rows.find((row) => row.storageKey === storageKey)?.workingDirectoryPath;
  return clean(directory, 2_000) || clean(fallbackDirectory, 2_000);
}

function normalizedPath(value: string) {
  const separator = /^[a-z]:[\\/]/i.test(value) || value.includes("\\") ? "\\" : "/";
  const normalized = value.trim().replace(/[\\/]+/g, separator).replace(/[\\/]+$/, "");
  return { normalized, separator };
}

function pathInsideWorkspace(candidate: string, workspace: string) {
  const left = normalizedPath(candidate);
  const right = normalizedPath(workspace);
  const fold = (value: string) => right.separator === "\\" ? value.toLowerCase() : value;
  const candidateNormalized = fold(left.normalized);
  const workspaceNormalized = fold(right.normalized);
  if (candidateNormalized === workspaceNormalized || candidateNormalized.startsWith(`${workspaceNormalized}${right.separator}`)) return true;
  // Chat rows persist home-relative workspaces ("~/code/app") while task
  // records and continuation prompts carry absolute paths. The browser cannot
  // expand "~", so align the workspace's post-~ tail at a segment boundary.
  if (workspaceNormalized.startsWith(`~${right.separator}`)) {
    const anchor = right.separator + workspaceNormalized.slice(2);
    return candidateNormalized.includes(`${anchor}${right.separator}`) || candidateNormalized.endsWith(anchor);
  }
  return false;
}

// The app artifact lives only on client-side messages — the runtime session
// store never persists it. But the capability continuation prompt, which the
// session DOES keep verbatim on the turn's user message, embeds the project
// identity ("Assigned App Builder project"). Rebuilding the artifact from that
// text is what lets a rehydrated thread find its app again instead of showing
// "No preview available" for an app that exists on disk.
export function chatAppArtifactFromCapabilityContext(
  messages: readonly ChatAppArtifactMessage[] = [],
  machine: { key?: string; name?: string } = {},
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const content = String(message.content || "");
    if (!content.includes("Assigned App Builder project:")) continue;
    const projectId = content.match(/^- Project id:\s*(\S+)\s*$/m)?.[1] ?? "";
    const directory = content.match(/^- Directory:\s*(.+)$/m)?.[1]?.trim() ?? "";
    const templateId = content.match(/^- Template:\s*(nextjs|static)\s*$/m)?.[1];
    const originalTask = content.match(/^Original task:\s*(.+)$/m)?.[1]?.trim() ?? "";
    const artifact = normalizeChatAppArtifact({
      protocol: CHAT_APP_ARTIFACT_PROTOCOL,
      projectId,
      name: originalTask
        ? chatAppProjectName(originalTask)
        : directory.split(/[\\/]/).filter(Boolean).at(-1) || "Chat app",
      directory,
      templateId,
      machineKey: machine.key,
      machineName: machine.name,
      // Identity only: the preview flow re-fetches live status, port, and
      // dependency readiness from the project's on-disk manifest.
      status: "stopped",
      dependenciesReady: false,
    });
    if (artifact) return artifact;
  }
  return undefined;
}

// A capability app build runs its continuation with the project directory as
// the turn's working directory, so the runtime TASK record keeps that path
// durably. Unlike message content — which transcript merges rewrite to the
// person's typed words — the task record survives, making it the recovery
// path for threads whose messages lost both the artifact and the
// continuation text.
export function chatAppDirectoryFromTaskRecords(
  messages: readonly { sourceSessionId?: string }[] = [],
  tasks: readonly { id?: unknown; workingDirectory?: unknown; updatedAt?: unknown }[] = [],
  workspaceDirectory = "",
) {
  if (!workspaceDirectory.trim()) return "";
  const sessionIds = new Set(messages.map((message) => message?.sourceSessionId).filter(Boolean));
  if (!sessionIds.size) return "";
  let best = "";
  let bestAt = -1;
  for (const task of tasks) {
    if (typeof task?.id !== "string" || !sessionIds.has(task.id)) continue;
    const candidate = clean(task.workingDirectory, 2_000);
    // Only an App Builder project layout (<workspace>/scratchpad/<slug>) may
    // be adopted — never the workspace itself or an arbitrary task cwd.
    if (!/[\\/]scratchpad[\\/][^\\/]+$/.test(candidate)) continue;
    if (!pathInsideWorkspace(candidate, workspaceDirectory)) continue;
    const at = Number(task.updatedAt ?? 0) || 0;
    if (at >= bestAt) {
      best = candidate;
      bestAt = at;
    }
  }
  return best;
}

export function inferLegacyChatAppDirectory(
  messages: readonly ChatAppArtifactMessage[] = [],
  workspaceDirectory = "",
) {
  if (!workspaceDirectory.trim()) return "";
  const labelledPath = /(?:^|\n)\s*(?:location|project(?:\s+directory)?|directory)\s*:\s*(?:\n\s*)?`([^`\n]+)`/gi;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const matches = [...String(message.content || "").matchAll(labelledPath)];
    for (let matchIndex = matches.length - 1; matchIndex >= 0; matchIndex -= 1) {
      const candidate = matches[matchIndex]?.[1]?.trim() || "";
      if (candidate && pathInsideWorkspace(candidate, workspaceDirectory)) return candidate;
    }
  }
  return "";
}
