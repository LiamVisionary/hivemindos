"use client";

import React from "react";
import { buildProofPack } from "@/lib/services/proof-pack";
import type { Issue } from "./types";
import { SectionLabel } from "./primitives";

const STATUS_TONE = {
  verified: "var(--live)",
  evaluated: "var(--cyan-2)",
  "needs-attention": "var(--danger-2)",
  unverified: "var(--honey)",
} as const;

export function ProofPackPanel({ issue }: { issue: Issue }) {
  const work = issue.work;
  if (!work) return null;
  const pack = buildProofPack({
    taskId: work.taskId,
    title: issue.title,
    result: work.result,
    deliverables: work.deliverables,
    receipts: work.receipts,
    proofs: work.proofs,
    agentName: issue.agent,
    machineName: work.machineName,
    completedAt: work.completedAt,
    updatedAt: work.updatedAt,
  });
  const tone = STATUS_TONE[pack.status];
  return (
    <details style={{ border: `1px solid color-mix(in srgb, ${tone} 38%, var(--line))`, borderRadius: 12, background: "var(--bg-2)", padding: "12px 14px" }}>
      <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span aria-hidden style={{ width: 9, height: 9, borderRadius: 999, background: tone, boxShadow: `0 0 12px color-mix(in srgb, ${tone} 45%, transparent)` }} />
        <strong style={{ fontFamily: "var(--f-display)", fontSize: 13.5 }}>{pack.headline}</strong>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: tone, textTransform: "uppercase" }}>{pack.status}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>{pack.artifacts} artifacts · {pack.checks.passed} passed · {pack.checks.evidence} evidence</span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-3)" }}>Show me why ▾</span>
      </summary>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        <div>
          <SectionLabel>confirmed by this run</SectionLabel>
          {pack.verifiedClaims.length ? <ul style={{ margin: 0, paddingLeft: 17, color: "var(--fg-2)", fontSize: 11.5, lineHeight: 1.55 }}>{pack.verifiedClaims.map((claim) => <li key={claim}>{claim}</li>)}</ul> : <div style={{ color: "var(--fg-4)", fontSize: 11.5 }}>No independently checked claim is recorded yet.</div>}
        </div>
        <div>
          <SectionLabel>unverified or incomplete</SectionLabel>
          {pack.unverifiedClaims.length ? <ul style={{ margin: 0, paddingLeft: 17, color: "var(--fg-3)", fontSize: 11.5, lineHeight: 1.55 }}>{pack.unverifiedClaims.map((claim) => <li key={claim}>{claim}</li>)}</ul> : <div style={{ color: "var(--live)", fontSize: 11.5 }}>No known verification gaps.</div>}
        </div>
      </div>
      <div style={{ marginTop: 13, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        <SectionLabel>provenance</SectionLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>{pack.provenance.map((item) => <span key={item} style={{ border: "1px solid var(--line)", borderRadius: 999, padding: "3px 8px", fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-3)", overflowWrap: "anywhere" }}>{item}</span>)}</div>
      </div>
    </details>
  );
}
