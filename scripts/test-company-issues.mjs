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
const { buildColony } = await import("../src/features/dashboard/views/zero-human-companies/mappers.ts");

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

const modalsSource = readFileSync("src/features/dashboard/views/zero-human-companies/Modals.tsx", "utf8");
assert.match(
  modalsSource,
  /const canNext = form\.name\.trim\(\)\.length > 0 && form\.apexTitle\.trim\(\)\.length > 0/,
  "create-company identity step requires a real apex goal title before staffing",
);
assert.match(
  modalsSource,
  /if \(!snapshot\.name \|\| !snapshot\.apexTitle\) return/,
  "create-company submit path preserves the apex-goal guard if navigation is bypassed",
);
assert.match(
  modalsSource,
  /disabled=\{crew\.length === 0 \|\| !canNext \|\| busy\}/,
  "create-company final submit stays disabled without a real apex goal",
);

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
assert.match(cockpitSource, /function PipelineForecastPanel/, "cockpit has a revenue forecast detail panel");
assert.match(cockpitSource, /approval-blocked quoted pipeline/, "cockpit names approval-blocked quoted pipeline where decisions happen");
assert.match(cockpitSource, /potential revenue, not booked cash/, "cockpit distinguishes quoted pipeline from booked revenue");
assert.match(cockpitSource, /const MAX_NEEDS_STRIP_ROWS = 3/, "needs-you strip caps visible rows at three");
assert.match(cockpitSource, /const visibleApprovals = approvals\.slice\(0, MAX_NEEDS_STRIP_ROWS\)/, "needs-you strip counts visible approvals against the row cap");
assert.match(cockpitSource, /const visibleBlocked = blocked\.slice\(0, Math\.max\(0, MAX_NEEDS_STRIP_ROWS - visibleApprovals\.length\)\)/, "needs-you strip fills remaining slots with blocked issues");
assert.match(cockpitSource, /\+ \{hiddenCount\} more/, "needs-you strip shows the overflow count");
assert.match(cockpitSource, /See all →/, "needs-you strip exposes a See all action for hidden rows");

const liveSource = readFileSync("src/features/dashboard/views/zero-human-companies/ZeroHumanCompaniesView.tsx", "utf8");
assert.match(liveSource, /action: "answer"/, "live resolver uses the Work Board answer action");
assert.match(liveSource, /resolvedIssueAnswer\(issue\)/, "live resolver uses the audited resume message");
assert.match(liveSource, /pickupScheduled/, "live resolver reports immediate pickup status");

const boardSource = readFileSync("src/features/dashboard/views/zero-human-companies/IssueBoard.tsx", "utf8");
assert.doesNotMatch(boardSource, /WebkitLineClamp|textOverflow:\s*"ellipsis"/, "issue blockers are not silently truncated");
assert.match(boardSource, /ChatInlineMarkdown/, "issue blocker text renders markdown inline instead of raw backticks");
assert.match(boardSource, /<ChatInlineMarkdown text=\{blockReason\} \/>/, "issue blockers pass the extracted ask through markdown formatting");
assert.match(boardSource, /formatPipelineUsd\(pipelineImpact\.amountUsd\)/, "issue board cards display per-card quoted pipeline impact");
const zhcThemeSource = readFileSync("src/features/dashboard/views/zero-human-companies/theme.css", "utf8");
assert.match(zhcThemeSource, /\.zhc-root \.zhc-issue-reason :where\(code\)/, "issue blocker markdown code spans have scoped ZHC styling");
const taskModalSource = readFileSync("src/features/dashboard/views/zero-human-companies/TaskDetailModal.tsx", "utf8");
assert.match(taskModalSource, /issue\.status === "board_review" \|\| work\.status === "needs-human"/, "blocked-task explainer is gated to needs-human cards");
assert.match(taskModalSource, /const canExplain = isBlockedForHuman && Boolean\(companyId\)/, "completed shipped cards do not show the blocked-task explainer");

// ── quoted/open pipeline: company-level forecast and issue-level impact ─────
const pipelineColony = buildColony({
  company: {
    id: "co-pipeline",
    name: "Pipeline Co",
    ticker: "PIPE",
    sector: "Revenue",
    agentIds: ["agent-1"],
    frozen: false,
    createdAt: "",
    createdAtMs: Date.now(),
    updatedAt: "",
    apexGoal: { title: "Hit weekly revenue", metric: "Weekly Revenue", target: "2885", unit: "currency", current: "0" },
  },
  rollup: {
    companyId: "co-pipeline",
    memberCount: 1,
    dailySpentUsd: 0,
    monthlySpentUsd: 0,
    totalSpentUsd: 0,
    dailyRemainingUsd: null,
    monthlyRemainingUsd: null,
    totalRemainingUsd: null,
  },
  revenueShare: undefined,
  approvals: [],
  agentsById: new Map([["agent-1", { id: "agent-1", name: "Ada Lovelace", runtime: "hermes" }]]),
  tasks: [
    {
      id: "t_total",
      title: "Audit active pipeline close probability",
      status: "done",
      source: "company:co-pipeline:r1",
      updatedAt: 20,
      result: "36 rows, $73,500 quoted/open pipeline, $0 recognized Weekly Revenue.",
    },
    {
      id: "t_blocked",
      title: "Audit approval bottleneck impact on revenue",
      status: "done",
      source: "company:co-pipeline:r1",
      updatedAt: 30,
      result: "$61,500 / $73,500 = 83.7% is blocked by human approval. $0 / $73,500 = 0.0% is currently blocked by technical readiness. $12,000 / $73,500 = 16.3% is already in-market and waiting on prospect response. Weekly Revenue remains $0 / $2,885.",
    },
    {
      id: "t_needs",
      title: "Unblock queued outreach send",
      status: "needs-human",
      source: "company:co-pipeline:r1",
      assignee: "agent-1",
      result: "Revenue evidence: recognized Weekly Revenue remains $0/$2,885; queued pipeline is $12,000, and one $3,000 Premium close would cover 104.0% of the weekly target.",
    },
  ],
});
assert.equal(pipelineColony.pipeline?.quotedOpenUsd, 73500, "company forecast carries the quoted/open pipeline");
assert.equal(pipelineColony.pipeline?.approvalBlockedUsd, 61500, "company forecast carries approval-blocked pipeline");
assert.equal(pipelineColony.pipeline?.inMarketUsd, 12000, "company forecast carries in-market pipeline");
assert.equal(pipelineColony.pipeline?.recognizedWeeklyRevenueUsd, 0, "company forecast keeps recognized revenue separate");
assert.equal(pipelineColony.pipeline?.weeklyRevenueTargetUsd, 2885, "company forecast parses the weekly target");
const pipelineIssue = pipelineColony.issues.find((candidate) => candidate.work?.taskId === "t_needs");
assert.equal(pipelineIssue?.pipelineImpact?.amountUsd, 12000, "needs-human issue carries its approval-unlocked quoted pipeline");
assert.equal(pipelineIssue?.work?.pipelineImpact?.amountUsd, 12000, "task detail receives the same pipeline impact");

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

// ── issueBlockReason: a real ACTION NEEDED ask must surface on the card, never
// be masked by a generic first line (live 2026-07-06: "Blocked before send…"
// hid a PORTFOLIO_OFFER_API_TOKEN credential blocker; the human couldn't tell).
const { issueBlockReason } = await import("../src/features/dashboard/views/zero-human-companies/issue-reason.ts");
const credBlocked = issueBlockReason({
  work: {
    taskId: "t_cred",
    result: [
      "Blocked before send and recorded on the Work Board as needs-human.",
      "Evidence: PORTFOLIO_OFFER_API_TOKEN present: False",
      "ACTION NEEDED: Add PORTFOLIO_OFFER_API_TOKEN to the shared hive env, then rerun this card.",
      "NEEDS: api-key PORTFOLIO_OFFER_API_TOKEN",
    ].join("\n"),
    body: "",
  },
});
assert.match(credBlocked, /PORTFOLIO_OFFER_API_TOKEN/, "the card names the actual credential blocker, not the generic first line");
assert.doesNotMatch(credBlocked, /^Blocked before send/, "the generic 'Blocked before send' line must not be the shown reason");

// The structured one-click control (Repair fleet sync + credential name) is wired.
const issueBoardSource = readFileSync("src/features/dashboard/views/zero-human-companies/IssueBoard.tsx", "utf8");
assert.match(issueBoardSource, /HumanAskControls/, "the card renders the structured human-ask control");
assert.match(issueBoardSource, /action: "syncMachines"/, "the credential control repairs fleet sync via the tested rail");
assert.match(issueBoardSource, /needs credential:/, "the control names the required credential");
assert.match(issueBoardSource, /state === "busy" \? <Spinner/, "the repair-sync button shows an animated spinner (no static loading state)");

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
