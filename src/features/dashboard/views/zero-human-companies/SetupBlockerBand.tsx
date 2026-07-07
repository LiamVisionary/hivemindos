"use client";

// Zero Human Companies — high-priority "your crew is missing a key" band.
// Lazily fetches the company's still-missing required shared-env keys (derived
// from the outreach engine's own send-blockers, filtered to keys actually absent)
// and lets the operator paste + save each one straight into the shared hive env —
// the same connect-once flow as the usepod key input. On save the value goes to
// the shared env via POST /api/env (hive-env-add), and the card collapses away.
import React from "react";
import { AlertTriangle, Check, ExternalLink, KeyRound } from "lucide-react";
import { isExternalHttpUrl, openExternalUrl } from "@/lib/native/open-external-url";
import { Spinner } from "./primitives";

type SetupBlocker = {
  envKey: string;
  title: string;
  explanation: string;
  kind: "secret" | "text";
  placeholder: string;
  links: { label: string; url: string }[];
};

function SetupBlockerCard({ blocker, onResolved }: { blocker: SetupBlocker; onResolved: (envKey: string) => void }) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [done, setDone] = React.useState(false); // saved → show the check
  const [leaving, setLeaving] = React.useState(false); // collapse animation
  const [openingUrl, setOpeningUrl] = React.useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: "shared", key: blocker.envKey, value: trimmed }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || data?.ok === false) {
        setError(data?.error || "Couldn't save the key to the shared hive env.");
        setBusy(false);
        return;
      }
      // Saved. Flash the check, then collapse and tell the parent to drop it.
      setDone(true);
      setValue("");
      window.setTimeout(() => setLeaving(true), 650);
      window.setTimeout(() => onResolved(blocker.envKey), 1050);
    } catch {
      setError("Couldn't reach the env service. Try again.");
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        overflow: "hidden",
        maxHeight: leaving ? 0 : 600,
        opacity: leaving ? 0 : 1,
        marginBottom: leaving ? 0 : 10,
        transform: leaving ? "translateX(10px)" : "none",
        transition: "max-height 400ms ease, opacity 300ms ease, transform 300ms ease, margin 400ms ease",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          borderRadius: 11,
          padding: "12px 13px",
          border: `1px solid color-mix(in srgb, var(--${done ? "cyan" : "danger"}) 40%, var(--line))`,
          background: `color-mix(in srgb, var(--${done ? "cyan" : "danger"}) 8%, var(--bg-2))`,
          transition: "border 300ms ease, background 300ms ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span aria-hidden style={{ marginTop: 1, color: done ? "var(--cyan-2)" : "var(--danger-2)" }}>
            {done ? <Check size={16} /> : <AlertTriangle size={16} />}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 8.5, letterSpacing: 0.05, textTransform: "uppercase", color: "var(--danger-2)", border: "1px solid color-mix(in srgb, var(--danger) 45%, var(--line))", borderRadius: 5, padding: "1px 6px" }}>
                Action needed
              </span>
              <span style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{blocker.title}</span>
            </span>
            <span style={{ display: "block", marginTop: 5, fontSize: 11.8, lineHeight: 1.5, color: "var(--fg-3)", overflowWrap: "anywhere" }}>{blocker.explanation}</span>
          </span>
        </div>

        {blocker.links.length > 0 && !done ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingLeft: 26 }}>
            {blocker.links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => { if (isExternalHttpUrl(link.url)) { event.preventDefault(); setOpeningUrl(link.url); void openExternalUrl(link.url).finally(() => setOpeningUrl((current) => (current === link.url ? null : current))); } }}
                aria-busy={openingUrl === link.url}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", textDecoration: "none", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 9px" }}
              >
                {openingUrl === link.url ? <Spinner size={12} /> : <ExternalLink size={12} aria-hidden />} {openingUrl === link.url ? "Opening…" : link.label}
              </a>
            ))}
          </div>
        ) : null}

        {done ? (
          <div style={{ paddingLeft: 26, fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--cyan-2)", display: "flex", alignItems: "center", gap: 6 }}>
            <Check size={13} aria-hidden /> Saved — your crew can resume.
          </div>
        ) : (
          <form onSubmit={save} style={{ paddingLeft: 26, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 200, border: "1px solid var(--line-2)", borderRadius: 8, background: "var(--bg-2)", padding: "0 10px" }}>
                <KeyRound size={13} aria-hidden style={{ color: "var(--fg-4)", flexShrink: 0 }} />
                <input
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  type={blocker.kind === "secret" ? "password" : "text"}
                  placeholder={blocker.placeholder}
                  aria-label={`Value for ${blocker.envKey}`}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  style={{ flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: "var(--fg)", font: "inherit", fontFamily: "var(--f-mono)", fontSize: 11.5, padding: "8px 0" }}
                />
              </label>
              <button
                type="submit"
                disabled={busy || !value.trim()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: busy || !value.trim() ? "default" : "pointer",
                  borderRadius: 8,
                  padding: "7px 12px",
                  font: "inherit",
                  fontFamily: "var(--f-mono)",
                  fontSize: 11,
                  fontWeight: 700,
                  border: "1px solid var(--cyan)",
                  background: "var(--cyan)",
                  color: "var(--bg)",
                  opacity: busy || !value.trim() ? 0.55 : 1,
                }}
              >
                {busy ? <Spinner size={13} /> : <Check size={13} aria-hidden />} {busy ? "Saving" : "Save & resume"}
              </button>
            </div>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>
              Saved to <code style={{ color: "var(--fg-3)" }}>{blocker.envKey}</code> in the shared hive env.{" "}
              {blocker.kind === "secret" ? "The value is never shown on the task or in chat." : "Shared across your fleet."}
            </span>
            {error ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--danger-2)" }}>{error}</span> : null}
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * The band: fetches missing required keys for a company and renders one save-card
 * each. Additive and self-clearing — renders nothing when nothing is blocked, and
 * a card removes itself once its key is saved.
 */
export function SetupBlockerBand({ companyId }: { companyId: string }) {
  const [blockers, setBlockers] = React.useState<SetupBlocker[]>([]);
  const [resolved, setResolved] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/setup-blockers`, { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; blockers?: SetupBlocker[] } | null;
        if (!alive || !res.ok || data?.ok === false || !Array.isArray(data?.blockers)) return;
        setBlockers(data.blockers);
      } catch {
        // Additive band — if the lookup fails, just render nothing.
      }
    })();
    return () => {
      alive = false;
    };
  }, [companyId]);

  const visible = blockers.filter((blocker) => !resolved.has(blocker.envKey));
  if (visible.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", marginBottom: 4 }}>
      {visible.map((blocker) => (
        <SetupBlockerCard key={blocker.envKey} blocker={blocker} onResolved={(envKey) => setResolved((current) => new Set(current).add(envKey))} />
      ))}
    </div>
  );
}
