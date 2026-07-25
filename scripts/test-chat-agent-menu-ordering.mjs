#!/usr/bin/env node
// The chat header's agent picker sorts by real usage: a short most-recent run,
// then the agents with the most threads, then everything else by name.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  AGENT_MENU_GROUP_LABELS,
  chatAgentUsageStats,
  rankAgentMenuRows,
} = await import("../src/features/dashboard/views/chat/chat-panel-helpers.ts");

// ---- usage stats come off the same sidebar rows the history list renders ----
const usage = chatAgentUsageStats([
  { agentId: "scout", updatedAt: 3_000 },
  { agentId: "scout", updatedAt: 9_000 },
  { agentId: "scout", updatedAt: 0 },
  { agentId: "queen", updatedAt: 12_000 },
  { agentId: "drone", updatedAt: 1_000 },
  { agentId: "drone", updatedAt: 2_000 },
  { agentId: "", updatedAt: 99_000 },
  { updatedAt: 99_000 },
]);

assert.deepEqual(usage.get("scout"), { lastUsedAt: 9_000, threadCount: 3 }, "last-used should be the newest thread, count should include every thread row");
assert.deepEqual(usage.get("queen"), { lastUsedAt: 12_000, threadCount: 1 });
assert.deepEqual(usage.get("drone"), { lastUsedAt: 2_000, threadCount: 2 });
assert.equal(usage.has(""), false, "rows without an agent id must not create a bucket");
assert.equal(usage.size, 3);

assert.deepEqual(
  chatAgentUsageStats([{ agentId: "a", updatedAt: undefined }, { agentId: "a", updatedAt: Number.NaN }, { agentId: "a", updatedAt: -5 }]).get("a"),
  { lastUsedAt: 0, threadCount: 3 },
  "missing/invalid timestamps should count as never-used, not poison the max",
);

assert.deepEqual(chatAgentUsageStats(), new Map(), "no rows should be tolerated");

// ---- ranking -----------------------------------------------------------
const row = (id, name) => ({ agent: { id, name }, machine: { key: "this-mac" } });

const ranked = rankAgentMenuRows(
  [
    row("zeta", "Zeta"),
    row("alpha", "Alpha"),
    row("busy", "Busy"),
    row("queen", "Queen"),
    row("scout", "Scout"),
    row("drone", "Drone"),
    row("mid", "Mid"),
  ],
  new Map([
    ["queen", { lastUsedAt: 12_000, threadCount: 1 }],
    ["scout", { lastUsedAt: 9_000, threadCount: 3 }],
    ["drone", { lastUsedAt: 2_000, threadCount: 2 }],
    ["mid", { lastUsedAt: 1_000, threadCount: 1 }],
    ["busy", { lastUsedAt: 500, threadCount: 8 }],
  ]),
  { recentLimit: 3 },
);

assert.deepEqual(
  ranked.map((item) => [item.agent.id, item.menuGroup]),
  [
    ["queen", "recent"],
    ["scout", "recent"],
    ["drone", "recent"],
    ["busy", "frequent"],
    ["alpha", "all"],
    ["mid", "all"],
    ["zeta", "all"],
  ],
  "recent run first (newest first, capped), then most-threads, then alphabetical",
);

const noUsage = rankAgentMenuRows([row("c", "Cedar"), row("a", "acacia"), row("b", "Birch")], new Map());
assert.deepEqual(
  noUsage.map((item) => [item.agent.id, item.menuGroup]),
  [["a", "all"], ["b", "all"], ["c", "all"]],
  "with no chat history at all the picker is plain case-insensitive alphabetical",
);

const tiedRecent = rankAgentMenuRows(
  [row("b", "Beta"), row("a", "Alpha")],
  new Map([["a", { lastUsedAt: 5_000, threadCount: 1 }], ["b", { lastUsedAt: 5_000, threadCount: 1 }]]),
);
assert.deepEqual(tiedRecent.map((item) => item.agent.id), ["a", "b"], "identical timestamps fall back to name order, never render order chance");

const frequentTie = rankAgentMenuRows(
  [row("old", "Old"), row("new", "New")],
  new Map([["old", { lastUsedAt: 100, threadCount: 4 }], ["new", { lastUsedAt: 900, threadCount: 4 }]]),
  { recentLimit: 0 },
);
assert.deepEqual(frequentTie.map((item) => item.agent.id), ["new", "old"], "equal thread counts break to the more recently used agent");

const singleThread = rankAgentMenuRows(
  [row("solo", "Solo")],
  new Map([["solo", { lastUsedAt: 0, threadCount: 1 }]]),
);
assert.equal(singleThread[0].menuGroup, "all", "one never-timestamped thread is not enough to call an agent 'most used'");

assert.deepEqual(
  rankAgentMenuRows([{ agent: { id: "x" } }], new Map()).map((item) => item.menuGroup),
  ["all"],
  "an agent with no display name still ranks",
);

// ---- the picker actually consumes the ranking -------------------------------
const panel = readFileSync(new URL("../src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx", import.meta.url), "utf8");

assert.match(
  panel,
  /const agentMenuUsage = useMemo\(\(\) => chatAgentUsageStats\(sidebarRows\), \[sidebarRows\]\)/,
  "agent picker usage stats must come from the real sidebar chat rows",
);
assert.match(
  panel,
  /const agentMenuRows = useMemo\(\(\) => rankAgentMenuRows\([\s\S]*?\}\)\)\), agentMenuUsage\)\s*\n\s*\.filter\(/,
  "ranking must run over the full agent list before the search filter, so searching never reorders groups",
);
assert.match(
  panel,
  /!normalizedAgentMenuSearchQuery && menuGroup !== agentMenuRows\[rowIndex - 1\]\?\.menuGroup/,
  "group headings should render once per group and only on the unfiltered list",
);
assert.match(
  panel,
  /type="search"[\s\S]{0,240}?autoFocus/,
  "opening the agent picker should focus its search field",
);

assert.deepEqual(
  AGENT_MENU_GROUP_LABELS,
  { recent: "Recent", frequent: "Most used", all: "All agents" },
  "group labels are user-facing copy the panel renders verbatim",
);

console.log("Chat agent picker ranks by recency, then usage, then name.");
