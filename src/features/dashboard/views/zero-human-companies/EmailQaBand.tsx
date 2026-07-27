"use client";

// Zero Human Companies — "email quality" band. Continuously catches problems in
// the emails a company's crew ALREADY SENT and turns them into handleable issues,
// so the human doesn't have to open every message by hand.
//
// It fetches the fast deterministic scan first (dead/broken CTA links, unfilled
// placeholders, a visible tracking-pixel line, missing attachments), renders
// immediately, then layers in the AI content review (off-strategy copy,
// personalization mismatch, tone). Findings are grouped by defect class; each
// class shows the affected emails and a split "Teach the crew" action. The main
// action keeps the original one-click directive save, while the caret options use
// the same correction/directive modal the Emails tab's "Correct agent" uses.
// Additive: renders nothing when the sent corpus is clean.
import React from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, GraduationCap, Loader2, MailWarning, MessageSquare, PencilLine, Sparkles, X } from "lucide-react";
import { useQueenChat } from "@/features/queen-voice/queen-chat-store";
import { CompanyCorrectionModal } from "./CompanyCorrectionModal";
import { emailQaDeliverableRef, isEmailQaFindingHandled, type EmailQaDirectiveLike } from "./email-qa-directives";
import { Skeleton, Spinner } from "./primitives";
import type { Theme } from "./types";

type Severity = "high" | "medium" | "low";

type Finding = {
  id: string;
  threadId: string;
  business: string;
  subject: string;
  severity: Severity;
  category: string;
  categoryLabel: string;
  source: "deterministic" | "ai";
  summary: string;
  suggestion?: string;
  badUrl?: string;
  threadUpdatedAt?: number;
};

type Report = {
  scannedAt: number;
  emailCount: number;
  aiReviewed: boolean;
  aiError?: string;
  truncated?: boolean;
  findings: Finding[];
};

type Group = { category: string; label: string; source: "deterministic" | "ai"; severity: Severity; findings: Finding[]; suggestion: string };
type TeachingAction = "teach-note" | "teach-different";

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const SEVERITY_COLOR: Record<Severity, string> = { high: "var(--danger)", medium: "var(--honey)", low: "var(--fg-3)" };

function groupFindings(findings: Finding[]): Group[] {
  const byCategory = new Map<string, Group>();
  for (const finding of findings) {
    const existing = byCategory.get(finding.category);
    if (existing) {
      existing.findings.push(finding);
      if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[existing.severity]) existing.severity = finding.severity;
      if (!existing.suggestion && finding.suggestion) existing.suggestion = finding.suggestion;
    } else {
      byCategory.set(finding.category, {
        category: finding.category,
        label: finding.categoryLabel,
        source: finding.source,
        severity: finding.severity,
        findings: [finding],
        suggestion: finding.suggestion || "",
      });
    }
  }
  return [...byCategory.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

function emailQaDiscussPrompt(companyLabel: string, group: Group, suggestedDirective: string): string {
  const sampled = group.findings.slice(0, 6);
  const examples = sampled
    .map((finding, index) =>
      [
        `${index + 1}. ${finding.business} — ${finding.subject}`,
        `   Severity: ${finding.severity}; source: ${finding.source}`,
        `   Summary: ${finding.summary}`,
        finding.badUrl ? `   Bad URL: ${finding.badUrl}` : null,
      ].filter((line): line is string => line !== null).join("\n"),
    )
    .join("\n");
  const remaining = group.findings.length - sampled.length;
  return [
    `Email QA found a ${group.label} problem in sent mail for the ${companyLabel} company.`,
    ``,
    `Affected emails: ${group.findings.length}`,
    `Suggested teaching rule: ${suggestedDirective}`,
    ``,
    examples ? `Examples:\n${examples}` : null,
    remaining > 0 ? `${remaining} more affected email${remaining === 1 ? "" : "s"} omitted from this prompt.` : null,
    ``,
    `Tell me whether the suggested teaching rule is enough, what nuance to add if any, and the single next concrete action I should take. If this needs a standing directive, draft the exact wording.`,
  ].filter((line): line is string => line !== null).join("\n");
}

function focusQueenChatInput() {
  window.setTimeout(() => {
    const input = document.querySelector<HTMLInputElement>("body > .fr-root .fr-chat-input")
      ?? document.querySelector<HTMLInputElement>(".fr-chat-input");
    input?.focus();
  }, 250);
}

function GroupCard({ companyId, companyName, group, theme, onHandled }: { companyId: string; companyName?: string; group: Group; theme?: Theme; onHandled: (category: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [teachingAction, setTeachingAction] = React.useState<TeachingAction | null>(null);
  const [error, setError] = React.useState("");
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const queenChat = useQueenChat();

  const count = group.findings.length;
  const rule = group.suggestion || `Fix the "${group.label}" problem in future emails.`;

  React.useEffect(() => {
    if (!menuOpen) return undefined;
    const closeIfOutside = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  function startTeaching(action: TeachingAction) {
    setMenuOpen(false);
    setTeachingAction(action);
  }

  async function teach() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-directive",
          id: companyId,
          directive: {
            text: `${rule} (Flagged by email QA across ${count} sent email${count === 1 ? "" : "s"}: ${group.label}.)`,
            source: "reject",
            deliverableRef: emailQaDeliverableRef(group.label),
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || "Could not save the directive.");
      finishTeaching();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the company service.");
      setBusy(false);
    }
  }

  function discuss() {
    setMenuOpen(false);
    queenChat.setHistoryMinimized(false);
    void queenChat.sendText(emailQaDiscussPrompt(companyName || companyId, group, rule));
    focusQueenChatInput();
  }

  function finishTeaching() {
    setDone(true);
    setTeachingAction(null);
    window.setTimeout(() => setLeaving(true), 650);
    window.setTimeout(() => onHandled(group.category), 1050);
  }

  function dismiss() {
    setLeaving(true);
    window.setTimeout(() => onHandled(group.category), 350);
  }

  const accent = done ? "var(--cyan)" : SEVERITY_COLOR[group.severity];
  return (
    <div
      style={{
        position: "relative",
        overflow: leaving ? "hidden" : "visible",
        maxHeight: leaving ? 0 : 800,
        opacity: leaving ? 0 : 1,
        marginBottom: leaving ? 0 : 10,
        transition: "max-height 400ms ease, opacity 300ms ease, margin 400ms ease",
      }}
    >
      <div
        style={{
          display: "flex", flexDirection: "column", gap: 9, borderRadius: 11, padding: "11px 12px",
          border: `1px solid color-mix(in srgb, ${accent} 38%, var(--line))`,
          background: `color-mix(in srgb, ${accent} 7%, var(--bg-2))`,
          transition: "border 300ms ease, background 300ms ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span aria-hidden style={{ marginTop: 1, color: done ? "var(--cyan-2)" : `color-mix(in srgb, ${accent} 75%, var(--fg))` }}>
            {done ? <Check size={16} /> : <AlertTriangle size={16} />}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{group.label}</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: `color-mix(in srgb, ${accent} 80%, var(--fg))`, border: `1px solid color-mix(in srgb, ${accent} 40%, var(--line))`, borderRadius: 999, padding: "1px 7px" }}>
                {count} email{count === 1 ? "" : "s"}
              </span>
              {group.source === "ai" ? (
                <span title="Found by the AI content review" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--fg-4)" }}>
                  <Sparkles size={10} aria-hidden /> AI
                </span>
              ) : null}
            </span>
            <span style={{ display: "block", marginTop: 4, fontFamily: "var(--f-mono)", fontSize: 10.8, lineHeight: 1.45, color: "var(--fg-3)", overflowWrap: "anywhere" }}>
              {done ? "Saved — the crew reads this on every task now." : rule}
            </span>
          </span>
        </div>

        {!done ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingLeft: 26 }}>
            <div ref={menuRef} style={{ position: "relative", display: "inline-flex", zIndex: menuOpen ? 5 : 1 }}>
              <div role="group" aria-label={`Teach the crew about ${group.label}`} style={{ display: "inline-flex", alignItems: "stretch" }}>
                <button
                  type="button"
                  onClick={teach}
                  disabled={busy}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: busy ? "default" : "pointer", borderRadius: "8px 0 0 8px", padding: "6px 11px", font: "inherit", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, border: "1px solid var(--honey)", borderRight: "none", background: "var(--honey)", color: "var(--bg)", opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? <Spinner size={13} /> : <GraduationCap size={13} aria-hidden />} {busy ? "Teaching" : "Teach the crew"}
                </button>
                <button
                  type="button"
                  onClick={() => setMenuOpen((value) => !value)}
                  disabled={busy}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="More teaching options"
                  title="More teaching options"
                  style={{ display: "inline-grid", placeItems: "center", width: 32, cursor: busy ? "default" : "pointer", borderRadius: "0 8px 8px 0", padding: 0, font: "inherit", border: "1px solid var(--honey)", background: "color-mix(in srgb, var(--honey) 88%, var(--bg))", color: "var(--bg)", opacity: busy ? 0.6 : 1 }}
                >
                  <ChevronDown size={14} aria-hidden />
                </button>
              </div>
              {menuOpen ? (
                <div
                  role="menu"
                  style={{ position: "absolute", left: 0, top: "calc(100% + 6px)", width: 210, display: "flex", flexDirection: "column", gap: 3, padding: 5, borderRadius: 10, border: "1px solid var(--line-2)", background: "var(--bg-soft)", boxShadow: "0 18px 40px rgba(0,0,0,0.38)" }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => startTeaching("teach-note")}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", cursor: "pointer", borderRadius: 7, border: "1px solid transparent", background: "transparent", color: "var(--fg-2)", padding: "7px 8px", fontFamily: "var(--f-mono)", fontSize: 10.5 }}
                  >
                    <MessageSquare size={13} aria-hidden /> Teach with note
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => startTeaching("teach-different")}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", cursor: "pointer", borderRadius: 7, border: "1px solid transparent", background: "transparent", color: "var(--fg-2)", padding: "7px 8px", fontFamily: "var(--f-mono)", fontSize: 10.5 }}
                  >
                    <PencilLine size={13} aria-hidden /> Teach differently
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="zhc-btn-ghost"
              onClick={discuss}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", borderRadius: 8, padding: "6px 10px", font: "inherit", fontFamily: "var(--f-mono)", fontSize: 11, border: "1px solid color-mix(in srgb, var(--honey) 45%, var(--line))", background: "color-mix(in srgb, var(--honey) 12%, var(--bg-2))", color: "var(--honey-2)" }}
            >
              <MessageSquare size={13} aria-hidden /> Discuss
            </button>
            <button
              type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", borderRadius: 8, padding: "6px 10px", font: "inherit", fontFamily: "var(--f-mono)", fontSize: 11, border: "1px solid var(--line)", background: "transparent", color: "var(--fg-3)" }}
            >
              {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />} {open ? "Hide emails" : `Show ${count} email${count === 1 ? "" : "s"}`}
            </button>
            <button
              type="button" onClick={dismiss}
              title="Set this aside without teaching the crew. It returns on the next scan if it recurs."
              style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", borderRadius: 8, padding: "6px 10px", font: "inherit", fontFamily: "var(--f-mono)", fontSize: 11, border: "1px solid var(--line)", background: "transparent", color: "var(--fg-4)" }}
            >
              <X size={13} aria-hidden /> Dismiss
            </button>
          </div>
        ) : null}

        {open && !done ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, paddingLeft: 26 }}>
            {group.findings.map((finding) => (
              <div key={finding.id} style={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg-2)", padding: "7px 9px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: SEVERITY_COLOR[finding.severity], flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 11.8, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{finding.business}</span>
                  <span style={{ flexShrink: 0, fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{finding.subject}</span>
                </div>
                <div style={{ marginTop: 3, fontFamily: "var(--f-mono)", fontSize: 10.3, lineHeight: 1.4, color: "var(--fg-3)", overflowWrap: "anywhere" }}>{finding.summary}</div>
              </div>
            ))}
          </div>
        ) : null}

        {error ? <div style={{ paddingLeft: 26, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--danger-2)" }}>{error}</div> : null}

        {teachingAction ? (
          <CompanyCorrectionModal
            kind={teachingAction}
            companyId={companyId}
            deliverableRef={emailQaDeliverableRef(group.label)}
            issueLabel={group.label}
            affectedCount={count}
            suggestedDirective={rule}
            theme={theme}
            onClose={() => setTeachingAction(null)}
            onDone={finishTeaching}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Shape-matched shimmer for an incoming email-QA finding card. The scan lands in
 *  two waves — a fast deterministic pass, then a slow (5-10s) AI content review —
 *  and this holds the space for that second wave so its findings don't silently
 *  pop in after the first. Presentational; the surrounding band carries the
 *  role="status"/live-region so screen readers aren't double-announced. */
function EmailQaLoadingCard() {
  return (
    <div aria-hidden style={{ borderRadius: 11, padding: "11px 12px", border: "1px solid var(--line)", background: "var(--bg-2)", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Skeleton width={16} height={16} radius={5} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton width="44%" height={12} />
          <Skeleton width="82%" height={10} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, paddingLeft: 26 }}>
        <Skeleton width={104} height={26} radius={8} />
        <Skeleton width={88} height={26} radius={8} />
      </div>
    </div>
  );
}

function EmailQaLoadingBand({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} style={{ display: "flex", flexDirection: "column", marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
        <MailWarning size={13} aria-hidden style={{ color: "var(--fg-4)" }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: 0.05, textTransform: "uppercase", color: "var(--fg-4)" }}>
          {label}
        </span>
        <Loader2 size={11} aria-hidden className="animate-spin" style={{ color: "var(--fg-4)" }} />
      </div>
      <EmailQaLoadingCard />
    </div>
  );
}

export function EmailQaBand({ companyId, companyName, theme = "dark", directives = [] }: { companyId: string; companyName?: string; theme?: Theme; directives?: readonly EmailQaDirectiveLike[] }) {
  const [report, setReport] = React.useState<Report | null>(null);
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [deepLoading, setDeepLoading] = React.useState(true);
  const [handled, setHandled] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    // The parent remounts this band per company (key={companyId}), so state
    // starts fresh — no synchronous reset needed here.
    let alive = true;
    void (async () => {
      // Fast deterministic pass first, for an immediate render.
      try {
        const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/email-qa`, { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; report?: Report } | null;
        if (alive && res.ok && data?.ok && data.report) {
          setReport(data.report);
          setInitialLoading(false);
        }
      } catch {
        // Additive band — a failed lookup just renders nothing.
      }
      // Then the deep AI review, merged in when it lands.
      try {
        const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/email-qa`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deep: true }),
        });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; report?: Report } | null;
        if (alive && res.ok && data?.ok && data.report) setReport(data.report);
      } catch {
        // Keep the deterministic findings if the AI layer fails.
      } finally {
        if (alive) {
          setInitialLoading(false);
          setDeepLoading(false);
        }
      }
    })();
    return () => { alive = false; };
  }, [companyId]);

  const directiveVisibleFindings = React.useMemo(
    () => (report ? report.findings.filter((finding) => !isEmailQaFindingHandled(finding, directives)) : []),
    [directives, report],
  );
  const groups = React.useMemo(() => groupFindings(directiveVisibleFindings), [directiveVisibleFindings]);
  const visible = groups.filter((group) => !handled.has(group.category));
  // The scan lands in two waves: a fast deterministic pass, then a slow (5-10s) AI
  // content review. Only signpost the second wave once we KNOW this company has
  // sent mail to review (report back with emailCount > 0) and the AI pass is still
  // running — so companies with no email crew never flash an email-QA skeleton,
  // and the AI findings never silently pop in after the deterministic ones.
  const mayYieldMore = deepLoading && report !== null && report.emailCount > 0;

  if (initialLoading) return <EmailQaLoadingBand label="Checking sent emails for quality" />;

  if (visible.length === 0) {
    // Nothing to show yet. If the AI review is still landing on a company with
    // sent mail, hold a shape-matched skeleton so its findings don't appear out of
    // nowhere; otherwise (clean + done, or no mail at all) render nothing.
    if (mayYieldMore) {
      return <EmailQaLoadingBand label="Reviewing sent emails for quality" />;
    }
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
        <MailWarning size={13} aria-hidden style={{ color: "var(--danger-2)" }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: 0.05, textTransform: "uppercase", color: "var(--fg-4)" }}>
          Email quality · {visible.reduce((sum, group) => sum + group.findings.length, 0)} issue{visible.reduce((sum, group) => sum + group.findings.length, 0) === 1 ? "" : "s"} across sent mail
        </span>
        {deepLoading ? <Loader2 size={11} aria-hidden className="animate-spin" style={{ color: "var(--fg-4)" }} /> : null}
        {report?.truncated ? <span title="Only the most recent sent emails were scanned." style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--fg-4)" }}>· newest sent only</span> : null}
      </div>
      {visible.map((group) => (
        <GroupCard key={group.category} companyId={companyId} companyName={companyName} group={group} theme={theme} onHandled={(category) => setHandled((current) => new Set(current).add(category))} />
      ))}
      {/* Second-wave placeholder: the deterministic findings are up, the AI review
          is still running — hold a skeleton so its extra findings don't pop in. */}
      {mayYieldMore ? <EmailQaLoadingCard /> : null}
    </div>
  );
}
