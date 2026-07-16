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
  return fold(left.normalized) === fold(right.normalized)
    || fold(left.normalized).startsWith(`${fold(right.normalized)}${right.separator}`);
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
