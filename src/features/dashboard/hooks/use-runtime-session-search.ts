"use client";

import { useCallback, useState } from "react";
import type { AgentProfile, AgentRuntime } from "@/lib/types/agent-runtime";
import type { RuntimeSessionSearchResult } from "@/features/dashboard/dashboard-types";

export function useRuntimeSessionSearch(displayAgents: AgentProfile[]) {
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const [sessionSearchResults, setSessionSearchResults] = useState<RuntimeSessionSearchResult[]>([]);
  const [sessionSearchLoading, setSessionSearchLoading] = useState(false);
  const [sessionSearchMessage, setSessionSearchMessage] = useState("");

  const searchAllRuntimeSessions = useCallback(async (queryOverride?: string) => {
    const query = typeof queryOverride === "string" ? queryOverride : sessionSearchQuery;
    const runtimeCandidates = displayAgents
      .map((agent) => agent.runtime)
      .filter((runtime): runtime is AgentRuntime => runtime === "hermes" || runtime === "openclaw");
    const runtimes = [...new Set<AgentRuntime>(runtimeCandidates.length ? runtimeCandidates : ["hermes", "openclaw"])];
    setSessionSearchLoading(true);
    setSessionSearchMessage(query.trim() ? "Searching runtime sessions..." : "Loading recent runtime sessions...");
    const groups = await Promise.all(runtimes.map(async (runtime) => {
      const params = new URLSearchParams({ q: query, limit: "20" });
      const response = await fetch(`/api/runtimes/${runtime}/sessions/search?${params.toString()}`, { cache: "no-store" }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; sessions?: RuntimeSessionSearchResult[] } | null;
      return response?.ok && data?.ok ? data.sessions ?? [] : [];
    }));
    const sessions = groups
      .flat()
      .sort((left, right) => String(right.updatedAt || right.startedAt || "").localeCompare(String(left.updatedAt || left.startedAt || "")));
    setSessionSearchResults(sessions);
    setSessionSearchMessage(sessions.length ? `${sessions.length} session${sessions.length === 1 ? "" : "s"} found.` : "No readable sessions matched.");
    setSessionSearchLoading(false);
  }, [displayAgents, sessionSearchQuery]);

  return {
    searchAllRuntimeSessions,
    sessionSearchLoading,
    sessionSearchMessage,
    sessionSearchQuery,
    sessionSearchResults,
    setSessionSearchQuery,
  };
}
