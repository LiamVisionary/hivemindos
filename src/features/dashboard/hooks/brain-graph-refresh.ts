import type { BrainGraph } from "@/features/dashboard/dashboard-types";
import { getNativeBrainGraph } from "@/lib/native/brain-graph";

const BRAIN_GRAPH_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

type BrainGraphApiResponse = {
  ok?: boolean;
  graph?: BrainGraph;
  error?: string;
  code?: string;
};

type BrainGraphRefreshConfig = {
  force?: boolean;
  sharedVault: { enabled?: boolean; vaultPath?: string };
  currentGraph: BrainGraph | null;
  clientCacheMs: number;
  loadedAtRef: { current: number };
  vaultPathRef: { current: string };
  setGraph: (graph: BrainGraph | null) => void;
  setLoading: (loading: boolean) => void;
  setStatus: (status: string) => void;
  setSelectedNodeId: (updater: (current: string) => string) => void;
};

function waitForBrainGraphRetry(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function brainGraphNoteCount(graph: BrainGraph) {
  return graph.nodes.filter((node) => !node.id.startsWith("unresolved:")).length;
}

function loadedBrainGraphStatus(graph: BrainGraph) {
  const noteCount = brainGraphNoteCount(graph);
  return graph.truncated
    ? `Loaded first ${noteCount} notes, ${graph.nodes.length} cells, and ${graph.links.length} links.`
    : `Loaded ${noteCount} notes, ${graph.nodes.length} cells, and ${graph.links.length} links.`;
}

function isEmptyNativeGraph(graph: BrainGraph | null) {
  return Boolean(graph && graph.nodes.length === 0 && graph.links.length === 0);
}

export function isTransientBrainGraphFailure(
  response: Pick<Response, "ok" | "status"> | null,
  data: BrainGraphApiResponse | null,
) {
  if (!response) return true;
  if (response.status === 502 || response.status === 503 || response.status === 504) return true;
  const code = String(data?.code ?? "");
  if (code.startsWith("DEV_PROXY_")) return true;
  const error = String(data?.error ?? "");
  return /dev proxy|dev server|lost its connection|timed out|warming up|compilation|dashboard settles/i.test(error);
}

function applyBrainGraphResult(
  graph: BrainGraph,
  config: Pick<BrainGraphRefreshConfig, "loadedAtRef" | "vaultPathRef" | "setGraph" | "setLoading" | "setSelectedNodeId" | "setStatus">,
  requestedVaultPath: string,
) {
  config.setLoading(false);
  config.setGraph(graph);
  config.loadedAtRef.current = Date.now();
  config.vaultPathRef.current = requestedVaultPath;
  config.setSelectedNodeId((current) => current || graph.nodes[0]?.id || "");
  config.setStatus(loadedBrainGraphStatus(graph));
}

export async function refreshBrainGraphFromSources(config: BrainGraphRefreshConfig) {
  if (!config.sharedVault.enabled) {
    config.setGraph(null);
    config.setStatus("Shared brain is off.");
    config.loadedAtRef.current = 0;
    config.vaultPathRef.current = "";
    return;
  }

  const requestedVaultPath = config.sharedVault.vaultPath?.trim() ?? "";
  if (
    !config.force
    && config.currentGraph
    && config.vaultPathRef.current === requestedVaultPath
    && Date.now() - config.loadedAtRef.current < config.clientCacheMs
  ) return;

  config.setLoading(true);
  let lastNativeGraph: BrainGraph | null = null;
  let lastNativeGraphWasEmpty = false;
  let lastData: BrainGraphApiResponse | null = null;
  let lastResponse: Pick<Response, "ok" | "status"> | null = null;

  for (let attempt = 0; attempt <= BRAIN_GRAPH_RETRY_DELAYS_MS.length; attempt += 1) {
    const nativeGraph = await getNativeBrainGraph({
      vaultPath: requestedVaultPath || undefined,
      force: config.force,
    });
    const nativeGraphWasEmpty = isEmptyNativeGraph(nativeGraph);
    if (nativeGraph && !nativeGraphWasEmpty) {
      applyBrainGraphResult(nativeGraph, config, requestedVaultPath);
      return;
    }
    if (nativeGraph) {
      lastNativeGraph = nativeGraph;
      lastNativeGraphWasEmpty = true;
    }

    const response = await fetch("/api/obsidian/graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vaultPath: requestedVaultPath || undefined, force: config.force }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as BrainGraphApiResponse | null;
    lastResponse = response;
    lastData = data;

    if (response?.ok && data?.ok && data.graph) {
      applyBrainGraphResult(data.graph, config, requestedVaultPath);
      return;
    }

    const retryDelay = BRAIN_GRAPH_RETRY_DELAYS_MS[attempt];
    if (retryDelay !== undefined && isTransientBrainGraphFailure(response, data)) {
      config.setStatus(`Brain graph is waiting for the local dev server to settle. Retrying in ${Math.round(retryDelay / 1000)}s...`);
      await waitForBrainGraphRetry(retryDelay);
      continue;
    }

    break;
  }

  config.setLoading(false);
  if (lastNativeGraphWasEmpty && lastNativeGraph) {
    config.setGraph(lastNativeGraph);
    config.setStatus(lastData?.error ?? "Native desktop graph returned 0 notes, and the API fallback is unavailable.");
    return;
  }
  config.setStatus(lastData?.error ?? (lastResponse ? "Could not build brain graph." : "Could not reach the local dashboard while building the brain graph."));
}
