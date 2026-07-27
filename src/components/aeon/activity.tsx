"use client";

import * as React from "react";
import { Btn, Card, Icon, Pill, SectionHead, TONE, type Tone, aeonStyles as styles } from "./parts";
import { type AeonOutput, type AeonRun } from "./aeon-data";
import { Spinner } from "@/features/dashboard/views/zero-human-companies/primitives";

type RunLogState = { loading?: boolean; text?: string; error?: string };

function RunRow({ run, open, log, onOpen }: { run: AeonRun; open: boolean; log?: RunLogState; onOpen: (id: string | null) => void }) {
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
          <Btn size="sm" variant="ghost" icon={log?.loading ? undefined : "file"} onClick={() => onOpen(open ? null : run.id)}>{log?.loading ? <><Spinner />Loading</> : "Logs"}</Btn>
        </div>
      </div>
      {open && (
        <pre className={styles.scroll} style={{ margin: 0, padding: "12px 14px", maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap",
          fontSize: 11.5, lineHeight: 1.65, fontFamily: "var(--f-mono)", color: log?.error ? "var(--danger-2)" : "var(--fg-3)", background: "rgba(2,6,23,0.5)", borderTop: "1px solid var(--line)" }}>{log?.error || log?.text || (log?.loading ? "" : "No run log was returned.")}</pre>
      )}
    </div>
  );
}

export function AeonActivity({ runs, outputs, onLoadRunLog }: { runs: AeonRun[]; outputs: AeonOutput[]; onLoadRunLog?: (runId: string) => Promise<string> }) {
  const [openRun, setOpenRun] = React.useState<string | null>(null);
  const [logs, setLogs] = React.useState<Record<string, RunLogState>>({});
  const ok = runs.filter((r) => r.status === "completed").length;
  const fail = runs.filter((r) => r.status === "failed").length;
  const openLog = React.useCallback((runId: string | null) => {
    setOpenRun(runId);
    if (!runId || logs[runId] || !onLoadRunLog) return;
    setLogs((current) => ({ ...current, [runId]: { loading: true } }));
    void onLoadRunLog(runId).then(
      (text) => setLogs((current) => ({ ...current, [runId]: { text } })),
      (error) => setLogs((current) => ({ ...current, [runId]: { error: error instanceof Error ? error.message : "Could not load the AEON run log." } })),
    );
  }, [logs, onLoadRunLog]);
  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
      <Card>
        <SectionHead eyebrow="Runs" title="Recent runs" icon="activity"
          action={<div style={{ display: "flex", gap: 6 }}><Pill tone="green">{ok} ok</Pill><Pill tone="rose">{fail} failed</Pill></div>} />
        <div className={styles.scroll} style={{ display: "grid", gap: 8, maxHeight: 560, overflow: "auto", paddingRight: 4 }}>
          {runs.map((r) => <RunRow key={r.id} run={r} open={openRun === r.id} log={logs[r.id]} onOpen={openLog} />)}
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
