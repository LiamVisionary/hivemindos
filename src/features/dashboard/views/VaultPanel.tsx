// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

import { BrainModule } from "@/features/dashboard/brain-modules";
import { useEffect, useRef, useState } from "react";
import { BrainGraphExplorer } from "./BrainGraphExplorer";
import { BrainServiceOverview, BrainServiceRunResult, BrainServiceSegmentedNav, BrainServiceSettingsDeck } from "./brain-services-ui";
import brainServiceStyles from "./brain-services.module.css";
import { SectionModeHeader } from "./WorkSectionHeader";

export function VaultPanel(props: any) {
  const { Activity, BRAIN_SKILL_PROVIDER_FALLBACK, Bot, BrainCircuit, BrainGraphLoader, Button, Cell, Check, CircleAlert, Clock3, DEFAULT_SHARED_VAULT, Download, Eye, FileText, FolderOpen, GitBranch, Hexagon, Image, KeyRound, LoaderCircle, MemoryCell, Network, PlugZap, RefreshCcw, Repeat2, Sparkles, activeView, brainGraph, brainGraphEdgePath, brainGraphLoading, brainGraphStats, brainGraphStatus, brainNodePoints, brainPan, brainSkillAeonSyncing, brainSkillImportAllDescription, brainSkillImportAllLabel, brainSkillImportProvider, brainSkillImportSuccess, brainSkillImportableCount, brainSkills, brainSkillsLoading, brainSkillsStatus, checkControlRoomStatus, checkVaultStatus, controlRoomStatus, displayAgents, endBrainPan, formatBrainDate, gbrainActionStatus, gbrainBusy, gbrainQuery, gbrainQueryResult, gbrainStatus, hermesUpdateRequired, hermesUpdateRequiredDetail, importBrainSkills, inspectBrainNode, installTradingBrainFromDashboard, moveBrainPan, openSkillBrowser, pairSyncthingVaultSync, queryGbrainFromDashboard, querySyntoFromDashboard, refreshBrainGraph, refreshBrainSkills, refreshGbrainStatus, refreshSyntoStatus, refreshTradingBrainStatus, runGbrainAction, runSyntoAction, runVaultTailnetSync, selectedAgent, selectedBrainNode, setActiveView, setBrainPan, setGbrainQuery, setQuickAddDrafts, setQuickAddStatus, setSkillBrowserOpen, setSkillBrowserSearch, setSkillBrowserView, setSkillBrowserWrittenContent, setSyntoQuery, setText, setTradingBrainForAllRuntimes, setTradingBrainForRuntime, setVaultPanelMode, sharedVault, skillBrowserSearch, skillRequiresHermesUpdate, splitBrainLabel, startBrainPan, syncBrainSkillsToAeon, syntoActionStatus, syntoBusy, syntoQuery, syntoQueryResult, syntoStatus, tradingBrainActionStatus, tradingBrainAllRuntimeAttached, tradingBrainBusy, tradingBrainRuntimeCards, tradingBrainStatus, updateAllSkillAutoSync, updateSharedVault, updateSkillAutoSync, vaultClass, vaultPanelMode, vaultStatus, vaultSyncPending, vaultSyncStatus } = props;
  const brainClass = (...classes) => classes.map((className) => brainServiceStyles[className] || vaultClass(className)).filter(Boolean).join(" ");
  const gbrainMetric = (keys: string[]) => {
    const stats = gbrainStatus?.stats ?? {};
    for (const key of keys) {
      const value = stats[key] ?? stats[key.toLowerCase()] ?? stats[key.replace(/([A-Z])/g, "_$1").toLowerCase()];
      if (typeof value === "number" || typeof value === "string") return value;
    }
    return "—";
  };
  const gbrainKeys = gbrainStatus?.keyStatus ?? {};
  const gbrainRecommendations = gbrainStatus?.features?.recommendations ?? [];
  const [brainModuleSuccess, setBrainModuleSuccess] = useState<Record<string, boolean>>({});
  const [brainServiceSection, setBrainServiceSection] = useState("overview");
  const previousGbrainBusyRef = useRef("");
  const previousSyntoBusyRef = useRef("");
  const previousTradingBrainBusyRef = useRef("");
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
  const filteredSharedBrainSkills = sharedBrainSkills.filter((skill) => skillMatchesBrowserSearch(skill, skill.providerLabel || "Shared brain"));
  const providerSkillInventories = (brainSkills?.providers ?? BRAIN_SKILL_PROVIDER_FALLBACK).map((provider) => ({
    ...provider,
    skills: skillSearchQuery ? provider.skills.filter((skill) => skillMatchesBrowserSearch(skill, provider.label)) : provider.skills,
  }));
  const filteredProviderSkillTotal = providerSkillInventories.reduce((total, provider) => total + provider.skills.length, 0);
  const providerSkillSummary = skillSearchQuery
    ? `${filteredProviderSkillTotal} matching provider skill${filteredProviderSkillTotal === 1 ? "" : "s"}`
    : `${brainSkills?.totals.importable ?? 0} skill${(brainSkills?.totals.importable ?? 0) === 1 ? "" : "s"} ready to mirror into Obsidian`;
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
    gbrainStatus?.installed || gbrainBusy === "install" || gbrainBusy === "connect" ? gbrainActionStatus : "",
  ].find(Boolean) || "";
  const syntoOutputHints = `${syntoActionStatus}\n${syntoQueryResult}`;
  const syntoNeedsModelSetup = /ollama|model/i.test(syntoOutputHints) && /missing|not running|not found|failed|error/i.test(syntoOutputHints);
  const gbrainSetupSteps = ["Check Bun runtime", "Install GBrain CLI", "Initialize local brain", "Import shared vault", "Refresh stale embeddings", "Extract graph links", "Scaffold retrieval skills"];
  const syntoSetupSteps = ["Install Syntho CLI", "Initialize Synthesis", "Run doctor checks", "Prepare MCP surface"];
  const tradingBrainSetupSteps = ["Create vault folders", "Write trading templates", "Seed runtime guidance", "Verify scaffold"];
  const syntoModuleEnabled = Boolean(syntoStatus?.installed && sharedVault.synto.enabled);
  const gbrainModuleEnabled = Boolean(gbrainStatus?.installed && sharedVault.gbrain.enabled);
  const tradingBrainModuleEnabled = Boolean(tradingBrainStatus?.installed && sharedVault.tradingBrainEnabled);
  const syntoModuleAvailable = Boolean(syntoStatus?.installed || syntoBusy === "install" || syntoBusy === "connect" || brainModuleSuccess.synto);
  const gbrainModuleAvailable = Boolean(gbrainStatus?.installed || gbrainBusy === "install" || gbrainBusy === "connect" || brainModuleSuccess.gbrain);
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
                {sharedVault.gbrain.enabled ? "GBrain integration enabled" : "GBrain integration disabled"}
              </>
            ) : (
              <Button type="button" size="sm" variant="secondary" disabled={Boolean(gbrainBusy) || !sharedVault.enabled} onClick={() => void runGbrainAction("install")}>
                {gbrainBusy === "install" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />}
                Install GBrain
              </Button>
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
            {sharedVault.synto.enabled ? "Syntho integration enabled" : "Syntho integration disabled"}
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
            Auto-approve pipeline drafts at or above the confidence threshold
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
  const brainServiceSections = [{ id: "overview", label: "Overview", icon: <Activity aria-hidden="true" /> }, ...(syntoModuleAvailable ? [{ id: "synto", label: "Syntho", icon: <FileText aria-hidden="true" /> }] : []), ...(gbrainModuleAvailable ? [{ id: "gbrain", label: "GBrain", icon: <BrainCircuit aria-hidden="true" /> }] : []), ...(tradingBrainModuleAvailable ? [{ id: "trading-brain", label: "Trading", icon: <Activity aria-hidden="true" /> }] : []), { id: "synthesis", label: "Synthesis", icon: <Sparkles aria-hidden="true" /> }, { id: "settings", label: "Settings", icon: <KeyRound aria-hidden="true" /> }];
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
          stats={[
            { value: brainGraphStats.notes, label: "notes", tone: "cyan" },
            { value: brainGraphStats.links, label: "links", tone: "honey" },
            { value: sharedBrainSkills.length, label: "skills" },
            { value: brainSkillImportableCount, label: "ready" },
          ]}
        />

        <div className={vaultClass("vaultPanelBody", vaultPanelMode === "hive-vault" && "brainMapBody")}>
        {vaultPanelMode === "hive-vault" ? (
        <BrainGraphExplorer {...{ Bot, BrainCircuit, BrainGraphLoader, Button, Cell, Check, Download, FileText, GitBranch, Hexagon, LoaderCircle, Network, RefreshCcw, Sparkles, brainGraph, brainGraphEdgePath, brainGraphLoading, brainGraphStats, brainGraphStatus, brainNodePoints, brainPan, endBrainPan, formatBrainDate, inspectBrainNode, moveBrainPan, refreshBrainGraph, selectedAgent, selectedBrainNode, setActiveView, setBrainPan, setQuickAddDrafts, setQuickAddStatus, setSkillBrowserOpen, setSkillBrowserView, setSkillBrowserWrittenContent, setText, sharedVault, splitBrainLabel, startBrainPan, vaultClass }} />
        ) : null}

        {vaultPanelMode === "shared-skills" && brainSkillsLoading ? (
        <section className={vaultClass("brainSkillsLoadingPanel")} aria-label="Loading shared brain skills" aria-busy="true">
          <div className={vaultClass("skillLoadingBeacon")}>
            <BrainGraphLoader
              compact
              inline
              title="Scanning shared skills"
              detail={brainSkillsStatus || "Reading shared brain skills and provider installs"}
            />
          </div>
          <div className={vaultClass("skillLoadingCopy")}>
            <p className="eyebrow">Shared skills</p>
            <h3>Scanning the fleet skill shelf</h3>
            <p>{brainSkillsStatus || "Reading shared brain skills and provider installs across reachable machines."}</p>
          </div>
          <div className={vaultClass("skillLoadingCards")} aria-hidden="true">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className={vaultClass("skillLoadingCard")} style={{ "--card-index": index }}>
                <span />
                <strong />
                <i />
                <i />
                <small />
              </div>
            ))}
          </div>
          <div className={vaultClass("skillLoadingRail")} aria-hidden="true">
            {BRAIN_SKILL_PROVIDER_FALLBACK.map((provider, index) => (
              <span key={provider.id} style={{ "--provider-index": index }}>{provider.label}</span>
            ))}
          </div>
        </section>
        ) : vaultPanelMode === "shared-skills" ? (
        <section className={vaultClass("brainSkillsPanel")} aria-label="Shared brain skills">
          <div className={vaultClass("brainSkillsHeader")}>
            <div>
              <p className="eyebrow">Shared skills</p>
              <h3>Operational recipes in the brain</h3>
              <p>The shared brain is the main skills shelf. Provider installs are scanned below and can be mirrored into Obsidian.</p>
            </div>
            <div className={vaultClass("brainSkillsActions")}>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void syncBrainSkillsToAeon()}
                disabled={brainSkillAeonSyncing || !sharedVault.enabled || !(brainSkills?.shared.length ?? 0)}
              >
                {brainSkillAeonSyncing ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Repeat2 aria-hidden="true" />}
                {brainSkillAeonSyncing ? "Syncing Aeon" : "Sync to Aeon"}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={refreshBrainSkills} disabled={brainSkillsLoading || Boolean(brainSkillImportProvider)}>
                {brainSkillsLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
                {brainSkillsLoading ? "Scanning" : "Refresh skills"}
              </Button>
            </div>
          </div>

          {hermesUpdateRequired ? (
            <p className={vaultClass("hermesUpdateNotice")}>Hermes update available: {hermesUpdateRequiredDetail}. Skills using the newest Hermes features are marked below.</p>
          ) : null}

          <div className={vaultClass("brainSkillsSearch")}>
            <input
              value={skillBrowserSearch}
              onChange={(event) => setSkillBrowserSearch(event.target.value)}
              placeholder="Search skills, tools, runtimes, workflows..."
              aria-label="Search shared skills"
            />
            {skillSearchQuery ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => setSkillBrowserSearch("")}>
                Clear
              </Button>
            ) : null}
          </div>

          {sharedBrainSkills.length ? (
            <div className={vaultClass("sharedSkillGrid")}>
              <button type="button" className={vaultClass("sharedSkillAddCard")} onClick={openSkillBrowser}>
                <Image src="/icons/worker-bee-general-v2.png" alt="" width={34} height={34} unoptimized />
                <strong>Add skill</strong>
                <p>Browse featured and community skills, then mirror the ones you trust into the shared brain.</p>
              </button>
              {filteredSharedBrainSkills.map((skill) => {
                const needsHermesUpdate = skillRequiresHermesUpdate(skill, hermesUpdateRequired);
                return (
                  <article key={skill.id} className={vaultClass("sharedSkillCard")}>
                    <div className={vaultClass("sharedSkillSourceLine")}>
                      <span>Shared brain</span>
                      <div className={vaultClass("sharedSkillBadges")}>
                        {skill.providerLabel !== "Shared brain" ? <small>from {skill.providerLabel}</small> : null}
                        {needsHermesUpdate ? <small className={vaultClass("skillUpdateBadge")}>Needs Hermes update</small> : null}
                      </div>
                    </div>
                    <strong>{skill.name}</strong>
                    <p>{skill.description || "No description in SKILL.md frontmatter yet."}</p>
                    <small className={vaultClass("sharedSkillPath")}>{skill.relativePath}</small>
                  </article>
                );
              })}
              {skillSearchQuery && !filteredSharedBrainSkills.length ? (
                <div className={vaultClass("brainSkillsEmpty", "searchEmpty")}>
                  <Sparkles aria-hidden="true" />
                  <div>
                    <strong>No matching shared skills</strong>
                    <p>Try a different search, or browse skills to add another recipe to the brain.</p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className={vaultClass("brainSkillsEmpty")}>
              <button type="button" className={vaultClass("sharedSkillAddCard", "emptyAddCard")} onClick={openSkillBrowser}>
                <Image src="/icons/queen-bee-v2.png" alt="" width={36} height={36} unoptimized />
                <strong>Browse skills</strong>
                <p>Add the first shared skill to the brain.</p>
              </button>
              <div>
                <strong>No shared skills yet</strong>
                <p>The vault Skills folder is empty. Import every discovered provider skill, or choose one harness at a time.</p>
              </div>
            </div>
          )}

          <div className={vaultClass("providerSkillsToolbar")}>
            <div>
              <strong>Provider installs</strong>
              <span>{providerSkillSummary}</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className={vaultClass("providerImportAllButton")}
              onClick={() => void importBrainSkills("all")}
              disabled={Boolean(brainSkillImportProvider) || !brainSkillImportableCount}
              title={brainSkillImportAllDescription}
              aria-label={brainSkillImportAllDescription}
            >
              {brainSkillImportProvider === "all" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : brainSkillImportSuccess === "all" ? <Check aria-hidden="true" /> : <Download aria-hidden="true" />}
              {brainSkillImportProvider === "all" ? "Importing missing skills" : brainSkillImportSuccess === "all" ? "Missing skills imported" : brainSkillImportAllLabel}
            </Button>
          </div>

          <label className={vaultClass("providerAutoSyncMaster")}>
            <input
              type="checkbox"
              checked={sharedVault.skillAutoSyncAll}
              onChange={(event) => void updateAllSkillAutoSync(event.target.checked)}
            />
            <span>
              <strong>Auto-import all provider skills</strong>
              <small>Keep every provider mirrored across all machines; changed skills are archived before replacement and removals stay safe.</small>
            </span>
          </label>

          <div className={vaultClass("providerSkillStrip")}>
            {providerSkillInventories.map((provider) => {
              const importable = provider.skills.filter((skill) => !skill.imported).length;
              const imported = provider.skills.length - importable;
              const updateRequiredCount = provider.skills.filter((skill) => skillRequiresHermesUpdate({ ...skill, providerId: provider.id, source: provider.label }, hermesUpdateRequired)).length;
              const autoSyncPolicy = sharedVault.skillAutoSyncAll
                ? { autoImport: true, autoUpdate: true, trackRemovals: true, allowDelete: false }
                : sharedVault.skillAutoSync?.[provider.id] ?? { autoImport: false, autoUpdate: false, trackRemovals: false, allowDelete: false };
              const providerStatus = !provider.installed
                ? `No ${provider.home} install found`
                : importable > 0 && imported > 0
                  ? `${importable} ready · ${imported} shared`
                  : importable > 0
                    ? `${importable} ready to import`
                    : imported > 0
                      ? `${imported} in shared brain`
                      : "No skills found";
              const pending = brainSkillImportProvider === provider.id;
              const success = brainSkillImportSuccess === provider.id;
              return (
                <article key={provider.id}>
                  <div>
                    <span>{provider.label}</span>
                    <strong>{provider.skills.length}</strong>
                    <small>{providerStatus}</small>
                    {updateRequiredCount ? <small className={vaultClass("providerUpdateBadge")}>{updateRequiredCount} need Hermes update</small> : null}
                    <div className={vaultClass("providerAutoSyncControls")}>
                      <label>
                        <input
                          type="checkbox"
                          checked={autoSyncPolicy.autoImport}
                          disabled={sharedVault.skillAutoSyncAll}
                          onChange={(event) => void updateSkillAutoSync(provider.id, {
                            autoImport: event.target.checked,
                            autoUpdate: event.target.checked ? autoSyncPolicy.autoUpdate : false,
                            trackRemovals: event.target.checked ? autoSyncPolicy.trackRemovals : false,
                            allowDelete: false,
                          })}
                        />
                        <small>auto import</small>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={autoSyncPolicy.autoUpdate}
                          disabled={sharedVault.skillAutoSyncAll || !autoSyncPolicy.autoImport}
                          onChange={(event) => void updateSkillAutoSync(provider.id, { autoUpdate: event.target.checked })}
                        />
                        <small>updates</small>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={autoSyncPolicy.trackRemovals}
                          disabled={sharedVault.skillAutoSyncAll || !autoSyncPolicy.autoImport}
                          onChange={(event) => void updateSkillAutoSync(provider.id, { trackRemovals: event.target.checked, allowDelete: false })}
                        />
                        <small>safe removals</small>
                      </label>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className={vaultClass("providerSkillButton")}
                    disabled={!importable || Boolean(brainSkillImportProvider)}
                    onClick={() => void importBrainSkills(provider.id)}
                  >
                    {pending ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : success ? <Check aria-hidden="true" /> : <Download aria-hidden="true" />}
                    {pending ? "Importing" : success ? "Synced" : importable ? "Import" : "Current"}
                  </Button>
                </article>
              );
            })}
          </div>
          <p className={vaultClass("brainStatus")}>{brainSkillsStatus || "Skills scan waits for the shared vault."}</p>
        </section>
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
              <Button type="button" size="sm" variant="secondary" onClick={() => { void refreshGbrainStatus(); void refreshSyntoStatus(); void refreshTradingBrainStatus(); }} disabled={Boolean(gbrainBusy) || Boolean(syntoBusy) || Boolean(tradingBrainBusy)}>
                {gbrainBusy === "status" || syntoBusy === "status" || tradingBrainBusy === "status" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
                {gbrainBusy === "status" || syntoBusy === "status" || tradingBrainBusy === "status" ? "Checking" : "Refresh"}
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
              <BrainServiceOverview Button={Button} brainClass={brainClass} cards={brainServiceOverviewCards} setActiveSection={setBrainServiceSection} />
            ) : brainServiceSection === "settings" ? (
              <BrainServiceSettingsDeck brainClass={brainClass} gbrainSettings={brainModuleById.get("gbrain")?.definition.settings} syntoSettings={brainModuleById.get("synto")?.definition.settings} />
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <MemoryCell
            enabled={sharedVault.enabled}
            vaultPath={sharedVault.vaultPath}
            optedInAgentCount={displayAgents.filter((agent) => agent.useSharedVault !== false).length}
            totalAgentCount={displayAgents.length}
            primaryAction={(
              <label className="inline-flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={sharedVault.enabled}
                  onChange={(event) => updateSharedVault({ enabled: event.target.checked })}
                />
                {sharedVault.enabled ? "Shared brain on" : "Turn on shared brain"}
              </label>
            )}
            details={(
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Vault folder
                  <input
                    value={sharedVault.vaultPath}
                    onChange={(event) => updateSharedVault({ vaultPath: event.target.value })}
                    className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
                  />
                  <small>Where shared notes live. Read-only until the vault is reachable.</small>
                </label>
                <div className="rounded-lg border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.45)] p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
		                    <div>
		                      <strong className="block text-xs text-[var(--foreground)]">Vault sync provider</strong>
		                      <small className="text-[var(--muted)]">Choose one owner for realtime vault syncing. Manual repair uses rsync and writes explicit conflict copies.</small>
		                    </div>
		                    <span className="rounded-full border border-[rgba(20,184,166,0.3)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#99f6e4]">
		                      {sharedVault.syncProvider === "syncthing" ? "Syncthing" : sharedVault.syncProvider === "manual" ? "Manual repair" : "External sync"}
		                    </span>
	                  </div>
	                  <label className="mb-3 flex flex-col gap-1 text-xs text-[var(--muted)]">
	                    Sync owner
	                    <select
	                      value={sharedVault.syncProvider}
	                      onChange={(event) => {
	                        const syncProvider = event.target.value as SharedVaultConfig["syncProvider"];
	                        updateSharedVault({
	                          syncProvider,
	                          syncthingAutoPairEnabled: syncProvider === "syncthing"
	                            ? sharedVault.syncthingAutoPairEnabled
	                            : false,
	                        });
	                      }}
	                      className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
	                    >
	                      <option value="external">I already use Obsidian Sync, iCloud, Dropbox, Git, or another provider</option>
	                      <option value="syncthing">Use HivemindOS Syncthing over Tailscale</option>
	                      <option value="manual">Manual Tailscale SSH repair only</option>
	                    </select>
	                    <small>
	                      {sharedVault.syncProvider === "external"
	                        ? "HivemindOS will not auto-pair Syncthing for this vault."
	                        : sharedVault.syncProvider === "syncthing"
	                          ? "Syncthing owns realtime sync. Syncthing conflict files appear in the vault and Syncthing UI."
	                          : "Realtime sync is handled elsewhere or off; rsync repair can create .conflict-host-timestamp copies."}
	                    </small>
	                  </label>
	                  <div className="grid gap-3 sm:grid-cols-2">
	                    <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
	                      Tailscale machine
                      <input
                        value={sharedVault.tailnetSyncHost}
                        onChange={(event) => updateSharedVault({ tailnetSyncHost: event.target.value })}
                        placeholder="user@machine or magicdns-name"
                        className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                      Remote vault folder override
                      <input
                        value={sharedVault.tailnetSyncPath}
                        onChange={(event) => updateSharedVault({ tailnetSyncPath: event.target.value })}
                        placeholder="Leave blank for agent bridge default"
                        className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
                      />
	                    </label>
	                  </div>
	                  <div className="mt-3 flex flex-wrap items-center gap-2">
	                    {sharedVault.syncProvider === "syncthing" ? (
	                      <label className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
	                        <input
	                          type="checkbox"
	                          checked={sharedVault.syncthingAutoPairEnabled}
	                          onChange={(event) => updateSharedVault({ syncthingAutoPairEnabled: event.target.checked })}
	                        />
	                        Auto-pair Syncthing with reachable Tailnet agent bridges
	                      </label>
	                    ) : null}
	                    <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
	                      Repair direction
                      <select
                        value={sharedVault.tailnetSyncDirection}
                        onChange={(event) => updateSharedVault({ tailnetSyncDirection: event.target.value as "bidirectional" | "push" | "pull" })}
                        className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
                      >
                        <option value="bidirectional">Bidirectional with conflict copies</option>
                        <option value="push">This Mac to Tailnet machine</option>
	                        <option value="pull">Tailnet machine to This Mac</option>
	                      </select>
	                    </label>
		                    {sharedVault.syncProvider === "syncthing" ? (
		                      <Button type="button" size="sm" variant="secondary" disabled={Boolean(vaultSyncPending)} onClick={pairSyncthingVaultSync}>
		                        {vaultSyncPending === "syncthing" ? "Pairing..." : "Pair realtime sync"}
		                      </Button>
		                    ) : null}
		                    <Button type="button" size="sm" variant="secondary" disabled={Boolean(vaultSyncPending)} onClick={() => runVaultTailnetSync(true)}>
		                      {vaultSyncPending === "dry-run" ? "Checking..." : "Dry run"}
	                    </Button>
                    <Button type="button" size="sm" variant="secondary" disabled={Boolean(vaultSyncPending)} onClick={() => runVaultTailnetSync(false)}>
                      {vaultSyncPending === "sync" ? "Syncing..." : "Sync now"}
                    </Button>
                  </div>
	                  {vaultSyncStatus ? (
		                    <p className={`mt-3 text-xs ${vaultSyncStatus.ok ? "text-[#86efac]" : "text-[#fecdd3]"}`}>
		                      {vaultSyncStatus.ok
		                        ? vaultSyncStatus.message ?? `${vaultSyncStatus.dryRun ? "Dry run" : "Repair sync"} finished. ${vaultSyncStatus.direction === "bidirectional" ? "Merged with" : vaultSyncStatus.direction === "pull" ? "Pulled from" : "Pushed to"} ${sharedVault.tailnetSyncHost || "Tailnet machine"}.${vaultSyncStatus.conflicts?.length ? ` rsync conflict copies: ${vaultSyncStatus.conflicts.length}. Look for .conflict-host-timestamp files in the vault.` : ""}`
		                        : vaultSyncStatus.error ?? vaultSyncStatus.stderr ?? "Tailnet sync failed."}
	                    </p>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                    Inbox subfolder
                    <input
                      value={sharedVault.inboxFolder}
                      onChange={(event) => updateSharedVault({ inboxFolder: event.target.value })}
                      className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                    Shared note path
                    <input
                      value={sharedVault.sharedNotePath}
                      onChange={(event) => updateSharedVault({ sharedNotePath: event.target.value })}
                      className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Kanban folder
                  <input
                    value={sharedVault.kanbanFolder ?? DEFAULT_SHARED_VAULT.kanbanFolder}
                    onChange={(event) => updateSharedVault({ kanbanFolder: event.target.value })}
                    className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
                  />
                  <small>The Work board stores `kanban.json` files here so synced machines and agents see the same queue.</small>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Notifications folder
                  <input
                    value={sharedVault.notificationsFolder ?? DEFAULT_SHARED_VAULT.notificationsFolder}
                    onChange={(event) => updateSharedVault({ notificationsFolder: event.target.value })}
                    className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
                  />
                  <small>Agents write markdown notifications here. The dashboard keeps read receipts and settings beside them.</small>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                    Synthesis folder
                    <input
                      value={sharedVault.synthesisFolder ?? DEFAULT_SHARED_VAULT.synthesisFolder}
                      onChange={(event) => updateSharedVault({ synthesisFolder: event.target.value })}
                      className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                    Brain services folder
                    <input
                      value={sharedVault.brainServicesFolder ?? DEFAULT_SHARED_VAULT.brainServicesFolder}
                      onChange={(event) => updateSharedVault({ brainServicesFolder: event.target.value })}
                      className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
                    />
                  </label>
                </div>
                <div className="rounded-lg border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.45)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <strong className="block text-xs text-[var(--foreground)]">Brain service controls</strong>
                      <small className="text-[var(--muted)]">GBrain and Syntho runtime settings now live beside their service health and actions.</small>
                    </div>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setVaultPanelMode("brain-services")}>
                      Open Brain Services
                    </Button>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={sharedVault.noteTaskImportEnabled}
                    onChange={(event) => updateSharedVault({ noteTaskImportEnabled: event.target.checked })}
                  />
                  Auto-import markdown note tasks into Work Ideas
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Note task folders
                  <textarea
                    value={sharedVault.noteTaskImportFolders ?? DEFAULT_SHARED_VAULT.noteTaskImportFolders}
                    onChange={(event) => updateSharedVault({ noteTaskImportFolders: event.target.value })}
                    rows={3}
                    className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
                  />
                  <small>Folder-backed notes from Obsidian, Tailnet sync, or another markdown provider can feed unchecked tasks and Next action sections into Ideas.</small>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  HivemindOS folder
                  <input
                    value={sharedVault.controlRoomPath}
                    onChange={(event) => updateSharedVault({ controlRoomPath: event.target.value })}
                    className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Agent instructions
                  <textarea
                    value={sharedVault.instructions}
                    onChange={(event) => updateSharedVault({ instructions: event.target.value })}
                    className="min-h-[80px] rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-1 text-[var(--foreground)]"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={checkVaultStatus}>
                    Check vault path
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={checkControlRoomStatus}>
                    Check HivemindOS
                  </Button>
                </div>
              </div>
            )}
          />

          {/* Vault status surfaces are translated into plain sentences instead of raw JSON. */}
          <Cell
            glyph="OK"
            eyebrow="Vault checks"
            title="Path verification"
            subtitle="The app only validates paths — it never writes to your vault unless an agent explicitly does."
            status={(() => {
              if (!vaultStatus && !controlRoomStatus) return "unknown";
              const vaultOk = Boolean((vaultStatus as { ok?: boolean } | null)?.ok);
              const controlOk = Boolean((controlRoomStatus as { ok?: boolean } | null)?.ok);
              if (vaultStatus && !vaultOk) return "blocked";
              if (controlRoomStatus && !controlOk) return "blocked";
              return "healthy";
            })()}
            tone={(() => {
              if (!vaultStatus && !controlRoomStatus) return "muted";
              const vaultOk = Boolean((vaultStatus as { ok?: boolean } | null)?.ok);
              const controlOk = Boolean((controlRoomStatus as { ok?: boolean } | null)?.ok);
              if ((vaultStatus && !vaultOk) || (controlRoomStatus && !controlOk)) return "danger";
              return "success";
            })()}
          >
            <ul className="m-0 grid gap-2 p-0 [list-style:none] text-xs">
              <li className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] px-3 py-2">
                <strong className="block text-[var(--foreground)]">Vault path</strong>
                <span className="text-[var(--muted)]">
                  {vaultStatus
                    ? (vaultStatus as { ok?: boolean; reason?: string }).ok
                      ? "Reachable. Notes can be read by opted-in agents."
                      : `Cannot read this folder — ${(vaultStatus as { reason?: string }).reason ?? "check that it exists."}`
                    : "Press Check vault path above to verify."}
                </span>
              </li>
              <li className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] px-3 py-2">
                <strong className="block text-[var(--foreground)]">HivemindOS</strong>
                <span className="text-[var(--muted)]">
                  {controlRoomStatus
                    ? (controlRoomStatus as { ok?: boolean; reason?: string }).ok
                      ? "Connected. Agents see the operating manual and registry."
                      : `Not connected — ${(controlRoomStatus as { reason?: string }).reason ?? "verify the folder path."}`
                    : "Press Check HivemindOS to verify."}
                </span>
              </li>
            </ul>
          </Cell>
        </div>
        ) : null}
        </div>
      </section>
      ) : null}

  </>);
}
