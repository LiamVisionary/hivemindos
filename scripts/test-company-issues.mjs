#!/usr/bin/env node
// Hermetic coverage for the Zero Human Companies issue-unblock flow: blocked
// company tasks need a clear "Mark Resolved" path that feeds the existing
// Work Board human-answer/resume mechanism, not a local-only dismissal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { resolvedIssueAnswer } = await import("../src/features/dashboard/views/zero-human-companies/issue-resume.ts");

const issue = {
  title: "Resolve email deliverability setup issues",
  work: {
    taskId: "t_agentmail_domain_gate",
    status: "needs-human",
    result: "Custom SPF/DKIM remains blocked: AgentMail returned Domain limit exceeded while GET /v0/domains reports count 0.",
  },
};

const answer = resolvedIssueAnswer(issue);
assert.match(answer, /Human marked this company blocker resolved/, "answer records human-resolved intent");
assert.match(answer, /t_agentmail_domain_gate/, "answer includes the task id for provenance");
assert.match(answer, /Domain limit exceeded/, "answer preserves the prior blocker");
assert.match(answer, /re-check the external\/provider state/i, "answer tells the agent to verify, not blindly proceed");
assert.match(answer, /only proceed to sends, DNS changes, spend, or completion after the real checks pass/i, "answer preserves governance gates");

const actionsSource = readFileSync("src/features/dashboard/views/zero-human-companies/CompanyIssueActions.tsx", "utf8");
assert.match(actionsSource, /Mark Resolved/, "issue action card exposes Mark Resolved");
assert.match(actionsSource, /openIssueOnWorkBoard/, "issue actions keep Work Board navigation");
assert.match(actionsSource, /companyIssueDiscussPrompt/, "issue actions keep Discuss");

const cockpitSource = readFileSync("src/features/dashboard/views/zero-human-companies/Cockpit.tsx", "utf8");
assert.match(cockpitSource, /key: "issues"/, "cockpit tab row includes Issues");
assert.match(cockpitSource, /IssuesPanel/, "cockpit has a dedicated issues panel");
assert.match(cockpitSource, /onResolveIssue/, "cockpit passes issue resolution handler");

const liveSource = readFileSync("src/features/dashboard/views/zero-human-companies/ZeroHumanCompaniesView.tsx", "utf8");
assert.match(liveSource, /action: "answer"/, "live resolver uses the Work Board answer action");
assert.match(liveSource, /resolvedIssueAnswer\(issue\)/, "live resolver uses the audited resume message");
assert.match(liveSource, /pickupScheduled/, "live resolver reports immediate pickup status");

const boardSource = readFileSync("src/features/dashboard/views/zero-human-companies/IssueBoard.tsx", "utf8");
assert.doesNotMatch(boardSource, /WebkitLineClamp|textOverflow:\s*"ellipsis"/, "issue blockers are not silently truncated");

console.log("company-issues: all assertions passed");
