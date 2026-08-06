"use client";

/* AppNavShelf.tsx — the app-wide collapsed icon rail on the far left, ported
   from the Fleet "Hive" redesign and promoted to the global navigation. It
   replaces the old top DashboardHeader: hovering glides it open to reveal
   labels; the first slot is the HivemindOS mark → the Fleet view.

   It is wrapped in `.fr-root` so the hive design tokens resolve, and uses the
   `fr-shelf-app` modifier (fixed positioning + macOS drag region). onNavigate
   receives a DashboardView id; wire it to the dashboard view switch. */

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { BellRing, Brain, Building2, Cloud, Cpu } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { POPOUT_GRAB_OFFSET_X, POPOUT_GRAB_OFFSET_Y, buildAppNavShelfGroups, resolveActiveShelfSlot, type PopoutFollowHandle } from "@/features/dashboard/dashboard-navigation";
import { DashboardSecurityControl } from "@/features/dashboard/DashboardSecurityControl";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { applyAppNavLiquidGlass } from "@/lib/native/liquid-glass";
import { useNativeUpdate } from "@/lib/native/use-native-update";
import { MoonIcon, SunIcon } from "./primitives";
import "./fleet-hive.css";
import "./app-nav-shelf.css";

export type ShelfTheme = "dark" | "light";

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
    case "agents":
      return (<svg {...p}><path d="M12 3l7.4 4.3v8.6L12 20.2 4.6 15.9V7.3z" /><path d="M12 8.4l3.1 1.8v3.6L12 15.6l-3.1-1.8v-3.6z" /></svg>);
    case "kanban":
      return (<svg {...p}><rect x="3" y="4" width="5" height="16" rx="1.2" /><rect x="9.5" y="4" width="5" height="10" rx="1.2" /><rect x="16" y="4" width="5" height="13" rx="1.2" /></svg>);
    case "vault":
      return <Brain aria-hidden="true" width={20} height={20} strokeWidth={1.7} />;
    case "chat":
      return (<svg {...p}><path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.4A8 8 0 1 1 21 11.5z" /></svg>);
    case "wallet":
      return (<svg {...p}><rect x="3" y="6" width="18" height="13" rx="2.2" /><path d="M3 9.5h18" /><circle cx="16.5" cy="13.5" r="1.1" fill="currentColor" stroke="none" /></svg>);
    case "trade":
      return (<svg {...p}><path d="M8 4v3M8 16v4" /><rect x="6" y="7" width="4" height="9" rx="1" /><path d="M16 4v4M16 17v3" /><rect x="14" y="8" width="4" height="9" rx="1" /></svg>);
    case "socials":
      return (<svg {...p}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="M8.3 10.8 15.7 6.2M8.3 13.2l7.4 4.6" /></svg>);
    case "governance":
      return <Building2 aria-hidden="true" width={20} height={20} strokeWidth={1.7} />;
    case "marketplace":
      return (<svg {...p}><path d="M3 9.5 4.5 4h15L21 9.5" /><path d="M4 9.5V20h16V9.5" /><path d="M9 20v-6h6v6" /><path d="M3 9.5h18" /></svg>);
    case "scheduler":
      return (<svg {...p}><rect x="3.5" y="4.5" width="17" height="16" rx="2.2" /><path d="M3.5 9h17M8 3v3M16 3v3" /><path d="M12 12v2.5l1.6 1" /></svg>);
    case "notifications":
      return <BellRing aria-hidden="true" width={20} height={20} strokeWidth={1.7} />;
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
    case "fusion":
      return (<svg {...p}><path d="M9.9 15.5A2 2 0 0 0 8.5 14.1L2.4 12.5a.5.5 0 0 1 0-1L8.5 9.9A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0L14.1 8.5A2 2 0 0 0 15.5 9.9l6.1 1.6a.5.5 0 0 1 0 1L15.5 14.1a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z" /><path d="M20 3v4M22 5h-4" /></svg>);
    case "compute":
      return <Cpu aria-hidden="true" width={20} height={20} strokeWidth={1.7} />;
    case "cloud":
      return <Cloud aria-hidden="true" width={20} height={20} strokeWidth={1.7} />;
    case "tools":
      return (<svg {...p}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z" /></svg>);
    case "my-apps":
      return (<svg {...p}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 4v4M2 8h20M6 4v4" /></svg>);
    case "messaging":
      return (<svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>);
    case "phone":
      return (<svg {...p}><path d="M14 2a9 9 0 0 1 8 8" /><path d="M14 6a5 5 0 0 1 4 4" /><path d="M13.8 16.6a1 1 0 0 0 1.2-.3l.4-.5A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.5.4a1 1 0 0 0-.3 1.2 14 14 0 0 0 6.4 6.4z" /></svg>);
    case "memory":
      return (<svg {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>);
    case "sessions":
      return (<svg {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>);
    case "env":
      return (<svg {...p}><path d="M2.6 17.4A2 2 0 0 0 2 18.8V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 .7-.3l.8-.8a6.5 6.5 0 1 0-4-4z" /><circle cx="16.5" cy="7.5" r="0.7" fill="currentColor" stroke="none" /></svg>);
    case "files":
      return (<svg {...p}><path d="m6 14 1.5-2.9A2 2 0 0 1 9.2 10H20a2 2 0 0 1 1.9 2.5l-1.5 6a2 2 0 0 1-2 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2" /></svg>);
    case "more":
      return (<svg {...p}><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></svg>);
    default:
      return null;
  }
}

/* ---- tear-off: drag a rail tab out of the shelf to pop that view into its
   own window (native webview window on desktop, browser popup on the web).
   Pointer-based rather than HTML5 drag&drop because the Tauri shell's native
   drag-drop handler swallows HTML5 drags on some platforms. A short click
   still navigates; only a real drag (past the distance threshold) tears.
   Crossing the window's LEFT edge mid-drag pops the window out immediately
   ("live"): the native window enters an OS drag, and a browser popup keeps
   following the pointer until release. */

const TEAR_START_DISTANCE_PX = 14;

type TearState = { id: DashboardView; label: string; armed: boolean };

type NavShelfPopoutHandler = (
  id: DashboardView,
  screenPosition?: { x: number; y: number },
  opts?: { live?: boolean },
) => PopoutFollowHandle | null | void;

type NavShelfTearOff = {
  ghost: ReactNode;
  itemProps: (id: DashboardView, label: string) => {
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: () => void;
  };
  shouldSuppressClick: () => boolean;
};

function useNavShelfTearOff(
  shelfRef: RefObject<HTMLElement | null>,
  onPopout?: NavShelfPopoutHandler,
): NavShelfTearOff {
  const [tear, setTear] = useState<TearState | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  // Window popped out by a live drag-out; moved along with the pointer until
  // release (a browser popup via moveTo, a native window via cursor pings).
  const livePopupRef = useRef<PopoutFollowHandle | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    id: DashboardView;
    label: string;
    startX: number;
    startY: number;
    tearing: boolean;
    armed: boolean;
    canceled: boolean;
    livePopped: boolean;
  } | null>(null);

  const positionGhost = useCallback((x: number, y: number) => {
    lastPointRef.current = { x, y };
    const ghost = ghostRef.current;
    if (ghost) ghost.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 12)}px)`;
  }, []);

  // Place the ghost before its first paint so it never flashes at the origin.
  const tearing = tear !== null;
  useLayoutEffect(() => {
    if (tearing) positionGhost(lastPointRef.current.x, lastPointRef.current.y);
  }, [tearing, positionGhost]);

  // Escape cancels an active tear; the pointer release then does nothing.
  useEffect(() => {
    if (!tearing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const drag = dragRef.current;
      if (drag) drag.canceled = true;
      setTear(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [tearing]);

  useEffect(() => {
    if (!tearing) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    // The native mouse gesture keeps extending a text selection under the
    // ghost; suppress it for the duration of the tear.
    document.body.style.userSelect = "none";
    window.getSelection()?.removeAllRanges();
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [tearing]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, id: DashboardView, label: string) => {
    suppressClickRef.current = false;
    if (!onPopout || event.button !== 0 || event.pointerType !== "mouse") return;
    // Capture immediately: a fast drag leaves the button before its first
    // pointermove is delivered, and an uncaptured gesture would escape into
    // whatever the cursor crosses. Capture keeps click behavior intact.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture is best-effort; the press still works as a plain click */
    }
    dragRef.current = {
      pointerId: event.pointerId,
      id,
      label,
      startX: event.clientX,
      startY: event.clientY,
      tearing: false,
      armed: false,
      canceled: false,
      livePopped: false,
    };
  }, [onPopout]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.canceled) return;
    if (drag.livePopped) {
      // The window already popped out mid-drag; keep the browser popup under
      // the pointer until release. (Native windows ride the OS drag instead.)
      const popup = livePopupRef.current;
      if (popup && !popup.closed) {
        try {
          popup.moveTo(
            Math.max(0, Math.round(event.screenX - POPOUT_GRAB_OFFSET_X)),
            Math.max(0, Math.round(event.screenY - POPOUT_GRAB_OFFSET_Y)),
          );
        } catch {
          livePopupRef.current = null;
        }
      }
      return;
    }
    if (!drag.tearing) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (dx * dx + dy * dy < TEAR_START_DISTANCE_PX * TEAR_START_DISTANCE_PX) return;
      drag.tearing = true;
      setTear({ id: drag.id, label: drag.label, armed: false });
    }
    if (event.clientX < 0) {
      // Crossed the window's left edge mid-drag: pop out NOW and let the user
      // keep dragging the new window from where their pointer is.
      drag.livePopped = true;
      const handle = onPopout?.(drag.id, { x: event.screenX, y: event.screenY }, { live: true });
      livePopupRef.current = handle && typeof handle === "object" && "moveTo" in handle ? handle : null;
      setTear(null);
      return;
    }
    const shelfRect = shelfRef.current?.getBoundingClientRect();
    const armed = !!shelfRect
      && (event.clientX < shelfRect.left || event.clientX > shelfRect.right
        || event.clientY < shelfRect.top || event.clientY > shelfRect.bottom);
    if (armed !== drag.armed) {
      drag.armed = armed;
      setTear((current) => (current ? { ...current, armed } : current));
    }
    positionGhost(event.clientX, event.clientY);
  }, [onPopout, positionGhost, shelfRef]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.tearing || drag.livePopped) {
      // A drag happened — the click that follows this release must not navigate.
      suppressClickRef.current = true;
      if (!drag.canceled && !drag.livePopped && drag.armed) {
        onPopout?.(drag.id, { x: event.screenX, y: event.screenY });
      }
      const popup = livePopupRef.current;
      if (drag.livePopped && popup && !popup.closed) {
        // Final placement at the release point, in case any intermediate
        // follow moves were dropped (e.g. focus shifted mid-drag).
        try {
          popup.moveTo(
            Math.max(0, Math.round(event.screenX - POPOUT_GRAB_OFFSET_X)),
            Math.max(0, Math.round(event.screenY - POPOUT_GRAB_OFFSET_Y)),
          );
        } catch {
          /* popup already gone */
        }
      }
    }
    livePopupRef.current = null;
    dragRef.current = null;
    setTear(null);
  }, [onPopout]);

  const handlePointerCancel = useCallback(() => {
    livePopupRef.current = null;
    dragRef.current = null;
    setTear(null);
  }, []);

  const itemProps = useCallback((id: DashboardView, label: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => handlePointerDown(event, id, label),
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
  }), [handlePointerCancel, handlePointerDown, handlePointerMove, handlePointerUp]);

  const shouldSuppressClick = useCallback(() => {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppressed;
  }, []);

  const ghost = tear ? (
    <div ref={ghostRef} className="fr-nav-tear-ghost" data-armed={tear.armed ? "" : undefined} aria-hidden="true">
      <span className="fr-nav-ico"><FrNavIcon id={tear.id} /></span>
      <span className="fr-nav-tear-ghost-text">
        <strong>{tear.label}</strong>
        <small>{tear.armed ? "Release to open in a new window" : "Drag out of the rail to pop out"}</small>
      </span>
    </div>
  ) : null;

  return { ghost, itemProps, shouldSuppressClick };
}

function NavShelfItem({ id, label, active, onNavigate, onPrefetch, badge, tearOff }: {
  id: DashboardView;
  label: string;
  active: boolean;
  onNavigate: (id: DashboardView) => void;
  onPrefetch?: (id: DashboardView) => void;
  badge?: number;
  tearOff?: NavShelfTearOff;
}) {
  return (
    <button
      type="button"
      className="fr-nav"
      data-active={active ? "" : undefined}
      aria-current={active ? "page" : undefined}
      data-bee-nav={id}
      onClick={() => {
        if (tearOff?.shouldSuppressClick()) return;
        onNavigate(id);
      }}
      onMouseEnter={() => onPrefetch?.(id)}
      onFocus={() => onPrefetch?.(id)}
      title={label}
      {...(tearOff ? tearOff.itemProps(id, label) : undefined)}
    >
      <span className="fr-nav-ico"><FrNavIcon id={id} /></span>
      <span className="fr-nav-label">{label}</span>
      {badge ? <span className="fr-nav-badge" aria-label={`${badge} item${badge === 1 ? "" : "s"} need attention in ${label}`}>{badge > 99 ? "99+" : badge}</span> : null}
    </button>
  );
}

function AppNavShelfBase({
  activeView,
  onNavigate,
  onPrefetch,
  onPopout,
  theme,
  onToggleTheme,
  brandSrc = "/icon-512.png",
  appVersion,
  navBadges = {},
  pinnedUtilities,
  onOpenCompanionSetup,
}: {
  activeView: DashboardView;
  onNavigate: (id: DashboardView) => void;
  onPrefetch?: (id: DashboardView) => void;
  /** Drag-to-pop-out: called when a rail tab is dragged out of the shelf and
   * released (or live, when the pointer crosses the window's left edge);
   * opens that view in its own window. Enables the tear gesture. May return
   * the browser popup handle so a live drag can keep moving the window. */
  onPopout?: NavShelfPopoutHandler;
  theme: ShelfTheme;
  onToggleTheme: () => void;
  brandSrc?: string;
  appVersion?: string | null;
  navBadges?: Partial<Record<DashboardView, number>>;
  /** User-pinned utility views for the rail's third section (see MorePanel). */
  pinnedUtilities?: DashboardView[];
  /** Opens the hologram-companion setup/download modal (see CompanionSetupModal). */
  onOpenCompanionSetup?: () => void;
}) {
  // Empty groups (e.g. the user unpinned every utility) are dropped so no
  // dangling divider is left behind the fixed sections.
  const shelfGroups = buildAppNavShelfGroups(pinnedUtilities).filter((group) => group.length > 0);
  const renderedShelfIds = new Set<DashboardView>(shelfGroups.flatMap((group) => group.map((item) => item.id)));
  const active = resolveActiveShelfSlot(activeView, renderedShelfIds);
  const shelfNavRef = useRef<HTMLElement | null>(null);
  const tearOff = useNavShelfTearOff(shelfNavRef, onPopout);
  const keyboardNavigationRef = useRef(false);
  const [shelfKeyboardFocus, setShelfKeyboardFocus] = useState(false);
  const [securityTooltipOpen, setSecurityTooltipOpen] = useState(false);
  const [themeTooltipOpen, setThemeTooltipOpen] = useState(false);
  const footerTooltipOpen = securityTooltipOpen || themeTooltipOpen;

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

  useEffect(() => {
    void applyAppNavLiquidGlass(theme);
  }, [theme]);

  useEffect(() => {
    const markKeyboardNavigation = (event: KeyboardEvent) => {
      if (event.key === "Tab") keyboardNavigationRef.current = true;
    };
    const clearKeyboardNavigation = () => {
      keyboardNavigationRef.current = false;
      setShelfKeyboardFocus(false);
    };

    window.addEventListener("keydown", markKeyboardNavigation, true);
    window.addEventListener("pointerdown", clearKeyboardNavigation, true);
    return () => {
      window.removeEventListener("keydown", markKeyboardNavigation, true);
      window.removeEventListener("pointerdown", clearKeyboardNavigation, true);
    };
  }, []);

  return (
    <TooltipProvider delayDuration={120}>
    <div className="fr-root" data-fr-theme={theme}>
      <nav
        ref={shelfNavRef}
        className="fr-shelf fr-shelf-app"
        aria-label="Primary"
        data-keyboard-focus={shelfKeyboardFocus ? "true" : undefined}
        data-footer-tooltip-open={footerTooltipOpen ? "true" : undefined}
        onFocusCapture={() => {
          if (keyboardNavigationRef.current) setShelfKeyboardFocus(true);
        }}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setShelfKeyboardFocus(false);
          }
        }}
      >
        <button
          type="button"
          className="fr-brand"
          data-active={active === "agents" ? "" : undefined}
          aria-current={active === "agents" ? "page" : undefined}
          onClick={() => {
            if (tearOff.shouldSuppressClick()) return;
            onNavigate("agents");
          }}
          title="HivemindOS · Fleet"
          {...tearOff.itemProps("agents", "Fleet")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brandSrc} alt="HivemindOS" />
          <span className="fr-brand-name">HivemindOS</span>
        </button>
        {shelfGroups.map((g, i) => (
          <Fragment key={i}>
            {g.map((it) => (
              <NavShelfItem key={it.id} id={it.id} label={it.label} active={active === it.id} onNavigate={onNavigate} onPrefetch={onPrefetch} badge={navBadges[it.id]} tearOff={tearOff} />
            ))}
            {i < shelfGroups.length - 1 ? <div className="fr-nav-div" /> : null}
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
          <NavShelfItem id="more" label="More" active={active === "more"} onNavigate={onNavigate} onPrefetch={onPrefetch} tearOff={tearOff} />
          {onOpenCompanionSetup ? (
            <button type="button" className="fr-nav" onClick={onOpenCompanionSetup} title="Hologram companion">
              <span className="fr-nav-ico">
                {/* a figure rising from a holo-emitter base */}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="7" r="2.6" />
                  <path d="M8.2 14.2c.7-1.9 2.1-3 3.8-3s3.1 1.1 3.8 3" />
                  <path d="M5 18.5c1.6 1 4.1 1.6 7 1.6s5.4-.6 7-1.6" />
                  <path d="M8.5 16.8h7" opacity="0.6" />
                </svg>
              </span>
              <span className="fr-nav-label">Companion</span>
            </button>
          ) : null}
          <div className="fr-shelf-control-row" role="group" aria-label="Dashboard controls">
            <DashboardSecurityControl onTooltipOpenChange={setSecurityTooltipOpen} />
            <Tooltip onOpenChange={setThemeTooltipOpen}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="fr-nav"
                  onClick={onToggleTheme}
                  aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                >
                  <span className="fr-nav-ico">{theme === "light" ? <MoonIcon /> : <SunIcon />}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="z-[80]">
                {theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              </TooltipContent>
            </Tooltip>
          </div>
          {displayVersion ? <div className="fr-shelf-version" aria-label={`HivemindOS version ${displayVersion}`}>v{displayVersion}</div> : null}
        </div>
      </nav>
      {tearOff.ghost}
    </div>
    </TooltipProvider>
  );
}

// Memoized: this rail is always mounted, so without memo it reconciles its ~26
// stable elements on every DashboardApp state change (each keystroke / voice tick).
// Requires its onNavigate/onToggleTheme props to be useCallback-stable at the call site.
export const AppNavShelf = memo(AppNavShelfBase);

export default AppNavShelf;
