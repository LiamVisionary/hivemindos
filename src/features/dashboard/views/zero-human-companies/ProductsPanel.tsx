// Zero Human Companies — Products tab: the company's official catalog of
// sellable packages + prices. The catalog is stored with the company definition
// in the shared brain (Operations/Companies/companies.json in the vault), so a
// save here replicates fleet-wide and lands in every dispatched agent's
// standing context — agents always quote THESE prices, never repo defaults.
"use client";

import React from "react";
import { Panel, SectionLabel, Spinner, Skeleton } from "./primitives";
import type { Colony } from "./types";
import type { CompanyPricingProposal, CompanyProduct, CompanyProductCatalog } from "@/lib/types/company";

type ProductsResponse = { ok?: boolean; error?: string; products?: CompanyProductCatalog | null };

let draftUid = 0;

/** Editable draft row — amount kept as text so partial input ("15") doesn't snap. */
type DraftProduct = {
  /** Stable client-side row identity for React keys (survives removals/reorders). */
  uid: number;
  key: string;
  name: string;
  amountText: string;
  description: string;
  recommended: boolean;
  interval: "one-time" | "month" | "year";
  kind: "package" | "addon";
};

function toDraft(item: CompanyProduct): DraftProduct {
  return {
    uid: ++draftUid,
    key: item.key,
    name: item.name,
    amountText: String(item.amountUsd),
    description: item.description ?? "",
    recommended: item.recommended === true,
    interval: item.interval ?? "one-time",
    kind: item.kind === "addon" ? "addon" : "package",
  };
}

function fromDraft(draft: DraftProduct): CompanyProduct | null {
  const name = draft.name.trim();
  const amountUsd = Number(draft.amountText.replace(/[$,\s]/g, ""));
  if (!name || !Number.isFinite(amountUsd) || amountUsd < 0) return null;
  return {
    key: draft.key,
    name,
    amountUsd,
    description: draft.description.trim() || undefined,
    recommended: draft.recommended || undefined,
    interval: draft.interval === "one-time" ? undefined : draft.interval,
    kind: draft.kind === "addon" ? "addon" : undefined,
  };
}

const emptyDraft = (kind: DraftProduct["kind"]): DraftProduct => ({
  uid: ++draftUid,
  key: "",
  name: "",
  amountText: "",
  description: "",
  recommended: false,
  interval: kind === "addon" ? "month" : "one-time",
  kind,
});

/** One height for every control that shares a row — mixed font sizes otherwise render mixed heights. */
const CONTROL_HEIGHT = 38;

const inputStyle: React.CSSProperties = {
  background: "var(--panel-hi)",
  border: "1px solid var(--line-2)",
  borderRadius: 8,
  color: "var(--fg)",
  fontFamily: "var(--f-body)",
  fontSize: 13,
  padding: "7px 10px",
  outline: "none",
  width: "100%",
};

const INTERVAL_LABEL: Record<DraftProduct["interval"], string> = {
  "one-time": "One-time",
  month: "Monthly",
  year: "Yearly",
};

function ProductRow({
  draft, onChange, onRemove,
}: {
  draft: DraftProduct;
  onChange: (next: DraftProduct) => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ position: "relative", border: `1px solid ${draft.recommended ? "var(--honey)" : "var(--line)"}`, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10, background: draft.recommended ? "color-mix(in srgb, var(--honey) 6%, var(--panel-2))" : "var(--panel-2)", boxShadow: draft.recommended ? "0 0 0 1px color-mix(in srgb, var(--honey) 25%, transparent)" : "none" }}>
      {draft.recommended && (
        <span style={{ position: "absolute", top: -9, left: 14, fontFamily: "var(--f-mono)", fontSize: 9, fontWeight: 700, letterSpacing: 0.08, textTransform: "uppercase", color: "var(--bg)", background: "var(--honey)", borderRadius: 5, padding: "2px 7px" }}>★ default pick</span>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder={draft.kind === "addon" ? "Add-on name (e.g. Basic hosting & care)" : "Package name (e.g. Standard Growth Site)"}
          aria-label="Product name"
          style={{ ...inputStyle, height: CONTROL_HEIGHT, boxSizing: "border-box", fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 14 }}
        />
        <button
          type="button"
          onClick={onRemove}
          title="Remove this product"
          aria-label="Remove this product"
          style={{ display: "inline-grid", placeItems: "center", flex: "0 0 auto", width: 28, height: 28, cursor: "pointer", border: "1px solid var(--line-2)", borderRadius: 8, background: "transparent", color: "var(--fg-4)", fontSize: 13 }}
        >
          ✕
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "1 1 auto" }}>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 15, color: "var(--fg-3)" }}>$</span>
          <input
            value={draft.amountText}
            onChange={(e) => onChange({ ...draft, amountText: e.target.value })}
            placeholder="0"
            inputMode="decimal"
            aria-label="Price in USD"
            style={{ ...inputStyle, height: CONTROL_HEIGHT, boxSizing: "border-box", fontFamily: "var(--f-mono)", fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
          />
        </span>
        <select
          value={draft.interval}
          onChange={(e) => onChange({ ...draft, interval: e.target.value as DraftProduct["interval"] })}
          aria-label="Billing cadence"
          style={{ ...inputStyle, height: CONTROL_HEIGHT, boxSizing: "border-box", width: "auto", flex: "0 0 auto", cursor: "pointer" }}
        >
          {(Object.keys(INTERVAL_LABEL) as DraftProduct["interval"][]).map((value) => (
            <option key={value} value={value}>{INTERVAL_LABEL[value]}</option>
          ))}
        </select>
      </div>
      <textarea
        value={draft.description}
        onChange={(e) => onChange({ ...draft, description: e.target.value })}
        placeholder="What the customer gets — agents use this wording when pitching."
        aria-label="Product description"
        rows={3}
        style={{ ...inputStyle, resize: "vertical", lineHeight: 1.45, color: "var(--fg-2)", flex: 1 }}
      />
      <label
        title="The default pick agents highlight in offers and checkout pages — exactly one per group"
        style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 10.5, color: draft.recommended ? "var(--honey-2)" : "var(--fg-4)", textTransform: "uppercase", letterSpacing: 0.05, whiteSpace: "nowrap", alignSelf: "flex-start" }}
      >
        <input
          type="checkbox"
          checked={draft.recommended}
          onChange={(e) => onChange({ ...draft, recommended: e.target.checked })}
          style={{ accentColor: "var(--honey)" }}
        />
        {draft.recommended ? "Recommended · the default pick" : "Make this the recommended pick"}
      </label>
    </div>
  );
}

export function ProductsPanel({
  colony: c, pendingProposals = [], onGoToApprovals,
}: {
  colony: Colony;
  /** Crew-raised price-change requests awaiting the human — drives the review banner. */
  pendingProposals?: CompanyPricingProposal[];
  /** Jump to the Approvals tab where the requests are decided. */
  onGoToApprovals?: () => void;
}) {
  const [drafts, setDrafts] = React.useState<DraftProduct[] | null>(null);
  const [seededFrom, setSeededFrom] = React.useState<string | undefined>(c.products?.seededFrom);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [savedTick, setSavedTick] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/companies/${encodeURIComponent(c.id)}/products`, { cache: "no-store" });
        const payload = (await res.json().catch(() => ({}))) as ProductsResponse;
        if (ignore) return;
        if (!res.ok || payload.ok === false) throw new Error(payload.error || "Could not load the product catalog.");
        setDrafts((payload.products?.items ?? []).map(toDraft));
        setSeededFrom(payload.products?.seededFrom);
        setError("");
      } catch (err) {
        if (ignore) return;
        // The shared-brain copy that rode the page load keeps the tab usable offline.
        setDrafts((c.products?.items ?? []).map(toDraft));
        setError(err instanceof Error ? err.message : "Could not load the product catalog.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void load();
    return () => { ignore = true; };
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps -- c.products is the initial fallback only

  const update = (index: number, next: DraftProduct) => {
    setDrafts((prev) =>
      (prev ?? []).map((d, i) => {
        if (i === index) return next;
        // "Recommended" is THE default pick agents lead with — radio semantics:
        // marking one clears any other in the same group (packages / add-ons).
        if (next.recommended && d.kind === next.kind && d.recommended) return { ...d, recommended: false };
        return d;
      }),
    );
    setDirty(true);
    setSavedTick(false);
  };
  const remove = (index: number) => {
    setDrafts((prev) => (prev ?? []).filter((_, i) => i !== index));
    setDirty(true);
    setSavedTick(false);
  };
  const add = (kind: DraftProduct["kind"]) => {
    setDrafts((prev) => [...(prev ?? []), emptyDraft(kind)]);
    setDirty(true);
    setSavedTick(false);
  };

  const invalidCount = (drafts ?? []).filter((d) => fromDraft(d) === null).length;

  const save = async () => {
    if (!drafts || saving) return;
    const items = drafts.map(fromDraft).filter((item): item is CompanyProduct => item !== null);
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/companies/${encodeURIComponent(c.id)}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const payload = (await res.json().catch(() => ({}))) as ProductsResponse;
      if (!res.ok || payload.ok === false) throw new Error(payload.error || "Could not save the product catalog.");
      setDrafts((payload.products?.items ?? []).map(toDraft));
      setSeededFrom(payload.products?.seededFrom);
      setDirty(false);
      setSavedTick(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the product catalog.");
    } finally {
      setSaving(false);
    }
  };

  const list = drafts ?? [];
  const packages = list.map((d, i) => [d, i] as const).filter(([d]) => d.kind === "package");
  const addons = list.map((d, i) => [d, i] as const).filter(([d]) => d.kind === "addon");

  return (
    <Panel>
      <SectionLabel
        right={
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading || !dirty}
            style={{ padding: "7px 16px", borderRadius: 9, cursor: saving || loading || !dirty ? "default" : "pointer", fontFamily: "var(--f-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.05, border: `1px solid ${dirty ? "var(--btn-line)" : "var(--line-2)"}`, background: dirty ? "var(--btn-bg)" : "transparent", color: dirty ? "var(--btn-fg)" : "var(--fg-4)", fontWeight: 700, opacity: saving ? 0.6 : 1 }}
          >
            {saving ? <><Spinner size={11} /> Saving</> : savedTick ? "Saved ✓" : "Save to shared brain"}
          </button>
        }
      >
        Products & pricing
      </SectionLabel>

      <div style={{ fontFamily: "var(--f-body)", fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.5, marginBottom: 14 }}>
        The official catalog of what this company sells. Saved with the company in the shared brain and replicated to
        every machine — the crew quotes exactly these prices in pitches, offers, and checkouts.
        {seededFrom?.startsWith("repo:") && (
          <span> Initially seeded from the attached repo&apos;s <code style={{ fontFamily: "var(--f-mono)", fontSize: 11.5 }}>{seededFrom.slice(5)}</code>; edits here override it for good.</span>
        )}
      </div>

      {pendingProposals.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1px solid var(--honey-line)", background: "var(--honey-soft)", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
          <span aria-hidden style={{ fontSize: 15 }}>⚖</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--honey)" }}>
              Pricing review requested — {pendingProposals.length === 1 ? "1 price-change request awaits" : `${pendingProposals.length} price-change requests await`} your decision
            </div>
            <div style={{ fontFamily: "var(--f-body)", fontSize: 12, color: "var(--fg-3)", marginTop: 3 }}>
              {pendingProposals.map((p) => `${p.productName} $${p.currentAmountUsd.toLocaleString("en-US")} → $${p.proposedAmountUsd.toLocaleString("en-US")}`).join(" · ")}
            </div>
          </div>
          {onGoToApprovals && (
            <button
              type="button"
              onClick={onGoToApprovals}
              style={{ padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.05, fontWeight: 700, border: "1px solid var(--btn-line)", background: "var(--btn-bg)", color: "var(--btn-fg)", whiteSpace: "nowrap" }}
            >
              Review in Approvals →
            </button>
          )}
        </div>
      )}

      {error && (
        <div style={{ border: "1px solid var(--danger)", borderRadius: 10, padding: "9px 12px", marginBottom: 12, fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--danger)" }}>{error}</div>
      )}

      {loading && drafts === null ? (
        <div role="status" aria-label="Loading the product catalog" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton width={84} height={9} />
            {[0, 1].map((i) => (
              <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 9 }}>
                <Skeleton width="46%" height={13} />
                <Skeleton width="82%" height={10} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="mono-cap" style={{ color: "var(--fg-4)" }}>Packages</div>
            {packages.length === 0 && (
              <div style={{ fontFamily: "var(--f-body)", fontSize: 12.5, color: "var(--fg-4)" }}>No packages yet — add what this company sells.</div>
            )}
            {packages.length > 0 && (
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", alignItems: "stretch" }}>
                {packages.map(([d, i]) => (
                  <ProductRow key={d.uid} draft={d} onChange={(next) => update(i, next)} onRemove={() => remove(i)} />
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="mono-cap" style={{ color: "var(--fg-4)" }}>Recurring add-ons</div>
            {addons.length === 0 && (
              <div style={{ fontFamily: "var(--f-body)", fontSize: 12.5, color: "var(--fg-4)" }}>No add-ons — optional extras like care plans or SEO retainers go here.</div>
            )}
            {addons.length > 0 && (
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", alignItems: "stretch" }}>
                {addons.map(([d, i]) => (
                  <ProductRow key={d.uid} draft={d} onChange={(next) => update(i, next)} onRemove={() => remove(i)} />
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => add("package")} style={{ padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 11, textTransform: "uppercase", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)" }}>+ Package</button>
            <button type="button" onClick={() => add("addon")} style={{ padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 11, textTransform: "uppercase", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)" }}>+ Add-on</button>
            {invalidCount > 0 && (
              <span style={{ alignSelf: "center", fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--warn)" }}>
                {invalidCount} row{invalidCount === 1 ? "" : "s"} need{invalidCount === 1 ? "s" : ""} a name and a valid price to be saved.
              </span>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
