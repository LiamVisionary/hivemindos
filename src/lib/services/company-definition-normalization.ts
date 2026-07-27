/** Pure input normalizers for company definitions, shared by the companies store. */
import type { KanbanDeliverableKind } from "@/lib/types/kanban";
import type {
  Company,
  CompanyApexGoal,
  CompanyAutonomyPause,
  CompanyAutonomyPauseMode,
  CompanyMetricUnit,
  CompanyRevenue,
  CompanyStatus,
} from "@/lib/types/company";
import type {
  CompanyImportedOperations,
  ImportedSchedule,
  ImportedScript,
  ImportedService,
  ImportedWorkflow,
} from "@/lib/types/company-import";

export function normalizeAgentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (id) seen.add(id);
  }
  return [...seen];
}

const VALID_STATUSES: CompanyStatus[] = ["shipping", "drift", "review", "setup", "paused"];

export function normalizeStatus(value: unknown): CompanyStatus | undefined {
  return typeof value === "string" && (VALID_STATUSES as string[]).includes(value)
    ? (value as CompanyStatus)
    : undefined;
}

const VALID_DELIVERABLE_KINDS: KanbanDeliverableKind[] = [
  "website",
  "video",
  "image",
  "audio",
  "document",
  "directory",
  "file",
  "url",
];

/**
 * Clean an autonomy-pause config. A non-positive threshold means "disabled" and
 * is stored as `undefined` so a cleared setting drops out of the definition
 * entirely (rather than persisting a dead `0`). Kinds are validated against the
 * known deliverable kinds; an empty kind list leaves the driver to fall back to
 * counting every waiting item.
 */
export function normalizeAutonomyPause(value: unknown): CompanyAutonomyPause | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as CompanyAutonomyPause;
  const rawMax = input.maxWaitingOnHuman;
  const max = typeof rawMax === "number" && Number.isFinite(rawMax) ? Math.max(0, Math.floor(rawMax)) : 0;
  if (max <= 0) return undefined;
  const countMode: CompanyAutonomyPauseMode = input.countMode === "deliverable-kinds" ? "deliverable-kinds" : "all";
  const kinds =
    countMode === "deliverable-kinds"
      ? (Array.isArray(input.deliverableKinds) ? input.deliverableKinds : []).filter(
          (kind): kind is KanbanDeliverableKind => VALID_DELIVERABLE_KINDS.includes(kind as KanbanDeliverableKind),
        )
      : undefined;
  return {
    maxWaitingOnHuman: max,
    countMode,
    ...(kinds && kinds.length > 0 ? { deliverableKinds: kinds } : {}),
  };
}

export function trimmed(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

/** Names + operator copy only; a value-looking entry is dropped rather than stored. */
export function normalizeSetupEnvKeys(value: unknown): Company["setupEnvKeys"] {
  if (!Array.isArray(value)) return undefined;
  const keys = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Record<string, unknown>;
      const envKey = trimmed(raw.envKey);
      if (!envKey || !/^[A-Z][A-Z0-9_]{1,80}$/.test(envKey)) return null;
      return {
        envKey,
        title: trimmed(raw.title),
        explanation: trimmed(raw.explanation),
        kind: raw.kind === "text" ? ("text" as const) : raw.kind === "secret" ? ("secret" as const) : undefined,
        placeholder: trimmed(raw.placeholder),
        links: Array.isArray(raw.links)
          ? raw.links
              .map((link) => {
                const item = link as Record<string, unknown>;
                const label = trimmed(item?.label);
                const url = trimmed(item?.url);
                return label && url && /^https?:\/\//.test(url) ? { label, url } : null;
              })
              .filter((link): link is { label: string; url: string } => Boolean(link))
          : undefined,
        requiredForLaunch: raw.requiredForLaunch === true ? true : undefined,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  return keys.length ? keys : undefined;
}

export function normalizeAlignment(value: unknown): number | undefined {
  if (value === null || value === "") return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

const METRIC_UNITS: CompanyMetricUnit[] = ["number", "percent", "currency", "users"];

function normalizeMetricUnit(value: unknown): CompanyMetricUnit | undefined {
  return typeof value === "string" && (METRIC_UNITS as string[]).includes(value)
    ? (value as CompanyMetricUnit)
    : undefined;
}

export function normalizeApexGoal(value: unknown): CompanyApexGoal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const title = trimmed(raw.title);
  const metric = trimmed(raw.metric);
  const target = trimmed(raw.target);
  const current = trimmed(raw.current);
  // Keep the goal if there's any substance to it, even without an explicit title.
  if (!title && !metric && !target) return undefined;
  const progress = raw.progress === null || raw.progress === "" ? NaN : Number(raw.progress);
  return {
    title: title || metric || "Apex goal",
    metric,
    target,
    current,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : undefined,
    unit: normalizeMetricUnit(raw.unit),
  };
}

export function normalizeRevenue(value: unknown): CompanyRevenue | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const label = trimmed(raw.label);
  const display = trimmed(raw.value);
  if (!label || !display) return undefined;
  const pctRaw = Number(raw.pct);
  return {
    kind: raw.kind === "users" ? "users" : raw.kind === "revenue" ? "revenue" : undefined,
    label,
    value: display,
    target: trimmed(raw.target) ?? null,
    mau: trimmed(raw.mau),
    pct: Number.isFinite(pctRaw) ? Math.max(0, Math.min(100, Math.round(pctRaw))) : null,
    delta: trimmed(raw.delta) ?? null,
    up: raw.up !== false,
    isApex: raw.isApex === true,
  };
}

export function normalizeImportedOperations(value: unknown): CompanyImportedOperations | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<CompanyImportedOperations>;
  return {
    source: "repo",
    importedAt: normalizedIsoDate(raw.importedAt),
    lastDiscoveredAt: normalizedIsoDate(raw.lastDiscoveredAt),
    projectPath: trimmed(raw.projectPath),
    packageName: trimmed(raw.packageName),
    git: raw.git && typeof raw.git === "object"
      ? {
          remoteUrl: trimmed(raw.git.remoteUrl),
          repoName: trimmed(raw.git.repoName),
          branch: trimmed(raw.git.branch),
          commit: trimmed(raw.git.commit),
        }
      : undefined,
    workflows: Array.isArray(raw.workflows) ? raw.workflows.map(normalizeImportedWorkflow).filter((item): item is ImportedWorkflow => Boolean(item)) : [],
    schedules: Array.isArray(raw.schedules) ? raw.schedules.map(normalizeImportedSchedule).filter((item): item is ImportedSchedule => Boolean(item)) : [],
    services: Array.isArray(raw.services) ? raw.services.map(normalizeImportedService).filter((item): item is ImportedService => Boolean(item)) : [],
    scripts: Array.isArray(raw.scripts) ? raw.scripts.map(normalizeImportedScript).filter((item): item is ImportedScript => Boolean(item)) : [],
  };
}

function normalizeImportedWorkflow(value: unknown): ImportedWorkflow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ImportedWorkflow>;
  const id = trimmed(raw.id);
  const name = trimmed(raw.name);
  const sourcePath = trimmed(raw.path);
  if (!id || !name || !sourcePath) return null;
  const triggers = Array.isArray(raw.triggers) ? raw.triggers.map(trimmed).filter((item): item is string => Boolean(item)) : [];
  const schedules = Array.isArray(raw.schedules) ? raw.schedules.map(trimmed).filter((item): item is string => Boolean(item)) : undefined;
  return { id, name, path: sourcePath, triggers, schedules };
}

function normalizeImportedSchedule(value: unknown): ImportedSchedule | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ImportedSchedule>;
  const id = trimmed(raw.id);
  const name = trimmed(raw.name);
  const sourcePath = trimmed(raw.path);
  if (!id || !name || !sourcePath) return null;
  return {
    id,
    kind: raw.kind ?? "other",
    name,
    path: sourcePath,
    schedule: trimmed(raw.schedule),
    command: trimmed(raw.command),
    target: trimmed(raw.target),
    detail: trimmed(raw.detail),
  };
}

function normalizeImportedService(value: unknown): ImportedService | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ImportedService>;
  const id = trimmed(raw.id);
  const name = trimmed(raw.name);
  const sourcePath = trimmed(raw.path);
  if (!id || !name || !sourcePath) return null;
  return {
    id,
    kind: raw.kind ?? "other",
    name,
    path: sourcePath,
    serviceType: trimmed(raw.serviceType),
    schedule: trimmed(raw.schedule),
    detail: trimmed(raw.detail),
  };
}

function normalizeImportedScript(value: unknown): ImportedScript | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ImportedScript>;
  const id = trimmed(raw.id);
  const name = trimmed(raw.name);
  const command = trimmed(raw.command);
  const sourcePath = trimmed(raw.path);
  if (!id || !name || !command || !sourcePath) return null;
  return {
    id,
    name,
    command,
    path: sourcePath,
    category: raw.category ?? "other",
  };
}

function normalizedIsoDate(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}
