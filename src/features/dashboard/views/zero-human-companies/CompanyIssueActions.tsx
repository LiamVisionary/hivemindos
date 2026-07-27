"use client";

import React from "react";
import { AlertTriangle, Archive, Check, CheckCircle2, ClipboardList, ExternalLink, MessageSquare, PenLine } from "lucide-react";
import convoStyles from "@/app/kanban-conversation.module.css";
import { dashboardUrlForTarget } from "@/features/dashboard/dashboard-navigation";
import { extractHumanAsk, isGenuineHumanAsk } from "@/features/dashboard/kanban-result-format";
import { loadSharedHiveEnvKeys, saveSharedHiveEnvValue } from "@/features/dashboard/shared-hive-env-client";
import { createStyleClass } from "@/features/dashboard/style-classes";
import { SharedHiveEnvKeyRow, humanAskInputsForKind } from "@/features/dashboard/views/shared/SharedHiveEnvKeyRow";
import { formatPipelineUsd } from "@/features/dashboard/work-board-pipeline";
import { CollapsibleReasoningTrail } from "@/features/reasoning/ReasoningTrailView";
import { useQueenChat } from "@/features/queen-voice/queen-chat-store";
import { isExternalHttpUrl, openExternalUrl } from "@/lib/native/open-external-url";
import type { ClassifiedDeliverable } from "./deliverables-model";
import { FileTypeIcon } from "./DeliverableCard";
import { FileViewerModal } from "./FileViewer";
import { getIssueIdentity } from "./issue-identity";
import { issueReferencedArtifacts } from "./issue-artifacts";
import { companyIssueDiscussPrompt, issueAgeLabel, issueBlockReason, issueReasoningTrail } from "./issue-reason";
import { resolvedIssueEnvAnswer } from "./issue-resume";
import { issueReviewablePreviews, type PreviewDecision } from "./preview-review";
import { Spinner } from "./primitives";
import type { Issue, Theme } from "./types";

const convoClass = createStyleClass(convoStyles);
type ResolveIssueHandler = (issue: Issue, answer?: string) => void;

export function isCompanyReviewIssue(issue: Issue): boolean {
  return issue.work?.status === "needs-human" || issue.status === "board_review";
}

export function openIssueOnWorkBoard(taskId: string) {
  if (typeof window === "undefined") return;
  const url = dashboardUrlForTarget({ view: "kanban", taskId }, window.location.pathname);
  window.history.pushState({ dashboardTarget: { view: "kanban", taskId } }, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const buttonBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
  borderRadius: 8,
  padding: "5px 9px",
  font: "inherit",
  fontFamily: "var(--f-mono)",
  fontSize: 11,
  border: "1px solid color-mix(in srgb, var(--honey) 45%, var(--line))",
  background: "color-mix(in srgb, var(--honey) 12%, var(--bg-2))",
  color: "var(--honey-2)",
};

function stop(event: React.MouseEvent) {
  event.stopPropagation();
}

const chipBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  maxWidth: 280,
  minWidth: 0,
  borderRadius: 8,
  padding: "5px 9px",
  border: "1px solid var(--line-2)",
  background: "var(--bg-2)",
  color: "var(--fg-2)",
  font: "inherit",
  fontFamily: "var(--f-mono)",
  fontSize: 11,
  cursor: "pointer",
  textDecoration: "none",
};

/** One openable artifact the issue references (a draft file, an offer page, a
 *  booking link) as a slim chip: files open the in-app viewer, links open the
 *  site. Mirrors DeliverableCard's open behavior in a card-sized footprint. */
function ArtifactChip({ item, machineName, theme }: { item: ClassifiedDeliverable; machineName?: string; theme: Theme }) {
  const [viewing, setViewing] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const { title, kindLabel, action, url, icon, deliverable } = item;
  const label = (
    <>
      <FileTypeIcon icon={icon} size={16} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{title}</span>
      <span aria-hidden style={{ flexShrink: 0, color: "var(--fg-4)", display: "inline-flex", alignItems: "center" }}>
        {opening ? <Spinner size={11} /> : action === "visit" ? "↗" : null}
      </span>
    </>
  );
  if (action === "visit" && url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="zhc-btn-ghost"
        style={chipBase}
        title={`${kindLabel} — open`}
        onClick={(event) => {
          stop(event);
          if (isExternalHttpUrl(url)) {
            event.preventDefault();
            setOpening(true);
            void openExternalUrl(url).finally(() => setOpening(false));
          }
        }}
      >
        {label}
      </a>
    );
  }
  return (
    <>
      <button type="button" className="zhc-btn-ghost" style={chipBase} title={`${kindLabel} — view`} onClick={(event) => { stop(event); setViewing(true); }}>
        {label}
      </button>
      {viewing ? (
        <FileViewerModal deliverable={deliverable} displayTitle={title} displayKind={kindLabel} machineName={machineName} theme={theme} onClose={() => setViewing(false)} />
      ) : null}
    </>
  );
}

/** The issue's referenced artifacts as a compact chip row — the "view the drafts /
 *  offer pages" affordance. Renders nothing when the issue references no openable
 *  artifact. Caps the row and sends the overflow to the full Issue detail. */
function IssueReferencedArtifacts({ issue, theme, onOpenIssue, max = 6 }: {
  issue: Issue;
  theme: Theme;
  onOpenIssue?: (issue: Issue) => void;
  max?: number;
}) {
  const artifacts = React.useMemo(() => issueReferencedArtifacts(issue), [issue]);
  if (!artifacts.length) return null;
  const shown = artifacts.slice(0, max);
  const extra = artifacts.length - shown.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 26 }}>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-4)" }}>
        Open to review · {artifacts.length}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {shown.map((item, index) => (
          <ArtifactChip key={item.deliverable.id || `${item.title}-${index}`} item={item} machineName={issue.work?.machineName} theme={theme} />
        ))}
        {extra > 0 && onOpenIssue ? (
          <button
            type="button"
            className="zhc-btn-ghost"
            style={{ ...chipBase, background: "transparent", color: "var(--fg-4)" }}
            onClick={(event) => { stop(event); onOpenIssue(issue); }}
          >
            +{extra} more in Issue
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function CompanyIssueActionButtons({
  companyName,
  issue,
  onOpenIssue,
  onResolveIssue,
  onReviewPreview,
  onDismiss,
  busy,
}: {
  companyName: string;
  issue: Issue;
  onOpenIssue?: (issue: Issue) => void;
  onResolveIssue?: ResolveIssueHandler;
  onReviewPreview?: (issue: Issue, decision: PreviewDecision, notes: string) => void;
  /** Set aside this issue: archive its task off the board (persistent, reversible). */
  onDismiss?: (issues: Issue[]) => void;
  busy?: boolean;
}) {
  const queenChat = useQueenChat();
  const [changeMode, setChangeMode] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const [openingPreview, setOpeningPreview] = React.useState(false);
  const taskId = issue.work?.taskId;
  // A reviewable customer-facing preview (e.g. a `/preview/<lead>` mockup) parked
  // for the operator's sign-off gets its own Approve / Request changes pair, which
  // replaces the generic "Mark Resolved" — both resume the same task, but these
  // stamp a preview-specific decision so the crew knows to send vs. revise.
  const reviewablePreviews = Boolean(onReviewPreview) && isCompanyReviewIssue(issue) ? issueReviewablePreviews(issue) : [];
  const canReviewPreview = reviewablePreviews.length > 0;
  const previewUrl = reviewablePreviews.find((preview) => preview.url)?.url;
  const canResolveIssue = isCompanyReviewIssue(issue) && Boolean(onResolveIssue) && !canReviewPreview;
  const humanAsk = React.useMemo(() => extractHumanAsk(issue.work?.result), [issue.work?.result]);
  const envInputs = React.useMemo(() => humanAskInputsForKind(humanAsk, "api-key"), [humanAsk]);
  const askLinks = humanAsk?.links.slice(0, 3) ?? [];
  // Decision options the agent offered (`OPTIONS: send all 4 | send Ginza + Abel only
  // | hold all`). When present they ARE the decision: render one-click buttons that
  // resume the task with the chosen answer, in place of the generic "Handled — retry".
  const decisionOptions = canResolveIssue ? (humanAsk?.options ?? []) : [];
  const showResolve = canResolveIssue && decisionOptions.length === 0;
  const showEnvResolver = canResolveIssue && envInputs.length > 0;
  // Shown for any review issue: a task-backed one archives; a taskless one (no
  // Work Board record to archive) falls back to hiding it from the view.
  const showDismiss = Boolean(onDismiss) && isCompanyReviewIssue(issue);
  const resolveDisabled = busy || !taskId;
  const reviewDisabled = busy || !taskId;
  const discussIssue = (event: React.MouseEvent) => {
    stop(event);
    void queenChat.sendText(companyIssueDiscussPrompt(companyName, issue));
  };
  const resolveIssue = (event: React.MouseEvent) => {
    stop(event);
    if (resolveDisabled) return;
    onResolveIssue?.(issue);
  };
  const chooseOption = (option: string) => (event: React.MouseEvent) => {
    stop(event);
    if (resolveDisabled) return;
    onResolveIssue?.(issue, `Operator chose: ${option}`);
  };
  const saveIssueEnvValue = React.useCallback(async (envKey: string, value: string) => {
    if (resolveDisabled) return "This issue is not linked to a Work Board task yet.";
    const failure = await saveSharedHiveEnvValue(envKey, value);
    if (failure) return failure;
    onResolveIssue?.(issue, resolvedIssueEnvAnswer(issue, envKey, envKey, "saved"));
    return "";
  }, [issue, onResolveIssue, resolveDisabled]);
  const selectIssueEnvKey = React.useCallback(async (requestedEnvKey: string, selectedEnvKey: string) => {
    if (resolveDisabled) return "This issue is not linked to a Work Board task yet.";
    onResolveIssue?.(issue, resolvedIssueEnvAnswer(issue, requestedEnvKey, selectedEnvKey, "selected"));
    return "";
  }, [issue, onResolveIssue, resolveDisabled]);
  const dismissIssue = (event: React.MouseEvent) => {
    stop(event);
    if (busy) return;
    onDismiss?.([issue]);
  };
  const approvePreview = (event: React.MouseEvent) => {
    stop(event);
    if (reviewDisabled) return;
    setChangeMode(false);
    onReviewPreview?.(issue, "approve", "");
  };
  const toggleChanges = (event: React.MouseEvent) => {
    stop(event);
    setChangeMode((open) => !open);
  };
  const sendChanges = (event: React.MouseEvent) => {
    stop(event);
    const text = notes.trim();
    if (!text || reviewDisabled) return;
    onReviewPreview?.(issue, "changes", text);
    setChangeMode(false);
    setNotes("");
  };
  const openDetails = (event: React.MouseEvent) => {
    stop(event);
    onOpenIssue?.(issue);
  };
  const openBoard = (event: React.MouseEvent) => {
    stop(event);
    if (taskId) openIssueOnWorkBoard(taskId);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {decisionOptions.map((option, index) => (
          <button
            key={option}
            type="button"
            onClick={chooseOption(option)}
            disabled={resolveDisabled}
            title={taskId ? "Resume the task with this decision." : "This issue is not linked to a Work Board task yet."}
            style={{
              ...buttonBase,
              ...(index === 0
                ? { border: "1px solid var(--cyan)", background: "var(--cyan)", color: "var(--bg)", fontWeight: 700 }
                : { border: "1px solid color-mix(in srgb, var(--cyan) 45%, var(--line))", background: "color-mix(in srgb, var(--cyan) 13%, var(--bg-2))", color: "var(--cyan-2)" }),
              cursor: resolveDisabled ? "default" : "pointer",
              opacity: resolveDisabled ? 0.6 : 1,
            }}
          >
            {busy && index === 0 ? <Spinner size={14} /> : <Check size={14} aria-hidden />} {option.charAt(0).toUpperCase() + option.slice(1)}
          </button>
        ))}
        {onOpenIssue && issue.work ? (
          <button type="button" className="zhc-btn-ghost" onClick={openDetails} style={buttonBase}>
            <ClipboardList size={14} aria-hidden /> Issue
          </button>
        ) : null}
        {previewUrl ? (
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="zhc-linkchip"
            onClick={(event) => { stop(event); if (previewUrl && isExternalHttpUrl(previewUrl)) { event.preventDefault(); setOpeningPreview(true); void openExternalUrl(previewUrl).finally(() => setOpeningPreview(false)); } }}
            aria-busy={openingPreview}
            style={{ ...buttonBase, textDecoration: "none" }}
          >
            {openingPreview ? <Spinner size={14} /> : <ExternalLink size={14} aria-hidden />} {openingPreview ? "Opening…" : "Open preview"}
          </a>
        ) : null}
        <button type="button" className="zhc-btn-ghost" onClick={discussIssue} style={buttonBase}>
          <MessageSquare size={14} aria-hidden /> Discuss
        </button>
        {taskId ? (
          <button type="button" className="zhc-btn-ghost" onClick={openBoard} style={buttonBase}>
            <ClipboardList size={14} aria-hidden /> Work Board
          </button>
        ) : null}
        {canReviewPreview ? (
          <>
            <button
              type="button"
              className="zhc-btn-ghost"
              onClick={toggleChanges}
              title="Send the crew specific changes and have them regenerate this preview for another review."
              style={{
                ...buttonBase,
                border: changeMode ? "1px solid var(--honey-2)" : buttonBase.border,
                background: changeMode ? "color-mix(in srgb, var(--honey) 22%, var(--bg-2))" : buttonBase.background,
              }}
            >
              <PenLine size={14} aria-hidden /> Request changes
            </button>
            <button
              type="button"
              onClick={approvePreview}
              disabled={reviewDisabled}
              title={taskId ? "Approve this preview and let the crew take the next step (send it to the lead)." : "This preview is not linked to a Work Board task yet."}
              style={{
                ...buttonBase,
                border: "1px solid var(--cyan)",
                background: "var(--cyan)",
                color: "var(--bg)",
                fontWeight: 700,
                cursor: reviewDisabled ? "default" : "pointer",
                opacity: reviewDisabled ? 0.6 : 1,
              }}
            >
              {busy ? <Spinner size={14} /> : <Check size={14} aria-hidden />} {busy ? "Sending" : "Approve"}
            </button>
          </>
        ) : null}
        {showResolve ? (
          <button
            type="button"
            className="zhc-btn-ghost"
            onClick={resolveIssue}
            disabled={resolveDisabled}
            title={taskId ? "Tell the Work Board this blocker is fixed and resume the same task." : "This issue is not linked to a Work Board task yet."}
            style={{
              ...buttonBase,
              border: "1px solid color-mix(in srgb, var(--cyan) 45%, var(--line))",
              background: "color-mix(in srgb, var(--cyan) 13%, var(--bg-2))",
              color: "var(--cyan-2)",
              cursor: resolveDisabled ? "default" : "pointer",
              opacity: resolveDisabled ? 0.6 : 1,
            }}
          >
            {busy ? <Spinner size={14} /> : <CheckCircle2 size={14} aria-hidden />} {busy ? "Retrying" : "Handled — retry"}
          </button>
        ) : null}
        {showDismiss ? (
          <button
            type="button"
            className="zhc-btn-ghost"
            onClick={dismissIssue}
            disabled={busy}
            title={taskId ? "Set this aside: archive its task off the board. It stops showing as an issue and stops re-escalating. Reversible from the Work Board." : "Hide this from the review list (there's no Work Board task to archive)."}
            style={{ ...buttonBase, color: "var(--fg-3)", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            <Archive size={14} aria-hidden /> Dismiss
          </button>
        ) : null}
      </div>
      {(askLinks.length || showEnvResolver) ? (
        <div className={convoClass("needsYouActions")} onClick={stop} role="presentation">
          {askLinks.length ? (
            <div className={convoClass("needsYouLinks")}>
              {askLinks.map((link) => (
                <a
                  key={link.url}
                  className={convoClass("needsYouLink")}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  title={link.url}
                  onClick={stop}
                >
                  {link.label}
                  <span aria-hidden="true">↗</span>
                </a>
              ))}
            </div>
          ) : null}
          {showEnvResolver ? (
            <div className={convoClass("needsYouKeyForm")}>
              {envInputs.map((input, index) => (
                <SharedHiveEnvKeyRow
                  key={`${input.envKey ?? "env"}:${index}`}
                  compact
                  disabled={resolveDisabled}
                  requestedEnvKey={input.envKey}
                  loadHiveEnvKeys={loadSharedHiveEnvKeys}
                  onSaveValue={saveIssueEnvValue}
                  onUseExistingKey={selectIssueEnvKey}
                />
              ))}
              <p className={convoClass("needsYouHint")}>
                Shared hive env values stay out of issue text; only the selected variable name is sent back to the Work Board.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
      {canReviewPreview && changeMode ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }} onClick={stop}>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What should change? e.g. warmer tone, feature their lunch specials, drop the price to $1,200, use their real photos…"
            rows={3}
            autoFocus
            style={{
              width: "100%", boxSizing: "border-box", resize: "vertical",
              borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--bg-2)",
              color: "var(--fg)", font: "inherit", fontFamily: "var(--f-mono)", fontSize: 11.5,
              lineHeight: 1.5, padding: "8px 10px",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={sendChanges}
              disabled={reviewDisabled || !notes.trim()}
              style={{
                ...buttonBase,
                border: "1px solid var(--honey-2)",
                background: "var(--honey-2)",
                color: "var(--bg)",
                fontWeight: 700,
                cursor: reviewDisabled || !notes.trim() ? "default" : "pointer",
                opacity: reviewDisabled || !notes.trim() ? 0.6 : 1,
              }}
            >
              {busy ? <Spinner size={14} /> : <PenLine size={14} aria-hidden />} {busy ? "Sending" : "Send change request"}
            </button>
            <button type="button" className="zhc-btn-ghost" onClick={(event) => { stop(event); setChangeMode(false); }} style={buttonBase}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CompanyIssueSummaryCard({
  companyName,
  issue,
  onOpenIssue,
  onResolveIssue,
  onReviewPreview,
  onDismiss,
  busy,
  theme = "dark",
}: {
  companyName: string;
  issue: Issue;
  onOpenIssue: (issue: Issue) => void;
  onResolveIssue?: ResolveIssueHandler;
  onReviewPreview?: (issue: Issue, decision: PreviewDecision, notes: string) => void;
  onDismiss?: (issues: Issue[]) => void;
  busy?: boolean;
  theme?: Theme;
}) {
  const reason = issueBlockReason(issue);
  const reasoning = issueReasoningTrail(issue);
  // THE essential line: what the human is actually being asked to decide or
  // provide. Prefer the fuller `Decision needed` (the explicit ACTION NEEDED ask)
  // over the 160-char reason summary. But only if it reads as a real decision —
  // worker/control-plane boilerplate or a bare completion report is not something
  // the owner can act on, so it falls back to an honest "review this" prompt.
  const rawAsk = reasoning.requestedAction?.trim() || reason;
  const ask = isGenuineHumanAsk(rawAsk) ? rawAsk : "";
  const age = issueAgeLabel(issue);
  const pipelineImpact = issue.pipelineImpact ?? issue.work?.pipelineImpact;
  return (
    <div
      key={getIssueIdentity(issue)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: "100%",
        borderRadius: 11,
        padding: "11px 12px",
        border: "1px solid color-mix(in srgb, var(--honey) 30%, var(--line))",
        background: "color-mix(in srgb, var(--honey) 7%, var(--bg-2))",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, width: "100%" }}>
        <span aria-hidden style={{ display: "inline-grid", placeItems: "center", marginTop: 2, color: "var(--danger-2)" }}>
          <AlertTriangle size={16} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => onOpenIssue(issue)}
            title="Open the task result and deliverables"
            style={{ display: "block", textAlign: "left", width: "100%", cursor: "pointer", background: "none", border: "none", padding: 0, fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)", overflowWrap: "anywhere" }}
          >
            {issue.title}
          </button>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4, fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>
            <span>{issue.key}</span>
            {issue.agent ? <span>{issue.agent}</span> : null}
            {age ? <span>{age}</span> : null}
            {pipelineImpact ? <span title={pipelineImpact.label} style={{ color: "var(--danger-2)", fontVariantNumeric: "tabular-nums" }}>{formatPipelineUsd(pipelineImpact.amountUsd)} quoted pipeline</span> : null}
          </span>
        </span>
      </div>
      <div style={{ paddingLeft: 26, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: ask ? "var(--honey-2)" : "var(--fg-4)" }}>
          {ask ? "Needs your decision" : "Needs your review"}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--fg-2)", overflowWrap: "anywhere" }}>
          {ask || "The crew paused this and is holding what it produced for you. Open it below to see the work, or use Discuss to tell the crew what to do next."}
        </div>
      </div>
      <IssueReferencedArtifacts issue={issue} theme={theme} onOpenIssue={onOpenIssue} />
      <div style={{ paddingLeft: 26 }}>
        <CompanyIssueActionButtons companyName={companyName} issue={issue} onOpenIssue={onOpenIssue} onResolveIssue={onResolveIssue} onReviewPreview={onReviewPreview} onDismiss={onDismiss} busy={busy} />
      </div>
      <div style={{ paddingLeft: 26 }}>
        <CollapsibleReasoningTrail trail={reasoning} tone="issue" />
      </div>
    </div>
  );
}
