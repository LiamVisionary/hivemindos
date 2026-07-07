"use client";
// Zero Human Companies — Comms tab: the crew's outreach + inbox across providers.
import React from "react";
import { Panel, SectionLabel, Spinner, Skeleton, SkeletonText, HexBadge } from "./primitives";
import { DeliverableCard } from "./DeliverableCard";
import { EmailThreadModal } from "./EmailThreadModal";
import { collectCompanyDeliverables, partitionByOutput, dispatchedAgo } from "./company-deliverables";
import type { OutputSpec } from "./company-output-spec";
import type { Colony } from "./types";
import type { CompanyEmailDirection, CompanyEmailThread, CompanyEmailThreadsResult, CompanyMailbox, MailProviderSummary } from "@/lib/services/agent-mailboxes";

const EMAIL_DIRECTION_META: Record<CompanyEmailDirection, { glyph: string; label: string; color: string }> = {
  outbound: { glyph: "↑", label: "sent", color: "var(--live)" },
  inbound: { glyph: "↓", label: "reply", color: "var(--honey)" },
  mixed: { glyph: "↕", label: "thread", color: "var(--fg-2)" },
  queued: { glyph: "⏸", label: "queued", color: "var(--fg-3)" },
};

/** One outreach thread: who's on the other end, subject, preview, provenance. */
function EmailThreadCard({ thread, onOpen }: { thread: CompanyEmailThread; onOpen?: (thread: CompanyEmailThread) => void }) {
  const dir = EMAIL_DIRECTION_META[thread.direction] ?? EMAIL_DIRECTION_META.mixed;
  const who = thread.correspondents.length > 0 ? thread.correspondents.join(", ") : "—";
  const when = dispatchedAgo(thread.updatedAt);
  const openable = Boolean(onOpen);
  return (
    <div
      role={openable ? "button" : undefined}
      tabIndex={openable ? 0 : undefined}
      onClick={openable ? () => onOpen!(thread) : undefined}
      onKeyDown={openable ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen!(thread); } } : undefined}
      title={openable ? "Open this email" : undefined}
      className="zhc-btn-ghost"
      style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel-2)", padding: "13px 14px", display: "flex", flexDirection: "column", gap: 8, cursor: openable ? "pointer" : undefined }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span title={dir.label} aria-label={dir.label} style={{ flexShrink: 0, display: "inline-grid", placeItems: "center", width: 20, height: 20, borderRadius: 6, background: `color-mix(in srgb, ${dir.color} 16%, transparent)`, color: dir.color, fontSize: 12, fontWeight: 700 }}>{dir.glyph}</span>
        <span title={who} style={{ flex: 1, minWidth: 0, fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who}</span>
        <span style={{ flexShrink: 0, fontFamily: "var(--f-mono)", fontSize: 8.5, letterSpacing: 0.04, textTransform: "uppercase", color: "var(--fg-4)", border: "1px solid var(--line)", borderRadius: 5, padding: "1px 5px" }}>{thread.providerLabel}</span>
        {when && <span style={{ flexShrink: 0, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{when}</span>}
      </div>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, color: "var(--fg)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{thread.subject}</div>
      {thread.preview && (
        <div style={{ fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{thread.preview}</div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>
        <span title={thread.inboxAddress} style={{ maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✉ {thread.inboxAddress}</span>
        <span>· {thread.messageCount} msg{thread.messageCount === 1 ? "" : "s"}</span>
        {thread.attachmentCount > 0 && <span>· 📎 {thread.attachmentCount}</span>}
        {(thread.links?.length ?? 0) > 0 && <span>· 🔗 {thread.links!.length}</span>}
        {openable && <span style={{ marginLeft: "auto" }}>open ↗</span>}
      </div>
    </div>
  );
}

/** Compact per-provider status chips (AgentMail / Cloudflare Inbox). */
function MailProviderStrip({ providers }: { providers: MailProviderSummary[] }) {
  if (providers.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
      {providers.map((p) => {
        const color = p.connected ? "var(--live)" : "var(--fg-4)";
        const summary = p.connected ? (p.threadCount > 0 ? `${p.threadCount} thread${p.threadCount === 1 ? "" : "s"}` : p.inboxCount > 0 ? `${p.inboxCount} inbox${p.inboxCount === 1 ? "" : "es"}` : "connected") : "not connected";
        return (
          <span key={p.id} title={p.note || summary} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-3)", border: "1px solid var(--line)", borderRadius: 999, padding: "4px 10px" }}>
            <span className={"dot" + (p.connected && p.threadCount > 0 ? " live" : "")} style={{ color }} />
            {p.label}
            <span style={{ color: "var(--fg-4)" }}>· {summary}</span>
          </span>
        );
      })}
    </div>
  );
}

/** One agent mailbox in the roster view — clickable to focus its threads. */
function AgentMailboxCard({ mailbox, agentName, onOpen }: { mailbox: CompanyMailbox; agentName?: string; onOpen: () => void }) {
  const issue = mailbox.status === "issue";
  const statusColor = issue ? "var(--danger)" : mailbox.threadCount > 0 ? "var(--live)" : "var(--fg-4)";
  const statusLabel = issue ? "needs attention" : mailbox.threadCount > 0 ? `${mailbox.threadCount} thread${mailbox.threadCount === 1 ? "" : "s"}` : "ready";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: "13px 14px", borderRadius: 12, border: `1px solid ${issue ? "color-mix(in srgb, var(--danger) 42%, transparent)" : "var(--line)"}`, background: "var(--panel-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <HexBadge size={26} glyph={issue ? "⚠" : "✉"} color={issue ? "var(--danger)" : "var(--fg-2)"} />
        <span title={agentName || mailbox.agentId} style={{ flex: 1, minWidth: 0, fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agentName || mailbox.agentId || "Shared inbox"}</span>
        <span style={{ flexShrink: 0, fontFamily: "var(--f-mono)", fontSize: 8.5, letterSpacing: 0.04, textTransform: "uppercase", color: "var(--fg-4)", border: "1px solid var(--line)", borderRadius: 5, padding: "1px 5px" }}>{mailbox.providerLabel}</span>
      </div>
      <span title={mailbox.address} style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✉ {mailbox.address}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "var(--f-mono)", fontSize: 10, color: statusColor }}>
        <span className={"dot" + (!issue && mailbox.threadCount > 0 ? " live" : "")} style={{ color: statusColor }} />
        {statusLabel}
        <span style={{ flex: 1 }} />
      </div>
      {issue && mailbox.detail && (
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--danger)", lineHeight: 1.4 }}>{mailbox.detail}</span>
      )}
      <button type="button" onClick={onOpen} className="zhc-btn-ghost" style={{ cursor: "pointer", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-2)", borderRadius: 8, padding: "7px 0", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 600 }}>View mail →</button>
    </div>
  );
}

/** A company member agent that has no mailbox on any provider — a soft issue card. */
function NoMailboxCard({ agentName }: { agentName: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "13px 14px", borderRadius: 12, border: "1px dashed var(--line-2)", background: "var(--panel-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span aria-hidden style={{ fontSize: 15, opacity: 0.7 }}>📭</span>
        <span title={agentName} style={{ flex: 1, minWidth: 0, fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agentName}</span>
      </div>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", lineHeight: 1.4 }}>No mailbox yet — provision one from this agent&apos;s settings to give it outreach email.</span>
    </div>
  );
}

/** "Showing <address> ✕" chip when the all-mail list is focused on one mailbox. */
function MailFilterChip({ address, onClear }: { address: string; onClear: () => void }) {
  return (
    <div style={{ display: "flex", marginBottom: 12 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", border: "1px solid var(--line-2)", borderRadius: 999, padding: "4px 6px 4px 11px", background: "var(--panel-2)" }}>
        <span style={{ color: "var(--fg-4)" }}>showing</span>
        <span title={address} style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✉ {address}</span>
        <button type="button" onClick={onClear} aria-label="Clear mailbox filter" title="Clear filter" style={{ display: "inline-grid", placeItems: "center", width: 18, height: 18, cursor: "pointer", border: "none", borderRadius: 999, background: "var(--panel-hi)", color: "var(--fg-3)", fontSize: 10 }}>✕</button>
      </span>
    </div>
  );
}

/** Centered icon + copy used for every non-thread state of the Emails tab. */
function EmailsPlaceholder({ icon, title, body, tone = "muted" }: { icon: string; title: string; body: string; tone?: "muted" | "warn" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "34px 16px", textAlign: "center" }}>
      <span aria-hidden style={{ fontSize: 30 }}>{icon}</span>
      <span style={{ fontFamily: "var(--f-display)", fontSize: 14, fontWeight: 600, color: tone === "warn" ? "var(--danger)" : "var(--fg-2)" }}>{title}</span>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)", maxWidth: 448, lineHeight: 1.55 }}>{body}</span>
    </div>
  );
}

/** Shape-matched skeleton for the thread grid while mail loads. */
function EmailsLoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading email threads" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel-2)", padding: 14, display: "flex", flexDirection: "column", gap: 11 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Skeleton width={30} height={30} radius={8} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <Skeleton width="58%" height={11} />
              <Skeleton width="38%" height={9} />
            </div>
          </div>
          <SkeletonText lines={2} />
        </div>
      ))}
    </div>
  );
}

type CompanyEmailsResponse = CompanyEmailThreadsResult & { ok?: boolean; error?: string };

/**
 * Comms tab for a company. Streams the crew's real email threads across every
 * mail provider (AgentMail, Cloudflare Agentic Inbox) via
 * /api/companies/{id}/emails — lazily, since this only mounts when the Comms tab
 * is open. A per-provider status strip plus honest, distinct empty states keep an
 * empty tab legible. A segmented toggle switches between "All mail" (the merged
 * thread list) and "Mailboxes" — the crew's agent mailboxes, where broken ones
 * surface as attention cards; clicking a mailbox focuses the all-mail list.
 */
export function CommsPanel({ colony: c, spec, theme = "dark" }: { colony: Colony; spec: OutputSpec; theme?: "dark" | "light" }) {
  const all = React.useMemo(() => collectCompanyDeliverables(c), [c]);
  const commsDeliverables = React.useMemo(() => partitionByOutput(all, spec).comms, [all, spec]);
  const rejectedRefs = React.useMemo(
    () => new Set((c.directives ?? []).filter((d) => d.source === "reject" && d.deliverableRef).map((d) => d.deliverableRef as string)),
    [c.directives],
  );

  const [data, setData] = React.useState<CompanyEmailThreadsResult | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);
  const [openThread, setOpenThread] = React.useState<CompanyEmailThread | null>(null);

  React.useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/companies/${encodeURIComponent(c.id)}/emails`, { cache: "no-store" });
        const payload = (await res.json().catch(() => ({}))) as CompanyEmailsResponse;
        if (ignore) return;
        if (!res.ok || payload.ok === false) throw new Error(payload.error || "Could not load email threads.");
        setData(payload);
        setError("");
      } catch (err) {
        if (ignore) return;
        setError(err instanceof Error ? err.message : "Could not load email threads.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [c.id, nonce]);

  const threads = data?.threads ?? [];
  const mailboxes = React.useMemo(() => data?.mailboxes ?? [], [data]);
  const [view, setView] = React.useState<"all" | "mailboxes">("all");
  const [focusAddress, setFocusAddress] = React.useState<string | null>(null);

  const agentNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const a of c.agents) if (a.id) map.set(a.id, a.name);
    return map;
  }, [c.agents]);

  // Company member agents with no mailbox on any provider → surfaced as issue cards.
  const agentsWithoutMailbox = React.useMemo(() => {
    const withMailbox = new Set(mailboxes.map((m) => m.agentId).filter((id): id is string => Boolean(id)));
    return c.agents.filter((a) => a.id && !withMailbox.has(a.id));
  }, [c.agents, mailboxes]);

  const mailboxCount = mailboxes.length + (data?.configured ? agentsWithoutMailbox.length : 0);
  const issueCount = mailboxes.filter((m) => m.status === "issue").length + (data?.configured ? agentsWithoutMailbox.length : 0);
  const openMailbox = (address: string) => { setFocusAddress(address); setView("all"); };
  const shownThreads = focusAddress ? threads.filter((t) => t.inboxAddress.trim().toLowerCase() === focusAddress.trim().toLowerCase()) : threads;
  const showToggle = Boolean(data) && (mailboxCount > 0 || threads.length > 0);

  return (
    <Panel>
      <SectionLabel
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{spec.commsBlurb}</span>
            <button
              type="button"
              onClick={() => setNonce((n) => n + 1)}
              disabled={loading}
              title="Refresh email threads"
              aria-label="Refresh email threads"
              style={{ display: "inline-grid", placeItems: "center", width: 24, height: 24, cursor: loading ? "default" : "pointer", border: "1px solid var(--line-2)", borderRadius: 7, background: "transparent", color: "var(--fg-4)", opacity: loading ? 0.5 : 1, fontSize: 12 }}
            >
              {loading ? <Spinner size={12} /> : "↻"}
            </button>
          </span>
        }
      >
        {spec.commsLabel}
      </SectionLabel>

      {data && <MailProviderStrip providers={data.providers} />}

      {showToggle && (
        <div style={{ display: "inline-flex", gap: 4, padding: 3, borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-soft)", alignSelf: "flex-start", marginBottom: 14 }}>
          {([["all", "All mail", threads.length], ["mailboxes", "Mailboxes", mailboxCount]] as const).map(([key, label, count]) => {
            const on = view === key;
            const badge = key === "mailboxes" && issueCount > 0 ? issueCount : count || null;
            const badgeIssue = key === "mailboxes" && issueCount > 0;
            return (
              <button key={key} type="button" onClick={() => setView(key)} style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", border: "1px solid " + (on ? "var(--line-2)" : "transparent"), background: on ? "var(--panel-2)" : "transparent", color: on ? "var(--fg)" : "var(--fg-3)", borderRadius: 7, padding: "6px 13px", fontFamily: "var(--f-display)", fontSize: 12, fontWeight: 600, letterSpacing: 0.06, textTransform: "uppercase" }}>
                {label}
                {badge ? (
                  <span style={{ display: "inline-grid", placeItems: "center", minWidth: 16, height: 16, padding: "0 5px", borderRadius: 999, background: badgeIssue ? "var(--danger)" : "var(--btn-bg)", color: badgeIssue ? "#fff" : "var(--btn-fg)", fontFamily: "var(--f-mono)", fontSize: 9.5, fontWeight: 700 }}>{badge}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {loading && !data ? (
        <EmailsLoadingSkeleton />
      ) : error ? (
        <EmailsPlaceholder icon="⚠️" title="Couldn't load email threads" body={error} tone="warn" />
      ) : view === "mailboxes" ? (
        mailboxCount > 0 ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>
                {mailboxes.length} mailbox{mailboxes.length === 1 ? "" : "es"}{issueCount > 0 ? ` · ${issueCount} need${issueCount === 1 ? "s" : ""} attention` : ""} · click one to see its mail
              </span>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => { setView("all"); setFocusAddress(null); }} className="zhc-btn-ghost" style={{ cursor: "pointer", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)", borderRadius: 8, padding: "5px 11px", fontFamily: "var(--f-mono)", fontSize: 10.5 }}>View all mail →</button>
            </div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
              {mailboxes.map((mb) => (
                <AgentMailboxCard key={`${mb.provider}:${mb.address}`} mailbox={mb} agentName={mb.agentId ? agentNameById.get(mb.agentId) : undefined} onOpen={() => openMailbox(mb.address)} />
              ))}
              {data?.configured && agentsWithoutMailbox.map((a) => (
                <NoMailboxCard key={`nomailbox:${a.id ?? a.name}`} agentName={a.name} />
              ))}
            </div>
          </>
        ) : (
          <EmailsPlaceholder
            icon={data?.configured ? "📭" : "🔌"}
            title={data?.configured ? "No mailboxes provisioned yet" : "No mail provider connected"}
            body={data?.detail || "Provision a mailbox from an agent's settings to give this crew outreach email."}
          />
        )
      ) : shownThreads.length > 0 ? (
        <>
          {focusAddress && <MailFilterChip address={focusAddress} onClear={() => setFocusAddress(null)} />}
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
            {shownThreads.map((t) => (
              <EmailThreadCard key={t.id} thread={t} onOpen={setOpenThread} />
            ))}
          </div>
          {!focusAddress && data?.detail && (
            <div style={{ marginTop: 12, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{data.detail}</div>
          )}
        </>
      ) : focusAddress ? (
        <>
          <MailFilterChip address={focusAddress} onClear={() => setFocusAddress(null)} />
          <EmailsPlaceholder icon="📭" title="No threads in this mailbox yet" body={`${focusAddress} hasn't exchanged any email yet. Clear the filter to see all mail.`} />
        </>
      ) : (
        <EmailsPlaceholder
          icon={data?.configured ? "📭" : "🔌"}
          title={data?.configured ? "No email threads here yet" : "No mail provider connected"}
          body={data?.detail || "This company runs outreach, but no live threads have landed on the board yet."}
        />
      )}

      {commsDeliverables.length > 0 && (
        <div style={{ marginTop: threads.length > 0 ? 22 : 14, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", marginBottom: 12 }}>Also referenced on the board</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {commsDeliverables.map((x) => (
              <DeliverableCard key={x.key} item={x.classified} machineName={x.machineName} timestampMs={x.timestampMs} theme={theme} companyId={c.id} initiallyRejected={rejectedRefs.has(x.classified.title)} layout="card" />
            ))}
          </div>
        </div>
      )}

      {openThread && (
        <EmailThreadModal
          thread={openThread}
          companyId={c.id}
          companyName={c.name}
          theme={theme}
          onClose={() => setOpenThread(null)}
          onCorrected={() => { setOpenThread(null); setNonce((n) => n + 1); }}
        />
      )}
    </Panel>
  );
}
