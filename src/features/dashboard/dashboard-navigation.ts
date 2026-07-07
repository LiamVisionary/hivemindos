import type { DashboardView } from "@/features/dashboard/dashboard-types";

export const DASHBOARD_VIEWS = [
  "agents",
  "kanban",
  "scheduler",
  "swarm",
  "history",
  "wallet",
  "trade",
  "vault",
  "integrations",
  "maintenance",
  "sessions",
  "tools",
  "memory",
  "files",
  "notifications",
  "messaging",
  "chat",
  "more",
  "env",
  "my-apps",
  "phone",
  "aeon",
  "fusion",
  "governance",
] as const satisfies readonly DashboardView[];

const DASHBOARD_VIEW_SET = new Set<string>(DASHBOARD_VIEWS);

export type DashboardNavGroup = "Primary" | "Work" | "Utilities";

export type DashboardRouteTarget = {
  view: DashboardView;
  vaultPanel?: string;
  agentId?: string;
  taskId?: string;
  chatLeaf?: string;
  /** Deep-link intent: scroll the Work Board to `taskId` and open its
   * conversation (bee-piloted). Intentionally never serialized into URLs or
   * persisted routes, so restored sessions don't replay the flight. */
  openTask?: boolean;
};

export type DashboardRouteCatalogItem = {
  id: DashboardView;
  label: string;
  detail: string;
  group: DashboardNavGroup;
  shortcut?: string;
  keywords: string[];
};

export const DESKTOP_NAVIGATE_EVENT = "hivemindos:navigate";
export const DESKTOP_OPEN_PALETTE_EVENT = "hivemindos:open-command-palette";
export const DESKTOP_OPEN_POPOUT_EVENT = "hivemindos:open-popout";

/**
 * Single source of truth for every dashboard view. Everything the app knows
 * about a view's navigation surface hangs off this record: command-palette
 * copy (label/detail/keywords), the loading/route label, the app nav shelf
 * placement, and which shelf slot lights up while the view is active.
 *
 * Adding a DashboardView without an entry here is a compile error, which
 * replaces the old hand-synced registries (DASHBOARD_ROUTE_LABELS in
 * DashboardApp, GROUPS/resolveActive in AppNavShelf, MorePanel's target list).
 */
type DashboardRouteCatalogEntry = {
  label: string;
  /** Longer label for loading states and section headers when it differs from the nav label. */
  routeLabel?: string;
  detail: string;
  group: DashboardNavGroup;
  shortcut?: string;
  keywords: readonly string[];
  /** Present when the view is pinned to the app nav shelf; the number is the shelf section. */
  shelfGroup?: 0 | 1 | 2;
  /** Shelf item that lights up while this view is active. Defaults to the view itself when pinned, otherwise "more". */
  shelfSlot?: DashboardView;
};

const DASHBOARD_ROUTE_CATALOG_BY_ID = {
  agents: { label: "Fleet", detail: "Machines, agents, collectors", group: "Primary", shortcut: "Cmd+1", keywords: ["agents", "machines", "fleet", "collectors"], shelfSlot: "agents" },
  kanban: { label: "Work", detail: "Kanban board and active tasks", group: "Primary", shortcut: "Cmd+2", keywords: ["work", "tasks", "kanban", "board"], shelfGroup: 0 },
  vault: { label: "Brain", detail: "Shared vault, skills, graph", group: "Primary", shortcut: "Cmd+3", keywords: ["brain", "vault", "skills", "graph", "memory"], shelfGroup: 0 },
  chat: { label: "Chat", routeLabel: "Agent Chat", detail: "Talk with an agent", group: "Primary", shortcut: "Cmd+4", keywords: ["chat", "agent chat", "conversation"], shelfGroup: 0 },
  wallet: { label: "Wallets", detail: "Agent wallets and usage", group: "Primary", shortcut: "Cmd+5", keywords: ["wallet", "honey", "spend", "usage", "tokens"], shelfGroup: 0 },
  trade: { label: "Trade", detail: "Buy, sell, and swap crypto & stocks", group: "Primary", keywords: ["trade", "trading", "buy", "sell", "swap", "stock", "stocks", "shares", "crypto", "perps", "options", "polymarket", "bridge", "xstocks", "alpaca", "robinhood"], shelfGroup: 0 },
  governance: { label: "Companies", routeLabel: "Zero Human Company", detail: "Companies, budgets, spend approvals", group: "Utilities", keywords: ["zero human company", "zhc", "governance", "company", "companies", "budget", "approval", "approvals", "kill switch", "spend"], shelfGroup: 2 },
  more: { label: "More", detail: "Utility launcher", group: "Primary", shortcut: "Cmd+6", keywords: ["more", "utilities", "launcher"] },
  scheduler: { label: "Schedules", routeLabel: "Scheduler", detail: "Shared schedules and jobs", group: "Work", keywords: ["schedule", "scheduler", "jobs", "recurring"], shelfGroup: 1 },
  swarm: { label: "Swarm", detail: "MiroShark simulations", group: "Work", keywords: ["swarm", "miroshark", "simulation", "rehearsal"], shelfGroup: 1 },
  history: { label: "History", routeLabel: "Work History", detail: "Completed work log", group: "Work", keywords: ["history", "done", "completed", "changelog"], shelfGroup: 1 },
  aeon: { label: "Aeon", detail: "Autopilot runs and outputs", group: "Utilities", keywords: ["aeon", "autopilot", "unattended", "runs"], shelfGroup: 2 },
  fusion: { label: "Hive Fusion", detail: "Skill and workflow fusion", group: "Utilities", keywords: ["fusion", "skill fusion", "workflow fusion", "skill builder"] },
  integrations: { label: "Integrations", detail: "App connections and external APIs", group: "Utilities", keywords: ["integrations", "connections", "api", "apps"], shelfGroup: 2 },
  "my-apps": { label: "Apps & Services", detail: "Running apps and providers", group: "Utilities", keywords: ["apps", "services", "providers"], shelfSlot: "integrations" },
  notifications: { label: "Alerts", detail: "Agent notifications, approvals, decisions", group: "Utilities", keywords: ["alerts", "notifications", "approval", "approvals", "decisions"], shelfGroup: 1 },
  messaging: { label: "Messaging", detail: "Agent messaging channels", group: "Utilities", keywords: ["messaging", "telegram", "discord", "imessage", "channels", "alerts"] },
  env: { label: "Env", detail: "Shared runtime variables", group: "Utilities", keywords: ["env", "secrets", "variables", "config"] },
  files: { label: "Files", detail: "Scoped runtime files", group: "Utilities", keywords: ["files", "browser", "runtime files"] },
  sessions: { label: "Sessions", detail: "Runtime transcript search", group: "Utilities", keywords: ["sessions", "search", "transcripts"] },
  tools: { label: "Capability Store", detail: "Callable agent capabilities and handles", group: "Utilities", keywords: ["tools", "handles", "capabilities", "capability store", "skills"] },
  maintenance: { label: "Diagnostics", detail: "Fleet checks and repairs", group: "Utilities", keywords: ["diagnostics", "maintenance", "repair", "health"] },
  memory: { label: "Memory", detail: "Runtime memory telemetry", group: "Utilities", keywords: ["memory", "rss", "leaks", "telemetry"] },
  phone: { label: "Phone", detail: "Call prompts", group: "Utilities", keywords: ["phone", "calls", "prompts"] },
} as const satisfies Record<DashboardView, DashboardRouteCatalogEntry>;

/** Command-palette / catalog display order. Completeness is proven at compile time below. */
const DASHBOARD_ROUTE_ORDER = [
  "agents",
  "kanban",
  "vault",
  "chat",
  "wallet",
  "trade",
  "governance",
  "more",
  "scheduler",
  "notifications",
  "swarm",
  "history",
  "aeon",
  "fusion",
  "integrations",
  "my-apps",
  "messaging",
  "env",
  "files",
  "sessions",
  "tools",
  "maintenance",
  "memory",
  "phone",
] as const satisfies readonly DashboardView[];

type DashboardViewMissingFromRouteOrder = Exclude<DashboardView, (typeof DASHBOARD_ROUTE_ORDER)[number]>;
// Compile-time proof DASHBOARD_ROUTE_ORDER covers every DashboardView: when a
// view is missing, this assignment fails and the error names the missing ids.
const _dashboardRouteOrderComplete: DashboardViewMissingFromRouteOrder extends never ? true : DashboardViewMissingFromRouteOrder = true;
void _dashboardRouteOrderComplete;

if (process.env.NODE_ENV !== "production" && new Set<string>(DASHBOARD_ROUTE_ORDER).size !== DASHBOARD_ROUTE_ORDER.length) {
  throw new Error("DASHBOARD_ROUTE_ORDER contains duplicate view ids");
}

export const DASHBOARD_ROUTE_CATALOG: DashboardRouteCatalogItem[] = DASHBOARD_ROUTE_ORDER.map((id) => {
  const entry = DASHBOARD_ROUTE_CATALOG_BY_ID[id] as DashboardRouteCatalogEntry;
  return {
    id,
    label: entry.label,
    detail: entry.detail,
    group: entry.group,
    ...(entry.shortcut ? { shortcut: entry.shortcut } : {}),
    keywords: [...entry.keywords],
  };
});

/** Route/loading label per view ("Loading Work History"), derived from the catalog. */
export const DASHBOARD_ROUTE_LABELS = Object.fromEntries(
  DASHBOARD_VIEWS.map((view) => {
    const entry = DASHBOARD_ROUTE_CATALOG_BY_ID[view] as DashboardRouteCatalogEntry;
    return [view, entry.routeLabel ?? entry.label];
  }),
) as Record<DashboardView, string>;

export type AppNavShelfItem = { id: DashboardView; label: string };

/** The app nav shelf's pinned sections, derived from shelfGroup in catalog order. */
export const APP_NAV_SHELF_GROUPS: AppNavShelfItem[][] = [0, 1, 2].map((groupIndex) =>
  DASHBOARD_ROUTE_ORDER.filter((id) => (DASHBOARD_ROUTE_CATALOG_BY_ID[id] as DashboardRouteCatalogEntry).shelfGroup === groupIndex).map((id) => ({
    id,
    label: (DASHBOARD_ROUTE_CATALOG_BY_ID[id] as DashboardRouteCatalogEntry).label,
  })),
);

/** Which shelf slot lights up for the current dashboard view ("agents" = the brand button). */
export function shelfSlotForView(view: DashboardView): DashboardView {
  const entry = DASHBOARD_ROUTE_CATALOG_BY_ID[view] as DashboardRouteCatalogEntry;
  if (entry.shelfSlot) return entry.shelfSlot;
  if (entry.shelfGroup !== undefined) return view;
  return "more";
}

/** Views that belong to the More menu's utility launcher, in catalog order. */
export type DashboardUtilityView = {
  [K in DashboardView]: (typeof DASHBOARD_ROUTE_CATALOG_BY_ID)[K]["group"] extends "Utilities" ? K : never;
}[DashboardView];

export const DASHBOARD_UTILITY_VIEWS = DASHBOARD_ROUTE_ORDER.filter(
  (id): id is DashboardUtilityView => (DASHBOARD_ROUTE_CATALOG_BY_ID[id] as DashboardRouteCatalogEntry).group === "Utilities",
);

export function isDashboardView(value: string): value is DashboardView {
  return DASHBOARD_VIEW_SET.has(value);
}

export function dashboardRouteForView(view: DashboardView) {
  return DASHBOARD_ROUTE_CATALOG.find((item) => item.id === view) ?? DASHBOARD_ROUTE_CATALOG[0];
}

export function dashboardTargetFromSearch(search: string): DashboardRouteTarget | null {
  const params = new URLSearchParams(search);
  const viewParam = params.get("view");
  if (!viewParam || !isDashboardView(viewParam)) return null;
  return {
    view: viewParam,
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
