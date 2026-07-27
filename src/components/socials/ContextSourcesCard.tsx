"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { useSocialsDesk, type SocialsAccountView, type SocialsNewContextSource } from "@/components/socials/socials-context";
import { SocialsSpinner } from "@/components/socials/skeletons";
import type { SocialContextSourceKind } from "@/lib/services/socials/socials-types";

const KIND_OPTIONS: Array<{ kind: SocialContextSourceKind; label: string; placeholder: string }> = [
  { kind: "github", label: "GitHub repo", placeholder: "https://github.com/owner/repo" },
  { kind: "website", label: "Website", placeholder: "https://example.com" },
  { kind: "x-account", label: "X account", placeholder: "@handle" },
  { kind: "local-folder", label: "Local folder", placeholder: "/absolute/path/to/folder" },
  { kind: "local-file", label: "Local file", placeholder: "/absolute/path/to/file.md" },
];

type DraftRow = { kind: SocialContextSourceKind; ref: string; note: string };

const emptyRow = (): DraftRow => ({ kind: "github", ref: "", note: "" });

/**
 * Context sources the drafting agent pulls from for this account. Multi-add by
 * design: several rows (3 githubs, 4 websites, …) save in one action.
 */
export function ContextSourcesCard({ account }: { account: SocialsAccountView }) {
  const desk = useSocialsDesk();
  const [adding, setAdding] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);

  const validRows = rows.filter((row) => row.ref.trim().length > 0);

  const saveAll = async () => {
    if (!validRows.length) return;
    setSaving(true);
    try {
      const sources: SocialsNewContextSource[] = validRows.map((row) => ({
        kind: row.kind,
        ref: row.ref.trim(),
        ...(row.note.trim() ? { note: row.note.trim() } : {}),
      }));
      await desk.addContextSources(account.id, sources);
      setRows([emptyRow()]);
      setAdding(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="sc-card">
      <div className="sc-card-head">
        <span className="sc-card-title">Context sources</span>
        <span className="sc-card-hint">What the drafting agent reads before writing for this account</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {account.contextSources.length === 0 && !adding ? (
          <div className="sc-note">No sources yet. Add repos, sites, X accounts, or local paths the agent should draw from.</div>
        ) : null}
        {account.contextSources.map((source) => (
          <div key={source.id} className="sc-src">
            <span className="sc-src-kind">{source.kind}</span>
            <span className="sc-src-ref">
              {source.ref}
              {source.note ? <span className="sc-src-note"> — {source.note}</span> : null}
            </span>
            <button
              type="button"
              className="sc-src-remove"
              aria-label={`Remove ${source.ref}`}
              onClick={() => void desk.removeContextSource(account.id, source.id)}
            >
              <X aria-hidden="true" width={13} height={13} />
            </button>
          </div>
        ))}
        {adding ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((row, index) => {
              const option = KIND_OPTIONS.find((candidate) => candidate.kind === row.kind) ?? KIND_OPTIONS[0];
              return (
                <div key={index} className="sc-row" style={{ alignItems: "center" }}>
                  <select
                    className="sc-select"
                    value={row.kind}
                    onChange={(event) => {
                      const next = [...rows];
                      next[index] = { ...row, kind: event.target.value as SocialContextSourceKind };
                      setRows(next);
                    }}
                  >
                    {KIND_OPTIONS.map((candidate) => (
                      <option key={candidate.kind} value={candidate.kind}>{candidate.label}</option>
                    ))}
                  </select>
                  <input
                    className="sc-input"
                    style={{ flex: 2, minWidth: 180 }}
                    placeholder={option.placeholder}
                    value={row.ref}
                    onChange={(event) => {
                      const next = [...rows];
                      next[index] = { ...row, ref: event.target.value };
                      setRows(next);
                    }}
                  />
                  <input
                    className="sc-input"
                    style={{ flex: 1, minWidth: 120 }}
                    placeholder="Note (optional)"
                    value={row.note}
                    onChange={(event) => {
                      const next = [...rows];
                      next[index] = { ...row, note: event.target.value };
                      setRows(next);
                    }}
                  />
                  {rows.length > 1 ? (
                    <button
                      type="button"
                      className="sc-src-remove"
                      aria-label="Remove row"
                      onClick={() => setRows(rows.filter((_, i) => i !== index))}
                    >
                      <X aria-hidden="true" width={13} height={13} />
                    </button>
                  ) : null}
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="sc-btn" onClick={() => setRows([...rows, emptyRow()])}>
                <Plus aria-hidden="true" width={13} height={13} /> Add another
              </button>
              <button type="button" className="sc-btn" data-tone="primary" disabled={saving || !validRows.length} onClick={() => void saveAll()}>
                {saving ? <SocialsSpinner /> : null} Save {validRows.length > 1 ? `${validRows.length} sources` : "source"}
              </button>
              <button type="button" className="sc-btn" onClick={() => { setAdding(false); setRows([emptyRow()]); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button type="button" className="sc-btn" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" width={13} height={13} /> Add context
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
