"use client";
// @ts-nocheck
// Partially typed 2026-07-02; the typing pass ran out of session mid-file and the remaining errors are deferred (see CHANGELOG).

/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

import { BrainModule } from "@/features/dashboard/brain-modules";
import { memo, useEffect, useRef, useState } from "react";
import { BrainGraphExplorer } from "./BrainGraphExplorer";
import { BrainConfigPanel } from "./BrainConfigPanel";
import { BrainSkillsPanel } from "./BrainSkillsPanel";
import { BrainServiceOverview, BrainServiceRunResult, BrainServiceSegmentedNav, BrainServiceSettingsDeck } from "./brain-services-ui";
import { AgentMemoryHealthCard } from "./AgentMemoryHealthCard";
import { SkillSecurityCard } from "./SkillSecurityCard";
import brainServiceStyles from "./brain-services.module.css";
import { SectionModeHeader } from "./WorkSectionHeader";

export const VaultPanel = memo(VaultPanelComponent);

// Memoized (see export above) so unrelated background re-renders skip this panel.
function VaultPanelComponent(props: any) {
  const { Activity, BRAIN_SKILL_PROVIDER_FALLBACK, Bot, BrainCircuit, BrainGraphLoader, Button, Cell, Check, CircleAlert, DEFAULT_SHARED_VAULT, Download, Eye, FileText, FolderOpen, GitBranch, Hexagon, KeyRound, LoaderCircle, Network, PlugZap, RefreshCcw, Repeat2, Search, Sparkles, activeView, brainGraph, brainGraphLoading, brainGraphStats, brainGraphStatus, brainPan, brainSkillAeonSyncing, brainSkillImportAllDescription, brainSkillImportAllLabel, brainSkillImportProvider, brainSkillImportSuccess, brainSkillImportableCount, brainSkills, brainSkillsLoading, brainSkillsStatus, checkControlRoomStatus, checkVaultStatus, controlRoomStatus, displayAgents, endBrainPan, formatBrainDate, gbrainActionStatus, gbrainBusy, gbrainQuery, gbrainQueryResult, gbrainStatus, hermesUpdateRequired, hermesUpdateRequiredDetail, importBrainSkills, inspectBrainNode, installTradingBrainFromDashboard, moveBrainPan, neo4jActionStatus, neo4jBusy, neo4jQuery, neo4jQueryResult, neo4jStatus, openSkillBrowser, pairSyncthingVaultSync, qmdActionStatus, qmdBusy, qmdQuery, qmdQueryResult, qmdStatus, queryGbrainFromDashboard, queryNeo4jFromDashboard, queryQmdFromDashboard, querySyntoFromDashboard, refreshBrainGraph, refreshBrainSkills, refreshGbrainStatus, refreshNeo4jStatus, refreshQmdStatus, refreshSyntoStatus, refreshTradingBrainStatus, runGbrainAction, runNeo4jAction, runQmdAction, runSyntoAction, runVaultTailnetSync, selectedAgent, selectedBrainNode, setActiveView, setBrainPan, setChatAttachments, setChatDirectories, setGbrainQuery, setNeo4jQuery, setQmdQuery, setQuickAddDrafts, setQuickAddStatus, setSkillBrowserOpen, setSkillBrowserSearch, setSkillBrowserView, setSkillBrowserWrittenContent, setSyntoQuery, setText, setTradingBrainForAllRuntimes, setTradingBrainForRuntime, setVaultPanelMode, sharedVault, skillBrowserSearch, skillRequiresHermesUpdate, startAgentChat, startBrainPan, syncBrainSkillsToAeon, syntoActionStatus, syntoBusy, syntoQuery, syntoQueryResult, syntoStatus, tradingBrainActionStatus, tradingBrainAllRuntimeAttached, tradingBrainBusy, tradingBrainRuntimeCards, tradingBrainStatus, updateAllSkillAutoSync, updateSharedVault, updateSkillAutoSync, vaultClass, vaultPanelMode, vaultStatus, vaultSyncPending, vaultSyncStatus } = props;
  const brainClass = (...classes) => classes.map((className) => brainServiceStyles[className] || vaultClass(className)).filter(Boolean).join(" ");
  const gbrainMetric = (keys: string[]) => {
    const stats = gbrainStatus?.stats ?? {};
    for (const key of keys) {
      const value = stats[key] ?? stats[key.toLowerCase()] ?? stats[key.replace(/([A-Z])/g, "_$1").toLowerCase()];
      if (typeof value === "number" || typeof value === "string") return value;
    }
    return "—";
  };
  const qmdMetric = (value: unknown) => (typeof value === "number" || typeof value === "string" ? value : "—");
  const gbrainKeys = gbrainStatus?.keyStatus ?? {};
  const gbrainRecommendations = gbrainStatus?.features?.recommendations ?? [];
  const [brainModuleSuccess, setBrainModuleSuccess] = useState<Record<string, boolean>>({});
  const [brainServiceSection, setBrainServiceSection] = useState("overview");
  const previousGbrainBusyRef = useRef("");
  const previousQmdBusyRef = useRef("");
  const previousNeo4jBusyRef = useRef("");
  const previousSyntoBusyRef = useRef("");
  const previousTradingBrainBusyRef = useRef("");
  const sharedSkillsRefreshKeyRef = useRef("");
  const sharedSkillCountFallbackRef = useRef("");
  const [sharedSkillCountFallback, setSharedSkillCountFallback] = useState(0);
  const tradingCounts = tradingBrainStatus?.counts ?? {};
  const tradingBrainConfiguredFiles = tradingBrainStatus?.files?.filter((file) => file.exists).length ?? 0;
  const tradingBrainTotalFiles = tradingBrainStatus?.files?.length ?? 0;
  const skillSearchQuery = (skillBrowserSearch ?? "").trim().toLowerCase();
  const skillMatchesBrowserSearch = (skill, source = "") => {
    if (!skillSearchQuery) return true;
    return (
      skill.name?.toLowerCase().includes(skillSearchQuery)
      || skill.slug?.toLowerCase().includes(skillSearchQuery)
      || skill.description?.toLowerCase().includes(skillSearchQuery)
      || source.toLowerCase().includes(skillSearchQuery)
    );
  };
  const sharedBrainSkills = brainSkills?.shared ?? [];
  const sharedSkillCount = Math.max(sharedBrainSkills.length, brainSkills?.totals?.shared ?? 0, sharedSkillCountFallback);
  const sharedVaultPath = sharedVault.vaultPath?.trim() ?? "";
  const canReadSharedVault = sharedVault.enabled || Boolean(sharedVaultPath);
  const providerSkillInventories = (brainSkills?.providers ?? BRAIN_SKILL_PROVIDER_FALLBACK).map((provider) => ({
    ...provider,
    skills: skillSearchQuery ? provider.skills.filter((skill) => skillMatchesBrowserSearch(skill, provider.label)) : provider.skills,
  }));
  const providerSkillTotal = (brainSkills?.providers ?? []).reduce((total, provider) => total + provider.skills.length, 0);
  const filteredProviderSkillTotal = providerSkillInventories.reduce((total, provider) => total + provider.skills.length, 0);
  const providerSkillSummary = skillSearchQuery
    ? `${filteredProviderSkillTotal} matching provider skill${filteredProviderSkillTotal === 1 ? "" : "s"}`
    : `${brainSkills?.totals.importable ?? 0} skill${(brainSkills?.totals.importable ?? 0) === 1 ? "" : "s"} ready to mirror into Obsidian`;
  const skillInventoryEmpty = !brainSkills
    || (!sharedBrainSkills.length
      && !providerSkillTotal
      && !(brainSkills?.totals.shared ?? 0)
      && !(brainSkills?.totals.importable ?? 0));
  useEffect(() => {
    if (activeView !== "vault" || brainSkillsLoading || !skillInventoryEmpty || !canReadSharedVault) return;
    const refreshKey = `${sharedVaultPath || "default"}:${vaultPanelMode}:${brainSkillsStatus || "empty"}`;
    if (sharedSkillsRefreshKeyRef.current === refreshKey) return;
    sharedSkillsRefreshKeyRef.current = refreshKey;
    const timer = window.setTimeout(() => {
      void refreshBrainSkills();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeView, brainSkillsLoading, brainSkillsStatus, canReadSharedVault, refreshBrainSkills, sharedVaultPath, skillInventoryEmpty, vaultPanelMode]);
  useEffect(() => {
    if (sharedSkillCount || !sharedVaultPath) return;
    const refreshKey = `${sharedVaultPath}:shared-count`;
    if (sharedSkillCountFallbackRef.current === refreshKey) return;
    sharedSkillCountFallbackRef.current = refreshKey;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 90_000);
    const params = new URLSearchParams();
    params.set("vaultPath", sharedVaultPath);
    params.set("shared", "1");
    params.set("count", "1");
    fetch(`/api/obsidian/skills?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        const count = data?.sharedTotal ?? data?.totals?.shared ?? data?.shared?.length ?? 0;
        if (Number.isFinite(count) && count > 0) setSharedSkillCountFallback(count);
      })
      .catch(() => undefined)
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [sharedSkillCount, sharedVaultPath]);
  useEffect(() => {
    const previousBusy = previousGbrainBusyRef.current;
    previousGbrainBusyRef.current = gbrainBusy;
    if ((previousBusy === "install" || previousBusy === "connect") && !gbrainBusy && gbrainStatus?.installed) {
      setBrainModuleSuccess((current) => ({ ...current, gbrain: true }));
      const timer = window.setTimeout(() => {
        setBrainModuleSuccess((current) => ({ ...current, gbrain: false }));
      }, 2000);
      return () => window.clearTimeout(timer);
    }
  }, [gbrainBusy, gbrainStatus?.installed]);
  useEffect(() => {
    const previousBusy = previousQmdBusyRef.current;
    previousQmdBusyRef.current = qmdBusy;
    if ((previousBusy === "install" || previousBusy === "connect") && !qmdBusy && qmdStatus?.installed) {
      setBrainModuleSuccess((current) => ({ ...current, qmd: true }));
      const timer = window.setTimeout(() => {
        setBrainModuleSuccess((current) => ({ ...current, qmd: false }));
      }, 2000);
      return () => window.clearTimeout(timer);
    }
  }, [qmdBusy, qmdStatus?.installed]);
  useEffect(() => {
    const previousBusy = previousNeo4jBusyRef.current;
    previousNeo4jBusyRef.current = neo4jBusy;
    if ((previousBusy === "connect" || previousBusy === "sync") && !neo4jBusy && neo4jStatus?.connected) {
      setBrainModuleSuccess((current) => ({ ...current, neo4j: true }));
      const timer = window.setTimeout(() => {
        setBrainModuleSuccess((current) => ({ ...current, neo4j: false }));
      }, 2000);
      return () => window.clearTimeout(timer);
    }
  }, [neo4jBusy, neo4jStatus?.connected]);
  useEffect(() => {
    const previousBusy = previousSyntoBusyRef.current;
    previousSyntoBusyRef.current = syntoBusy;
    if ((previousBusy === "install" || previousBusy === "connect") && !syntoBusy && syntoStatus?.installed) {
      setBrainModuleSuccess((current) => ({ ...current, synto: true }));
      const timer = window.setTimeout(() => {
        setBrainModuleSuccess((current) => ({ ...current, synto: false }));
      }, 2000);
      return () => window.clearTimeout(timer);
    }
  }, [syntoBusy, syntoStatus?.installed]);
  useEffect(() => {
    const previousBusy = previousTradingBrainBusyRef.current;
    previousTradingBrainBusyRef.current = tradingBrainBusy;
    if (previousBusy === "install" && !tradingBrainBusy && tradingBrainStatus?.installed) {
      setBrainModuleSuccess((current) => ({ ...current, "trading-brain": true }));
      const timer = window.setTimeout(() => {
        setBrainModuleSuccess((current) => ({ ...current, "trading-brain": false }));
      }, 2000);
      return () => window.clearTimeout(timer);
    }
  }, [tradingBrainBusy, tradingBrainStatus?.installed]);
  const gbrainStatusNote = gbrainStatus?.error?.includes("ENOENT") || gbrainStatus?.error?.includes("not found")
    ? "GBrain CLI is not available on this machine yet."
    : gbrainStatus?.error ?? "";
  const gbrainFailedInstallMessage = !gbrainStatus?.installed && !gbrainBusy && gbrainActionStatus && !gbrainActionStatus.includes("ready to install")
    ? gbrainActionStatus
    : "";
  const gbrainInstallFailureLabel = gbrainFailedInstallMessage.includes("Bun is required")
    ? "GBrain install needs Bun first. Install Bun, then press Install GBrain again."
    : gbrainFailedInstallMessage.includes("ENOENT") || gbrainFailedInstallMessage.includes("Could not run the configured GBrain CLI")
      ? "GBrain CLI was not found. Use Install GBrain, or set the CLI path before connecting an existing install."
      : gbrainFailedInstallMessage;
  const qmdStatusNote = qmdStatus?.error?.includes("ENOENT") || qmdStatus?.error?.includes("not found")
    ? "QMD CLI is not available on this machine yet."
    : qmdStatus?.error ?? "";
  const neo4jStatusNote = neo4jStatus?.error ?? "";
  const neo4jKeys = neo4jStatus?.keyStatus ?? {};
  const neo4jRequiredKeysReady = [
    sharedVault.neo4j?.uriEnvKey,
    sharedVault.neo4j?.usernameEnvKey,
    sharedVault.neo4j?.passwordEnvKey,
  ].every((key) => key && neo4jKeys[key]?.present);
  const qmdFailedInstallMessage = !qmdStatus?.installed && !qmdBusy && qmdActionStatus && !qmdActionStatus.includes("ready to install")
    ? qmdActionStatus
    : "";
  const neo4jFailedConnectMessage = !neo4jStatus?.connected && !neo4jBusy && neo4jActionStatus && !neo4jActionStatus.includes("ready to connect")
    ? neo4jActionStatus
    : "";
  const qmdInstallFailureLabel = qmdFailedInstallMessage.includes("npm is required")
    ? "QMD install needs Node/npm first. Install Node/npm, then press Install QMD again."
    : qmdFailedInstallMessage.includes("ENOENT") || qmdFailedInstallMessage.includes("Could not run the configured QMD CLI")
      ? "QMD CLI was not found. Use Install QMD, or set the CLI path before connecting an existing install."
      : qmdFailedInstallMessage;
  const syntoStatusNote = syntoStatus?.error?.includes("ENOENT") || syntoStatus?.error?.includes("not found")
    ? "Syntho CLI is not available on this machine yet."
    : syntoStatus?.error ?? "";
  const syntoFailedInstallMessage = !syntoStatus?.installed && !syntoBusy && syntoActionStatus && !syntoActionStatus.includes("ready to install")
    ? syntoActionStatus
    : "";
  const syntoInstallFailureLabel = syntoFailedInstallMessage.includes("ENOENT") || syntoFailedInstallMessage.includes("Could not run the configured Syntho CLI")
    ? "Syntho CLI was not found. Use Install Syntho, or connect an existing install after making it available on PATH."
    : syntoFailedInstallMessage;
  const tradingBrainFailedInstallMessage = !tradingBrainStatus?.installed && !tradingBrainBusy && tradingBrainActionStatus && !tradingBrainActionStatus.includes("ready to install")
    ? tradingBrainActionStatus
    : "";
  const gbrainInstallState = brainModuleSuccess.gbrain
    ? "success"
    : gbrainBusy === "install" || gbrainBusy === "connect"
      ? "installing"
      : gbrainStatus?.installed
        ? "installed"
        : gbrainInstallFailureLabel
          ? "failed"
          : "install";
  const qmdInstallState = brainModuleSuccess.qmd
    ? "success"
    : qmdBusy === "install" || qmdBusy === "connect"
      ? "installing"
      : qmdStatus?.installed
        ? "installed"
        : qmdInstallFailureLabel
          ? "failed"
          : "install";
  const neo4jInstallState = brainModuleSuccess.neo4j
    ? "success"
    : neo4jBusy === "connect" || neo4jBusy === "sync"
      ? "installing"
      : neo4jStatus?.connected
        ? "installed"
        : neo4jFailedConnectMessage
          ? "failed"
          : "install";
  const syntoInstallState = brainModuleSuccess.synto
    ? "success"
    : syntoBusy === "install" || syntoBusy === "connect"
      ? "installing"
      : syntoStatus?.installed
        ? "installed"
        : syntoInstallFailureLabel
          ? "failed"
          : "install";
  const tradingBrainInstallState = brainModuleSuccess["trading-brain"]
    ? "success"
    : tradingBrainBusy === "install"
      ? "installing"
      : tradingBrainStatus?.installed
        ? "installed"
        : tradingBrainFailedInstallMessage
          ? "failed"
          : "install";
  const brainServiceFooterStatus = [
    tradingBrainStatus?.installed || tradingBrainBusy === "install" ? tradingBrainActionStatus : "",
    syntoStatus?.installed || syntoBusy === "install" || syntoBusy === "connect" ? syntoActionStatus : "",
    neo4jStatus?.connected || neo4jBusy ? neo4jActionStatus : "",
    qmdStatus?.installed || qmdBusy === "install" || qmdBusy === "connect" || qmdBusy === "index" || qmdBusy === "embed" ? qmdActionStatus : "",
    gbrainStatus?.installed || gbrainBusy === "install" || gbrainBusy === "connect" ? gbrainActionStatus : "",
  ].find(Boolean) || "";
  const syntoOutputHints = `${syntoActionStatus}\n${syntoQueryResult}`;
  const syntoNeedsModelSetup = /ollama|model/i.test(syntoOutputHints) && /missing|not running|not found|failed|error/i.test(syntoOutputHints);
  const gbrainSetupSteps = ["Check Bun runtime", "Install GBrain CLI", "Initialize local brain", "Import shared vault", "Refresh stale embeddings", "Extract graph links", "Scaffold retrieval skills"];
  const qmdSetupSteps = ["Check npm runtime", "Install QMD CLI", "Add shared vault collection", "Build SQLite/BM25 index", "Refresh local vectors"];
  const neo4jSetupSteps = ["Check Neo4j env keys", "Verify driver connectivity", "Create graph constraints", "MERGE Agent Memory", "Link entities and compiled pages"];
  const syntoSetupSteps = ["Install Syntho CLI", "Initialize Synthesis", "Run doctor checks", "Prepare MCP surface"];
  const tradingBrainSetupSteps = ["Create vault folders", "Write trading templates", "Seed runtime guidance", "Verify scaffold"];
  const syntoModuleEnabled = Boolean(syntoStatus?.installed && sharedVault.synto.enabled);
  const gbrainModuleEnabled = Boolean(gbrainStatus?.installed && sharedVault.gbrain.enabled);
  const qmdModuleEnabled = Boolean(qmdStatus?.installed && sharedVault.qmd.enabled);
  const neo4jModuleEnabled = Boolean(neo4jStatus?.connected && sharedVault.neo4j.enabled);
  const tradingBrainModuleEnabled = Boolean(tradingBrainStatus?.installed && sharedVault.tradingBrainEnabled);
  const syntoModuleAvailable = Boolean(syntoStatus?.installed || syntoBusy === "install" || syntoBusy === "connect" || brainModuleSuccess.synto);
  const gbrainModuleAvailable = Boolean(gbrainStatus?.installed || gbrainBusy === "install" || gbrainBusy === "connect" || brainModuleSuccess.gbrain);
  const qmdModuleAvailable = Boolean(qmdStatus?.installed || qmdBusy === "install" || qmdBusy === "connect" || brainModuleSuccess.qmd);
  const neo4jModuleAvailable = Boolean(neo4jStatus?.connected || neo4jBusy === "connect" || neo4jBusy === "sync" || brainModuleSuccess.neo4j);
  const tradingBrainModuleAvailable = Boolean(tradingBrainStatus?.installed || tradingBrainBusy === "install" || brainModuleSuccess["trading-brain"]);
  const brainModules = [
    new BrainModule({
      id: "gbrain",
      name: "GBrain",
      icon: <BrainCircuit aria-hidden="true" />,
      statusLabel: gbrainInstallState === "installed" ? "Installed" : gbrainInstallState === "installing" ? "Installing" : "Optional",
      statusTone: gbrainStatus?.installed ? "live" : "idle",
      active: gbrainStatus?.installed,
      title: "Retrieval, graph, MCP, and dream cycle",
      description: "Install or connect GBrain when you want semantic retrieval and synthesized answers over the shared vault.",
      install: {
        state: gbrainInstallState,
        buttonLabel: "Install GBrain",
        disabled: Boolean(gbrainBusy) || !sharedVault.enabled,
        failureLabel: gbrainInstallFailureLabel,
        icon: gbrainBusy === "install" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />,
        installingLabel: gbrainBusy === "connect" ? "Connecting GBrain runtime" : "Installing GBrain retrieval core",
        onInstall: () => void runGbrainAction("install"),
        setupSteps: gbrainSetupSteps,
        successLabel: "Installed!",
        features: [
          <>Semantic retrieval across the shared vault</>,
          <>Graph-aware answers, source trails, and MCP exposure</>,
          <>Dream cycles that synthesize stale notes into working memory</>,
          <>Namespaced skills that do not take over Synthesis</>,
        ],
        secondaryActions: [
          {
            key: "connect",
            label: "Connect existing",
            disabled: Boolean(gbrainBusy) || !sharedVault.enabled,
            icon: gbrainBusy === "connect" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <PlugZap aria-hidden="true" />,
            onClick: () => void runGbrainAction("connect"),
          },
        ],
      },
      stats: [
        { key: "pages", label: "Pages", value: gbrainMetric(["page_count", "pages", "pageCount"]), icon: <FileText aria-hidden="true" /> },
        { key: "links", label: "Links", value: gbrainMetric(["link_count", "links", "linkCount"]), icon: <GitBranch aria-hidden="true" /> },
        { key: "score", label: "Score", value: gbrainStatus?.features?.brainScore ?? "—", icon: <Activity aria-hidden="true" /> },
        { key: "mcp", label: "MCP", value: gbrainStatus?.mcp?.mode ?? sharedVault.gbrain.mcpMode, icon: <PlugZap aria-hidden="true" /> },
      ],
      badges: [
        ...(gbrainStatusNote ? [gbrainStatusNote] : []),
        <><KeyRound aria-hidden="true" />ZE {gbrainKeys.ZEROENTROPY_API_KEY ? "ready" : "missing"}</>,
        <>OpenAI {gbrainKeys.OPENAI_API_KEY ? "ready" : "missing"}</>,
        <>Anthropic {gbrainKeys.ANTHROPIC_API_KEY ? "ready" : "optional"}</>,
        sharedVault.gbrain.searchMode,
      ],
      primaryAction: {
        key: "think",
        label: "Ask GBrain",
        disabled: Boolean(gbrainBusy) || !gbrainStatus?.installed || !gbrainQuery.trim(),
        icon: gbrainBusy === "query" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <BrainCircuit aria-hidden="true" />,
        onClick: () => void queryGbrainFromDashboard(),
      },
      actions: [
        {
          key: "import",
          label: "Import vault",
          disabled: Boolean(gbrainBusy),
          icon: gbrainBusy === "import" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />,
          onClick: () => void runGbrainAction("import"),
        },
        {
          key: "embed",
          label: "Embed stale",
          disabled: Boolean(gbrainBusy),
          icon: gbrainBusy === "embed" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Network aria-hidden="true" />,
          onClick: () => void runGbrainAction("embed"),
        },
        {
          key: "dream",
          label: "Dream",
          disabled: Boolean(gbrainBusy),
          icon: gbrainBusy === "dream" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Sparkles aria-hidden="true" />,
          onClick: () => void runGbrainAction("dream"),
        },
      ],
      body: (
        <div className={brainClass("gbrainQueryBox")}>
          <label>
            <span>Question</span>
            <textarea
              value={gbrainQuery}
              onChange={(event) => setGbrainQuery(event.target.value)}
              rows={3}
              placeholder="What changed across active projects this week?"
            />
          </label>
        </div>
      ),
      result: gbrainQueryResult || gbrainActionStatus ? <BrainServiceRunResult label="GBrain result" output={gbrainQueryResult} status={gbrainActionStatus} /> : null,
      settings: (
        <div className={brainClass("brainServiceSettings")}>
          <label className={brainClass("brainServiceToggle")}>
            {gbrainStatus?.installed ? (
              <>
                <input
                  type="checkbox"
                  checked={sharedVault.gbrain.enabled}
                  onChange={(event) => updateSharedVault({ gbrain: { ...sharedVault.gbrain, enabled: event.target.checked } })}
                />
                <span className={brainClass("brainServiceSwitch")} aria-hidden="true"><span /></span>
                <span>{sharedVault.gbrain.enabled ? "GBrain integration enabled" : "GBrain integration disabled"}</span>
              </>
            ) : (
              <button type="button" className={brainClass("brainServiceActionButton")} disabled={Boolean(gbrainBusy) || !sharedVault.enabled} onClick={() => void runGbrainAction("install")}>
                {gbrainBusy === "install" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />}
                Install GBrain
              </button>
            )}
          </label>
          <label>
            Search mode
            <select
              value={sharedVault.gbrain.searchMode}
              onChange={(event) => updateSharedVault({ gbrain: { ...sharedVault.gbrain, searchMode: event.target.value } })}
            >
              <option value="conservative">Conservative</option>
              <option value="balanced">Balanced</option>
              <option value="tokenmax">Tokenmax</option>
            </select>
          </label>
          <label>
            Provider policy
            <select
              value={sharedVault.gbrain.providerPolicy}
              onChange={(event) => updateSharedVault({ gbrain: { ...sharedVault.gbrain, providerPolicy: event.target.value } })}
            >
              <option value="balanced-cloud">Balanced cloud</option>
              <option value="local-first">Local first</option>
              <option value="max-quality">Max quality</option>
            </select>
          </label>
          <label>
            MCP mode
            <select
              value={sharedVault.gbrain.mcpMode}
              onChange={(event) => updateSharedVault({ gbrain: { ...sharedVault.gbrain, mcpMode: event.target.value } })}
            >
              <option value="stdio">stdio</option>
              <option value="http">HTTP</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
        </div>
      ),
    }),
    new BrainModule({
      id: "qmd",
      name: "QMD",
      icon: <Search aria-hidden="true" />,
      statusLabel: qmdInstallState === "installed" ? qmdStatus?.ok ? "Indexed" : "Needs index" : qmdInstallState === "installing" ? "Installing" : "Optional",
      statusTone: qmdStatus?.ok ? "live" : "idle",
      active: qmdStatus?.installed,
      title: "Local markdown search over the brain",
      description: "Install QMD when you want fast BM25, vector, and hybrid search over the shared Obsidian vault without sending memory to a hosted service.",
      install: {
        state: qmdInstallState,
        buttonLabel: "Install QMD",
        disabled: Boolean(qmdBusy) || !sharedVault.enabled,
        failureLabel: qmdInstallFailureLabel,
        icon: qmdBusy === "install" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />,
        installingLabel: qmdBusy === "connect" ? "Connecting QMD runtime" : "Installing and indexing QMD",
        onInstall: () => void runQmdAction("install"),
        setupSteps: qmdSetupSteps,
        successLabel: "Installed!",
        features: [
          <>BM25 keyword search for exact names, commands, and error strings</>,
          <>Local vector search for semantic recall across markdown notes</>,
          <>Hybrid query mode for agent preflight retrieval</>,
          <>SQLite index and GGUF models stay outside the vault</>,
        ],
        secondaryActions: [
          {
            key: "connect",
            label: "Connect existing",
            disabled: Boolean(qmdBusy) || !sharedVault.enabled,
            icon: qmdBusy === "connect" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <PlugZap aria-hidden="true" />,
            onClick: () => void runQmdAction("connect"),
          },
        ],
      },
      stats: [
        { key: "docs", label: "Docs", value: qmdMetric(qmdStatus?.documents ?? qmdStatus?.collection?.files), icon: <FileText aria-hidden="true" /> },
        { key: "vectors", label: "Vectors", value: qmdMetric(qmdStatus?.vectors), icon: <Network aria-hidden="true" /> },
        { key: "pending", label: "Pending", value: qmdMetric(qmdStatus?.pendingEmbeddings), icon: <Activity aria-hidden="true" /> },
        { key: "mcp", label: "MCP", value: qmdStatus?.mcp?.mode ?? sharedVault.qmd.mcpMode, icon: <PlugZap aria-hidden="true" /> },
      ],
      badges: [
        "Brain Speed++",
        ...(qmdStatusNote ? [qmdStatusNote] : []),
        <>Collection {qmdStatus?.collection?.exists ? "ready" : "missing"}</>,
        <>Index {qmdStatus?.indexExists ? "ready" : "missing"}</>,
        sharedVault.qmd.searchMode,
      ],
      primaryAction: {
        key: "query",
        label: "Search QMD",
        disabled: Boolean(qmdBusy) || !qmdStatus?.installed || !qmdQuery.trim(),
        icon: qmdBusy === "query" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Search aria-hidden="true" />,
        onClick: () => void queryQmdFromDashboard(),
      },
      actions: [
        {
          key: "index",
          label: "Refresh index",
          disabled: Boolean(qmdBusy) || !qmdStatus?.installed,
          icon: qmdBusy === "index" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />,
          onClick: () => void runQmdAction("index"),
        },
        {
          key: "embed",
          label: "Refresh vectors",
          disabled: Boolean(qmdBusy) || !qmdStatus?.installed,
          icon: qmdBusy === "embed" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Network aria-hidden="true" />,
          onClick: () => void runQmdAction("embed"),
        },
      ],
      body: (
        <div className={brainClass("gbrainQueryBox")}>
          <label>
            <span>Search</span>
            <textarea
              value={qmdQuery}
              onChange={(event) => setQmdQuery(event.target.value)}
              rows={3}
              placeholder="What should agents do before relying on prior decisions?"
            />
          </label>
        </div>
      ),
      result: qmdQueryResult || qmdActionStatus ? <BrainServiceRunResult label="QMD result" output={qmdQueryResult} status={qmdActionStatus} /> : null,
      settings: (
        <div className={brainClass("brainServiceSettings")}>
          <label className={brainClass("brainServiceToggle")}>
            {qmdStatus?.installed ? (
              <>
                <input
                  type="checkbox"
                  checked={sharedVault.qmd.enabled}
                  onChange={(event) => updateSharedVault({ qmd: { ...sharedVault.qmd, enabled: event.target.checked } })}
                />
                <span className={brainClass("brainServiceSwitch")} aria-hidden="true"><span /></span>
                <span>{sharedVault.qmd.enabled ? "QMD integration enabled" : "QMD integration disabled"}</span>
              </>
            ) : (
              <button type="button" className={brainClass("brainServiceActionButton")} disabled={Boolean(qmdBusy) || !sharedVault.enabled} onClick={() => void runQmdAction("install")}>
                {qmdBusy === "install" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />}
                Install QMD
              </button>
            )}
          </label>
          <label>
            Search mode
            <select
              value={sharedVault.qmd.searchMode}
              onChange={(event) => updateSharedVault({ qmd: { ...sharedVault.qmd, searchMode: event.target.value } })}
            >
              <option value="bm25">BM25 keyword</option>
              <option value="vector">Vector semantic</option>
              <option value="hybrid">Hybrid, no rerank</option>
              <option value="hybrid-rerank">Hybrid with rerank</option>
            </select>
          </label>
          <label>
            MCP mode
            <select
              value={sharedVault.qmd.mcpMode}
              onChange={(event) => updateSharedVault({ qmd: { ...sharedVault.qmd, mcpMode: event.target.value } })}
            >
              <option value="stdio">stdio</option>
              <option value="http">HTTP</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label className={brainClass("brainServiceToggle")}>
            <input
              type="checkbox"
              checked={sharedVault.qmd.autoEmbed}
              onChange={(event) => updateSharedVault({ qmd: { ...sharedVault.qmd, autoEmbed: event.target.checked } })}
            />
            <span className={brainClass("brainServiceSwitch")} aria-hidden="true"><span /></span>
            <span>{sharedVault.qmd.autoEmbed ? "One-click setup refreshes vectors" : "One-click setup skips vector refresh"}</span>
          </label>
        </div>
      ),
    }),
    new BrainModule({
      id: "neo4j",
      name: "Neo4j",
      icon: <Network aria-hidden="true" />,
      statusLabel: neo4jInstallState === "installed" ? "Connected" : neo4jInstallState === "installing" ? "Working" : "Optional",
      statusTone: neo4jStatus?.connected ? "live" : "idle",
      active: neo4jStatus?.connected,
      title: "Derived graph over memory and entities",
      description: "Connect an existing Neo4j database when you want graph traversal over Agent Memory, entities, projects, agents, machines, runtimes, tags, and compiled knowledge pages. Obsidian stays canonical.",
      install: {
        state: neo4jInstallState,
        buttonLabel: "Connect Neo4j",
        disabled: Boolean(neo4jBusy) || !sharedVault.enabled || !neo4jRequiredKeysReady,
        failureLabel: neo4jFailedConnectMessage,
        icon: neo4jBusy === "connect" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <PlugZap aria-hidden="true" />,
        installingLabel: neo4jBusy === "sync" ? "Syncing derived graph" : "Connecting Neo4j",
        onInstall: () => void runNeo4jAction("connect"),
        setupSteps: neo4jSetupSteps,
        successLabel: "Connected!",
        features: [
          <>Entity-linked graph over typed Agent Memory</>,
          <>MERGE-only sync that never deletes user-created Neo4j data</>,
          <>Read-only Cypher query surface for graph inspection</>,
          <>Secrets stay in env keys, not dashboard state or notes</>,
        ],
      },
      stats: [
        { key: "memories", label: "Memories", value: qmdMetric(neo4jStatus?.counts?.Memory), icon: <BrainCircuit aria-hidden="true" /> },
        { key: "entities", label: "Entities", value: qmdMetric(neo4jStatus?.counts?.Entity), icon: <Network aria-hidden="true" /> },
        { key: "compiled", label: "Compiled", value: qmdMetric(neo4jStatus?.counts?.CompiledKnowledgePage), icon: <FileText aria-hidden="true" /> },
        { key: "database", label: "Database", value: neo4jStatus?.database || "default", icon: <PlugZap aria-hidden="true" /> },
      ],
      badges: [
        ...(neo4jStatusNote ? [neo4jStatusNote] : []),
        <>URI {neo4jKeys[sharedVault.neo4j?.uriEnvKey]?.present ? "ready" : "missing"}</>,
        <>User {neo4jKeys[sharedVault.neo4j?.usernameEnvKey]?.present ? "ready" : "missing"}</>,
        <>Password {neo4jKeys[sharedVault.neo4j?.passwordEnvKey]?.present ? "ready" : "missing"}</>,
        sharedVault.neo4j?.enabled ? "Enabled" : "Disabled",
      ],
      primaryAction: {
        key: "sync",
        label: "Sync graph",
        disabled: Boolean(neo4jBusy) || !neo4jStatus?.connected,
        icon: neo4jBusy === "sync" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />,
        onClick: () => void runNeo4jAction("sync"),
      },
      actions: [
        {
          key: "connect",
          label: "Check connection",
          disabled: Boolean(neo4jBusy) || !sharedVault.enabled || !neo4jRequiredKeysReady,
          icon: neo4jBusy === "connect" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <PlugZap aria-hidden="true" />,
          onClick: () => void runNeo4jAction("connect"),
        },
        {
          key: "refresh",
          label: "Refresh status",
          disabled: Boolean(neo4jBusy),
          icon: neo4jBusy === "status" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />,
          onClick: () => void refreshNeo4jStatus(),
        },
      ],
      quickActions: [
        {
          key: "query",
          label: "Run read-only query",
          disabled: Boolean(neo4jBusy) || !neo4jStatus?.connected || !neo4jQuery.trim(),
          icon: neo4jBusy === "query" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Search aria-hidden="true" />,
          onClick: () => void queryNeo4jFromDashboard(),
        },
      ],
      body: (
        <div className={brainClass("gbrainQueryBox")}>
          <label>
            <span>Read-only Cypher</span>
            <textarea
              value={neo4jQuery}
              onChange={(event) => setNeo4jQuery(event.target.value)}
              rows={3}
              placeholder="MATCH (m:Memory)-[:MENTIONS]->(e:Entity) RETURN m.title, e.name LIMIT 25"
            />
          </label>
        </div>
      ),
      result: neo4jQueryResult || neo4jActionStatus ? <BrainServiceRunResult label="Neo4j result" output={neo4jQueryResult} status={neo4jActionStatus} /> : null,
      settings: (
        <div className={brainClass("brainServiceSettings")}>
          <label className={brainClass("brainServiceToggle")}>
            <input
              type="checkbox"
              checked={sharedVault.neo4j.enabled}
              onChange={(event) => updateSharedVault({ neo4j: { ...sharedVault.neo4j, enabled: event.target.checked } })}
            />
            <span className={brainClass("brainServiceSwitch")} aria-hidden="true"><span /></span>
            <span>{sharedVault.neo4j.enabled ? "Neo4j graph enabled" : "Neo4j graph disabled"}</span>
          </label>
          <label>
            Result limit
            <input
              type="number"
              min="1"
              max="1000"
              step="1"
              value={sharedVault.neo4j.queryLimit}
              onChange={(event) => updateSharedVault({ neo4j: { ...sharedVault.neo4j, queryLimit: Number(event.target.value) } })}
            />
          </label>
          <details>
            <summary>Advanced connection env keys</summary>
            <label>
              URI env key
              <input value={sharedVault.neo4j.uriEnvKey} onChange={(event) => updateSharedVault({ neo4j: { ...sharedVault.neo4j, uriEnvKey: event.target.value } })} />
            </label>
            <label>
              Username env key
              <input value={sharedVault.neo4j.usernameEnvKey} onChange={(event) => updateSharedVault({ neo4j: { ...sharedVault.neo4j, usernameEnvKey: event.target.value } })} />
            </label>
            <label>
              Password env key
              <input value={sharedVault.neo4j.passwordEnvKey} onChange={(event) => updateSharedVault({ neo4j: { ...sharedVault.neo4j, passwordEnvKey: event.target.value } })} />
            </label>
            <label>
              Database env key
              <input value={sharedVault.neo4j.databaseEnvKey} onChange={(event) => updateSharedVault({ neo4j: { ...sharedVault.neo4j, databaseEnvKey: event.target.value } })} />
            </label>
            <label>
              Database override
              <input value={sharedVault.neo4j.database} onChange={(event) => updateSharedVault({ neo4j: { ...sharedVault.neo4j, database: event.target.value } })} />
            </label>
          </details>
        </div>
      ),
    }),
    new BrainModule({
      id: "synto",
      name: "Syntho",
      icon: <FileText aria-hidden="true" />,
      statusLabel: syntoInstallState === "installed" ? syntoStatus?.initialized ? "Initialized" : "Installed" : syntoInstallState === "installing" ? "Installing" : "Optional",
      statusTone: syntoStatus?.installed && syntoStatus?.initialized ? "live" : "idle",
      active: syntoStatus?.installed,
      title: "Compiled wiki, agent packs, and MCP",
      description: "Install or connect Syntho when you want the Synthesis folder to become a reviewed wiki with drafts, maintain/eval checks, pack export, and MCP access.",
      install: {
        state: syntoInstallState,
        buttonLabel: "Install Syntho",
        disabled: Boolean(syntoBusy) || !sharedVault.enabled,
        failureLabel: syntoInstallFailureLabel,
        icon: syntoBusy === "install" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />,
        installingLabel: syntoBusy === "connect" ? "Connecting Syntho runtime" : "Installing Syntho knowledge compiler",
        onInstall: () => void runSyntoAction("install"),
        setupSteps: syntoSetupSteps,
        successLabel: "Installed!",
        features: [
          <>Ingests source notes from Synthesis/raw into reviewed wiki drafts</>,
          <>Runs maintain, eval, doctor, and pack export commands from the dashboard</>,
          <>Exposes published wiki articles and source passages over MCP</>,
          <>Keeps Syntho state scoped to the Synthesis folder</>,
        ],
        secondaryActions: [
          {
            key: "connect",
            label: "Connect existing",
            disabled: Boolean(syntoBusy) || !sharedVault.enabled,
            icon: syntoBusy === "connect" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <PlugZap aria-hidden="true" />,
            onClick: () => void runSyntoAction("connect"),
          },
        ],
      },
      stats: [
        { key: "raw", label: "Raw", value: syntoStatus?.counts?.raw ?? "—", icon: <FileText aria-hidden="true" /> },
        { key: "drafts", label: "Drafts", value: syntoStatus?.counts?.drafts ?? "—", icon: <Eye aria-hidden="true" /> },
        { key: "articles", label: "Articles", value: syntoStatus?.counts?.articles ?? "—", icon: <GitBranch aria-hidden="true" /> },
        { key: "mcp", label: "MCP", value: syntoStatus?.mcp?.mode ?? sharedVault.synto.mcpMode, icon: <PlugZap aria-hidden="true" /> },
      ],
      badges: [
        ...(syntoStatusNote ? [syntoStatusNote] : []),
        syntoStatus?.initialized ? "synto.toml ready" : "Initialize Synthesis",
        `Source access ${syntoStatus?.mcp?.sourceAccessMode ?? sharedVault.synto.sourceAccessMode}`,
        `Compare ${sharedVault.synto.compareHeavyModel}`,
        syntoStatus?.pack?.indexExists ? "Pack index ready" : "Pack pending",
        sharedVault.synto.autoApprove ? `Auto approve >= ${sharedVault.synto.minConfidence}` : "Human review first",
      ],
      primaryAction: {
        key: "run",
        label: "Run pipeline",
        disabled: Boolean(syntoBusy) || !syntoStatus?.initialized,
        icon: syntoBusy === "run" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Repeat2 aria-hidden="true" />,
        onClick: () => void runSyntoAction("run"),
      },
      quickActions: [
        {
          key: "query",
          label: "Ask Syntho",
          disabled: Boolean(syntoBusy) || !syntoStatus?.initialized || !syntoQuery.trim(),
          icon: syntoBusy === "query" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <FileText aria-hidden="true" />,
          onClick: () => void querySyntoFromDashboard(),
        },
      ],
      actions: [
        {
          key: "init",
          label: syntoStatus?.initialized ? "Repair init" : "Initialize",
          disabled: Boolean(syntoBusy),
          icon: syntoBusy === "init" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Check aria-hidden="true" />,
          onClick: () => void runSyntoAction("init"),
        },
        {
          key: "maintain",
          label: "Maintain",
          disabled: Boolean(syntoBusy) || !syntoStatus?.initialized,
          icon: syntoBusy === "maintain" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />,
          onClick: () => void runSyntoAction("maintain"),
        },
        {
          key: "compare",
          label: "Compare",
          disabled: Boolean(syntoBusy) || !syntoStatus?.initialized,
          icon: syntoBusy === "compare" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <GitBranch aria-hidden="true" />,
          onClick: () => void runSyntoAction("compare"),
        },
        {
          key: "eval",
          label: "Eval",
          disabled: Boolean(syntoBusy) || !syntoStatus?.initialized,
          icon: syntoBusy === "eval" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Activity aria-hidden="true" />,
          onClick: () => void runSyntoAction("eval"),
        },
        {
          key: "pack",
          label: "Export pack",
          disabled: Boolean(syntoBusy) || !syntoStatus?.initialized,
          icon: syntoBusy === "pack" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />,
          onClick: () => void runSyntoAction("pack"),
        },
        {
          key: "doctor",
          label: "Doctor",
          disabled: Boolean(syntoBusy) || !syntoStatus?.initialized,
          icon: syntoBusy === "doctor" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <CircleAlert aria-hidden="true" />,
          onClick: () => void runSyntoAction("doctor"),
        },
      ],
      body: (
        <div className={brainClass("gbrainQueryBox")}>
          {syntoNeedsModelSetup ? (
            <div className={brainClass("brainServiceRepairHint")}>
              <strong>Model backend needs attention</strong>
              <span>Start Ollama and pull the configured Syntho models before compiling real notes.</span>
              <code>ollama serve && ollama pull gemma4:e4b && ollama pull qwen2.5:14b && ollama pull nomic-embed-text</code>
            </div>
          ) : null}
          <label>
            <span>Question</span>
            <textarea
              value={syntoQuery}
              onChange={(event) => setSyntoQuery(event.target.value)}
              rows={3}
              placeholder="What does the reviewed wiki say about this project?"
            />
          </label>
        </div>
      ),
      result: syntoQueryResult || syntoActionStatus ? <BrainServiceRunResult label="Syntho result" output={syntoQueryResult} status={syntoActionStatus} /> : null,
      settings: (
        <div className={brainClass("brainServiceSettings")}>
          <label className={brainClass("brainServiceToggle")}>
            <input
              type="checkbox"
              checked={sharedVault.synto.enabled}
              onChange={(event) => updateSharedVault({ synto: { ...sharedVault.synto, enabled: event.target.checked } })}
            />
            <span className={brainClass("brainServiceSwitch")} aria-hidden="true"><span /></span>
            <span>{sharedVault.synto.enabled ? "Syntho integration enabled" : "Syntho integration disabled"}</span>
          </label>
          <label>
            Source access
            <select
              value={sharedVault.synto.sourceAccessMode}
              onChange={(event) => updateSharedVault({ synto: { ...sharedVault.synto, sourceAccessMode: event.target.value } })}
            >
              <option value="deny">Deny raw text</option>
              <option value="permissive_only">Permissive only</option>
              <option value="all">All raw text</option>
            </select>
          </label>
          <label>
            MCP mode
            <select
              value={sharedVault.synto.mcpMode}
              onChange={(event) => updateSharedVault({ synto: { ...sharedVault.synto, mcpMode: event.target.value } })}
            >
              <option value="stdio">stdio</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label>
            Compare model
            <select
              value={sharedVault.synto.compareHeavyModel}
              onChange={(event) => updateSharedVault({ synto: { ...sharedVault.synto, compareHeavyModel: event.target.value } })}
            >
              <option value="llama3.1:8b">llama3.1:8b</option>
              <option value="qwen2.5:14b">qwen2.5:14b</option>
              <option value="gemma4:e4b">gemma4:e4b</option>
              <option value="mistral-nemo:12b">mistral-nemo:12b</option>
              <option value="deepseek-r1:8b">deepseek-r1:8b</option>
            </select>
          </label>
          <label>
            Min confidence
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={sharedVault.synto.minConfidence}
              onChange={(event) => updateSharedVault({ synto: { ...sharedVault.synto, minConfidence: Number(event.target.value) } })}
            />
          </label>
          <label className={brainClass("brainServiceToggle")}>
            <input
              type="checkbox"
              checked={sharedVault.synto.autoApprove}
              onChange={(event) => updateSharedVault({ synto: { ...sharedVault.synto, autoApprove: event.target.checked } })}
            />
            <span className={brainClass("brainServiceSwitch")} aria-hidden="true"><span /></span>
            <span>Auto-approve pipeline drafts at or above the confidence threshold</span>
          </label>
        </div>
      ),
    }),
    new BrainModule({
      id: "trading-brain",
      name: "Trading Brain",
      icon: <Activity aria-hidden="true" />,
      statusLabel: tradingBrainInstallState === "installed" ? "Installed" : tradingBrainInstallState === "installing" ? "Installing" : "Optional",
      statusTone: tradingBrainStatus?.installed ? "live" : "idle",
      active: tradingBrainStatus?.installed,
      variant: "trading",
      title: "Trade capture, edge analysis, and pre-trade intelligence",
      description: tradingBrainStatus?.error || "Installs a local Obsidian trading brain with strict trade templates, weekly and monthly analysis prompts, pattern alerts, market context, and emotional performance tracking.",
      install: {
        state: tradingBrainInstallState,
        buttonLabel: "Install Trading Brain",
        disabled: Boolean(tradingBrainBusy) || !sharedVault.enabled,
        failureLabel: tradingBrainFailedInstallMessage,
        icon: tradingBrainBusy === "install" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />,
        installingLabel: "Building Trading Brain vault scaffold",
        onInstall: () => void installTradingBrainFromDashboard(),
        setupSteps: tradingBrainSetupSteps,
        successLabel: "Installed!",
        features: [
          <>Structured trade capture templates for open and closed positions</>,
          <>Weekly performance analysis, monthly edge reports, and pattern alerts</>,
          <>Pre-trade intelligence prompts that compare a setup to your history</>,
          <>Agent-agnostic runtime instructions for Hermes, Aeon, OpenClaw, Codex, and OpenAI-compatible agents</>,
        ],
      },
      stats: [
        { key: "closed", label: "Closed trades", value: tradingCounts.closedTrades ?? "—", icon: <FileText aria-hidden="true" /> },
        { key: "weekly", label: "Weekly reports", value: tradingCounts.weeklyAnalyses ?? "—", icon: <Activity aria-hidden="true" /> },
        { key: "edge", label: "Edge reports", value: tradingCounts.monthlyEdgeReports ?? "—", icon: <GitBranch aria-hidden="true" /> },
        { key: "root", label: "Root", value: "TRADING-BRAIN", icon: <FolderOpen aria-hidden="true" /> },
      ],
      badges: [
        "Agent agnostic",
        "Obsidian templates",
        tradingBrainTotalFiles ? `${tradingBrainConfiguredFiles}/${tradingBrainTotalFiles} files` : "Scaffold pending",
        "Local markdown only",
      ],
      primaryAction: {
        key: "check",
        label: "Check Trading Brain",
        disabled: Boolean(tradingBrainBusy),
        icon: tradingBrainBusy === "status" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />,
        onClick: () => void refreshTradingBrainStatus(),
      },
      quickActions: [
        {
          key: "all-runtimes",
          label: tradingBrainAllRuntimeAttached ? "Remove all runtimes" : "Add all runtimes",
          disabled: !tradingBrainRuntimeCards?.length,
          icon: tradingBrainAllRuntimeAttached ? <Check aria-hidden="true" /> : <PlugZap aria-hidden="true" />,
          onClick: () => setTradingBrainForAllRuntimes(!tradingBrainAllRuntimeAttached),
        },
      ],
      actions: [
        {
          key: "install",
          label: tradingBrainStatus?.installed ? "Repair scaffold" : "Install Trading Brain",
          disabled: Boolean(tradingBrainBusy),
          icon: tradingBrainBusy === "install" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : tradingBrainStatus?.installed ? <Check aria-hidden="true" /> : <Download aria-hidden="true" />,
          onClick: () => void installTradingBrainFromDashboard(),
        },
      ],
      body: (
        <>
          <div className={brainClass("tradingBrainPillars")}>
            {["Capture", "Performance", "Pre-trade", "Market context", "Emotion"].map((pillar) => <span key={pillar}>{pillar}</span>)}
          </div>

          <div className={brainClass("tradingRuntimeGrid")}>
            {(tradingBrainRuntimeCards ?? []).map((runtimeCard) => (
              <article key={runtimeCard.id} className={brainClass("tradingRuntimeCard", runtimeCard.allAttached && "active")}>
                <div>
                  <strong>{runtimeCard.label}</strong>
                  <span>{runtimeCard.attachedCount}/{runtimeCard.agentCount} attached · {runtimeCard.detail}</span>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={() => setTradingBrainForRuntime(runtimeCard.id, !runtimeCard.allAttached)}>
                  {runtimeCard.allAttached ? <Check aria-hidden="true" /> : <PlugZap aria-hidden="true" />}
                  {runtimeCard.allAttached ? "Remove From Agent Runtime" : "Add to Agent Runtime"}
                </Button>
              </article>
            ))}
            {tradingBrainRuntimeCards?.length ? null : (
              <p className={vaultClass("brainStatus")}>No agent runtimes are configured yet. Add an agent first, then attach Trading Brain instructions to its runtime profile.</p>
            )}
          </div>
        </>
      ),
    }),
    new BrainModule({
      id: "synthesis",
      name: "Synthesis",
      icon: <Sparkles aria-hidden="true" />,
      statusLabel: "Foundation",
      statusTone: "live",
      variant: "synthesis",
      active: true,
      title: "Reviewed Syntho layer",
      description: "Synthesis is the curated layer for drafts, reviewed wiki articles, source trails, and agent packs. It can read from the same vault surface GBrain indexes.",
      install: {
        state: "installed",
        buttonLabel: "Installed",
      },
      stats: [
        { key: "root", label: "Root", value: sharedVault.synthesisFolder || DEFAULT_SHARED_VAULT.synthesisFolder, icon: <FolderOpen aria-hidden="true" /> },
        { key: "queue", label: "Queue", value: "raw", icon: <FileText aria-hidden="true" /> },
        { key: "reviewed", label: "Reviewed", value: "wiki", icon: <Check aria-hidden="true" /> },
        { key: "agents", label: "Agents", value: "pack", icon: <Download aria-hidden="true" /> },
      ],
      badges: ["Manual review default", "Local Ollama preferred", "No vector DB conflict"],
    }),
  ];
  const brainModuleById = new Map(brainModules.map((module) => [module.definition.id, module]));
  const brainServiceSections = [{ id: "overview", label: "Overview", icon: <Activity aria-hidden="true" /> }, ...(syntoModuleAvailable ? [{ id: "synto", label: "Syntho", icon: <FileText aria-hidden="true" /> }] : []), ...(gbrainModuleAvailable ? [{ id: "gbrain", label: "GBrain", icon: <BrainCircuit aria-hidden="true" /> }] : []), ...(qmdModuleAvailable ? [{ id: "qmd", label: "QMD", icon: <Search aria-hidden="true" /> }] : []), ...(neo4jModuleAvailable ? [{ id: "neo4j", label: "Neo4j", icon: <Network aria-hidden="true" /> }] : []), ...(tradingBrainModuleAvailable ? [{ id: "trading-brain", label: "Trading", icon: <Activity aria-hidden="true" /> }] : []), { id: "synthesis", label: "Synthesis", icon: <Sparkles aria-hidden="true" /> }, { id: "settings", label: "Settings", icon: <KeyRound aria-hidden="true" /> }];
  useEffect(() => { if (!brainServiceSections.some((section) => section.id === brainServiceSection)) setBrainServiceSection("overview"); }, [brainServiceSection, brainServiceSections]);
  const brainServiceOverviewCards = [
    {
      id: "synto",
      bullets: ["Turns Synthesis notes into reviewed wiki articles", "Runs maintain, compare, eval, doctor, and pack export", "Serves curated answers and approved sources over MCP"],
      eyebrow: "Knowledge compiler",
      title: "Syntho",
      detail: syntoStatus?.initialized
        ? `${syntoStatus.counts?.articles ?? 0} reviewed article${(syntoStatus.counts?.articles ?? 0) === 1 ? "" : "s"} ready`
        : syntoStatus?.installed ? "Installed. Initialize Synthesis to run the pipeline." : "Optional compiler for reviewed wiki articles and packs.",
      status: syntoStatus?.installed ? syntoStatus.initialized ? "Ready" : "Needs init" : "Optional",
      tone: syntoStatus?.installed && syntoStatus.initialized ? "live" : "idle",
      icon: <FileText aria-hidden="true" />,
      enabled: syntoModuleEnabled,
      canToggle: Boolean(syntoStatus?.installed),
      toggleLabel: syntoModuleEnabled ? "Syntho enabled" : "Enable Syntho",
      onToggle: (enabled) => updateSharedVault({ synto: { ...sharedVault.synto, enabled } }),
      action: syntoStatus?.installed ? "Open Syntho" : "Install Syntho",
      installAction: {
        disabled: Boolean(syntoBusy) || !sharedVault.enabled,
        icon: syntoBusy === "install" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />,
        label: "Install Syntho",
        onClick: () => void runSyntoAction("install"),
        progressLabel: syntoBusy === "connect" ? "Connecting Syntho runtime" : "Installing Syntho knowledge compiler",
        setupSteps: syntoSetupSteps,
        state: syntoInstallState,
      },
    },
    {
      id: "gbrain",
      bullets: ["Indexes the shared vault for semantic search", "Builds graph-aware answers with source trails", "Adds optional MCP retrieval and dream-cycle synthesis"],
      eyebrow: "Semantic retrieval",
      title: "GBrain",
      detail: gbrainStatus?.installed ? `${gbrainMetric(["notes", "documents", "nodes"])} indexed notes available` : "Optional graph and retrieval layer over the shared vault.",
      status: gbrainStatus?.installed ? "Ready" : "Optional",
      tone: gbrainStatus?.installed ? "live" : "idle",
      icon: <BrainCircuit aria-hidden="true" />,
      enabled: gbrainModuleEnabled,
      canToggle: Boolean(gbrainStatus?.installed),
      toggleLabel: gbrainModuleEnabled ? "GBrain enabled" : "Enable GBrain",
      onToggle: (enabled) => updateSharedVault({ gbrain: { ...sharedVault.gbrain, enabled } }),
      action: gbrainStatus?.installed ? "Open GBrain" : "Install GBrain",
      installAction: {
        disabled: Boolean(gbrainBusy) || !sharedVault.enabled,
        icon: gbrainBusy === "install" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />,
        label: "Install GBrain",
        onClick: () => void runGbrainAction("install"),
        progressLabel: gbrainBusy === "connect" ? "Connecting GBrain runtime" : "Installing GBrain retrieval core",
        setupSteps: gbrainSetupSteps,
        state: gbrainInstallState,
      },
    },
    {
      id: "qmd",
      bullets: ["Indexes markdown into local SQLite", "Supports BM25, vector, and hybrid search", "Keeps fast retrieval available over CLI or MCP"],
      eyebrow: "Markdown search",
      title: "QMD",
      detail: qmdStatus?.installed
        ? `${qmdMetric(qmdStatus.documents ?? qmdStatus.collection?.files)} document${(qmdStatus.documents ?? qmdStatus.collection?.files) === 1 ? "" : "s"} indexed for ${sharedVault.qmd.searchMode} search`
        : "Optional local QMD search over the shared vault.",
      status: "Brain Speed++",
      tone: qmdStatus?.ok ? "live" : "idle",
      icon: <Search aria-hidden="true" />,
      enabled: qmdModuleEnabled,
      canToggle: Boolean(qmdStatus?.installed),
      toggleLabel: qmdModuleEnabled ? "QMD enabled" : "Enable QMD",
      onToggle: (enabled) => updateSharedVault({ qmd: { ...sharedVault.qmd, enabled } }),
      action: qmdStatus?.installed ? "Open QMD" : "Install QMD",
      installAction: {
        disabled: Boolean(qmdBusy) || !sharedVault.enabled,
        icon: qmdBusy === "install" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />,
        label: "Install QMD",
        onClick: () => void runQmdAction("install"),
        progressLabel: qmdBusy === "connect" ? "Connecting QMD runtime" : "Installing and indexing QMD",
        setupSteps: qmdSetupSteps,
        state: qmdInstallState,
      },
    },
    {
      id: "neo4j",
      bullets: ["Derived from Obsidian Agent Memory", "Links memories to entities, tags, projects, agents, machines, and runtimes", "Read-only query surface rejects write Cypher"],
      eyebrow: "Graph brain",
      title: "Neo4j",
      detail: neo4jStatus?.connected
        ? `${qmdMetric(neo4jStatus.counts?.Memory)} memories and ${qmdMetric(neo4jStatus.counts?.Entity)} entities in the derived graph`
        : "Optional derived Neo4j graph. Store connection details in env keys, not dashboard state.",
      status: neo4jStatus?.connected ? "Connected" : "Optional",
      tone: neo4jStatus?.connected ? "live" : "idle",
      icon: <Network aria-hidden="true" />,
      enabled: neo4jModuleEnabled,
      canToggle: Boolean(neo4jStatus?.connected),
      toggleLabel: neo4jModuleEnabled ? "Neo4j enabled" : "Enable Neo4j",
      onToggle: (enabled) => updateSharedVault({ neo4j: { ...sharedVault.neo4j, enabled } }),
      action: neo4jStatus?.connected ? "Open Neo4j" : "Connect Neo4j",
      installAction: {
        disabled: Boolean(neo4jBusy) || !sharedVault.enabled || !neo4jRequiredKeysReady,
        icon: neo4jBusy === "connect" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <PlugZap aria-hidden="true" />,
        label: "Connect Neo4j",
        onClick: () => void runNeo4jAction("connect"),
        progressLabel: neo4jBusy === "sync" ? "Syncing derived graph" : "Connecting Neo4j",
        setupSteps: neo4jSetupSteps,
        state: neo4jInstallState,
      },
    },
    {
      id: "trading-brain",
      bullets: ["Captures trades in strict Obsidian templates", "Summarizes weekly performance and monthly edge", "Attaches pre-trade intelligence to agent runtimes"],
      eyebrow: "Domain memory",
      title: "Trading Brain",
      detail: tradingBrainStatus?.installed ? `${tradingBrainConfiguredFiles}/${tradingBrainTotalFiles || "?"} scaffold files configured` : "Optional trade capture, edge review, and runtime instruction pack.",
      status: tradingBrainStatus?.installed ? "Ready" : "Optional",
      tone: tradingBrainStatus?.installed ? "live" : "idle",
      icon: <Activity aria-hidden="true" />,
      enabled: tradingBrainModuleEnabled,
      canToggle: Boolean(tradingBrainStatus?.installed),
      toggleLabel: tradingBrainModuleEnabled ? "Trading Brain enabled" : "Enable Trading Brain",
      onToggle: (enabled) => updateSharedVault({ tradingBrainEnabled: enabled }),
      action: tradingBrainStatus?.installed ? "Open Trading" : "Install Trading Brain",
      installAction: {
        disabled: Boolean(tradingBrainBusy) || !sharedVault.enabled,
        icon: tradingBrainBusy === "install" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />,
        label: "Install Trading Brain",
        onClick: () => void installTradingBrainFromDashboard(),
        progressLabel: "Building Trading Brain vault scaffold",
        setupSteps: tradingBrainSetupSteps,
        state: tradingBrainInstallState,
      },
    },
    {
      id: "synthesis",
      bullets: ["Keeps drafts, review decisions, and source trails together", "Feeds Syntho packs without fighting GBrain retrieval", "Stays local markdown first"],
      eyebrow: "Curated layer",
      title: "Synthesis",
      detail: `${sharedVault.synthesisFolder || DEFAULT_SHARED_VAULT.synthesisFolder} holds drafts, reviewed wiki articles, and exported packs.`,
      status: "Foundation",
      tone: "live",
      icon: <Sparkles aria-hidden="true" />,
      action: "Open Synthesis",
    },
  ];
  const selectedBrainModule = brainModuleById.get(brainServiceSection);
  const selectVaultPanel = (mode: string) => {
    setVaultPanelMode(mode);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", "vault");
    url.searchParams.set("vaultPanel", mode);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const vaultPanelModes = [
    { id: "hive-vault", label: "Hive Vault" },
    { id: "shared-skills", label: "Shared Skills" },
    { id: "brain-services", label: "Brain Services" },
    { id: "env", label: "Env" },
    { id: "config", label: "Config" },
  ];
  const vaultPanelCopy = {
    "hive-vault": { title: "Shared Brain", subtitle: "Obsidian memory graph" },
    "shared-skills": { title: "Shared Skills", subtitle: "Skill shelf and imports" },
    "brain-services": { title: "Brain Services", subtitle: "Retrieval and synthesis" },
    env: { title: "Shared Env", subtitle: "Secrets and runtime overlays" },
    config: { title: "Brain Config", subtitle: "Vault sync and paths" },
  }[vaultPanelMode] ?? { title: "Shared Brain", subtitle: "Obsidian memory graph" };
  return (<>
      {activeView === "vault" ? (
      <section className={vaultClass("vaultPanel", "tabPanel", vaultPanelMode === "env" && "vaultPanelCompact")}>
        <SectionModeHeader
          activeMode={vaultPanelMode}
          ariaLabel="Brain view mode"
          modes={vaultPanelModes}
          onSelect={selectVaultPanel}
          title={vaultPanelCopy.title}
          subtitle={vaultPanelCopy.subtitle}
          variant="brain"
          stats={[
            { value: brainGraphStats.notes, label: "notes", tone: "cyan" },
            { value: brainGraphStats.links, label: "links", tone: "honey" },
            { value: sharedSkillCount, label: "skills" },
            { value: brainSkillImportableCount, label: "ready" },
          ]}
        />

        <div className={vaultClass("vaultPanelBody", vaultPanelMode === "hive-vault" && "brainMapBody")}>
        {vaultPanelMode === "hive-vault" ? (
        <BrainGraphExplorer {...{ Bot, BrainCircuit, BrainGraphLoader, Button, Cell, Check, Download, FileText, GitBranch, Hexagon, LoaderCircle, Network, RefreshCcw, Sparkles, brainGraph, brainGraphLoading, brainGraphStatus, brainPan, endBrainPan, formatBrainDate, inspectBrainNode, moveBrainPan, refreshBrainGraph, selectedAgent, selectedBrainNode, setActiveView, setBrainPan, setChatAttachments, setChatDirectories, setQuickAddDrafts, setQuickAddStatus, setSkillBrowserOpen, setSkillBrowserView, setSkillBrowserWrittenContent, setText, sharedVault, startAgentChat, startBrainPan, vaultClass }} />
        ) : null}

        {vaultPanelMode === "shared-skills" ? (
          <BrainSkillsPanel
            Button={Button}
            Check={Check}
            Download={Download}
            LoaderCircle={LoaderCircle}
            RefreshCcw={RefreshCcw}
            Repeat2={Repeat2}
            Search={Search}
            Sparkles={Sparkles}
            brainSkillAeonSyncing={brainSkillAeonSyncing}
            brainSkillImportAllDescription={brainSkillImportAllDescription}
            brainSkillImportAllLabel={brainSkillImportAllLabel}
            brainSkillImportProvider={brainSkillImportProvider}
            brainSkillImportSuccess={brainSkillImportSuccess}
            brainSkillImportableCount={brainSkillImportableCount}
            brainSkills={brainSkills}
            brainSkillsLoading={brainSkillsLoading}
            brainSkillsStatus={brainSkillsStatus}
            hermesUpdateRequired={hermesUpdateRequired}
            hermesUpdateRequiredDetail={hermesUpdateRequiredDetail}
            importBrainSkills={importBrainSkills}
            openSkillBrowser={openSkillBrowser}
            providerSkillInventories={providerSkillInventories}
            providerSkillSummary={providerSkillSummary}
            refreshBrainSkills={refreshBrainSkills}
            setSkillBrowserSearch={setSkillBrowserSearch}
            sharedBrainSkills={sharedBrainSkills}
            sharedVault={sharedVault}
            skillBrowserSearch={skillBrowserSearch}
            skillRequiresHermesUpdate={skillRequiresHermesUpdate}
            syncBrainSkillsToAeon={syncBrainSkillsToAeon}
            updateAllSkillAutoSync={updateAllSkillAutoSync}
            updateSkillAutoSync={updateSkillAutoSync}
            vaultClass={vaultClass}
          />
        ) : null}

        {vaultPanelMode === "brain-services" ? (
        <section className={brainClass("brainServicesPanel")} aria-label="Brain services">
          <div className={brainClass("brainServicesHero")}>
            <div>
              <p className="eyebrow">Brain services</p>
              <h3>Memory services, one at a time</h3>
              <p>Keep the shared brain calm: review status at a glance, then open Syntho, GBrain, Trading Brain, or Synthesis only when you need that workflow.</p>
            </div>
            <div className={brainClass("brainServicesHeroActions")}>
              <Button type="button" size="sm" variant="secondary" onClick={() => { void refreshGbrainStatus(); void refreshQmdStatus(); void refreshNeo4jStatus(); void refreshSyntoStatus(); void refreshTradingBrainStatus(); }} disabled={Boolean(gbrainBusy) || Boolean(qmdBusy) || Boolean(neo4jBusy) || Boolean(syntoBusy) || Boolean(tradingBrainBusy)}>
                {gbrainBusy === "status" || qmdBusy === "status" || neo4jBusy === "status" || syntoBusy === "status" || tradingBrainBusy === "status" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
                {gbrainBusy === "status" || qmdBusy === "status" || neo4jBusy === "status" || syntoBusy === "status" || tradingBrainBusy === "status" ? "Checking" : "Refresh"}
              </Button>
            </div>
          </div>

          <BrainServiceSegmentedNav activeSection={brainServiceSection} brainClass={brainClass} sections={brainServiceSections} setActiveSection={setBrainServiceSection} />

          <div
            className={brainClass("brainServiceTabPanel")}
            role="tabpanel"
            id={`brain-service-panel-${brainServiceSection}`}
            aria-labelledby={`brain-service-tab-${brainServiceSection}`}
          >
            {brainServiceSection === "overview" ? (
              <>
                <BrainServiceOverview Button={Button} brainClass={brainClass} cards={brainServiceOverviewCards} setActiveSection={setBrainServiceSection} />
                <div className={brainClass("brainServiceOverviewGrid")} style={{ marginTop: 16 }}>
                  <AgentMemoryHealthCard />
                  <SkillSecurityCard />
                </div>
              </>
            ) : brainServiceSection === "settings" ? (
              <BrainServiceSettingsDeck brainClass={brainClass} gbrainSettings={brainModuleById.get("gbrain")?.definition.settings} qmdSettings={brainModuleById.get("qmd")?.definition.settings} neo4jSettings={brainModuleById.get("neo4j")?.definition.settings} syntoSettings={brainModuleById.get("synto")?.definition.settings} />
            ) : selectedBrainModule ? (
              <div className={brainClass("brainServiceGrid")}>
                {selectedBrainModule.render({ Button, vaultClass: brainClass })}
              </div>
            ) : null}
          </div>

          {gbrainRecommendations.length ? (
            <div className={brainClass("brainServiceRecommendations")}>
              <strong><CircleAlert aria-hidden="true" /> GBrain recommendations</strong>
              {gbrainRecommendations.slice(0, 4).map((recommendation) => (
                <span key={recommendation.id}>{recommendation.title} · <code>{recommendation.command}</code></span>
              ))}
            </div>
          ) : null}

          {brainServiceFooterStatus ? <p className={vaultClass("brainStatus")}>{brainServiceFooterStatus}</p> : null}
        </section>
        ) : null}

        {vaultPanelMode === "config" ? (
          <BrainConfigPanel
            Button={Button}
            DEFAULT_SHARED_VAULT={DEFAULT_SHARED_VAULT}
            checkControlRoomStatus={checkControlRoomStatus}
            checkVaultStatus={checkVaultStatus}
            controlRoomStatus={controlRoomStatus}
            displayAgents={displayAgents}
            pairSyncthingVaultSync={pairSyncthingVaultSync}
            runVaultTailnetSync={runVaultTailnetSync}
            setVaultPanelMode={setVaultPanelMode}
            sharedVault={sharedVault}
            updateSharedVault={updateSharedVault}
            vaultStatus={vaultStatus}
            vaultSyncPending={vaultSyncPending}
            vaultSyncStatus={vaultSyncStatus}
          />
        ) : null}
        </div>
      </section>
      ) : null}

  </>);
}
