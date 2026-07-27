"use client";

import * as React from "react";
import { Cpu, Pause, Play, RefreshCcw } from "lucide-react";

import styles from "./hive-compute-host-modal.module.css";

type RemoteRunStatus = { running: boolean; logTail: string };

type RemoteActionResponse = {
  ok?: boolean;
  error?: string;
  remote?: { ok: boolean; sentinel: string };
  remoteRun?: RemoteRunStatus;
};

/**
 * Remote quick-host controls for a fleet machine viewed from another machine's
 * dashboard: pushes the worker module over the linkd file rail, installs
 * dependencies, and runs the worker there with the models discovered over the
 * collector. Advertises without exact asks (no benchmark ran on that machine);
 * full pricing setup still lives on the machine's own HivemindOS.
 */
export function HiveComputeRemoteHostControls({
  machineName,
  targetBody,
  modelCount,
}: {
  machineName: string;
  targetBody: Record<string, unknown>;
  modelCount: number;
}) {
  const [busy, setBusy] = React.useState<"golive" | "stop" | "status" | null>(null);
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState("");
  const [run, setRun] = React.useState<RemoteRunStatus | null>(null);

  const post = React.useCallback(async (action: string): Promise<RemoteActionResponse> => {
    const response = await fetch("/api/hive-compute/marketplace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, target: targetBody }),
    });
    const data = (await response.json().catch(() => ({}))) as RemoteActionResponse;
    if (!response.ok || data.ok === false) throw new Error(data.error || "Remote hosting action failed.");
    return data;
  }, [targetBody]);

  const refreshRun = React.useCallback(async () => {
    setBusy("status");
    setError("");
    try {
      const data = await post("remote-run-status");
      setRun(data.remoteRun ?? null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Remote status failed.");
    } finally {
      setBusy(null);
    }
  }, [post]);

  const goLive = React.useCallback(async () => {
    setBusy("golive");
    setError("");
    setNotice(`Installing the worker on ${machineName}…`);
    try {
      await post("remote-setup-hosting");
      setNotice(`Starting hosting on ${machineName}…`);
      await post("remote-run-worker");
      setNotice(`${machineName} is hosting. Its gateway URL and worker token come from that machine's shared hive env.`);
      const data = await post("remote-run-status");
      setRun(data.remoteRun ?? null);
    } catch (goLiveError) {
      setNotice("");
      setError(goLiveError instanceof Error ? goLiveError.message : "Remote go-live failed.");
    } finally {
      setBusy(null);
    }
  }, [machineName, post]);

  const stop = React.useCallback(async () => {
    setBusy("stop");
    setError("");
    try {
      await post("remote-stop-worker");
      setNotice(`Hosting stopped on ${machineName}.`);
      const data = await post("remote-run-status");
      setRun(data.remoteRun ?? null);
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Remote stop failed.");
    } finally {
      setBusy(null);
    }
  }, [machineName, post]);

  return (
    <section className={styles.card}>
      <span className={styles.cardKicker}>
        <Cpu size={13} aria-hidden="true" /> Remote quick-host
      </span>
      <p className={styles.detailText}>
        Rent out {machineName} from here: the worker installs over Hivemind Link and advertises the {modelCount} discovered
        model{modelCount === 1 ? "" : "s"} with conservative guardrails (idle-only, pause on battery). Exact per-model asks
        still need a benchmark on {machineName} itself.
      </p>
      {run ? (
        <p className={styles.detailText} role="status">
          {run.running ? "Hosting is running on that machine." : "Not currently hosting on that machine."}
        </p>
      ) : null}
      {run?.logTail ? <pre className={styles.outputMono}>{run.logTail}</pre> : null}
      <div className={styles.footerBtns}>
        <button type="button" className={styles.btnSecondary} onClick={() => void refreshRun()} disabled={Boolean(busy)}>
          {busy === "status" ? <span className={styles.spinner} aria-hidden="true" /> : <RefreshCcw size={14} aria-hidden="true" />}
          Check status
        </button>
        <button type="button" className={styles.btnSecondary} onClick={() => void stop()} disabled={Boolean(busy) || !run?.running}>
          {busy === "stop" ? <span className={styles.spinner} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          Stop hosting
        </button>
        <button type="button" className={styles.btnPrimary} onClick={() => void goLive()} disabled={Boolean(busy) || modelCount === 0}>
          {busy === "golive" ? <span className={styles.spinner} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          Set up &amp; go live on {machineName}
        </button>
      </div>
      {error ? (
        <p className={styles.notice} data-tone="error" role="status">{error}</p>
      ) : notice ? (
        <p className={styles.notice} data-tone="honey" role="status">{notice}</p>
      ) : null}
    </section>
  );
}
