"use client";

/* Route-level chrome shared by every lazy dashboard view: the loading panel,
   the chunk-failure error boundary, and the hydration-stall notice. Extracted
   from DashboardApp so the shell stays presentational and typed (this file is
   NOT @ts-nocheck) while DashboardApp keeps only orchestration. */

import { Component, type ReactNode } from "react";

import vaultStyles from "@/app/vault.module.css";
import { DASHBOARD_ROUTE_LABELS } from "@/features/dashboard/dashboard-navigation";
import { BrainGraphLoader } from "@/features/dashboard/dashboard-display-helpers";
import { createStyleClass } from "@/features/dashboard/style-classes";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import type { SnapshotRetryInfo } from "@/lib/services/dashboard-state-client";

const vaultClass = createStyleClass(vaultStyles);

type DashboardRouteLoadingProps = { children?: ReactNode; detail?: string; label?: string; view?: DashboardView };

export function DashboardRouteLoading({ children, detail, label, view }: DashboardRouteLoadingProps) {
  const routeLabel = label ?? (view ? DASHBOARD_ROUTE_LABELS[view] : "dashboard view");
  const routeTitle = routeLabel === "dashboard view" ? "Loading dashboard view" : `Loading ${routeLabel}`;
  const routeDetail = detail ?? (view ? `Opening ${routeLabel}` : "Opening the selected control surface");
  return (
    <section className={vaultClass("brainGraphPanel", "tabPanel")} aria-label={routeTitle} data-hivemindos-route-loading="true">
      <div className={vaultClass("brainGraphCanvas")}>
        <BrainGraphLoader title={routeTitle} detail={routeDetail} />
        {children}
      </div>
    </section>
  );
}

type DashboardRouteErrorBoundaryProps = {
  children: ReactNode;
  onRetry: () => void;
  resetKey: string;
  view: DashboardView;
};

export class DashboardRouteErrorBoundary extends Component<DashboardRouteErrorBoundaryProps, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidUpdate(previousProps: DashboardRouteErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <DashboardRouteLoading
        view={this.props.view}
        label="Reloading view"
        detail="A route chunk missed the current app bundle. Try again or switch views."
      >
        <button
          type="button"
          onClick={() => {
            this.setState({ error: null });
            this.props.onRetry();
          }}
          style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--accent-strong, #2f6b52)", background: "transparent", color: "var(--accent-strong, #6fe0b0)", fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase" }}
        >
          Try again
        </button>
      </DashboardRouteLoading>
    );
  }
}

// Shown when hydration can't reach the local dashboard service after several
// tries. The snapshot loader keeps retrying in the background and this notice
// auto-clears the moment it succeeds, so a transient slow start just flashes
// briefly; a persistent failure gets a readable, recoverable screen instead of
// an endless honeycomb spinner that needs devtools to diagnose.
export const HYDRATION_STALL_THRESHOLD = 5;

export function HydrationStalledNotice({ info }: { info: SnapshotRetryInfo }) {
  const reason = info.kind === "network"
    ? "The local HivemindOS service isn't responding yet."
    : info.kind === "server"
      ? `The local HivemindOS service returned an error${info.status ? ` (${info.status})` : ""}.`
      : "The local HivemindOS service returned an unexpected response.";
  return (
    <section
      className={vaultClass("brainGraphPanel", "tabPanel")}
      aria-label="Connecting to HivemindOS"
      data-hivemindos-hydration-stalled={info.kind}
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--bg, #060a08)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div className={vaultClass("brainGraphCanvas")} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", maxWidth: 420, padding: 24, gap: 16 }}>
        <BrainGraphLoader title="Still connecting to HivemindOS…" detail={`${reason} It will connect automatically the moment it's ready.`} />
        <button
          type="button"
          onClick={() => { if (typeof window !== "undefined") window.location.reload(); }}
          style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--accent-strong, #2f6b52)", background: "transparent", color: "var(--accent-strong, #6fe0b0)", fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase" }}
        >
          Reload now
        </button>
        <p style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.6, margin: 0 }}>
          Still stuck after reloading? Fully quit and reopen the app. If it persists, send a photo of this screen to support.
        </p>
      </div>
    </section>
  );
}

export const routeLoadingFor = (view: DashboardView) => function RouteLoading() { return <DashboardRouteLoading view={view} />; };
// next/dynamic's `loading` component only ever receives DynamicOptionsLoadingProps —
// activeView is never passed at runtime, so panels using this always showed the
// generic "Loading dashboard view" label (pre-existing; surfaced when this file
// became typed). Kept accepting it so a future harness could thread the view in.
export const routeLoadingFromProps = (props?: { activeView?: DashboardView } | null) => <DashboardRouteLoading view={props?.activeView} />;

export function preloadDashboardChunk(loader: () => Promise<unknown>) {
  void loader().catch(() => undefined);
}
