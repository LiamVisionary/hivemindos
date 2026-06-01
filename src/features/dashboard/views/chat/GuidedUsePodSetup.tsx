"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, LoaderCircle, PlugZap, Plus, RefreshCcw, X } from "lucide-react";
import { Transaction } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group";
import { CopyableCodeLine } from "@/components/ui/copyable-code-line";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { ModelPillSelector } from "./ModelPillSelector";
import styles from "./UsePodSetup.module.css";

type GuidedUsePodSetupProps = {
  agent?: AgentProfile | null;
  busy?: string;
  existingWallets?: AgentProfile[];
  fleetClass: (...classes: string[]) => string;
  requireCurrentSetup?: boolean;
  recoverSavedSetup?: boolean;
  onCancel: () => void;
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
type SetupView = "wallets" | "setup";

const SPEND_PRESETS: Array<{ id: SpendPreset; label: string; input: string; output: string }> = [
  { id: "cheapest", label: "Cheapest", input: "250", output: "1000" },
  { id: "balanced", label: "Balanced", input: "2000", output: "8000" },
  { id: "fast", label: "Fast", input: "10000", output: "30000" },
  { id: "none", label: "No cap", input: "", output: "" },
];

const FALLBACK_MODELS = [
  { id: "gpt-5.5", name: "gpt-5.5" },
  { id: "llama-4", name: "llama-4" },
  { id: "qwen-3.5", name: "qwen-3.5" },
  { id: "deepseek-v3.2", name: "deepseek-v3.2" },
  { id: "glm-5.1", name: "glm-5.1" },
];

const TOKEN_CREATION_STEPS = [
  "Requesting UsePod token",
  "Saving local credentials",
  "Preparing funding link",
];

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
    config?.tokenEnvName
      || config?.depositAddress
      || config?.depositCode
      || config?.dashboardUrl
      || config?.lastBalanceRemaining
      || config?.lastRoute
      || config?.lastCheckedAt
      || typeof config?.lastModelCount === "number",
  );
}

function isUsePodSetupReady(config?: AgentProfile["usePod"]) {
  return config?.lastTestStatus === "ready" || (typeof config?.lastModelCount === "number" && config.lastModelCount > 0);
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

export function GuidedUsePodSetup({
  agent,
  busy,
  existingWallets = [],
  fleetClass,
  requireCurrentSetup = false,
  recoverSavedSetup = true,
  onCancel,
  onComplete,
}: GuidedUsePodSetupProps) {
  const initialStep: SetupStep = agent?.usePod?.lastModelCount ? 3 : agent?.usePod?.dashboardUrl || agent?.usePod?.depositCode || agent?.usePod?.depositAddress ? 2 : 1;
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
  const [setupView, setSetupView] = useState<SetupView>(shouldOfferWallets ? "wallets" : "setup");
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
  const [depositAmount, setDepositAmount] = useState("5.00");
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [walletProviders, setWalletProviders] = useState<SolanaWalletProvider[]>([]);
  const [transferBusy, setTransferBusy] = useState("");
  const [showingSuccess, setShowingSuccess] = useState(false);
  const successTimerRef = useRef<number | null>(null);
  const discoveredModels = status?.models?.length ? status.models : [];
  const modelOptions = discoveredModels.length ? discoveredModels : FALLBACK_MODELS;
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
  const isBusy = registering || checking || recovering || showingSuccess || Boolean(transferBusy) || busy === "usepod-register";
  const headerCopy = useMemo(() => {
    if (setupView === "wallets") return { title: "UsePod wallet", body: "Attach an existing wallet or create a new one." };
    if (registering) return { title: "Creating token", body: "Setting up UsePod for this agent." };
    if (showingSuccess) return { title: "Success!", body: "Loading UsePod models." };
    if (currentStep === 1) return { title: "Create UsePod token", body: "HivemindOS will create and save it automatically." };
    if (currentStep === 2) return { title: "Fund UsePod", body: "Open the prefilled UsePod funding page, then check funding." };
    return { title: "Choose model", body: "Pick the model this agent should use." };
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
            action: "metadata",
            model: selectedModel,
          }),
        });
        const data = await response.json().catch(() => null) as UsePodStatusResponse | null;
        if (cancelled || !data?.ok) return;
        setStatus(data);
        await onComplete({
          ...profilePatchFromState({
            tokenEnvName: data.tokenEnvName ?? tokenEnvName,
            depositAddress: data.depositAddress ?? "",
            depositCode: data.depositCode ?? "",
            dashboardUrl: data.dashboardUrl ?? "",
            lastCheckedAt: data.checkedAt ?? "",
            lastTestStatus: data.status ?? "",
            lastModelCount: data.modelCount,
          }),
        });
        if (data.dashboardUrl || data.depositCode || data.depositAddress) setCurrentStep(2);
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
    const walletUsePod = wallet.usePod ?? {};
    const walletModel = wallet.model || selectedModel || FALLBACK_MODELS[0].id;
    const walletPreset = walletUsePod.spendPreset ?? presetForCaps(walletUsePod.maxPriceInputMicrounits, walletUsePod.maxPriceOutputMicrounits);
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
      models: [{ id: walletModel }],
      balanceRemaining: walletUsePod.lastBalanceRemaining || "",
      route: walletUsePod.lastRoute || "",
      checkedAt: walletUsePod.lastCheckedAt || new Date().toISOString(),
    });
    await onComplete({
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
      },
    });
    setSetupView("setup");
    setCurrentStep(3);
    setMessage(`Attached ${wallet.name}.`);
  }

  function clearSuccessTimer() {
    if (successTimerRef.current === null) return;
    window.clearTimeout(successTimerRef.current);
    successTimerRef.current = null;
  }

  async function discoverModels() {
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
      await onComplete({
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
        }),
        model: resolvedModel,
      });
      if (data.models?.length) {
        setMessage("");
        setShowingSuccess(true);
        successTimerRef.current = window.setTimeout(() => {
          setCurrentStep(3);
          setShowingSuccess(false);
          successTimerRef.current = null;
        }, 1250);
        return;
      }
      setMessage(data.message ?? "Funding may still be pending. Try again after UsePod confirms the top-up.");
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
      await onComplete(profilePatchFromState({
        tokenEnvName: data.tokenEnvName ?? "USEPOD_TOKEN",
        depositAddress: data.depositAddress ?? "",
        depositCode: data.depositCode ?? "",
        dashboardUrl: nextFundingUrl,
        lastTestStatus: "registered",
      }));
      setFundingOpened(false);
      setCurrentStep(2);
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

  return (
    <section className={fleetClass("guidedProviderSetup")} aria-label="UsePod setup">
      <div className={fleetClass("guidedProviderHeader")}>
        <span className={fleetClass("guidedProviderIcon")} aria-hidden="true">
          <PlugZap />
        </span>
        <div>
          <strong>{headerCopy.title}</strong>
          <p>{headerCopy.body}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Close UsePod setup" onClick={onCancel}>
          <X aria-hidden="true" />
        </Button>
      </div>

      {setupView === "setup" ? (
        <ol className={styles.stepRail} aria-label="UsePod setup steps">
          {[1, 2, 3].map((step) => (
            <li className={step <= currentStep ? `${styles.stepPill} ${styles.active}` : styles.stepPill} key={step}>
              {step < currentStep ? <Check aria-hidden="true" /> : null}
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {setupView === "wallets" ? (
        <div className={styles.focusPanel}>
          <div className={styles.walletChooserHeader}>
            <strong>Choose wallet</strong>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className={styles.usePodActionButton}
              onClick={() => {
                setMessage("");
                setSetupView("setup");
                setCurrentStep(1);
              }}
            >
              <Plus aria-hidden="true" />
              New wallet
            </Button>
          </div>
          <div className={styles.walletList} role="list" aria-label="Existing UsePod wallets">
            {walletOptions.map((wallet) => {
              const walletUsePod = wallet.usePod ?? {};
              const deposit = walletUsePod.depositAddress || walletUsePod.depositCode || "";
              return (
                <button
                  type="button"
                  className={styles.walletOption}
                  key={walletKeyForUsePodAgent(wallet)}
                  onClick={() => void attachWallet(wallet)}
                >
                  <span>
                    <strong>{wallet.name}</strong>
                    <small>{wallet.machineName || walletUsePod.tokenEnvName || "UsePod"}</small>
                  </span>
                  <span>
                    <strong>{walletUsePod.lastBalanceRemaining || "Funded"}</strong>
                    <small>{deposit ? shortUsePodValue(deposit) : `${walletUsePod.lastModelCount ?? 0} models`}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {setupView === "setup" && currentStep === 1 ? (
        <div className={styles.focusPanel}>
          {registering ? (
            <div className={styles.creationProgressPanel}>
              <div className={styles.creationProgressCopy}>
                <strong>Creating token</strong>
                <div className={styles.creationSteps}>
                  {TOKEN_CREATION_STEPS.map((step, index) => (
                    <span className={index <= creationStage ? styles.done : ""} key={step}>
                      {index < creationStage ? <Check aria-hidden="true" /> : index === creationStage ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
                      {step}
                    </span>
                  ))}
                </div>
              </div>
              <div className={styles.creationViz} aria-hidden="true">
                <span />
                <span />
                <PlugZap />
              </div>
            </div>
          ) : (
            <div className={styles.tokenStartPanel}>
              <div className={styles.tokenStartCopy}>
                <strong>{recovering ? "Checking saved token" : "Create token"}</strong>
                <p>{recovering ? "Looking for an existing UsePod setup." : "HivemindOS creates and saves it for this agent."}</p>
                <div className={styles.cardActions}>
                  <Button type="button" size="sm" className={styles.usePodActionButton} onClick={() => void setUpUsePod()} disabled={isBusy}>
                    {recovering ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <PlugZap aria-hidden="true" />}
                    Create token
                  </Button>
                </div>
              </div>
              <div className={styles.tokenStatusPreview} aria-hidden="true">
                <span className={styles.tokenStatusIcon}>
                  <PlugZap />
                </span>
                <span className={styles.tokenStatusLine} />
                <span className={styles.tokenStatusDot} />
              </div>
            </div>
          )}
        </div>
      ) : null}

      {setupView === "setup" && currentStep === 2 ? (
        <div className={styles.focusPanel}>
          {showingSuccess ? (
            <div className={styles.successPanel} aria-live="polite">
              <div className={styles.successMark} aria-hidden="true">
                <Check />
              </div>
              <strong>Success!</strong>
              <p>UsePod is funded. Loading models.</p>
            </div>
          ) : (
            <>
              <strong>{fundingOpened ? "Finish funding" : "Fund UsePod"}</strong>
              <p>{fundingOpened ? "Use the hosted flow or send Solana USDC directly, then check funding." : "Open UsePod with this token already attached."}</p>
              <div className={styles.fundingActions}>
                <DropdownMenu open={browserMenuOpen} onOpenChange={setBrowserMenuOpen}>
                  <ButtonGroup className={styles.fundingSplit}>
                    <Button
                      type="button"
                      size="sm"
                      className={styles.fundingPrimary}
                      disabled={!dashboardUrl || Boolean(openingBrowser)}
                      onClick={() => void openFundingPage()}
                    >
                      {openingBrowser === "default" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <ArrowUpRight aria-hidden="true" />}
                      Fund via UsePod
                    </Button>
                    <ButtonGroupSeparator className={styles.fundingSeparator} />
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        className={styles.fundingCaret}
                        aria-label="Choose browser"
                        disabled={!dashboardUrl || Boolean(openingBrowser)}
                      >
                        <ChevronDown aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                  </ButtonGroup>
                  <DropdownMenuContent align="end" className={styles.browserDropdown}>
                    <DropdownMenuLabel className={styles.browserLabel}>Open In</DropdownMenuLabel>
                    {browserOptions.length ? browserOptions.map((browser) => (
                      <DropdownMenuItem
                        className={styles.browserItem}
                        disabled={Boolean(openingBrowser)}
                        key={browser.id}
                        onSelect={(event) => {
                          event.preventDefault();
                          void openFundingPage(browser.id);
                        }}
                      >
                        {openingBrowser === browser.id ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
                        {browser.label}
                      </DropdownMenuItem>
                    )) : (
                      <DropdownMenuItem className={styles.browserEmpty} disabled>
                        No browsers detected
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button type="button" size="sm" variant="secondary" className={styles.usePodActionButton} onClick={() => void discoverModels()} disabled={isBusy}>
                  {checking ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RefreshCcw aria-hidden="true" />}
                  Check funding
                </Button>
              </div>
              <div className={styles.fundingDivider} aria-hidden="true">
                <span />
                <strong>OR</strong>
                <span />
              </div>
              <div className={styles.directDepositPanel}>
                <div className={styles.directDepositHeader}>
                  <div>
                    <strong>Deposit directly</strong>
                    <p>UsePod accepts USDC on Solana mainnet. The funding reference identifies this token; it is not a wallet address.</p>
                  </div>
                  <span>USDC</span>
                </div>
                {depositAddress ? (
                  <div className={styles.directDepositField}>
                    <span>Recipient address</span>
                    <CopyableCodeLine value={depositAddress} label="Copy recipient address" copiedLabel="Address copied" />
                  </div>
                ) : null}
                {depositCode ? (
                  <div className={styles.directDepositField}>
                    <span>Funding reference</span>
                    <CopyableCodeLine value={depositCode} label="Copy funding reference" copiedLabel="Reference copied" />
                  </div>
                ) : null}
                {!nativeRuntime ? (
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
                      <DropdownMenu open={walletMenuOpen} onOpenChange={setWalletMenuOpen}>
                        <ButtonGroup className={styles.transferSplit}>
                          <Button
                            type="button"
                            size="sm"
                            className={styles.transferPrimary}
                            disabled={!selectedWalletProvider || !depositCode || Boolean(transferBusy)}
                            onClick={() => void transferWithWallet()}
                          >
                            {transferBusy ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <ArrowUpRight aria-hidden="true" />}
                            Transfer
                          </Button>
                          <ButtonGroupSeparator className={styles.fundingSeparator} />
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="sm"
                              className={styles.transferWalletButton}
                              disabled={Boolean(transferBusy)}
                              aria-label="Choose wallet extension"
                            >
                              {walletSelectorLabel}
                              <ChevronDown aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                        </ButtonGroup>
                        <DropdownMenuContent align="end" className={styles.browserDropdown}>
                          <DropdownMenuLabel className={styles.browserLabel}>Wallet</DropdownMenuLabel>
                          {walletProviders.length ? walletProviders.map((wallet) => (
                            <DropdownMenuItem
                              className={styles.browserItem}
                              disabled={Boolean(transferBusy)}
                              key={wallet.id}
                              onSelect={(event) => {
                                event.preventDefault();
                                void transferWithWallet(wallet.id);
                              }}
                            >
                              {transferBusy === wallet.id ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
                              {wallet.label}
                            </DropdownMenuItem>
                          )) : (
                            <DropdownMenuItem className={styles.browserEmpty} disabled>
                              No Solana wallet extension detected
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {!walletProviders.length ? (
                      <p className={styles.walletUnavailableNote}>
                        Install or unlock a Solana wallet extension, or use the hosted funding page.
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}

      {setupView === "setup" && currentStep === 3 ? (
        <>
          <div className={styles.focusPanel}>
            <strong>Choose model</strong>
            <ModelPillSelector
              models={modelOptions}
              selectedModelId={selectedModel}
              disabled={isBusy}
              searchPlaceholder="Search UsePod models"
              onSelectModel={(modelId) => {
                setSelectedModel(modelId);
                void syncProfileChoice({ model: modelId });
              }}
            />
          </div>
          <details className={`${fleetClass("adaptiveAdvanced")} ${styles.spendCapDetails}`} title="Caps the maximum UsePod route price for this agent. Balanced is the default guardrail.">
            <summary>
              <span>Spend cap</span>
              <small>{spendPreset === "custom" ? "Custom" : activePreset?.label ?? "Balanced"}</small>
            </summary>
            <div className={styles.spendPanel}>
              <div className={styles.presetGroup} role="group" aria-label="UsePod spend cap preset">
                {SPEND_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    className={spendPreset === preset.id ? `${styles.preset} ${styles.selected}` : styles.preset}
                    aria-pressed={spendPreset === preset.id}
                    disabled={isBusy}
                    onClick={() => {
                      setSpendPreset(preset.id);
                      void syncProfileChoice({ spendPreset: preset.id });
                    }}
                  >
                    <strong>{preset.label}</strong>
                  </button>
                ))}
              </div>
              <div className={styles.capGrid}>
                <label className={styles.capField}>
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
                <label className={styles.capField}>
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
          </details>
        </>
      ) : null}

      {message ? <p className={fleetClass("guidedProviderMessage")}>{message}</p> : null}
    </section>
  );
}
