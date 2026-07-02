import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, AppWindow, Bell, Bot, Coins, FolderOpen, KeyRound, Landmark, MessageSquare, PhoneCall, PlugZap, Search, ShieldCheck, Sparkles, Wrench } from "lucide-react";

import fleetStyles from "@/app/fleet.module.css";
import type { DashboardUtilityView } from "@/features/dashboard/dashboard-navigation";
import { createStyleClass } from "@/features/dashboard/style-classes";

const fleetClass = createStyleClass(fleetStyles);
const moreCardClass = "grid gap-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-4 text-left text-[var(--foreground)] transition hover:border-[var(--accent-strong)] hover:bg-[var(--surface-strong)]";
const moreIconClass = "flex h-9 w-9 items-center justify-center rounded-md border border-[var(--comb-line)] bg-[var(--button-accent)] text-[var(--accent-strong)] [&_svg]:h-4 [&_svg]:w-4";

// The More menu's reachable set is the catalog's Utilities group, so a new
// utility view added to the dashboard registry is a compile error here until
// it gets a card (this is how the previously-unreachable Env view surfaced).
type MorePanelTarget = DashboardUtilityView;
type MorePanelGridTarget = Exclude<MorePanelTarget, "fusion">;

const MORE_PANEL_UTILITY_ORDER = [
  "aeon",
  "governance",
  "integrations",
  "maintenance",
  "sessions",
  "tools",
  "my-apps",
  "phone",
  "memory",
  "env",
  "files",
  "notifications",
  "messaging",
] as const satisfies readonly MorePanelGridTarget[];

type UtilityMissingFromMorePanel = Exclude<MorePanelGridTarget, (typeof MORE_PANEL_UTILITY_ORDER)[number]>;
// Compile-time proof the More grid shows every utility view (fusion has its own section).
const _morePanelUtilitiesComplete: UtilityMissingFromMorePanel extends never ? true : UtilityMissingFromMorePanel = true;
void _morePanelUtilitiesComplete;

type MorePanelCard = {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  body: string;
};

type MorePanelNavigationItem = MorePanelCard & {
  id: MorePanelTarget;
};

type MorePanelRouteItem = MorePanelCard & {
  id: "stake";
  href: "/stake";
};

export type MorePanelProps = {
  sharedEnvCount?: number;
  agentSpecificEnvCount?: number;
  maintenanceOk?: boolean;
  runtimeFileRootCount: number;
  notificationUnread: number;
  notificationTotal: number;
  memoryRssMb?: number;
  memoryGrowthMb?: number;
  onNavigate: (target: MorePanelTarget) => void;
};

export function MorePanel({
  sharedEnvCount,
  maintenanceOk,
  runtimeFileRootCount,
  notificationUnread,
  notificationTotal,
  memoryRssMb,
  memoryGrowthMb,
  onNavigate,
}: MorePanelProps) {
  const fusionItems: MorePanelNavigationItem[] = [
    {
      id: "fusion" as const,
      icon: <Sparkles aria-hidden="true" />,
      eyebrow: "Skill builder",
      title: "Hive Skill Fusion",
      body: "Create reusable skills from selected skills, tools, apps, agents, and workflows.",
    },
  ];
  const utilityCards: Record<MorePanelGridTarget, MorePanelCard> = {
    aeon: {
      icon: <Bot aria-hidden="true" />,
      eyebrow: "Autopilot",
      title: "Aeon",
      body: "Manage unattended skills, schedules, workflow runs, and outputs.",
    },
    governance: {
      icon: <Landmark aria-hidden="true" />,
      eyebrow: "Companies & budgets",
      title: "Zero Human Company",
      body: "Group agents into companies, set shared budgets and kill switches, and clear spend approvals.",
    },
    integrations: {
      icon: <PlugZap aria-hidden="true" />,
      eyebrow: "Nango host",
      title: "Integrations",
      body: "Choose the always-on machine for shared external API access.",
    },
    maintenance: {
      icon: <ShieldCheck aria-hidden="true" />,
      eyebrow: maintenanceOk === false ? "Needs attention" : "Fleet checks",
      title: "Diagnostics",
      body: "Run dashboard and runtime health checks.",
    },
    sessions: {
      icon: <Search aria-hidden="true" />,
      eyebrow: "Runtime memory",
      title: "Sessions",
      body: "Search readable Hermes and OpenClaw conversations from one place.",
    },
    tools: {
      icon: <Wrench aria-hidden="true" />,
      eyebrow: "Callable handles",
      title: "Tools",
      body: "Review built-in, runtime, and app-provided handles agents can invoke.",
    },
    "my-apps": {
      icon: <AppWindow aria-hidden="true" />,
      eyebrow: "Providers",
      title: "Apps & Services",
      body: "Open running apps and browse installable providers agents can also call.",
    },
    phone: {
      icon: <PhoneCall aria-hidden="true" />,
      eyebrow: "Call prompts",
      title: "Phone",
      body: "Manage the spoken prompts your iPhone calls you with.",
    },
    memory: {
      icon: <Activity aria-hidden="true" />,
      eyebrow: memoryRssMb ? `${Math.round(memoryRssMb)} MB RSS` : "Review queue",
      title: "Memory & Review",
      body: memoryGrowthMb && memoryGrowthMb > 0 ? `Growing ${memoryGrowthMb.toFixed(1)} MB in the sample window, with review and Context X-Ray tools below.` : "Review proposed brain writes, inspect Context X-Ray manifests, and track process RSS growth.",
    },
    env: {
      icon: <KeyRound aria-hidden="true" />,
      eyebrow: sharedEnvCount ? `${sharedEnvCount} shared keys` : "Shared credentials",
      title: "Env",
      body: "Manage shared and per-agent runtime variables synced across the hive.",
    },
    files: {
      icon: <FolderOpen aria-hidden="true" />,
      eyebrow: runtimeFileRootCount ? `${runtimeFileRootCount} roots` : "Scoped browser",
      title: "Files",
      body: "Inspect allowlisted runtime and brain files.",
    },
    notifications: {
      icon: <Bell aria-hidden="true" />,
      eyebrow: notificationUnread ? `${notificationUnread} unread` : `${notificationTotal} total`,
      title: "Alerts",
      body: "Review messages agents write into the shared inbox.",
    },
    messaging: {
      icon: <MessageSquare aria-hidden="true" />,
      eyebrow: "Telegram, Discord, iMessage",
      title: "Messaging",
      body: "Set up outbound channels for Queen Bee and individual agents.",
    },
  };
  const stakeItem: MorePanelRouteItem = {
    id: "stake",
    icon: <Coins aria-hidden="true" />,
    eyebrow: "Community tiers",
    title: "Stake HIVE",
    body: "Lock HIVE for Holder through Visionary status, alpha rooms, governance, and curator rights.",
    href: "/stake",
  };
  const systemItems: Array<MorePanelNavigationItem | MorePanelRouteItem> = MORE_PANEL_UTILITY_ORDER.map((id) => ({ id, ...utilityCards[id] }));
  systemItems.splice(2, 0, stakeItem);

  return (
    <section className={fleetClass("taskPanel", "tabPanel")}>
      <div className={fleetClass("taskPanelHeader")}>
        <div>
          <p className="eyebrow">More</p>
          <h2>System Menu</h2>
          <p>Fusion, integrations, diagnostics, scoped files, and agent notifications live here so the main navigation stays focused.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        <div>
          <p className="eyebrow">Fusion</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {fusionItems.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={moreCardClass}
              >
                <span className={moreIconClass}>
                  {item.icon}
                </span>
                <span className="grid gap-1">
                  <small className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{item.eyebrow}</small>
                  <strong>{item.title}</strong>
                  <span className="text-xs leading-5 text-[var(--muted)]">{item.body}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow">Utilities</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {systemItems.map((item) => (
              "href" in item ? (
                <Link
                  key={item.id}
                  href={item.href}
                  className={moreCardClass}
                >
                  <span className={moreIconClass}>
                    {item.icon}
                  </span>
                  <span className="grid gap-1">
                    <small className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{item.eyebrow}</small>
                    <strong>{item.title}</strong>
                    <span className="text-xs leading-5 text-[var(--muted)]">{item.body}</span>
                  </span>
                </Link>
              ) : (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={moreCardClass}
                >
                  <span className={moreIconClass}>
                    {item.icon}
                  </span>
                  <span className="grid gap-1">
                    <small className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{item.eyebrow}</small>
                    <strong>{item.title}</strong>
                    <span className="text-xs leading-5 text-[var(--muted)]">{item.body}</span>
                  </span>
                </button>
              )
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
