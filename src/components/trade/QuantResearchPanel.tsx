"use client";

import React from "react";
import type { QuantResearchRunManifest } from "@/lib/types/quant-research";
import {
  fetchQuantResearchRuns,
  runTradeQuantResearch,
} from "@/features/dashboard/views/trade/trade-api";
import { BBtn } from "./primitives";
import { BIcon } from "./icons";

function newestFirst(runs: QuantResearchRunManifest[]) {
  return [...runs].sort((left, right) => right.completedAt.localeCompare(left.completedAt));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatRunTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function QuantResearchPanel() {
  const requestInput = React.useRef<HTMLInputElement>(null);
  const [runs, setRuns] = React.useState<QuantResearchRunManifest[]>([]);
  const [selectedRunId, setSelectedRunId] = React.useState("");
  const [historyLoading, setHistoryLoading] = React.useState(true);
  const [runBusy, setRunBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const loadRuns = async () => {
    setHistoryLoading(true);
    const response = await fetchQuantResearchRuns();
    setHistoryLoading(false);
    if (!response.ok) {
      setError(response.error || "Recent quant research runs could not be loaded.");
      return;
    }
    setRuns(newestFirst(response.runs ?? []));
  };

  React.useEffect(() => {
    let cancelled = false;
    void fetchQuantResearchRuns().then((response) => {
      if (cancelled) return;
      setHistoryLoading(false);
      if (!response.ok) {
        setError(response.error || "Recent quant research runs could not be loaded.");
        return;
      }
      setRuns(newestFirst(response.runs ?? []));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const runRequest = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    setRunBusy(true);
    setError("");
    try {
      const request: unknown = JSON.parse(await file.text());
      if (!isRecord(request) || request.schemaVersion !== 1 || request.researchOnly !== true) {
        throw new Error("Choose a reviewed schema-version 1 research-only JSON request.");
      }
      const response = await runTradeQuantResearch(request);
      if (!response.ok || !response.run) {
        throw new Error(response.error || "The quant research run did not return a manifest.");
      }
      setRuns((current) => newestFirst([
        response.run as QuantResearchRunManifest,
        ...current.filter((run) => run.runId !== response.run?.runId),
      ]));
      setSelectedRunId(response.run.runId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The reviewed request could not be run.");
    } finally {
      setRunBusy(false);
    }
  };

  const selectedRun = runs.find((run) => run.runId === selectedRunId) ?? runs[0] ?? null;

  return (
    <div className="tk-quant">
      <input
        ref={requestInput}
        className="tk-quant-file"
        type="file"
        accept="application/json,.json"
        onChange={runRequest}
        tabIndex={-1}
        aria-hidden="true"
      />
      <p className="tk-quant-note">
        Choose a reviewed request file to run its full candidate family through lagged Rust backtests and independent Python validation. The run writes local evidence only; live trading stays disabled and no order, wallet action, or recommendation is created.
      </p>
      <div className="sf">
        <span className="hint">reviewed JSON · local artifacts · research only</span>
        <BBtn
          variant="primary"
          sm
          disabled={runBusy}
          onClick={() => requestInput.current?.click()}
        >
          <BIcon name={runBusy ? "spinner" : "doc"} size={14} spin={runBusy} />
          {runBusy ? "Running research" : "Run reviewed request"}
        </BBtn>
      </div>

      {error ? <p className="tk-error" role="alert">{error}</p> : null}

      {selectedRun ? <QuantRunEvidence run={selectedRun} /> : null}

      <div className="tk-quant-runs">
        <div className="tk-quant-runs-head">
          <div>
            <b>Recent local runs</b>
            <span>Append-only manifests from this machine</span>
          </div>
          <BBtn variant="ghost" sm disabled={historyLoading} onClick={() => void loadRuns()}>
            <BIcon name={historyLoading ? "spinner" : "refresh"} size={13} spin={historyLoading} />
            {historyLoading ? "Loading" : "Refresh"}
          </BBtn>
        </div>
        {!historyLoading && runs.length === 0 ? (
          <p className="tk-quant-empty">No local quant research runs yet.</p>
        ) : (
          <div className="tk-quant-run-list">
            {runs.slice(0, 8).map((run) => (
              <button
                key={run.runId}
                type="button"
                data-active={selectedRun?.runId === run.runId ? "" : undefined}
                onClick={() => setSelectedRunId(run.runId)}
              >
                <span>
                  <b>{run.runId}</b>
                  <small>{run.dataset?.id || "Dataset recorded in request"} · {formatRunTime(run.completedAt)}</small>
                </span>
                <em data-status={run.status}>{run.status}</em>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuantRunEvidence({ run }: { run: QuantResearchRunManifest }) {
  return (
    <section className="tk-quant-evidence" aria-live="polite">
      <div className="tk-quant-evidence-head">
        <span><BIcon name={run.status === "completed" ? "check" : "alert"} size={14} /></span>
        <div>
          <b>{run.status === "completed" ? "Research manifest ready" : "Research run rejected"}</b>
          <small>{run.runId}</small>
        </div>
      </div>
      <div className="tk-quant-counts">
        <span><small>Promoted for review</small><strong>{run.promotedCandidateIds.length}</strong></span>
        <span><small>Rejected</small><strong>{run.rejectedCandidateIds.length}</strong></span>
        <span><small>Audits</small><strong>{run.audits.length}</strong></span>
      </div>
      {run.failureReason ? <p className="tk-error">{run.failureReason}</p> : null}
      <div className="tk-quant-paths">
        <span>Report</span>
        <code>{run.reportPath}</code>
        <span>Manifest</span>
        <code>{run.manifestPath}</code>
      </div>
    </section>
  );
}

export default QuantResearchPanel;
