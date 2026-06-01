// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { AgentCallsSettingsPanel } from "./AgentCallsSettingsPanel";
import { GuidedProviderSetup } from "./GuidedProviderSetup";
import { GuidedUsePodSetup } from "./GuidedUsePodSetup";
import { InlineRenameControl } from "@/features/dashboard/views/shared/InlineRenameControl";
import { ModelPillSelector } from "./ModelPillSelector";
import { summarizeRuntimeModelRegistry } from "./runtime-model-registry";
import type { AgentRuntime } from "@/lib/types/agent-runtime";
import { runtimeSettingsFeature } from "@/lib/types/agent-runtime";

const USEPOD_RUNTIME_ICON_PATH = "/icons/runtimes/usepod.webp";
const USEPOD_RUNTIME_ICON_MARK_STYLE = {
  width: 34,
  height: 34,
  overflow: "hidden",
  borderColor: "rgba(94, 234, 212, 0.24)",
  borderRadius: 8,
  background: "rgba(2, 6, 23, 0.28)",
};
const USEPOD_RUNTIME_ICON_IMAGE_STYLE = {
  "--runtime-image": `url(${USEPOD_RUNTIME_ICON_PATH})`,
  width: 32,
  height: 32,
  borderRadius: 7,
};

function ProviderDiscoveryCard({ fleetClass, runtimeLabel }: { fleetClass: (...names: Array<string | false | null | undefined>) => string; runtimeLabel: string }) {
  const shimmerGradient = "linear-gradient(90deg, rgba(148,163,184,.13), rgba(94,234,212,.28), rgba(251,191,36,.22), rgba(148,163,184,.13))";
  return (
    <div
      className={fleetClass("agentRuntimeEmptyCard")}
      role="status"
      aria-live="polite"
      aria-label={`Discovering ${runtimeLabel} providers`}
      style={{
        minHeight: 74,
        alignContent: "center",
        gap: 10,
        padding: 10,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 0 }}>
        <strong style={{ fontSize: 12, lineHeight: 1.2 }}>{runtimeLabel} providers</strong>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--muted)", fontSize: 10, fontWeight: 750 }}>
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="animate-pulse"
              style={{
                width: 5,
                height: 5,
                borderRadius: 999,
                background: index === 1 ? "rgba(251,191,36,.78)" : "rgba(94,234,212,.68)",
                animationDelay: `${index * 140}ms`,
              }}
            />
          ))}
          Scanning
        </span>
      </span>
      <span style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 7 }}>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            style={{
              position: "relative",
              overflow: "hidden",
              minHeight: 40,
              border: "1px solid rgba(148,163,184,.14)",
              borderRadius: 7,
              background: "rgba(15,23,42,.36)",
              display: "grid",
              gridTemplateColumns: "18px minmax(0, 1fr)",
              alignItems: "center",
              gap: 7,
              padding: "8px 9px",
            }}
          >
            <span
              className="animate-pulse"
              style={{
                width: 18,
                height: 18,
                borderRadius: 6,
                background: index === 1 ? "rgba(251,191,36,.20)" : "rgba(94,234,212,.16)",
                boxShadow: index === 1 ? "inset 0 0 0 1px rgba(251,191,36,.28)" : "inset 0 0 0 1px rgba(94,234,212,.22)",
                animationDelay: `${index * 110}ms`,
              }}
            />
            <span style={{ display: "grid", gap: 5 }}>
              <span
                className="animate-pulse"
                style={{
                  width: `${68 - index * 8}%`,
                  height: 6,
                  borderRadius: 999,
                  background: "rgba(226,232,240,.20)",
                  animationDelay: `${index * 110}ms`,
                }}
              />
              <span
                className="animate-pulse"
                style={{
                  width: `${42 + index * 8}%`,
                  height: 5,
                  borderRadius: 999,
                  background: "rgba(148,163,184,.14)",
                  animationDelay: `${index * 110 + 70}ms`,
                }}
              />
            </span>
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 120 40"
              preserveAspectRatio="none"
              aria-hidden="true"
              focusable="false"
              style={{ position: "absolute", inset: 0, opacity: 0.42, pointerEvents: "none" }}
            >
              <rect x="-90" y="0" width="44" height="40" fill={shimmerGradient}>
                <animate attributeName="x" values="-90;140" dur="1.7s" begin={`${index * 0.16}s`} repeatCount="indefinite" />
              </rect>
            </svg>
          </span>
        ))}
      </span>
    </div>
  );
}

export function AgentSettingsModal(props: any) {
  const { BEE_WORKER_PRESET_LIST, BrainCircuit, Button, Check, ChevronRight, Copy, Cpu, Eye, FolderOpen, HERMES_UPDATE_INTEGRATION_KEYS, Image, KanbanSquare, LoaderCircle, MessageSquare, Minus, Pencil, PlugZap, Plus, RUNTIME_LABELS, RefreshCcw, Repeat2, Search, Send, Settings2, ShieldCheck, Sparkles, Upload, addHermesModelFromDraft, agentCreateDraft, agentCreateMachine, agentRenameDraft, agentRenameEditing, agentRuntimeAdvancedOpen, agentRuntimeFolderBrowsing, agentRuntimeFolderEditing, agentRuntimeFolderStatus, agentSettingsCustomWorker, agentSettingsCustomWorkers, agentSettingsDescription, agentSettingsIntegrationTarget, agentSettingsPanel, agentSettingsPreferredSkills, agentSettingsProvider, agentSettingsRuntime, agentSettingsSelectedCustomWorkerId, agentSettingsSkillProfile, agentSettingsTitle, agentSettingsWorkerClass, agentSettingsWorkerImage, agentSettingsWorkerLabel, agentSettingsWorkerPreset, agentWorkerClassView, applyCustomWorkerClass, beeRoleIconPath, browseAgentRuntimeFolder, closeAgentSettingsModal, createAgentFromModal, customWorkerDraft, customWorkerImageError, customWorkerImageInputRef, customWorkerSkillSearch, displayAgents, filteredCustomWorkerSkills, fleetClass, hermesUpdateRequired, openAgentSkillBrowser, openCustomWorkerClassCreator, providerIconPath, providerIconRenderMode, refreshRuntimeIntegrations, removeAgentPreferredSkill, roleModalAgent, runRuntimeIntegrationAction, runtimeAvailability, runtimeBackgroundPrompt, runtimeCapabilities, runtimeIconFallback, runtimeIconPath, runtimeIconRenderMode, runtimeIntegrationBusy, runtimeIntegrationMessage, runtimeIntegrationStatus, runtimeModelDraft, runtimeModelProviders, runtimeModelSelectionFresh, runtimeModelSetupMode, runtimeSessionQuery, runtimeSessionResults, runtimeSetupDefinition, runtimeSetupKey, runtimeUpdateConfirmKey, searchRuntimeSessionsForAgent, selectAgentWorkerClass, selectCustomWorkerClass, selectedRuntimeModelId, selectedRuntimeModels, selectedRuntimeProvider, setActiveView, setAgentCreateDraft, setAgentRenameDraft, setAgentRenameEditing, setAgentRuntimeAdvancedOpen, setAgentRuntimeFolderEditing, setAgentRuntimeFolderStatus, setAgentSettingsPanel, setAgentWorkerClassView, setCustomWorkerDraft, setCustomWorkerSkillSearch, setRuntimeBackgroundPrompt, setRuntimeModelDraft, setRuntimeModelSetupMode, setRuntimeSessionQuery, setRuntimeSetupKey, setRuntimeUpdateConfirmKey, sharedVault, startAgentChat, toggleCustomWorkerSkill, updateAgentProfile, updateAgentRuntimeModel, updateAgentSkillProfile, uploadCustomWorkerImage, workerCapabilityBadges } = props;
  const [aeonOauthConnecting, setAeonOauthConnecting] = useState(false);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const openRouterSelected = (selectedRuntimeProvider?.slug || agentSettingsProvider) === "openrouter";
  const usePodSelected = (selectedRuntimeProvider?.slug || agentSettingsProvider) === "usepod";
  const adaptiveSelected = openRouterSelected && selectedRuntimeModelId === "adaptive";
  const adaptiveOpenRouter = agentCreateMachine ? agentCreateDraft.adaptiveOpenRouter ?? {} : roleModalAgent?.adaptiveOpenRouter ?? {};
  const usePodConfig = agentCreateMachine ? agentCreateDraft.usePod ?? {} : roleModalAgent?.usePod ?? {};
  const hasUsePodSetup = (config = {}) => Boolean(
    config.tokenEnvName
      || config.depositAddress
      || config.depositCode
      || config.dashboardUrl
      || config.lastBalanceRemaining
      || config.lastRoute
      || config.lastCheckedAt
      || typeof config.lastModelCount === "number",
  );
  const isUsePodSetupReady = (config = {}) => config.lastTestStatus === "ready" || (typeof config.lastModelCount === "number" && config.lastModelCount > 0);
  const usePodSetupStarted = hasUsePodSetup(usePodConfig);
  const usePodSetupComplete = isUsePodSetupReady(usePodConfig);
  const usePodCreateBlocked = Boolean(agentCreateMachine && usePodSelected && !usePodSetupComplete);
  const existingUsePodAgents = (displayAgents ?? []).filter((agent) => agent.provider === "usepod" && hasUsePodSetup(agent.usePod));
  const unfinishedUsePodAgent = agentCreateMachine && !usePodSetupStarted
    ? existingUsePodAgents.find((agent) => !isUsePodSetupReady(agent.usePod)) ?? null
    : null;
  const completedUsePodWallets = unfinishedUsePodAgent
    ? []
    : existingUsePodAgents.filter((agent) => isUsePodSetupReady(agent.usePod));
  const usePodSetupTarget = unfinishedUsePodAgent ?? agentSettingsIntegrationTarget;
  const usePodRequiresCurrentSetup = usePodSetupStarted || Boolean(unfinishedUsePodAgent);
  const adaptiveUseCaseOptions = [
    { value: "auto", label: "Auto" },
    { value: "coding", label: "Coding" },
    { value: "writing", label: "Writing" },
    { value: "vision", label: "Vision" },
    { value: "image", label: "Image" },
    { value: "research", label: "Research" },
    { value: "tool-use", label: "Tools" },
  ];
  const updateAdaptiveOpenRouter = (patch: Record<string, unknown>) => {
    const next = { ...adaptiveOpenRouter, ...patch };
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, adaptiveOpenRouter: next }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { adaptiveOpenRouter: next });
  };
  const applyUsePodProfile = async (patch: Record<string, unknown>) => {
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
    await refreshRuntimeIntegrations({ ...(agentSettingsIntegrationTarget ?? {}), ...patch });
  };
  const applyUsePodSetupProfile = async (patch: Record<string, unknown>) => {
    if (agentCreateMachine && unfinishedUsePodAgent) {
      updateAgentProfile(unfinishedUsePodAgent.id, patch);
      await refreshRuntimeIntegrations({ ...unfinishedUsePodAgent, ...patch });
      return;
    }
    await applyUsePodProfile(patch);
  };
  const openAeonGithubOauth = () => {
    if (aeonOauthConnecting) return;
    setAeonOauthConnecting(true);
    updateAeonSettings({ aeonMode: "github" });
    requestAnimationFrame(() => {
      window.location.assign("/api/integrations/github/oauth/start?source=aeon");
    });
  };

  const updateSettingsRuntime = (runtime: AgentRuntime) => {
    if (runtime !== "aeon" && runtimeAvailability?.[runtime]?.installed === false) return;
    const sameRuntime = runtime === agentSettingsRuntime;
    const currentProvider = agentCreateMachine ? agentCreateDraft.provider : roleModalAgent?.provider;
    const currentModel = agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model;
    const aeonWorkerPreset = BEE_WORKER_PRESET_LIST.find((preset) => preset.id === "ops");
    const runtimeProvider = runtimeModelProviders.find((provider) => provider.slug === currentProvider);
    const runtimeSettings = runtimeSettingsFeature(runtime);
    const provider = sameRuntime
      ? currentProvider || runtimeSettings.defaultProvider || ""
      : runtimeSettings.defaultProvider || "";
    const model = sameRuntime && runtimeProvider
      ? currentModel || runtimeProvider.models[0]?.id || runtimeSettings.defaultModel || ""
      : sameRuntime ? currentModel || runtimeSettings.defaultModel || "" : runtimeSettings.defaultModel || "";
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({
        ...current,
        runtime,
        provider,
        model,
        name: current.name.trim() && current.name !== `${RUNTIME_LABELS[current.runtime] ?? current.runtime} on ${agentCreateMachine.name}`
          ? current.name
          : `${RUNTIME_LABELS[runtime] ?? runtime} on ${agentCreateMachine.name}`,
        ...(runtimeSettings.kind === "autopilot" && aeonWorkerPreset ? {
          workerClass: aeonWorkerPreset.id,
          skillProfilePrompt: aeonWorkerPreset.taskProfile,
          preferredSkillSlugs: aeonWorkerPreset.skillSlugs,
          aeonLocalPath: current.aeonLocalPath || "~/.aeon",
          aeonRepo: current.aeonRepo || "",
          aeonBranch: current.aeonBranch || "main",
          aeonMode: current.aeonMode || "github",
          a2aUrl: current.a2aUrl || "http://127.0.0.1:41241",
        } : {}),
      }));
    } else if (roleModalAgent) {
      updateAgentProfile(roleModalAgent.id, {
        runtime,
        provider,
        model,
        ...(runtimeSettings.kind === "autopilot" ? {
          agentId: roleModalAgent.agentId || runtimeSettings.defaultAgentId || "",
          localDataDir: roleModalAgent.localDataDir || "~/.aeon",
          aeonLocalPath: roleModalAgent.aeonLocalPath || roleModalAgent.localDataDir || "~/.aeon",
          aeonBranch: roleModalAgent.aeonBranch || "main",
          aeonMode: roleModalAgent.aeonMode || "github",
          a2aUrl: roleModalAgent.a2aUrl || "http://127.0.0.1:41241",
        } : {}),
      });
    }
  };

  const selectUsePodRuntime = () => {
    const currentModel = agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model;
    const nextUsePod = {
      tokenEnvName: usePodConfig.tokenEnvName || "USEPOD_TOKEN",
      depositAddress: usePodConfig.depositAddress || "",
      depositCode: usePodConfig.depositCode || "",
      dashboardUrl: usePodConfig.dashboardUrl || "",
      maxPriceInputMicrounits: usePodConfig.maxPriceInputMicrounits || "2000",
      maxPriceOutputMicrounits: usePodConfig.maxPriceOutputMicrounits || "8000",
      spendPreset: usePodConfig.spendPreset || "balanced",
      lastBalanceRemaining: usePodConfig.lastBalanceRemaining || "",
      lastRoute: usePodConfig.lastRoute || "",
      lastCheckedAt: usePodConfig.lastCheckedAt || "",
      lastTestStatus: usePodConfig.lastTestStatus || "",
      lastModelCount: usePodConfig.lastModelCount,
    };
    const patch = {
      runtime: "openai-compatible",
      provider: "usepod",
      model: currentModel || "gpt-5.5",
      gatewayUrl: "https://api.usepod.ai",
      chatPath: "/v1/chat/completions",
      statusPath: "/v1/models",
      usePod: nextUsePod,
    };
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({
        ...current,
        ...patch,
        name: current.name.trim() && current.name !== `${RUNTIME_LABELS[current.runtime] ?? current.runtime} on ${agentCreateMachine.name}`
          ? current.name
          : `UsePod on ${agentCreateMachine.name}`,
      }));
      setRuntimeModelSetupMode("provider");
      return;
    }
    if (roleModalAgent) {
      updateAgentProfile(roleModalAgent.id, patch);
      setRuntimeModelSetupMode("provider");
    }
  };

  const renderRuntimeMark = (runtime: string, label: string) => {
    const iconPath = runtimeIconPath(runtime);
    const iconMode = runtimeIconRenderMode(runtime);
    return (
      <span className={fleetClass("runtimeIconMark")} aria-hidden="true">
        {iconPath ? (
          <span
            className={iconMode === "mask" ? fleetClass("runtimeIconMask") : fleetClass("runtimeIconImage")}
            style={iconMode === "mask" ? { "--runtime-icon": `url(${iconPath})` } : { "--runtime-image": `url(${iconPath})` }}
          />
        ) : <b>{runtimeIconFallback(runtime, label)}</b>}
      </span>
    );
  };
  const agentSettingsWorkerSubtitle = (agentSettingsCustomWorker?.label || agentSettingsWorkerPreset?.label || agentSettingsWorkerLabel || "")
    .replace(/\s+bee$/i, "")
    .trim();
  const selectedRuntimeSettings = runtimeSettingsFeature(agentSettingsRuntime);
  const modelSelectableRuntime = Boolean(runtimeCapabilities(agentSettingsIntegrationTarget ?? roleModalAgent)?.modelSelection);
  const runtimeModelPanelAvailable = selectedRuntimeSettings.modelSource === "runtime" && (runtimeModelProviders.length > 0
    || modelSelectableRuntime
    || runtimeIntegrationBusy === "status"
    || Boolean(runtimeIntegrationMessage));
  const runtimeCanAddModels = Boolean(selectedRuntimeSettings.canAddModels);
  const runtimeCanAddUsePod = Boolean(selectedRuntimeSettings.canUsePod);
  const hasRuntimeProviders = runtimeModelProviders.length > 0;
  const runtimeCanAddCustomModel = runtimeCanAddModels && hasRuntimeProviders;
  const runtimeLabel = RUNTIME_LABELS[agentSettingsRuntime] ?? agentSettingsRuntime;
  const showProviderDiscovery = !runtimeModelProviders.length && modelSelectableRuntime && !usePodSelected && !runtimeModelSelectionFresh && !runtimeIntegrationMessage;
  const runtimeProviderEmptyTitle = "No providers configured";
  const runtimeProviderEmptyDetail = runtimeIntegrationMessage || `Add a provider, or refresh ${runtimeLabel} models from this machine.`;
  const runtimeModelEmptyTitle = runtimeIntegrationBusy === "status"
    ? "Loading models..."
    : hasRuntimeProviders ? "No models configured" : "Add a provider first";
  const runtimeModelEmptyDetail = runtimeIntegrationMessage
    || (hasRuntimeProviders
      ? "Add a model to the selected provider when it is not discovered automatically."
      : "Models appear after a provider is connected.");
  const runtimeModelOptions = openRouterSelected
    ? [
      { id: "adaptive", name: "Adaptive" },
      ...selectedRuntimeModels.filter((model) => model.id !== "adaptive"),
    ]
    : selectedRuntimeModels;
  const runtimeModelProviderSlug = selectedRuntimeProvider?.slug ?? agentSettingsProvider;
  const runtimeModelRegistry = summarizeRuntimeModelRegistry(runtimeModelProviders, runtimeModelProviderSlug);
  const aeonAvailability = runtimeAvailability?.aeon;
  const aeonDetected = agentSettingsRuntime === "aeon" && aeonAvailability?.installed === true;
  const aeonNeedsSetup = agentSettingsRuntime === "aeon" && !aeonDetected;
  const isAutopilotSettings = selectedRuntimeSettings.kind === "autopilot";
  const showWorkerClassSection = !isAutopilotSettings && !(usePodSelected && !usePodSetupComplete);
  const hideRuntimeSection = !agentCreateMachine && Boolean(selectedRuntimeSettings.hidesRuntimeSelectorWhenEditing);
  const runtimeFolderValue = roleModalAgent
    ? isAutopilotSettings
      ? roleModalAgent.aeonLocalPath || roleModalAgent.localDataDir || ""
      : roleModalAgent.localDataDir || ""
    : "";
  const aeonSettings = {
    mode: agentCreateMachine ? agentCreateDraft.aeonMode || "github" : roleModalAgent?.aeonMode || "github",
    repo: agentCreateMachine ? agentCreateDraft.aeonRepo || "" : roleModalAgent?.aeonRepo || "",
    branch: agentCreateMachine ? agentCreateDraft.aeonBranch || "main" : roleModalAgent?.aeonBranch || "main",
    path: agentCreateMachine ? agentCreateDraft.aeonLocalPath || "~/.aeon" : roleModalAgent?.aeonLocalPath || roleModalAgent?.localDataDir || "",
    a2aUrl: agentCreateMachine ? agentCreateDraft.a2aUrl || "http://127.0.0.1:41241" : roleModalAgent?.a2aUrl || roleModalAgent?.gatewayUrl || "http://127.0.0.1:41241",
  };
  const updateAeonSettings = (patch: Record<string, unknown>) => {
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({ ...current, ...patch }));
      return;
    }
    if (!roleModalAgent) return;
    updateAgentProfile(roleModalAgent.id, patch);
  };
  const aeonModeCopy = aeonSettings.mode === "github"
    ? "Runs through the configured GitHub repo and branch."
    : aeonSettings.mode === "a2a"
      ? "Talks to a running AEON A2A gateway."
      : "Reads the local AEON repo folder on this machine.";
  const agentSettingsPanels = agentCreateMachine
    ? selectedRuntimeSettings.createPanels
    : selectedRuntimeSettings.editPanels;
  const activeAgentSettingsPanel = (agentSettingsPanels as readonly string[]).includes(agentSettingsPanel)
    ? agentSettingsPanel
    : agentSettingsPanels[0];

  if (!portalTarget) return null;

  return createPortal((<>
      {roleModalAgent || agentCreateMachine ? (
        <div
          className={fleetClass("setupModalBackdrop")}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAgentSettingsModal();
          }}
        >
          <section className={fleetClass("setupModal", "agentSettingsModal")} role="dialog" aria-modal="true" aria-labelledby="agent-settings-title">
            <div className={fleetClass("setupModalHeader")}>
              <div className={fleetClass("agentSettingsHeaderCopy")}>
                <p className="eyebrow">{agentSettingsTitle}</p>
                {agentCreateMachine ? (
                  <div className={fleetClass("agentNameEdit")}>
                    <input
                      id="agent-settings-title"
                      value={agentCreateDraft.name}
                      onChange={(event) => setAgentCreateDraft((current) => ({ ...current, name: event.target.value }))}
                      aria-label="Agent name"
                      placeholder={`${RUNTIME_LABELS[agentCreateDraft.runtime]} on ${agentCreateMachine.name}`}
                      autoFocus
                    />
                  </div>
                ) : roleModalAgent ? (
                  <InlineRenameControl
                    value={roleModalAgent.name}
                    draft={agentRenameDraft}
                    editing={agentRenameEditing}
                    inputId="agent-settings-title"
                    inputAriaLabel="Agent name"
                    editAriaLabel="Rename agent"
                    saveAriaLabel="Save agent name"
                    cancelAriaLabel="Cancel agent name edit"
                    formClassName={fleetClass("agentNameEdit")}
                    onDraftChange={setAgentRenameDraft}
                    onStartEditing={() => {
                      setAgentRenameDraft(roleModalAgent.name);
                      setAgentRenameEditing(true);
                    }}
                    onCancel={() => {
                      setAgentRenameDraft(roleModalAgent.name);
                      setAgentRenameEditing(false);
                    }}
                    onSubmit={(nextName) => {
                      updateAgentProfile(roleModalAgent.id, { name: nextName });
                      setAgentRenameEditing(false);
                    }}
                    renderDisplay={({ value, editButton }) => (
                      <div className={fleetClass("agentNameDisplay")}>
                        <div className={fleetClass("agentIdentityBlock")}>
                          <div className={fleetClass("agentNameTitleRow")}>
                            <h2 id="agent-settings-title">{value}</h2>
                            {editButton}
                          </div>
                          {agentSettingsWorkerSubtitle ? <span className={fleetClass("agentRoleBadge")}>{agentSettingsWorkerSubtitle}</span> : null}
                        </div>
                      </div>
                    )}
                  />
                ) : null}
                <p className={fleetClass("agentSettingsDescription")}>{agentSettingsDescription}</p>
              </div>
              <CloseIconButton aria-label="Close agent settings" onClick={closeAgentSettingsModal} />
            </div>

            {agentSettingsPanels.length > 1 ? (
              <div className={fleetClass("agentSettingsTabs")} role="tablist" aria-label="Agent settings sections">
                {agentSettingsPanels.map((panel) => (
                  <button
                    type="button"
                    key={panel}
                    className={activeAgentSettingsPanel === panel ? fleetClass("activeSegment") : ""}
                    onClick={() => setAgentSettingsPanel(panel)}
                  >
                    {panel === "role" ? "Role" : panel === "connection" ? "Connection" : panel === "memory" ? "Memory" : panel === "tools" ? "Tools" : panel === "calls" ? "Calls" : "Security"}
                  </button>
                ))}
              </div>
            ) : null}

            {activeAgentSettingsPanel === "role" ? (
              <div className={fleetClass("agentSettingsGrid")}>
                {!hideRuntimeSection ? (
                  <div className={fleetClass("agentSettingsField", "agentRuntimeSelectField")}>
                    <span>Runtime</span>
                    <div className={fleetClass("agentRuntimeSegments")} role="group" aria-label="Runtime">
	                      {Object.entries(RUNTIME_LABELS).map(([runtime, label]) => {
                        const runtimeSettings = runtimeSettingsFeature(runtime as AgentRuntime);
                        const selected = runtime === (agentCreateMachine ? agentCreateDraft.runtime : roleModalAgent?.runtime ?? "hermes");
                        const unavailable = runtimeAvailability?.[runtime]?.installed === false;
                        const selectableUnavailable = unavailable && runtimeSettings.kind !== "autopilot";
                        const title = runtimeSettings.kind === "autopilot" && unavailable ? `${label} needs setup. Select it to create a background profile.` : unavailable ? `${label} is not installed.` : runtimeAvailability?.[runtime]?.detail;
                        return (
                          <span className={fleetClass("runtimeSegmentShell")} key={runtime} title={title}>
                            <button
                              type="button"
                              aria-pressed={selected}
                              aria-describedby={unavailable ? `runtime-${runtime}-unavailable` : undefined}
                              className={selected ? fleetClass("selectedRuntimeSegment") : ""}
                              disabled={selectableUnavailable}
                              onClick={() => updateSettingsRuntime(runtime as AgentRuntime)}
                            >
                              {renderRuntimeMark(runtime, label)}
                              <strong>{label}</strong>
                              {runtimeSettings.runtimeSegmentSubcopy ? <small className={fleetClass("runtimeSegmentSubcopy")}>{unavailable ? runtimeSettings.unavailableSubcopy || "Needs setup" : runtimeSettings.runtimeSegmentSubcopy}</small> : null}
                            </button>
                            {unavailable ? <span id={`runtime-${runtime}-unavailable`} className="sr-only">{runtimeSettings.kind === "autopilot" ? `${label} needs setup.` : `${label} is not installed.`}</span> : null}
                          </span>
                        );
                      })}
                      <span className={fleetClass("runtimeSegmentShell")} title="UsePod runs through an OpenAI-compatible endpoint and does not need a local OpenAI server.">
                        <button
                          type="button"
                          aria-pressed={agentSettingsRuntime === "openai-compatible" && usePodSelected}
                          className={agentSettingsRuntime === "openai-compatible" && usePodSelected ? fleetClass("selectedRuntimeSegment") : ""}
                          onClick={selectUsePodRuntime}
                        >
                          <span
                            className={fleetClass("runtimeIconMark")}
                            aria-hidden="true"
                            style={USEPOD_RUNTIME_ICON_MARK_STYLE}
                          >
                            <span
                              className={fleetClass("runtimeIconImage")}
                              style={USEPOD_RUNTIME_ICON_IMAGE_STYLE}
                            />
                          </span>
                          <strong>UsePod</strong>
                        </button>
                      </span>
                    </div>
                  </div>
                ) : null}
                {!hideRuntimeSection && isAutopilotSettings ? (
                  <div className={fleetClass("agentRuntimeAeonPanel")}>
                    <div className={fleetClass("agentRuntimeAeonHeader")}>
                      {renderRuntimeMark("aeon", "Aeon")}
                      <div>
                        <strong>Aeon Autopilot profile</strong>
                        <p>Aeon runs unattended skills through schedules and GitHub Actions. Models live on each Aeon skill, so this profile skips provider/model selection.</p>
                      </div>
                    </div>
                    <div className={fleetClass("agentRuntimeAeonChecklist")}>
                      <span><Check aria-hidden="true" /> Background runtime</span>
                      <span><Repeat2 aria-hidden="true" /> Schedules and runs</span>
                      <span><BrainCircuit aria-hidden="true" /> Shared skills sync</span>
                      <span><Upload aria-hidden="true" /> GitHub secret sync</span>
                    </div>
                    <div className={fleetClass("agentRuntimeAeonStatus")}>
                      <strong>{aeonNeedsSetup ? "Needs setup" : "Detected"}</strong>
                      <p>{aeonAvailability?.detail || "HivemindOS will create a profile pointed at ~/.aeon and send you to the Autopilot dashboard to connect aeon.yml, GitHub repo, A2A, and outputs."}</p>
                    </div>
                    <div className={fleetClass("agentRuntimeAeonActions")}>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setActiveView?.("aeon");
                          closeAgentSettingsModal();
                        }}
                      >
                        <Sparkles aria-hidden="true" />
                        Open Autopilot
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setAgentSettingsPanel("memory")}>
                        <BrainCircuit aria-hidden="true" />
                        Memory
                      </Button>
                    </div>
                  </div>
                ) : !hideRuntimeSection && runtimeModelPanelAvailable ? (
                  <div className={fleetClass("agentRuntimeModelPanel")}>
                    {usePodSelected ? (
                      <div className={fleetClass("agentRuntimeModelSetup", "agentRuntimeModelSetupProvider")}>
                        <GuidedUsePodSetup
                          key={usePodSetupTarget?.id ?? "new-usepod"}
                          agent={usePodSetupTarget}
                          busy={runtimeIntegrationBusy}
                          existingWallets={completedUsePodWallets}
                          fleetClass={fleetClass}
                          requireCurrentSetup={usePodRequiresCurrentSetup}
                          recoverSavedSetup={!agentCreateMachine}
                          onCancel={closeAgentSettingsModal}
                          onComplete={applyUsePodSetupProfile}
                        />
                      </div>
                    ) : (
                      <>
	                    <div className={fleetClass("agentRuntimeCardGroup")}>
	                      <div className={fleetClass("agentRuntimeGroupHeader")}>
	                        <span>Provider</span>
	                        <button
                          type="button"
                          aria-label={`Refresh ${RUNTIME_LABELS[agentSettingsRuntime] ?? agentSettingsRuntime} models`}
                          title={`Refresh ${RUNTIME_LABELS[agentSettingsRuntime] ?? agentSettingsRuntime} models`}
                          disabled={runtimeIntegrationBusy === "status"}
                          onClick={() => void refreshRuntimeIntegrations(agentSettingsIntegrationTarget ?? undefined)}
                        >
                          {runtimeIntegrationBusy === "status" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RefreshCcw aria-hidden="true" />}
                        </button>
                      </div>
                      <div className={fleetClass("agentRuntimeProviderCards")}>
                        {runtimeCanAddUsePod ? (
                          <button
                            type="button"
                            className={usePodSelected ? fleetClass("agentRuntimeProviderCard", "selectedRuntimeCard") : fleetClass("agentRuntimeProviderCard")}
                            aria-pressed={usePodSelected}
                            onClick={() => setRuntimeModelSetupMode((current) => current === "provider" ? null : "provider")}
                          >
                            <span className={fleetClass("providerCardTitle")}>
                              <span
                                className={fleetClass("runtimeIconMark")}
                                aria-hidden="true"
                                style={USEPOD_RUNTIME_ICON_MARK_STYLE}
                              >
                                <span
                                  className={fleetClass("runtimeIconImage")}
                                  style={USEPOD_RUNTIME_ICON_IMAGE_STYLE}
                                />
                              </span>
                              <strong>UsePod</strong>
                            </span>
                            <small>Marketplace inference</small>
                          </button>
                        ) : null}
                        {runtimeModelProviders.map((provider) => {
                          const selected = provider.slug === selectedRuntimeProvider?.slug;
                          const iconPath = providerIconPath(provider);
                          const iconMode = providerIconRenderMode(provider);
                          return (
                            <button
                              type="button"
                              key={provider.slug}
                              className={selected ? fleetClass("agentRuntimeProviderCard", "selectedRuntimeCard") : fleetClass("agentRuntimeProviderCard")}
                              aria-pressed={selected}
                              onClick={() => updateAgentRuntimeModel(provider.slug, provider.models[0]?.id ?? "")}
                            >
                              <span className={fleetClass("providerCardTitle")}>
                                {iconPath ? (
                                  <span className={fleetClass("runtimeIconMark")} aria-hidden="true">
                                    <span
                                      className={iconMode === "mask" ? fleetClass("runtimeIconMask") : fleetClass("runtimeIconImage")}
                                      style={iconMode === "mask" ? { "--runtime-icon": `url(${iconPath})` } : { "--runtime-image": `url(${iconPath})` }}
                                    />
                                  </span>
                                ) : null}
                                <strong>{provider.name}</strong>
                              </span>
                              <small>{provider.totalModels} model{provider.totalModels === 1 ? "" : "s"}</small>
                            </button>
                          );
                        })}
                        {showProviderDiscovery ? (
                          <ProviderDiscoveryCard fleetClass={fleetClass} runtimeLabel={runtimeLabel} />
                        ) : !runtimeModelProviders.length ? (
                          <div className={fleetClass("agentRuntimeEmptyCard")}>
                            <strong>{runtimeProviderEmptyTitle}</strong>
                            <small>{runtimeProviderEmptyDetail}</small>
                          </div>
                        ) : null}
                        {runtimeCanAddModels ? (
                          <button
                            type="button"
                            className={fleetClass("agentRuntimeAddCard")}
                            onClick={() => setRuntimeModelSetupMode((current) => current === "provider" ? null : "provider")}
                          >
                            <Plus aria-hidden="true" />
                            <strong>Add provider</strong>
                          </button>
                        ) : null}
                      </div>
                    </div>
	                    <div className={fleetClass("agentRuntimeCardGroup")}>
	                      <div className={fleetClass("agentRuntimeGroupHeader")}>
	                        <span>Model</span>
	                      </div>
                      <ModelPillSelector
                        models={runtimeModelOptions}
                        selectedModelId={selectedRuntimeModelId}
                        disabled={Boolean(runtimeIntegrationBusy)}
                        canAddModel={runtimeCanAddCustomModel}
                        emptyLabel={`${runtimeModelEmptyTitle}. ${runtimeModelEmptyDetail}`}
                        onSelectModel={(modelId) => updateAgentRuntimeModel(modelId === "adaptive" ? "openrouter" : runtimeModelProviderSlug, modelId)}
                        onAddModel={() => setRuntimeModelSetupMode((current) => current === "model" ? null : "model")}
                      />
                    </div>
                    {adaptiveSelected ? (
                      <details className={fleetClass("adaptiveAdvanced")}>
                        <summary>
                          <span>Advanced</span>
                          <small>{adaptiveOpenRouter.useCase && adaptiveOpenRouter.useCase !== "auto" ? adaptiveOpenRouter.useCase : "Auto"}</small>
                        </summary>
                        <div className={fleetClass("adaptiveAdvancedGrid")}>
                          <label className={fleetClass("agentSettingsField")}>
                            <span>Agent type</span>
                            <select
                              value={adaptiveOpenRouter.useCase || "auto"}
                              onChange={(event) => updateAdaptiveOpenRouter({ useCase: event.target.value })}
                            >
                              {adaptiveUseCaseOptions.map((option) => (
                                <option value={option.value} key={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>
                          <label className={fleetClass("agentSettingsField")}>
                            <span>Paid fallback</span>
                            <select
                              value={adaptiveOpenRouter.fallbackModel || ""}
                              onChange={(event) => updateAdaptiveOpenRouter({ fallbackModel: event.target.value })}
                            >
                              <option value="">No paid fallback</option>
                              {selectedRuntimeModels
                                .filter((model) => model.id !== "adaptive")
                                .map((model) => (
                                  <option value={model.id} key={model.id}>{model.name || model.id}</option>
                                ))}
                            </select>
                          </label>
                        </div>
                      </details>
                    ) : null}
                    {((runtimeModelSetupMode === "model" && runtimeCanAddCustomModel) || (runtimeModelSetupMode === "provider" && (runtimeCanAddModels || runtimeCanAddUsePod))) ? (
                      <div
                        className={fleetClass(
                          "agentRuntimeModelSetup",
                          runtimeModelSetupMode === "provider" ? "agentRuntimeModelSetupProvider" : "agentRuntimeModelSetupModel",
                        )}
                      >
                        {runtimeModelSetupMode === "provider" && runtimeCanAddUsePod ? (
                          <GuidedUsePodSetup
                            key={usePodSetupTarget?.id ?? "new-usepod"}
                            agent={usePodSetupTarget}
                            busy={runtimeIntegrationBusy}
                            existingWallets={completedUsePodWallets}
                            fleetClass={fleetClass}
                            requireCurrentSetup={usePodRequiresCurrentSetup}
                            recoverSavedSetup={!agentCreateMachine}
                            onCancel={() => setRuntimeModelSetupMode(null)}
                            onComplete={applyUsePodSetupProfile}
                          />
                        ) : runtimeModelSetupMode === "provider" ? (
                          <GuidedProviderSetup
                            agent={agentSettingsIntegrationTarget}
                            busy={runtimeIntegrationBusy}
                            fleetClass={fleetClass}
                            runtime={agentSettingsRuntime}
                            onCancel={() => setRuntimeModelSetupMode(null)}
                            onComplete={async () => {
                              await refreshRuntimeIntegrations(agentSettingsIntegrationTarget ?? undefined);
                              setRuntimeModelSetupMode(null);
                            }}
                          />
                        ) : (
                          <>
                            <div>
                              <strong>Add model</strong>
                              <p>{`Add an exact model ID to ${selectedRuntimeProvider?.name ?? "this provider"}.`}</p>
                            </div>
                            <label className={fleetClass("agentSettingsField")}>
                              <span>Provider</span>
                              <select
                                value={runtimeModelDraft.provider || selectedRuntimeProvider?.slug || ""}
                                onChange={(event) => setRuntimeModelDraft((current) => ({ ...current, provider: event.target.value }))}
                              >
                                {runtimeModelProviders.map((provider) => (
                                  <option value={provider.slug} key={provider.slug}>{provider.name}</option>
                                ))}
                              </select>
                            </label>
                        <label className={fleetClass("agentSettingsField")}>
                          <span>Custom model ID</span>
                          <input
                            value={runtimeModelDraft.model}
                            onChange={(event) => setRuntimeModelDraft((current) => ({ ...current, model: event.target.value }))}
                            placeholder="Paste exact model ID"
                          />
                        </label>
                        <label className={fleetClass("agentSettingsField")}>
                          <span>Context</span>
                          <select
                            value={runtimeModelDraft.contextLength}
                            onChange={(event) => setRuntimeModelDraft((current) => ({ ...current, contextLength: event.target.value }))}
                          >
                            <option value="">Auto</option>
                            <option value="128000">128k</option>
                            <option value="200000">200k</option>
                            <option value="400000">400k</option>
                            <option value="1000000">1M</option>
                          </select>
                        </label>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={!runtimeModelDraft.model.trim() || runtimeIntegrationBusy === "add-model"}
                          onClick={() => void addHermesModelFromDraft()}
                        >
                          {runtimeIntegrationBusy === "add-model" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Plus aria-hidden="true" />}
                          Add
                        </Button>
                          </>
                        )}
                      </div>
                    ) : null}
                      </>
                    )}
                  </div>
                ) : null}
                {!hideRuntimeSection && !agentCreateMachine && roleModalAgent ? (
                  <div className={fleetClass("agentRuntimeSummary")}>
                    <PlugZap aria-hidden="true" />
                    <div>
                      <strong>{RUNTIME_LABELS[roleModalAgent.runtime]} is connected</strong>
                      <p>Connection details are managed automatically. Open Advanced only for custom bridges or repairs.</p>
                    </div>
                    <button type="button" onClick={() => setAgentRuntimeAdvancedOpen((current) => !current)}>
                      {agentRuntimeAdvancedOpen ? "Hide advanced" : "Advanced"}
                    </button>
                  </div>
                ) : null}
                {!hideRuntimeSection && agentRuntimeAdvancedOpen && !agentCreateMachine && roleModalAgent ? (
                  <div className={fleetClass("agentRuntimeAdvanced")}>
                    <label className={fleetClass("agentSettingsField")}>
                      <span>Chat URL / gateway</span>
                      <input
                        value={roleModalAgent.gatewayUrl ?? ""}
                        onChange={(event) => updateAgentProfile(roleModalAgent.id, { gatewayUrl: event.target.value })}
                        placeholder="http://machine:8787/chat or ws://127.0.0.1:18789"
                      />
                    </label>
                    <label className={fleetClass("agentSettingsField")}>
                      <span>Agent ID / session</span>
                      <input
                        value={roleModalAgent.agentId ?? ""}
                        onChange={(event) => updateAgentProfile(roleModalAgent.id, { agentId: event.target.value })}
                        placeholder="local-hermes, main, seo-agent"
                      />
                    </label>
                    <label className={fleetClass("agentSettingsField")}>
                      <span>Agent bridge</span>
                      <input
                        value={roleModalAgent.telemetryUrl ?? ""}
                        onChange={(event) => updateAgentProfile(roleModalAgent.id, { telemetryUrl: event.target.value })}
                      />
                    </label>
                  </div>
                ) : null}
                {showWorkerClassSection ? (
                <div className={fleetClass("agentSettingsField", "agentWorkerClassPicker")}>
                  <span>Worker class</span>
                  {agentWorkerClassView === "presets" ? (
                    <>
                      <div className={fleetClass("agentWorkerClassGrid")}>
                        {BEE_WORKER_PRESET_LIST.map((preset) => {
                          const selectedClass = preset.id === agentSettingsWorkerClass && !agentSettingsCustomWorker;
                          return (
                            <button
                              type="button"
                              key={preset.id}
                              className={selectedClass ? fleetClass("selectedWorkerClass") : ""}
                              onClick={() => selectAgentWorkerClass(preset.id)}
                              aria-pressed={selectedClass}
                            >
                              <Image src={beeRoleIconPath("worker", preset.id)} alt="" width={54} height={54} unoptimized />
                              <strong>{preset.label}</strong>
                            </button>
                          );
                        })}
                        {agentSettingsCustomWorkers.map((customWorkerClass) => (
                          <button
                            type="button"
                            key={customWorkerClass.id}
                            className={agentSettingsSelectedCustomWorkerId === customWorkerClass.id ? fleetClass("selectedWorkerClass", "customWorkerClassCard") : fleetClass("customWorkerClassCard")}
                            onClick={() => selectCustomWorkerClass(customWorkerClass)}
                            aria-pressed={agentSettingsSelectedCustomWorkerId === customWorkerClass.id}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={customWorkerClass.imageSrc || beeRoleIconPath("worker", "general")} alt="" />
                            <strong>{customWorkerClass.label}</strong>
                          </button>
                        ))}
                        <button type="button" className={fleetClass("agentWorkerClassCreate")} onClick={openCustomWorkerClassCreator}>
                          <Plus aria-hidden="true" />
                          <strong>Custom</strong>
                        </button>
                      </div>
                      <div className={fleetClass("agentWorkerClassDetail")}>
                        <div>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={agentSettingsWorkerImage} alt="" />
                          <div>
                            <strong>{agentSettingsWorkerLabel}</strong>
                            <div className={fleetClass("agentWorkerCapabilityBadges")}>
                              {(agentSettingsCustomWorker ? workerCapabilityBadges(agentSettingsSkillProfile) : workerCapabilityBadges(agentSettingsWorkerPreset.summary)).map((capability) => (
                                <span key={capability}>{capability}</span>
                              ))}
                            </div>
                            <small>{agentSettingsCustomWorker ? "Custom worker class" : agentSettingsWorkerPreset.modelHint}</small>
                          </div>
                        </div>
                        <label>
                          <span>Suited-for prompt</span>
                          <textarea
                            value={agentSettingsSkillProfile}
                            onChange={(event) => updateAgentSkillProfile(event.target.value)}
                          />
                        </label>
                        <div className={fleetClass("agentWorkerSkillSet")}>
                          <span>Seeded shared-brain skills</span>
                          <div>
                            {agentSettingsPreferredSkills.map((slug) => (
                              <button
                                type="button"
                                key={slug}
                                className={fleetClass("agentWorkerSkillBadge")}
                                aria-label={`Remove ${slug} skill`}
                                onClick={() => removeAgentPreferredSkill(slug)}
                              >
                                <span>{slug}</span>
                                <Minus aria-hidden="true" />
                              </button>
                            ))}
                            <button type="button" className={fleetClass("agentWorkerAddSkillBadge")} onClick={() => void openAgentSkillBrowser()}>
                              <Plus aria-hidden="true" />
                              Add Skill
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className={fleetClass("agentWorkerClassCreator")}>
                      <div className={fleetClass("agentWorkerCreatorHeader")}>
                        <button type="button" onClick={() => setAgentWorkerClassView("presets")}>
                          <ChevronRight aria-hidden="true" />
                          Back
                        </button>
                        <strong>Custom worker class</strong>
                      </div>
                      <label className={fleetClass("agentSettingsField")}>
                        <span>Role name</span>
                        <input
                          value={customWorkerDraft.label}
                          onChange={(event) => setCustomWorkerDraft((current) => ({ ...current, label: event.target.value }))}
                          placeholder="Data scout, Social analyst, Build fixer"
                        />
                      </label>
                      <div className={fleetClass("agentWorkerImagePicker")}>
                        <span>Bee image</span>
                        <div>
                          {BEE_WORKER_PRESET_LIST.map((preset) => {
                            const imageSrc = beeRoleIconPath("worker", preset.id);
                            return (
                              <button
                                type="button"
                                key={preset.id}
                                className={customWorkerDraft.imageSrc === imageSrc ? fleetClass("selectedWorkerClass") : ""}
                                onClick={() => setCustomWorkerDraft((current) => ({ ...current, imageSrc }))}
                                aria-label={`Use ${preset.label} bee image`}
                              >
                                <Image src={imageSrc} alt="" width={42} height={42} unoptimized />
                              </button>
                            );
                          })}
                          <button type="button" onClick={() => customWorkerImageInputRef.current?.click()}>
                            <Upload aria-hidden="true" />
                          </button>
                        </div>
                        <input ref={customWorkerImageInputRef} type="file" accept="image/*" onChange={uploadCustomWorkerImage} hidden />
                        {customWorkerImageError ? <small>{customWorkerImageError}</small> : null}
                      </div>
                      <label className={fleetClass("agentSettingsField")}>
                        <span>Suited-for prompt</span>
                        <textarea
                          value={customWorkerDraft.skillProfilePrompt}
                          onChange={(event) => setCustomWorkerDraft((current) => ({ ...current, skillProfilePrompt: event.target.value }))}
                          placeholder="Describe when this worker should be used and what it should be good at."
                        />
                      </label>
                      <div className={fleetClass("agentWorkerSkillChooser")}>
                        <label>
                          <span>Shared brain skills</span>
                          <input
                            value={customWorkerSkillSearch}
                            onChange={(event) => setCustomWorkerSkillSearch(event.target.value)}
                            placeholder="Search by skill name or keyword"
                          />
                        </label>
                        <div>
                          {filteredCustomWorkerSkills.length ? filteredCustomWorkerSkills.map((skill) => (
                            <button
                              type="button"
                              key={skill.slug}
                              className={skill.selected ? fleetClass("selectedSkillBadge") : ""}
                              onClick={() => toggleCustomWorkerSkill(skill.slug)}
                            >
                              {skill.name}
                            </button>
                          )) : <p>No matching shared-brain skills.</p>}
                        </div>
                      </div>
                      <div className={fleetClass("agentWorkerCreatorActions")}>
                        <button type="button" onClick={() => setAgentWorkerClassView("presets")}>Cancel</button>
                        <button type="button" onClick={applyCustomWorkerClass} disabled={!customWorkerDraft.label.trim() || !customWorkerDraft.skillProfilePrompt.trim()}>
                          <Check aria-hidden="true" />
                          Use class
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                ) : null}
              </div>
            ) : null}

            {activeAgentSettingsPanel === "connection" && isAutopilotSettings ? (
              <div className={fleetClass("agentSettingsGrid", "agentMemoryPanel")}>
                <div className={fleetClass("aeonConnectionPanel")}>
                    <div className={fleetClass("aeonConnectionHeader")}>
                      <div>
                        <span>AEON connection</span>
                        <strong>{aeonSettings.mode === "github" ? "GitHub Actions" : aeonSettings.mode === "a2a" ? "A2A gateway" : "Local repo"}</strong>
                      </div>
                      <p>{aeonModeCopy}</p>
                    </div>
                    <div className={fleetClass("aeonModeCards")} role="radiogroup" aria-label="AEON connection mode">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={aeonSettings.mode === "local"}
                        className={aeonSettings.mode === "local" ? fleetClass("selectedAeonModeCard") : ""}
                        onClick={() => updateAeonSettings({ aeonMode: "local" })}
                      >
                        <FolderOpen aria-hidden="true" />
                        <span>Local repo</span>
                        <small>Use files on this Mac</small>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={aeonSettings.mode === "github"}
                        className={aeonSettings.mode === "github" ? fleetClass("selectedAeonModeCard") : ""}
                        onClick={() => updateAeonSettings({ aeonMode: "github" })}
                      >
                        <Upload aria-hidden="true" />
                        <span>GitHub</span>
                        <small>Use repo + branch</small>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={aeonSettings.mode === "a2a"}
                        className={aeonSettings.mode === "a2a" ? fleetClass("selectedAeonModeCard") : ""}
                        onClick={() => updateAeonSettings({ aeonMode: "a2a" })}
                      >
                        <PlugZap aria-hidden="true" />
                        <span>A2A</span>
                        <small>Use gateway URL</small>
                      </button>
                    </div>
                    {aeonSettings.mode === "github" ? (
                      <div className={fleetClass("aeonGithubConnect")}>
                        <div className={fleetClass("aeonOauthCard")}>
                          <span className={fleetClass("aeonOauthIcon")}><Upload aria-hidden="true" /></span>
                          <div>
                            <strong>Connect with GitHub OAuth</strong>
                            <p>Connects through GitHub OAuth directly and saves <code>GH_GLOBAL</code> with repo, workflow, hook, org, and email access, never delete-repo access.</p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            disabled={aeonOauthConnecting}
                            onClick={openAeonGithubOauth}
                          >
                            {aeonOauthConnecting ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <PlugZap aria-hidden="true" />}
                            {aeonOauthConnecting ? "Opening GitHub..." : "Connect GitHub"}
                          </Button>
                        </div>
                        <div className={fleetClass("aeonManualDivider")}><span>or enter repo manually</span></div>
                        <div className={fleetClass("aeonConnectionFields")}>
                          <label className={fleetClass("agentSettingsField")}>
                            <span>GitHub repo</span>
                            <input
                              value={aeonSettings.repo}
                              onChange={(event) => updateAeonSettings({ aeonRepo: event.target.value })}
                              placeholder="owner/repo"
                            />
                          </label>
                          <label className={fleetClass("agentSettingsField")}>
                            <span>Branch</span>
                            <input
                              value={aeonSettings.branch}
                              onChange={(event) => updateAeonSettings({ aeonBranch: event.target.value })}
                              placeholder="main"
                            />
                          </label>
                        </div>
                      </div>
                    ) : null}
                    {aeonSettings.mode === "a2a" ? (
                      <div className={fleetClass("aeonConnectionFields")}>
                        <label className={fleetClass("agentSettingsField")}>
                          <span>A2A / gateway URL</span>
                          <input
                            value={aeonSettings.a2aUrl}
                            onChange={(event) => updateAeonSettings({ a2aUrl: event.target.value, gatewayUrl: event.target.value })}
                            placeholder="http://127.0.0.1:41241"
                          />
                        </label>
                      </div>
                    ) : null}
                </div>
              </div>
            ) : null}

            {activeAgentSettingsPanel === "memory" ? (
              <div className={fleetClass("agentSettingsGrid", "agentMemoryPanel")}>
                <label className={fleetClass("agentSettingsField", "toggleRow")}>
                  <input
                    type="checkbox"
                    checked={agentCreateMachine ? agentCreateDraft.useSharedVault : roleModalAgent?.useSharedVault !== false}
                    onChange={(event) => {
                      if (agentCreateMachine) {
                        setAgentCreateDraft((current) => ({ ...current, useSharedVault: event.target.checked }));
                      } else if (roleModalAgent) {
                        updateAgentProfile(roleModalAgent.id, { useSharedVault: event.target.checked });
                      }
                    }}
                  />
                  <span>Use shared Obsidian brain</span>
                </label>
                {(agentCreateMachine ? agentCreateDraft.useSharedVault : roleModalAgent?.useSharedVault !== false) ? (
                  <div className={fleetClass("agentSettingsInfo")}>
                    <BrainCircuit aria-hidden="true" />
                    <p>{sharedVault.enabled ? `Shared brain: ${sharedVault.vaultPath || "auto-detected vault"}. Memory, Kanban, notifications, and HivemindOS context are shared from there.` : "Shared brain is off. Turn it on from the Vault view to give agents one common memory space."}</p>
                  </div>
                ) : null}
                {agentCreateMachine && isAutopilotSettings ? (
                  <label className={fleetClass("agentSettingsField")}>
                    <span>AEON repo folder</span>
                    <input
                      value={aeonSettings.path}
                      onChange={(event) => updateAeonSettings({ aeonLocalPath: event.target.value })}
                      placeholder="~/.aeon or ~/my-aeon-repo"
                    />
                  </label>
                ) : null}
	                {!agentCreateMachine && roleModalAgent ? (
	                  <div className={fleetClass("agentMemoryFolderRow")}>
	                    <div>
		                      <span>{isAutopilotSettings ? "AEON repo folder" : "Runtime folder"}</span>
		                      <strong>{runtimeFolderValue.trim() || "Managed by runtime"}</strong>
		                      <p>{isAutopilotSettings ? "This is the local AEON repo that the dashboard reads and mirrors into Obsidian." : roleModalAgent.useSharedVault !== false ? "Only change this if this agent needs a custom local workspace." : "Used as this agent's local memory and workspace folder."}</p>
	                    </div>
                    <div className={fleetClass("agentMemoryFolderActions")}>
                      <button type="button" aria-label="Browse for runtime folder" onClick={() => void browseAgentRuntimeFolder()} disabled={agentRuntimeFolderBrowsing}>
                        <FolderOpen aria-hidden="true" />
                      </button>
                      <button type="button" aria-label="Edit runtime folder path" onClick={() => setAgentRuntimeFolderEditing((current) => !current)}>
                        <Pencil aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ) : null}
	                {agentRuntimeFolderEditing && roleModalAgent ? (
	                  <label className={fleetClass("agentSettingsField", "agentMemoryPathEditor")}>
		                    <span>{isAutopilotSettings ? "AEON repo path" : "Runtime folder path"}</span>
	                    <div>
	                      <input
	                        value={runtimeFolderValue}
	                        onChange={(event) => {
		                          updateAgentProfile(roleModalAgent.id, isAutopilotSettings
	                            ? { aeonLocalPath: event.target.value, localDataDir: event.target.value }
	                            : { localDataDir: event.target.value });
	                          setAgentRuntimeFolderStatus("");
	                        }}
		                        placeholder={isAutopilotSettings ? "~/.aeon or ~/my-aeon-repo" : "Leave blank to use the runtime default"}
	                      />
                      <button type="button" aria-label="Done editing runtime folder path" onClick={() => setAgentRuntimeFolderEditing(false)}>
                        <Check aria-hidden="true" />
                      </button>
                    </div>
                  </label>
                ) : null}
                {agentRuntimeFolderStatus ? <p className={fleetClass("agentMemoryStatus")}>{agentRuntimeFolderStatus}</p> : null}
              </div>
            ) : null}

            {activeAgentSettingsPanel === "calls" ? (
              <AgentCallsSettingsPanel
                {...{
                  Button,
                  LoaderCircle,
                  PlugZap,
                  RefreshCcw,
                  Send,
                  agentCreateDraft,
                  agentCreateMachine,
                  fleetClass,
                  roleModalAgent,
                  setAgentCreateDraft,
                  updateAgentProfile,
                }}
              />
            ) : null}

            {activeAgentSettingsPanel === "tools" && roleModalAgent ? (
              <div className={fleetClass("agentRuntimeToolsPanel")}>
                <div className={fleetClass("agentRuntimeToolsHeader")}>
                  <div>
                    <strong>Runtime integrations</strong>
                    <p>These controls stay adapter-neutral. Hermes-only actions appear only when this agent actually runs Hermes.</p>
                  </div>
                  <Button type="button" variant="secondary" onClick={() => void refreshRuntimeIntegrations(roleModalAgent)} disabled={runtimeIntegrationBusy === "status"}>
                    {runtimeIntegrationBusy === "status" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RefreshCcw aria-hidden="true" />}
                    Refresh
                  </Button>
                </div>

                <div className={fleetClass("agentRuntimeCapabilityGrid")}>
                  {([
                    ["sessionSearch", "Session search", "Search prior work across this runtime.", Search],
                    ["backgroundTasks", "Background tasks", "Run work without blocking chat.", Repeat2],
                    ["xSearch", "X search", "Fetch X posts through runtime auth.", MessageSquare],
                    ["socialPosting", "X posting", "Publish through installed social skills.", Send],
                    ["videoGeneration", "AI video", "Generate videos through runtime tools.", Sparkles],
                    ["codexRuntime", "Codex runtime", "Delegate coding to Codex paths.", Cpu],
                    ["kanbanDecompose", "Kanban decomposition", "Break triage goals into child work.", KanbanSquare],
                  ] as const).map(([key, label, detail, Icon]) => {
                    const item = runtimeIntegrationStatus?.integrations[key];
                    const supported = item?.supported ?? Boolean(runtimeCapabilities(roleModalAgent)[key]);
                    const enabled = item?.enabled ?? supported;
                    const needsHermesUpdate = roleModalAgent.runtime === "hermes" && supported && hermesUpdateRequired && HERMES_UPDATE_INTEGRATION_KEYS.has(key);
                    const needsSetup = supported && !enabled && !needsHermesUpdate;
                    const statusLabel = needsHermesUpdate
                      ? "Needs Hermes update"
                      : supported
                        ? enabled ? "Ready" : "Needs setup"
                        : "Not exposed";
                    const updateConfirmOpen = runtimeUpdateConfirmKey === key;
                    return (
                      <article key={key} className={fleetClass("agentRuntimeCapabilityCard", supported ? "supported" : "unsupported")}>
                        <Icon aria-hidden="true" />
                        <div>
                          <strong>{label}</strong>
                          <div className={fleetClass("agentRuntimeCapabilityBadges")}>
                            {needsHermesUpdate ? (
                              <span className={fleetClass("needsHermesUpdate", updateConfirmOpen ? "confirming" : "")}>
                                {updateConfirmOpen ? (
                                  <>
                                    <span>Update now?</span>
                                    <button
                                      type="button"
                                      aria-label="Update Hermes now"
                                      disabled={Boolean(runtimeIntegrationBusy)}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void (async () => {
                                          await runRuntimeIntegrationAction("hermes-update");
                                          setRuntimeUpdateConfirmKey("");
                                        })();
                                      }}
                                    >
                                      {runtimeIntegrationBusy === "hermes-update" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
                                    </button>
                                    <CloseIconButton
                                      size="sm"
                                      type="button"
                                      aria-label="Cancel Hermes update"
                                      disabled={runtimeIntegrationBusy === "hermes-update"}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setRuntimeUpdateConfirmKey("");
                                      }}
                                    />
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={Boolean(runtimeIntegrationBusy)}
                                    onClick={() => setRuntimeUpdateConfirmKey(key)}
                                  >
                                    {statusLabel}
                                  </button>
                                )}
                              </span>
                            ) : needsSetup ? (
                              <button
                                type="button"
                                className={fleetClass("runtimeSetupBadge")}
                                aria-pressed={runtimeSetupKey === key}
                                onClick={() => setRuntimeSetupKey((current) => current === key ? "" : key)}
                              >
                                {statusLabel}
                              </button>
                            ) : (
                              <span>{statusLabel}</span>
                            )}
                          </div>
                          <p>{detail}</p>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {runtimeSetupKey ? (() => {
                  const setup = runtimeSetupDefinition(roleModalAgent.runtime, runtimeSetupKey);
                  return (
                    <section className={fleetClass("agentRuntimeSetupPanel")}>
                      <div>
                        <strong>{setup.title}</strong>
                        <p>{setup.description}</p>
                      </div>
                      <ol>
                        {setup.steps.map((step: string) => <li key={step}>{step}</li>)}
                      </ol>
                      <div className={fleetClass("agentRuntimeSetupActions")}>
                        {setup.actions.map((action: any) => (
                          <Button
                            key={action.id}
                            type="button"
                            variant={action.id === setup.actions[0]?.id ? "default" : "secondary"}
                            disabled={Boolean(runtimeIntegrationBusy)}
                            onClick={() => void runRuntimeIntegrationAction(action.action, action.input ?? {})}
                          >
                            {runtimeIntegrationBusy === action.action ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <PlugZap aria-hidden="true" />}
                            {action.label}
                          </Button>
                        ))}
                        <Button type="button" variant="secondary" onClick={() => void refreshRuntimeIntegrations(roleModalAgent)} disabled={runtimeIntegrationBusy === "status"}>
                          {runtimeIntegrationBusy === "status" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RefreshCcw aria-hidden="true" />}
                          Refresh
                        </Button>
                        <CloseIconButton aria-label="Close runtime setup" onClick={() => setRuntimeSetupKey("")} />
                      </div>
                    </section>
                  );
                })() : null}

                <div className={fleetClass("agentRuntimeToolWorkbench")}>
                  <section>
                    <div>
                      <strong>Search sessions</strong>
                      <p>Works for runtimes with readable local session history. Hermes uses its SQLite session store; OpenClaw scans local session transcripts when present.</p>
                    </div>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void searchRuntimeSessionsForAgent();
                      }}
                    >
                      <input
                        value={runtimeSessionQuery}
                        onChange={(event) => setRuntimeSessionQuery(event.target.value)}
                        placeholder="April 15, Codex, Kanban, auth..."
                      />
                      <Button type="submit" disabled={runtimeIntegrationBusy === "session-search"}>
                        {runtimeIntegrationBusy === "session-search" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Search aria-hidden="true" />}
                        Search
                      </Button>
                    </form>
                    {runtimeSessionResults.length ? (
                      <div className={fleetClass("agentRuntimeSessionResults")}>
                        {runtimeSessionResults.map((session) => (
                          <article key={session.id}>
                            <strong>{session.title}</strong>
                            <span>{[session.source, session.model, session.startedAt ? new Date(session.startedAt).toLocaleString() : ""].filter(Boolean).join(" · ")}</span>
                            <p>{session.excerpt || session.path || "No preview available."}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  closeAgentSettingsModal();
                                  startAgentChat(roleModalAgent.id, { fresh: true, runtimeSessionId: session.id });
                                }}
                              >
                                <MessageSquare aria-hidden="true" />
                                Resume in chat
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => navigator.clipboard?.writeText(session.id)}
                              >
                                <Copy aria-hidden="true" />
                                Copy id
                              </Button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </section>

                  {roleModalAgent.runtime === "hermes" ? (
                    <section>
                      <div>
                        <strong>Hermes extras</strong>
                        <p>These call the local Hermes CLI and leave other runtimes untouched.</p>
                      </div>
                      <div className={fleetClass("agentRuntimeActionGrid")}>
                        <Button type="button" variant="secondary" disabled={Boolean(runtimeIntegrationBusy)} onClick={() => void runRuntimeIntegrationAction("xai-login")}>
                          <PlugZap aria-hidden="true" />
                          xAI login
                        </Button>
                        <Button type="button" variant="secondary" disabled={Boolean(runtimeIntegrationBusy)} onClick={() => void runRuntimeIntegrationAction("enable-tool", { tool: "x_search" })}>
                          <MessageSquare aria-hidden="true" />
                          Enable X search
                        </Button>
                        <Button type="button" variant="secondary" disabled={Boolean(runtimeIntegrationBusy)} onClick={() => void runRuntimeIntegrationAction("enable-tool", { tool: "video_gen" })}>
                          <Sparkles aria-hidden="true" />
                          Enable video
                        </Button>
                        <Button type="button" variant="secondary" disabled={Boolean(runtimeIntegrationBusy)} onClick={() => void runRuntimeIntegrationAction("kanban-decompose")}>
                          <KanbanSquare aria-hidden="true" />
                          Decompose triage
                        </Button>
                      </div>
                      <label className={fleetClass("agentSettingsField")}>
                        <span>Background prompt</span>
                        <textarea
                          value={runtimeBackgroundPrompt}
                          onChange={(event) => setRuntimeBackgroundPrompt(event.target.value)}
                          placeholder="Ask Hermes to handle a background task while chat stays free."
                        />
                      </label>
                      <Button
                        type="button"
                        disabled={runtimeIntegrationBusy === "background" || !runtimeBackgroundPrompt.trim()}
                        onClick={() => void runRuntimeIntegrationAction("background", { prompt: runtimeBackgroundPrompt })}
                      >
                        {runtimeIntegrationBusy === "background" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Repeat2 aria-hidden="true" />}
                        Start background task
                      </Button>
                    </section>
                  ) : null}
                </div>

                {runtimeIntegrationMessage ? <p className={fleetClass("agentRuntimeToolStatus")}>{runtimeIntegrationMessage}</p> : null}
              </div>
            ) : null}

            {activeAgentSettingsPanel === "security" ? (
              <div className={fleetClass("agentSecurityGrid")}>
                <article><ShieldCheck aria-hidden="true" /><div><strong>Prompt guard</strong><p>Blocks obvious prompt-injection and dangerous local-action requests before they reach connected runtimes. Checks run locally in the dashboard.</p></div></article>
                <article><Eye aria-hidden="true" /><div><strong>Output redaction</strong><p>Secrets and obvious credential leaks are redacted from streamed responses before the dashboard renders them.</p></div></article>
                <article><Settings2 aria-hidden="true" /><div><strong>Skill action guard</strong><p>Local skill actions use allowlisted skill folders and safe argument checks where the runtime exposes dashboard actions.</p></div></article>
              </div>
            ) : null}

            <div className={fleetClass("setupModalActions")}>
              <Button type="button" disabled={runtimeIntegrationBusy === "create-agent" || usePodCreateBlocked} onClick={agentCreateMachine ? () => void createAgentFromModal() : closeAgentSettingsModal}>
                <Check aria-hidden="true" />
                {agentCreateMachine ? runtimeIntegrationBusy === "create-agent" ? "Creating..." : runtimeSettingsFeature(agentCreateDraft.runtime).createActionLabel || "Add agent" : "Done"}
              </Button>
              {agentCreateMachine && runtimeIntegrationMessage ? <p className={fleetClass("agentRuntimeToolStatus")}>{runtimeIntegrationMessage}</p> : null}
            </div>
          </section>
        </div>
      ) : null}
  </>), portalTarget);
}
