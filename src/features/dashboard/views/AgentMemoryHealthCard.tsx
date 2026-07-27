"use client";

import { useCallback, useEffect, useState } from "react";
import { BrainCircuit } from "lucide-react";

import { createStyleClass } from "@/features/dashboard/style-classes";
import brainServiceStyles from "./brain-services.module.css";

const brainClass = createStyleClass(brainServiceStyles);

type MemoryHealth = {
  memories: {
    total: number;
    active: number;
    byStatus: Record<string, number>;
    evolvedChains: number;
    neverRetrievedActive: number;
  };
  usage: { retrievedTotal: number; finalAnswerTotal: number; retrievalsFile: { bytes: number; lines: number } };
  indexes: {
    memoryIndex: { lines: number; bloatFactor: number };
    fullVaultIndex: { exists: boolean; ageMs: number | null; stale: boolean; indexed: number; syncConflictEntries: number } | null;
    embeddings: { config: { enabled: boolean }; covered: number; records: number } | null;
  };
  proofs: { mode: string; gitlawbCliInstalled: boolean };
  duplicatePressure: { groups: number; largestGroup: number; affectedMemories: number };
};

type ConsolidationSummary = { duplicateGroups: number; archiveCandidates: number; wikiCandidates: number; firstHint?: string };

function formatAge(ageMs: number | null | undefined) {
  if (ageMs === null || ageMs === undefined) return "never built";
  const hours = ageMs / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(ageMs / 60_000))}m old`;
  if (hours < 48) return `${Math.round(hours)}h old`;
  return `${Math.round(hours / 24)}d old`;
}

/**
 * Self-contained brain-service card for typed Agent Memory observability:
 * corpus counts, index bloat, full-vault index staleness, usage signal,
 * duplicate pressure, and a one-click report-only consolidation run. Fetches
 * its own state via /api/brain/memory (mode=health / action=consolidate).
 */
export function AgentMemoryHealthCard() {
  const [health, setHealth] = useState<MemoryHealth | null>(null);
  const [consolidation, setConsolidation] = useState<ConsolidationSummary | null>(null);
  const [busy, setBusy] = useState<"health" | "consolidate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy("health");
    try {
      const res = await fetch("/api/brain/memory?mode=health", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (json.ok) {
        setHealth(json as MemoryHealth);
        setError(null);
      } else {
        setError(json.error || "Memory health unavailable.");
      }
    } catch {
      setError("Could not reach the shared-brain memory API.");
    } finally {
      setBusy(null);
    }
  }, []);

  const runConsolidation = useCallback(async () => {
    setBusy("consolidate");
    try {
      const res = await fetch("/api/brain/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "consolidate" }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.ok) {
        setConsolidation({
          duplicateGroups: json.duplicateGroups?.length ?? 0,
          archiveCandidates: json.archiveCandidates?.length ?? 0,
          wikiCandidates: json.wikiCandidates?.length ?? 0,
          firstHint: json.duplicateGroups?.[0]?.evolveHint,
        });
        setError(null);
      } else {
        setError(json.error || "Consolidation failed.");
      }
    } catch {
      setError("Could not reach the shared-brain memory API.");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initial);
  }, [refresh]);

  const stale = Boolean(health?.indexes.fullVaultIndex?.stale);
  const duplicates = health?.duplicatePressure.groups ?? 0;
  const healthy = Boolean(health) && !stale && duplicates === 0;

  return (
    <article className={brainClass("brainServiceOverviewCard", healthy ? "live" : "idle")}>
      <div className={brainClass("brainServiceOverviewTopline")}>
        <span className={brainClass("brainServiceOverviewIcon")}><BrainCircuit aria-hidden="true" /></span>
        <small className={brainClass(healthy ? "serviceBadgeLive" : "serviceBadgeIdle")}>
          {health ? `${health.memories.active} active` : "checking"}
        </small>
      </div>
      <div>
        <small>Typed memory</small>
        <h4>Agent Memory health</h4>
        <p>Corpus, index freshness, duplicate pressure, and usage signal for the shared brain&rsquo;s typed memory layer.</p>
      </div>

      {error ? <p style={{ fontSize: 12, color: "var(--rose-2,#fb7185)" }}>{error}</p> : null}

      {health ? (
        <p className={brainClass("skillSecurityStatus")}>
          {health.memories.total} memories ({health.memories.byStatus.superseded ?? 0} superseded, {health.memories.evolvedChains} chains)
          {" · "}index bloat ×{health.indexes.memoryIndex.bloatFactor}
          {" · "}full-vault index {health.indexes.fullVaultIndex ? `${formatAge(health.indexes.fullVaultIndex.ageMs)}${health.indexes.fullVaultIndex.stale ? " (stale)" : ""}` : "missing"}
          {health.indexes.fullVaultIndex?.syncConflictEntries ? ` · ${health.indexes.fullVaultIndex.syncConflictEntries} sync-conflict entries` : ""}
          {" · "}usage {health.usage.retrievedTotal} retrieved / {health.usage.finalAnswerTotal} cited
          {" · "}{duplicates ? `${duplicates} near-duplicate group${duplicates === 1 ? "" : "s"}` : "no duplicate pressure"}
          {" · "}embeddings {health.indexes.embeddings?.config.enabled ? `${health.indexes.embeddings.covered}/${health.indexes.embeddings.records}` : "off"}
          {" · "}proofs {health.proofs.mode}{health.proofs.mode !== "off" && !health.proofs.gitlawbCliInstalled ? " (GitLawb not installed)" : ""}
        </p>
      ) : (
        <p className={brainClass("skillSecurityStatus")}>Reading memory health…</p>
      )}

      {consolidation ? (
        <p className={brainClass("skillSecurityStatus")}>
          Consolidation report: {consolidation.duplicateGroups} merge group{consolidation.duplicateGroups === 1 ? "" : "s"},{" "}
          {consolidation.archiveCandidates} stale archive candidate{consolidation.archiveCandidates === 1 ? "" : "s"},{" "}
          {consolidation.wikiCandidates} wiki candidate{consolidation.wikiCandidates === 1 ? "" : "s"}.
          {consolidation.firstHint ? <><br /><code style={{ fontSize: 11 }}>{consolidation.firstHint}</code></> : null}
        </p>
      ) : null}

      <div className={brainClass("skillSecurityPills")}>
        <button type="button" className={brainClass("skillSecurityPill")} disabled={busy !== null} onClick={() => void refresh()}>
          {busy === "health" ? "Checking…" : "Refresh"}
        </button>
        <button type="button" className={brainClass("skillSecurityPill")} disabled={busy !== null} onClick={() => void runConsolidation()}>
          {busy === "consolidate" ? "Analyzing…" : "Consolidation report"}
        </button>
      </div>
    </article>
  );
}
