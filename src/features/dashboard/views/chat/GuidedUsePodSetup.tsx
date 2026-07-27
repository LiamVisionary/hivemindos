"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Check, ChevronDown, Copy, Cpu, LoaderCircle, Plus, PlugZap, RefreshCcw, Search, ShieldCheck } from "lucide-react";
import { Transaction } from "@solana/web3.js";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import styles from "./UsePodSetup.module.css";

type GuidedUsePodSetupProps = {
  agent?: AgentProfile | null;
  busy?: string;
  existingWallets?: AgentProfile[];
  fleetClass?: (...classes: string[]) => string;
  requireCurrentSetup?: boolean;
  recoverSavedSetup?: boolean;
  onComplete: (patch: Partial<AgentProfile>) => void | Promise<void>;
};

type RegisterResponse = {
  ok?: boolean;
  error?: string;
  tokenEnvName?: string;
  depositEnvName?: string;
  depositAddress?: string;
  depositCode?: string;
  dashboardUrl?: string;
  fundingUrl?: string;
  savedToEnv?: boolean;
};

type UsePodStatusResponse = {
  ok?: boolean;
  status?: string;
  message?: string;
  tokenEnvName?: string;
  tokenPresent?: boolean;
  tokenSource?: string;
  depositAddress?: string;
  depositCode?: string;
  dashboardUrl?: string;
  modelCount?: number;
  models?: Array<{ id: string; name?: string }>;
  balanceRemaining?: string;
  route?: string;
  checkedAt?: string;
  httpStatus?: number;
};

type SystemBrowser = {
  id: string;
  label: string;
};

type SolanaWalletProvider = {
  id: string;
  label: string;
  provider: {
    connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toString: () => string; toBase58?: () => string } } | void>;
    publicKey?: { toString: () => string; toBase58?: () => string };
    signAndSendTransaction?: (transaction: Transaction) => Promise<{ signature?: string } | string>;
    signTransaction?: (transaction: Transaction) => Promise<Transaction>;
  };
};

type SpendPreset = "cheapest" | "balanced" | "fast" | "none" | "custom";
type SetupStep = 1 | 2 | 3;
type SetupView = "wallets" | "browse" | "setup" | "summary";

type BrowseWallet = {
  vaultId: string;
  address: string;
  network: string;
  kind: "venice" | "personal" | "agent";
};

const SPEND_PRESETS: Array<{ id: SpendPreset; label: string; sub: string; input: string; output: string }> = [
  { id: "cheapest", label: "Cheapest", sub: "250 / 1k", input: "250", output: "1000" },
  { id: "balanced", label: "Balanced", sub: "2k / 8k", input: "2000", output: "8000" },
  { id: "fast", label: "Fast", sub: "10k / 30k", input: "10000", output: "30000" },
  { id: "none", label: "No cap", sub: "off", input: "", output: "" },
];

const FALLBACK_MODELS = [
  { id: "gpt-5.5", name: "gpt-5.5" },
  { id: "llama-4", name: "llama-4" },
  { id: "qwen-3.5", name: "qwen-3.5" },
  { id: "deepseek-v3.2", name: "deepseek-v3.2" },
  { id: "glm-5.1", name: "glm-5.1" },
];

const MODEL_SKELETON_PILLS = ["44%", "36%", "42%", "48%", "34%"];

const TOKEN_CREATION_STEPS = [
  "Requesting UsePod token",
  "Saving local credentials",
  "Preparing funding link",
];

const HEX_POINTS = "50,2 92,26 92,74 50,98 8,74 8,26";
let hexId = 0;

function presetForCaps(input = "", output = ""): SpendPreset {
  return SPEND_PRESETS.find((preset) => preset.input === input && preset.output === output)?.id ?? "custom";
}

function fundingUrlForUsePod(registration: RegisterResponse | null, agent?: AgentProfile | null) {
  return registration?.fundingUrl
    || registration?.dashboardUrl
    || agent?.usePod?.dashboardUrl
    || "";
}

function hasUsePodSetup(config?: AgentProfile["usePod"]) {
  return Boolean(
    config?.depositAddress
      || config?.depositCode
      || config?.dashboardUrl
      || config?.lastBalanceRemaining
      || config?.lastRoute
      || config?.lastCheckedAt
      || typeof config?.lastModelCount === "number",
  );
}

function isUsePodSetupReady(config?: AgentProfile["usePod"]) {
  return config?.lastTestStatus === "ready";
}

function initialUsePodSetupStep(config?: AgentProfile["usePod"]): SetupStep {
  if (isUsePodSetupReady(config)) return 3;
  if (config?.dashboardUrl || config?.depositCode || config?.depositAddress || config?.lastTestStatus === "needs-funding") return 2;
  return 1;
}

function walletKeyForUsePodAgent(agent: AgentProfile) {
  const config = agent.usePod ?? {};
  return [
    config.depositAddress?.trim(),
    config.depositCode?.trim(),
    config.dashboardUrl?.trim(),
    config.tokenEnvName?.trim() || "USEPOD_TOKEN",
  ].filter(Boolean).join("|") || agent.id;
}

function shortUsePodValue(value = "") {
  const text = value.trim();
  if (!text) return "";
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

function base64ToBytes(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function walletPublicKey(provider: SolanaWalletProvider["provider"], connected?: { publicKey?: { toString: () => string; toBase58?: () => string } } | void) {
  const publicKey = connected?.publicKey ?? provider.publicKey;
  return publicKey?.toBase58?.() ?? publicKey?.toString?.() ?? "";
}

function detectSolanaWallets(): SolanaWalletProvider[] {
  if (typeof window === "undefined") return [];
  const source = window as typeof window & {
    solana?: SolanaWalletProvider["provider"] & { isPhantom?: boolean; isSolflare?: boolean; isBackpack?: boolean };
    phantom?: { solana?: SolanaWalletProvider["provider"] };
    solflare?: SolanaWalletProvider["provider"];
    backpack?: { solana?: SolanaWalletProvider["provider"] };
  };
  const candidates: Array<[string, string, SolanaWalletProvider["provider"] | undefined]> = [
    ["phantom", "Phantom", source.phantom?.solana ?? (source.solana?.isPhantom ? source.solana : undefined)],
    ["solflare", "Solflare", source.solflare ?? (source.solana?.isSolflare ? source.solana : undefined)],
    ["backpack", "Backpack", source.backpack?.solana ?? (source.solana?.isBackpack ? source.solana : undefined)],
  ];
  const seen = new Set<SolanaWalletProvider["provider"]>();
  return candidates.reduce<SolanaWalletProvider[]>((wallets, [id, label, provider]) => {
    if (!provider || seen.has(provider)) return wallets;
    seen.add(provider);
    wallets.push({ id, label, provider });
    return wallets;
  }, []);
}

function friendlyUsePodCheckError(error: unknown) {
  if (!(error instanceof Error)) return "UsePod model discovery failed.";
  const rawMessage = error.message.trim();
  const message = rawMessage.toLowerCase();
  if (message === "fetch failed" || message === "failed to fetch" || message.includes("load failed")) {
    return "HivemindOS could not reach the local UsePod checker. Make sure the app server is running, then try Check funding again.";
  }
  return rawMessage || "UsePod model discovery failed.";
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
  const id = useMemo(() => `usepod-hex-${++hexId}`, []);
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

export function GuidedUsePodSetup({
  agent,
  busy,
  existingWallets = [],
  requireCurrentSetup = false,
  recoverSavedSetup = true,
  onComplete,
}: GuidedUsePodSetupProps) {
  const initialStep = initialUsePodSetupStep(agent?.usePod);
  const walletOptions = useMemo(() => {
    const wallets = new Map<string, AgentProfile>();
    for (const wallet of existingWallets) {
      if (!wallet.usePod || !isUsePodSetupReady(wallet.usePod)) continue;
      const key = walletKeyForUsePodAgent(wallet);
      if (!wallets.has(key)) wallets.set(key, wallet);
    }
    return [...wallets.values()];
  }, [existingWallets]);
  const shouldOfferWallets = !requireCurrentSetup && !hasUsePodSetup(agent?.usePod) && walletOptions.length > 0;
  // A ready prepaid wallet collapses to a summary card; the full wizard stays
  // one "Change model" / "Fund" click away.
  const initiallyCollapsed = isUsePodSetupReady(agent?.usePod);

  const [setupView, setSetupView] = useState<SetupView>(shouldOfferWallets ? "wallets" : initiallyCollapsed ? "summary" : "setup");
  const [currentStep, setCurrentStep] = useState<SetupStep>(initialStep);
  const [registering, setRegistering] = useState(false);
  const [checking, setChecking] = useState(false);
  const [recovering, setRecovering] = useState(initialStep === 1 && recoverSavedSetup);
  const [creationStage, setCreationStage] = useState(0);
  const [registered, setRegistered] = useState<RegisterResponse | null>(null);
  const [status, setStatus] = useState<UsePodStatusResponse | null>(null);
  const [selectedModel, setSelectedModel] = useState(agent?.model || FALLBACK_MODELS[0].id);
  const [spendPreset, setSpendPreset] = useState<SpendPreset>(
    agent?.usePod?.spendPreset ?? presetForCaps(agent?.usePod?.maxPriceInputMicrounits, agent?.usePod?.maxPriceOutputMicrounits),
  );
  const [customCaps, setCustomCaps] = useState({
    input: agent?.usePod?.maxPriceInputMicrounits ?? "",
    output: agent?.usePod?.maxPriceOutputMicrounits ?? "",
  });
  const [message, setMessage] = useState("");
  const [fundingOpened, setFundingOpened] = useState(Boolean(agent?.usePod?.dashboardUrl));
  const [browserOptions, setBrowserOptions] = useState<SystemBrowser[]>([]);
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false);
  const [openingBrowser, setOpeningBrowser] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [depositAmount, setDepositAmount] = useState("5.00");
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [walletProviders, setWalletProviders] = useState<SolanaWalletProvider[]>([]);
  const [browseWallets, setBrowseWallets] = useState<BrowseWallet[] | null>(null);
  const [vaultWallet, setVaultWallet] = useState<BrowseWallet | null>(null);
  const [transferBusy, setTransferBusy] = useState("");
  const [attachingWalletKey, setAttachingWalletKey] = useState("");
  const [showingSuccess, setShowingSuccess] = useState(false);
  const successTimerRef = useRef<number | null>(null);
  const attachedWalletRef = useRef(false);

  const discoveredModels = status?.models?.length ? status.models : [];
  const usePodSetupKnown = Boolean(
    status
      || hasUsePodSetup(agent?.usePod)
      || agent?.usePod?.lastTokenPresent
      || agent?.usePod?.lastTestStatus,
  );
  const loadingModelInventory = checking && currentStep === 3 && !discoveredModels.length;
  const modelListUnavailable = currentStep === 3 && usePodSetupKnown && !checking && !discoveredModels.length;
  const modelOptions = discoveredModels.length ? discoveredModels : loadingModelInventory || modelListUnavailable ? [] : FALLBACK_MODELS;
  const activePreset = SPEND_PRESETS.find((preset) => preset.id === spendPreset);
  const inputCap = spendPreset === "custom" ? customCaps.input : activePreset?.input ?? "";
  const outputCap = spendPreset === "custom" ? customCaps.output : activePreset?.output ?? "";
  const tokenEnvName = status?.tokenEnvName || registered?.tokenEnvName || agent?.usePod?.tokenEnvName || "USEPOD_TOKEN";
  const depositAddress = registered?.depositAddress || status?.depositAddress || agent?.usePod?.depositAddress || "";
  const depositCode = registered?.depositCode || status?.depositCode || agent?.usePod?.depositCode || "";
  const dashboardUrl = fundingUrlForUsePod(registered, agent) || status?.dashboardUrl || (depositCode ? "https://usepod.ai/fund" : "");
  const nativeRuntime = useMemo(() => isTauriDesktopRuntime(), []);
  const selectedWalletProvider = walletProviders[0] ?? null;
  const walletSelectorLabel = selectedWalletProvider?.label ?? "No wallet";
  const isBusy = registering || checking || recovering || showingSuccess || Boolean(transferBusy) || Boolean(attachingWalletKey) || busy === "usepod-register";
  const showInlineFundingMessage = setupView === "setup" && currentStep === 2 && !showingSuccess && Boolean(message);
  const filteredModels = modelOptions.filter((model) => model.id.toLowerCase().includes(modelSearch.toLowerCase()));
  const modelInventoryNotice = modelListUnavailable
      ? status?.message || "UsePod did not return a live model list. Refresh models after funding is confirmed."
      : filteredModels.length
        ? ""
        : "No UsePod models match this search.";
  const modelCountLabel = status?.modelCount ?? (discoveredModels.length || modelOptions.length);

  const headerCopy = useMemo(() => {
    if (setupView === "wallets") return { title: "UsePod wallet", body: "Attach an existing wallet or create a new one." };
    if (setupView === "browse") return { title: "Other wallets", body: "Fund UsePod from a Solana wallet HivemindOS already holds keys for." };
    if (setupView === "summary") return { title: "UsePod wallet", body: "Funded and ready for inference." };
    if (registering) return { title: "Creating token", body: "Setting up UsePod for this agent." };
    if (showingSuccess) return { title: "Success", body: "Loading UsePod models." };
    if (currentStep === 1) return { title: "Create UsePod token", body: "HivemindOS will create and save it automatically." };
    if (currentStep === 2) return { title: "Fund UsePod", body: "Open the prefilled funding page, then check funding." };
    return { title: "Choose model", body: "Pick the model and spend guardrails for this agent." };
  }, [currentStep, registering, setupView, showingSuccess]);

  useEffect(() => {
    if (!registering) return undefined;
    const interval = window.setInterval(() => {
      setCreationStage((current) => Math.min(current + 1, TOKEN_CREATION_STEPS.length - 1));
    }, 1300);
    return () => window.clearInterval(interval);
  }, [registering]);

  useEffect(() => () => {
    if (successTimerRef.current !== null) window.clearTimeout(successTimerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function recoverSavedToken() {
      if (!recoverSavedSetup || initialStep !== 1) {
        setRecovering(false);
        return;
      }
      try {
        const response = await fetch("/api/usepod/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent: { ...(agent ?? {}), ...profilePatchFromState() },
            action: "models",
            model: selectedModel,
          }),
        });
        const data = await response.json().catch(() => null) as UsePodStatusResponse | null;
        if (cancelled || !data || (!data.ok && !data.tokenPresent)) return;
        setStatus(data);
        await onComplete(profilePatchFromState({
          tokenEnvName: data.tokenEnvName ?? tokenEnvName,
          depositAddress: data.depositAddress ?? "",
          depositCode: data.depositCode ?? "",
          dashboardUrl: data.dashboardUrl ?? "",
          lastCheckedAt: data.checkedAt ?? "",
          lastTestStatus: data.status ?? "",
          lastModelCount: data.modelCount,
          lastTokenPresent: data.tokenPresent,
          lastTokenSource: data.tokenSource ?? "",
        }));
        if (attachedWalletRef.current) return;
        if (data.status === "ready" && data.models?.length) setCurrentStep(3);
        else if (data.tokenPresent || data.dashboardUrl || data.depositCode || data.depositAddress) setCurrentStep(2);
      } catch {
        // Missing saved metadata is fine; the primary create action remains available.
      } finally {
        if (!cancelled) setRecovering(false);
      }
    }
    void recoverSavedToken();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentStep !== 2) return undefined;
    let cancelled = false;
    async function loadBrowsers() {
      try {
        const response = await fetch("/api/system/browsers");
        const data = await response.json().catch(() => null) as { ok?: boolean; browsers?: SystemBrowser[] } | null;
        if (!cancelled && data?.ok && Array.isArray(data.browsers)) setBrowserOptions(data.browsers);
      } catch {
        if (!cancelled) setBrowserOptions([]);
      }
    }
    void loadBrowsers();
    return () => {
      cancelled = true;
    };
  }, [currentStep]);

  useEffect(() => {
    if (currentStep !== 2) return undefined;
    if (nativeRuntime) return undefined;
    const timer = window.setTimeout(() => setWalletProviders(detectSolanaWallets()), 0);
    return () => window.clearTimeout(timer);
  }, [currentStep, nativeRuntime]);

  function profilePatchFromState(
    extra?: Partial<AgentProfile["usePod"]>,
    state?: { model?: string; spendPreset?: SpendPreset; customCaps?: typeof customCaps },
  ): Partial<AgentProfile> {
    const nextModel = state?.model ?? selectedModel;
    const nextSpendPreset = state?.spendPreset ?? spendPreset;
    const nextActivePreset = SPEND_PRESETS.find((preset) => preset.id === nextSpendPreset);
    const nextCustomCaps = state?.customCaps ?? customCaps;
    const nextInputCap = nextSpendPreset === "custom" ? nextCustomCaps.input : nextActivePreset?.input ?? "";
    const nextOutputCap = nextSpendPreset === "custom" ? nextCustomCaps.output : nextActivePreset?.output ?? "";
    return {
      provider: "usepod",
      model: nextModel,
      gatewayUrl: "https://api.usepod.ai",
      chatPath: "/v1/chat/completions",
      statusPath: "/v1/models",
      usePod: {
        tokenEnvName,
        depositAddress,
        depositCode,
        dashboardUrl,
        maxPriceInputMicrounits: nextInputCap,
        maxPriceOutputMicrounits: nextOutputCap,
        spendPreset: nextSpendPreset,
        lastBalanceRemaining: status?.balanceRemaining ?? agent?.usePod?.lastBalanceRemaining ?? "",
        lastRoute: status?.route ?? agent?.usePod?.lastRoute ?? "",
        lastCheckedAt: status?.checkedAt ?? agent?.usePod?.lastCheckedAt ?? "",
        lastTestStatus: status?.status ?? agent?.usePod?.lastTestStatus ?? "",
        lastStatusMessage: status?.message ?? agent?.usePod?.lastStatusMessage ?? "",
        lastHttpStatus: status?.httpStatus ?? agent?.usePod?.lastHttpStatus,
        lastModelCount: status?.modelCount ?? agent?.usePod?.lastModelCount,
        lastTokenPresent: status?.tokenPresent ?? agent?.usePod?.lastTokenPresent,
        lastTokenSource: status?.tokenSource ?? agent?.usePod?.lastTokenSource ?? "",
        ...extra,
      },
    };
  }

  async function syncProfileChoice(state: { model?: string; spendPreset?: SpendPreset; customCaps?: typeof customCaps }) {
    setMessage("");
    try {
      await onComplete(profilePatchFromState(undefined, state));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update UsePod settings.");
    }
  }

  async function attachWallet(wallet: AgentProfile) {
    const walletKey = walletKeyForUsePodAgent(wallet);
    if (attachingWalletKey) return;
    const walletUsePod = wallet.usePod ?? {};
    const walletModel = wallet.model || selectedModel || FALLBACK_MODELS[0].id;
    const walletPreset = walletUsePod.spendPreset ?? presetForCaps(walletUsePod.maxPriceInputMicrounits, walletUsePod.maxPriceOutputMicrounits);
    attachedWalletRef.current = true;
    const attachPatch = {
      provider: "usepod",
      model: walletModel,
      gatewayUrl: "https://api.usepod.ai",
      chatPath: "/v1/chat/completions",
      statusPath: "/v1/models",
      usePod: {
        tokenEnvName: walletUsePod.tokenEnvName || "USEPOD_TOKEN",
        depositAddress: walletUsePod.depositAddress || "",
        depositCode: walletUsePod.depositCode || "",
        dashboardUrl: walletUsePod.dashboardUrl || "",
        maxPriceInputMicrounits: walletUsePod.maxPriceInputMicrounits || "",
        maxPriceOutputMicrounits: walletUsePod.maxPriceOutputMicrounits || "",
        spendPreset: walletPreset,
        lastBalanceRemaining: walletUsePod.lastBalanceRemaining || "",
        lastRoute: walletUsePod.lastRoute || "",
        lastCheckedAt: walletUsePod.lastCheckedAt || "",
        lastTestStatus: walletUsePod.lastTestStatus || "ready",
        lastStatusMessage: walletUsePod.lastStatusMessage || "",
        lastHttpStatus: walletUsePod.lastHttpStatus,
        lastModelCount: walletUsePod.lastModelCount,
        lastTokenPresent: walletUsePod.lastTokenPresent,
        lastTokenSource: walletUsePod.lastTokenSource || "",
      },
    };
    setAttachingWalletKey(walletKey);
    setMessage(`Attaching ${wallet.name}...`);
    setSelectedModel(walletModel);
    setSpendPreset(walletPreset);
    setCustomCaps({
      input: walletUsePod.maxPriceInputMicrounits ?? "",
      output: walletUsePod.maxPriceOutputMicrounits ?? "",
    });
    setStatus({
      ok: true,
      status: walletUsePod.lastTestStatus || "ready",
      message: `Attached ${wallet.name}.`,
      tokenEnvName: walletUsePod.tokenEnvName || "USEPOD_TOKEN",
      depositAddress: walletUsePod.depositAddress || "",
      depositCode: walletUsePod.depositCode || "",
      dashboardUrl: walletUsePod.dashboardUrl || "",
      modelCount: walletUsePod.lastModelCount ?? 0,
      models: [],
      balanceRemaining: walletUsePod.lastBalanceRemaining || "",
      route: walletUsePod.lastRoute || "",
      checkedAt: walletUsePod.lastCheckedAt || new Date().toISOString(),
    });
    setSetupView("setup");
    setCurrentStep(3);
    try {
      await onComplete(attachPatch);
      setAttachingWalletKey("");
      setChecking(true);
      setMessage("Loading UsePod models...");
      const response = await fetch("/api/usepod/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: { ...(agent ?? {}), ...attachPatch },
          action: "models",
          model: walletModel,
        }),
      });
      const data = await response.json().catch(() => null) as UsePodStatusResponse | null;
      if (!data?.ok || !data.models?.length) {
        setMessage(data?.message ?? `Attached ${wallet.name}. Refresh models if the list still looks short.`);
        return;
      }
      setStatus(data);
      const resolvedModel = data.models.some((model) => model.id === walletModel) ? walletModel : data.models[0]?.id || walletModel;
      if (resolvedModel !== walletModel) setSelectedModel(resolvedModel);
      await onComplete({
        ...profilePatchFromState({
          tokenEnvName: data.tokenEnvName ?? attachPatch.usePod.tokenEnvName,
          depositAddress: data.depositAddress ?? attachPatch.usePod.depositAddress,
          depositCode: data.depositCode ?? attachPatch.usePod.depositCode,
          dashboardUrl: data.dashboardUrl ?? attachPatch.usePod.dashboardUrl,
          lastBalanceRemaining: data.balanceRemaining ?? attachPatch.usePod.lastBalanceRemaining,
          lastRoute: data.route ?? attachPatch.usePod.lastRoute,
          lastCheckedAt: data.checkedAt ?? attachPatch.usePod.lastCheckedAt,
          lastTestStatus: data.status ?? attachPatch.usePod.lastTestStatus,
          lastStatusMessage: data.message ?? attachPatch.usePod.lastStatusMessage,
          lastHttpStatus: data.httpStatus ?? attachPatch.usePod.lastHttpStatus,
          lastModelCount: data.modelCount ?? attachPatch.usePod.lastModelCount,
          lastTokenPresent: data.tokenPresent ?? attachPatch.usePod.lastTokenPresent,
          lastTokenSource: data.tokenSource ?? attachPatch.usePod.lastTokenSource,
        }, { model: resolvedModel }),
        model: resolvedModel,
      });
      setMessage(`Attached ${wallet.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not attach ${wallet.name}.`);
    } finally {
      setAttachingWalletKey("");
      setChecking(false);
    }
  }

  function clearSuccessTimer() {
    if (successTimerRef.current === null) return;
    window.clearTimeout(successTimerRef.current);
    successTimerRef.current = null;
  }

  async function discoverModels(opts?: { quiet?: boolean }) {
    clearSuccessTimer();
    setShowingSuccess(false);
    setChecking(true);
    setMessage("");
    try {
      const response = await fetch("/api/usepod/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: { ...(agent ?? {}), ...profilePatchFromState() },
          action: "models",
          model: selectedModel,
        }),
      });
      const data = await response.json().catch(() => null) as UsePodStatusResponse | null;
      if (!data) {
        setMessage("UsePod did not return model data.");
        return;
      }
      setStatus(data);
      const nextModel = data.models?.[0]?.id;
      const resolvedModel = data.models?.some((model) => model.id === selectedModel) ? selectedModel : nextModel || selectedModel;
      if (resolvedModel !== selectedModel) setSelectedModel(resolvedModel);
      const completionPatch = {
        ...profilePatchFromState({
          tokenEnvName: data.tokenEnvName ?? tokenEnvName,
          depositAddress: data.depositAddress ?? depositAddress,
          depositCode: data.depositCode ?? depositCode,
          dashboardUrl: data.dashboardUrl ?? dashboardUrl,
          lastBalanceRemaining: data.balanceRemaining ?? "",
          lastRoute: data.route ?? "",
          lastCheckedAt: data.checkedAt ?? "",
          lastTestStatus: data.status ?? "",
          lastStatusMessage: data.message ?? "",
          lastHttpStatus: data.httpStatus,
          lastModelCount: data.modelCount,
          lastTokenPresent: data.tokenPresent,
          lastTokenSource: data.tokenSource ?? "",
        }),
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
      if (data.status === "needs-funding" && !opts?.quiet) setCurrentStep(2);
      setMessage(data.message ?? "Funding may still be pending. Try again after UsePod confirms the top-up.");
      setChecking(false);
      await onComplete(completionPatch);
    } catch (error) {
      setMessage(friendlyUsePodCheckError(error));
    } finally {
      setChecking(false);
    }
  }

  async function setUpUsePod() {
    setRegistering(true);
    setCreationStage(0);
    setMessage("");
    try {
      const response = await fetch("/api/usepod/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saveToEnv: true }),
      });
      const data = await response.json().catch(() => null) as RegisterResponse | null;
      if (!response.ok || !data?.ok) {
        setMessage(data?.error ?? `UsePod setup failed with HTTP ${response.status}.`);
        return;
      }
      const nextFundingUrl = data.fundingUrl || data.dashboardUrl || "";
      setRegistered(data);
      setStatus((current) => ({
        ...(current ?? {}),
        status: current?.status ?? "registered",
        tokenEnvName: data.tokenEnvName ?? "USEPOD_TOKEN",
        depositAddress: data.depositAddress ?? "",
        depositCode: data.depositCode ?? "",
        dashboardUrl: nextFundingUrl,
        modelCount: current?.modelCount ?? 0,
        models: current?.models ?? [],
        checkedAt: current?.checkedAt ?? new Date().toISOString(),
      }));
      setFundingOpened(false);
      setCurrentStep(2);
      setRegistering(false);
      await onComplete(profilePatchFromState({
        tokenEnvName: data.tokenEnvName ?? "USEPOD_TOKEN",
        depositAddress: data.depositAddress ?? "",
        depositCode: data.depositCode ?? "",
        dashboardUrl: nextFundingUrl,
        lastTestStatus: "registered",
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "UsePod setup failed.");
    } finally {
      setRegistering(false);
    }
  }

  async function openFundingPage(browserId = "") {
    if (!dashboardUrl) {
      setMessage("UsePod did not return a funding link yet.");
      return;
    }
    const browserLabel = browserOptions.find((browser) => browser.id === browserId)?.label;
    setOpeningBrowser(browserId || "default");
    setMessage("");
    try {
      const response = await fetch("/api/system/browsers/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: dashboardUrl, browserId: browserId || undefined }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error ?? "Could not open the funding page.");
      setFundingOpened(true);
      setBrowserMenuOpen(false);
      setMessage(browserLabel ? `Opened funding in ${browserLabel}.` : "Opened funding.");
    } catch (error) {
      if (!browserId) {
        window.open(dashboardUrl, "_blank", "noopener,noreferrer");
        setFundingOpened(true);
        setBrowserMenuOpen(false);
        setMessage("Opened funding.");
        return;
      }
      setMessage(error instanceof Error ? error.message : "Could not open the funding page.");
    } finally {
      setOpeningBrowser("");
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
      // UsePod deposits are Solana USDC, so only Solana wallets can fund here.
      setBrowseWallets(data.wallets.filter((wallet) => wallet.network.startsWith("solana:")));
    } catch (error) {
      setBrowseWallets([]);
      setMessage(error instanceof Error ? error.message : "Could not list local wallets.");
    }
  }

  function selectBrowseWallet(wallet: BrowseWallet) {
    setVaultWallet(wallet);
    setSetupView("setup");
    if (depositCode) {
      setCurrentStep(2);
      setMessage(`Funding from ${shortUsePodValue(wallet.address)}. Enter an amount and transfer.`);
      return;
    }
    setMessage(`Funding from ${shortUsePodValue(wallet.address)}. Create a token first, then transfer.`);
  }

  async function transferWithVaultWallet() {
    if (!vaultWallet) return;
    if (!depositCode) {
      setMessage("Create a UsePod token first so HivemindOS has a funding reference.");
      return;
    }
    setMessage("");
    setTransferBusy("vault");
    try {
      const response = await fetch("/api/usepod/deposit-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsdc: depositAmount, depositCode, depositor: vaultWallet.address }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; transactionBase64?: string } | null;
      if (!response.ok || !data?.ok || !data.transactionBase64) throw new Error(data?.error || "Could not prepare the UsePod deposit transaction.");
      const signResponse = await fetch("/api/usepod/deposit-sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletVaultId: vaultWallet.vaultId, transactionBase64: data.transactionBase64 }),
      });
      const signData = await signResponse.json().catch(() => null) as { ok?: boolean; error?: string; signature?: string } | null;
      if (!signResponse.ok || !signData?.ok) throw new Error(signData?.error || "Could not sign and send the UsePod deposit.");
      setFundingOpened(true);
      setMessage(signData.signature ? `Transfer submitted: ${shortUsePodValue(signData.signature)}` : "Transfer submitted. Check funding in a moment.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send the UsePod transfer.");
    } finally {
      setTransferBusy("");
    }
  }

  async function transferWithWallet(walletId?: string) {
    const wallet = walletProviders.find((candidate) => candidate.id === walletId) ?? selectedWalletProvider;
    if (!wallet) {
      setMessage("No Solana wallet extension was detected in this browser. Copy the recipient address or use Fund via UsePod.");
      return;
    }
    if (!depositCode) {
      setMessage("Create a UsePod token first so HivemindOS has a funding reference.");
      return;
    }
    setMessage("");
    setTransferBusy(wallet.id);
    try {
      const connected = await wallet.provider.connect();
      const depositor = walletPublicKey(wallet.provider, connected);
      if (!depositor) throw new Error(`${wallet.label} did not return a wallet address.`);
      const response = await fetch("/api/usepod/deposit-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsdc: depositAmount, depositCode, depositor }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; transactionBase64?: string } | null;
      if (!response.ok || !data?.ok || !data.transactionBase64) throw new Error(data?.error || "Could not prepare the UsePod deposit transaction.");
      const transaction = Transaction.from(base64ToBytes(data.transactionBase64));
      if (!wallet.provider.signAndSendTransaction) throw new Error(`${wallet.label} can connect, but it does not expose sign-and-send for this page.`);
      const result = await wallet.provider.signAndSendTransaction(transaction);
      const signature = typeof result === "string" ? result : result.signature;
      setFundingOpened(true);
      setWalletMenuOpen(false);
      setMessage(signature ? `Transfer submitted: ${shortUsePodValue(signature)}` : "Transfer submitted. Check funding in a moment.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send the UsePod transfer.");
    } finally {
      setTransferBusy("");
    }
  }

  const steps = [
    { n: 1, label: "Create token", tag: "credential" },
    { n: 2, label: "Fund", tag: "usdc rail" },
    { n: 3, label: "Model", tag: "route" },
  ] as const;

  return (
    <section className={styles.root} aria-label="UsePod setup">
      <span className={`${styles.corner} ${styles.tl}`} />
      <span className={`${styles.corner} ${styles.tr}`} />
      <span className={`${styles.corner} ${styles.bl}`} />
      <span className={`${styles.corner} ${styles.br}`} />

      <header className={styles.head}>
        <Hex size={46} image="/icons/runtimes/usepod.webp" stroke="rgba(94, 234, 212, 0.5)" />
        <div className={styles.headText}>
          <h2>{headerCopy.title}</h2>
          <p>{headerCopy.body}</p>
        </div>
      </header>

      {setupView === "setup" && !registering && !showingSuccess ? (
        <div className={styles.steps} aria-label="UsePod setup steps">
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
          <div className={styles.wallets} role="list" aria-label="Existing UsePod wallets">
            {walletOptions.map((wallet) => {
              const walletUsePod = wallet.usePod ?? {};
              const deposit = walletUsePod.depositAddress || walletUsePod.depositCode || "";
              const walletKey = walletKeyForUsePodAgent(wallet);
              const attaching = attachingWalletKey === walletKey;
              return (
                <button type="button" className={styles.wallet} key={walletKey} disabled={Boolean(attachingWalletKey)} onClick={() => void attachWallet(wallet)}>
                  <span className={styles.wname}>
                    <b>{wallet.name}</b>
                    <small>{attaching ? "Attaching wallet..." : wallet.machineName || walletUsePod.tokenEnvName || "UsePod"}</small>
                  </span>
                  <span className={styles.wbal}>
                    <b>{attaching ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : walletUsePod.lastBalanceRemaining || "Funded"}</b>
                    <small>{deposit ? shortUsePodValue(deposit) : `${walletUsePod.lastModelCount ?? 0} models`}</small>
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
              <button type="button" className={styles.wallet} key={wallet.vaultId} onClick={() => selectBrowseWallet(wallet)}>
                <span className={styles.wname}>
                  <b>{wallet.kind === "personal" ? "Personal wallet" : wallet.kind === "venice" ? "Venice wallet" : `Agent ${shortUsePodValue(wallet.vaultId)}`}</b>
                  <small>{shortUsePodValue(wallet.address)}</small>
                </span>
                <span className={styles.wbal}>
                  <b>Solana</b>
                  <small>USDC funding</small>
                </span>
              </button>
            )) : (
              <div className={styles.modelNotice}>
                <span>No local Solana wallets yet. Use the funding page or a wallet extension instead.</span>
              </div>
            )}
          </div>
        ) : null}

        {setupView === "summary" ? (
          <div className={`${styles.panel} ${styles.accentCyan}`}>
            <span className={styles.eyebrow}>Wallet funded</span>
            <h3>UsePod is ready</h3>
            <p>Inference is paid from this prepaid USDC balance with the spend caps below.</p>
            {depositAddress ? <CodeLine label="Deposit address · Solana" value={depositAddress} /> : null}
            <div className={styles.status}>
              {(status?.balanceRemaining || agent?.usePod?.lastBalanceRemaining) ? (
                <span className={styles.stat}><span className={styles.dot} />Balance <b>{status?.balanceRemaining || agent?.usePod?.lastBalanceRemaining}</b></span>
              ) : null}
              <span className={styles.stat}>Model <b>{selectedModel}</b></span>
              <span className={styles.stat}>Caps <b>{activePreset?.label ?? "Custom"}</b></span>
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
                  void discoverModels({ quiet: true });
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
                <ArrowUpRight aria-hidden="true" /> Fund
              </button>
            </div>
          </div>
        ) : null}

        {setupView === "setup" && currentStep === 1 ? (
          registering ? (
            <div className={`${styles.panel} ${styles.accentCyan} ${styles.create}`}>
              <div className={styles.prog}>
                <span className={styles.eyebrow}>Provisioning</span>
                {TOKEN_CREATION_STEPS.map((step, index) => (
                  <div className={`${styles.progRow} ${index < creationStage ? styles.done : index === creationStage ? styles.active : ""}`} key={step}>
                    <span>{index < creationStage ? <Check aria-hidden="true" /> : index === creationStage ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <PlugZap aria-hidden="true" />}</span>
                    {step}
                  </div>
                ))}
              </div>
              <div className={styles.core} aria-hidden="true">
                <span className={`${styles.ring} ${styles.r1}`} />
                <span className={`${styles.ring} ${styles.r2}`} />
                <Hex size={70} style={{ zIndex: 1 }}>
                  <PlugZap className={styles.coreIcon} />
                </Hex>
              </div>
            </div>
          ) : (
            <div className={`${styles.panel} ${styles.accentCyan} ${styles.create}`}>
              <div>
                <span className={styles.eyebrow}>Prepaid compute rail</span>
                <h3>{recovering ? "Checking saved token" : "Create token"}</h3>
                <p>
                  {recovering
                    ? "Looking for an existing UsePod setup."
                    : <>HivemindOS registers a UsePod token, saves it with <code className={styles.mono}>hive-env-add</code>, and attaches it to this agent.</>}
                </p>
                <div className={styles.actionRow}>
                  <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => void setUpUsePod()} disabled={isBusy}>
                    {recovering ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <PlugZap aria-hidden="true" />}
                    {recovering ? "Checking saved token" : "Create token"}
                  </button>
                </div>
              </div>
              <div className={styles.core} aria-hidden="true">
                <span className={`${styles.ring} ${styles.r2}`} />
                <Hex size={70} style={{ zIndex: 1 }}>
                  <Cpu className={styles.coreIcon} />
                </Hex>
              </div>
            </div>
          )
        ) : null}

        {setupView === "setup" && currentStep === 2 ? (
          showingSuccess ? (
            <div className={`${styles.panel} ${styles.success}`} aria-live="polite">
              <div className={styles.successMark} aria-hidden="true">
                <Check />
              </div>
              <h3>Funded</h3>
              <p>UsePod is topped up. Loading models.</p>
            </div>
          ) : (
            <>
              <div className={`${styles.panel} ${styles.accentCyan}`}>
                <span className={styles.eyebrow}>Hosted funding</span>
                <h3>{fundingOpened ? "Finish funding" : "Fund via UsePod"}</h3>
                <p>{fundingOpened ? "Complete the top-up in the opened tab, then re-check." : "Open UsePod with this token already attached."}</p>
                <div className={styles.fundingActions}>
                  <div className={styles.menuWrap}>
                    <div className={styles.split}>
                      <button type="button" className={`${styles.btn} ${styles.honey}`} disabled={!dashboardUrl || Boolean(openingBrowser)} onClick={() => void openFundingPage()}>
                        {openingBrowser === "default" ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}
                        Fund via UsePod
                      </button>
                      <button type="button" className={`${styles.btn} ${styles.honey} ${styles.caret}`} aria-label="Choose browser" disabled={!dashboardUrl || Boolean(openingBrowser)} onClick={() => setBrowserMenuOpen((open) => !open)}>
                        <ChevronDown aria-hidden="true" />
                      </button>
                    </div>
                    {browserMenuOpen ? (
                      <div className={styles.dropdown}>
                        <div className={styles.dropdownLabel}>Open in</div>
                        {browserOptions.length ? browserOptions.map((browser) => (
                          <button type="button" key={browser.id} className={styles.dropdownItem} disabled={Boolean(openingBrowser)} onClick={() => void openFundingPage(browser.id)}>
                            {openingBrowser === browser.id ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : null}
                            {browser.label}
                          </button>
                        )) : <div className={styles.dropdownItem} data-empty="true">No browsers detected</div>}
                      </div>
                    ) : null}
                  </div>
                  <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => void discoverModels()} disabled={isBusy}>
                    {checking ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <RefreshCcw aria-hidden="true" />}
                    Check funding
                  </button>
                </div>
                {showInlineFundingMessage ? (
                  <p className={styles.fundingStatus} data-tone={status?.status === "needs-funding" ? "warn" : status?.status === "ready" ? "ok" : "info"}>
                    {message}
                  </p>
                ) : null}
              </div>

              <div className={styles.or} aria-hidden="true">
                <span />
                <b>OR</b>
                <span />
              </div>

              <div className={`${styles.panel} ${styles.accentHoney} ${styles.deposit}`}>
                <div className={styles.depositHead}>
                  <div>
                    <span className={`${styles.eyebrow} ${styles.eyebrowHoney}`}>Direct deposit</span>
                    <p>Send USDC on Solana mainnet to the recipient address below.</p>
                  </div>
                  <span className={styles.badge}>USDC · SOL</span>
                </div>
                {depositAddress ? (
                  <CodeLine label="Recipient address" value={depositAddress} />
                ) : (
                  <p className={styles.mutedMono}>Create a token to reveal the recipient address.</p>
                )}
                {vaultWallet ? (
                  <div className={styles.transferComposer}>
                    <label className={styles.amountField}>
                      <span>From {shortUsePodValue(vaultWallet.address)}</span>
                      <div className={styles.amountInputWrap}>
                        <input
                          inputMode="decimal"
                          min="0"
                          pattern="^[0-9]+(\\.[0-9]{1,6})?$"
                          value={depositAmount}
                          onChange={(event) => setDepositAmount(event.target.value)}
                          aria-label="USDC amount"
                        />
                        <strong>USDC</strong>
                      </div>
                    </label>
                    <div className={styles.transferSplit}>
                      <button type="button" className={`${styles.btn} ${styles.honey} ${styles.transferPrimary}`} disabled={!depositCode || Boolean(transferBusy)} onClick={() => void transferWithVaultWallet()}>
                        {transferBusy === "vault" ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}
                        Transfer
                      </button>
                      <button type="button" className={`${styles.btn} ${styles.honey} ${styles.transferWalletButton}`} disabled={Boolean(transferBusy)} onClick={() => void openWalletBrowser()}>
                        Change wallet
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.actionRow}>
                    <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={Boolean(transferBusy)} onClick={() => void openWalletBrowser()}>
                      Other wallets
                    </button>
                  </div>
                )}
                {!nativeRuntime && !vaultWallet ? (
                  <>
                    <div className={styles.transferComposer}>
                      <label className={styles.amountField}>
                        <span>You will transfer</span>
                        <div className={styles.amountInputWrap}>
                          <input
                            inputMode="decimal"
                            min="0"
                            pattern="^[0-9]+(\\.[0-9]{1,6})?$"
                            value={depositAmount}
                            onChange={(event) => setDepositAmount(event.target.value)}
                            aria-label="USDC amount"
                          />
                          <strong>USDC</strong>
                        </div>
                      </label>
                      <div className={styles.menuWrap}>
                        <div className={styles.transferSplit}>
                          <button type="button" className={`${styles.btn} ${styles.honey} ${styles.transferPrimary}`} disabled={!selectedWalletProvider || !depositCode || Boolean(transferBusy)} onClick={() => void transferWithWallet()}>
                            {transferBusy ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}
                            Transfer
                          </button>
                          <button type="button" className={`${styles.btn} ${styles.honey} ${styles.transferWalletButton}`} disabled={Boolean(transferBusy)} aria-label="Choose wallet extension" onClick={() => setWalletMenuOpen((open) => !open)}>
                            {walletSelectorLabel}
                            <ChevronDown aria-hidden="true" />
                          </button>
                        </div>
                        {walletMenuOpen ? (
                          <div className={styles.dropdown}>
                            <div className={styles.dropdownLabel}>Wallet</div>
                            {walletProviders.length ? walletProviders.map((wallet) => (
                              <button type="button" className={styles.dropdownItem} disabled={Boolean(transferBusy)} key={wallet.id} onClick={() => void transferWithWallet(wallet.id)}>
                                {transferBusy === wallet.id ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : null}
                                {wallet.label}
                              </button>
                            )) : <div className={styles.dropdownItem} data-empty="true">No Solana wallet extension detected</div>}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {!walletProviders.length ? (
                      <p className={styles.walletUnavailableNote}>
                        Use the hosted funding page, or open this dashboard in a browser with a Solana wallet extension to send USDC.
                      </p>
                    ) : null}
                  </>
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
                <input placeholder="Search UsePod models" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} />
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
                      <button type="button" disabled={isBusy} onClick={() => void discoverModels()}>
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

            <div className={`${styles.panel} ${styles.spend}`}>
              <div className={styles.spendHead}>
                <span className={`${styles.eyebrow} ${styles.eyebrowViolet}`}>Spend cap · microunits</span>
                <span className={styles.stat} data-tone="violet">
                  <ShieldCheck aria-hidden="true" />
                  <b>{activePreset?.label ?? "Custom"}</b>
                </span>
              </div>
              <div className={styles.presets} role="group" aria-label="UsePod spend cap preset">
                {SPEND_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    className={`${styles.preset} ${spendPreset === preset.id ? styles.sel : ""}`}
                    aria-pressed={spendPreset === preset.id}
                    disabled={isBusy}
                    onClick={() => {
                      setSpendPreset(preset.id);
                      void syncProfileChoice({ spendPreset: preset.id });
                    }}
                  >
                    <b>{preset.label}</b>
                    <small>{preset.sub}</small>
                  </button>
                ))}
              </div>
              <div className={styles.caps}>
                <label className={styles.cap}>
                  <span>Input cap</span>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={inputCap}
                    onChange={(event) => {
                      const nextCustomCaps = { ...customCaps, input: event.target.value };
                      setSpendPreset("custom");
                      setCustomCaps(nextCustomCaps);
                      void syncProfileChoice({ spendPreset: "custom", customCaps: nextCustomCaps });
                    }}
                    placeholder="Microunits"
                  />
                </label>
                <label className={styles.cap}>
                  <span>Output cap</span>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={outputCap}
                    onChange={(event) => {
                      const nextCustomCaps = { ...customCaps, output: event.target.value };
                      setSpendPreset("custom");
                      setCustomCaps(nextCustomCaps);
                      void syncProfileChoice({ spendPreset: "custom", customCaps: nextCustomCaps });
                    }}
                    placeholder="Microunits"
                  />
                </label>
              </div>
            </div>

            <div className={styles.status}>
              {status?.balanceRemaining ? <span className={styles.stat}><span className={styles.dot} />Balance <b>{status.balanceRemaining}</b></span> : null}
              {status?.route ? <span className={styles.stat}>Route <b>{status.route}</b></span> : null}
              <span className={styles.stat}>Models <b>{modelCountLabel}</b></span>
            </div>
          </>
        ) : null}
      </div>

      <footer className={styles.foot}>
        <span className={`${styles.msg} ${message.includes("pending") ? styles.warn : ""}`}>
          {message || (setupView === "wallets" ? "Reusing a wallet copies its funded token and caps." : `${tokenEnvName} · api.usepod.ai`)}
        </span>
        <div className={styles.footActions}>
          {setupView === "setup" && currentStep === 1 && walletOptions.length ? <button type="button" className={styles.link} onClick={() => setSetupView("wallets")}>Attach existing wallet</button> : null}
          {setupView === "wallets" ? (
            <>
              <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => void openWalletBrowser()}>Other wallets</button>
              <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => { setMessage(""); setSetupView("setup"); setCurrentStep(1); }}><Plus aria-hidden="true" /> New wallet</button>
            </>
          ) : null}
          {setupView === "browse" ? (
            <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => { setMessage(""); setSetupView(shouldOfferWallets ? "wallets" : "setup"); }}>Back</button>
          ) : null}
          {setupView === "setup" && currentStep > 1 && !registering && !showingSuccess ? <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setCurrentStep((currentStep - 1) as SetupStep)}>Back</button> : null}
          {setupView === "setup" && currentStep === 3 ? (
            <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={isBusy || modelListUnavailable} onClick={() => { setMessage(""); setSetupView("summary"); }}>
              <Check aria-hidden="true" /> Done
            </button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}
