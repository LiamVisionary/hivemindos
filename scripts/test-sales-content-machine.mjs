#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { SALES_CONTENT_SOURCE_MATRIX, salesContentMatrixGaps, salesContentSourceRuntimeStatuses } = await import(
  "../src/lib/services/sales-content/source-matrix.ts"
);
const {
  buildSalesContentDispatchContext,
  deriveSalesContentEvents,
  planSalesContentActions,
  scoreSalesContentSignals,
} = await import("../src/lib/services/sales-content/signal-engine.ts");

const ids = new Set();
for (const row of SALES_CONTENT_SOURCE_MATRIX) {
  assert.ok(row.id, "matrix row has id");
  assert.ok(!ids.has(row.id), `duplicate source id ${row.id}`);
  ids.add(row.id);
  assert.ok(row.capabilities.length > 0, `${row.id} declares capabilities`);
}
assert.ok(SALES_CONTENT_SOURCE_MATRIX.some((row) => row.id === "agentmail" && row.mailProviderId === "agentmail"));
assert.ok(SALES_CONTENT_SOURCE_MATRIX.some((row) => row.id === "posthog" && row.analyticsProviderKey === "posthog"));
assert.ok(SALES_CONTENT_SOURCE_MATRIX.some((row) => row.id === "posthog" && row.credentialEnvKeys?.includes("POSTHOG_PERSONAL_API_KEY")));
assert.ok(SALES_CONTENT_SOURCE_MATRIX.some((row) => row.id === "slack" && row.connectionProviderKey === "slack" && row.credentialEnvKeys?.includes("SLACK_BOT_TOKEN")));
assert.ok(SALES_CONTENT_SOURCE_MATRIX.some((row) => row.id === "x-api" && row.mcpServerId === "xapi"));
assert.ok(SALES_CONTENT_SOURCE_MATRIX.some((row) => row.id === "hubspot" && row.status === "planned"));
assert.ok(SALES_CONTENT_SOURCE_MATRIX.some((row) => row.id === "granola" && row.status === "planned"));
assert.ok(SALES_CONTENT_SOURCE_MATRIX.some((row) => row.id === "gong" && row.status === "planned"));

const company = {
  id: "co_sales",
  name: "Sales Machine",
  agentIds: ["agent_growth"],
  charter: "Revive stalled deals and ship ad creative.",
  frozen: false,
  createdAt: "2026-07-09T00:00:00.000Z",
  createdAtMs: 0,
  updatedAt: "2026-07-09T00:00:00.000Z",
  sector: "Outbound sales agency",
  apexGoal: { title: "Book five calls this week", metric: "booked calls", target: "5" },
  analyticsProvider: "posthog",
  analyticsConfig: { projectId: "123" },
  products: {
    items: [{ key: "starter", name: "Starter sprint", amountUsd: 1500 }],
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
};

const mail = {
  configured: true,
  detail: "3 threads",
  truncated: false,
  providers: [
    { id: "agentmail", label: "AgentMail", connected: true, inboxCount: 1, threadCount: 2 },
    { id: "maps-agency-outbox", label: "Outreach Engine", connected: true, inboxCount: 0, threadCount: 1 },
  ],
  mailboxes: [],
  threads: [
    {
      id: "agentmail:inbox:t_hot",
      provider: "agentmail",
      providerLabel: "AgentMail",
      inboxAddress: "growth@example.com",
      threadId: "t_hot",
      subject: "Re: starter sprint",
      preview: "Looks useful, but the price is too expensive for our budget.",
      body: "Looks useful, but the price is too expensive for our budget.",
      direction: "inbound",
      correspondents: ["buyer@example.com"],
      messageCount: 2,
      attachmentCount: 0,
      updatedAt: Date.parse("2026-07-09T01:00:00.000Z"),
      links: [],
      labels: [],
    },
    {
      id: "maps-agency-outbox:co_sales:lead_1",
      provider: "maps-agency-outbox",
      providerLabel: "Outreach Engine",
      inboxAddress: "growth@example.com",
      threadId: "lead_1",
      subject: "Queued pitch",
      preview: "Queued - needs contact email",
      body: "Queued - needs contact email",
      direction: "queued",
      correspondents: ["lead@example.com"],
      messageCount: 1,
      attachmentCount: 0,
      updatedAt: Date.parse("2026-07-09T02:00:00.000Z"),
      links: [],
      labels: ["queued"],
    },
    {
      id: "agentmail:inbox:t_sent",
      provider: "agentmail",
      providerLabel: "AgentMail",
      inboxAddress: "growth@example.com",
      threadId: "t_sent",
      subject: "Starter sprint proof",
      preview: "Sent a proof-driven follow-up.",
      body: "Sent a proof-driven follow-up.",
      direction: "outbound",
      correspondents: ["lead2@example.com"],
      messageCount: 1,
      attachmentCount: 0,
      updatedAt: Date.parse("2026-07-09T02:30:00.000Z"),
      sentAt: Date.parse("2026-07-09T02:30:00.000Z"),
      links: [],
      labels: ["delivered"],
    },
  ],
};

const analytics = {
  ok: true,
  state: "live",
  provider: "posthog",
  providerLabel: "PostHog",
  providers: [],
  summary: {
    rangeDays: 30,
    conversions: 2,
    topSources: [{ name: "x.com", count: 42 }],
  },
};

const events = deriveSalesContentEvents(company, { mail, analytics, now: new Date("2026-07-09T03:00:00.000Z") });
assert.ok(events.some((event) => event.kind === "company.product_catalog_ready"));
assert.ok(events.some((event) => event.kind === "mail.reply_received"));
assert.ok(events.some((event) => event.kind === "mail.thread_queued"));
assert.ok(events.some((event) => event.kind === "conversation.objection"));
assert.ok(events.some((event) => event.kind === "analytics.conversion"));
assert.ok(events.some((event) => event.kind === "analytics.traffic_signal"));

const signals = scoreSalesContentSignals(company, events);
assert.ok(signals.some((signal) => signal.kind === "respond-to-reply"));
assert.ok(signals.some((signal) => signal.kind === "unblock-queued-outreach"));
assert.ok(signals.some((signal) => signal.kind === "review-pricing-evidence"));
assert.ok(signals.some((signal) => signal.kind === "produce-case-study"));
assert.ok(signals.some((signal) => signal.kind === "produce-ad-creative"));

const actions = planSalesContentActions(company, signals);
assert.ok(actions.some((action) => action.kind === "draft-reply" && action.approvalRequired));
assert.ok(actions.some((action) => action.kind === "pricing-review" && action.workBoardPrompt.includes("PRICING PROPOSAL")));

const statuses = salesContentSourceRuntimeStatuses({ company, mail, analytics });
assert.ok(statuses.find((item) => item.row.id === "agentmail")?.ready);
assert.equal(statuses.find((item) => item.row.id === "posthog")?.status, "configured");
assert.ok(salesContentMatrixGaps(statuses).some((gap) => gap.includes("CRM")));

const context = buildSalesContentDispatchContext({ signals, actions, gaps: salesContentMatrixGaps(statuses) });
assert.ok(context.includes("Sales/content machine signals:"));
assert.ok(context.includes("Recommended next sales/content actions:"));

console.log("sales content machine suite passed");
process.exit(0);
