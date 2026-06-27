"use client";
import { useCallback, useEffect, useState } from "react";
import type { FlowEdge, FlowNode, FlowRunState, FlowSpec } from "@/lib/types/agent-flow";

// Self-contained flow builder: browse/edit/save agent-flow templates (nodes + conditional edges),
// start runs, and resolve human-in-the-loop approvals. Fetches its own data from /api/queen-bee/flow.

interface FlowBuilderModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = "templates" | "editor" | "runs";

const BLANK_SPEC = (): FlowSpec => ({
  id: `flow-${Math.random().toString(36).slice(2, 8)}`,
  name: "New flow",
  description: "",
  start: "research",
  nodes: [{ id: "research", kind: "task", title: "Research", workerClass: "research", prompt: "Research {{state.topic}}." }],
  edges: [{ from: "research", to: "DONE", when: { on: "success" } }],
});

const box: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 8, background: "var(--panel-bg-soft)", color: "var(--fg-1)", padding: "6px 8px" };

export function FlowBuilderModal({ open, onClose }: FlowBuilderModalProps) {
  const [tab, setTab] = useState<Tab>("templates");
  const [templates, setTemplates] = useState<FlowSpec[]>([]);
  const [runs, setRuns] = useState<FlowRunState[]>([]);
  const [spec, setSpec] = useState<FlowSpec | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [t, r] = await Promise.all([
        fetch("/api/queen-bee/flow?action=list-templates").then((x) => x.json()),
        fetch("/api/queen-bee/flow?action=list-runs").then((x) => x.json()),
      ]);
      if (t?.ok) setTemplates(t.templates as FlowSpec[]);
      if (r?.ok) setRuns(r.runs as FlowRunState[]);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to load flows.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const patchSpec = (p: Partial<FlowSpec>) => setSpec((s) => (s ? { ...s, ...p } : s));
  const patchNode = (i: number, p: Partial<FlowNode>) => setSpec((s) => (s ? { ...s, nodes: s.nodes.map((n, j) => (j === i ? { ...n, ...p } : n)) } : s));
  const patchEdge = (i: number, p: Partial<FlowEdge>) => setSpec((s) => (s ? { ...s, edges: s.edges.map((e, j) => (j === i ? { ...e, ...p } : e)) } : s));
  const nodeIds = spec ? spec.nodes.map((n) => n.id) : [];

  const save = async () => {
    if (!spec) return;
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/queen-bee/flow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-template", spec }) }).then((x) => x.json());
      setStatus(res?.ok ? "Saved." : `Save failed: ${res?.error ?? ""}`);
      if (res?.ok) await refresh();
    } finally {
      setBusy(false);
    }
  };

  const start = async (s: FlowSpec) => {
    const topic = window.prompt("Topic / goal for this run?", "");
    if (topic === null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/queen-bee/flow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", spec: s, state: { topic, goal: topic } }) }).then((x) => x.json());
      setStatus(res?.ok ? `Started run ${res.run.runId}.` : `Start failed: ${res?.error ?? ""}`);
      if (res?.ok) { setTab("runs"); await refresh(); }
    } finally {
      setBusy(false);
    }
  };

  const resolveApproval = async (runId: string, approved: boolean) => {
    setBusy(true);
    try {
      await fetch("/api/queen-bee/flow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resolve-approval", runId, approved }) });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const tabBtn = (id: Tab, label: string) => (
    <button type="button" onClick={() => setTab(id)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: tab === id ? "var(--aeon-soft)" : "transparent", color: tab === id ? "var(--cyan-3)" : "var(--fg-2)", cursor: "pointer" }}>{label}</button>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Flow builder" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(920px, 96vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", borderRadius: 14, border: "1px solid var(--line)", background: "var(--panel-bg)", color: "var(--fg-1)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
          <strong>Agent flows</strong>
          {tabBtn("templates", "Templates")}
          {spec ? tabBtn("editor", "Editor") : null}
          {tabBtn("runs", `Runs${runs.length ? ` (${runs.length})` : ""}`)}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--fg-3)" }}>{busy ? "…" : status}</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: "var(--fg-2)", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ overflowY: "auto", padding: 16 }}>
          {tab === "templates" && (
            <div style={{ display: "grid", gap: 8 }}>
              <button type="button" onClick={() => { setSpec(BLANK_SPEC()); setTab("editor"); }} style={{ ...box, cursor: "pointer", textAlign: "left", borderStyle: "dashed", color: "var(--cyan-3)" }}>+ New flow</button>
              {templates.map((t) => (
                <div key={t.id} style={{ ...box, display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{t.description} · {t.nodes.length} nodes · {t.edges.length} edges</div>
                  </div>
                  <button type="button" onClick={() => { setSpec(structuredClone(t)); setTab("editor"); }} style={{ ...box, cursor: "pointer" }}>Edit</button>
                  <button type="button" onClick={() => void start(t)} style={{ ...box, cursor: "pointer", color: "var(--cyan-3)" }}>Start</button>
                </div>
              ))}
            </div>
          )}

          {tab === "editor" && spec && (
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={spec.name} onChange={(e) => patchSpec({ name: e.target.value })} placeholder="Flow name" style={{ ...box, flex: 1, minWidth: 200 }} />
                <select value={spec.start} onChange={(e) => patchSpec({ start: e.target.value })} style={box} title="Start node">
                  {nodeIds.map((id) => <option key={id} value={id}>start: {id}</option>)}
                </select>
              </div>
              <input value={spec.description ?? ""} onChange={(e) => patchSpec({ description: e.target.value })} placeholder="Description" style={box} />

              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <strong style={{ fontSize: 13 }}>Nodes</strong>
                  <button type="button" onClick={() => patchSpec({ nodes: [...spec.nodes, { id: `node-${spec.nodes.length + 1}`, kind: "task", title: "Step" }] })} style={{ ...box, cursor: "pointer" }}>+ Node</button>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {spec.nodes.map((n, i) => (
                    <div key={i} style={{ ...box, display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <input value={n.id} onChange={(e) => patchNode(i, { id: e.target.value })} placeholder="id" style={{ ...box, width: 130 }} />
                        <select value={n.kind} onChange={(e) => patchNode(i, { kind: e.target.value as FlowNode["kind"] })} style={box}>
                          <option value="task">task</option>
                          <option value="approval">approval (HITL)</option>
                        </select>
                        <input value={n.title} onChange={(e) => patchNode(i, { title: e.target.value })} placeholder="title" style={{ ...box, flex: 1, minWidth: 120 }} />
                        {n.kind === "task" && <input value={n.workerClass ?? ""} onChange={(e) => patchNode(i, { workerClass: e.target.value })} placeholder="worker class" style={{ ...box, width: 130 }} />}
                        <button type="button" onClick={() => patchSpec({ nodes: spec.nodes.filter((_, j) => j !== i) })} style={{ ...box, cursor: "pointer", color: "var(--red-3, #f88)" }}>✕</button>
                      </div>
                      <textarea value={n.kind === "approval" ? (n.approvalPrompt ?? "") : (n.prompt ?? "")} onChange={(e) => patchNode(i, n.kind === "approval" ? { approvalPrompt: e.target.value } : { prompt: e.target.value })} placeholder={n.kind === "approval" ? "Approval question (use {{output.<node>}})" : "Task prompt (use {{state.topic}}, {{last}}, {{output.<node>}})"} rows={2} style={{ ...box, width: "100%", resize: "vertical", fontFamily: "inherit" }} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <strong style={{ fontSize: 13 }}>Edges</strong>
                  <button type="button" onClick={() => patchSpec({ edges: [...spec.edges, { from: nodeIds[0] ?? "", to: "DONE", when: { on: "success" } }] })} style={{ ...box, cursor: "pointer" }}>+ Edge</button>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {spec.edges.map((e, i) => (
                    <div key={i} style={{ ...box, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <select value={e.from} onChange={(ev) => patchEdge(i, { from: ev.target.value })} style={box}>{nodeIds.map((id) => <option key={id} value={id}>{id}</option>)}</select>
                      <span style={{ color: "var(--fg-3)" }}>→</span>
                      <select value={e.to} onChange={(ev) => patchEdge(i, { to: ev.target.value })} style={box}>{[...nodeIds, "DONE", "FAIL"].map((id) => <option key={id} value={id}>{id}</option>)}</select>
                      <select value={e.when.on} onChange={(ev) => patchEdge(i, { when: ev.target.value === "score" ? { on: "score", lt: 0.7 } : { on: ev.target.value as "success" | "failure" | "always" } })} style={box}>
                        <option value="success">on success</option>
                        <option value="failure">on failure</option>
                        <option value="score">on score</option>
                        <option value="always">always</option>
                      </select>
                      {e.when.on === "score" && (
                        <>
                          <input type="number" step="0.05" value={e.when.lt ?? ""} onChange={(ev) => patchEdge(i, { when: { on: "score", lt: ev.target.value === "" ? undefined : Number(ev.target.value), gte: e.when.on === "score" ? e.when.gte : undefined } })} placeholder="< lt" style={{ ...box, width: 80 }} />
                          <input type="number" step="0.05" value={e.when.gte ?? ""} onChange={(ev) => patchEdge(i, { when: { on: "score", gte: ev.target.value === "" ? undefined : Number(ev.target.value), lt: e.when.on === "score" ? e.when.lt : undefined } })} placeholder=">= gte" style={{ ...box, width: 80 }} />
                        </>
                      )}
                      <button type="button" onClick={() => patchSpec({ edges: spec.edges.filter((_, j) => j !== i) })} style={{ ...box, cursor: "pointer", color: "var(--red-3, #f88)", marginLeft: "auto" }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" disabled={busy} onClick={() => void save()} style={{ ...box, cursor: "pointer" }}>Save template</button>
                <button type="button" disabled={busy} onClick={() => void start(spec)} style={{ ...box, cursor: "pointer", color: "var(--cyan-3)" }}>Save-less start</button>
              </div>
            </div>
          )}

          {tab === "runs" && (
            <div style={{ display: "grid", gap: 8 }}>
              <button type="button" onClick={() => void refresh()} style={{ ...box, cursor: "pointer", width: 100 }}>Refresh</button>
              {runs.length === 0 && <div style={{ color: "var(--fg-3)", padding: 12 }}>No runs yet.</div>}
              {runs.map((r) => (
                <div key={r.runId} style={{ ...box, display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{r.flowName} <span style={{ fontSize: 11, color: "var(--fg-3)" }}>· {r.runId}</span></div>
                    <div style={{ fontSize: 12, color: "var(--fg-3)" }}>status: {r.status} · node: {r.currentNodeId ?? "—"} · {r.stepCount} steps</div>
                  </div>
                  {r.status === "awaiting-human" && (
                    <>
                      <button type="button" disabled={busy} onClick={() => void resolveApproval(r.runId, true)} style={{ ...box, cursor: "pointer", color: "var(--cyan-3)" }}>Approve</button>
                      <button type="button" disabled={busy} onClick={() => void resolveApproval(r.runId, false)} style={{ ...box, cursor: "pointer", color: "var(--red-3, #f88)" }}>Reject</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
