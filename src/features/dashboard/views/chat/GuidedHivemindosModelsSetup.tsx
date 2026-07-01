"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Coins, Copy, CreditCard, LoaderCircle, Plus, RefreshCcw, Search, Wallet, X } from "lucide-react";
import type { AgentProfile, HivemindosModelsAgentConfig } from "@/lib/types/agent-runtime";
import {
  HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL,
  HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
  HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS,
  normalizeHivemindosWalletPaidModel,
} from "@/lib/config/hivemindos-wallet-paid-models";
import { fetchPersonalWalletBalance, fetchPersonalWalletRecords } from "@/lib/native/personal-wallets";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";
import { getDisplayWalletBalanceUsd, getSurvivalSnapshot, hasConfiguredAgentWallet } from "@/lib/utils/agent-wallet";
import { WalletSelectPanel, type PickableWallet } from "../trade/WalletSelectModal";
import {
  agentPickable,
  groupedUserPickables,
  isLocalPaymentSigningWallet,
  resolvePickableAccount,
  type PickableAgent,
} from "../trade/wallet-pickables";
import styles from "./HivemindosModelsSetup.module.css";

const CARD_CREDIT_AMOUNT_OPTIONS = [10, 25, 50, 100] as const;
const CARD_CHECKOUT_POLL_WINDOW_MS = 10 * 60 * 1000;
const CARD_CHECKOUT_POLL_INTERVAL_MS = 5_000;
const CARD_CHECKOUT_INITIAL_POLL_DELAY_MS = 2_500;
const MODELS_CREDITS_RETURN_EVENT = "hivemindos:models-credits-return";

type SetupWallet = {
  vaultId: string;
  address: string;
  network: string;
  kind?: "personal" | "agent";
};

type SetupView = "setup" | "browse";
type FundingMode = NonNullable<HivemindosModelsAgentConfig["fundingMode"]>;
type CardCreditAmountOption = (typeof CARD_CREDIT_AMOUNT_OPTIONS)[number] | "custom";

type ModelCreditState = {
  ok?: boolean;
  configured?: boolean;
  checkoutUrl?: string;
  checkoutSessionId?: string;
  balanceUsd?: number | null;
  balanceLabel?: string;
  creditedUsd?: number;
  totalCreditedUsd?: number;
  totalDebitedUsd?: number;
  updatedAt?: string;
  message?: string;
  error?: string;
};

type ModelsCreditsReturnPayload = {
  status?: string;
  source?: string;
  url?: string;
};

type GuidedHivemindosModelsSetupProps = {
  agent?: AgentProfile | null;
  busy?: string;
  displayAgents?: PickableAgent[];
  walletsByAgent?: Record<string, unknown>;
  sharedVault?: { enabled?: boolean; vaultPath?: string } | null;
  onCancel: () => void;
  onComplete: (patch: Partial<AgentProfile>) => void | Promise<void>;
};

function networkLabel(network = "") {
  if (network === "eip155:8453") return "Base";
  if (network === "eip155:84532") return "Base Sepolia";
  if (network === "solana:mainnet") return "Solana";
  if (network === "solana:devnet") return "Solana devnet";
  if (network.startsWith("eip155:")) return "EVM";
  if (network.startsWith("solana:")) return "Solana";
  return network || "Unknown";
}

function walletAddressForPickable(pickable: PickableWallet): string {
  const wallet = pickable.wallet as unknown as Record<string, unknown>;
  return String(wallet.walletAddress || wallet.vaultAddress || wallet.address || "").trim();
}

function fundingKindForPickable(pickable: PickableWallet): HivemindosModelsAgentConfig["fundingWalletKind"] {
  return pickable.kind === "user" ? "personal" : "agent";
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(Math.max(0, value));
}

function moneyValue(value: unknown): number {
  const raw = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value.replace(/[$,\s]/g, ""))
      : NaN;
  return Number.isFinite(raw) ? raw : 0;
}

function hasFundedModelCredits(state: ModelCreditState, config?: HivemindosModelsAgentConfig | null): boolean {
  return [
    state.balanceUsd,
    state.totalCreditedUsd,
    config?.lastCreditBalanceUsd,
    config?.lastCreditBalanceLabel,
  ].some((value) => moneyValue(value) > 0);
}

function modelCreditBalanceUsd(state: ModelCreditState): number | null {
  if (typeof state.balanceUsd === "number" && Number.isFinite(state.balanceUsd)) {
    return Math.max(0, state.balanceUsd);
  }
  const balanceFromLabel = moneyValue(state.balanceLabel);
  if (balanceFromLabel > 0) return balanceFromLabel;
  const totalCredited = moneyValue(state.totalCreditedUsd);
  if (totalCredited > 0) return Math.max(0, totalCredited - moneyValue(state.totalDebitedUsd));
  return state.configured ? 0 : null;
}

function createCreditAccountId(agentId = ""): string {
  const stableAgentId = agentId.trim();
  if (stableAgentId && !stableAgentId.startsWith("new-")) return `agent:${stableAgentId}`;
  const randomId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `hmos-model-credits:${randomId}`;
}

async function openCheckoutUrl(checkoutUrl: string): Promise<"system" | "popup" | "blocked"> {
  const trimmedUrl = checkoutUrl.trim();
  if (!trimmedUrl) return "blocked";

  try {
    const response = await fetch("/api/system/browsers/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trimmedUrl }),
    });
    const data = await response.json().catch(() => null) as { ok?: boolean } | null;
    if (response.ok && data?.ok) return "system";
  } catch {
    // Fall back to the normal browser behavior below for plain web builds.
  }

  const opened = window.open(trimmedUrl, "_blank", "noopener,noreferrer");
  return opened ? "popup" : "blocked";
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

export function GuidedHivemindosModelsSetup({
  agent,
  busy,
  displayAgents = [],
  walletsByAgent,
  sharedVault,
  onCancel,
  onComplete,
}: GuidedHivemindosModelsSetupProps) {
  const initialModel = normalizeHivemindosWalletPaidModel(agent?.model || HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL);
  const [setupView, setSetupView] = useState<SetupView>("setup");
  const [creating, setCreating] = useState(false);
  const [personalBalancesLoading, setPersonalBalancesLoading] = useState(false);
  const [linkingWalletId, setLinkingWalletId] = useState("");
  const [message, setMessage] = useState("");
  const [personalWallets, setPersonalWallets] = useState<Array<Record<string, unknown>>>([]);
  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [fundingMode, setFundingMode] = useState<FundingMode>(
    agent?.hivemindosModels?.fundingMode ?? (agent?.hivemindosModels?.walletVaultId ? "wallet" : "credits"),
  );
  const [creditAccountId] = useState(() => (
    agent?.hivemindosModels?.creditAccountId?.trim() || createCreditAccountId(agent?.id)
  ));
  const [walletVaultId, setWalletVaultId] = useState(agent?.hivemindosModels?.walletVaultId ?? "");
  const [walletAddress, setWalletAddress] = useState(agent?.hivemindosModels?.walletAddress ?? "");
  const [walletNetwork, setWalletNetwork] = useState(agent?.hivemindosModels?.walletNetwork ?? "");
  const [creditState, setCreditState] = useState<ModelCreditState>({});
  const [creditRefreshing, setCreditRefreshing] = useState(false);
  const [creditFunding, setCreditFunding] = useState(false);
  const [cardCreditAmount, setCardCreditAmount] = useState<CardCreditAmountOption>(10);
  const [customCardCreditAmount, setCustomCardCreditAmount] = useState("25");
  const [cardCheckoutPollUntil, setCardCheckoutPollUntil] = useState(0);
  const creditStateRef = useRef<ModelCreditState>({});
  const lastPersistedCreditBalanceKeyRef = useRef("");

  const vaultPath = sharedVault?.enabled ? String(sharedVault.vaultPath || "").trim() : "";
  const isBusy = creating || creditFunding || Boolean(linkingWalletId) || busy === "hivemindos-models-setup";

  useEffect(() => {
    creditStateRef.current = creditState;
  }, [creditState]);

  useEffect(() => {
    let ignore = false;
    void Promise.resolve().then(async () => {
      if (ignore) return;
      setPersonalBalancesLoading(true);
      const records = await fetchPersonalWalletRecords(vaultPath);
      return Promise.all(records.map(async (record) => {
        const address = String(record.address || "").trim();
        const network = String(record.network || "").trim();
        if (!address || !network) return record;
        const balance = await fetchPersonalWalletBalance(address, network);
        return balance ? {
          ...record,
          currentBalanceUsd: balance.currentBalanceUsd,
          nativeBalance: balance.nativeBalance,
          tokens: balance.tokens,
          lastOnchainSyncAt: balance.lastOnchainSyncAt,
          updatedAt: Date.now(),
        } : record;
      }));
    })
      .then((records) => { if (!ignore && Array.isArray(records)) setPersonalWallets(records); })
      .catch(() => { if (!ignore) setPersonalWallets([]); })
      .finally(() => { if (!ignore) setPersonalBalancesLoading(false); });
    return () => { ignore = true; };
  }, [vaultPath]);

  const walletPickables = useMemo<PickableWallet[]>(() => {
    const userPickables = groupedUserPickables(personalWallets, { accountFilter: isLocalPaymentSigningWallet })
      .map((pickable) => ({ ...pickable, pending: personalBalancesLoading }));
    const agentPickables = displayAgents.flatMap((candidate) => {
      const pickable = agentPickable(candidate, walletsByAgent);
      if (!hasConfiguredAgentWallet(candidate as Parameters<typeof hasConfiguredAgentWallet>[0], pickable.wallet)) return [];
      if ((pickable.wallet as unknown as { setupRequired?: boolean }).setupRequired) return [];
      if (!isLocalPaymentSigningWallet(pickable.wallet)) return [];
      return [{ ...pickable, statusOverride: { tone: "ok" as const, text: "Agent wallet" } }];
    });
    return [...userPickables, ...agentPickables];
  }, [displayAgents, personalBalancesLoading, personalWallets, walletsByAgent]);

  const selfFundingPickable = agent?.id ? resolvePickableAccount(walletPickables, agent.id) : null;
  const selfFundingAddress = !walletVaultId && selfFundingPickable?.kind === "agent" ? walletAddressForPickable(selfFundingPickable) : "";
  const effectiveWalletVaultId = walletVaultId || (selfFundingAddress ? selfFundingPickable?.id ?? "" : "");
  const effectiveWalletAddress = walletAddress || selfFundingAddress;
  const effectiveWalletNetwork = walletNetwork || (selfFundingAddress ? selfFundingPickable?.wallet.network ?? "" : "");
  const walletReady = Boolean(effectiveWalletVaultId && effectiveWalletAddress);
  const existingHivemindosModels = agent?.hivemindosModels;
  const effectiveCreditAccountId = agent?.hivemindosModels?.creditAccountId?.trim() || creditAccountId;
  const creditLookupId = fundingMode === "credits" ? effectiveCreditAccountId : effectiveWalletVaultId;
  const cardFundingReady = hasFundedModelCredits(creditState, agent?.hivemindosModels);
  const setupReady = fundingMode === "credits" ? Boolean(effectiveCreditAccountId && cardFundingReady) : walletReady;
  const showRoutePreference = setupReady;
  const cardCheckoutPolling = fundingMode === "credits" && cardCheckoutPollUntil > 0 && !cardFundingReady;
  const cardTopUpAmountUsd = cardCreditAmount === "custom" ? Math.round(moneyValue(customCardCreditAmount) * 100) / 100 : cardCreditAmount;
  const cardTopUpAmountValid = cardTopUpAmountUsd >= 1 && cardTopUpAmountUsd <= 500;
  const currentWalletId = effectiveWalletVaultId;
  const savedFundingPickable = effectiveWalletVaultId ? resolvePickableAccount(walletPickables, effectiveWalletVaultId) : null;
  const savedFundingBalanceUsd = savedFundingPickable ? getDisplayWalletBalanceUsd(savedFundingPickable.wallet) : null;
  const savedFundingBalanceCopy = savedFundingPickable?.pending
    ? "Refreshing balance"
    : savedFundingBalanceUsd !== null
      ? `Balance ${formatUsd(savedFundingBalanceUsd)}`
      : "";
  const savedFundingHelp = savedFundingPickable?.pending
    ? `Refreshing this wallet's live balance on ${networkLabel(effectiveWalletNetwork)}.`
    : savedFundingBalanceUsd !== null && savedFundingBalanceUsd > 0
      ? `${formatUsd(savedFundingBalanceUsd)} is available for HivemindOS Models. Add more USDC and native gas here when you want more runway.`
      : `Fund this address with USDC and enough native gas for payments on ${networkLabel(effectiveWalletNetwork)}.`;
  const modelCreditLabel = creditRefreshing && creditState.balanceUsd == null
    ? "Checking credits"
    : typeof creditState.balanceUsd === "number"
      ? `Model credits ${formatUsd(creditState.balanceUsd)}`
      : creditState.configured === false
        ? "No model credits yet"
        : agent?.hivemindosModels?.lastCreditBalanceLabel
          ? `Model credits ${agent.hivemindosModels.lastCreditBalanceLabel}`
          : "Model credits unknown";
  const modelCreditHelp = cardCheckoutPolling
    ? "Watching Stripe for credits. HivemindOS will keep checking for up to 10 minutes."
    : creditState.error
    ? creditState.error
    : creditState.message
      ? creditState.message
      : creditState.configured === false
        ? fundingMode === "credits"
          ? "Add card credits once, then future model calls debit the hosted balance."
          : "Top up once to let this wallet pay future model calls from a prepaid hosted balance."
        : "Future model calls debit this hosted balance before asking for another payment.";

  const profilePatch = useCallback((config: Partial<HivemindosModelsAgentConfig> = {}, model = selectedModel): Partial<AgentProfile> => {
    const existingConfig = existingHivemindosModels ?? {};
    const nextFundingMode = config.fundingMode ?? fundingMode;
    const nextCreditAccountId = config.creditAccountId ?? existingConfig.creditAccountId ?? (nextFundingMode === "credits" ? effectiveCreditAccountId : "");
    const nextWalletVaultId = config.walletVaultId ?? effectiveWalletVaultId;
    const nextWalletAddress = config.walletAddress ?? effectiveWalletAddress;
    const nextWalletNetwork = config.walletNetwork ?? effectiveWalletNetwork;
    const nextConfig = { ...existingConfig, ...config };
    const nextCardFundingReady = hasFundedModelCredits(creditStateRef.current, nextConfig);
    const isReady = nextFundingMode === "credits"
      ? Boolean(nextCreditAccountId && nextCardFundingReady)
      : Boolean(nextWalletVaultId && nextWalletAddress);
    const now = new Date().toISOString();
    return {
      provider: HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
      model: normalizeHivemindosWalletPaidModel(model),
      token: "",
      hivemindosModels: {
        ...existingConfig,
        fundingMode: nextFundingMode,
        creditAccountId: nextCreditAccountId,
        walletVaultId: nextWalletVaultId,
        walletAddress: nextWalletAddress,
        walletNetwork: nextWalletNetwork,
        lastCheckedAt: now,
        lastTestStatus: isReady ? "ready" : nextFundingMode === "credits" ? "needs-credits" : "needs-wallet",
        lastStatusMessage: isReady
          ? nextFundingMode === "credits" ? "Hosted credits are set for HivemindOS Models." : "Wallet is saved for HivemindOS Models."
          : nextFundingMode === "credits" ? "Add card credits for HivemindOS Models." : "Choose or create a wallet for HivemindOS Models.",
        lastCreditBalanceUsd: existingConfig.lastCreditBalanceUsd,
        lastCreditBalanceLabel: existingConfig.lastCreditBalanceLabel,
        lastCreditCheckedAt: existingConfig.lastCreditCheckedAt,
        fundingWalletKind: config.fundingWalletKind ?? (nextWalletVaultId.startsWith("user:") ? "personal" : "agent"),
        ...config,
      },
    };
  }, [
    effectiveCreditAccountId,
    effectiveWalletAddress,
    effectiveWalletNetwork,
    effectiveWalletVaultId,
    existingHivemindosModels,
    fundingMode,
    selectedModel,
  ]);

  const persistModelCreditBalance = useCallback(async (
    state: ModelCreditState,
    statusMessage = "HivemindOS Models credits funded.",
  ): Promise<boolean> => {
    const balanceUsd = modelCreditBalanceUsd(state);
    if (balanceUsd === null) return false;
    const balanceLabel = state.balanceLabel && moneyValue(state.balanceLabel) > 0
      ? state.balanceLabel
      : formatUsd(balanceUsd);
    const funded = balanceUsd > 0;
    const persistKey = [
      fundingMode,
      fundingMode === "credits" ? effectiveCreditAccountId : effectiveWalletVaultId,
      balanceUsd.toFixed(6),
      balanceLabel,
      state.updatedAt ?? "",
    ].join(":");
    if (lastPersistedCreditBalanceKeyRef.current === persistKey) return funded;
    lastPersistedCreditBalanceKeyRef.current = persistKey;
    await onComplete(profilePatch({
      fundingMode,
      ...(fundingMode === "credits" ? { creditAccountId: effectiveCreditAccountId } : {}),
      lastCreditBalanceUsd: String(balanceUsd),
      lastCreditBalanceLabel: balanceLabel,
      lastCreditCheckedAt: new Date().toISOString(),
      lastTestStatus: funded || fundingMode === "wallet" ? "ready" : "needs-credits",
      lastStatusMessage: funded
        ? (state.message || statusMessage)
        : fundingMode === "credits"
          ? "Add card credits for HivemindOS Models."
          : "Wallet is saved for HivemindOS Models.",
    }));
    return funded;
  }, [effectiveCreditAccountId, effectiveWalletVaultId, fundingMode, onComplete, profilePatch]);

  useEffect(() => {
    if (!creditLookupId) {
      return undefined;
    }
    let ignore = false;
    const params = new URLSearchParams(
      fundingMode === "credits" ? { creditAccountId: creditLookupId } : { walletVaultId: creditLookupId },
    );
    void fetch(`/api/hivemindos/models/credits?${params.toString()}`, { cache: "no-store" })
      .then((response) => response.json().catch(() => ({ ok: false, error: `Credit balance returned HTTP ${response.status}.` })))
      .then((data: ModelCreditState) => {
        if (ignore) return;
        const nextState = data ?? {};
        setCreditState(nextState);
        if (nextState.ok) void persistModelCreditBalance(nextState);
      })
      .catch((error) => {
        if (!ignore) setCreditState({ ok: false, error: error instanceof Error ? error.message : "Could not read model credits." });
      });
    return () => { ignore = true; };
  }, [creditLookupId, fundingMode, persistModelCreditBalance]);

  useEffect(() => {
    if (!isTauriDesktopRuntime()) return undefined;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen<ModelsCreditsReturnPayload>(MODELS_CREDITS_RETURN_EVENT, (event) => {
        const status = String(event.payload?.status || "").toLowerCase();
        if (status === "cancel" || status === "canceled") {
          setCardCheckoutPollUntil(0);
          setMessage("Stripe Checkout was canceled. No card credits were added.");
          return;
        }
        setMessage("Stripe returned to HivemindOS. Watching for credits.");
        setCardCheckoutPollUntil(Date.now() + CARD_CHECKOUT_POLL_WINDOW_MS);
      }))
      .then((unlisten) => {
        const safeUnlisten = createSafeTauriUnlisten(unlisten);
        if (cancelled) {
          safeUnlisten();
          return;
        }
        cleanup = safeUnlisten;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!cardCheckoutPollUntil || fundingMode !== "credits" || !creditLookupId || cardFundingReady) {
      return undefined;
    }
    let cancelled = false;
    let timeoutId: number | undefined;
    const params = new URLSearchParams({ creditAccountId: creditLookupId });

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() > cardCheckoutPollUntil) {
        setCardCheckoutPollUntil(0);
        setMessage("Stripe payment is still pending. Use refresh if the receipt lands later.");
        return;
      }
      try {
        const response = await fetch(`/api/hivemindos/models/credits?${params.toString()}`, { cache: "no-store" });
        const data = await response.json().catch(() => null) as ModelCreditState | null;
        if (!cancelled && response.ok && data?.ok) {
          setCreditState(data);
          const funded = await persistModelCreditBalance(data);
          if (funded) {
            setCardCheckoutPollUntil(0);
            setMessage("HivemindOS Models credits funded.");
            return;
          }
        }
      } catch {
        // The manual refresh button stays available; keep polling until the window expires.
      }
      if (!cancelled) timeoutId = window.setTimeout(poll, CARD_CHECKOUT_POLL_INTERVAL_MS);
    };

    timeoutId = window.setTimeout(poll, CARD_CHECKOUT_INITIAL_POLL_DELAY_MS);
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [cardCheckoutPollUntil, cardFundingReady, creditLookupId, fundingMode, persistModelCreditBalance]);

  async function applyModel(model: string) {
    const normalized = normalizeHivemindosWalletPaidModel(model);
    setSelectedModel(normalized);
    setMessage("");
    try {
      await onComplete(profilePatch({}, normalized));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update HivemindOS Models settings.");
    }
  }

  async function selectFundingMode(mode: FundingMode) {
    setFundingMode(mode);
    setMessage("");
    try {
      await onComplete(profilePatch({
        fundingMode: mode,
        ...(mode === "credits" ? { creditAccountId: effectiveCreditAccountId } : {}),
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update HivemindOS Models funding.");
    }
  }

  async function createWallet() {
    setCreating(true);
    setMessage("");
    try {
      const response = await fetch("/api/hivemindos/models/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          agentId: agent?.id,
          agentName: agent?.name,
          network: "eip155:8453",
          vaultPath: vaultPath || undefined,
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; wallet?: SetupWallet } | null;
      if (!response.ok || !data?.ok || !data.wallet) {
        setMessage(data?.error ?? `HivemindOS wallet creation failed with HTTP ${response.status}.`);
        return;
      }
      setWalletVaultId(data.wallet.vaultId);
      setWalletAddress(data.wallet.address);
      setWalletNetwork(data.wallet.network);
      setSetupView("setup");
      setFundingMode("wallet");
      const patch = profilePatch({
        fundingMode: "wallet",
        walletVaultId: data.wallet.vaultId,
        walletAddress: data.wallet.address,
        walletNetwork: data.wallet.network,
        fundingWalletKind: data.wallet.kind ?? "agent",
        fundingWalletLabel: "This agent wallet",
        lastTestStatus: "ready",
        lastStatusMessage: "Wallet saved. It now appears in Wallets.",
      });
      await onComplete(patch);
      setMessage("Wallet saved. It now appears in Wallets.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "HivemindOS wallet creation failed.");
    } finally {
      setCreating(false);
    }
  }

  function openWalletBrowser() {
    setMessage("");
    setSetupView("browse");
  }

  async function linkWallet(pickable: PickableWallet) {
    if (linkingWalletId) return;
    setLinkingWalletId(pickable.id);
    setMessage("");
    const address = walletAddressForPickable(pickable);
    if (!address) {
      setLinkingWalletId("");
      setMessage("Choose a wallet with a local signing address.");
      return;
    }
    try {
      const response = await fetch("/api/hivemindos/models/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          walletVaultId: pickable.id,
          agentId: agent?.id,
          agentName: agent?.name,
          vaultPath: vaultPath || undefined,
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; wallet?: SetupWallet } | null;
      if (!response.ok || !data?.ok || !data.wallet) {
        setMessage(data?.error ?? `Could not link wallet with HTTP ${response.status}.`);
        return;
      }
      setWalletVaultId(data.wallet.vaultId);
      setWalletAddress(data.wallet.address);
      setWalletNetwork(data.wallet.network);
      setSetupView("setup");
      setFundingMode("wallet");
      await onComplete(profilePatch({
        fundingMode: "wallet",
        walletVaultId: data.wallet.vaultId,
        walletAddress: data.wallet.address,
        walletNetwork: data.wallet.network,
        fundingWalletKind: data.wallet.kind ?? fundingKindForPickable(pickable),
        fundingWalletLabel: pickable.name,
        lastTestStatus: "ready",
        lastStatusMessage: "Wallet linked and saved to Wallets.",
      }));
      setMessage("Wallet linked and saved to Wallets.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not link wallet.");
    } finally {
      setLinkingWalletId("");
    }
  }

  function linkSelectedWallet(selectedId: string) {
    const wallet = resolvePickableAccount(walletPickables, selectedId);
    if (!wallet) {
      setMessage("Choose a Base or Solana wallet that can sign model payments.");
      return;
    }
    void linkWallet(wallet);
  }

  async function refreshModelCredits() {
    if (!creditLookupId) return;
    setCreditRefreshing(true);
    setMessage("");
    try {
      const params = new URLSearchParams(
        fundingMode === "credits" ? { creditAccountId: creditLookupId } : { walletVaultId: creditLookupId },
      );
      const response = await fetch(`/api/hivemindos/models/credits?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => null) as ModelCreditState | null;
      if (!response.ok || !data?.ok) {
        setCreditState({ ok: false, error: data?.error ?? `Credit balance returned HTTP ${response.status}.` });
        return;
      }
      setCreditState(data);
      const funded = await persistModelCreditBalance(data);
      if (funded) {
        setCardCheckoutPollUntil(0);
        setMessage("HivemindOS Models credits funded.");
      }
    } catch (error) {
      setCreditState({ ok: false, error: error instanceof Error ? error.message : "Could not read model credits." });
    } finally {
      setCreditRefreshing(false);
    }
  }

  async function topUpModelCredits() {
    if (!effectiveWalletVaultId) return;
    setCreditFunding(true);
    setMessage("");
    try {
      const response = await fetch("/api/hivemindos/models/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "crypto", walletVaultId: effectiveWalletVaultId }),
      });
      const data = await response.json().catch(() => null) as ModelCreditState | null;
      if (!response.ok || !data?.ok) {
        const error = data?.error ?? `Credit top-up failed with HTTP ${response.status}.`;
        setCreditState((current) => ({ ...current, ok: false, error }));
        setMessage(error);
        return;
      }
      setCreditState(data);
      const balanceLabel = data.balanceLabel ?? (typeof data.balanceUsd === "number" ? formatUsd(data.balanceUsd) : "");
      await onComplete(profilePatch({
        lastCreditBalanceUsd: typeof data.balanceUsd === "number" ? String(data.balanceUsd) : "",
        lastCreditBalanceLabel: balanceLabel,
        lastCreditCheckedAt: new Date().toISOString(),
        lastTestStatus: "ready",
        lastStatusMessage: data.message || "HivemindOS Models credits funded.",
      }));
      setMessage(data.message || "HivemindOS Models credits funded.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Could not top up model credits.";
      setCreditState((current) => ({ ...current, ok: false, error: errorMessage }));
      setMessage(errorMessage);
    } finally {
      setCreditFunding(false);
    }
  }

  async function startCardCreditCheckout() {
    if (!effectiveCreditAccountId) return;
    if (!cardTopUpAmountValid) {
      setMessage("Choose a card credit amount from $1 to $500.");
      return;
    }
    setFundingMode("credits");
    setCreditFunding(true);
    setMessage("");
    try {
      const response = await fetch("/api/hivemindos/models/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "card",
          creditAccountId: effectiveCreditAccountId,
          amountUsd: cardTopUpAmountUsd,
        }),
      });
      const data = await response.json().catch(() => null) as ModelCreditState | null;
      if (!response.ok || !data?.ok) {
        const error = data?.error ?? `Card checkout failed with HTTP ${response.status}.`;
        setCreditState((current) => ({ ...current, ok: false, error }));
        setMessage(error);
        return;
      }
      setCreditState(data);
      const balanceLabel = data.balanceLabel ?? (typeof data.balanceUsd === "number" ? formatUsd(data.balanceUsd) : "");
      await onComplete(profilePatch({
        fundingMode: "credits",
        creditAccountId: effectiveCreditAccountId,
        lastCheckoutSessionId: data.checkoutSessionId || "",
        lastCreditBalanceUsd: typeof data.balanceUsd === "number" ? String(data.balanceUsd) : agent?.hivemindosModels?.lastCreditBalanceUsd ?? "",
        lastCreditBalanceLabel: balanceLabel || (agent?.hivemindosModels?.lastCreditBalanceLabel ?? ""),
        lastCreditCheckedAt: new Date().toISOString(),
        lastTestStatus: "needs-credits",
        lastStatusMessage: "Card checkout created. HivemindOS is watching for credits after payment completes.",
      }));
      const checkoutOpened = data.checkoutUrl ? await openCheckoutUrl(data.checkoutUrl) : "blocked";
      if (checkoutOpened === "blocked") {
        setMessage("Stripe Checkout was created, but HivemindOS could not open your browser. Try the card button again.");
        return;
      }
      setCardCheckoutPollUntil(Date.now() + CARD_CHECKOUT_POLL_WINDOW_MS);
      setMessage("Opened Stripe Checkout in your browser. Watching for credits.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Could not start card checkout.";
      setCreditState((current) => ({ ...current, ok: false, error: errorMessage }));
      setMessage(errorMessage);
    } finally {
      setCreditFunding(false);
    }
  }

  async function finishSetup() {
    setMessage("");
    try {
      const completionConfig: Partial<HivemindosModelsAgentConfig> = fundingMode === "credits"
        ? { fundingMode: "credits", creditAccountId: effectiveCreditAccountId }
        : { fundingMode: "wallet" };
      const currentCreditBalanceUsd = fundingMode === "credits" ? modelCreditBalanceUsd(creditStateRef.current) : null;
      if (currentCreditBalanceUsd !== null && currentCreditBalanceUsd > 0) {
        completionConfig.lastCreditBalanceUsd = String(currentCreditBalanceUsd);
        completionConfig.lastCreditBalanceLabel = creditStateRef.current.balanceLabel && moneyValue(creditStateRef.current.balanceLabel) > 0
          ? creditStateRef.current.balanceLabel
          : formatUsd(currentCreditBalanceUsd);
        completionConfig.lastCreditCheckedAt = new Date().toISOString();
      }
      await onComplete(profilePatch(completionConfig));
      onCancel();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not finish HivemindOS Models setup.");
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <div className={styles.brandIcon}>
          <Wallet aria-hidden="true" />
        </div>
        <div className={styles.headText}>
          <h2>HivemindOS Models funding</h2>
          <p>{setupReady ? "No-key model calls are ready for this agent." : "Add card credits or attach a crypto wallet."}</p>
        </div>
        <button type="button" className={styles.closeButton} aria-label="Close HivemindOS Models setup" onClick={onCancel}>
          <X aria-hidden="true" />
        </button>
      </div>

      <div
        className={[
          styles.body,
          setupView === "browse" ? styles.bodyBrowse : "",
          setupView !== "browse" ? (showRoutePreference ? styles.bodyWithModel : styles.bodyFundingOnly) : "",
        ].filter(Boolean).join(" ")}
      >
        {setupView === "browse" ? (
          <div className={styles.browseStack}>
            <WalletSelectPanel
              pickables={walletPickables}
              getSurvivalSnapshot={getSurvivalSnapshot}
              currentId={currentWalletId}
              onConfirm={linkSelectedWallet}
              onCancel={() => setSetupView("setup")}
              title="Link a funding wallet"
              subtitle="Pick one of your local wallets or a configured agent wallet. Balances match the Wallets and Trade views."
              confirmLabel={linkingWalletId ? "Linking wallet" : "Use for LLM calls"}
              cancelLabel="Back"
              confirmDisabled={isBusy}
              emptyCopy={personalBalancesLoading ? "Loading local wallets..." : "No local signing wallets were found."}
              panelClassName={styles.walletSelectorEmbed}
            />
          </div>
        ) : (
          <>
            <section className={`${styles.panel} ${styles.paymentPanel}`}>
              <span className={styles.eyebrow}>Funding</span>
              <h3>{fundingMode === "credits" ? "Hosted model credits" : walletReady ? "Wallet saved" : "Choose a wallet"}</h3>
              <div className={styles.fundingModes} role="group" aria-label="HivemindOS Models funding method">
                <button
                  type="button"
                  className={styles.fundingMode}
                  data-active={fundingMode === "credits" || undefined}
                  aria-pressed={fundingMode === "credits"}
                  onClick={() => void selectFundingMode("credits")}
                >
                  <CreditCard aria-hidden="true" />
                  Card credits
                </button>
                <button
                  type="button"
                  className={styles.fundingMode}
                  data-active={fundingMode === "wallet" || undefined}
                  aria-pressed={fundingMode === "wallet"}
                  onClick={() => void selectFundingMode("wallet")}
                >
                  <Wallet aria-hidden="true" />
                  Crypto wallet
                </button>
              </div>

              {fundingMode === "credits" ? (
                <>
                  <p className={styles.muted}>Add hosted HivemindOS Models credits with a card. Future responses debit this balance by actual model usage.</p>
                  <div className={styles.creditBox}>
                    <div className={styles.creditMain}>
                      <span className={styles.creditIcon}><Coins aria-hidden="true" /></span>
                      <div className={styles.creditText}>
                        <span className={styles.fieldLabel}>Model credits</span>
                        <strong>{modelCreditLabel}</strong>
                        <span>{modelCreditHelp}</span>
                      </div>
                    </div>
                    <div className={styles.cardAmounts} role="group" aria-label="Card credit amount">
                      {CARD_CREDIT_AMOUNT_OPTIONS.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          className={styles.amountChoice}
                          data-active={cardCreditAmount === amount || undefined}
                          aria-pressed={cardCreditAmount === amount}
                          onClick={() => setCardCreditAmount(amount)}
                        >
                          {formatUsd(amount)}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={styles.amountChoice}
                        data-active={cardCreditAmount === "custom" || undefined}
                        aria-pressed={cardCreditAmount === "custom"}
                        onClick={() => setCardCreditAmount("custom")}
                      >
                        Custom
                      </button>
                    </div>
                    {cardCreditAmount === "custom" ? (
                      <label className={styles.customAmount}>
                        <span>Custom amount</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="1"
                          max="500"
                          step="1"
                          value={customCardCreditAmount}
                          onChange={(event) => setCustomCardCreditAmount(event.target.value)}
                        />
                      </label>
                    ) : null}
                    <div className={styles.creditActions}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.ghost} ${styles.iconOnly}`}
                        disabled={creditRefreshing || creditFunding}
                        aria-label="Refresh HivemindOS Models credits"
                        onClick={() => void refreshModelCredits()}
                      >
                        <RefreshCcw className={creditRefreshing ? styles.spin : ""} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.primary}`}
                        disabled={isBusy || creditRefreshing || creditFunding || !cardTopUpAmountValid}
                        onClick={() => void startCardCreditCheckout()}
                      >
                        {creditFunding ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <CreditCard aria-hidden="true" />}
                        {cardTopUpAmountValid ? `Add ${formatUsd(cardTopUpAmountUsd)} with card` : "Add credits with card"}
                      </button>
                    </div>
                  </div>
                </>
              ) : walletReady ? (
                <>
                  <div className={styles.status}>
                    <span className={styles.stat}><Wallet aria-hidden="true" /><b>{networkLabel(effectiveWalletNetwork)}</b></span>
                    <span className={styles.stat} data-tone="live"><Check aria-hidden="true" /><b>Saved to Wallets</b></span>
                    {savedFundingBalanceCopy ? (
                      <span className={styles.stat} data-tone={savedFundingBalanceUsd && savedFundingBalanceUsd > 0 ? "live" : "balance"}><b>{savedFundingBalanceCopy}</b></span>
                    ) : null}
                  </div>
                  <CodeLine label="Funding address" value={effectiveWalletAddress} />
                  <p className={styles.muted}>{savedFundingHelp}</p>
                  <div className={styles.creditBox}>
                    <div className={styles.creditMain}>
                      <span className={styles.creditIcon}><Coins aria-hidden="true" /></span>
                      <div className={styles.creditText}>
                        <span className={styles.fieldLabel}>Model credits</span>
                        <strong>{modelCreditLabel}</strong>
                        <span>{modelCreditHelp}</span>
                      </div>
                    </div>
                    <div className={styles.creditActions}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.ghost} ${styles.iconOnly}`}
                        disabled={creditRefreshing || creditFunding}
                        aria-label="Refresh HivemindOS Models credits"
                        onClick={() => void refreshModelCredits()}
                      >
                        <RefreshCcw className={creditRefreshing ? styles.spin : ""} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.primary}`}
                        disabled={isBusy || creditRefreshing || creditFunding}
                        onClick={() => void topUpModelCredits()}
                      >
                        {creditFunding ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Plus aria-hidden="true" />}
                        Fund with crypto
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.muted}>Create a fresh Base wallet for this agent, or link a local wallet already stored by HivemindOS.</p>
                  <div className={styles.actionRow}>
                    <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={isBusy} onClick={() => void createWallet()}>
                      {creating ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Plus aria-hidden="true" />}
                      New wallet
                    </button>
                    <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={isBusy} onClick={openWalletBrowser}>
                      <Search aria-hidden="true" />
                      Existing wallet
                    </button>
                  </div>
                </>
              )}
            </section>

            {showRoutePreference ? (
              <section className={`${styles.panel} ${styles.modelPanel}`}>
                <span className={styles.eyebrow}>Model route</span>
                <h3>Route preference</h3>
                <div className={styles.models}>
                  {HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className={styles.model}
                      data-active={selectedModel === model.id || undefined}
                      aria-pressed={selectedModel === model.id}
                      onClick={() => void applyModel(model.id)}
                    >
                      <span>{model.name}</span>
                    </button>
                  ))}
                </div>
                <p className={styles.muted}>{HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS.find((model) => model.id === selectedModel)?.subtitle ?? "Best wallet-paid route"}</p>
              </section>
            ) : null}
          </>
        )}
      </div>

      <div className={styles.foot}>
        <div className={styles.msg}>{message || (fundingMode === "credits" ? "Card credits are stored in the hosted HivemindOS Models balance." : walletReady ? "This wallet is durable even if agent setup is canceled." : "Wallets are saved as soon as they are created or linked.")}</div>
        <div className={styles.footActions}>
          {fundingMode === "wallet" && walletReady ? (
            <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={isBusy} onClick={openWalletBrowser}>
              Change wallet
            </button>
          ) : null}
          <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={!setupReady || isBusy} onClick={() => void finishSetup()}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
