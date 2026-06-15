"use client";

/* AppNavShelf.tsx — the app-wide collapsed icon rail on the far left, ported
   from the Fleet "Hive" redesign and promoted to the global navigation. It
   replaces the old top DashboardHeader: hovering glides it open to reveal
   labels; the first slot is the HivemindOS mark → the Fleet view.

   It is wrapped in `.fr-root` so the hive design tokens resolve, and uses the
   `fr-shelf-app` modifier (fixed positioning + macOS drag region). onNavigate
   receives a DashboardView id; wire it to the dashboard view switch. */

import { Fragment, useEffect, useState } from "react";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { useNativeUpdate } from "@/lib/native/use-native-update";
import { MoonIcon, SunIcon } from "./primitives";
import "./fleet-hive.css";

export type ShelfTheme = "dark" | "light";

interface NavItem {
  id: DashboardView;
  label: string;
}

function FrNavIcon({ id }: { id: string }) {
  const p = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "kanban":
      return (<svg {...p}><rect x="3" y="4" width="5" height="16" rx="1.2" /><rect x="9.5" y="4" width="5" height="10" rx="1.2" /><rect x="16" y="4" width="5" height="13" rx="1.2" /></svg>);
    case "vault":
      return (<svg {...p}><path d="M12 3l7 4v5c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V7z" /><circle cx="12" cy="11" r="2" /><path d="M12 13v3" /></svg>);
    case "chat":
      return (<svg {...p}><path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.4A8 8 0 1 1 21 11.5z" /></svg>);
    case "wallet":
      return (<svg {...p}><rect x="3" y="6" width="18" height="13" rx="2.2" /><path d="M3 9.5h18" /><circle cx="16.5" cy="13.5" r="1.1" fill="currentColor" stroke="none" /></svg>);
    case "scheduler":
      return (<svg {...p}><rect x="3.5" y="4.5" width="17" height="16" rx="2.2" /><path d="M3.5 9h17M8 3v3M16 3v3" /><path d="M12 12v2.5l1.6 1" /></svg>);
    case "swarm":
      return (<svg {...p}><circle cx="12" cy="12" r="2" /><circle cx="5" cy="6.5" r="1.6" /><circle cx="19" cy="6.5" r="1.6" /><circle cx="5.5" cy="18" r="1.6" /><circle cx="18.5" cy="18" r="1.6" /><path d="M10.4 10.7 6.3 7.6M13.6 10.7l3.9-3M10.6 13.4 6.7 16.6M13.4 13.4l3.6 3" /></svg>);
    case "history":
      return (<svg {...p}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M5 4v3.2h3.2" /><path d="M12 8v4.2l2.8 1.7" /></svg>);
    case "aeon":
      return (<svg {...p}><path d="M12 3v2.3M12 18.7V21M4.2 7.5 6.2 8.6M17.8 15.4l2 1.1M4.2 16.5l2-1.1M17.8 8.6l2-1.1" /><circle cx="12" cy="12" r="3.4" /></svg>);
    case "integrations":
      return (<svg {...p}><path d="M14.5 9.5 19 5M16 3h5v5" /><path d="M9.5 14.5 5 19M8 21H3v-5" /><circle cx="12" cy="12" r="3" /></svg>);
    case "maintenance":
      return (<svg {...p}><path d="M3 12h4l2 6 4-13 2 7h6" /></svg>);
    case "more":
      return (<svg {...p}><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></svg>);
    default:
      return null;
  }
}

const GROUPS: NavItem[][] = [
  [
    { id: "kanban", label: "Work" },
    { id: "vault", label: "Brain" },
    { id: "chat", label: "Chat" },
    { id: "wallet", label: "Wallets" },
  ],
  [
    { id: "scheduler", label: "Schedules" },
    { id: "swarm", label: "Swarm" },
    { id: "history", label: "History" },
  ],
  [
    { id: "aeon", label: "Aeon" },
    { id: "integrations", label: "Integrations" },
    { id: "maintenance", label: "Diagnostics" },
  ],
];

// Which shelf slot lights up for the current dashboard view.
function resolveActive(view: DashboardView): string {
  switch (view) {
    case "agents": return "agents";
    case "kanban":
    case "history": return view === "history" ? "history" : "kanban";
    case "vault": return "vault";
    case "chat": return "chat";
    case "wallet": return "wallet";
    case "scheduler": return "scheduler";
    case "swarm": return "swarm";
    case "aeon": return "aeon";
    case "integrations":
    case "my-apps": return "integrations";
    case "maintenance":
    case "memory": return "maintenance";
    default: return "more"; // notifications, sessions, tools, files, env, phone, fusion, governance, messaging, more…
  }
}

function NavShelfItem({ id, label, active, onNavigate, badge }: {
  id: DashboardView;
  label: string;
  active: boolean;
  onNavigate: (id: DashboardView) => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      className="fr-nav"
      data-active={active ? "" : undefined}
      aria-current={active ? "page" : undefined}
      data-bee-nav={id}
      onClick={() => onNavigate(id)}
      title={label}
    >
      <span className="fr-nav-ico"><FrNavIcon id={id} /></span>
      <span className="fr-nav-label">{label}</span>
      {badge ? <span className="fr-nav-badge" aria-label={`${badge} unread`}>{badge > 99 ? "99+" : badge}</span> : null}
    </button>
  );
}

export function AppNavShelf({
  activeView,
  onNavigate,
  theme,
  onToggleTheme,
  brandSrc = "/icon-512.png",
  appVersion,
  notificationUnread = 0,
}: {
  activeView: DashboardView;
  onNavigate: (id: DashboardView) => void;
  theme: ShelfTheme;
  onToggleTheme: () => void;
  brandSrc?: string;
  appVersion?: string | null;
  notificationUnread?: number;
}) {
  const active = resolveActive(activeView);

  // Build version readout (relocated from the old header), with the same
  // /api/app/version fallback fetch so it works when appVersion isn't passed.
  const [fallbackVersion, setFallbackVersion] = useState("");
  const displayVersion = appVersion || fallbackVersion;
  useEffect(() => {
    if (appVersion || fallbackVersion) return;
    let cancelled = false;
    fetch("/api/app/version", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { version?: string } | null) => { if (!cancelled && data?.version) setFallbackVersion(data.version); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [appVersion, fallbackVersion]);

  // Native desktop self-update affordance (relocated from the old header).
  const nativeUpdate = useNativeUpdate();
  const showUpdateAction = nativeUpdate.available || nativeUpdate.busy;
  const updateLabel = nativeUpdate.error
    ? "Update · retry"
    : nativeUpdate.phase === "downloading"
      ? (nativeUpdate.percent !== null ? `Updating ${nativeUpdate.percent}%` : "Updating…")
      : nativeUpdate.phase === "installing"
        ? "Installing…"
        : nativeUpdate.phase === "relaunching"
          ? "Restarting…"
          : nativeUpdate.version
            ? `Update to ${nativeUpdate.version}`
            : "Update ready";

  // macOS desktop: titleBarStyle "Overlay" makes content fill the whole window
  // with the traffic lights floating on top. The shelf becomes the draggable
  // chrome and insets its brand below the traffic lights (see fleet-hive.css).
  useEffect(() => {
    if (!isTauriDesktopRuntime()) return;
    const isMac = navigator.userAgent.includes("Mac") || navigator.platform.toLowerCase().includes("mac");
    if (!isMac) return;
    const root = document.documentElement;
    root.classList.add("macDesktopChrome");
    return () => root.classList.remove("macDesktopChrome");
  }, []);

  return (
    <div className="fr-root" data-fr-theme={theme}>
      <nav className="fr-shelf fr-shelf-app" aria-label="Primary">
        <button
          type="button"
          className="fr-brand"
          data-active={active === "agents" ? "" : undefined}
          aria-current={active === "agents" ? "page" : undefined}
          onClick={() => onNavigate("agents")}
          title="HivemindOS · Fleet"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brandSrc} alt="HivemindOS" />
          <span className="fr-brand-name">HivemindOS</span>
        </button>
        {GROUPS.map((g, i) => (
          <Fragment key={i}>
            {g.map((it) => (
              <NavShelfItem key={it.id} id={it.id} label={it.label} active={active === it.id} onNavigate={onNavigate} />
            ))}
            {i < GROUPS.length - 1 ? <div className="fr-nav-div" /> : null}
          </Fragment>
        ))}
        <div className="fr-shelf-foot">
          {showUpdateAction ? (
            <button
              type="button"
              className="fr-nav"
              data-active=""
              onClick={nativeUpdate.install}
              disabled={nativeUpdate.busy}
              title={nativeUpdate.error ?? (nativeUpdate.version ? `HivemindOS ${nativeUpdate.version} is ready to install` : "Install the latest HivemindOS")}
            >
              <span className="fr-nav-ico">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 21h14" /></svg>
              </span>
              <span className="fr-nav-label">{updateLabel}</span>
            </button>
          ) : null}
          <NavShelfItem id="more" label="More" active={active === "more"} onNavigate={onNavigate} badge={notificationUnread} />
          <button type="button" className="fr-nav" onClick={onToggleTheme} title="Toggle light and dark">
            <span className="fr-nav-ico">{theme === "light" ? <MoonIcon /> : <SunIcon />}</span>
            <span className="fr-nav-label">{theme === "light" ? "Dark mode" : "Light mode"}</span>
          </button>
          {displayVersion ? <div className="fr-shelf-version" aria-label={`HivemindOS version ${displayVersion}`}>v{displayVersion}</div> : null}
        </div>
      </nav>
    </div>
  );
}

export default AppNavShelf;
