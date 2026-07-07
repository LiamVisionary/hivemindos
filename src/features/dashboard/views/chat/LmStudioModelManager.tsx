"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Download, HardDrive, Play, Repeat2, Terminal, X } from "lucide-react";
import { Btn } from "@/components/aeon/parts";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { RuntimeIntegrationStatus } from "@/features/dashboard/dashboard-types";

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 9 }}>{children}</div>;
}

const activeDownloadStates = new Set(["queued", "downloading"]);
const setupBusyStates = new Set(["install-local-runtime", "start-local-runtime", "smoke-test-local-model"]);

function formatGb(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} GB` : "";
}

function downloadForModel(
  downloads: NonNullable<NonNullable<RuntimeIntegrationStatus["providerStatus"]>["lmStudio"]>["downloads"],
  modelId: string,
) {
  return (downloads ?? []).find((download) => download.modelId === modelId);
}

type LoadPromptModel = {
  key: string;
  displayName?: string;
  type?: string;
  remote?: boolean;
  source?: "lm-studio" | "lm-link" | "openai-server";
  sourceLabel?: string;
  baseUrl?: string;
  chatPath?: string;
  statusPath?: string;
  canLoad?: boolean;
  canUnload?: boolean;
};

type LmStudioModelManagerProps = {
  agent: AgentProfile | null | undefined;
  busy: string;
  discoveryPending?: boolean;
  lmStudioStatus?: NonNullable<RuntimeIntegrationStatus["providerStatus"]>["lmStudio"];
  modelOptions: Array<{ id: string; name?: string; subtitle?: string; group?: string; badge?: string }>;
  pendingLoadModelKeys?: string[];
  selectedModelId?: string;
  refreshRuntimeIntegrations: (agent?: AgentProfile) => void | Promise<void>;
  runRuntimeIntegrationAction: (action: string, input: Record<string, unknown>, agent: AgentProfile) => void | Promise<{ ok?: boolean; error?: string; message?: string } | void>;
  onLoadModel?: (modelKey: string, modelType?: string) => Promise<void>;
  onSelectModel?: (modelKey: string, model?: LoadPromptModel) => void;
};

type LmStudioStatus = NonNullable<RuntimeIntegrationStatus["providerStatus"]>["lmStudio"];
type LmStudioInventoryModel = NonNullable<NonNullable<LmStudioStatus>["models"]>[number];
type LocalInventoryModel = LmStudioInventoryModel & LoadPromptModel & {
  loaded?: boolean;
  loadedInstanceIds?: string[];
  paramsString?: string | null;
  format?: string | null;
};

export function LmStudioLoadProgress({ label = "Loading on device" }: { label?: string }) {
  return (
    <div style={{ display: "grid", gap: 5, minWidth: 140 }}>
      {label ? <span style={{ color: "var(--fg-3)", fontSize: 11, fontWeight: 700 }}>{label}</span> : null}
      <span style={{ display: "block", height: 5, overflow: "hidden", borderRadius: 999, background: "rgba(148,163,184,0.18)" }}>
        <span style={{ display: "block", height: "100%", width: "62%", borderRadius: 999, background: "linear-gradient(90deg, rgba(94,234,212,0.38), rgba(94,234,212,0.92), rgba(125,211,252,0.72))", animation: "lmStudioLoadSweep 1.4s ease-in-out infinite" }} />
      </span>
      <style>{`@keyframes lmStudioLoadSweep{0%{transform:translateX(-85%)}50%{transform:translateX(48%)}100%{transform:translateX(165%)}}`}</style>
    </div>
  );
}

export function LmStudioModelManager({
  agent,
  busy,
  discoveryPending = false,
  lmStudioStatus,
  modelOptions,
  pendingLoadModelKeys = [],
  selectedModelId = "",
  refreshRuntimeIntegrations,
  runRuntimeIntegrationAction,
  onLoadModel,
  onSelectModel,
}: LmStudioModelManagerProps) {
  const [setupExpanded, setSetupExpanded] = useState(false);
  const [loadPromptModel, setLoadPromptModel] = useState<LoadPromptModel | null>(null);
  const inventoryModels = (lmStudioStatus?.models ?? []) as LocalInventoryModel[];
  const catalogModels = lmStudioStatus?.catalog ?? [];
  const downloads = lmStudioStatus?.downloads ?? [];
  const hardware = lmStudioStatus?.hardware;
  const setup = lmStudioStatus?.setup;
  const lmStudioSetup = setup?.providers.find((provider) => provider.id === "lm-studio");
  const fallbackModels: LocalInventoryModel[] = inventoryModels.length ? [] : modelOptions.map((model) => ({
    key: model.id,
    displayName: model.name || model.id,
    type: "llm",
    loaded: model.subtitle === "Loaded",
    loadedInstanceIds: [] as string[],
    paramsString: model.group,
    format: null,
    remote: model.badge === "LM Link",
    source: model.badge === "LM Link" ? "lm-link" as const : "lm-studio" as const,
    sourceLabel: model.badge === "LM Link" ? "LM Link" : "LM Studio",
    canLoad: model.subtitle !== "Serving",
    canUnload: model.subtitle !== "Serving",
  }));
  const models: LocalInventoryModel[] = inventoryModels.length ? inventoryModels : fallbackModels;
  const actionBusy = busy === "load-model" || busy === "unload-model";
  const downloadActionBusy = busy === "download-model" || busy === "cancel-download";
  const setupActionBusy = setupBusyStates.has(busy);
  const selectedModel = models.find((model) => model.key === selectedModelId);
  const selectedModelLoaded = Boolean(selectedModel?.loaded);
  const setupSummary = setup?.ready
    ? "Local server online"
    : lmStudioSetup?.present
      ? "LM Studio configured · Server offline"
      : "LM Studio not installed";
  const setupBadge = setup?.ready ? "Ready" : lmStudioSetup?.present ? "Offline" : "Setup";
  const setupActionLabel = setup && !setup.ready && !lmStudioSetup?.present
    ? "Install"
    : setup && !setup.ready
      ? "Start server"
      : selectedModelLoaded && selectedModelId
        ? "Test"
        : "";
  const setupActionIcon = busy === "install-local-runtime" || busy === "start-local-runtime" || busy === "smoke-test-local-model"
    ? <Repeat2 size={13} className="animate-spin" aria-hidden="true" />
    : setup && !setup.ready && !lmStudioSetup?.present
      ? <Download size={13} aria-hidden="true" />
      : setup && !setup.ready
        ? <Play size={13} aria-hidden="true" />
        : <CheckCircle2 size={13} aria-hidden="true" />;
  const selectModel = (modelKey: string, model?: LoadPromptModel) => {
    if (modelKey) onSelectModel?.(modelKey, model);
  };
  const selectOrPromptModel = (model: LoadPromptModel & { loaded?: boolean }, loading?: boolean) => {
    if (!model.key) return;
    if (model.loaded || loading || model.canLoad === false) {
      selectModel(model.key, model);
      return;
    }
    setLoadPromptModel(model);
  };
  const installLocalRuntime = async () => {
    if (!agent) return;
    await runRuntimeIntegrationAction("install-local-runtime", {}, agent);
  };
  const startLocalRuntime = async () => {
    if (!agent) return;
    await runRuntimeIntegrationAction("start-local-runtime", {}, agent);
  };
  const smokeTestLocalModel = async (modelKey: string, model?: LoadPromptModel) => {
    if (!agent || !modelKey) return;
    await runRuntimeIntegrationAction("smoke-test-local-model", {
      model: modelKey,
      ...(model?.baseUrl ? {
        baseUrl: model.baseUrl,
        chatPath: model.chatPath || "/v1/chat/completions",
        statusPath: model.statusPath || "/v1/models",
        startServer: false,
      } : {}),
    }, agent);
  };
  const runSetupPrimaryAction = () => {
    if (!setup) return;
    if (!setup.ready && !lmStudioSetup?.present) {
      void installLocalRuntime();
      return;
    }
    if (!setup.ready) {
      void startLocalRuntime();
      return;
    }
    if (selectedModelLoaded && selectedModelId) void smokeTestLocalModel(selectedModelId, selectedModel);
  };
  const loadModel = async (modelKey: string, modelType?: string) => {
    if (!agent) return;
    selectModel(modelKey);
    if (onLoadModel) {
      await onLoadModel(modelKey, modelType);
      return;
    }
    await runRuntimeIntegrationAction("load-model", {
      model: modelKey,
    }, agent);
  };
  const unloadModel = async (instanceId: string) => {
    if (!agent) return;
    await runRuntimeIntegrationAction("unload-model", { instanceId }, agent);
  };
  const downloadCatalogModel = async (modelId: string) => {
    if (!agent) return;
    await runRuntimeIntegrationAction("download-model", { modelId }, agent);
  };
  const cancelDownload = async (jobId: string | undefined, modelId: string) => {
    if (!agent) return;
    await runRuntimeIntegrationAction("cancel-download", { jobId, modelId }, agent);
  };
  const confirmPromptLoad = () => {
    const model = loadPromptModel;
    if (!model) return;
    setLoadPromptModel(null);
    void loadModel(model.key, model.type);
  };

  return (
    <div style={{ display: "grid", gap: 9, border: "1px solid var(--line)", borderRadius: 11, background: "var(--panel-bg-soft)", padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <GroupLabel>Local models</GroupLabel>
        <Btn variant="ghost" size="sm" disabled={busy === "status"} onClick={() => refreshRuntimeIntegrations(agent ?? undefined)}>
          <Repeat2 size={13} className={busy === "status" ? "animate-spin" : undefined} aria-hidden="true" /> Refresh
        </Btn>
      </div>
      {setup ? (
        <div style={{ display: "grid", gap: setupExpanded ? 8 : 0, padding: "8px 9px", borderRadius: 9, border: `1px solid ${setup.ready ? "rgba(94,234,212,0.3)" : "var(--line)"}`, background: setup.ready ? "rgba(20,184,166,0.07)" : "rgba(15,23,42,0.32)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 9, flexWrap: "wrap" }}>
            <button
              type="button"
              aria-expanded={setupExpanded}
              onClick={() => setSetupExpanded((current) => !current)}
              style={{ minWidth: 0, flex: "1 1 220px", display: "flex", alignItems: "center", gap: 7, padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}
            >
              {setupExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              <span style={{ minWidth: 0, color: "var(--fg)", fontSize: 12.5, fontWeight: 850, overflowWrap: "anywhere" }}>{setupSummary}</span>
              <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", padding: "1px 6px", borderRadius: 999, border: "1px solid var(--aeon-line)", color: setup.ready ? "var(--accent-strong)" : "var(--cyan-3)", background: "var(--aeon-soft)" }}>
                {setupBadge}
              </span>
            </button>
            {setupActionLabel ? (
              <Btn variant={setup.ready ? "ghost" : "primary"} size="sm" disabled={setupActionBusy || (!setup.ready && !lmStudioSetup?.present && !setup.installable)} onClick={runSetupPrimaryAction}>
                {setupActionIcon}
                {setupActionLabel}
              </Btn>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--accent-strong)", fontSize: 11.5, fontWeight: 800 }}>
                <CheckCircle2 size={13} aria-hidden="true" /> Ready
              </span>
            )}
          </div>
          {setupExpanded ? (
            <div style={{ display: "grid", gap: 7, paddingTop: 2 }}>
              <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                {lmStudioSetup?.detail || `${setup.recommendedLabel} is recommended for local downloads, load/unload, and LM Link.`}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {setup.providers.map((provider) => (
                  <span key={provider.id} title={provider.error || provider.detail} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 7px", borderRadius: 999, border: `1px solid ${provider.ready ? "rgba(94,234,212,0.38)" : "var(--line)"}`, color: provider.ready ? "var(--accent-strong)" : provider.present ? "var(--fg-3)" : "var(--fg-4)", background: provider.ready ? "rgba(20,184,166,0.08)" : "rgba(2,6,23,0.24)", fontSize: 10.5, fontWeight: 800 }}>
                    <Terminal size={11} aria-hidden="true" />
                    {provider.label} · {provider.ready ? "ready" : provider.present ? "installed" : "missing"}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {hardware ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.35, marginBottom: 7 }}>
          <HardDrive size={13} aria-hidden="true" />
          <span>{[hardware.totalRamGb ? `${formatGb(hardware.totalRamGb)} RAM` : "", hardware.freeRamGb ? `${formatGb(hardware.freeRamGb)} free` : "", hardware.appleSilicon ? "Apple Silicon" : hardware.arch].filter(Boolean).join(" · ")}</span>
        </div>
      ) : null}
      {lmStudioStatus?.error ? (
        <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 12, lineHeight: 1.45 }}>{lmStudioStatus.error}</p>
      ) : null}
      {catalogModels.length ? (
        <div style={{ display: "grid", gap: 7 }}>
          <GroupLabel>Install</GroupLabel>
          {catalogModels.map((entry) => {
            const download = downloadForModel(downloads, entry.id);
            const downloadActive = Boolean(download && activeDownloadStates.has(download.state));
            const failed = download?.state === "failed";
            const cancelled = download?.state === "cancelled";
            const installedKey = entry.installedModelKey || entry.filename;
            return (
              <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: "10px 11px", borderRadius: 9, border: "1px solid var(--line)", background: "rgba(15,23,42,0.38)" }}>
                <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--fg)", fontSize: 12.5, fontWeight: 800, overflowWrap: "anywhere" }}>{entry.displayName}</span>
                    <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", padding: "1px 6px", borderRadius: 999, border: "1px solid var(--line)", color: "var(--fg-4)" }}>
                      {entry.installed ? entry.loaded ? "Loaded" : "Installed" : entry.quantization}
                    </span>
                  </div>
                  <div style={{ color: "var(--fg-4)", fontSize: 11, lineHeight: 1.38, overflowWrap: "anywhere" }}>
                    {[entry.params, formatGb(entry.sizeGb), `${formatGb(entry.minRamGb)} RAM`].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ color: "var(--fg-3)", fontSize: 11.5, lineHeight: 1.4, overflowWrap: "anywhere" }}>{entry.description}</div>
                  {failed || cancelled ? (
                    <div style={{ color: failed ? "var(--danger, #fca5a5)" : "var(--fg-4)", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                      {failed ? download?.error || "Download failed." : "Download cancelled."}
                    </div>
                  ) : null}
                </div>
                {downloadActive ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <LmStudioLoadProgress label={download?.progressPercent ? `Downloading ${Math.round(download.progressPercent)}%` : "Downloading"} />
                    <Btn variant="ghost" size="sm" disabled={downloadActionBusy} onClick={() => void cancelDownload(download?.jobId, entry.id)}>
                      <X size={13} aria-hidden="true" /> Cancel
                    </Btn>
                  </div>
                ) : entry.installed && entry.loaded ? (
                  <span style={{ color: "var(--fg-4)", fontSize: 11 }}>Ready</span>
                ) : entry.installed ? (
                  <Btn variant="primary" size="sm" disabled={actionBusy} onClick={() => void loadModel(installedKey, "llm")}>Load</Btn>
                ) : download?.state === "completed" ? (
                  <Btn variant="ghost" size="sm" disabled={busy === "status"} onClick={() => refreshRuntimeIntegrations(agent ?? undefined)}>
                    <Repeat2 size={13} className={busy === "status" ? "animate-spin" : undefined} aria-hidden="true" /> Refresh
                  </Btn>
                ) : (
                  <Btn variant="primary" size="sm" disabled={downloadActionBusy} onClick={() => void downloadCatalogModel(entry.id)}>
                    {downloadActionBusy ? <Repeat2 size={13} className="animate-spin" aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
                    Download
                  </Btn>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      <div style={{ display: "grid", gap: 7 }}>
        <GroupLabel>Inventory</GroupLabel>
        {models.length ? models.map((model) => {
          const instanceId = model.loadedInstanceIds?.[0] || model.key;
          const loading = pendingLoadModelKeys.includes(model.key) && !model.loaded;
          const selected = selectedModelId === model.key;
          const serverBacked = model.source === "openai-server";
          const canLoadModel = model.canLoad !== false && !serverBacked;
          const canUnloadModel = model.canUnload !== false && !serverBacked;
          const badgeLabel = serverBacked ? "Server" : model.remote ? "LM Link" : "Local";
          const statusLabel = model.loaded
            ? serverBacked ? `Serving via ${model.sourceLabel || "OpenAI server"}` : model.remote ? "Loaded via LM Link" : "Loaded"
            : loading
              ? "Loading"
              : model.remote
                ? "Available via LM Link"
                : "Downloaded";
          return (
            <div key={model.key} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: "9px 10px", borderRadius: 9, border: `1px solid ${selected ? "rgba(94,234,212,0.68)" : "var(--line)"}`, background: selected ? "rgba(45,212,191,0.12)" : "rgba(2,6,23,0.24)", boxShadow: selected ? "0 0 0 1px rgba(94,234,212,0.14) inset" : "none" }}>
              <button
                type="button"
                onClick={() => selectOrPromptModel(model, loading)}
                aria-pressed={selected}
                style={{ minWidth: 0, display: "grid", gap: 2, textAlign: "left", padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", cursor: onSelectModel ? "pointer" : "default" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--fg)", fontSize: 12.5, fontWeight: 750, overflowWrap: "anywhere" }}>{model.displayName || model.key}</span>
                  <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", padding: "1px 6px", borderRadius: 999, border: `1px solid ${model.remote || serverBacked ? "var(--aeon-line)" : "var(--line)"}`, color: model.remote || serverBacked ? "var(--cyan-3)" : "var(--fg-4)", background: model.remote || serverBacked ? "var(--aeon-soft)" : "transparent" }}>
                    {badgeLabel}
                  </span>
                  {selected ? (
                    <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--accent-strong)" }}>
                      Selected
                    </span>
                  ) : null}
                </div>
                <div style={{ marginTop: 2, color: "var(--fg-4)", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                  {[model.key, model.paramsString, model.format, statusLabel].filter(Boolean).join(" · ")}
                </div>
              </button>
              {loading ? (
                <LmStudioLoadProgress />
              ) : model.loaded ? (
                <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <Btn variant="ghost" size="sm" disabled={setupActionBusy} onClick={() => void smokeTestLocalModel(model.key, model)}>
                    {busy === "smoke-test-local-model" && selectedModelId === model.key ? <Repeat2 size={13} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
                    Test
                  </Btn>
                  {canUnloadModel ? (
                    <Btn variant="ghost" size="sm" disabled={actionBusy} onClick={() => void unloadModel(instanceId)}>Unload</Btn>
                  ) : null}
                </div>
              ) : !canLoadModel ? (
                <Btn variant="ghost" size="sm" onClick={() => selectModel(model.key, model)}>Use</Btn>
              ) : (
                <Btn variant="primary" size="sm" disabled={actionBusy} onClick={() => void loadModel(model.key, model.type)}>Load</Btn>
              )}
            </div>
          );
        }) : (
          busy === "status" || discoveryPending
            ? <LmStudioLoadProgress label="" />
            : (
              <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 12, lineHeight: 1.45 }}>
                No local model inventory reported by this machine.
              </p>
            )
        )}
      </div>
      {loadPromptModel ? (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLoadPromptModel(null);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 110, display: "grid", placeItems: "center", padding: 18, background: "rgba(2,6,23,0.62)", backdropFilter: "blur(8px)" }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="lm-studio-load-prompt-title"
            onMouseDown={(event) => event.stopPropagation()}
            style={{ width: "min(440px, 100%)", display: "grid", gap: 12, border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel-bg)", boxShadow: "0 24px 90px rgba(0,0,0,0.45)", padding: 16 }}
          >
            <div style={{ display: "grid", gap: 5 }}>
              <h3 id="lm-studio-load-prompt-title" style={{ margin: 0, color: "var(--fg)", fontSize: 17, fontWeight: 850 }}>
                Load this model?
              </h3>
              <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 13, lineHeight: 1.45, overflowWrap: "anywhere" }}>
                {loadPromptModel.displayName || loadPromptModel.key} is available, but it is not loaded yet. Load it now so this agent can use it?
              </p>
              {loadPromptModel.remote ? (
                <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.4 }}>
                  This is an LM Link model, so loading happens on the linked host.
                </p>
              ) : null}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <Btn variant="ghost" size="sm" disabled={actionBusy} onClick={() => setLoadPromptModel(null)}>
                Not now
              </Btn>
              <Btn variant="primary" size="sm" disabled={actionBusy} onClick={confirmPromptLoad}>
                {actionBusy ? <Repeat2 size={13} className="animate-spin" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
                Load
              </Btn>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
