#!/usr/bin/env node
// Focused coverage for generalized Zero Human Company approval gates:
// - Learning directives such as "always ask before ..." become configurable
//   Approval-tab policy rows.
// - Explicit Off / Ask / Never choices merge over default + learned rows.
// - Active policies reach the worker context as hard stop / ask-first guidance.
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  activeCompanyApprovalPolicies,
  approvalPolicySubjectFromDirective,
  companyApprovalPolicyIdForSubject,
  resolveCompanyApprovalPolicies,
} = await import("../src/lib/services/company-approval-policies.ts");
const { companyWorkerContext } = await import("../src/lib/services/companies-orchestration.ts");

const videoDirective = {
  id: "directive-video-approval",
  text: "always ask for my permission before generating a video from a script",
  source: "inject",
  createdAt: "2026-07-06T00:00:00.000Z",
};

assert.equal(
  approvalPolicySubjectFromDirective(videoDirective.text),
  "generating a video from a script",
  "permission directive extracts the governed action phrase",
);

const learnedVideoId = companyApprovalPolicyIdForSubject("generating a video from a script");
const resolved = resolveCompanyApprovalPolicies({
  directives: [videoDirective],
  approvalPolicies: [],
});
assert.ok(
  resolved.some((policy) => policy.id === "customer-email-send" && policy.mode === "off" && policy.source === "default"),
  "built-in email policy is configurable even before it is active",
);
assert.ok(
  resolved.some((policy) => policy.id === "customer-website-use" && policy.mode === "off" && policy.source === "default"),
  "built-in website policy is configurable even before it is active",
);
assert.deepEqual(
  resolved.find((policy) => policy.id === learnedVideoId),
  {
    id: learnedVideoId,
    subject: "generating a video from a script",
    mode: "ask",
    source: "learning",
    directiveId: "directive-video-approval",
    createdAt: "2026-07-06T00:00:00.000Z",
  },
  "learned permission subjects appear as ask-first policies",
);

const disabled = activeCompanyApprovalPolicies({
  directives: [videoDirective],
  approvalPolicies: [
    {
      id: learnedVideoId,
      subject: "generating a video from a script",
      mode: "off",
      source: "learning",
    },
  ],
});
assert.equal(
  disabled.some((policy) => policy.id === learnedVideoId),
  false,
  "explicit Off overrides a learned ask-first directive in the active set",
);

const context = companyWorkerContext({
  id: "co-approval-test",
  name: "WEBS",
  sector: "Website agency",
  charter: "Build, preview, and send websites and email outreach.",
  agentIds: [],
  frozen: false,
  createdAt: "2026-07-06T00:00:00.000Z",
  updatedAt: "2026-07-06T00:00:00.000Z",
  directives: [videoDirective],
  approvalPolicies: [
    {
      id: "customer-email-send",
      subject: "sending customer-facing emails",
      mode: "ask",
      source: "default",
    },
    {
      id: "customer-website-use",
      subject: "publishing, sending, or handing off a customer-facing website or preview",
      mode: "never",
      source: "default",
    },
  ],
}, "");

assert.match(
  context,
  /Human approval policies - mandatory before acting:/,
  "worker context names approval policies as mandatory",
);
assert.match(
  context,
  /Before sending customer-facing emails, ask the human first:/,
  "ask-first policies instruct the worker to park the work for review",
);
assert.match(
  context,
  /Never proceed with publishing, sending, or handing off a customer-facing website or preview\./,
  "never policies instruct the worker not to proceed",
);
assert.match(
  context,
  /Before generating a video from a script, ask the human first:/,
  "learned policy reaches the worker context",
);

console.log("company approval policy suite passed");
process.exit(0);
