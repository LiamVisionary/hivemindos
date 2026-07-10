"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Cloud, HardDrive, LoaderCircle, Search, Sparkles, X } from "lucide-react";

import { requestRuntimeIntegrationAction, requestRuntimeIntegrationStatus, type RuntimeIntegrationActionResult } from "@/features/dashboard/runtime-integration-client";
import type { RuntimeIntegrationStatus, RuntimeModelSelection } from "@/features/dashboard/dashboard-types";
import { LmStudioModelManager } from "@/features/dashboard/views/chat/LmStudioModelManager";
import {
  DEFAULT_CHAT_THREAD_TITLE_LOCAL_CATALOG_ID,
  type ChatThreadTitleCloudRoute,
  type ChatThreadTitleConfig,
  type ChatThreadTitleMode,
} from "@/lib/config/chat-thread-title";
import {
  LOCAL_MODEL_INSTALL_CATALOG,
  localModelMatchesCatalogEntry,
} from "@/lib/config/local-model-install-catalog";
import { HIVEMIND_OS_RUNTIME, type AgentProfile, type AgentRuntime } from "@/lib/types/agent-runtime";

import styles from "./ThreadTitleSettings.module.css";

type CloudRouteGroup = {
  key: string;
  model: string;
  providerLabel: string;
  score: number;
  recommended: boolean;
  recommendation?: string;
  routes: ChatThreadTitleCloudRoute[];
};

type ThreadTitleSettingsProps = {
  agents: AgentProfile[];
  config: ChatThreadTitleConfig;
  open: boolean;
  runtimeModelSelectionsByRuntime?: Partial<Record<AgentRuntime, RuntimeModelSelection>>;
  onChange: (config: ChatThreadTitleConfig) => void;
  onClose: () => void;
};

function localTitleAgent(agents: AgentProfile[]): AgentProfile {
  const base = agents.find((agent) => agent.provider === "lm-studio") ?? agents[0];
  return {
    ...(base ?? {}),
    id: "chat-thread-title-local",
    name: "Local thread titles",
    runtime: HIVEMIND_OS_RUNTIME,
    provider: "lm-studio",
    model: "",
    gatewayUrl: "http://127.0.0.1:1234/v1",
    chatPath: "/v1/chat/completions",
    statusPath: "/v1/models",
    telemetryUrl: "",
    machineName: "This Mac",
  };
}

function groupCloudRoutes(routes: ChatThreadTitleCloudRoute[]) {
  const byKey = new Map<string, CloudRouteGroup>();
  for (const route of routes) {
    const key = `${route.providerFamily}\u001f${route.model.toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.routes.some((candidate) => candidate.id === route.id)) existing.routes.push(route);
      existing.score = Math.max(existing.score, route.score);
      existing.recommended = existing.recommended || route.recommended;
      existing.recommendation ||= route.recommendation;
      continue;
    }
    byKey.set(key, {
      key,
      model: route.model,
      providerLabel: route.providerLabel,
      score: route.score,
      recommended: route.recommended,
      recommendation: route.recommendation,
      routes: [route],
    });
  }
  return [...byKey.values()].sort((left, right) => (
    right.score - left.score
    || left.providerLabel.localeCompare(right.providerLabel)
    || left.model.localeCompare(right.model)
  ));
}

export function ThreadTitleSettings({
  agents,
  config,
  open,
  runtimeModelSelectionsByRuntime,
  onChange,
  onClose,
}: ThreadTitleSettingsProps) {
  const [localStatus, setLocalStatus] = useState<RuntimeIntegrationStatus | null>(null);
  const [localBusy, setLocalBusy] = useState("");
  const [localMessage, setLocalMessage] = useState("");
  const [cloudRoutes, setCloudRoutes] = useState<ChatThreadTitleCloudRoute[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const localAgent = useMemo(() => localTitleAgent(agents), [agents]);

  const updateMode = (mode: ChatThreadTitleMode) => onChange({ ...config, mode });
  const refreshLocal = useCallback(async () => {
    setLocalBusy("status");
    setLocalMessage("");
    const status = await requestRuntimeIntegrationStatus(localAgent).catch((error) => {
      setLocalMessage(error instanceof Error ? error.message : "Could not inspect local models.");
      return null;
    });
    setLocalStatus(status);
    setLocalBusy("");
  }, [localAgent]);
  const runLocalAction = useCallback(async (action: string, input: Record<string, unknown>) => {
    setLocalBusy(action);
    setLocalMessage("");
    const result: RuntimeIntegrationActionResult = await requestRuntimeIntegrationAction(localAgent, action, input).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Local model action failed.",
    }));
    setLocalMessage(result.ok ? result.message ?? result.output ?? "Local model action completed." : result.error ?? "Local model action failed.");
    setLocalBusy("");
    if (result.ok) await refreshLocal();
    return result;
  }, [localAgent, refreshLocal]);

  const configuredModelHints = useMemo(() => {
    const hints = agents.map((agent) => ({ provider: agent.provider, model: agent.model }));
    for (const selection of Object.values(runtimeModelSelectionsByRuntime ?? {})) {
      if (!selection) continue;
      hints.push({ provider: selection.provider, model: selection.model });
      for (const provider of selection.providers) {
        for (const model of provider.models) hints.push({ provider: provider.slug, model: model.id });
      }
    }
    return hints;
  }, [agents, runtimeModelSelectionsByRuntime]);

  const loadCloudRoutes = useCallback(async () => {
    setCloudLoading(true);
    setCloudError("");
    const response = await fetch("/api/chat/thread-title/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agents: configuredModelHints }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      routes?: ChatThreadTitleCloudRoute[];
      error?: string;
    } | null;
    if (!response?.ok || !data?.ok) {
      setCloudError(data?.error ?? "Could not scan configured cloud models.");
      setCloudRoutes([]);
      setCloudLoading(false);
      return;
    }
    setCloudRoutes(Array.isArray(data.routes) ? data.routes : []);
    setCloudLoading(false);
  }, [configuredModelHints]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => {
      if (config.mode === "local") void refreshLocal();
      if (config.mode === "cloud") void loadCloudRoutes();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [config.mode, loadCloudRoutes, open, refreshLocal]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (pickerOpen) searchRef.current?.focus();
  }, [pickerOpen]);

  const groups = useMemo(() => groupCloudRoutes(cloudRoutes), [cloudRoutes]);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredGroups = groups.filter((group) => !normalizedSearch || [
    group.model,
    group.providerLabel,
    ...group.routes.map((route) => route.auth),
  ].join(" ").toLowerCase().includes(normalizedSearch));
  const recommendedGroups = filteredGroups.filter((group) => group.recommended).slice(0, 8);
  const recommendedKeys = new Set(recommendedGroups.map((group) => group.key));
  const remainingGroups = filteredGroups.filter((group) => !recommendedKeys.has(group.key));
  const selectedRoute = config.cloudRoute;
  const localProvider = localStatus?.modelSelection?.providers.find((provider) => provider.slug === "lm-studio");
  const localCatalog = LOCAL_MODEL_INSTALL_CATALOG.find((entry) => entry.id === config.localCatalogId);
  const selectedLocalModelId = config.localModelKey
    || localStatus?.providerStatus?.lmStudio?.catalog?.find((entry) => entry.id === config.localCatalogId)?.installedModelKey
    || "";

  const selectCloudRoute = (route: ChatThreadTitleCloudRoute) => {
    onChange({ ...config, mode: "cloud", cloudRoute: route });
    setPickerOpen(false);
    setSearch("");
  };
  const selectCloudGroup = (group: CloudRouteGroup) => {
    const current = group.routes.find((route) => route.id === selectedRoute?.id);
    selectCloudRoute(current ?? group.routes.find((route) => route.auth === "oauth") ?? group.routes[0]);
  };
  const selectLocalModel = (modelKey: string) => {
    const matchedCatalog = LOCAL_MODEL_INSTALL_CATALOG.find((entry) => (
      entry.roles.includes("chat-title") && localModelMatchesCatalogEntry({ key: modelKey }, entry)
    ));
    onChange({
      ...config,
      mode: "local",
      localModelKey: modelKey,
      localCatalogId: matchedCatalog?.id ?? config.localCatalogId ?? DEFAULT_CHAT_THREAD_TITLE_LOCAL_CATALOG_ID,
    });
  };

  const renderGroup = (group: CloudRouteGroup) => (
    <div
      key={group.key}
      className={styles.modelOption}
      data-selected={group.routes.some((route) => route.id === selectedRoute?.id) ? "true" : undefined}
    >
      <button type="button" className={styles.optionMain} onClick={() => selectCloudGroup(group)}>
        <span className={styles.optionTitle}>
          <span className={styles.modelName}>{group.model}</span>
          <span className={styles.providerName}>{group.providerLabel}</span>
          {group.recommendation ? <span className={styles.recommendation}>{group.recommendation}</span> : null}
        </span>
      </button>
      <span className={styles.badges}>
        {group.routes.map((route) => (
          <button
            type="button"
            key={route.id}
            className={styles.badge}
            data-selected={selectedRoute?.id === route.id ? "true" : undefined}
            onClick={() => selectCloudRoute(route)}
          >
            {route.auth === "oauth" ? "OAuth" : "API"}
          </button>
        ))}
        {group.routes.some((route) => route.id === selectedRoute?.id) ? <Check size={13} aria-hidden="true" /> : null}
      </span>
    </div>
  );

  if (!open) return null;
  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="thread-title-settings-heading">
        <header className={styles.header}>
          <div className={styles.heading}>
            <span className={styles.eyebrow}>Chat history</span>
            <h2 id="thread-title-settings-heading">Thread title captions</h2>
            <p>Name a task as soon as its first substantive user message is sent.</p>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close thread title settings">
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.modeGrid} role="radiogroup" aria-label="Thread title caption source">
          <button type="button" className={styles.modeButton} role="radio" aria-checked={config.mode === "off"} data-active={config.mode === "off" ? "true" : undefined} onClick={() => updateMode("off")}>
            <span className={styles.titleRow}><Sparkles size={15} aria-hidden="true" /> First message</span>
            <small>No model call; keeps the current first-message preview.</small>
          </button>
          <button type="button" className={styles.modeButton} role="radio" aria-checked={config.mode === "local"} data-active={config.mode === "local" ? "true" : undefined} onClick={() => updateMode("local")}>
            <span className={styles.titleRow}><HardDrive size={15} aria-hidden="true" /> Local</span>
            <small>Private LM Studio title model on This Mac.</small>
          </button>
          <button type="button" className={styles.modeButton} role="radio" aria-checked={config.mode === "cloud"} data-active={config.mode === "cloud" ? "true" : undefined} onClick={() => updateMode("cloud")}>
            <span className={styles.titleRow}><Cloud size={15} aria-hidden="true" /> Cloud</span>
            <small>Use one of your existing API or OAuth model routes.</small>
          </button>
        </div>

        <div className={styles.body}>
          {config.mode === "off" ? (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>No model captioning</span>
              <p className={styles.copy}>Generic openers such as “hello” still wait for the first substantive turn before a model caption would run.</p>
            </div>
          ) : config.mode === "local" ? (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Local model setup</span>
              <p className={styles.copy}>The 0.8B option is the default and lowest-resource choice. The 4B option is the larger quality-focused choice; this short task does not offer heavier local models.</p>
              <LmStudioModelManager
                agent={localAgent}
                busy={localBusy}
                discoveryPending={localBusy === "status"}
                lmStudioStatus={localStatus?.providerStatus?.lmStudio}
                modelOptions={localProvider?.models ?? []}
                selectedModelId={selectedLocalModelId}
                refreshRuntimeIntegrations={refreshLocal}
                runRuntimeIntegrationAction={(action, input) => runLocalAction(action, input)}
                onSelectModel={selectLocalModel}
                catalogFilter={(entry) => entry.roles.includes("chat-title")}
                inventoryFilter={(model) => LOCAL_MODEL_INSTALL_CATALOG.some((entry) => (
                  entry.roles.includes("chat-title") && localModelMatchesCatalogEntry(model, entry)
                ))}
                emptyInventoryLabel="No thread-title model is installed yet. Choose one above to download it."
              />
              {localCatalog && !config.localModelKey ? <p className={styles.copy}>Selected default: {localCatalog.displayName}</p> : null}
              {localMessage ? <p className={localMessage.toLowerCase().includes("fail") || localMessage.toLowerCase().includes("could not") ? styles.error : styles.copy}>{localMessage}</p> : null}
            </div>
          ) : (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Configured cloud models</span>
              <p className={styles.copy}>Recommended lightweight models appear first. Text is capped to the agreed title context and passes through secret redaction before it leaves this machine.</p>
              {cloudLoading ? (
                <div className={styles.statusRow} role="status" aria-label="Scanning configured cloud models">
                  <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> Scanning your configured runtimes and providers
                </div>
              ) : cloudError ? (
                <p className={styles.error}>{cloudError}</p>
              ) : (
                <div className={styles.cloudPicker}>
                  <button type="button" className={styles.pickerTrigger} aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={() => setPickerOpen((current) => !current)}>
                    <span className={styles.selectedCopy}>
                      <strong>{selectedRoute?.model ?? "Choose a cloud model"}</strong>
                      <span>{selectedRoute ? `${selectedRoute.providerLabel} · ${selectedRoute.auth === "oauth" ? "OAuth" : "API"}` : `${groups.length} available model${groups.length === 1 ? "" : "s"}`}</span>
                    </span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                  {pickerOpen ? (
                    <div className={styles.menu} role="dialog" aria-label="Cloud caption models">
                      <label className={styles.search}>
                        <Search size={14} aria-hidden="true" />
                        <input ref={searchRef} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search models and providers" />
                      </label>
                      <div className={styles.options}>
                        {recommendedGroups.length ? (
                          <div className={styles.optionGroup}>
                            <span className={styles.sectionLabel}>Recommended</span>
                            {recommendedGroups.map(renderGroup)}
                          </div>
                        ) : null}
                        {remainingGroups.length ? (
                          <div className={styles.optionGroup}>
                            <span className={styles.sectionLabel}>{recommendedGroups.length ? "All available" : "Available"}</span>
                            {remainingGroups.map(renderGroup)}
                          </div>
                        ) : null}
                        {!filteredGroups.length ? <p className={styles.empty}>No configured models match this search.</p> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
              {!cloudLoading && !cloudError && !groups.length ? <p className={styles.empty}>No callable cloud models were found. Configure an API provider or connect OpenAI/xAI OAuth first.</p> : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
