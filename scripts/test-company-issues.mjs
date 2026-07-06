#!/usr/bin/env node
// Hermetic coverage for the Zero Human Companies issue-unblock flow: blocked
// company tasks need a clear "Mark Resolved" path that feeds the existing
// Work Board human-answer/resume mechanism, not a local-only dismissal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { resolvedIssueAnswer } = await import("../src/features/dashboard/views/zero-human-companies/issue-resume.ts");
const { agentsAtWork } = await import("../src/features/dashboard/views/zero-human-companies/data.ts");

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

assert.equal(
  agentsAtWork({
    agents: [
      { name: "HermesMain", state: "ready" },
      { name: "Ada Lovelace", state: "ready" },
    ],
    issues: [
      { title: "Launch verified follow-up sequence", status: "in_progress", agent: "HermesMain" },
      { title: "Review pricing objections", status: "in_progress", agent: "HermesMain" },
      { title: "Ship old batch", status: "done", agent: "Ada Lovelace" },
    ],
  }),
  1,
  "agents-at-work counts unique live in-progress assignees, not stale persisted crew state or cards",
);
assert.equal(
  agentsAtWork({
    agents: [{ name: "Ada Lovelace", state: "working" }],
    issues: [],
  }),
  1,
  "agents-at-work keeps the explicit working crew-state fallback",
);

const actionsSource = readFileSync("src/features/dashboard/views/zero-human-companies/CompanyIssueActions.tsx", "utf8");
assert.match(actionsSource, /Mark Resolved/, "issue action card exposes Mark Resolved");
assert.match(actionsSource, /openIssueOnWorkBoard/, "issue actions keep Work Board navigation");
assert.match(actionsSource, /companyIssueDiscussPrompt/, "issue actions keep Discuss");

const cockpitSource = readFileSync("src/features/dashboard/views/zero-human-companies/Cockpit.tsx", "utf8");
assert.match(cockpitSource, /key: "issues"/, "cockpit tab row includes Issues");
assert.match(cockpitSource, /IssuesPanel/, "cockpit has a dedicated issues panel");
assert.match(cockpitSource, /onResolveIssue/, "cockpit passes issue resolution handler");
assert.match(cockpitSource, /function IssuesLoadingSkeleton/, "issues panel has a skeleton pending state");
assert.match(cockpitSource, /aria-label="Loading company issues"/, "issues pending state is animated and accessible");
assert.match(cockpitSource, /loading=\{initialTasksLoading\}/, "issues panel receives the initial task-loading state");
assert.match(cockpitSource, /const activeIssueCount = c\.issues\.filter\(\(issue\) => issue\.status !== "done"\)\.length/, "Issues tab badge counts all active issues");
assert.match(cockpitSource, /badge: activeIssueCount \|\| null/, "Issues tab badge is wired to the active issue count");
assert.match(cockpitSource, /badgeLoading: initialTasksLoading && activeIssueCount === 0/, "Issues tab shows a skeleton badge while issue counts hydrate");

const liveSource = readFileSync("src/features/dashboard/views/zero-human-companies/ZeroHumanCompaniesView.tsx", "utf8");
assert.match(liveSource, /action: "answer"/, "live resolver uses the Work Board answer action");
assert.match(liveSource, /resolvedIssueAnswer\(issue\)/, "live resolver uses the audited resume message");
assert.match(liveSource, /pickupScheduled/, "live resolver reports immediate pickup status");

const boardSource = readFileSync("src/features/dashboard/views/zero-human-companies/IssueBoard.tsx", "utf8");
assert.doesNotMatch(boardSource, /WebkitLineClamp|textOverflow:\s*"ellipsis"/, "issue blockers are not silently truncated");
const taskModalSource = readFileSync("src/features/dashboard/views/zero-human-companies/TaskDetailModal.tsx", "utf8");
assert.match(taskModalSource, /issue\.status === "board_review" \|\| work\.status === "needs-human"/, "blocked-task explainer is gated to needs-human cards");
assert.match(taskModalSource, /const canExplain = isBlockedForHuman && Boolean\(companyId\)/, "completed shipped cards do not show the blocked-task explainer");

// ── classifyIssueReason: exhausted-pickup cards must name the REAL cause ─────
const { classifyIssueReason } = await import("../src/features/dashboard/views/zero-human-companies/issue-reason.ts");

const exhausted = (lines) => ({
  work: {
    taskId: "t_reason_test",
    result: [
      "Queen Bee autonomous pickup exhausted all eligible delegates and now needs human input.",
      "Failures:",
      ...lines.map((line) => `- ${line}`),
      "ACTION NEEDED: Review the delegate failures above.",
    ].join("\n"),
  },
});

// The live WEBS shape (2026-07-05): transport failures + claim-race collateral must
// classify as "machine unreachable", NOT the generic "No delegates available".
const unreachableInfo = classifyIssueReason(exhausted([
  "Ida B. Wells: The operation was aborted due to timeout",
  "Grace Hopper: 502 Bad Gateway: hivemind-linkd proxy error: dial tcp 127.0.0.1:8787: connect: connection refused",
  "HermesMain: fetch failed",
  "Octavia Butler: Task is not ready to claim.",
  "Ada Lovelace: Task is not ready to claim.",
]));
assert.equal(unreachableInfo.category, "delegates-unreachable", "transport failures classify as unreachable");
assert.match(unreachableInfo.reason, /down or restarting/i, "reason points at the collector, not worker classes");
assert.equal(unreachableInfo.consolidatable, true, "unreachable cards consolidate");

// Pure claim-race chains (all lines are race collateral) name the race.
const raceInfo = classifyIssueReason(exhausted([
  "Grace Hopper: Task is not ready to claim.",
  "Ada Lovelace: Task is not ready to claim.",
]));
assert.equal(raceInfo.signature, "delegation:race", "pure claim races get their own signature");
assert.match(raceInfo.reason, /re-run/i, "race cards say the work is safe to re-run");

// Existing classes keep their behavior.
const offlineInfo = classifyIssueReason(exhausted(["Grace Hopper: no live delegated collector/agent"]));
assert.equal(offlineInfo.category, "delegates-offline");
const busyInfo = classifyIssueReason(exhausted(['Grace Hopper: machine "mac" is at its autonomous chat capacity']));
assert.equal(busyInfo.category, "delegates-busy");
const mixedInfo = classifyIssueReason(exhausted([
  "Grace Hopper: no live delegated collector/agent",
  "Ada Lovelace: The operation was aborted due to timeout",
]));
assert.equal(mixedInfo.signature, "delegation:mixed", "multiple causes still merge into the mixed card");
const genericInfo = classifyIssueReason(exhausted(["Grace Hopper: something novel went wrong"]));
assert.equal(genericInfo.category, "no-delegates", "unrecognized failures keep the generic fallback");

// A genuine human ask stays a distinct, non-consolidatable card.
const askInfo = classifyIssueReason({ work: { taskId: "t_ask", result: "ACTION NEEDED: Choose the pricing tier.", body: "" } });
assert.equal(askInfo.category, "needs-input");
assert.equal(askInfo.consolidatable, false);

// ── Re-run: zero-human boards can't be hand-moved, so consolidated infra
// blockers need an in-UI re-queue that rides the same answer rail as Mark
// Resolved (answer → body stamp → Ready → immediate pickup).
const { retryDelegationIssueAnswer } = await import("../src/features/dashboard/views/zero-human-companies/issue-resume.ts");
const retryAnswer = retryDelegationIssueAnswer({
  title: "Track revenue metrics from outreach efforts",
  work: { taskId: "t_retry_test", result: "Queen Bee autonomous pickup exhausted all eligible delegates and now needs human input.\nFailures:\n- Emerson: The operation was aborted due to timeout" },
});
assert.match(retryAnswer, /re-run/i, "retry answer states the human intent");
assert.match(retryAnswer, /t_retry_test/, "retry answer carries the task id for provenance");
assert.match(retryAnswer, /not on the work itself/i, "retry answer tells the agent the failure was infrastructure");
assert.match(retryAnswer, /escalate again/i, "retry answer forbids blind retry loops on a repeat failure");

const consolidatedSource = readFileSync("src/features/dashboard/views/zero-human-companies/ConsolidatedIssueCard.tsx", "utf8");
assert.match(consolidatedSource, /Re-run all \{issues\.length\}/, "consolidated card exposes a group Re-run action");
assert.match(consolidatedSource, /onRetryAll/, "consolidated card takes the retry handler");
assert.match(consolidatedSource, /busy \? <Spinner/, "the Re-run button shows an animated spinner while busy (no static loading state)");

const viewSource = readFileSync("src/features/dashboard/views/zero-human-companies/ZeroHumanCompaniesView.tsx", "utf8");
assert.match(viewSource, /retryDelegationIssueAnswer\(issue\)/, "live retry handler stamps the retry answer");
assert.match(viewSource, /onRetryIssues=\{\(companyId, issues\) => void handleRetryIssues/, "live view wires the bulk retry handler");
const retryStart = viewSource.indexOf("const handleRetryIssues = React.useCallback(async");
const retryEnd = viewSource.indexOf("const handleDismissIssues = React.useCallback(async");
assert(retryStart >= 0 && retryEnd > retryStart, "live view keeps a bulk retry handler beside the dismiss handler");
assert.doesNotMatch(viewSource.slice(retryStart, retryEnd), /archived/, "re-run must never archive — that is Dismiss's job");

console.log("company-issues: all assertions passed");
