"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Check, Copy, KeyRound, LoaderCircle, Plus, PlugZap, RefreshCcw, Search, Wallet, X } from "lucide-react";
import type { AgentProfile, VeniceAgentConfig } from "@/lib/types/agent-runtime";
import styles from "./UsePodSetup.module.css";

type GuidedVeniceSetupProps = {
  agent?: AgentProfile | null;
  busy?: string;
  existingWallets?: AgentProfile[];
  fleetClass?: (...classes: string[]) => string;
  requireCurrentSetup?: boolean;
  onCancel: () => void;
  onComplete: (patch: Partial<AgentProfile>) => void | Promise<void>;
};

type VeniceStatusResponse = {
  ok?: boolean;
  status?: string;
  message?: string;
  authMode?: "x402" | "api-key";
  walletVaultId?: string;
  walletAddress?: string;
  walletNetwork?: string;
  apiKeyEnvName?: string;
  keyPresent?: boolean;
  balanceUsd?: string;
  diemBalanceUsd?: string;
  minimumTopUpUsd?: string;
  suggestedTopUpUsd?: string;
  modelCount?: number;
  models?: Array<{ id: string; name?: string }>;
  checkedAt?: string;
  httpStatus?: number;
};

type BrowseWallet = {
  vaultId: string;
  address: string;
  network: string;
  kind: "venice" | "personal" | "agent";
};

type SetupStep = 1 | 2 | 3;
type SetupView = "wallets" | "browse" | "setup" | "summary";
type AuthChoice = "x402" | "api-key";

const VENICE_GATEWAY_URL = "https://api.venice.ai/api/v1";
const FALLBACK_MODELS: Array<{ id: string; name?: string }> = [
  { id: "llama-3.3-70b" },
  { id: "venice-uncensored" },
  { id: "qwen3-235b" },
  { id: "deepseek-r1-671b" },
];
const MODEL_SKELETON_PILLS = ["44%", "36%", "42%", "48%", "34%"];
const HEX_POINTS = "50,2 92,26 92,74 50,98 8,74 8,26";
let veniceHexId = 0;

function hasVeniceSetup(config?: VeniceAgentConfig) {
  return Boolean(
    config?.walletVaultId
      || config?.walletAddress
      || (config?.authMode === "api-key" && config?.lastKeyPresent)
      || config?.lastTestStatus
      || config?.lastCheckedAt
      || typeof config?.lastModelCount === "number",
  );
}

function isVeniceSetupReady(config?: VeniceAgentConfig) {
  return config?.lastTestStatus === "ready";
}

function initialVeniceSetupStep(config?: VeniceAgentConfig): SetupStep {
  if (isVeniceSetupReady(config)) return 3;
  if (config?.walletVaultId || config?.walletAddress) return 2;
  return 1;
}

function walletKeyForVeniceAgent(agent: AgentProfile) {
  const config = agent.venice ?? {};
  return [config.walletVaultId?.trim(), config.walletAddress?.trim(), config.authMode === "api-key" ? config.apiKeyEnvName?.trim() : ""]
    .filter(Boolean)
    .join("|") || agent.id;
}

function shortValue(value = "") {
  const text = value.trim();
  if (!text) return "";
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

function networkLabel(network = "") {
  if (network.startsWith("eip155:8453")) return "Base";
  if (network.startsWith("eip155:")) return "EVM";
  if (network.startsWith("solana:")) return "Solana";
  return network || "Unknown";
}

function Hex({
  size = 46,
  image,
  fill = "rgba(8, 12, 19, 0.9)",
  stroke = "rgba(94, 234, 212, 0.4)",
  strokeW = 1.3,
  glow = "var(--cyan-glow)",
  style,
  children,
}: {
  size?: number;
  image?: string;
  fill?: string;
  stroke?: string;
  strokeW?: number;
  glow?: string | null;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const id = useMemo(() => `venice-hex-${++veniceHexId}`, []);
  return (
    <span className={styles.hex} style={{ width: size, height: size, ...style }}>
      <svg
        viewBox="0 0 100 100"
        style={{ filter: glow ? `drop-shadow(0 0 9px ${glow})` : undefined }}
        aria-hidden="true"
      >
        {image ? (
          <defs>
            <clipPath id={id}>
              <polygon points={HEX_POINTS} />
            </clipPath>
          </defs>
        ) : null}
        <polygon points={HEX_POINTS} fill={fill} />
        {image ? <image href={image} width="100" height="100" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id})`} /> : null}
        <polygon points={HEX_POINTS} fill="none" stroke={stroke} strokeWidth={strokeW} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {children ? <span className={styles.hexContent}>{children}</span> : null}
    </span>
  );
}

function CodeLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.code}>
        <code title={value}>{value}</code>
        <button
          type="button"
          className={styles.copy}
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

export function GuidedVeniceSetup({
  agent,
  busy,
  existingWallets = [],
  requireCurrentSetup = false,
  onCancel,
  onComplete,
}: GuidedVeniceSetupProps) {
  const initialStep = initialVeniceSetupStep(agent?.venice);
  const walletOptions = useMemo(() => {
    const wallets = new Map<string, AgentProfile>();
    for (const wallet of existingWallets) {
      if (!wallet.venice || !isVeniceSetupReady(wallet.venice)) continue;
      const key = walletKeyForVeniceAgent(wallet);
      if (!wallets.has(key)) wallets.set(key, wallet);
    }
    return [...wallets.values()];
  }, [existingWallets]);
  const shouldOfferWallets = !requireCurrentSetup && !hasVeniceSetup(agent?.venice) && walletOptions.length > 0;
  // A funded x402 wallet collapses to a summary card; API-key setups keep the
  // model picker visible since there's no wallet state worth summarizing.
  const initiallyCollapsed = isVeniceSetupReady(agent?.venice) && agent?.venice?.authMode !== "api-key";

  const [setupView, setSetupView] = useState<SetupView>(shouldOfferWallets ? "wallets" : initiallyCollapsed ? "summary" : "setup");
  const [currentStep, setCurrentStep] = useState<SetupStep>(initialStep);
  const [authChoice, setAuthChoice] = useState<AuthChoice>(agent?.venice?.authMode === "api-key" ? "api-key" : "x402");
  const [recovering, setRecovering] = useState(initialStep === 1 && !hasVeniceSetup(agent?.venice));
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [toppingUp, setToppingUp] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [status, setStatus] = useState<VeniceStatusResponse | null>(null);
  const [walletVaultId, setWalletVaultId] = useState(agent?.venice?.walletVaultId ?? "");
  const [walletAddress, setWalletAddress] = useState(agent?.venice?.walletAddress ?? "");
  const [walletNetwork, setWalletNetwork] = useState(agent?.venice?.walletNetwork ?? "");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [topUpAmount, setTopUpAmount] = useState("10.00");
  const [selectedModel, setSelectedModel] = useState(agent?.model || FALLBACK_MODELS[0].id);
  const [modelSearch, setModelSearch] = useState("");
  const [message, setMessage] = useState("");
  const [browseWallets, setBrowseWallets] = useState<BrowseWallet[] | null>(null);
  const [browseBusyId, setBrowseBusyId] = useState("");
  const [attachingWalletKey, setAttachingWalletKey] = useState("");
  const [showingSuccess, setShowingSuccess] = useState(false);
  const successTimerRef = useRef<number | null>(null);

  const discoveredModels = status?.models?.length ? status.models : [];
  const veniceSetupKnown = Boolean(status || hasVeniceSetup(agent?.venice));
  const loadingModelInventory = checking && currentStep === 3 && !discoveredModels.length;
  const modelListUnavailable = currentStep === 3 && veniceSetupKnown && !checking && !discoveredModels.length;
  const modelOptions = discoveredModels.length ? discoveredModels : loadingModelInventory || modelListUnavailable ? [] : FALLBACK_MODELS;
  const filteredModels = modelOptions.filter((model) => model.id.toLowerCase().includes(modelSearch.toLowerCase()));
  const modelInventoryNotice = modelListUnavailable
    ? status?.message || "Venice did not return a live model list. Refresh models after funding is confirmed."
    : filteredModels.length
      ? ""
      : "No Venice models match this search.";
  const balanceUsd = status?.balanceUsd ?? agent?.venice?.lastBalanceUsd ?? "";
  const diemBalanceUsd = status?.diemBalanceUsd ?? agent?.venice?.lastDiemBalanceUsd ?? "";
  const walletIsBase = walletNetwork.startsWith("eip155:");
  const isBusy = creating || checking || toppingUp || savingKey || recovering || showingSuccess || Boolean(attachingWalletKey) || busy === "venice-setup";

  const headerCopy = useMemo(() => {
    if (setupView === "wallets") return { title: "Venice wallet", body: "Attach an existing wallet or create a new one." };
    if (setupView === "browse") return { title: "Other wallets", body: "Reuse any wallet HivemindOS already holds keys for." };
    if (setupView === "summary") return { title: "Venice wallet", body: "Funded and ready for inference." };
    if (showingSuccess) return { title: "Success", body: "Loading Venice models." };
    if (currentStep === 1) return { title: "Connect Venice", body: "Pick a wallet for x402, or use an API key." };
    if (currentStep === 2) return { title: "Fund Venice", body: "Top up the wallet's Venice balance with Base USDC." };
    return { title: "Choose model", body: "Pick the Venice model for this agent." };
  }, [currentStep, setupView, showingSuccess]);

  useEffect(() => () => {
    if (successTimerRef.current !== null) window.clearTimeout(successTimerRef.current);
  }, []);

  // A VENICE_API_KEY saved in the shared env survives refreshes, but a fresh
  // profile doesn't know about it. Probe once on mount and skip straight to
  // model selection when a saved key already authenticates.
  useEffect(() => {
    let cancelled = false;
    async function recoverSavedSetup() {
      if (initialStep !== 1 || hasVeniceSetup(agent?.venice)) {
        setRecovering(false);
        return;
      }
      try {
        // Fast, local-only check (no Venice round-trip): is a key already
        // saved? This decides the view in milliseconds so the key prompt never
        // lingers while a slow /models call runs.
        const presenceResponse = await fetch("/api/venice/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: { ...(agent ?? {}), provider: "venice" }, action: "key-present" }),
        });
        const presence = await presenceResponse.json().catch(() => null) as { ok?: boolean; keyPresent?: boolean; apiKeyEnvName?: string } | null;
        if (cancelled) return;
        if (!presence?.ok || !presence.keyPresent) return;
        // Key exists: jump straight to model selection and let the full model
        // list resolve in the background via the standard check.
        setAuthChoice("api-key");
        setSetupView("setup");
        setCurrentStep(3);
        setRecovering(false);
        void checkVenice({ authMode: "api-key", apiKeyEnvName: presence.apiKeyEnvName ?? "VENICE_API_KEY", lastKeyPresent: true }, { quiet: true });
      } catch {
        // No saved key (or status unreachable) just leaves the normal setup flow.
      } finally {
        if (!cancelled) setRecovering(false);
      }
    }
    void recoverSavedSetup();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function profilePatchFromState(
    extra?: Partial<VeniceAgentConfig>,
    state?: { model?: string },
  ): Partial<AgentProfile> {
    const nextModel = state?.model ?? selectedModel;
    return {
      provider: "venice",
      model: nextModel,
      gatewayUrl: VENICE_GATEWAY_URL,
      chatPath: "/chat/completions",
      statusPath: "/models",
      venice: {
        authMode: authChoice,
        apiKeyEnvName: status?.apiKeyEnvName ?? agent?.venice?.apiKeyEnvName ?? "VENICE_API_KEY",
        walletVaultId,
        walletAddress,
        walletNetwork,
        lastBalanceUsd: status?.balanceUsd ?? agent?.venice?.lastBalanceUsd ?? "",
        lastDiemBalanceUsd: status?.diemBalanceUsd ?? agent?.venice?.lastDiemBalanceUsd ?? "",
        lastMinimumTopUpUsd: status?.minimumTopUpUsd ?? agent?.venice?.lastMinimumTopUpUsd ?? "",
        lastSuggestedTopUpUsd: status?.suggestedTopUpUsd ?? agent?.venice?.lastSuggestedTopUpUsd ?? "",
        lastCheckedAt: status?.checkedAt ?? agent?.venice?.lastCheckedAt ?? "",
        lastTestStatus: status?.status ?? agent?.venice?.lastTestStatus ?? "",
        lastStatusMessage: status?.message ?? agent?.venice?.lastStatusMessage ?? "",
        lastHttpStatus: status?.httpStatus ?? agent?.venice?.lastHttpStatus,
        lastModelCount: status?.modelCount ?? agent?.venice?.lastModelCount,
        lastKeyPresent: status?.keyPresent ?? agent?.venice?.lastKeyPresent,
        ...extra,
      },
    };
  }

  async function syncProfileChoice(state: { model?: string }) {
    setMessage("");
    try {
      await onComplete(profilePatchFromState(undefined, state));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update Venice settings.");
    }
  }

  function clearSuccessTimer() {
    if (successTimerRef.current === null) return;
    window.clearTimeout(successTimerRef.current);
    successTimerRef.current = null;
  }

  async function checkVenice(extraVenice?: Partial<VeniceAgentConfig>, opts?: { quiet?: boolean }) {
    clearSuccessTimer();
    setShowingSuccess(false);
    setChecking(true);
    setMessage("");
    try {
      const patch = profilePatchFromState(extraVenice);
      const response = await fetch("/api/venice/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: { ...(agent ?? {}), ...patch },
          action: "models",
          model: selectedModel,
        }),
      });
      const data = await response.json().catch(() => null) as VeniceStatusResponse | null;
      if (!data) {
        setMessage("Venice did not return status data.");
        return;
      }
      setStatus(data);
      const nextModel = data.models?.[0]?.id;
      const resolvedModel = data.models?.some((model) => model.id === selectedModel) ? selectedModel : nextModel || selectedModel;
      if (resolvedModel !== selectedModel) setSelectedModel(resolvedModel);
      const completionPatch = {
        ...profilePatchFromState({
          ...extraVenice,
          lastBalanceUsd: data.balanceUsd ?? "",
          lastDiemBalanceUsd: data.diemBalanceUsd ?? "",
          lastMinimumTopUpUsd: data.minimumTopUpUsd ?? "",
          lastSuggestedTopUpUsd: data.suggestedTopUpUsd ?? "",
          lastCheckedAt: data.checkedAt ?? "",
          lastTestStatus: data.status ?? "",
          lastStatusMessage: data.message ?? "",
          lastHttpStatus: data.httpStatus,
          lastModelCount: data.modelCount,
          lastKeyPresent: data.keyPresent,
        }, { model: resolvedModel }),
        model: resolvedModel,
      };
      if (data.status === "ready" && data.models?.length) {
        setMessage("");
        if (!opts?.quiet) {
          setShowingSuccess(true);
          successTimerRef.current = window.setTimeout(() => {
            setCurrentStep(3);
            setShowingSuccess(false);
            successTimerRef.current = null;
          }, 1250);
        }
        setChecking(false);
        await onComplete(completionPatch);
        return;
      }
      // A saved-but-invalid key authenticates nowhere: send the user back to
      // step 1 to re-enter it (recovery may have optimistically shown step 3).
      if (data.status === "missing-key") {
        setCurrentStep(1);
        setMessage(data.message ?? "Venice rejected the saved API key. Enter a valid key or connect a wallet.");
        setChecking(false);
        await onComplete(completionPatch);
        return;
      }
      if (data.status === "needs-funding" && !opts?.quiet) setCurrentStep(2);
      setMessage(data.message ?? "Venice is not ready yet. Top up and check again.");
      setChecking(false);
      await onComplete(completionPatch);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Venice status check failed.");
    } finally {
      setChecking(false);
    }
  }

  async function createWallet() {
    setCreating(true);
    setMessage("");
    try {
      const response = await fetch("/api/venice/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", network: "eip155:8453" }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; wallet?: BrowseWallet } | null;
      if (!response.ok || !data?.ok || !data.wallet) {
        setMessage(data?.error ?? `Venice wallet creation failed with HTTP ${response.status}.`);
        return;
      }
      setAuthChoice("x402");
      setWalletVaultId(data.wallet.vaultId);
      setWalletAddress(data.wallet.address);
      setWalletNetwork(data.wallet.network);
      setCurrentStep(2);
      await onComplete({
        ...profilePatchFromState({
          authMode: "x402",
          walletVaultId: data.wallet.vaultId,
          walletAddress: data.wallet.address,
          walletNetwork: data.wallet.network,
          lastTestStatus: "needs-funding",
        }),
      });
      setMessage("Wallet created. Send Base USDC to it, then top up Venice.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Venice wallet creation failed.");
    } finally {
      setCreating(false);
    }
  }

  async function openWalletBrowser() {
    setMessage("");
    setSetupView("browse");
    if (browseWallets !== null) return;
    try {
      const response = await fetch("/api/wallet/browse");
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; wallets?: BrowseWallet[] } | null;
      if (!data?.ok || !Array.isArray(data.wallets)) {
        setBrowseWallets([]);
        setMessage(data?.error ?? "Could not list local wallets.");
        return;
      }
      setBrowseWallets(data.wallets);
    } catch (error) {
      setBrowseWallets([]);
      setMessage(error instanceof Error ? error.message : "Could not list local wallets.");
    }
  }

  async function connectBrowseWallet(wallet: BrowseWallet) {
    if (browseBusyId) return;
    setBrowseBusyId(wallet.vaultId);
    setMessage("");
    try {
      setAuthChoice("x402");
      setWalletVaultId(wallet.vaultId);
      setWalletAddress(wallet.address);
      setWalletNetwork(wallet.network);
      setSetupView("setup");
      setCurrentStep(2);
      await onComplete({
        ...profilePatchFromState({
          authMode: "x402",
          walletVaultId: wallet.vaultId,
          walletAddress: wallet.address,
          walletNetwork: wallet.network,
        }),
      });
      await checkVenice({
        authMode: "x402",
        walletVaultId: wallet.vaultId,
        walletAddress: wallet.address,
        walletNetwork: wallet.network,
      });
    } finally {
      setBrowseBusyId("");
    }
  }

  async function attachWallet(wallet: AgentProfile) {
    const walletKey = walletKeyForVeniceAgent(wallet);
    if (attachingWalletKey) return;
    const config = wallet.venice ?? {};
    const walletModel = wallet.model || selectedModel || FALLBACK_MODELS[0].id;
    setAttachingWalletKey(walletKey);
    setMessage(`Attaching ${wallet.name}...`);
    setAuthChoice(config.authMode === "api-key" ? "api-key" : "x402");
    setWalletVaultId(config.walletVaultId ?? "");
    setWalletAddress(config.walletAddress ?? "");
    setWalletNetwork(config.walletNetwork ?? "");
    setSelectedModel(walletModel);
    setStatus({
      ok: true,
      status: config.lastTestStatus || "ready",
      message: `Attached ${wallet.name}.`,
      authMode: config.authMode === "api-key" ? "api-key" : "x402",
      walletVaultId: config.walletVaultId ?? "",
      walletAddress: config.walletAddress ?? "",
      walletNetwork: config.walletNetwork ?? "",
      apiKeyEnvName: config.apiKeyEnvName ?? "VENICE_API_KEY",
      balanceUsd: config.lastBalanceUsd ?? "",
      diemBalanceUsd: config.lastDiemBalanceUsd ?? "",
      modelCount: config.lastModelCount ?? 0,
      models: [],
      checkedAt: config.lastCheckedAt || new Date().toISOString(),
    });
    setSetupView("setup");
    setCurrentStep(3);
    try {
      await onComplete({
        provider: "venice",
        model: walletModel,
        gatewayUrl: VENICE_GATEWAY_URL,
        chatPath: "/chat/completions",
        statusPath: "/models",
        venice: { ...config },
      });
      setAttachingWalletKey("");
      await checkVenice({ ...config });
      setMessage(`Attached ${wallet.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not attach ${wallet.name}.`);
    } finally {
      setAttachingWalletKey("");
    }
  }

  async function saveApiKey() {
    const key = apiKeyDraft.trim();
    if (!key) {
      setMessage("Paste a Venice API key first. Buy credits with a card at venice.ai/settings/api.");
      return;
    }
    setSavingKey(true);
    setMessage("");
    try {
      const response = await fetch("/api/venice/save-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; envName?: string } | null;
      if (!response.ok || !data?.ok) {
        setMessage(data?.error ?? `Saving the Venice API key failed with HTTP ${response.status}.`);
        return;
      }
      await onComplete(profilePatchFromState({ authMode: "api-key", apiKeyEnvName: data.envName, lastKeyPresent: true }));
      await checkVenice({ authMode: "api-key", apiKeyEnvName: data.envName, lastKeyPresent: true });
      // Clear only after the save + verification settle, so the field doesn't
      // look like it lost the key while the button is still spinning.
      setApiKeyDraft("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Saving the Venice API key failed.");
    } finally {
      setSavingKey(false);
    }
  }

  async function topUp() {
    if (!walletVaultId) {
      setMessage("Connect a wallet before topping up Venice.");
      return;
    }
    setToppingUp(true);
    setMessage("");
    try {
      const response = await fetch("/api/venice/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "top-up", walletVaultId, amountUsd: topUpAmount }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; message?: string; balanceUsd?: string } | null;
      if (!response.ok || !data?.ok) {
        setMessage(data?.error ?? `Venice top-up failed with HTTP ${response.status}.`);
        return;
      }
      setMessage(data.message ?? "Topped up Venice.");
      await checkVenice();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Venice top-up failed.");
    } finally {
      setToppingUp(false);
    }
  }

  const steps = [
    { n: 1, label: "Wallet", tag: "x402 identity" },
    { n: 2, label: "Fund", tag: "usdc rail" },
    { n: 3, label: "Model", tag: "route" },
  ] as const;

  return (
    <section className={styles.root} aria-label="Venice setup">
      <span className={`${styles.corner} ${styles.tl}`} />
      <span className={`${styles.corner} ${styles.tr}`} />
      <span className={`${styles.corner} ${styles.bl}`} />
      <span className={`${styles.corner} ${styles.br}`} />

      <header className={styles.head}>
        <Hex size={46} image="/icons/runtimes/venice-keys.svg" stroke="rgba(94, 234, 212, 0.5)" />
        <div className={styles.headText}>
          <h2>{headerCopy.title}</h2>
          <p>{headerCopy.body}</p>
        </div>
        <button type="button" className={styles.x} aria-label="Close Venice setup" onClick={onCancel}>
          <X aria-hidden="true" />
        </button>
      </header>

      {setupView === "setup" && !showingSuccess ? (
        <div className={styles.steps} aria-label="Venice setup steps">
          {steps.map((step, index) => (
            <span className={styles.stepSlot} key={step.n}>
              <div className={`${styles.step} ${currentStep > step.n ? styles.done : currentStep === step.n ? styles.active : ""}`}>
                <Hex
                  size={30}
                  strokeW={1.2}
                  fill={currentStep === step.n ? "var(--cyan)" : currentStep > step.n ? "rgba(45, 212, 191, 0.12)" : "var(--bg3)"}
                  stroke={currentStep === step.n ? "var(--cyan)" : currentStep > step.n ? "rgba(94, 234, 212, 0.6)" : "var(--line2)"}
                  glow={currentStep === step.n ? "var(--cyan-glow)" : null}
                >
                  <span className={styles.stepNumber}>
                    {currentStep > step.n ? <Check aria-hidden="true" /> : step.n}
                  </span>
                </Hex>
                <div className={styles.stepLabel}>
                  <b>{step.label}</b>
                  <small>{step.tag}</small>
                </div>
              </div>
              {index < steps.length - 1 ? <div className={`${styles.stepLine} ${currentStep > step.n ? styles.filled : ""}`} /> : null}
            </span>
          ))}
        </div>
      ) : null}

      <div className={styles.body}>
        {setupView === "wallets" ? (
          <div className={styles.wallets} role="list" aria-label="Existing Venice wallets">
            {walletOptions.map((wallet) => {
              const config = wallet.venice ?? {};
              const walletKey = walletKeyForVeniceAgent(wallet);
              const attaching = attachingWalletKey === walletKey;
              const detail = config.authMode === "api-key" ? config.apiKeyEnvName || "VENICE_API_KEY" : shortValue(config.walletAddress);
              return (
                <button type="button" className={styles.wallet} key={walletKey} disabled={Boolean(attachingWalletKey)} onClick={() => void attachWallet(wallet)}>
                  <span className={styles.wname}>
                    <b>{wallet.name}</b>
                    <small>{attaching ? "Attaching wallet..." : wallet.machineName || detail || "Venice"}</small>
                  </span>
                  <span className={styles.wbal}>
                    <b>{attaching ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : config.lastBalanceUsd ? `$${config.lastBalanceUsd}` : "Funded"}</b>
                    <small>{config.authMode === "api-key" ? "API key" : networkLabel(config.walletNetwork)}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {setupView === "browse" ? (
          <div className={styles.wallets} role="list" aria-label="Other local wallets">
            {browseWallets === null ? (
              <div className={styles.modelNotice}>
                <span><LoaderCircle className={styles.spin} aria-hidden="true" /> Loading local wallets...</span>
              </div>
            ) : browseWallets.length ? browseWallets.map((wallet) => (
              <button type="button" className={styles.wallet} key={wallet.vaultId} disabled={Boolean(browseBusyId)} onClick={() => void connectBrowseWallet(wallet)}>
                <span className={styles.wname}>
                  <b>{wallet.kind === "venice" ? "Venice wallet" : wallet.kind === "personal" ? "Personal wallet" : `Agent ${shortValue(wallet.vaultId)}`}</b>
                  <small>{browseBusyId === wallet.vaultId ? "Connecting wallet..." : shortValue(wallet.address)}</small>
                </span>
                <span className={styles.wbal}>
                  <b>{browseBusyId === wallet.vaultId ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : networkLabel(wallet.network)}</b>
                  <small>{wallet.network.startsWith("eip155:") ? "top-up ready" : "auth only"}</small>
                </span>
              </button>
            )) : (
              <div className={styles.modelNotice}>
                <span>No local wallets yet. Create a new wallet instead.</span>
              </div>
            )}
          </div>
        ) : null}

        {setupView === "summary" ? (
          <div className={`${styles.panel} ${styles.accentCyan}`}>
            <span className={styles.eyebrow}>Wallet funded</span>
            <h3>Venice is ready</h3>
            <p>Inference is paid from this wallet&apos;s prepaid Venice balance over x402.</p>
            {walletAddress ? <CodeLine label={`Wallet · ${networkLabel(walletNetwork)}`} value={walletAddress} /> : null}
            <div className={styles.status}>
              {balanceUsd ? <span className={styles.stat}><span className={styles.dot} />Venice balance <b>${balanceUsd}</b></span> : null}
              {diemBalanceUsd && Number(diemBalanceUsd) > 0 ? <span className={styles.stat}>DIEM <b>${diemBalanceUsd}</b></span> : null}
              <span className={styles.stat}>Model <b>{selectedModel}</b></span>
            </div>
            <div className={styles.actionRow}>
              <button
                type="button"
                className={`${styles.btn} ${styles.ghost}`}
                disabled={isBusy}
                onClick={() => {
                  setMessage("");
                  setSetupView("setup");
                  setCurrentStep(3);
                  void checkVenice(undefined, { quiet: true });
                }}
              >
                <Search aria-hidden="true" /> Change model
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.ghost}`}
                disabled={isBusy}
                onClick={() => {
                  setMessage("");
                  setSetupView("setup");
                  setCurrentStep(2);
                }}
              >
                <ArrowUpRight aria-hidden="true" /> Top up
              </button>
            </div>
          </div>
        ) : null}

        {setupView === "setup" && currentStep === 1 ? (
          recovering ? (
            <div className={`${styles.panel} ${styles.accentCyan} ${styles.create}`}>
              <div>
                <span className={styles.eyebrow}>Wallet-authenticated inference</span>
                <h3>Checking saved setup</h3>
                <p>Looking for a saved Venice key or wallet before asking you to set one up.</p>
              </div>
              <div className={styles.core} aria-hidden="true">
                <span className={`${styles.ring} ${styles.r1}`} />
                <span className={`${styles.ring} ${styles.r2}`} />
                <Hex size={70} style={{ zIndex: 1 }}>
                  <LoaderCircle className={`${styles.coreIcon} ${styles.spin}`} />
                </Hex>
              </div>
            </div>
          ) : (
          <>
            <div className={`${styles.panel} ${styles.accentCyan} ${styles.create}`}>
              <div>
                <span className={styles.eyebrow}>Wallet-authenticated inference</span>
                <h3>Create Base wallet</h3>
                <p>HivemindOS creates an encrypted local wallet that signs Venice requests over x402. Fund it with Base USDC, then top up a prepaid Venice balance. No Venice account needed.</p>
                <div className={styles.actionRow}>
                  <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => void createWallet()} disabled={isBusy}>
                    {creating ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <PlugZap aria-hidden="true" />}
                    {creating ? "Creating wallet" : "New wallet"}
                  </button>
                  <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => void openWalletBrowser()} disabled={isBusy}>
                    <Wallet aria-hidden="true" />
                    Other wallets
                  </button>
                </div>
              </div>
              <div className={styles.core} aria-hidden="true">
                <span className={`${styles.ring} ${styles.r2}`} />
                <Hex size={70} style={{ zIndex: 1 }}>
                  <Wallet className={styles.coreIcon} />
                </Hex>
              </div>
            </div>

            <div className={styles.or} aria-hidden="true">
              <span />
              <b>OR</b>
              <span />
            </div>

            <div className={`${styles.panel} ${styles.accentHoney}`}>
              <span className={`${styles.eyebrow} ${styles.eyebrowHoney}`}>API key</span>
              <p>Already have a Venice account? Buy credits with a card at venice.ai/settings/api and paste the key. Venice handles fiat billing directly.</p>
              <div className={styles.transferComposer}>
                <label className={styles.amountField}>
                  <span>Venice API key</span>
                  <div className={`${styles.amountInputWrap} ${styles.keyInputWrap}`}>
                    <input
                      type="password"
                      autoComplete="off"
                      value={apiKeyDraft}
                      // Strip whitespace/newlines a paste may carry; an embedded
                      // newline otherwise truncates the key when stored.
                      onChange={(event) => setApiKeyDraft(event.target.value.replace(/\s+/g, ""))}
                      aria-label="Venice API key"
                      placeholder="sk-..."
                    />
                  </div>
                </label>
                <button type="button" className={`${styles.btn} ${styles.honey}`} disabled={isBusy || !apiKeyDraft.trim()} onClick={() => { setAuthChoice("api-key"); void saveApiKey(); }}>
                  {savingKey ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
                  Save key
                </button>
              </div>
            </div>
          </>
          )
        ) : null}

        {setupView === "setup" && currentStep === 2 ? (
          showingSuccess ? (
            <div className={`${styles.panel} ${styles.success}`} aria-live="polite">
              <div className={styles.successMark} aria-hidden="true">
                <Check />
              </div>
              <h3>Funded</h3>
              <p>Venice is topped up. Loading models.</p>
            </div>
          ) : (
            <>
              <div className={`${styles.panel} ${styles.accentCyan}`}>
                <span className={styles.eyebrow}>Wallet</span>
                <h3>Fund the wallet, then top up Venice</h3>
                <p>
                  Send USDC on {networkLabel(walletNetwork)} to the wallet address, then move part of it into the
                  prepaid Venice balance below. {balanceUsd ? `Current Venice balance: $${balanceUsd}.` : ""}
                  {diemBalanceUsd && Number(diemBalanceUsd) > 0 ? ` DIEM-backed: $${diemBalanceUsd}.` : ""}
                </p>
                {walletAddress ? <CodeLine label={`Wallet address · ${networkLabel(walletNetwork)}`} value={walletAddress} /> : (
                  <p className={styles.mutedMono}>Connect or create a wallet to reveal its address.</p>
                )}
                <div className={styles.fundingActions}>
                  <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => void checkVenice()} disabled={isBusy}>
                    {checking ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <RefreshCcw aria-hidden="true" />}
                    Check funding
                  </button>
                </div>
                {message ? (
                  <p className={styles.fundingStatus} data-tone={status?.status === "needs-funding" ? "warn" : status?.status === "ready" ? "ok" : "info"}>
                    {message}
                  </p>
                ) : null}
              </div>

              <div className={`${styles.panel} ${styles.accentHoney} ${styles.deposit}`}>
                <div className={styles.depositHead}>
                  <div>
                    <span className={`${styles.eyebrow} ${styles.eyebrowHoney}`}>Venice top-up</span>
                    <p>{walletIsBase
                      ? "Signs a gasless Base USDC payment (x402) into the wallet's Venice balance."
                      : "Top-ups from HivemindOS use a Base wallet. This wallet can authenticate, but top it up at venice.ai or pick a Base wallet."}</p>
                  </div>
                  <span className={styles.badge}>USDC · BASE</span>
                </div>
                <div className={styles.transferComposer}>
                  <label className={styles.amountField}>
                    <span>You will top up</span>
                    <div className={styles.amountInputWrap}>
                      <input
                        inputMode="decimal"
                        min="0"
                        pattern="^[0-9]+(\\.[0-9]{1,2})?$"
                        value={topUpAmount}
                        onChange={(event) => setTopUpAmount(event.target.value)}
                        aria-label="USD amount"
                      />
                      <strong>USDC</strong>
                    </div>
                  </label>
                  <button type="button" className={`${styles.btn} ${styles.honey} ${styles.transferPrimary}`} disabled={isBusy || !walletVaultId || !walletIsBase} onClick={() => void topUp()}>
                    {toppingUp ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}
                    Top up Venice
                  </button>
                </div>
                {status?.minimumTopUpUsd ? (
                  <p className={styles.walletUnavailableNote}>Minimum top-up ${status.minimumTopUpUsd}{status.suggestedTopUpUsd ? ` · suggested $${status.suggestedTopUpUsd}` : ""}.</p>
                ) : null}
              </div>
            </>
          )
        ) : null}

        {setupView === "setup" && currentStep === 3 ? (
          <>
            <div className={`${styles.panel} ${styles.accentCyan}`}>
              <span className={styles.eyebrow}>Inference model</span>
              <h3>Choose model</h3>
              <label className={styles.search}>
                <Search aria-hidden="true" />
                <input placeholder="Search Venice models" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} />
              </label>
              <div className={styles.models}>
                {loadingModelInventory ? MODEL_SKELETON_PILLS.map((width, index) => (
                  <div
                    aria-hidden="true"
                    className={styles.modelSkeleton}
                    key={width}
                    style={{ "--skeleton-width": width, "--skeleton-delay": `${index * 90}ms` } as CSSProperties}
                  >
                    <span className={styles.modelSkeletonDot} />
                    <span className={styles.modelSkeletonText} />
                  </div>
                )) : modelInventoryNotice ? (
                  <div className={styles.modelNotice}>
                    <span>{modelInventoryNotice}</span>
                    {modelListUnavailable ? (
                      <button type="button" disabled={isBusy} onClick={() => void checkVenice()}>
                        <RefreshCcw aria-hidden="true" />
                        Refresh
                      </button>
                    ) : null}
                  </div>
                ) : filteredModels.map((model) => (
                  <button
                    type="button"
                    key={model.id}
                    className={`${styles.model} ${selectedModel === model.id ? styles.sel : ""}`}
                    disabled={isBusy}
                    onClick={() => {
                      setSelectedModel(model.id);
                      void syncProfileChoice({ model: model.id });
                    }}
                  >
                    <span className={styles.mdot} />
                    {model.name || model.id}
                    {selectedModel === model.id ? <Check aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.status}>
              {balanceUsd ? <span className={styles.stat}><span className={styles.dot} />Venice balance <b>${balanceUsd}</b></span> : null}
              {authChoice === "api-key" ? <span className={styles.stat}>Auth <b>API key</b></span> : walletAddress ? <span className={styles.stat}>Wallet <b>{shortValue(walletAddress)}</b></span> : null}
              <span className={styles.stat}>Models <b>{status?.modelCount ?? (discoveredModels.length || modelOptions.length)}</b></span>
            </div>
          </>
        ) : null}
      </div>

      <footer className={styles.foot}>
        <span className={`${styles.msg} ${message.includes("needs") ? styles.warn : ""}`}>
          {(setupView === "setup" && currentStep === 2) ? `api.venice.ai · ${authChoice === "api-key" ? "API key" : "x402 wallet"}`
            : message || (setupView === "wallets" ? "Reusing a wallet shares its Venice balance between agents."
              : setupView === "browse" ? "Any wallet here can sign Venice requests; Base wallets can also top up."
                : `api.venice.ai · ${authChoice === "api-key" ? "API key" : "x402 wallet"}`)}
        </span>
        <div className={styles.footActions}>
          {setupView === "setup" && currentStep === 1 && walletOptions.length ? <button type="button" className={styles.link} onClick={() => setSetupView("wallets")}>Attach existing wallet</button> : null}
          {setupView === "wallets" ? (
            <>
              <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => void openWalletBrowser()}>
                <Wallet aria-hidden="true" /> Other wallets
              </button>
              <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => { setMessage(""); setSetupView("setup"); setCurrentStep(1); }}>
                <Plus aria-hidden="true" /> New wallet
              </button>
            </>
          ) : null}
          {setupView === "browse" ? (
            <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => { setMessage(""); setSetupView(shouldOfferWallets ? "wallets" : "setup"); }}>
              Back
            </button>
          ) : null}
          {setupView === "setup" && currentStep > 1 && !showingSuccess ? <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setCurrentStep((currentStep - 1) as SetupStep)}>Back</button> : null}
          {setupView === "setup" && currentStep === 3 && authChoice === "x402" ? (
            <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={isBusy || modelListUnavailable} onClick={() => { setMessage(""); setSetupView("summary"); }}>
              <Check aria-hidden="true" /> Done
            </button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}
