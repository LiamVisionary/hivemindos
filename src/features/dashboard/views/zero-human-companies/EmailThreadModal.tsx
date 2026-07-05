"use client";

// Full-email detail for the Zero Human Companies Emails tab. Opens a thread's
// message body, its embedded links (booking/preview CTAs), and any real file
// attachments, plus a "Correct agent" action that reuses the reject → directive
// → company-learning flow, seeded with this email so the crew fixes it next time.
import React from "react";
import { createPortal } from "react-dom";
import { ExternalLink, MessageSquare, Paperclip } from "lucide-react";
import { RejectDeliverableModal } from "./RejectDeliverableModal";
import { SkeletonText, Spinner } from "./primitives";
import { isExternalHttpUrl, openExternalUrl } from "@/lib/native/open-external-url";
import type { CompanyEmailThread } from "@/lib/services/agent-mailboxes";

const DIRECTION_LABEL: Record<string, string> = {
  outbound: "Sent",
  inbound: "Reply",
  mixed: "Thread",
  queued: "Queued — not sent",
};

export function EmailThreadModal({
  thread,
  companyId,
  companyName,
  onClose,
  onCorrected,
}: {
  thread: CompanyEmailThread;
  companyId: string;
  companyName: string;
  onClose: () => void;
  onCorrected?: () => void;
}) {
  const [correcting, setCorrecting] = React.useState(false);
  const [detail, setDetail] = React.useState<{ body?: string; links?: { label: string; url: string }[]; attachments?: { name: string; url?: string }[]; note?: string } | null>(null);
  const [loadingDetail, setLoadingDetail] = React.useState(() => !thread.body);
  // Which external URL is mid-open — drives a spinner on the clicked chip. In the
  // Tauri shell the open shells out to the OS browser and can take a couple of
  // seconds; without this the chip looked dead until the browser finally appeared.
  const [openingUrl, setOpeningUrl] = React.useState<string | null>(null);

  const openLink = React.useCallback(async (url: string) => {
    if (!isExternalHttpUrl(url)) return;
    setOpeningUrl(url);
    try {
      await openExternalUrl(url);
    } finally {
      setOpeningUrl((current) => (current === url ? null : current));
    }
  }, []);

  // The maps-agency outbox ships its body in the list; other providers (AgentMail,
  // Cloudflare) don't — fetch the full body + attachments lazily on open.
  React.useEffect(() => {
    if (thread.body) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/emails?threadId=${encodeURIComponent(thread.id)}`, { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; body?: string; links?: { label: string; url: string }[]; attachments?: { name: string; url?: string }[]; note?: string } | null;
        if (!alive) return;
        if (res.ok && data && data.ok !== false) setDetail(data);
        else setDetail({ note: (data && data.error) || "Couldn't load this email." });
      } catch {
        if (alive) setDetail({ note: "Couldn't load this email." });
      } finally {
        if (alive) setLoadingDetail(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [companyId, thread.id, thread.body]);

  const body = (detail?.body || thread.body || thread.preview || "").trim();
  const links = detail?.links ?? thread.links ?? [];
  const attachments = detail?.attachments ?? thread.attachments ?? [];
  const detailNote = detail?.note;
  const who = thread.correspondents.length > 0 ? thread.correspondents.join(", ") : "—";
  const when = thread.updatedAt ? new Date(thread.updatedAt).toLocaleString() : "";
  const dirLabel = DIRECTION_LABEL[thread.direction] || thread.direction;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center", padding: 20 }}>
      <div
        onClick={(event) => event.stopPropagation()}
        style={{ width: "min(720px, 100%)", maxHeight: "86vh", display: "flex", flexDirection: "column", background: "var(--bg-0)", border: "1px solid var(--line-2)", borderRadius: 16, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "16px 18px 12px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 16, fontWeight: 700, color: "var(--fg)", lineHeight: 1.3, overflowWrap: "anywhere" }}>{thread.subject}</div>
            <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: 8, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>
              <span>{dirLabel}</span>
              <span>· {thread.providerLabel}</span>
              <span title={thread.inboxAddress}>· ✉ {thread.inboxAddress}</span>
              <span>· to {who}</span>
              {when ? <span>· {when}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ flexShrink: 0, cursor: "pointer", border: "none", background: "var(--bg-3)", color: "var(--fg-3)", borderRadius: 8, width: 26, height: 26, fontSize: 12 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 18px 8px", display: "flex", flexDirection: "column", gap: 14 }}>
          {links.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: 0.06, textTransform: "uppercase", color: "var(--fg-4)" }}>Links in this email</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {links.map((link, index) => {
                  const opening = openingUrl === link.url;
                  return (
                    <a key={index} href={link.url} target="_blank" rel="noreferrer" title={link.url} aria-busy={opening} className="zhc-linkchip" onClick={(event) => { if (isExternalHttpUrl(link.url)) { event.preventDefault(); void openLink(link.url); } }} style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 340, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--cyan-2)", textDecoration: "none", border: "1px solid color-mix(in srgb, var(--cyan) 35%, var(--line))", borderRadius: 8, padding: "5px 10px" }}>
                      {opening ? <Spinner size={13} style={{ flexShrink: 0 }} /> : <ExternalLink size={13} aria-hidden style={{ flexShrink: 0 }} />}
                      <span style={{ fontWeight: 600, flexShrink: 0 }}>{opening ? "Opening…" : link.label}</span>
                      {!opening && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg-4)" }}>{link.url.replace(/^https?:\/\//, "")}</span>}
                    </a>
                  );
                })}
              </div>
            </div>
          ) : null}

          {attachments.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: 0.06, textTransform: "uppercase", color: "var(--fg-4)" }}>Attachments</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {attachments.map((attachment, index) =>
                  attachment.url ? (
                    <a key={index} href={attachment.url} target="_blank" rel="noreferrer" aria-busy={openingUrl === attachment.url} className="zhc-linkchip" onClick={(event) => { if (attachment.url && isExternalHttpUrl(attachment.url)) { event.preventDefault(); void openLink(attachment.url); } }} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-2)", textDecoration: "none", border: "1px solid var(--line)", borderRadius: 8, padding: "5px 10px" }}>
                      {openingUrl === attachment.url ? <Spinner size={13} /> : <Paperclip size={13} aria-hidden />} {openingUrl === attachment.url ? "Opening…" : attachment.name}
                    </a>
                  ) : (
                    <span key={index} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", border: "1px solid var(--line)", borderRadius: 8, padding: "5px 10px" }}>
                      <Paperclip size={13} aria-hidden /> {attachment.name}
                    </span>
                  ),
                )}
              </div>
            </div>
          ) : null}

          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--f-body)", fontSize: 13, lineHeight: 1.6, color: body ? "var(--fg-2)" : "var(--fg-4)", background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: 10, padding: "13px 15px" }}>
            {loadingDetail && !body ? (
              <div role="status" aria-label="Loading the full email"><SkeletonText lines={5} /></div>
            ) : body || detailNote || "(no body captured for this message)"}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px 16px", borderTop: "1px solid var(--line)" }}>
          <span style={{ flex: 1, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", lineHeight: 1.45 }}>Something off? Tell the crew what to fix — it becomes a standing directive they read on every task.</span>
          <button
            type="button"
            onClick={() => setCorrecting(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, flexShrink: 0, cursor: "pointer", borderRadius: 9, padding: "8px 14px", font: "inherit", fontFamily: "var(--f-display)", fontSize: 12.5, fontWeight: 700, border: "1px solid var(--honey)", background: "var(--honey)", color: "var(--bg-0)" }}
          >
            <MessageSquare size={15} aria-hidden /> Correct agent
          </button>
        </div>
      </div>

      {correcting ? (
        <RejectDeliverableModal
          companyId={companyId}
          deliverableRef={`Email — ${thread.subject}`}
          icon="✉️"
          title="Correct the agent on this email"
          submitLabel="Send correction"
          placeholder="What's wrong with this email / what to do differently next time…"
          intro={(
            <>Correcting how {companyName}&apos;s crew handled <b style={{ color: "var(--fg-3)" }}>{thread.subject}</b>. Your feedback becomes a standing directive in company knowledge — the crew reads it on every dispatch, so it fixes this next time. Optionally point them at a skill or attach references.</>
          )}
          onClose={() => setCorrecting(false)}
          onDone={() => {
            setCorrecting(false);
            onCorrected?.();
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
