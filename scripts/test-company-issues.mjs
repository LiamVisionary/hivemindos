#!/usr/bin/env node
// Hermetic coverage for the Zero Human Companies issue-unblock flow: blocked
// company tasks need a clear "Mark Resolved" path that feeds the existing
// Work Board human-answer/resume mechanism, not a local-only dismissal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { resolvedIssueAnswer, resolvedIssueEnvAnswer } = await import("../src/features/dashboard/views/zero-human-companies/issue-resume.ts");
const { agentsAtWork } = await import("../src/features/dashboard/views/zero-human-companies/data.ts");
const { buildColony } = await import("../src/features/dashboard/views/zero-human-companies/mappers.ts");
const { emailQaDeliverableRef, emailQaHandledIssueLabels, isEmailQaFindingHandled, isEmailQaIssueHandled } = await import("../src/features/dashboard/views/zero-human-companies/email-qa-directives.ts");
const { issueGroupReasoningTrail, issueReasoningTrail } = await import("../src/features/dashboard/views/zero-human-companies/issue-reason.ts");
const { isGenuineHumanAsk } = await import("../src/features/dashboard/kanban-result-format.ts");
const { isWorkApprovalIssue, workApprovalIssueToView, workApprovalLink } = await import("../src/features/dashboard/views/zero-human-companies/work-approval-issues.ts");

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
const envAnswer = resolvedIssueEnvAnswer(issue, "OUTREACH_PHYSICAL_ADDRESS", "OUTREACH_PHYSICAL_ADDRESS_SARASOTA", "selected");
assert.match(envAnswer, /selected existing shared hive env variable OUTREACH_PHYSICAL_ADDRESS_SARASOTA/, "env answer records the selected shared env name");
assert.match(envAnswer, /requested OUTREACH_PHYSICAL_ADDRESS/, "env answer preserves the agent-requested env name");
assert.doesNotMatch(envAnswer, /123 Main|secret|token/i, "env answer never includes a secret or address value");

const issueTrail = issueReasoningTrail({
  key: "WEBS-001",
  title: issue.title,
  status: "board_review",
  agent: "HermesMain",
  pri: "high",
  pts: 2,
  work: { ...issue.work, deliverables: [], receipts: [] },
});
assert.match(issueTrail.headline, /Domain limit exceeded|Custom SPF\/DKIM/i, "issue reasoning states the concrete blocker");
assert.match(issueTrail.whyNow, /Needs You/i, "issue reasoning explains why it surfaced now");
assert.match(issueTrail.requestedAction ?? "", /Domain limit exceeded|Custom SPF\/DKIM/i, "issue reasoning decision text names the concrete blocker");
assert.doesNotMatch(issueTrail.requestedAction ?? "", /Open the task details/i, "issue reasoning decision text is not a generic board-navigation instruction");
assert.ok(issueTrail.evidence.some((line) => line.includes("Work Board task: t_agentmail_domain_gate")), "issue reasoning includes task provenance evidence");
const channelDecisionTrail = issueReasoningTrail({
  key: "WEBS-237",
  title: "Send approved close replies to warm prospects",
  status: "board_review",
  agent: "Ida B. Wells",
  pri: "high",
  pts: 2,
  work: {
    taskId: "t_mraokjcc_83w7l",
    status: "needs-human",
    result: [
      "Blocked before send and recorded on the Work Board as needs-human.",
      "ACTION NEEDED: Provide a verified direct written channel or approve a human/operator phone call path for Ginza, Abel's Ice Cream, and Aloha Hair and Nail Spa; also set or verify the channel consent before any close reply is sent.",
    ].join("\n"),
    deliverables: [],
    receipts: [],
  },
});
assert.match(channelDecisionTrail.requestedAction ?? "", /verified direct written channel/i, "decision-needed text surfaces the specific channel decision");
assert.match(channelDecisionTrail.requestedAction ?? "", /human\/operator phone call path/i, "decision-needed text keeps the alternate approval path");
assert.doesNotMatch(channelDecisionTrail.requestedAction ?? "", /Open the task details/i, "decision-needed text does not bounce the user to another board");
const groupedTrail = issueGroupReasoningTrail(
  { category: "delegates-offline", label: "Delegates offline", reason: "No agent machine is reachable.", signature: "delegation:offline", consolidatable: true },
  [
    { key: "A", title: "Task A", status: "board_review", agent: "HermesMain", pri: "high", pts: 1, work: { taskId: "t_a", status: "needs-human", deliverables: [], receipts: [] } },
    { key: "B", title: "Task B", status: "board_review", agent: "HermesMain", pri: "high", pts: 1, work: { taskId: "t_b", status: "needs-human", deliverables: [], receipts: [] } },
  ],
);
assert.match(groupedTrail.summary, /2 Work Board tasks/, "consolidated issue reasoning names the group size");
assert.match(groupedTrail.requestedAction ?? "", /re-run all/i, "consolidated issue reasoning names the group action");

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
assert.match(actionsSource, /Handled — retry/, "issue action card exposes the retry/resume action");
assert.match(actionsSource, /SharedHiveEnvKeyRow/, "issue action card reuses the shared hive env picker row");
assert.match(actionsSource, /loadSharedHiveEnvKeys/, "issue action card loads shared hive env names without values");
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
  /disabled=\{\(requiresCrew && crew\.length === 0\) \|\| !canNext \|\| busy\}/,
  "create-company final submit stays disabled without a real apex goal",
);

assert.equal(emailQaDeliverableRef("Dead / broken link"), "Email QA \u2014 Dead / broken link", "Email QA issue teachings use the durable directive ref");
const emailQaDirectiveFixtures = [
  { deliverableRef: "Email QA \u2014 Dead / broken link", createdAt: "2026-07-05T11:09:52.509Z" },
  { deliverableRef: "Preview \u2014 ginza" },
  { deliverableRef: "Email QA - Visible tracking-pixel line", createdAt: "2026-07-06T00:00:00.000Z" },
];
assert.equal(isEmailQaIssueHandled("Dead / broken link", emailQaDirectiveFixtures), true, "approved Email QA teachings suppress that issue on reload");
assert.equal(isEmailQaIssueHandled("dead   /   broken link", emailQaDirectiveFixtures), true, "Email QA handled matching is whitespace/case stable");
assert.equal(isEmailQaIssueHandled("Placeholder / unfinished deliverable", emailQaDirectiveFixtures), false, "unhandled Email QA issue labels still surface");
assert.equal(
  isEmailQaFindingHandled({ categoryLabel: "Dead / broken link", threadUpdatedAt: Date.parse("2026-07-05T11:00:00.000Z") }, emailQaDirectiveFixtures),
  true,
  "Email QA teachings clear findings from already-reviewed sent mail",
);
assert.equal(
  isEmailQaFindingHandled({ categoryLabel: "Dead / broken link", threadUpdatedAt: Date.parse("2026-07-05T12:00:00.000Z") }, emailQaDirectiveFixtures),
  false,
  "newer recurrences after the teaching still surface",
);
assert.deepEqual(
  [...emailQaHandledIssueLabels(emailQaDirectiveFixtures)].sort(),
  ["dead / broken link", "visible tracking-pixel line"],
  "only Email QA directive refs become handled issue labels",
);
const emailQaAliasDirectiveFixtures = [
  {
    deliverableRef: "Email QA \u2014 Visible tracking-pixel line",
    text: "Do not put a visible tracking pixel line or open-pixel URL in the plaintext body.",
    createdAt: "2026-07-07T17:55:44.951Z",
  },
  {
    deliverableRef: "Email QA \u2014 off-strategy content",
    text: "Use a softer CTA that invites the prospect to learn more or express interest before booking a consultation.",
    createdAt: "2026-07-07T17:58:03.385Z",
  },
  {
    deliverableRef: "Email QA \u2014 tone",
    text: "Use a softer call-to-action that aligns with the company's strategy of a gentle approach.",
    createdAt: "2026-07-07T17:58:45.033Z",
  },
];
assert.equal(isEmailQaIssueHandled("off-strategy", emailQaAliasDirectiveFixtures), true, "off-strategy AI wording matches the previously taught off-strategy content family");
assert.equal(isEmailQaIssueHandled("call-to-action", emailQaAliasDirectiveFixtures), true, "call-to-action AI wording matches the previously taught softer-CTA strategy family");
assert.equal(
  isEmailQaFindingHandled({
    categoryLabel: "branding",
    summary: "Ensure tracking pixels are hidden in the email body.",
    suggestion: "Ensure tracking pixels are hidden and not visible in the email body.",
    threadUpdatedAt: Date.parse("2026-07-07T17:00:00.000Z"),
  }, emailQaAliasDirectiveFixtures),
  true,
  "branding AI duplicates about visible tracking pixels stay cleared after reload",
);
assert.equal(
  isEmailQaFindingHandled({
    categoryLabel: "call-to-action",
    summary: "The email pushes a consultation before relationship-building.",
    suggestion: "Use a softer call-to-action that invites the recipient to explore the preview first.",
    threadUpdatedAt: Date.parse("2026-07-07T18:00:00.000Z"),
  }, emailQaAliasDirectiveFixtures),
  false,
  "newer softer-CTA recurrences after the latest teaching still surface",
);

const workApprovalIssue = {
  key: "WEBS-724",
  title: "Find usable contacts for 360 Custom Renovations",
  agent: "HermesMain",
  status: "board_review",
  work: {
    taskId: "t_mraokkiq_9reqn",
    status: "needs-human",
    result: "ACTION NEEDED:\nApprove or reject sending the drafted Facebook DM to 360 Custom Renovations addressed to Cristian Profera.\nLINK: https://www.facebook.com/100088584159731/\nOPTIONS: Approve Facebook DM | Approve LinkedIn DM | Reject / revise copy",
    deliverables: [],
    receipts: [],
    updatedAt: Date.parse("2026-07-08T02:30:00+08:00"),
  },
};
assert.equal(isWorkApprovalIssue(workApprovalIssue), true, "approve/reject Work Board asks are treated as approvals");
const workApprovalView = workApprovalIssueToView(workApprovalIssue);
assert.equal(workApprovalView.id, "t_mraokkiq_9reqn", "Work Board approval card uses the task id as the approval id");
assert.equal(workApprovalView.title, "Find usable contacts for 360 Custom Renovations", "Work Board approval card keeps the task title");
assert.equal(workApprovalView.agent, "HermesMain", "Work Board approval card keeps the assigned agent");
assert.equal(workApprovalView.kind, "approval", "Work Board approval cards are labeled as approvals");
assert.equal(workApprovalView.target, "https://www.facebook.com/100088584159731/", "Work Board approval cards expose the target link");
assert.match(workApprovalView.explanation?.headline ?? "", /needs a human decision/, "Work Board approval cards carry a human-readable reasoning headline");
assert.match(workApprovalView.explanation?.whyNow ?? "", /Needs You/, "Work Board approval reasoning explains why it surfaced now");
assert.ok(workApprovalView.explanation?.evidence.some((line) => line.includes("Request:")), "Work Board approval reasoning preserves the concrete ask as evidence");
assert.equal(workApprovalLink(workApprovalIssue), "https://www.facebook.com/100088584159731/", "Work Board approval link extraction keeps the concrete target");
assert.equal(isWorkApprovalIssue(issue), false, "ordinary needs-human blockers remain issues");

const emailQaServiceSource = readFileSync("src/lib/services/company-email-qa.ts", "utf8");
assert.match(emailQaServiceSource, /threadFindingTimestamp\(thread\)/, "Email QA findings prefer stable sent timestamps for reload suppression");
const agentMailboxesSource = readFileSync("src/lib/services/agent-mailboxes.ts", "utf8");
const outreachOutboxSource = readFileSync("src/lib/services/company-outreach-outbox.ts", "utf8");
assert.match(agentMailboxesSource, /sentAt = parseTimestampMs\(thread\.sent_timestamp\)/, "AgentMail threads expose stable sent timestamps");
assert.match(outreachOutboxSource, /\.\.\.\(sentAt \? \{ sentAt \} : \{\}\)/, "outreach outbox threads expose stable sent timestamps");
const emailQaBandSource = readFileSync("src/features/dashboard/views/zero-human-companies/EmailQaBand.tsx", "utf8");
assert.match(emailQaBandSource, /deliverableRef:\s*emailQaDeliverableRef\(group\.label\)/, "one-click Email QA teaching uses the canonical durable directive ref");

const cockpitSource = readFileSync("src/features/dashboard/views/zero-human-companies/Cockpit.tsx", "utf8");
assert.match(cockpitSource, /key: "issues"/, "cockpit tab row includes Issues");
assert.match(cockpitSource, /IssuesPanel/, "cockpit has a dedicated issues panel");
assert.match(cockpitSource, /onResolveIssue/, "cockpit passes issue resolution handler");
assert.match(cockpitSource, /function IssuesLoadingSkeleton/, "issues panel has a skeleton pending state");
assert.match(cockpitSource, /aria-label="Loading company issues"/, "issues pending state is animated and accessible");
assert.match(cockpitSource, /loading=\{initialTasksLoading\}/, "issues panel receives the initial task-loading state");
assert.match(cockpitSource, /const activeIssueCount = c\.issues\.filter\(\(issue\) => issue\.status !== "done" && !isWorkApprovalIssue\(issue\)\)\.length/, "Issues tab badge counts active non-approval issues");
assert.match(cockpitSource, /badge: activeIssueCount \|\| null/, "Issues tab badge is wired to the active issue count");
assert.match(cockpitSource, /badgeLoading: initialTasksLoading && activeIssueCount === 0/, "Issues tab shows a skeleton badge while issue counts hydrate");
assert.match(cockpitSource, /function PipelineForecastPanel/, "cockpit has a revenue forecast detail panel");
assert.match(cockpitSource, /approval-blocked quoted pipeline/, "cockpit names approval-blocked quoted pipeline where decisions happen");
assert.match(cockpitSource, /potential revenue, not booked cash/, "cockpit distinguishes quoted pipeline from booked revenue");
assert.match(cockpitSource, /directives=\{c\.directives\}/, "Email QA issue band receives durable company directives");
assert.match(cockpitSource, /isWorkApprovalIssue/, "cockpit routes approve/reject Work Board tasks through Approvals");
assert.match(cockpitSource, /workApprovalIssueToView/, "cockpit maps Work Board approval tasks into the shared approval card shape");
assert.match(cockpitSource, /onDecideIssueApproval/, "Work Board approvals answer the underlying task when decided");
assert.match(cockpitSource, /onOpenDetails=\{item\.source === "work" \? \(\) => handlers\.onOpenIssue\(item\.issue\) : undefined\}/, "Work Board approval cards open the underlying task details");
// The strip is a single digest band (count + See all), never a wall of rows.
assert.match(cockpitSource, /things need you/, "needs-you strip is one digest band with a count, not per-item rows");
assert.match(cockpitSource, /the crew handles the rest on its own/, "needs-you strip reassures instead of listing every item");
assert.match(cockpitSource, /if \(needs === 0\) return null/, "needs-you strip disappears entirely when nothing is waiting");
assert.match(cockpitSource, /See all →/, "needs-you strip exposes a See all action routing to the full list");

const approvalCardSource = readFileSync("src/features/approvals/ApprovalCard.tsx", "utf8");
const approvalCssSource = readFileSync("src/features/approvals/approvals.module.css", "utf8");
assert.match(approvalCardSource, /cardReason/, "approval cards show the approval reason on the card, not only inside the modal");
assert.match(approvalCardSource, /ReasoningTrailView/, "approval cards show the shared reasoning trail before action buttons");
assert.match(approvalCardSource, /onOpenDetails/, "approval cards support a details affordance for task-backed approvals");
assert.match(approvalCssSource, /\.cardReason/, "approval reason has dedicated card styling");
assert.match(approvalCssSource, /white-space:\s*pre-wrap/, "approval reason preserves structured ask/options/link lines");
const reasoningViewSource = readFileSync("src/features/reasoning/ReasoningTrailView.tsx", "utf8");
const reasoningTypesSource = readFileSync("src/lib/types/reasoning-trail.ts", "utf8");
assert.match(reasoningViewSource, /tone\?: ReasoningTrailTone/, "approvals and issues share one reasoning trail renderer");
assert.match(reasoningViewSource, /REASONING_TRAIL_FIELD_LABELS/, "shared reasoning trail renderer uses the common field labels");
assert.match(reasoningTypesSource, /What this is/, "reasoning trail labels have one shared source of truth");

const liveSource = readFileSync("src/features/dashboard/views/zero-human-companies/ZeroHumanCompaniesView.tsx", "utf8");
assert.match(liveSource, /action: "answer"/, "live resolver uses the Work Board answer action");
assert.match(liveSource, /resolvedIssueAnswer\(issue\)/, "live resolver uses the audited resume message");
assert.match(liveSource, /pickupScheduled/, "live resolver reports immediate pickup status");

const boardSource = readFileSync("src/features/dashboard/views/zero-human-companies/IssueBoard.tsx", "utf8");
assert.doesNotMatch(boardSource, /WebkitLineClamp|textOverflow:\s*"ellipsis"/, "issue blockers are not silently truncated");
assert.match(boardSource, /ChatInlineMarkdown/, "issue blocker text renders markdown inline instead of raw backticks");
assert.match(boardSource, /<ChatInlineMarkdown text=\{blockReason\} \/>/, "issue blockers pass the extracted ask through markdown formatting");
assert.match(boardSource, /issueReasoningTrail/, "issue board cards build a structured reasoning trail");
assert.match(boardSource, /ReasoningTrailView/, "issue board cards render the shared reasoning trail");
assert.match(boardSource, /formatPipelineUsd\(pipelineImpact\.amountUsd\)/, "issue board cards display per-card quoted pipeline impact");
const issueSummarySource = readFileSync("src/features/dashboard/views/zero-human-companies/CompanyIssueActions.tsx", "utf8");
assert.match(issueSummarySource, /issueReasoningTrail/, "cockpit issue summary cards build a structured reasoning trail");
assert.match(issueSummarySource, /ReasoningTrailView/, "cockpit issue summary cards render the shared reasoning trail");
const consolidatedIssueSource = readFileSync("src/features/dashboard/views/zero-human-companies/ConsolidatedIssueCard.tsx", "utf8");
assert.match(consolidatedIssueSource, /issueGroupReasoningTrail/, "consolidated issue groups build a group reasoning trail");
assert.match(consolidatedIssueSource, /ReasoningTrailView/, "consolidated issue groups render the shared reasoning trail");
const zhcThemeSource = readFileSync("src/features/dashboard/views/zero-human-companies/theme.css", "utf8");
assert.match(zhcThemeSource, /\.zhc-root \.zhc-issue-reason :where\(code\)/, "issue blocker markdown code spans have scoped ZHC styling");
const taskModalSource = readFileSync("src/features/dashboard/views/zero-human-companies/TaskDetailModal.tsx", "utf8");
assert.match(taskModalSource, /issue\.status === "board_review" \|\| work\.status === "needs-human"/, "blocked-task explainer is gated to needs-human cards");
assert.match(taskModalSource, /const canExplain = isBlockedForHuman && Boolean\(companyId\)/, "completed shipped cards do not show the blocked-task explainer");
assert.match(taskModalSource, /deterministicReasoning/, "task detail modal shows a deterministic issue reasoning trail before the on-demand explainer");
assert.match(taskModalSource, /Missing context/, "blocked-task explanations surface missing context when the explainer has it");
const issueExplainerSource = readFileSync("src/lib/services/queen-bee/issue-explainer.ts", "utf8");
assert.match(issueExplainerSource, /reasoningTrailPromptRules/, "issue explainer uses shared direct explanation style rules");
assert.match(issueExplainerSource, /missingContext/, "issue explainer returns missing context as structured data");

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

// The structured env control is shared with the Work Board Needs-You card.
const issueBoardSource = readFileSync("src/features/dashboard/views/zero-human-companies/IssueBoard.tsx", "utf8");
assert.doesNotMatch(issueBoardSource, /HumanAskControls/, "the board no longer keeps a one-off human-ask control");
assert.match(actionsSource, /SharedHiveEnvKeyRow/, "company issue actions render the shared env picker");
assert.match(actionsSource, /resolvedIssueEnvAnswer/, "company issue env selections resume with an env-specific answer");
assert.match(actionsSource, /loadSharedHiveEnvKeys/, "company issue env picker reads key names through the shared helper");

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

// System-generated blocks (a gate or the runtime) must be translated into a plain,
// human-framed ask — never shown to the owner as raw "attach passing eval receipts"
// or "Failure reason: … Attempts: 3/3." text.
{
  const evalIssue = { work: { taskId: "t_eval", status: "needs-human", result: "Prepared the bundle.\nArtifacts: /root/x/REPORT.md\n\n⚠ Loop gate block — missing passing eval receipts: live-url.\nACTION NEEDED: attach passing eval receipts for live-url or move the card forward manually.", deliverables: [], receipts: [] } };
  const evalInfo = classifyIssueReason(evalIssue);
  assert.equal(evalInfo.category, "eval-gate", "loop eval-gate block is classified as eval-gate");
  assert.equal(evalInfo.systemGenerated, true, "eval-gate is a system-generated block");
  const evalAsk = issueReasoningTrail(evalIssue).requestedAction ?? "";
  assert.ok(isGenuineHumanAsk(evalAsk), "eval-gate card ask reads as a genuine human ask");
  assert.doesNotMatch(evalAsk, /attach passing eval receipts/i, "eval-gate ask drops the 'attach passing eval receipts' jargon");
  assert.match(issueBlockReason(evalIssue), /automated (quality )?checks/i, "eval-gate reason is plain language");

  const runtimeIssue = { work: { taskId: "t_rt", status: "needs-human", result: "No final response from the agent. Failure reason: no-final-response. Attempts: 3/3.", deliverables: [], receipts: [] } };
  const runtimeInfo = classifyIssueReason(runtimeIssue);
  assert.equal(runtimeInfo.category, "runtime-blocked", "failTask runtime escalation is classified as runtime-blocked");
  assert.equal(runtimeInfo.systemGenerated, true, "runtime-blocked is a system-generated block");
  const runtimeAsk = issueReasoningTrail(runtimeIssue).requestedAction ?? "";
  assert.ok(isGenuineHumanAsk(runtimeAsk), "runtime-blocked card ask reads as a genuine human ask");
  assert.doesNotMatch(runtimeAsk, /Failure reason:|Attempts: \d/i, "runtime-blocked ask drops the raw failure-reason/attempts text");

  // A genuine agent ACTION NEEDED is untouched — still shown verbatim, not overridden.
  const agentIssue = { work: { taskId: "t_ask", status: "needs-human", result: "Did the research.\nACTION NEEDED: Add PORTFOLIO_OFFER_API_TOKEN to the shared env so the crew can post offers.", deliverables: [], receipts: [] } };
  const agentInfo = classifyIssueReason(agentIssue);
  assert.equal(agentInfo.category, "needs-input", "a genuine agent ask stays needs-input");
  assert.ok(!agentInfo.systemGenerated, "a genuine agent ask is not system-generated");
  assert.match(issueReasoningTrail(agentIssue).requestedAction ?? "", /PORTFOLIO_OFFER_API_TOKEN/, "the agent's real ACTION NEEDED is preserved verbatim");
}

// ── status pill: automation off must read paused, not shipping ──────────────
{
  const statusColony = (companyOver = {}, approvals = []) => buildColony({
    company: {
      id: "co-status",
      name: "Status Co",
      ticker: "STAT",
      sector: "Web",
      agentIds: ["agent-1"],
      frozen: false,
      createdAt: "",
      createdAtMs: Date.now(),
      updatedAt: "",
      apexGoal: { title: "Ship sites", metric: "Weekly Revenue", target: "1000", unit: "currency", current: "0" },
      ...companyOver,
    },
    rollup: {
      companyId: "co-status",
      memberCount: 1,
      dailySpentUsd: 0,
      monthlySpentUsd: 0,
      totalSpentUsd: 0,
      dailyRemainingUsd: null,
      monthlyRemainingUsd: null,
      totalRemainingUsd: null,
    },
    revenueShare: undefined,
    approvals,
    agentsById: new Map([["agent-1", { id: "agent-1", name: "Ada Lovelace", runtime: "hermes" }]]),
    tasks: [
      { id: "t_done", title: "Build preview", status: "done", source: "company:co-status:r1", updatedAt: 10, result: "done" },
      { id: "t_done2", title: "QA preview", status: "done", source: "company:co-status:r1", updatedAt: 11, result: "done" },
    ],
  });

  // The live WEBS bug: staffed, work done, alignment high, automation OFF → the
  // grid card read SHIPPING. A stopped company must read paused.
  assert.equal(statusColony({ autonomy: false }).status, "paused", "automation off derives paused, never shipping");
  assert.equal(statusColony({}).status, "paused", "absent autonomy flag (never launched) also derives paused");
  assert.equal(statusColony({ autonomy: true }).status, "shipping", "automation on with aligned work derives shipping");
  assert.equal(statusColony({ autonomy: false, frozen: true }).status, "paused", "frozen still derives paused");
  assert.equal(statusColony({ autonomy: false, status: "review" }).status, "review", "an explicit status override still wins");
  const pausedWithApprovals = statusColony({ autonomy: false }, [{ id: "ap1", agentId: "agent-1", agentName: "Ada", kind: "spend", amountUsd: 5, reason: "r", expiresAtMs: Date.now() + 60_000 }]);
  assert.equal(pausedWithApprovals.status, "paused", "waiting approvals do not flip a stopped company to review");
}

console.log("company-issues: all assertions passed");
