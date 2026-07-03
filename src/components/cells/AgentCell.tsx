"use client";

import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import type { AgentRuntime, BeeWorkerClass } from "@/lib/types/agent-runtime";
import { RUNTIME_LABELS } from "@/lib/types/agent-runtime";
import { LottiePlayer } from "@/components/ui/lottie-player";

import { agentStatus } from "./statusCopy";
import type { StatusKind } from "./StatusPill";

const ORCHESTRATOR_HINT = /orchestrat|main|queen|lead|control/i;

function isOrchestrator(name: string, runtime: AgentRuntime) {
  if (runtime === "openclaw") return true;
  return ORCHESTRATOR_HINT.test(name);
}

/**
 * AgentCell — two-line, readable agent row.
 *
 *   ●  Hermes Orchestrator                                    ⋮
 *      Hermes · 12h ago · Working on Sync setup
 *
 * Line 1 gives the name the entire row width — no runtime glyph box
 * fighting for space, no mystery-meat task-count chip eating pixels.
 * Line 2 collapses runtime, last-activity time, and the current task
 * title into a single muted line that truncates as one unit.
 *
 * The Chat action lives in the row's context menu (gear icon) — there
 * is no inline button so the row stays calm at rest.
 */
type AgentCellProps = {
  name: string;
  roleLabel?: string;
  runtime: AgentRuntime;
  workerClass?: BeeWorkerClass;
  hasTelemetryUrl: boolean;
  activeCount: number;
  snapshotOk?: boolean;
  processRunning?: boolean;
  snapshotError?: string;
  primaryWork?: { title: string } | null;
  /** Pre-formatted relative time string, e.g. "12h ago". */
  primaryWorkTime?: string;
  emptyTitle?: string;
  selected?: boolean;
  onSelect: () => void;
  /** Optional context menu (gear) rendered at row end. */
  menu?: ReactNode;
  /** Inline content beneath the row when selected (e.g. task list). */
  expandedContent?: ReactNode;
};

const DOT_TONE: Record<StatusKind, string> = {
  running: "bg-[#4ade80]",
  healthy: "bg-[#4ade80]",
  idle: "bg-[#94a3b8]",
  blocked: "bg-[#fb7185]",
  "needs-setup": "bg-[#fbbf24]",
  "needs-funding": "bg-[#fbbf24]",
  "requires-approval": "bg-[#fb7185]",
  "collector-offline": "bg-[#fbbf24]",
  risk: "bg-[#fb7185]",
  "memory-synced": "bg-[#5eead4]",
  unknown: "bg-[#64748b]",
  private: "bg-[#5eead4]",
  offline: "bg-[#475569]",
  updating: "bg-[#5eead4]",
  off: "bg-[#475569]",
};

export function AgentCell({
  name,
  roleLabel,
  runtime,
  workerClass = "general",
  hasTelemetryUrl,
  activeCount,
  snapshotOk,
  processRunning,
  snapshotError,
  primaryWork,
  primaryWorkTime,
  emptyTitle,
  selected,
  onSelect,
  menu,
  expandedContent,
}: AgentCellProps) {
  const state = agentStatus({ hasTelemetryUrl, activeCount, snapshotOk, processRunning, snapshotError });
  const showExpanded = Boolean(selected && expandedContent);
  const workSummary = primaryWork?.title || emptyTitle || state.body;
  const queen = isOrchestrator(name, runtime);
  const beeIcon = beeRoleIconPath(queen ? "queen" : "worker", workerClass);
  const beeLabel = queen ? "Queen bee (orchestrator)" : "Worker bee";
  const visibleRoleLabel = roleLabel ?? (queen ? "Queen Bee" : "Worker Bee");
  const isBusy = state.kind === "running";

  // Compose line 2 — "Hermes · 12h ago · Working on …". Each piece is
  // optional; only the runtime label is guaranteed.
  const metaParts = [
    RUNTIME_LABELS[runtime],
    primaryWorkTime,
    workSummary,
  ].filter(Boolean);

  return (
    <div
      className={cn(
        "group flex flex-col rounded transition-colors",
        selected
          ? "bg-[rgba(45,212,191,0.06)]"
          : "hover:bg-[rgba(148,163,184,0.05)]",
      )}
    >
      <div className="flex items-start gap-2 px-2 py-2">
        <span
          className={cn(
            "relative mt-0.5 inline-flex size-8 shrink-0 items-center justify-center",
            queen ? "agentAvatar--queen" : "agentAvatar--worker",
          )}
          title={`${beeLabel} · ${state.body}`}
          aria-label={beeLabel}
        >
          {isBusy ? (
            <LottiePlayer
              src="/animations/Honey%20bee.lottie"
              size={32}
              ariaLabel={`${beeLabel}, active`}
            />
          ) : (
            <Image
              src={beeIcon}
              alt=""
              width={32}
              height={32}
              className="size-8 object-contain"
              aria-hidden="true"
              unoptimized
            />
          )}
          <span
            aria-hidden="true"
            className={cn(
              "absolute -right-0.5 -bottom-0.5 inline-block size-2 rounded-full ring-2 ring-[var(--background,#0b0f14)]",
              DOT_TONE[state.kind],
            )}
          />
        </span>
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
          aria-label={`Select ${name}`}
        >
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="min-w-0 break-words text-[0.82rem] font-semibold leading-tight text-[var(--foreground)]">
              {name}
            </span>
            <span className="inline-flex shrink-0 items-center rounded border border-[rgba(94,234,212,0.24)] bg-[rgba(45,212,191,0.08)] px-1.5 py-0.5 text-[0.56rem] font-semibold uppercase leading-none tracking-[0.08em] text-[var(--accent-strong)]">
              {visibleRoleLabel}
            </span>
          </span>
          <span className="truncate text-[0.7rem] leading-snug text-[var(--muted)]">
            {metaParts.join(" · ")}
          </span>
        </button>
        {menu ? (
          // The gear menu is the only action affordance on the row at
          // rest — Chat / Wallet / Settings all live inside it.
          <div className="-mr-1 opacity-50 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {menu}
          </div>
        ) : null}
      </div>

      {showExpanded ? (
        <div className="px-2 pb-2 pl-[1.4rem]">
          {expandedContent}
        </div>
      ) : null}
    </div>
  );
}
