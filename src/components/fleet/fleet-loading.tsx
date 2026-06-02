"use client";

import type { CSSProperties } from "react";
import styles from "./fleet-tokens.module.css";

type FleetLoadingShellProps = {
  mastheadMode?: "all" | "mobile" | "none";
};

export function FleetViewLoadingShell({ mastheadMode = "mobile" }: FleetLoadingShellProps = {}) {
  const showMasthead = mastheadMode !== "none";

  return (
    <div
      className={`${styles.root} relative overflow-hidden`}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 420,
        background: "var(--background)",
        color: "var(--foreground)",
        display: "grid",
        fontFamily: "var(--f-display), var(--font-sans, system-ui)",
        gridTemplateRows: showMasthead ? "auto 1fr" : "1fr",
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 50% 38%, rgba(255,212,90,0.10), transparent 50%)," +
            "radial-gradient(circle at 80% 80%, rgba(45,212,191,0.08), transparent 50%)",
        }}
      />
      <svg
        aria-hidden
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ opacity: 0.1 }}
      >
        <defs>
          <pattern id="fleetLoadingGrid" width={48} height={55} patternUnits="userSpaceOnUse">
            <polygon
              points="24,1 47,14 47,40 24,53 1,40 1,14"
              fill="none"
              stroke="rgba(255,212,90,0.4)"
              strokeWidth={0.5}
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#fleetLoadingGrid)" />
      </svg>

      {showMasthead ? (
        <header
          className={`${styles.masthead} ${mastheadMode === "mobile" ? styles.mobileOnlyMasthead : ""} relative z-10`}
          style={{ padding: "22px 36px 16px", borderBottom: "1px solid rgba(148,163,184,0.16)" }}
        >
          <div className="grid gap-3">
            <span className="h-3 w-44 animate-pulse rounded-full bg-[rgba(94,234,212,0.18)]" />
            <span className="h-8 w-64 max-w-full animate-pulse rounded-md bg-[rgba(226,232,240,0.14)]" />
          </div>
        </header>
      ) : null}

      <div className={`${styles.layout} relative z-10 grid`} style={{ minHeight: 0 }}>
        <aside
          className={`${styles.sideRail} flex flex-col overflow-auto`}
          style={{ borderRight: "1px solid rgba(148,163,184,0.16)", gap: 16 }}
        >
          <section>
            <div className={styles.monoCap} style={{ color: "var(--muted)", marginBottom: 10 }}>
              The roster
            </div>
            <FleetRosterLoading />
          </section>
        </aside>

        <section className={`${styles.stageColumn} flex flex-col overflow-hidden`} style={{ minHeight: 0 }}>
          <div className={styles.stageToolbar}>
            <div className={styles.monoCap} style={{ color: "var(--accent-strong)" }}>
              <span className={`${styles.dot} ${styles.dotLive}`} style={{ color: "var(--accent)" }} />
              &nbsp; scanning swarm
            </div>
            <div className="flex" style={{ gap: 6 }}>
              {["graph", "map", "list"].map((label, index) => (
                <span
                  key={label}
                  className="uppercase"
                  style={{
                    border: `1px solid ${index === 0 ? "rgba(94,234,212,0.42)" : "rgba(148,163,184,0.18)"}`,
                    borderRadius: 9999,
                    background: index === 0 ? "rgba(45,212,191,0.12)" : "transparent",
                    color: index === 0 ? "var(--foreground)" : "var(--muted)",
                    fontFamily: "var(--f-mono)",
                    fontSize: 10,
                    letterSpacing: 0.1,
                    padding: "5px 10px",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div
            className={`${styles.stageFrame} relative grid overflow-hidden rounded-2xl`}
            style={{
              border: "1px solid rgba(148,163,184,0.16)",
              background:
                "radial-gradient(ellipse at center, rgba(255,212,90,0.06), transparent 60%), rgba(16,20,29,0.78)",
              placeItems: "center",
            }}
          >
            <FleetConstellationLoading />
          </div>
        </section>

        <aside
          className={`${styles.dispatchRail} flex flex-col overflow-y-auto overflow-x-hidden`}
          style={{ borderLeft: "1px solid rgba(148,163,184,0.16)", gap: 14 }}
        >
          <section>
            <div className={styles.monoCap} style={{ color: "var(--muted)", marginBottom: 10 }}>
              The dispatch · live
            </div>
            <div
              className={`${styles.dispatchCard} rounded-xl`}
              style={{
                padding: 14,
                border: "1px solid rgba(148,163,184,0.16)",
                background: "rgba(16,20,29,0.78)",
              }}
            >
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--foreground)", lineHeight: 1.55 }}>
                Discovery is scanning ready machines and agent bridges.
              </div>
              <div className={styles.dispatchMeta} style={{ marginTop: 8, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)" }}>
                <span>01 / 1</span>
                <span>
                  <span className={`${styles.dot} ${styles.dotLive}`} style={{ color: "var(--accent)" }} />
                  &nbsp; scanning
                </span>
              </div>
            </div>
          </section>

          <section className={`${styles.dispatchStoryList} grid`} style={{ gap: 10 }}>
            <div className={styles.monoCap} style={{ color: "var(--muted)" }}>
              Stories from the field
            </div>
            <FleetDispatchLoading />
          </section>
        </aside>
      </div>
    </div>
  );
}

export function FleetScanOverlay() {
  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 z-10 rounded-xl border border-[rgba(94,234,212,0.24)] bg-[rgba(8,13,22,0.78)] px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.26)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className={styles.monoCap} style={{ color: "var(--accent-strong)" }}>Scanning Fleet</div>
          <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">Refreshing machines, agent bridges, and live status.</p>
        </div>
        <span className="relative h-9 w-28 overflow-hidden rounded-full border border-[rgba(94,234,212,0.20)] bg-[rgba(45,212,191,0.08)]">
          <span className="absolute inset-y-0 left-0 w-10 animate-[fleet-scan-sweep_1.35s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-[rgba(94,234,212,0.42)] to-transparent" />
          <span className="absolute left-4 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[rgba(94,234,212,0.72)] shadow-[0_0_16px_rgba(94,234,212,0.50)]" />
          <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[rgba(255,212,90,0.68)] shadow-[0_0_16px_rgba(255,212,90,0.42)]" />
          <span className="absolute right-4 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[rgba(94,234,212,0.46)]" />
        </span>
      </div>
    </div>
  );
}

export function FleetRosterLoading() {
  const rows = [
    { id: "expanded", agents: 2, selected: true },
    { id: "collapsed-a", agents: 0, selected: false },
    { id: "collapsed-b", agents: 0, selected: false },
  ];

  return (
    <div className={styles.rosterLoadingList} aria-live="polite" aria-busy="true" aria-label="Loading roster">
      {rows.map((row, index) => (
        <div
          key={row.id}
          className={`${styles.rosterLoadingCard} ${row.selected ? styles.rosterLoadingCardSelected : ""}`}
          style={{ "--roster-loading-delay": `${index * 90}ms` } as CSSProperties}
        >
          <div className={styles.rosterLoadingMachineRow}>
            <span className={`${styles.rosterLoadingBlock} ${styles.rosterLoadingHex}`} />
            <span className={styles.rosterLoadingBody}>
              <span className={styles.rosterLoadingSummary}>
                <span className={styles.rosterLoadingIdentity}>
                  <span className={`${styles.rosterLoadingBlock} ${styles.rosterLoadingTitle}`} />
                  <span className={`${styles.rosterLoadingBlock} ${styles.rosterLoadingMeta}`} />
                </span>
                <span className={`${styles.rosterLoadingBlock} ${styles.rosterLoadingCount}`} />
              </span>
            </span>
            <span className={`${styles.rosterLoadingBlock} ${styles.rosterLoadingToggle}`} />
          </div>
          {row.agents > 0 ? (
            <div className={styles.rosterLoadingAgentList}>
              {Array.from({ length: row.agents }, (_, agentIndex) => (
                <div
                  key={`${row.id}-agent-${agentIndex}`}
                  className={styles.rosterLoadingAgent}
                  style={{ "--roster-loading-delay": `${index * 90 + agentIndex * 70 + 120}ms` } as CSSProperties}
                >
                  <span className={`${styles.rosterLoadingBlock} ${styles.rosterLoadingAgentHex}`} />
                  <span className={styles.rosterLoadingAgentBody}>
                    <span className={`${styles.rosterLoadingBlock} ${styles.rosterLoadingAgentName}`} />
                    <span className={`${styles.rosterLoadingBlock} ${styles.rosterLoadingAgentMeta}`} />
                  </span>
                  <span className={`${styles.rosterLoadingBlock} ${styles.rosterLoadingState}`} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function FleetConstellationLoading() {
  const nodes = [
    { left: "50%", top: "45%", size: 74, delay: 0 },
    { left: "29%", top: "32%", size: 50, delay: 120 },
    { left: "68%", top: "30%", size: 54, delay: 220 },
    { left: "33%", top: "65%", size: 46, delay: 320 },
    { left: "72%", top: "62%", size: 48, delay: 420 },
  ];
  return (
    <div className="relative h-full w-full" aria-live="polite" aria-busy="true">
      <div className="absolute left-1/2 top-[45%] h-[min(58%,520px)] w-[min(58%,520px)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(94,234,212,0.16)]" />
      <div className="absolute left-1/2 top-[45%] h-[min(42%,380px)] w-[min(42%,380px)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(255,212,90,0.14)]" />
      <div className="absolute left-1/2 top-[45%] h-px w-[56%] -translate-x-1/2 rotate-[18deg] bg-gradient-to-r from-transparent via-[rgba(94,234,212,0.32)] to-transparent" />
      <div className="absolute left-1/2 top-[45%] h-px w-[54%] -translate-x-1/2 -rotate-[22deg] bg-gradient-to-r from-transparent via-[rgba(255,212,90,0.28)] to-transparent" />
      {nodes.map((node) => (
        <span
          key={`${node.left}-${node.top}`}
          className="absolute grid animate-pulse place-items-center rounded-[22px] border border-[rgba(94,234,212,0.26)] bg-[rgba(16,20,29,0.74)] shadow-[0_18px_54px_rgba(45,212,191,0.12)]"
          style={{
            left: node.left,
            top: node.top,
            width: node.size,
            height: node.size,
            marginLeft: -node.size / 2,
            marginTop: -node.size / 2,
            animationDelay: `${node.delay}ms`,
          }}
        >
          <span className="h-3 w-3 rounded-full bg-[rgba(94,234,212,0.65)] shadow-[0_0_18px_rgba(94,234,212,0.45)]" />
        </span>
      ))}
      <div className="absolute inset-x-6 bottom-7 rounded-xl border border-[rgba(148,163,184,0.16)] bg-[rgba(8,13,22,0.72)] px-4 py-3 text-center shadow-[0_20px_70px_rgba(0,0,0,0.20)]">
        <div className={styles.monoCap} style={{ color: "var(--accent-strong)" }}>Scanning fleet discovery</div>
        <p className="m-0 mt-2 text-sm leading-6 text-[var(--muted)]">
          Finding Tailnet machines, agent bridges, and live status snapshots.
        </p>
      </div>
    </div>
  );
}

export function FleetDispatchLoading() {
  return (
    <>
      {Array.from({ length: 3 }, (_, index) => (
        <article
          key={index}
          className="rounded-xl border border-[rgba(148,163,184,0.14)] bg-[rgba(16,20,29,0.58)] p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="h-2 w-20 animate-pulse rounded-full bg-[rgba(94,234,212,0.18)]" style={{ animationDelay: `${index * 90}ms` }} />
            <span className="h-2 w-10 animate-pulse rounded-full bg-[rgba(148,163,184,0.14)]" style={{ animationDelay: `${index * 90 + 80}ms` }} />
          </div>
          <span className="block h-3 w-32 animate-pulse rounded-full bg-[rgba(226,232,240,0.18)]" style={{ animationDelay: `${index * 90 + 120}ms` }} />
          <span className="mt-2 block h-2 w-full animate-pulse rounded-full bg-[rgba(148,163,184,0.14)]" style={{ animationDelay: `${index * 90 + 180}ms` }} />
          <span className="mt-2 block h-2 w-2/3 animate-pulse rounded-full bg-[rgba(148,163,184,0.12)]" style={{ animationDelay: `${index * 90 + 240}ms` }} />
        </article>
      ))}
    </>
  );
}
