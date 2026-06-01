import type { DashboardView } from "@/features/dashboard/dashboard-types";

export const DASHBOARD_VIEWS = [
  "agents",
  "kanban",
  "scheduler",
  "swarm",
  "history",
  "wallet",
  "vault",
  "integrations",
  "maintenance",
  "sessions",
  "tools",
  "memory",
  "files",
  "notifications",
  "chat",
  "more",
  "env",
  "my-apps",
  "phone",
  "aeon",
] as const satisfies readonly DashboardView[];

const DASHBOARD_VIEW_SET = new Set<string>(DASHBOARD_VIEWS);

export type DashboardRouteTarget = {
  view: DashboardView;
  vaultPanel?: string;
  agentId?: string;
  taskId?: string;
  chatLeaf?: string;
};

export type DashboardRouteCatalogItem = {
  id: DashboardView;
  label: string;
  detail: string;
  group: "Primary" | "Work" | "Utilities";
  shortcut?: string;
  keywords: string[];
};

export const DESKTOP_NAVIGATE_EVENT = "hivemindos:navigate";
export const DESKTOP_OPEN_PALETTE_EVENT = "hivemindos:open-command-palette";
export const DESKTOP_OPEN_POPOUT_EVENT = "hivemindos:open-popout";

export const DASHBOARD_ROUTE_CATALOG: DashboardRouteCatalogItem[] = [
  { id: "agents", label: "Fleet", detail: "Machines, agents, collectors", group: "Primary", shortcut: "Cmd+1", keywords: ["agents", "machines", "fleet", "collectors"] },
  { id: "kanban", label: "Work", detail: "Kanban board and active tasks", group: "Primary", shortcut: "Cmd+2", keywords: ["work", "tasks", "kanban", "board"] },
  { id: "vault", label: "Brain", detail: "Shared vault, skills, graph", group: "Primary", shortcut: "Cmd+3", keywords: ["brain", "vault", "skills", "graph", "memory"] },
  { id: "chat", label: "Chat", detail: "Talk with an agent", group: "Primary", shortcut: "Cmd+4", keywords: ["chat", "agent chat", "conversation"] },
  { id: "wallet", label: "Wallets", detail: "Agent wallets and usage", group: "Primary", shortcut: "Cmd+5", keywords: ["wallet", "honey", "spend", "usage", "tokens"] },
  { id: "more", label: "More", detail: "Utility launcher", group: "Primary", shortcut: "Cmd+6", keywords: ["more", "utilities", "launcher"] },
  { id: "scheduler", label: "Schedules", detail: "Shared schedules and jobs", group: "Work", keywords: ["schedule", "scheduler", "jobs", "recurring"] },
  { id: "swarm", label: "Swarm", detail: "MiroShark simulations", group: "Work", keywords: ["swarm", "miroshark", "simulation", "rehearsal"] },
  { id: "history", label: "History", detail: "Completed work log", group: "Work", keywords: ["history", "done", "completed", "changelog"] },
  { id: "aeon", label: "Aeon", detail: "Autopilot runs and outputs", group: "Utilities", keywords: ["aeon", "autopilot", "unattended", "runs"] },
  { id: "integrations", label: "Integrations", detail: "Nango and external APIs", group: "Utilities", keywords: ["integrations", "nango", "api", "apps"] },
  { id: "my-apps", label: "Apps & Services", detail: "Running apps and providers", group: "Utilities", keywords: ["apps", "services", "providers"] },
  { id: "notifications", label: "Alerts", detail: "Agent notifications", group: "Utilities", keywords: ["alerts", "notifications", "inbox"] },
  { id: "env", label: "Env", detail: "Shared runtime variables", group: "Utilities", keywords: ["env", "secrets", "variables", "config"] },
  { id: "files", label: "Files", detail: "Scoped runtime files", group: "Utilities", keywords: ["files", "browser", "runtime files"] },
  { id: "sessions", label: "Sessions", detail: "Runtime transcript search", group: "Utilities", keywords: ["sessions", "search", "transcripts"] },
  { id: "tools", label: "Tools", detail: "Callable agent handles", group: "Utilities", keywords: ["tools", "handles", "capabilities"] },
  { id: "maintenance", label: "Diagnostics", detail: "Fleet checks and repairs", group: "Utilities", keywords: ["diagnostics", "maintenance", "repair", "health"] },
  { id: "memory", label: "Memory", detail: "Runtime memory telemetry", group: "Utilities", keywords: ["memory", "rss", "leaks", "telemetry"] },
  { id: "phone", label: "Phone", detail: "Call prompts", group: "Utilities", keywords: ["phone", "calls", "prompts"] },
];

export function isDashboardView(value: string): value is DashboardView {
  return DASHBOARD_VIEW_SET.has(value);
}

export function dashboardRouteForView(view: DashboardView) {
  return DASHBOARD_ROUTE_CATALOG.find((item) => item.id === view) ?? DASHBOARD_ROUTE_CATALOG[0];
}

export function dashboardTargetFromSearch(search: string): DashboardRouteTarget | null {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (!view || !isDashboardView(view)) return null;
  return {
    view,
    vaultPanel: params.get("vaultPanel") ?? undefined,
    agentId: params.get("agent") ?? undefined,
    taskId: params.get("task") ?? undefined,
    chatLeaf: params.get("chatLeaf") ?? undefined,
  };
}

export function dashboardUrlForTarget(target: DashboardRouteTarget, basePath = "/") {
  const params = new URLSearchParams();
  params.set("view", target.view);
  if (target.vaultPanel) params.set("vaultPanel", target.vaultPanel);
  if (target.agentId) params.set("agent", target.agentId);
  if (target.taskId) params.set("task", target.taskId);
  if (target.chatLeaf) params.set("chatLeaf", target.chatLeaf);
  return `${basePath}?${params.toString()}`;
}

export function dashboardTargetLabel(target: DashboardRouteTarget) {
  const route = dashboardRouteForView(target.view);
  if (target.taskId) return `${route.label} task`;
  if (target.agentId) return `${route.label} agent`;
  return route.label;
}
