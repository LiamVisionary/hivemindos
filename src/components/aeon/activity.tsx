"use client";

import * as React from "react";
import { Btn, Card, Icon, Pill, SectionHead, TONE, type Tone, aeonStyles as styles } from "./parts";
import { RUN_LOG_SAMPLE, type AeonOutput, type AeonRun } from "./aeon-data";

function RunRow({ run, open, onOpen }: { run: AeonRun; open: boolean; onOpen: (id: string | null) => void }) {
  const tone: Tone = run.status === "completed" ? "green" : run.status === "failed" ? "rose" : "honey";
  const live = run.status === "active";
  return (
    <div style={{ borderRadius: 10, border: `1px solid ${open ? "var(--aeon-line)" : "var(--line)"}`, overflow: "hidden", background: "var(--panel-bg-soft)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", padding: "11px 13px" }}>
        <span style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 8, color: TONE[tone].fg, background: TONE[tone].bg, border: `1px solid ${TONE[tone].bd}` }}>
          {live ? <span className={styles.eq} style={{ height: 12 }}><i /><i /><i /><i /></span> : <Icon name={run.status === "failed" ? "x" : "check"} size={14} />}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg)", fontFamily: "var(--f-mono)" }}>{run.name}</div>
          <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 2 }}>{run.when} · {run.dur}{run.conclusion ? ` · ${run.conclusion}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Pill tone={tone} dot={live}>{run.status}</Pill>
          <Btn size="sm" variant="ghost" icon="file" onClick={() => onOpen(open ? null : run.id)}>Logs</Btn>
        </div>
      </div>
      {open && (
        <pre className={styles.scroll} style={{ margin: 0, padding: "12px 14px", maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap",
          fontSize: 11.5, lineHeight: 1.65, fontFamily: "var(--f-mono)", color: "var(--fg-3)", background: "rgba(2,6,23,0.5)", borderTop: "1px solid var(--line)" }}>{RUN_LOG_SAMPLE}</pre>
      )}
    </div>
  );
}

export function AeonActivity({ runs, outputs }: { runs: AeonRun[]; outputs: AeonOutput[] }) {
  const [openRun, setOpenRun] = React.useState<string | null>(null);
  const ok = runs.filter((r) => r.status === "completed").length;
  const fail = runs.filter((r) => r.status === "failed").length;
  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
      <Card>
        <SectionHead eyebrow="Runs" title="Recent runs" icon="activity"
          action={<div style={{ display: "flex", gap: 6 }}><Pill tone="green">{ok} ok</Pill><Pill tone="rose">{fail} failed</Pill></div>} />
        <div className={styles.scroll} style={{ display: "grid", gap: 8, maxHeight: 560, overflow: "auto", paddingRight: 4 }}>
          {runs.map((r) => <RunRow key={r.id} run={r} open={openRun === r.id} onOpen={setOpenRun} />)}
        </div>
      </Card>

      <Card>
        <SectionHead eyebrow="Outputs" title="Latest artifacts" icon="rocket" />
        <div className={styles.scroll} style={{ display: "grid", gap: 10, maxHeight: 560, overflow: "auto", paddingRight: 4 }}>
          {outputs.map((o) => (
            <article key={o.filename} style={{ display: "grid", gap: 8, padding: 13, borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel-bg-soft)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 9, alignItems: "center", minWidth: 0 }}>
                  <span style={{ color: "var(--aeon)" }}><Icon name="file" size={16} /></span>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg)" }}>{o.skill}</span>
                </div>
                <span style={{ fontSize: 11, color: "var(--fg-4)", fontFamily: "var(--f-mono)" }}>{o.when}</span>
              </div>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--fg-3)" }}>{o.excerpt}</p>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {[o.source, o.filename].map((tag) => (
                  <span key={tag} style={{ fontSize: 10.5, fontFamily: "var(--f-mono)", padding: "3px 8px", borderRadius: 6, background: "rgba(2,6,23,0.4)", border: "1px solid var(--line)", color: "var(--fg-4)" }}>{tag}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}
