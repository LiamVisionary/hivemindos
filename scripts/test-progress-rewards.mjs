#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  buildProgressRewardStakingSummary,
  buildProgressRewardsSnapshot,
} = await import("../src/lib/services/progress-rewards-core.ts");

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const now = Date.UTC(2026, 5, 23, 12, 0, 0);
const yesterday = Date.UTC(2026, 5, 22, 10, 0, 0);
const todayMorning = Date.UTC(2026, 5, 23, 9, 0, 0);
const lastWeek = Date.UTC(2026, 5, 19, 10, 0, 0);
const staking = buildProgressRewardStakingSummary({
  walletCount: 3,
  checkedWalletCount: 3,
  totalStakedHive: 62_000_000,
  pendingUnstakeHive: 2_000_000,
  paused: false,
  cooldownSeconds: 1_209_600,
});

const snapshot = buildProgressRewardsSnapshot({
  now,
  timezoneOffsetMinutes: 0,
  tasks: [
    {
      id: "task-yesterday",
      title: "Ship reward popup",
      status: "done",
      assignee: "agent-a",
      completedAt: yesterday,
      deliverables: [{ kind: "file" }, { kind: "url" }],
    },
    {
      id: "task-week",
      title: "Plan weekly loop",
      status: "done",
      assignee: "agent-b",
      completedAt: todayMorning,
      deliverables: [{ kind: "document" }],
    },
    {
      id: "task-old",
      title: "Old work",
      status: "done",
      assignee: "agent-a",
      completedAt: lastWeek,
    },
    {
      id: "task-working",
      title: "Still running",
      status: "working",
      assignee: "agent-a",
      updatedAt: yesterday,
    },
  ],
  honeyEvents: [
    {
      id: "honey-a",
      agentId: "agent-a",
      agentName: "Aster",
      kind: "usage",
      source: "chat",
      honeyDelta: 1.25,
      createdAt: new Date(yesterday + hour).toISOString(),
    },
    {
      id: "managed-credit",
      agentId: "agent-a",
      kind: "managed-credit",
      source: "managed-agent-stripe",
      honeyDelta: 5,
      createdAt: new Date(yesterday + 2 * hour).toISOString(),
    },
    {
      id: "exchange",
      agentId: "agent-a",
      kind: "exchange",
      source: "manual",
      honeyDelta: -0.5,
      hiveDelta: 0.5,
      createdAt: new Date(yesterday + 3 * hour).toISOString(),
    },
    {
      id: "honey-old",
      agentId: "agent-a",
      kind: "usage",
      source: "chat",
      honeyDelta: 100,
      createdAt: new Date(lastWeek).toISOString(),
    },
  ],
  spendRecords: [
    {
      id: "fee-a",
      agentId: "agent-a",
      kind: "platform-fee",
      amountUsd: 2.5,
      status: "executed",
      createdAtMs: yesterday + hour,
    },
    {
      id: "send-a",
      agentId: "agent-b",
      kind: "send",
      amountUsd: 3,
      status: "executed",
      createdAtMs: todayMorning,
    },
    {
      id: "failed-fee",
      agentId: "agent-a",
      kind: "platform-fee",
      amountUsd: 99,
      status: "failed",
      createdAtMs: yesterday,
    },
  ],
  companies: [{
    id: "company-a",
    name: "Aperture Labs",
    ticker: "APR",
    agentIds: ["agent-a"],
    frozen: false,
    createdAt: new Date(now - 10 * day).toISOString(),
    createdAtMs: now - 10 * day,
    updatedAt: new Date(now).toISOString(),
    apexGoal: {
      title: "Reach $10k weekly revenue",
      metric: "weekly revenue",
      target: "$10k",
      progress: 42,
      unit: "currency",
    },
    revenue: {
      kind: "revenue",
      label: "weekly revenue",
      value: "$4.2k",
      target: "$10k",
      pct: 42,
      delta: "+12%",
      up: true,
      isApex: true,
    },
  }],
  staking,
});

assert.equal(snapshot.daily.id, "daily:2026-06-22");
assert.equal(snapshot.daily.metrics.completedTasks, 1);
assert.equal(snapshot.daily.metrics.deliverables, 2);
assert.equal(snapshot.daily.metrics.honeyEarned, 1.25);
assert.equal(snapshot.daily.metrics.managedHoneyCredits, 5);
assert.equal(snapshot.daily.metrics.trackedRevenueUsd, 2.5);
assert.equal(snapshot.daily.metrics.spendUsd, 0);
assert.equal(snapshot.daily.metrics.activeAgents, 1);
assert.equal(snapshot.daily.topContributors[0]?.name, "Aster");
assert.equal(snapshot.daily.topCompanies[0]?.name, "Aperture Labs");
assert.equal(snapshot.daily.topCompanies[0]?.progress, 42);
assert(snapshot.daily.highlights.some((item) => item.includes("HONEY earned")), "daily highlights should mention HONEY");

assert.equal(snapshot.weekly.id, "weekly:2026-06-22");
assert.equal(snapshot.weekly.metrics.completedTasks, 2);
assert.equal(snapshot.weekly.metrics.deliverables, 3);
assert.equal(snapshot.weekly.metrics.honeyEarned, 1.25);
assert.equal(snapshot.weekly.metrics.trackedRevenueUsd, 2.5);
assert.equal(snapshot.weekly.metrics.spendUsd, 3);
assert.equal(snapshot.weekly.topContributors[0]?.id, "agent-a");
assert(snapshot.weekly.hasActivity, "weekly summary should be active when work landed this week");

assert.equal(snapshot.staking.totalStakedHive, 62_000_000);
assert.equal(snapshot.staking.pendingUnstakeHive, 2_000_000);
assert.equal(snapshot.staking.currentTier?.label, "Builder");
assert.equal(snapshot.staking.nextTier?.label, "Curator");
assert.equal(snapshot.staking.toNextTierHive, 38_000_000);
assert.equal(snapshot.staking.progressToNextTier, 0.24);

console.log("progress reward aggregation tracks daily and weekly tasks, Honey, platform-fee revenue, spend, contributors, company apex progress, and HIVE staking tier status.");
