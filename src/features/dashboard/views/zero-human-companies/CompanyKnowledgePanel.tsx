"use client";
// Learning-tab "inject knowledge" surface: add a standing directive without
// editing the company, and manage the list. Directives flow into the crew's
// dispatch context (companyWorkerContext) on the next cycle. Also renders
// reject-sourced directives so the redirect trail is visible.
import React from "react";
import { Panel, SectionLabel } from "./primitives";
import type { Colony } from "./types";
import type { CompanyDirective } from "@/lib/types/company";
import { CompanyDirectiveComposer, type DirectiveDraft } from "./CompanyDirectiveComposer";

export function CompanyKnowledgePanel({ colony: c }: { colony: Colony }) {
  // Show the company's directives from props until this panel makes an edit,
  // then show the server's authoritative response. (Avoids a set-state-in-effect.)
  const [localDirectives, setLocalDirectives] = React.useState<CompanyDirective[] | null>(null);
  const directives = localDirectives ?? c.directives ?? [];
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const post = async (payload: Record<string, unknown>): Promise<CompanyDirective[]> => {
    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; company?: { directives?: CompanyDirective[] } };
    if (!json.ok) throw new Error(json.error || "Request failed.");
    return json.company?.directives ?? [];
  };

  const inject = async (draft: DirectiveDraft) => {
    setBusy(true);
    setError("");
    try {
      setLocalDirectives(await post({ action: "add-directive", id: c.id, directive: { ...draft, source: "inject" } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not inject knowledge.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      setLocalDirectives(await post({ action: "remove-directive", id: c.id, directiveId: id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the directive.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel style={{ gridColumn: "1 / -1" }}>
      <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>injected into every dispatch</span>}>
        company knowledge · standing directives
      </SectionLabel>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)", lineHeight: 1.55, marginBottom: 12 }}>
        Inject an instruction or fact the crew must follow — it&apos;s appended to every dispatched task&apos;s context on the next cycle, no charter edit needed. Point them at a skill or attach references when it helps.
      </div>
      <CompanyDirectiveComposer
        placeholder="e.g. Use the portfolio offer API (POST liamvisionary.com/api/offer, bearer PORTFOLIO_OFFER_API_TOKEN) for client previews — not the old Worker…"
        submitLabel="Inject knowledge"
        busy={busy}
        onSubmit={inject}
      />
      {error && <div style={{ marginTop: 8, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--danger-2)" }}>{error}</div>}

      {directives.length > 0 ? (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {directives.map((d) => (
            <div key={d.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)" }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.06, color: d.source === "reject" ? "var(--danger-2)" : "var(--cyan-2)", border: "1px solid var(--line-2)", borderRadius: 5, padding: "2px 6px", flexShrink: 0 }}>
                {d.source === "reject" ? "redirect" : "inject"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "var(--f-body)", fontSize: 13, color: "var(--fg)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{d.text}</div>
                <div style={{ marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>
                  {d.skill ? <span>skill: {d.skill}</span> : null}
                  {d.deliverableRef ? <span>re: {d.deliverableRef}</span> : null}
                  {d.attachments?.length ? <span>{d.attachments.length} attachment{d.attachments.length === 1 ? "" : "s"}</span> : null}
                </div>
              </div>
              <button type="button" onClick={() => remove(d.id)} disabled={busy} aria-label="Remove directive" title="Remove" style={{ cursor: "pointer", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-4)", borderRadius: 7, width: 24, height: 24, fontSize: 11, flexShrink: 0 }}>✕</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 14, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>No standing directives yet — inject one above, or reject a deliverable to redirect the crew.</div>
      )}
    </Panel>
  );
}
