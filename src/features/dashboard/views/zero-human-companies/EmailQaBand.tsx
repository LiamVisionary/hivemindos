"use client";

// Zero Human Companies — "email quality" band. Continuously catches problems in
// the emails a company's crew ALREADY SENT and turns them into handleable issues,
// so the human doesn't have to open every message by hand.
//
// It fetches the fast deterministic scan first (dead/broken CTA links, unfilled
// placeholders, a visible tracking-pixel line, missing attachments), renders
// immediately, then layers in the AI content review (off-strategy copy,
// personalization mismatch, tone). Findings are grouped by defect class; each
// class shows the affected emails and a one-click "Teach the crew" that writes the
// fix as a standing directive (the same add-directive learning flow the Emails
// tab's "Correct agent" uses), then animates away. Additive: renders nothing when
// the sent corpus is clean.
import React from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, GraduationCap, Loader2, MailWarning, Sparkles, X } from "lucide-react";

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

function GroupCard({ companyId, group, onHandled }: { companyId: string; group: Group; onHandled: (category: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);
  const [error, setError] = React.useState("");

  const count = group.findings.length;
  const rule = group.suggestion || `Fix the "${group.label}" problem in future emails.`;

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
            deliverableRef: `Email QA — ${group.label}`,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || "Could not save the directive.");
      setDone(true);
      window.setTimeout(() => setLeaving(true), 650);
      window.setTimeout(() => onHandled(group.category), 1050);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the company service.");
      setBusy(false);
    }
  }

  function dismiss() {
    setLeaving(true);
    window.setTimeout(() => onHandled(group.category), 350);
  }

  const accent = done ? "var(--cyan)" : SEVERITY_COLOR[group.severity];
  return (
    <div
      style={{
        overflow: "hidden",
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
            <button
              type="button" onClick={teach} disabled={busy}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: busy ? "default" : "pointer", borderRadius: 8, padding: "6px 11px", font: "inherit", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, border: "1px solid var(--honey)", background: "var(--honey)", color: "var(--bg)", opacity: busy ? 0.6 : 1 }}
            >
              <GraduationCap size={13} aria-hidden /> {busy ? "Teaching…" : "Teach the crew"}
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
      </div>
    </div>
  );
}

export function EmailQaBand({ companyId }: { companyId: string }) {
  const [report, setReport] = React.useState<Report | null>(null);
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
        if (alive && res.ok && data?.ok && data.report) setReport(data.report);
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
        if (alive) setDeepLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [companyId]);

  const groups = React.useMemo(() => (report ? groupFindings(report.findings) : []), [report]);
  const visible = groups.filter((group) => !handled.has(group.category));

  if (visible.length === 0) {
    // Only take vertical space while the AI review is still landing on a company
    // whose deterministic pass was clean — otherwise render nothing.
    if (deepLoading && report && report.findings.length === 0) {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>
          <Loader2 size={12} aria-hidden className="animate-spin" /> Reviewing sent emails for quality…
        </div>
      );
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
        <GroupCard key={group.category} companyId={companyId} group={group} onHandled={(category) => setHandled((current) => new Set(current).add(category))} />
      ))}
    </div>
  );
}
