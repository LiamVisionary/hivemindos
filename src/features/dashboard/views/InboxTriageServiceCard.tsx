"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox } from "lucide-react";

import { createStyleClass } from "@/features/dashboard/style-classes";
import { Spinner } from "@/features/dashboard/views/zero-human-companies/primitives";
import "@/features/dashboard/views/zero-human-companies/theme.css";
import brainServiceStyles from "./brain-services.module.css";

const brainClass = createStyleClass(brainServiceStyles);

type TriageStatus = {
  enabled: boolean;
  reportHour: number;
  folders: string[];
  lastReportDate?: string;
  lastReportPath?: string;
  lastItemCount?: number;
  lastNewCount?: number;
};

type TriageDriver = { status: "running" | "stopped"; lastRunReason?: string; lastError?: string };

type RunSummary = { itemCount?: number; newCount?: number; reportDate?: string };

/**
 * Self-contained brain-service card for the report-only Inbox Triage service:
 * shows what the nightly capture-folder report found, runs a report on demand,
 * and toggles the service. Config truth lives in the vault service note, so
 * this card reads and writes through /api/brain/inbox-triage only.
 */
export function InboxTriageServiceCard() {
  const [status, setStatus] = useState<TriageStatus | null>(null);
  const [driver, setDriver] = useState<TriageDriver | null>(null);
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const [busy, setBusy] = useState<"status" | "run" | "toggle" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy("status");
    try {
      const res = await fetch("/api/brain/inbox-triage", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (json.ok) {
        setStatus(json.status as TriageStatus);
        setDriver(json.driver as TriageDriver);
        setError(null);
      } else {
        setError(json.error || "Inbox Triage status unavailable.");
      }
    } catch {
      setError("Could not reach the Inbox Triage API.");
    } finally {
      setBusy(null);
    }
  }, []);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/brain/inbox-triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json().catch(() => ({}));
  }, []);

  const runNow = useCallback(async () => {
    setBusy("run");
    try {
      const json = await post({ action: "run" });
      if (json.ok) {
        setLastRun(json.result as RunSummary);
        setError(null);
      } else {
        setError(json.error || "Inbox Triage run failed.");
      }
    } catch {
      setError("Could not reach the Inbox Triage API.");
    } finally {
      setBusy(null);
      void refresh();
    }
  }, [post, refresh]);

  const toggle = useCallback(async () => {
    if (!status) return;
    setBusy("toggle");
    try {
      const json = await post({ action: "configure", enabled: !status.enabled });
      if (json.ok) setError(null);
      else setError(json.error || "Could not update Inbox Triage.");
    } catch {
      setError("Could not reach the Inbox Triage API.");
    } finally {
      setBusy(null);
      void refresh();
    }
  }, [post, refresh, status]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initial);
  }, [refresh]);

  const live = Boolean(status?.enabled && status.folders.length);

  return (
    <article className={brainClass("brainServiceOverviewCard", live ? "live" : "idle")}>
      <div className={brainClass("brainServiceOverviewTopline")}>
        <span className={brainClass("brainServiceOverviewIcon")}><Inbox aria-hidden="true" /></span>
        <small className={brainClass(live ? "serviceBadgeLive" : "serviceBadgeIdle")}>
          {status ? (status.enabled ? "On" : "Off") : "checking"}
        </small>
      </div>
      <div>
        <small>Capture triage</small>
        <h4>Inbox Triage</h4>
        <p>
          Nightly report-only pass over the vault&rsquo;s capture folders: every item gets a
          proposed rail (Work Board, Ideas, Agent Memory, Syntho candidate) without anything
          being moved or changed.
        </p>
      </div>

      {error ? <p style={{ fontSize: 12, color: "var(--rose-2,#fb7185)" }}>{error}</p> : null}

      {status ? (
        <p className={brainClass("skillSecurityStatus")}>
          {status.folders.length
            ? `Watching ${status.folders.join(" + ")} · daily report after ${String(status.reportHour).padStart(2, "0")}:00`
            : "No capture folders found in this vault — create Inbox/ or the configured intake folder."}
          {status.lastReportDate
            ? ` · last report ${status.lastReportDate}${typeof status.lastItemCount === "number" ? ` (${status.lastItemCount} items, ${status.lastNewCount ?? 0} new)` : ""}`
            : " · no report yet"}
          {driver ? ` · driver ${driver.status}${driver.lastError ? ` (${driver.lastError})` : ""}` : ""}
        </p>
      ) : (
        <p className={brainClass("skillSecurityStatus")} role="status" aria-label="Loading Inbox Triage status">
          <Spinner /> Reading Inbox Triage status
        </p>
      )}

      {lastRun ? (
        <p className={brainClass("skillSecurityStatus")}>
          Report generated for {lastRun.reportDate}: {lastRun.itemCount ?? 0} item{(lastRun.itemCount ?? 0) === 1 ? "" : "s"},{" "}
          {lastRun.newCount ?? 0} new. Open it in the vault under Brain Services → Inbox Triage.
        </p>
      ) : null}

      <div className={brainClass("skillSecurityPills")}>
        <button type="button" className={brainClass("skillSecurityPill")} disabled={busy !== null} onClick={() => void refresh()}>
          {busy === "status" ? <Spinner /> : null} Refresh
        </button>
        <button type="button" className={brainClass("skillSecurityPill")} disabled={busy !== null || !status} onClick={() => void runNow()}>
          {busy === "run" ? <Spinner /> : null} Run report now
        </button>
        <button type="button" className={brainClass("skillSecurityPill")} disabled={busy !== null || !status} onClick={() => void toggle()}>
          {busy === "toggle" ? <Spinner /> : null} {status?.enabled ? "Disable" : "Enable"}
        </button>
      </div>
    </article>
  );
}
