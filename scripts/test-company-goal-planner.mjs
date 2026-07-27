#!/usr/bin/env node
// Hermetic coverage for the company goal-planner prompt: standing operator
// directions and active approval policies must reach the PLANNER, not just the
// workers — otherwise the planner keeps proposing work a human already redirected
// or a policy forbids (a confirmed high-severity blindness).
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { userPrompt } = await import("../src/lib/services/companies-goal-planner.ts");

const base = {
  id: "co-planner-1",
  name: "Website Outreach Agency",
  sector: "Web",
  agentIds: [],
  frozen: false,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  apexGoal: { title: "Earn $150k/yr", metric: "weekly revenue", target: "2885" },
};

// Standing directives + an explicit 'never' policy reach the planner prompt.
const withGuidance = {
  ...base,
  directives: [{ id: "d1", text: "Stop cold-emailing restaurants; target law firms.", createdAt: base.createdAt }],
  approvalPolicies: [
    {
      id: "customer-website-use",
      subject: "publishing, sending, or handing off a customer-facing website or preview",
      mode: "never",
      source: "default",
    },
  ],
};
const guided = userPrompt(withGuidance);
assert.ok(
  guided.includes("Stop cold-emailing restaurants; target law firms."),
  "standing operator directions reach the planner prompt",
);
assert.ok(
  /NEVER plan a task/.test(guided) && guided.includes("customer-facing website"),
  "a 'never' approval policy tells the planner not to plan that work",
);

// With no explicit config, the two built-in policies default to 'ask' (see Build 1),
// so the planner is told to park drafts for approval rather than act directly.
const defaults = userPrompt(base);
assert.ok(
  /need human approval/i.test(defaults) && defaults.includes("sending customer-facing emails"),
  "default ask policies instruct the planner to park customer-facing sends for approval",
);

console.log("company goal planner prompt suite passed");
process.exit(0);
