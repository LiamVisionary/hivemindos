// Zero Human Companies — presentation constants + crew helpers.
// The mock COLONIES / AGENT_POOL from the prototype are gone: real companies and
// agents arrive from /api/companies and /api/obsidian/agents via the live view.
// Concepts adapted from mesa (msoedov/mesa): CEO/agent hierarchy, Apex goals
// (strategic OKRs) + alignment, single-active Work Block, Linear-style issue
// lifecycle, per-agent budget caps, approval gates, recursive governance.

import type { Agent, Colony, PoolAgent, CompanyStatus, IssueStatus, Priority, Role } from "./types";

export const STATUS_TONE: Record<CompanyStatus, { label: string; color: string; dot: string }> = {
  shipping: { label: "shipping", color: "var(--cyan-2)", dot: "var(--cyan)" },
  drift: { label: "off-strategy", color: "var(--danger-2)", dot: "var(--danger)" },
  review: { label: "board review", color: "var(--honey-2)", dot: "var(--honey)" },
  setup: { label: "bootstrapping", color: "var(--fg-3)", dot: "var(--fg-4)" },
  paused: { label: "paused", color: "var(--warn)", dot: "var(--warn)" },
};

export const ISSUE_LANES: { key: IssueStatus; label: string; hint: string }[] = [
  { key: "todo", label: "Backlog", hint: "scoped · unassigned" },
  { key: "in_progress", label: "In progress", hint: "agent executing" },
  { key: "in_review", label: "In review", hint: "reviewer auditing" },
  { key: "board_review", label: "Board review", hint: "escalated to Queen" },
  { key: "done", label: "Shipped", hint: "merged · immutable" },
];

export const PRI: Record<Priority, { label: string; color: string }> = {
  urgent: { label: "P0", color: "var(--danger)" },
  high: { label: "P1", color: "var(--honey-2)" },
  med: { label: "P2", color: "var(--cyan-2)" },
  low: { label: "P3", color: "var(--fg-4)" },
};

// role glyphs (queen = CEO root)
export const ROLE_GLYPH: Record<string, string> = {
  Queen: "♛", Engineer: "⌥", Product: "◈", Designer: "✦", QA: "✓",
  DevOps: "⚙", Auditor: "⊘", Growth: "↗", Research: "✸", Treasury: "⬡",
};

export function portfolioStats(list: Colony[]) {
  const colonies = list.length;
  const agents = list.reduce((n, c) => n + c.agents.length, 0);
  const working = list.reduce((n, c) => n + c.agents.filter((a) => a.state === "working").length, 0);
  const shipped = list.reduce((n, c) => n + c.issues.filter((i) => i.status === "done").length, 0);
  const approvals = list.reduce((n, c) => n + c.approvals.length, 0);
  const burnToday = list.reduce((n, c) => n + c.burn.today, 0);
  const avgAlign = colonies ? Math.round(list.reduce((n, c) => n + c.alignment, 0) / colonies) : 0;
  return { colonies, agents, working, shipped, approvals, burnToday, avgAlign };
}

/** default company budget: half the agent's general wallet cap (rounded to $5). */
export const defaultCompanyCap = (walletCap: number): number =>
  Math.max(5, Math.round((Math.max(walletCap, 10) * 0.5) / 5) * 5);

/**
 * Stage an existing roster agent onto a company's crew with a company-specific
 * budget cap. `roleOverride` lets the first hire become the Queen/CEO.
 */
export function assignAgent(
  poolAgent: PoolAgent,
  companyCap?: number,
  reportsTo?: string | null,
  roleOverride?: Role,
): Agent {
  return {
    id: poolAgent.id,
    name: poolAgent.name,
    role: roleOverride ?? poolAgent.role,
    runtime: poolAgent.runtime,
    model: poolAgent.model,
    walletCap: poolAgent.walletCap,
    state: "ready",
    reportsTo: reportsTo ?? null,
    budgetPct: 0,
    task: "Idle · just joined the crew",
    _cap: companyCap != null ? companyCap : defaultCompanyCap(poolAgent.walletCap),
  };
}
