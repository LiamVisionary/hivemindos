import type { DashboardView } from "@/features/dashboard/dashboard-types";

export const DASHBOARD_VIEWS = [
  "agents",
  "kanban",
  "scheduler",
  "swarm",
  "history",
  "wallet",
  "trade",
  "socials",
  "marketplace",
  "vault",
  "integrations",
  "beeline",
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
  "mini-apps",
  "phone",
  "aeon",
  "fusion",
  "governance",
  "cloud",
  "compute",
  "credit-admin",
] as const satisfies readonly DashboardView[];

const DASHBOARD_VIEW_SET = new Set<string>(DASHBOARD_VIEWS);

export type DashboardNavGroup = "Primary" | "Work" | "Utilities";

export type DashboardRouteTarget = {
  view: DashboardView;
  vaultPanel?: string;
  agentId?: string;
  taskId?: string;
  chatLeaf?: string;
  integration?: string;
  integrationTab?: "connect" | "actions";
  integrationAction?: string;
  integrationsTab?: "connections" | "mcp" | "xbot" | "transcript" | "codeproof";
  /** Deep-link intent: scroll the Work Board to `taskId` and open its
   * conversation (bee-piloted). Intentionally never serialized into URLs or
   * persisted routes, so restored sessions don't replay the flight. */
  openTask?: boolean;
  /** This URL belongs to a popped-out satellite window: the dashboard renders
   * chrome-free (no nav rail, no brain inspector). Carried in popout-window
   * URLs so a hard refresh keeps the mode; never written to persisted routes
   * or recents, so the main window can't restore into it. */
  popout?: boolean;
};

export type DashboardRouteCatalogItem = {
  id: DashboardView;
  label: string;
  detail: string;
  group: DashboardNavGroup;
  shortcut?: string;
  keywords: string[];
};

/** Where the pointer "holds" a popped-out browser window relative to its
 * top-left corner — used both to place the popup at the drop point and to
 * keep it under the cursor during a live drag-out. Mirrored by the native
 * side in desktop_navigation.rs. */
export const POPOUT_GRAB_OFFSET_X = 160;
export const POPOUT_GRAB_OFFSET_Y = 24;

/** Minimal handle for keeping a just-popped-out window under the cursor
 * during a live drag-out. A browser popup Window satisfies it structurally;
 * the native path implements it with cursor-follow IPC pings (which ignore
 * the passed coordinates and read the OS cursor instead). */
export type PopoutFollowHandle = { closed: boolean; moveTo: (x: number, y: number) => void };

export const DESKTOP_NAVIGATE_EVENT = "hivemindos:navigate";
export const DESKTOP_OPEN_PALETTE_EVENT = "hivemindos:open-command-palette";
export const DESKTOP_OPEN_POPOUT_EVENT = "hivemindos:open-popout";
export const DASHBOARD_TARGET_APPLIED_EVENT = "hivemindos:dashboard-target-applied";

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
  trade: { label: "Trade", detail: "Crypto, stocks, and on-chain options", group: "Primary", keywords: ["trade", "trading", "buy", "sell", "swap", "stock", "stocks", "shares", "crypto", "perps", "options", "plume", "polymarket", "bridge", "xstocks", "alpaca", "robinhood"], shelfGroup: 0 },
  socials: { label: "Socials", detail: "Social accounts, posting queue, voice, analytics", group: "Primary", keywords: ["socials", "social", "x", "twitter", "telegram", "farcaster", "linkedin", "reddit", "post", "posting", "queue", "voice", "soul", "analytics"], shelfGroup: 0 },
  marketplace: { label: "Marketplace", detail: "List, price, and sell items with an agent managing the lifecycle", group: "Utilities", keywords: ["marketplace", "facebook", "listing", "listings", "sell", "selling", "offers", "buyers", "price research", "car"] },
  governance: { label: "Companies", routeLabel: "Zero Human Company", detail: "Companies, budgets, spend approvals", group: "Utilities", keywords: ["zero human company", "zhc", "governance", "company", "companies", "budget", "approval", "approvals", "kill switch", "spend"], shelfGroup: 2 },
  cloud: { label: "Cloud Agents", detail: "Always-on managed Hermes agents", group: "Utilities", keywords: ["cloud", "managed agents", "hosted agents", "always on", "hermes", "pay as you go"], shelfGroup: 2 },
  more: { label: "More", detail: "Utility launcher", group: "Primary", shortcut: "Cmd+6", keywords: ["more", "utilities", "launcher"] },
  scheduler: { label: "Automations", routeLabel: "Scheduler", detail: "Recurring automations for your agents", group: "Work", keywords: ["schedule", "scheduler", "jobs", "recurring", "automation", "automations"], shelfGroup: 1 },
  swarm: { label: "Simulations", detail: "MiroShark simulations", group: "Work", keywords: ["swarm", "miroshark", "simulation", "rehearsal"], shelfGroup: 1 },
  history: { label: "History", routeLabel: "Work History", detail: "Completed work log", group: "Work", keywords: ["history", "done", "completed", "changelog"], shelfGroup: 1 },
  aeon: { label: "Aeon", detail: "Autopilot runs and outputs", group: "Utilities", keywords: ["aeon", "autopilot", "unattended", "runs"], shelfGroup: 2 },
  fusion: { label: "Hive Fusion", detail: "Skill and workflow fusion", group: "Utilities", keywords: ["fusion", "skill fusion", "workflow fusion", "skill builder"] },
  compute: { label: "Hive Compute", detail: "Marketplace GPU inference and spare-GPU earning", group: "Utilities", keywords: ["compute", "gpu", "marketplace", "inference", "worker", "ollama", "earn", "rent", "models"] },
  podcast: { label: "Podcast", detail: "Turn sources into a two-host deep dive", group: "Utilities", keywords: ["podcast", "audio", "deep dive", "notebooklm", "notebook lm", "voice", "listen", "episode", "narration"] },
  integrations: { label: "Integrations", detail: "App connections and external APIs", group: "Utilities", keywords: ["integrations", "connections", "api", "apps"], shelfGroup: 2 },
  beeline: { label: "Beeline", detail: "Family profiles and delegated accounts", group: "Utilities", keywords: ["beeline", "family", "mom", "parent", "delegated accounts", "chrome profile", "oauth", "mcp"] },
  "my-apps": { label: "Apps & Services", detail: "Running apps and providers", group: "Utilities", keywords: ["apps", "services", "providers"], shelfSlot: "integrations" },
  "mini-apps": { label: "Mini Apps", routeLabel: "HivemindOS Mini Apps", detail: "Focused experiences powered by coordinated agent crews", group: "Utilities", keywords: ["mini apps", "hivemindos mini apps", "hosted apps", "hive research", "research"] },
  notifications: { label: "Alerts", detail: "Agent notifications, approvals, decisions", group: "Utilities", keywords: ["alerts", "notifications", "approval", "approvals", "decisions"], shelfSlot: "notifications" },
  messaging: { label: "Messaging", detail: "Agent messaging channels", group: "Utilities", keywords: ["messaging", "telegram", "discord", "imessage", "channels", "alerts"] },
  env: { label: "Env", detail: "Shared runtime variables", group: "Utilities", keywords: ["env", "secrets", "variables", "config"] },
  files: { label: "Files", detail: "Scoped runtime files", group: "Utilities", keywords: ["files", "browser", "runtime files"] },
  sessions: { label: "Sessions", detail: "Runtime transcript search", group: "Utilities", keywords: ["sessions", "search", "transcripts"] },
  tools: { label: "Capability Store", detail: "Callable agent capabilities and handles", group: "Utilities", keywords: ["tools", "handles", "capabilities", "capability store", "skills"] },
  maintenance: { label: "Diagnostics", detail: "Fleet checks and repairs", group: "Utilities", keywords: ["diagnostics", "maintenance", "repair", "health"] },
  memory: { label: "Telemetry", detail: "Fleet resource monitor — CPU, memory, disk, network", group: "Utilities", keywords: ["telemetry", "resources", "cpu", "memory", "ram", "disk", "network", "processes", "machines", "load", "monitor"] },
  phone: { label: "Phone", detail: "Call prompts", group: "Utilities", keywords: ["phone", "calls", "prompts"] },
  "credit-admin": { label: "Credit Accounts", routeLabel: "HivemindOS Credit Accounts", detail: "View and fund internal service credit accounts", group: "Utilities", keywords: ["credit", "credits", "accounts", "fund", "funding", "balance", "service account", "top up", "admin", "rail"] },
} as const satisfies Record<DashboardView, DashboardRouteCatalogEntry>;

/** Command-palette / catalog display order. Completeness is proven at compile time below. */
const DASHBOARD_ROUTE_ORDER = [
  "agents",
  "kanban",
  "vault",
  "chat",
  "wallet",
  "trade",
  "socials",
  "marketplace",
  "governance",
  "cloud",
  "more",
  "scheduler",
  "notifications",
  "swarm",
  "history",
  "aeon",
  "fusion",
  "compute",
  "podcast",
  "integrations",
  "beeline",
  "my-apps",
  "mini-apps",
  "messaging",
  "env",
  "files",
  "sessions",
  "tools",
  "maintenance",
  "memory",
  "phone",
  "credit-admin",
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

function shelfItemFor(id: DashboardView): AppNavShelfItem {
  return { id, label: (DASHBOARD_ROUTE_CATALOG_BY_ID[id] as DashboardRouteCatalogEntry).label };
}

/** Alerts is fixed as the final main rail item (never pinnable). */
const FIXED_FINAL_SHELF_VIEWS = ["notifications"] as const satisfies readonly DashboardView[];

/**
 * Primary/Work rail views the user can remove (Wallets, Trade, Swarm). Unlike
 * opt-in utility pins, these were always on the rail, so they are OPT-OUT:
 * shown by default and only hidden once the user explicitly removes one
 * (tracked in a separate "removed" set). This keeps them on the rail even when
 * an older persisted pinned-utility list — written before they were removable —
 * doesn't mention them.
 */
const REMOVABLE_RAIL_VIEWS = ["wallet", "trade", "socials", "swarm"] as const satisfies readonly DashboardView[];
const REMOVABLE_RAIL_SET = new Set<DashboardView>(REMOVABLE_RAIL_VIEWS);

export function isRemovableRailView(view: DashboardView): boolean {
  return REMOVABLE_RAIL_SET.has(view);
}

/** Utilities the user can pin to the rail (opt-in); Alerts is fixed, not pinnable. */
const PINNABLE_UTILITY_VIEWS: DashboardView[] = DASHBOARD_ROUTE_ORDER.filter(
  (id) => (DASHBOARD_ROUTE_CATALOG_BY_ID[id] as DashboardRouteCatalogEntry).group === "Utilities" && id !== "notifications",
);
const PINNABLE_UTILITY_SET = new Set<DashboardView>(PINNABLE_UTILITY_VIEWS);

/** Every view that shows a pin control in the More launcher (opt-in utilities + opt-out rail views). */
const PINNABLE_SET = new Set<DashboardView>([...PINNABLE_UTILITY_VIEWS, ...REMOVABLE_RAIL_VIEWS]);

export function isPinnableView(view: DashboardView): boolean {
  return PINNABLE_SET.has(view);
}

/** Which rail section a view calls home: its shelfGroup, else the Utilities section. */
function homeShelfSection(view: DashboardView): 0 | 1 | 2 | undefined {
  const entry = DASHBOARD_ROUTE_CATALOG_BY_ID[view] as DashboardRouteCatalogEntry;
  if (entry.shelfGroup !== undefined) return entry.shelfGroup;
  if (entry.group === "Utilities") return 2;
  return undefined;
}

/** Keep the default rail focused; optional destinations stay discoverable in More until pinned. */
export const DEFAULT_PINNED_VIEWS: DashboardView[] = [];

/** Removable destinations also start in More so a new workspace has seven stable top-level routes. */
export const DEFAULT_REMOVED_RAIL_VIEWS: DashboardView[] = [...REMOVABLE_RAIL_VIEWS];

/**
 * Sentinel for "the user explicitly pinned no utilities". A cleared utilities
 * list must serialize to a non-empty, non-view token so it (a) is
 * distinguishable from "never set" (which seeds the defaults) even if the
 * default set changes later. It is not a valid DashboardView, so parse yields [].
 */
export const PINNED_UTILITIES_NONE = "__none__";

function dedupeViews(raw: string, allowed: ReadonlySet<DashboardView>): DashboardView[] {
  const seen = new Set<DashboardView>();
  const out: DashboardView[] = [];
  for (const token of raw.split(",")) {
    const id = token.trim();
    if (isDashboardView(id) && allowed.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Parse the persisted pinned-UTILITIES value (opt-in): unset -> defaults, sentinel -> []. */
export function parsePinnedUtilities(raw: string | null | undefined): DashboardView[] {
  if (raw == null || raw === "") return [...DEFAULT_PINNED_VIEWS];
  if (raw.trim() === PINNED_UTILITIES_NONE) return [];
  return dedupeViews(raw, PINNABLE_UTILITY_SET);
}

/** Serialize a pinned-utilities list (empty -> sentinel so "cleared" survives reload). */
export function serializePinnedUtilities(views: readonly DashboardView[]): string {
  const filtered = views.filter((id) => PINNABLE_UTILITY_SET.has(id));
  return filtered.length ? filtered.join(",") : PINNED_UTILITIES_NONE;
}

/** Parse persisted removals: unset seeds the focused default, while an explicit empty string means show all. */
export function parseRemovedRailViews(raw: string | null | undefined): DashboardView[] {
  if (raw == null) return [...DEFAULT_REMOVED_RAIL_VIEWS];
  if (raw === "") return [];
  return dedupeViews(raw, REMOVABLE_RAIL_SET);
}

/** Serialize the removed-rail-views set (empty -> "" = show every removable route). */
export function serializeRemovedRailViews(views: readonly DashboardView[]): string {
  return views.filter((id) => REMOVABLE_RAIL_SET.has(id)).join(",");
}

/** Toggle one view in a list (add to the end, or remove). */
export function togglePinnedUtility(views: readonly DashboardView[], id: DashboardView): DashboardView[] {
  return views.includes(id) ? views.filter((view) => view !== id) : [...views, id];
}

/**
 * The unified set of views pinned to the rail's customizable slots: the user's
 * opt-in utilities plus the removable rail views they haven't removed, in
 * catalog order. The rail and the More launcher's Pinned row consume this; the
 * two persisted CSVs behind it are managed by the usePinnedUtilities hook.
 */
export function computeRailPinnedViews(
  pinnedUtilitiesCsv: string | null | undefined,
  removedRailCsv: string | null | undefined,
): DashboardView[] {
  const pinnedUtil = new Set(parsePinnedUtilities(pinnedUtilitiesCsv));
  const removed = new Set(parseRemovedRailViews(removedRailCsv));
  return DASHBOARD_ROUTE_ORDER.filter(
    (id) => (PINNABLE_UTILITY_SET.has(id) && pinnedUtil.has(id)) || (REMOVABLE_RAIL_SET.has(id) && !removed.has(id)),
  );
}

/** Default rail-pinned views (no customization): default utilities + all removable rail views. */
const DEFAULT_RAIL_PINNED_VIEWS = computeRailPinnedViews(null, null);

/**
 * The app nav shelf's three sections. Fixed items (Fleet/Work/Brain/Chat,
 * Schedules, History, and the final Alerts) always appear; each pinned view
 * renders in its home section in catalog order — so unpinning Wallets/Trade/
 * Swarm (or any pinned utility) removes it in place without reordering the rail.
 */
export function buildAppNavShelfGroups(pinned?: readonly DashboardView[]): AppNavShelfItem[][] {
  const pinnedSet = new Set((pinned ?? DEFAULT_RAIL_PINNED_VIEWS).filter((id) => PINNABLE_SET.has(id)));
  const finalSet = new Set<DashboardView>(FIXED_FINAL_SHELF_VIEWS);
  const sections: DashboardView[][] = [[], [], []];
  for (const id of DASHBOARD_ROUTE_ORDER) {
    if (finalSet.has(id)) continue; // appended last, below
    const section = homeShelfSection(id);
    if (section === undefined) continue;
    if (PINNABLE_SET.has(id)) {
      if (pinnedSet.has(id)) sections[section].push(id);
    } else {
      sections[section].push(id); // always-fixed rail view
    }
  }
  for (const id of FIXED_FINAL_SHELF_VIEWS) {
    sections[homeShelfSection(id) ?? 2].push(id);
  }
  return sections.map((ids) => ids.map(shelfItemFor));
}

/** Default shelf layout (no user customization) — kept for callers that don't thread pins. */
export const APP_NAV_SHELF_GROUPS: AppNavShelfItem[][] = buildAppNavShelfGroups();

/** Which shelf slot lights up for the current dashboard view ("agents" = the brand button). */
export function shelfSlotForView(view: DashboardView): DashboardView {
  const entry = DASHBOARD_ROUTE_CATALOG_BY_ID[view] as DashboardRouteCatalogEntry;
  if (entry.shelfSlot) return entry.shelfSlot;
  if (entry.shelfGroup !== undefined) return view;
  return "more";
}

/**
 * Resolve the rail item to highlight for `view`, given the currently-rendered
 * shelf items (fixed groups + pinned utilities). A pinned utility highlights
 * itself; a view whose canonical shelf slot isn't currently on the rail falls
 * back to the More button.
 */
export function resolveActiveShelfSlot(view: DashboardView, renderedIds: ReadonlySet<DashboardView>): DashboardView {
  if (renderedIds.has(view)) return view;
  const slot = shelfSlotForView(view);
  if (slot === "agents" || slot === "more") return slot;
  return renderedIds.has(slot) ? slot : "more";
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
    integration: params.get("integration") ?? undefined,
    integrationTab: params.get("integrationTab") === "actions"
      ? "actions"
      : params.get("integrationTab") === "connect"
        ? "connect"
        : undefined,
    integrationAction: params.get("integrationAction") ?? undefined,
    integrationsTab: (["connections", "mcp", "xbot", "transcript", "codeproof"] as const)
      .find((tab) => tab === params.get("tab")),
    popout: params.get("popout") === "1" || undefined,
  };
}

export function dashboardUrlForTarget(target: DashboardRouteTarget, basePath = "/") {
  const params = new URLSearchParams();
  params.set("view", target.view);
  if (target.vaultPanel) params.set("vaultPanel", target.vaultPanel);
  if (target.agentId) params.set("agent", target.agentId);
  if (target.taskId) params.set("task", target.taskId);
  if (target.chatLeaf) params.set("chatLeaf", target.chatLeaf);
  if (target.integration) params.set("integration", target.integration);
  if (target.integrationTab) params.set("integrationTab", target.integrationTab);
  if (target.integrationAction) params.set("integrationAction", target.integrationAction);
  if (target.integrationsTab) params.set("tab", target.integrationsTab);
  if (target.popout) params.set("popout", "1");
  return `${basePath}?${params.toString()}`;
}

export function dashboardTargetLabel(target: DashboardRouteTarget) {
  const route = dashboardRouteForView(target.view);
  if (target.taskId) return `${route.label} task`;
  if (target.agentId) return `${route.label} agent`;
  return route.label;
}
