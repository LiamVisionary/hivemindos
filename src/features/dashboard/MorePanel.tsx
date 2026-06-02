import { Activity, AppWindow, Bell, Bot, FolderOpen, PhoneCall, PlugZap, Search, ShieldCheck, Sparkles, Wrench } from "lucide-react";

import fleetStyles from "@/app/fleet.module.css";
import { createStyleClass } from "@/features/dashboard/style-classes";

const fleetClass = createStyleClass(fleetStyles);

type MorePanelTarget = "integrations" | "env" | "maintenance" | "sessions" | "tools" | "files" | "notifications" | "memory" | "my-apps" | "phone" | "aeon" | "fusion";

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
  maintenanceOk,
  runtimeFileRootCount,
  notificationUnread,
  notificationTotal,
  memoryRssMb,
  memoryGrowthMb,
  onNavigate,
}: MorePanelProps) {
  const fusionItems = [
    {
      id: "fusion" as const,
      icon: <Sparkles aria-hidden="true" />,
      eyebrow: "Skill builder",
      title: "Hive Skill Fusion",
      body: "Create reusable skills from selected skills, tools, apps, agents, and workflows.",
    },
  ];
  const systemItems = [
    {
      id: "aeon" as const,
      icon: <Bot aria-hidden="true" />,
      eyebrow: "Autopilot",
      title: "Aeon",
      body: "Manage unattended skills, schedules, workflow runs, and outputs.",
    },
    {
      id: "integrations" as const,
      icon: <PlugZap aria-hidden="true" />,
      eyebrow: "Nango host",
      title: "Integrations",
      body: "Choose the always-on machine for shared external API access.",
    },
    {
      id: "maintenance" as const,
      icon: <ShieldCheck aria-hidden="true" />,
      eyebrow: maintenanceOk === false ? "Needs attention" : "Fleet checks",
      title: "Diagnostics",
      body: "Run dashboard and runtime health checks.",
    },
    {
      id: "sessions" as const,
      icon: <Search aria-hidden="true" />,
      eyebrow: "Runtime memory",
      title: "Sessions",
      body: "Search readable Hermes and OpenClaw conversations from one place.",
    },
    {
      id: "tools" as const,
      icon: <Wrench aria-hidden="true" />,
      eyebrow: "Callable handles",
      title: "Tools",
      body: "Review built-in, runtime, and app-provided handles agents can invoke.",
    },
    {
      id: "my-apps" as const,
      icon: <AppWindow aria-hidden="true" />,
      eyebrow: "Providers",
      title: "Apps & Services",
      body: "Open running apps and browse installable providers agents can also call.",
    },
    {
      id: "phone" as const,
      icon: <PhoneCall aria-hidden="true" />,
      eyebrow: "Call prompts",
      title: "Phone",
      body: "Manage the spoken prompts your iPhone calls you with.",
    },
    {
      id: "memory" as const,
      icon: <Activity aria-hidden="true" />,
      eyebrow: memoryRssMb ? `${Math.round(memoryRssMb)} MB RSS` : "RAM sampler",
      title: "Memory",
      body: memoryGrowthMb && memoryGrowthMb > 0 ? `Growing ${memoryGrowthMb.toFixed(1)} MB in the sample window.` : "Track process RSS growth and leak suspects.",
    },
    {
      id: "files" as const,
      icon: <FolderOpen aria-hidden="true" />,
      eyebrow: runtimeFileRootCount ? `${runtimeFileRootCount} roots` : "Scoped browser",
      title: "Files",
      body: "Inspect allowlisted runtime and brain files.",
    },
    {
      id: "notifications" as const,
      icon: <Bell aria-hidden="true" />,
      eyebrow: notificationUnread ? `${notificationUnread} unread` : `${notificationTotal} total`,
      title: "Alerts",
      body: "Review messages agents write into the shared inbox.",
    },
  ];

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
                className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4 text-left text-[var(--foreground)] transition hover:border-[rgba(94,234,212,0.35)] hover:bg-[rgba(20,184,166,0.08)]"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[rgba(94,234,212,0.24)] bg-[rgba(20,184,166,0.10)] text-[var(--accent-strong)] [&_svg]:h-4 [&_svg]:w-4">
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
          <button
            type="button"
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4 text-left text-[var(--foreground)] transition hover:border-[rgba(94,234,212,0.35)] hover:bg-[rgba(20,184,166,0.08)]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[rgba(94,234,212,0.24)] bg-[rgba(20,184,166,0.10)] text-[var(--accent-strong)] [&_svg]:h-4 [&_svg]:w-4">
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
      </div>
    </section>
  );
}
