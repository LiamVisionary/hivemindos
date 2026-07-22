"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Activity, AppWindow, Bell, Bot, Boxes, ChevronRight, Cloud, Coins, Cpu, FolderOpen, HeartHandshake, KeyRound, Kanban, LayoutGrid, List, Landmark, MessageSquare, Mic, Network, PhoneCall, Pin, PinOff, PlugZap, Search, Share2, ShieldCheck, Sparkles, TrendingUp, Wallet, Wrench, X } from "lucide-react";

import type { DashboardUtilityView } from "@/features/dashboard/dashboard-navigation";
import { isPinnableView } from "@/features/dashboard/dashboard-navigation";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import styles from "./MorePanel.module.css";

// The More menu's navigable set is the catalog's Utilities group plus the
// removable Primary/Work rail views (Wallets, Trade, Swarm); "stake" is a
// standalone route rather than a dashboard view.
type MorePanelTarget = DashboardUtilityView | "wallet" | "trade" | "socials" | "swarm";
type MoreItemId = MorePanelTarget | "stake";

type BadgeTone = "honey" | "live" | "danger" | "neutral";
type DotTone = "honey" | "live" | "danger";

type MoreItem = {
  id: MoreItemId;
  icon: ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  keywords: string;
  badge?: string;
  badgeTone?: BadgeTone;
  dot?: DotTone;
  /** Present for the standalone /stake route (not a dashboard view). */
  href?: string;
};

// Five grouped sections shown under "Browse all". The compile-time guard below
// proves every Utilities view AND every removable rail view has a card, so any
// pinnable view always has a management tile here (add a view -> compile error
// until it gets one; this is how a previously-unreachable view surfaces).
const MORE_GROUP_DEFS = [
  { name: "Build & automate", ids: ["mini-apps", "fusion", "aeon", "swarm", "podcast"] },
  { name: "Money & governance", ids: ["wallet", "trade", "marketplace", "governance", "cloud", "compute", "credit-admin", "stake"] },
  { name: "Fleet health", ids: ["maintenance", "memory", "sessions", "tools"] },
  { name: "Connections", ids: ["socials", "integrations", "beeline", "my-apps", "messaging", "phone"] },
  { name: "Data & access", ids: ["env", "files", "notifications"] },
] as const satisfies ReadonlyArray<{ name: string; ids: readonly MoreItemId[] }>;

type GroupedItemId = (typeof MORE_GROUP_DEFS)[number]["ids"][number];
type RequiredMoreItemId = DashboardUtilityView | "wallet" | "trade" | "socials" | "swarm";
type MissingFromMoreGroups = Exclude<RequiredMoreItemId, GroupedItemId>;
// Compile-time proof the grouped cards cover every Utilities view + removable rail view.
const _moreGroupsComplete: MissingFromMoreGroups extends never ? true : MissingFromMoreGroups = true;
void _moreGroupsComplete;

const VIEW_MODES = ["board", "grid", "list"] as const;
type ViewMode = (typeof VIEW_MODES)[number];
const VIEW_MODE_STATE_KEY = "hivemindos.more.viewMode";

function toneStyle(tone: BadgeTone): CSSProperties {
  switch (tone) {
    case "danger":
      return { background: "color-mix(in srgb, var(--danger) 16%, transparent)", color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 34%, transparent)" };
    case "live":
      return { background: "var(--live-soft)", color: "var(--live)", borderColor: "color-mix(in srgb, var(--live) 34%, transparent)" };
    case "neutral":
      return { background: "color-mix(in srgb, var(--m-muted) 12%, transparent)", color: "var(--m-muted)", borderColor: "var(--m-line)" };
    default:
      return { background: "color-mix(in srgb, var(--honey) 15%, transparent)", color: "var(--honey)", borderColor: "var(--comb-line)" };
  }
}

function dotColor(tone: DotTone): string {
  return tone === "danger" ? "var(--danger)" : tone === "honey" ? "var(--honey)" : "var(--live)";
}

// The icon tile shared by every view mode. Tokens (--m-*) are theme-aware and
// defined on `.root`: in dark, a warm-neutral cell (like the Fleet Hive view's
// resting cells) with a teal glyph; in hive-light, the warm-honey tile. Applied
// inline so they win over `.commandMain`'s hive-light element overrides.
const ICON_BOX_STYLE: CSSProperties = {
  background: "var(--m-tile-fill)",
  border: "1px solid var(--m-tile-border)",
  color: "var(--m-tile-ink)",
};

// Active/pinned controls carry the accent (teal in dark, honey in light); the
// resting pin is a quiet neutral outline.
function pinButtonStyle(pinned: boolean): CSSProperties {
  return pinned
    ? { background: "var(--m-active-bg)", border: "1px solid var(--m-active-border)", color: "var(--m-active-ink)" }
    : { background: "transparent", border: "1px solid var(--m-line)", color: "var(--m-muted)" };
}

export type MorePanelProps = {
  sharedEnvCount?: number;
  maintenanceOk?: boolean;
  runtimeFileRootCount: number;
  notificationUnread: number;
  notificationTotal: number;
  memoryRssMb?: number;
  /** Utility views currently pinned to the nav rail (see AppNavShelf). */
  pinnedViews: DashboardView[];
  onTogglePin: (id: DashboardView) => void;
  onNavigate: (target: MorePanelTarget) => void;
};

export function MorePanel({
  sharedEnvCount,
  maintenanceOk,
  runtimeFileRootCount,
  notificationUnread,
  notificationTotal,
  memoryRssMb,
  pinnedViews,
  onTogglePin,
  onNavigate,
}: MorePanelProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [viewModeRaw, rememberViewMode] = useRememberedDashboardValue(VIEW_MODE_STATE_KEY, "board");
  const viewMode: ViewMode = (VIEW_MODES as readonly string[]).includes(viewModeRaw) ? (viewModeRaw as ViewMode) : "board";

  // Pending spend-approval count for the governance badge — fetched once when
  // the More view mounts (same-origin, session-authed like the other panels).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/wallet/approvals?status=pending", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { approvals?: unknown[] } | null) => {
        if (!cancelled && Array.isArray(data?.approvals)) setPendingApprovals(data.approvals.length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Press "/" to focus the utility search (only while typing isn't already
  // happening elsewhere). Scoped to this view since the panel only mounts here.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pinnedSet = useMemo(() => new Set(pinnedViews), [pinnedViews]);

  const items = useMemo<Record<MoreItemId, MoreItem>>(() => {
    const approvalBadge = pendingApprovals && pendingApprovals > 0
      ? { badge: `${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"}`, badgeTone: "honey" as BadgeTone }
      : {};
    const rss = memoryRssMb ? Math.round(memoryRssMb) : 0;
    const maintenanceBadge = maintenanceOk === true
      ? { badge: "All clear", badgeTone: "live" as BadgeTone, dot: "live" as DotTone }
      : maintenanceOk === false
        ? { badge: "Needs checks", badgeTone: "danger" as BadgeTone, dot: "danger" as DotTone }
        : {};
    const notifBadge = notificationUnread > 0
      ? { badge: `${notificationUnread} unread`, badgeTone: "danger" as BadgeTone, dot: "danger" as DotTone }
      : {};

    return {
      "mini-apps": { id: "mini-apps", icon: <Boxes aria-hidden="true" />, eyebrow: "Focused hive experiences", title: "HivemindOS Mini Apps", body: "Open purpose-built experiences powered by coordinated agent crews, starting with Hive Research.", keywords: "mini apps hivemindos hosted hive research research crews", dot: "live" },
      fusion: { id: "fusion", icon: <Sparkles aria-hidden="true" />, eyebrow: "Skill builder", title: "Hive Skill Fusion", body: "Create reusable skills from skills, tools, apps, agents, and workflows.", keywords: "fusion skill workflow builder reusable" },
      aeon: { id: "aeon", icon: <Bot aria-hidden="true" />, eyebrow: "Autopilot", title: "Aeon", body: "Manage unattended skills, schedules, workflow runs, and outputs.", keywords: "aeon autopilot unattended runs outputs", dot: "live" },
      swarm: { id: "swarm", icon: <Network aria-hidden="true" />, eyebrow: "Simulations", title: "Simulations", body: "Run MiroShark agent simulations and rehearsals.", keywords: "swarm miroshark simulation rehearsal" },
      podcast: { id: "podcast", icon: <Mic aria-hidden="true" />, eyebrow: "Deep dive audio", title: "Podcast", body: "Turn any source material into a grounded two-host podcast you can listen to.", keywords: "podcast audio deep dive notebooklm listen episode narration voice" },
      wallet: { id: "wallet", icon: <Wallet aria-hidden="true" />, eyebrow: "Agent money rails", title: "Wallets", body: "Manage agent wallets, balances, budgets, and usage.", keywords: "wallet wallets honey spend usage tokens balance budget" },
      trade: { id: "trade", icon: <TrendingUp aria-hidden="true" />, eyebrow: "Crypto & stocks", title: "Trade", body: "Buy, sell, and swap crypto and stocks with preview-and-confirm.", keywords: "trade trading buy sell swap crypto stocks perps polymarket" },
      socials: { id: "socials", icon: <Share2 aria-hidden="true" />, eyebrow: "Social command center", title: "Socials", body: "Connect social accounts, manage posting voice and queue, and track performance.", keywords: "socials social x twitter telegram farcaster linkedin reddit post queue voice analytics" },
      marketplace: { id: "marketplace", icon: <LayoutGrid aria-hidden="true" />, eyebrow: "Selling agent", title: "Marketplace", body: "List items with photos and a description, let the Queen research pricing, and have an agent manage buyers end to end.", keywords: "marketplace facebook listing listings sell selling offers buyers price research car" },
      governance: { id: "governance", icon: <Landmark aria-hidden="true" />, eyebrow: "Companies & budgets", title: "Zero Human Company", body: "Group agents into companies, set budgets and kill switches, and clear spend approvals.", keywords: "governance company companies budget approvals kill switch zhc", ...approvalBadge },
      cloud: { id: "cloud", icon: <Cloud aria-hidden="true" />, eyebrow: "Always-on Hermes", title: "Managed Cloud Agents", body: "Deploy dedicated pay-as-you-go agents with persistent workspaces that run while your computers are off.", keywords: "cloud managed hosted always on hermes pay as you go deploy", dot: "live" },
      compute: { id: "compute", icon: <Cpu aria-hidden="true" />, eyebrow: "GPU marketplace", title: "Hive Compute", body: "Route model calls through marketplace GPUs or install a worker to earn from spare local GPU capacity.", keywords: "compute gpu marketplace inference worker ollama earn rent models" },
      "credit-admin": { id: "credit-admin", icon: <Coins aria-hidden="true" />, eyebrow: "Service credits", title: "Credit Accounts", body: "View every internal prepaid credit account and its balance, and fund any of them directly.", keywords: "credit credits accounts fund funding balance service account top up admin rail" },
      stake: { id: "stake", icon: <Coins aria-hidden="true" />, eyebrow: "Community tiers", title: "Stake HIVE", body: "Lock HIVE for Holder–Visionary status, alpha rooms, governance, and curator rights.", keywords: "stake hive holder visionary alpha governance curator", href: "/stake" },
      maintenance: { id: "maintenance", icon: <ShieldCheck aria-hidden="true" />, eyebrow: "Fleet checks", title: "Diagnostics", body: "Run dashboard and runtime health checks.", keywords: "diagnostics maintenance health checks repair", ...maintenanceBadge },
      memory: { id: "memory", icon: <Activity aria-hidden="true" />, eyebrow: rss ? `${rss} MB RSS` : "Review queue", title: "Memory & Review", body: "Review brain writes, inspect Context X-Ray evidence, and compare harness experiments.", keywords: "memory review rss telemetry context x-ray harness experiments brain writes", ...(rss ? { badge: `${rss} MB`, badgeTone: "honey" as BadgeTone } : {}) },
      sessions: { id: "sessions", icon: <Search aria-hidden="true" />, eyebrow: "Runtime memory", title: "Sessions", body: "Search readable Hermes and OpenClaw conversations from one place.", keywords: "sessions search transcripts hermes openclaw conversations" },
      tools: { id: "tools", icon: <Wrench aria-hidden="true" />, eyebrow: "Capabilities", title: "Capability Store", body: "Review built-in, runtime, app, and mini-app handles agents can invoke.", keywords: "tools capabilities handles capability store skills" },
      integrations: { id: "integrations", icon: <PlugZap aria-hidden="true" />, eyebrow: "App connections", title: "Integrations", body: "Connect GitHub, Linear, Slack, Notion, and Google for the whole hive.", keywords: "integrations connections api apps github linear slack notion google" },
      beeline: { id: "beeline", icon: <HeartHandshake aria-hidden="true" />, eyebrow: "Family profiles", title: "Beeline", body: "Keep family consent, capabilities, and browser identities separate from your own account set.", keywords: "beeline family mom parent delegated chrome profile oauth mcp" },
      "my-apps": { id: "my-apps", icon: <AppWindow aria-hidden="true" />, eyebrow: "Providers", title: "Apps & Services", body: "Open running apps and browse installable providers agents can also call.", keywords: "apps services providers running installable" },
      messaging: { id: "messaging", icon: <MessageSquare aria-hidden="true" />, eyebrow: "Telegram · Discord · iMessage", title: "Messaging", body: "Set up outbound channels for Queen Bee and individual agents.", keywords: "messaging telegram discord imessage channels outbound" },
      phone: { id: "phone", icon: <PhoneCall aria-hidden="true" />, eyebrow: "Call prompts", title: "Phone", body: "Manage the spoken prompts your iPhone calls you with.", keywords: "phone calls prompts iphone spoken" },
      env: { id: "env", icon: <KeyRound aria-hidden="true" />, eyebrow: sharedEnvCount ? `${sharedEnvCount} shared keys` : "Shared credentials", title: "Env", body: "Manage shared and per-agent runtime variables synced across the hive.", keywords: "env secrets variables config credentials keys", ...(sharedEnvCount ? { badge: `${sharedEnvCount} keys`, badgeTone: "neutral" as BadgeTone } : {}) },
      files: { id: "files", icon: <FolderOpen aria-hidden="true" />, eyebrow: runtimeFileRootCount ? `${runtimeFileRootCount} roots` : "Scoped browser", title: "Files", body: "Inspect allowlisted runtime and brain files.", keywords: "files browser runtime brain roots scoped", ...(runtimeFileRootCount ? { badge: `${runtimeFileRootCount} roots`, badgeTone: "neutral" as BadgeTone } : {}) },
      notifications: { id: "notifications", icon: <Bell aria-hidden="true" />, eyebrow: notificationUnread ? `${notificationUnread} unread` : `${notificationTotal} total`, title: "Alerts", body: "Review messages, decisions, and configurable approval requests from agents.", keywords: "alerts notifications approvals decisions messages", ...notifBadge },
    };
  }, [maintenanceOk, memoryRssMb, notificationTotal, notificationUnread, pendingApprovals, runtimeFileRootCount, sharedEnvCount]);

  const activate = useCallback((item: MoreItem) => {
    if (item.href) {
      router.push(item.href);
      return;
    }
    onNavigate(item.id as MorePanelTarget);
  }, [onNavigate, router]);

  const handleTogglePin = useCallback((id: MoreItemId) => {
    if (id !== "stake" && isPinnableView(id)) onTogglePin(id);
  }, [onTogglePin]);

  const normalizedQuery = query.trim().toLowerCase();
  const matches = useCallback((item: MoreItem) => {
    if (!normalizedQuery) return true;
    return `${item.title} ${item.eyebrow} ${item.body} ${item.keywords}`.toLowerCase().includes(normalizedQuery);
  }, [normalizedQuery]);

  const groups = useMemo(() => (
    MORE_GROUP_DEFS
      .map((group) => ({ name: group.name, items: group.ids.map((id) => items[id]).filter(matches) }))
      .filter((group) => group.items.length > 0)
  ), [items, matches]);

  const totalCount = MORE_GROUP_DEFS.reduce((sum, group) => sum + group.ids.length, 0);
  const pinnedItems = pinnedViews.map((id) => (id in items ? items[id as MoreItemId] : null)).filter((item): item is MoreItem => Boolean(item));

  // The pin/unpin control. Rendered as a SIBLING of the activator button (never
  // nested inside it) so the tile stays a valid, keyboard-clean structure.
  const renderPinButton = (item: MoreItem, className: string) => {
    if (item.id === "stake" || !isPinnableView(item.id)) return null;
    const pinned = pinnedSet.has(item.id);
    return (
      <button
        type="button"
        className={`${styles.pinBtn} ${className}`}
        style={pinButtonStyle(pinned)}
        title={pinned ? "Unpin from nav rail" : "Pin to nav rail"}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${item.title} from the nav rail` : `Pin ${item.title} to the nav rail`}
        onClick={() => handleTogglePin(item.id)}
      >
        {pinned ? <Pin aria-hidden="true" fill="currentColor" /> : <PinOff aria-hidden="true" />}
      </button>
    );
  };

  const renderBadge = (item: MoreItem) => (
    item.badge ? <span className={styles.badge} style={toneStyle(item.badgeTone ?? "honey")}>{item.badge}</span> : null
  );

  const renderGridCard = (item: MoreItem) => (
    <div key={item.id} className={styles.card}>
      <button type="button" className={styles.cardActivate} onClick={() => activate(item)}>
        <span className={styles.iconBox} style={ICON_BOX_STYLE}>{item.icon}</span>
        <span className={styles.cardBody}>
          <small className={styles.cardEyebrow}>{item.eyebrow}</small>
          <span className={styles.cardTitleRow}>
            <strong className={styles.cardTitle}>{item.title}</strong>
            {renderBadge(item)}
          </span>
          <span className={styles.cardText}>{item.body}</span>
        </span>
      </button>
      {renderPinButton(item, styles.pinGrid)}
    </div>
  );

  const renderListRow = (item: MoreItem) => (
    <div key={item.id} className={styles.listRow}>
      <button type="button" className={styles.listActivate} onClick={() => activate(item)}>
        <span className={styles.listIconBox} style={ICON_BOX_STYLE}>{item.icon}</span>
        <span className={styles.listMain}>
          <span className={styles.listTitleRow}>
            <strong className={styles.cardTitle}>{item.title}</strong>
            {renderBadge(item)}
          </span>
          <span className={styles.cardText}>{item.body}</span>
        </span>
      </button>
      {renderPinButton(item, styles.pinRow)}
      <span className={styles.chev}><ChevronRight aria-hidden="true" width={18} height={18} /></span>
    </div>
  );

  const renderBoardRow = (item: MoreItem) => (
    <div key={item.id} className={styles.boardRow}>
      <button type="button" className={styles.boardActivate} onClick={() => activate(item)}>
        <span className={styles.boardIconBox} style={ICON_BOX_STYLE}>{item.icon}</span>
        <span className={styles.boardMain}>
          <span className={styles.boardTitle}>{item.title}</span>
          <span className={styles.boardEyebrow}>{item.eyebrow}</span>
        </span>
        {renderBadge(item)}
        {item.dot ? <span className={styles.dot} style={{ background: dotColor(item.dot), boxShadow: `0 0 8px ${dotColor(item.dot)}` }} aria-hidden="true" /> : null}
      </button>
      {renderPinButton(item, styles.pinRow)}
    </div>
  );

  const viewOptions: Array<{ value: ViewMode; label: string; icon: ReactNode }> = [
    { value: "grid", label: "Grid", icon: <LayoutGrid aria-hidden="true" /> },
    { value: "list", label: "List", icon: <List aria-hidden="true" /> },
    { value: "board", label: "Board", icon: <Kanban aria-hidden="true" /> },
  ];

  return (
    <div className={styles.root} role="region" aria-label="More">
      <div className={styles.header}>
        <p className={styles.eyebrow}>More</p>
        <h2 className={styles.title}>Jump to anything</h2>
      </div>

      {/* A <label> makes the whole field focus the input on click — no dead
          zones around the icon/padding/kbd, no JS handler needed. */}
      <label className={styles.search}>
        <span className={styles.searchIcon}><Search aria-hidden="true" width={20} height={20} /></span>
        <input
          ref={searchRef}
          type="text"
          className={styles.searchInput}
          placeholder="Search utilities, tools, and agents…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search utilities"
        />
        <kbd className={styles.kbd}>/</kbd>
      </label>

      <div className={styles.sectionLabelRow}>
        <p className={styles.sectionLabel}>Pinned</p>
        <span className={styles.sectionHint}>· tap the pin on any tile to add it to the rail</span>
      </div>
      {pinnedItems.length > 0 ? (
        <div className={styles.pinnedRow}>
          {pinnedItems.map((item) => (
            <div key={item.id} className={styles.chip}>
              <button type="button" className={styles.chipActivate} onClick={() => activate(item)}>
                <span className={styles.chipIcon}>{item.icon}</span>
                <span className={styles.chipLabel}>{item.title}</span>
                {renderBadge(item)}
              </button>
              <button
                type="button"
                className={styles.chipUnpin}
                title="Unpin"
                aria-label={`Unpin ${item.title} from the nav rail`}
                onClick={() => handleTogglePin(item.id)}
              >
                <X aria-hidden="true" width={12} height={12} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.pinnedEmpty}>Nothing pinned yet — tap the pin on any tile below to keep it on the nav rail.</div>
      )}

      <div className={styles.browseHead}>
        <p className={styles.sectionLabel}>Browse all · {totalCount} utilities</p>
        <div className={styles.seg} role="group" aria-label="View mode">
          {viewOptions.map((option) => {
            const active = viewMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={styles.segBtn}
                aria-pressed={active}
                onClick={() => rememberViewMode(option.value)}
                style={active
                  ? { background: "var(--m-active-bg)", color: "var(--m-active-ink)" }
                  : { color: "var(--m-muted)" }}
              >
                {option.icon}
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className={styles.empty}>No utilities match “{query.trim()}”.</div>
      ) : viewMode === "grid" ? (
        groups.map((group) => (
          <div key={group.name} className={styles.group}>
            <p className={styles.groupName}>{group.name}</p>
            <div className={styles.grid}>{group.items.map(renderGridCard)}</div>
          </div>
        ))
      ) : viewMode === "list" ? (
        groups.map((group) => (
          <div key={group.name} className={styles.listGroup}>
            <p className={styles.groupName}>{group.name}</p>
            <div className={styles.list}>{group.items.map(renderListRow)}</div>
          </div>
        ))
      ) : (
        <div className={styles.board}>
          {groups.map((group) => (
            <div key={group.name} className={styles.boardCol}>
              <p className={styles.boardColName}>{group.name}</p>
              {group.items.map(renderBoardRow)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
