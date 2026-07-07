import { useCallback, useEffect, useRef, useState } from "react";

import {
  mapSpendApproval,
  type ApprovalDecision,
  type SpendApprovalRaw,
  type SpendApprovalView,
} from "@/features/approvals/spend-approval-model";

export type UseSpendApprovalsOptions = {
  /** Scope to one company's approvals; omit for the whole fleet. */
  companyId?: string;
  /** Scope to one agent's approvals; omit for all agents. */
  agentId?: string;
  /** Poll interval in ms; 0/undefined disables polling (still fetches once). */
  pollMs?: number;
  /** Set false to skip fetching entirely (e.g. panel not visible). */
  enabled?: boolean;
};

export type UseSpendApprovals = {
  approvals: SpendApprovalView[];
  loading: boolean;
  error: string;
  busyId: string | null;
  refresh: () => Promise<void>;
  /** Approve/deny a pending request, with an optional human note/change. */
  decide: (id: string, decision: ApprovalDecision, note?: string) => Promise<boolean>;
};

/**
 * Shared client hook for the human-in-the-loop spend-approval queue. Backs both
 * the Zero Human Companies approvals section and the Alerts "Review first" queue
 * so they list and decide through one path (see spend-approval-model.ts).
 */
export function useSpendApprovals(options: UseSpendApprovalsOptions = {}): UseSpendApprovals {
  const { companyId, agentId, pollMs, enabled = true } = options;
  const [approvals, setApprovals] = useState<SpendApprovalView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Guards against a slow response landing after the component unmounted.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ status: "pending" });
      if (companyId) params.set("companyId", companyId);
      if (agentId) params.set("agentId", agentId);
      const res = await fetch(`/api/wallet/approvals?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; approvals?: SpendApprovalRaw[]; error?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error || `Approvals returned HTTP ${res.status}`);
      if (!aliveRef.current) return;
      setApprovals((data.approvals ?? []).map((row) => mapSpendApproval(row)));
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : "Could not load approvals.");
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [companyId, agentId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    // Deferred kickoff (matches the app's other controllers) so the initial
    // load's setState doesn't run synchronously inside the effect body.
    const kickoff = window.setTimeout(() => void refresh(), 0);
    const timer = pollMs ? window.setInterval(() => void refresh(), pollMs) : null;
    return () => {
      window.clearTimeout(kickoff);
      if (timer) window.clearInterval(timer);
    };
  }, [refresh, enabled, pollMs]);

  const decide = useCallback(async (id: string, decision: ApprovalDecision, note?: string): Promise<boolean> => {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch("/api/wallet/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, decision, note: note?.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error || `Decision returned HTTP ${res.status}`);
      // Optimistically drop it from the pending list; a refresh reconciles.
      if (aliveRef.current) setApprovals((prev) => prev.filter((item) => item.id !== id));
      void refresh();
      return true;
    } catch (err) {
      if (aliveRef.current) setError(err instanceof Error ? err.message : "Could not record the decision.");
      return false;
    } finally {
      if (aliveRef.current) setBusyId(null);
    }
  }, [refresh]);

  return { approvals, loading, error, busyId, refresh, decide };
}
