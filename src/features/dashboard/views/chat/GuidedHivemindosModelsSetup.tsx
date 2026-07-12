"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, ChevronRight, Coins, CreditCard, LoaderCircle, Network, Plus, RefreshCcw, Search, ShieldCheck, Sparkles, Wallet, X, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AgentProfile, HivemindosModelsAgentConfig } from "@/lib/types/agent-runtime";
import { isHiveComputeHostedModelId } from "@/lib/config/hive-compute-marketplace";
import {
  HIVEMINDOS_MODEL_CREDIT_TOP_UP_CONFIRMATION,
  HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID,
  HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL,
  HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
  HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS,
  isComputeFirstHivemindosModel,
  isCustomHivemindosWalletPaidModel,
  isFreeHivemindosWalletPaidModel,
  normalizeHivemindosWalletPaidModel,
  upstreamHivemindosWalletPaidModel,
} from "@/lib/config/hivemindos-wallet-paid-models";
import { fetchPersonalWalletBalance, fetchPersonalWalletRecords } from "@/lib/native/personal-wallets";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";
import { getSurvivalSnapshot, hasConfiguredAgentWallet } from "@/lib/utils/agent-wallet";
import { mergePersonalWalletSources } from "@/lib/utils/personal-wallet-grouping";
import { WalletSelectPanel, type PickableWallet } from "../trade/WalletSelectModal";
import {
  agentPickable,
  groupedUserPickables,
  isLocalPaymentSigningWallet,
  resolvePickableAccount,
  type PickableAgent,
} from "../trade/wallet-pickables";
import {
  creditPaymentTokenOptionsForPickable,
  formatTokenAmount,
  walletAddressForPickable,
  walletUsdcBalanceUsdForPickable,
} from "./hivemindos-model-funding-wallets";
import { deriveFreeMeter, type FreeAllowanceSnapshot, type FreeMeterState } from "./hivemindos-free-meter";
import { scoreModelStrength } from "@/lib/config/model-strength";
import styles from "./HivemindosModelsSetup.module.css";

const CARD_CREDIT_AMOUNT_OPTIONS = [10, 25, 50, 100] as const;
const CARD_CHECKOUT_POLL_WINDOW_MS = 10 * 60 * 1000;
const CARD_CHECKOUT_POLL_INTERVAL_MS = 5_000;
const CARD_CHECKOUT_INITIAL_POLL_DELAY_MS = 2_500;
const MODELS_CREDITS_RETURN_EVENT = "hivemindos:models-credits-return";
const HIVEMINDOS_CREDIT_TOP_UP_NETWORK = "eip155:8453";

type SetupWallet = {
  vaultId: string;
  address: string;
  network: string;
  kind?: "personal" | "agent";
};

type FundingMode = NonNullable<HivemindosModelsAgentConfig["fundingMode"]>;
type CardCreditAmountOption = (typeof CARD_CREDIT_AMOUNT_OPTIONS)[number] | "custom";

type FundState = {
  gate: boolean;
  pendingModel: string;
};

type GatewayModelOption = {
  id: string;
  name: string;
  subtitle?: string;
  group?: string;
  badge?: string;
  created?: number;
  promptUsdPerToken?: number;
  completionUsdPerToken?: number;
  trust?: "confidential-verified";
};

type PaidModelChipOption = GatewayModelOption & { upstreamModel?: string };

type GatewayModelSort = "top" | "new" | "cheap" | "pricey" | "az";

// Three grid rows per page (the grid renders 4 columns at the modal's width).
const GATEWAY_MODELS_PAGE_SIZE = 12;

const GATEWAY_MODEL_SORTS: Array<{ id: GatewayModelSort; label: string }> = [
  { id: "top", label: "Top" },
  { id: "new", label: "New" },
  { id: "cheap", label: "Cheapest" },
  { id: "pricey", label: "Priciest" },
  { id: "az", label: "A–Z" },
];

function gatewayModelPriceUsd(option: GatewayModelOption): number | null {
  if (option.promptUsdPerToken === undefined || option.completionUsdPerToken === undefined) return null;
  return option.promptUsdPerToken + option.completionUsdPerToken;
}

function isConfidentialVerifiedModel(option: unknown) {
  return Boolean(option && typeof option === "object" && (option as { trust?: unknown }).trust === "confidential-verified");
}

function pinConfidentialVerifiedFirst<T>(options: T[]): T[] {
  return options
    .map((option, index) => ({ option, index }))
    .sort((left, right) => (
      Number(isConfidentialVerifiedModel(right.option)) - Number(isConfidentialVerifiedModel(left.option))
      || left.index - right.index
    ))
    .map(({ option }) => option);
}

function sortGatewayModels(options: GatewayModelOption[], sort: GatewayModelSort): GatewayModelOption[] {
  const rows = [...options];
  switch (sort) {
    case "top":
      return pinConfidentialVerifiedFirst(rows.sort((left, right) => (
        scoreModelStrength(upstreamHivemindosWalletPaidModel(right.id)).score
        - scoreModelStrength(upstreamHivemindosWalletPaidModel(left.id)).score
      )));
    case "new":
      return pinConfidentialVerifiedFirst(rows.sort((left, right) => (right.created ?? 0) - (left.created ?? 0)));
    case "cheap":
      return pinConfidentialVerifiedFirst(rows.sort((left, right) => (gatewayModelPriceUsd(left) ?? Number.POSITIVE_INFINITY) - (gatewayModelPriceUsd(right) ?? Number.POSITIVE_INFINITY)));
    case "pricey":
      return pinConfidentialVerifiedFirst(rows.sort((left, right) => (gatewayModelPriceUsd(right) ?? -1) - (gatewayModelPriceUsd(left) ?? -1)));
    case "az":
    default:
      return pinConfidentialVerifiedFirst(rows.sort((left, right) => left.name.localeCompare(right.name)));
  }
}

// Icons for the auto-router tier chips, keyed by model id.
const TIER_CHIP_ICONS: Record<string, LucideIcon> = {
  "hivemindos/auto": Network,
  "hivemindos/fast": Zap,
  "hivemindos/deep": Search,
  "hivemindos/frontier": Sparkles,
  "hivemindos/research": Search,
};

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

function chainIconSrc(network = "") {
  return network.startsWith("solana:")
    ? "/icons/wallet/chains/solana.svg"
    : "/icons/wallet/chains/base.svg";
}

function shortWalletAddress(value = ""): string {
  const text = value.trim();
  if (!text) return "No address";
  return text.length > 18 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
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

export function GuidedHivemindosModelsSetup({
  agent,
  busy,
  displayAgents = [],
  walletsByAgent,
  sharedVault,
  onComplete,
}: GuidedHivemindosModelsSetupProps) {
  const initialModel = normalizeHivemindosWalletPaidModel(agent?.model || HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL);
  const [creating, setCreating] = useState(false);
  const [personalBalancesLoading, setPersonalBalancesLoading] = useState(false);
  const [linkingWalletId, setLinkingWalletId] = useState("");
  const [message, setMessage] = useState("");
  const [personalWallets, setPersonalWallets] = useState<Array<Record<string, unknown>>>([]);
  const [selectedModel, setSelectedModel] = useState(initialModel);
  // `||` not `??`: create drafts seed fundingMode as "" (AgentSettingsModal),
  // which must fall through to the card-credits default like a missing value.
  const [fundingMode, setFundingMode] = useState<FundingMode>(
    agent?.hivemindosModels?.fundingMode || (agent?.hivemindosModels?.walletVaultId ? "wallet" : "credits"),
  );
  // Hosted model credits are one shared pool for the whole install. The
  // agent's legacy per-agent id (if any) still rides along in the GET so the
  // server can adopt pre-pool tokens into the pool on first use.
  const legacyCreditAccountId = agent?.hivemindosModels?.creditAccountId?.trim() || "";
  const [walletVaultId, setWalletVaultId] = useState(agent?.hivemindosModels?.walletVaultId ?? "");
  const [walletAddress, setWalletAddress] = useState(agent?.hivemindosModels?.walletAddress ?? "");
  const [walletNetwork, setWalletNetwork] = useState(agent?.hivemindosModels?.walletNetwork ?? "");
  const [creditState, setCreditState] = useState<ModelCreditState>({});
  const [gatewayModelOptions, setGatewayModelOptions] = useState<GatewayModelOption[]>([]);
  const [gatewayModelsLoading, setGatewayModelsLoading] = useState(true);
  const [freeMeter, setFreeMeter] = useState<FreeMeterState | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [modelSort, setModelSort] = useState<GatewayModelSort>("top");
  const [modelPage, setModelPage] = useState(0);
  // Funding modal: opened from the balance pill (gate=false) or by picking a
  // paid model while unfunded (gate=true + the pending model to apply after).
  const [fund, setFund] = useState<FundState | null>(null);
  const [fundBrowse, setFundBrowse] = useState(false);
  const [fundDone, setFundDone] = useState(false);
  const [fundedSignal, setFundedSignal] = useState(0);
  const pendingModelRef = useRef("");
  const handledFundedSignalRef = useRef(0);
  const [creditRefreshing, setCreditRefreshing] = useState(false);
  const [creditFunding, setCreditFunding] = useState(false);
  const [cardCreditAmount, setCardCreditAmount] = useState<CardCreditAmountOption>(10);
  const [customCardCreditAmount, setCustomCardCreditAmount] = useState("25");
  const [creditPaymentToken, setCreditPaymentToken] = useState("USDC");
  const [creditFundingStageIndex, setCreditFundingStageIndex] = useState(0);
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

  const mergedPersonalWallets = useMemo(
    () => mergePersonalWalletSources(personalWallets, walletsByAgent),
    [personalWallets, walletsByAgent],
  );

  const walletPickables = useMemo<PickableWallet[]>(() => {
    const isBaseCreditWallet = (wallet: Parameters<typeof isLocalPaymentSigningWallet>[0]) => (
      wallet.network === HIVEMINDOS_CREDIT_TOP_UP_NETWORK && isLocalPaymentSigningWallet(wallet)
    );
    const userPickables = groupedUserPickables(mergedPersonalWallets, { accountFilter: isBaseCreditWallet })
      .map((pickable) => ({ ...pickable, pending: personalBalancesLoading }));
    const agentPickables = displayAgents.flatMap((candidate) => {
      const pickable = agentPickable(candidate, walletsByAgent);
      if (!hasConfiguredAgentWallet(candidate as Parameters<typeof hasConfiguredAgentWallet>[0], pickable.wallet)) return [];
      if ((pickable.wallet as unknown as { setupRequired?: boolean }).setupRequired) return [];
      if (!isBaseCreditWallet(pickable.wallet)) return [];
      return [{ ...pickable, statusOverride: { tone: "ok" as const, text: "Agent wallet" } }];
    });
    return [...userPickables, ...agentPickables];
  }, [displayAgents, mergedPersonalWallets, personalBalancesLoading, walletsByAgent]);

  const selfFundingPickable = agent?.id ? resolvePickableAccount(walletPickables, agent.id) : null;
  const selfFundingAddress = !walletVaultId && selfFundingPickable?.kind === "agent" ? walletAddressForPickable(selfFundingPickable) : "";
  const effectiveWalletVaultId = walletVaultId || (selfFundingAddress ? selfFundingPickable?.id ?? "" : "");
  const effectiveWalletAddress = walletAddress || selfFundingAddress;
  const effectiveWalletNetwork = walletNetwork || (selfFundingAddress ? selfFundingPickable?.wallet.network ?? "" : "");
  const walletReady = Boolean(effectiveWalletVaultId && effectiveWalletAddress);
  const existingHivemindosModels = agent?.hivemindosModels;
  const effectiveCreditAccountId = legacyCreditAccountId || HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID;
  const creditLookupId = (fundingMode === "credits" ? effectiveCreditAccountId : effectiveWalletVaultId)
    || HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID;
  const cardFundingReady = hasFundedModelCredits(creditState, agent?.hivemindosModels);
  // The free model needs no funding. Funding lives behind the balance pill and
  // the paid-model gate: an unfunded click on a paid model opens the funding
  // modal, and a configured wallet/credit source is always reachable from the
  // pill — switching to the free model never strands it.
  const selectedModelIsFree = isFreeHivemindosWalletPaidModel(selectedModel);
  const fundingConfigured = walletReady || cardFundingReady;
  const cardCheckoutPolling = fundingMode === "credits" && cardCheckoutPollUntil > 0 && !cardFundingReady;
  const cardTopUpAmountUsd = cardCreditAmount === "custom" ? Math.round(moneyValue(customCardCreditAmount) * 100) / 100 : cardCreditAmount;
  const cardTopUpAmountValid = cardTopUpAmountUsd >= 1 && cardTopUpAmountUsd <= 500;
  const currentWalletId = effectiveWalletVaultId;
  const savedFundingPickable = effectiveWalletVaultId ? resolvePickableAccount(walletPickables, effectiveWalletVaultId) : null;
  const creditPaymentTokenOptions = creditPaymentTokenOptionsForPickable(savedFundingPickable, mergedPersonalWallets);
  const selectedCreditPaymentToken = creditPaymentTokenOptions.find((token) => token.id === creditPaymentToken)
    ?? creditPaymentTokenOptions[0]
    ?? null;
  const walletUsdcBalanceUsd = walletUsdcBalanceUsdForPickable(savedFundingPickable, mergedPersonalWallets);
  const walletUsdcBalanceLabel = savedFundingPickable?.pending
    ? "Refreshing balance"
    : walletUsdcBalanceUsd !== null
      ? formatUsd(walletUsdcBalanceUsd)
      : "—";
  const topUpUsdcShortfallUsd = walletUsdcBalanceUsd === null ? 0 : Math.max(0, cardTopUpAmountUsd - walletUsdcBalanceUsd);
  const cryptoTopUpBlockReason = walletReady && effectiveWalletNetwork !== HIVEMINDOS_CREDIT_TOP_UP_NETWORK
    ? "HivemindOS credit top-ups require a Base wallet with USDC."
    : walletReady && walletUsdcBalanceUsd !== null
      && walletUsdcBalanceUsd + 0.000001 < cardTopUpAmountUsd
      && (!selectedCreditPaymentToken || selectedCreditPaymentToken.symbol === "USDC")
      ? `This top-up needs ${formatUsd(cardTopUpAmountUsd)} USDC on Base. Selected wallet has ${formatUsd(walletUsdcBalanceUsd)} USDC.`
      : walletReady && topUpUsdcShortfallUsd > 0
        && selectedCreditPaymentToken?.symbol !== "USDC"
        && selectedCreditPaymentToken?.valueUsd !== null
        && selectedCreditPaymentToken.valueUsd + 0.000001 < topUpUsdcShortfallUsd
        ? `This top-up still needs ${formatUsd(topUpUsdcShortfallUsd)} more USDC, but ${selectedCreditPaymentToken.label} is only worth ${formatUsd(selectedCreditPaymentToken.valueUsd)}.`
      : "";
  const creditPaymentTokenHint = selectedCreditPaymentToken?.symbol !== "USDC" && topUpUsdcShortfallUsd > 0
    ? `HivemindOS will swap enough ${selectedCreditPaymentToken.label} to cover the USDC shortfall first.`
    : "Hosted x402 settlement is still paid in Base USDC.";
  const creditFundingStages = selectedCreditPaymentToken?.symbol !== "USDC" && topUpUsdcShortfallUsd > 0
    ? ["Calling wallet", "Swapping to USDC", "Checking balance", "Purchasing credits", "Refreshing credits"]
    : ["Calling wallet", "Checking balance", "Purchasing credits", "Refreshing credits"];
  const creditFundingStage = creditFundingStages[Math.min(creditFundingStageIndex, creditFundingStages.length - 1)] ?? creditFundingStages[0];
  const walletChainLabel = networkLabel(effectiveWalletNetwork);
  const walletChainIcon = chainIconSrc(effectiveWalletNetwork);
  // The panel pill is the hosted model-credit balance only. Wallet balances are
  // shown in the wallet funding badge inside the modal.
  const cachedCreditBalanceUsd = moneyValue(agent?.hivemindosModels?.lastCreditBalanceUsd)
    || moneyValue(agent?.hivemindosModels?.lastCreditBalanceLabel);
  const creditBalanceForPill = modelCreditBalanceUsd(creditState) ?? cachedCreditBalanceUsd;
  const modelCreditPillBalanceUsd = Math.max(0, creditBalanceForPill);
  const modelCreditPillFunded = modelCreditPillBalanceUsd > 0;
  const creditBalanceSummaryLabel = creditRefreshing && creditState.balanceUsd == null
    ? "Checking credits"
    : typeof creditState.balanceUsd === "number"
      ? formatUsd(creditState.balanceUsd)
      : creditState.configured === false
        ? formatUsd(0)
        : agent?.hivemindosModels?.lastCreditBalanceLabel
          || (creditBalanceForPill > 0 ? formatUsd(creditBalanceForPill) : "—");
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

  const topUpAmountSelector = (
    <>
      <div className={styles.cardAmounts} role="group" aria-label="Credit amount">
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
    </>
  );

  const profilePatch = useCallback((config: Partial<HivemindosModelsAgentConfig> = {}, model = selectedModel): Partial<AgentProfile> => {
    const existingConfig = existingHivemindosModels ?? {};
    const nextFundingMode = config.fundingMode ?? fundingMode;
    const nextCreditAccountId = config.creditAccountId ?? existingConfig.creditAccountId ?? (nextFundingMode === "credits" ? effectiveCreditAccountId : "");
    const nextWalletVaultId = config.walletVaultId ?? effectiveWalletVaultId;
    const nextWalletAddress = config.walletAddress ?? effectiveWalletAddress;
    const nextWalletNetwork = config.walletNetwork ?? effectiveWalletNetwork;
    const nextConfig = { ...existingConfig, ...config };
    const nextCardFundingReady = hasFundedModelCredits(creditStateRef.current, nextConfig);
    const nextModel = normalizeHivemindosWalletPaidModel(model);
    const nextModelIsFree = isFreeHivemindosWalletPaidModel(nextModel);
    const isReady = nextModelIsFree || (nextFundingMode === "credits"
      ? Boolean(nextCreditAccountId && nextCardFundingReady)
      : Boolean(nextWalletVaultId && nextWalletAddress));
    const now = new Date().toISOString();
    return {
      provider: HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
      model: nextModel,
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
        lastStatusMessage: nextModelIsFree
          ? "Swarm Sovereign Scout is free — no funding needed."
          : isReady
            ? nextFundingMode === "credits" ? "Hosted credits are set for HivemindOS." : "Wallet is saved for HivemindOS."
            : nextFundingMode === "credits" ? "Add card credits for HivemindOS." : "Choose or create a wallet for HivemindOS.",
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
    statusMessage = "HivemindOS credits funded.",
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
          ? "Add card credits for HivemindOS."
          : "Wallet is saved for HivemindOS.",
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

  // Free-tier usage meter: last-seen allowance recorded by the local gateway
  // proxy from real Scout calls (the hosted gateway has no query endpoint —
  // probing would spend allowance). Refreshed on mount and window focus so a
  // chat in another view updates the meter when the user returns here.
  useEffect(() => {
    let ignore = false;
    const load = () => {
      void fetch("/api/hivemindos/models/free-allowance", { cache: "no-store" })
        .then((response) => response.json().catch(() => null))
        .then((data: { ok?: boolean; allowance?: FreeAllowanceSnapshot | null } | null) => {
          if (!ignore && data?.ok) setFreeMeter(deriveFreeMeter(data.allowance ?? null, Date.now()));
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      ignore = true;
      window.removeEventListener("focus", load);
    };
  }, []);

  // Live model catalog from the local gateway route: static routes plus any
  // models the hosted gateway advertises.
  useEffect(() => {
    let ignore = false;
    void fetch("/api/hivemindos/models/models", { cache: "no-store" })
      .then((response) => response.json().catch(() => null))
      .then((data: { data?: Array<{ id?: string; display_name?: string; metadata?: { subtitle?: string; group?: string; badge?: string; trust?: string; created?: number; promptUsdPerToken?: number; completionUsdPerToken?: number } }> } | null) => {
        if (ignore) return;
        const rows = Array.isArray(data?.data) ? data.data : [];
        const options = rows.flatMap((row): GatewayModelOption[] => {
          const id = String(row?.id || "").trim();
          if (!id) return [];
          return [{
            id,
            name: String(row?.display_name || id),
            subtitle: row?.metadata?.subtitle,
            group: row?.metadata?.group,
            badge: row?.metadata?.badge,
            trust: row?.metadata?.trust === "confidential-verified" ? "confidential-verified" : undefined,
            created: typeof row?.metadata?.created === "number" ? row.metadata.created : undefined,
            promptUsdPerToken: typeof row?.metadata?.promptUsdPerToken === "number" ? row.metadata.promptUsdPerToken : undefined,
            completionUsdPerToken: typeof row?.metadata?.completionUsdPerToken === "number" ? row.metadata.completionUsdPerToken : undefined,
          }];
        });
        if (options.length) setGatewayModelOptions(options);
      })
      .catch(() => undefined)
      .finally(() => { if (!ignore) setGatewayModelsLoading(false); });
    return () => { ignore = true; };
  }, []);

  const freeModelOption = HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS.find((option) => option.tier === "free");
  const staticCatalogModels = HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS
    .filter((option) => option.tier !== "free")
    .sort((a, b) => Number(isComputeFirstHivemindosModel(b.id)) - Number(isComputeFirstHivemindosModel(a.id)));
  const hiveComputeMarketplaceModels = gatewayModelOptions.filter((option) => isHiveComputeHostedModelId(option.id));
  const gatewayCustomModels = gatewayModelOptions.filter((option) => isCustomHivemindosWalletPaidModel(option.id));
  const trimmedModelQuery = modelQuery.trim().toLowerCase();
  const matchesModelQuery = (option: PaidModelChipOption) => (
    !trimmedModelQuery
    || `${option.name} ${option.subtitle ?? ""} ${option.trust === "confidential-verified" ? "confidential verified hardware attested" : ""} ${option.upstreamModel ?? upstreamHivemindosWalletPaidModel(option.id)}`.toLowerCase().includes(trimmedModelQuery)
  );
  const matchingRouteModels = staticCatalogModels.filter((option) => isComputeFirstHivemindosModel(option.id)).filter(matchesModelQuery);
  const matchingComputeMarketplaceModels = hiveComputeMarketplaceModels.filter(matchesModelQuery);
  const matchingFallbackStaticModels = staticCatalogModels.filter((option) => !isComputeFirstHivemindosModel(option.id)).filter(matchesModelQuery);
  const matchingGatewayModels = sortGatewayModels(gatewayCustomModels.filter(matchesModelQuery), modelSort);
  const matchingAllModels = pinConfidentialVerifiedFirst([...matchingRouteModels, ...matchingComputeMarketplaceModels, ...matchingFallbackStaticModels, ...matchingGatewayModels]);
  const confidentialModelCount = matchingAllModels.filter(isConfidentialVerifiedModel).length;
  const allModelCount = staticCatalogModels.length + hiveComputeMarketplaceModels.length + gatewayCustomModels.length;
  const allPageCount = Math.max(1, Math.ceil(matchingAllModels.length / GATEWAY_MODELS_PAGE_SIZE));
  const allModelPage = Math.min(modelPage, allPageCount - 1);
  const visibleAllModels = matchingAllModels.slice(allModelPage * GATEWAY_MODELS_PAGE_SIZE, allModelPage * GATEWAY_MODELS_PAGE_SIZE + GATEWAY_MODELS_PAGE_SIZE);
  const renderPaidModelChip = (
    option: PaidModelChipOption,
    options: { fallbackIcon?: LucideIcon; sale?: boolean; showUpstream?: boolean; needTitle?: string } = {},
  ) => {
    const { fallbackIcon, sale, showUpstream, needTitle = "Requires credits" } = options;
    const TierIcon = fallbackIcon ? (TIER_CHIP_ICONS[option.id] ?? fallbackIcon) : null;
    const subtitle = showUpstream && option.upstreamModel
      ? <>{option.subtitle} · <span className={styles.mono}>{option.upstreamModel}</span></>
      : option.subtitle || upstreamHivemindosWalletPaidModel(option.id);
    return (
      <button
        key={option.id} type="button" className={styles.chip}
        data-active={selectedModel === option.id || undefined} data-sale={sale || undefined}
        data-confidential-verified={option.trust === "confidential-verified" || undefined}
        aria-pressed={selectedModel === option.id} onClick={() => pickModel(option.id, "paid")}
        title={option.trust === "confidential-verified" ? "Fresh hardware attestation verified by HivemindOS. Generated output is encrypted to the renter." : undefined}
      >
        <span className={styles.chipName}>
          {TierIcon ? <TierIcon aria-hidden="true" /> : null}{option.name}
          {option.trust === "confidential-verified" ? <span className={styles.chipBadge}><ShieldCheck aria-hidden="true" />Confidential verified</span> : null}
          {sale && option.badge ? <span className={styles.chipBadge}>{option.badge}</span> : null}
        </span>
        <span className={styles.chipSub}>{subtitle}</span>
        {!fundingConfigured ? <span className={styles.chipNeed} title={needTitle}><Coins aria-hidden="true" /></span> : null}
      </button>
    );
  };
  useEffect(() => {
    if (!creditFunding || fundingMode !== "wallet") return undefined;
    const intervalId = window.setInterval(() => {
      setCreditFundingStageIndex((index) => Math.min(index + 1, creditFundingStages.length - 1));
    }, 2600);
    return () => window.clearInterval(intervalId);
  }, [creditFunding, creditFundingStages.length, fundingMode]);
  const modelDisplayName = useCallback((modelId: string): string => {
    const staticOption = HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS.find((option) => option.id === modelId);
    if (staticOption) return staticOption.name;
    const gatewayOption = gatewayModelOptions.find((option) => option.id === modelId);
    if (gatewayOption) return gatewayOption.name;
    return upstreamHivemindosWalletPaidModel(modelId);
  }, [gatewayModelOptions]);

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
            setMessage("HivemindOS credits funded.");
            setFundedSignal((signal) => signal + 1);
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

  const applyModel = useCallback(async (model: string) => {
    const normalized = normalizeHivemindosWalletPaidModel(model);
    setSelectedModel(normalized);
    setMessage("");
    try {
      await onComplete(profilePatch({}, normalized));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update HivemindOS settings.");
    }
  }, [onComplete, profilePatch]);

  // Picking a paid model while unfunded opens the funding modal as a gate; the
  // pending model applies automatically the moment funding lands.
  function pickModel(modelId: string, tier: "free" | "paid") {
    if (tier === "free" || fundingConfigured) {
      void applyModel(modelId);
      return;
    }
    pendingModelRef.current = modelId;
    setFundDone(false);
    setFundBrowse(false);
    setFund({ gate: true, pendingModel: modelId });
  }

  function openFundingModal() {
    pendingModelRef.current = "";
    setFundDone(false);
    setFundBrowse(false);
    setFund({ gate: false, pendingModel: "" });
  }

  const closeFundingModal = useCallback(() => {
    pendingModelRef.current = "";
    setFund(null);
    setFundBrowse(false);
  }, []);

  // Funding success (card credits landed, crypto deposit confirmed, or a wallet
  // was created/linked): show the done beat and apply any gated pending model.
  useEffect(() => {
    if (!fundedSignal || handledFundedSignalRef.current === fundedSignal) return;
    handledFundedSignalRef.current = fundedSignal;
    setFundDone(true);
    const pending = pendingModelRef.current;
    if (pending) {
      pendingModelRef.current = "";
      setFund((current) => (current ? { ...current, pendingModel: "" } : current));
      void applyModel(pending);
    }
  }, [fundedSignal, applyModel]);

  useEffect(() => {
    if (!fund) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeFundingModal();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [fund, closeFundingModal]);

  async function selectFundingMode(mode: FundingMode) {
    setFundingMode(mode);
    setMessage("");
    try {
      await onComplete(profilePatch({
        fundingMode: mode,
        ...(mode === "credits" ? { creditAccountId: effectiveCreditAccountId } : {}),
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update HivemindOS funding.");
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
      setFundBrowse(false);
      setFundingMode("wallet");
      const patch = profilePatch({
        fundingMode: "wallet",
        walletVaultId: data.wallet.vaultId,
        walletAddress: data.wallet.address,
        walletNetwork: data.wallet.network,
        fundingWalletKind: data.wallet.kind ?? "agent",
        fundingWalletLabel: "This agent wallet",
        lastTestStatus: "ready",
        lastStatusMessage: "Funding wallet ready.",
      });
      await onComplete(patch);
      setMessage("Funding wallet ready.");
      setFundedSignal((signal) => signal + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "HivemindOS wallet creation failed.");
    } finally {
      setCreating(false);
    }
  }

  function openWalletBrowser() {
    setMessage("");
    setFundBrowse(true);
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
      setFundBrowse(false);
      setFundingMode("wallet");
      await onComplete(profilePatch({
        fundingMode: "wallet",
        walletVaultId: data.wallet.vaultId,
        walletAddress: data.wallet.address,
        walletNetwork: data.wallet.network,
        fundingWalletKind: data.wallet.kind ?? fundingKindForPickable(pickable),
        fundingWalletLabel: pickable.name,
        lastTestStatus: "ready",
        lastStatusMessage: "Funding wallet ready.",
      }));
      setMessage("Funding wallet ready.");
      setFundedSignal((signal) => signal + 1);
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
        setMessage("HivemindOS credits funded.");
        setFundedSignal((signal) => signal + 1);
      }
    } catch (error) {
      setCreditState({ ok: false, error: error instanceof Error ? error.message : "Could not read model credits." });
    } finally {
      setCreditRefreshing(false);
    }
  }

  async function topUpModelCredits() {
    if (!effectiveWalletVaultId) return;
    if (!cardTopUpAmountValid) {
      setMessage("Choose a credit amount from $1 to $500.");
      return;
    }
    if (cryptoTopUpBlockReason) {
      setCreditState((current) => ({ ...current, ok: false, error: cryptoTopUpBlockReason }));
      setMessage(cryptoTopUpBlockReason);
      return;
    }
    setCreditFundingStageIndex(0);
    setCreditFunding(true);
    setMessage("");
    try {
      const response = await fetch("/api/hivemindos/models/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "crypto",
          walletVaultId: effectiveWalletVaultId,
          amountUsd: cardTopUpAmountUsd,
          paymentToken: selectedCreditPaymentToken?.id ?? "USDC",
          confirmation: HIVEMINDOS_MODEL_CREDIT_TOP_UP_CONFIRMATION,
        }),
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
        lastStatusMessage: data.message || "HivemindOS credits funded.",
      }));
      setMessage(data.message || "HivemindOS credits funded.");
      if (moneyValue(data.balanceUsd) > 0 || moneyValue(data.balanceLabel) > 0) {
        setFundedSignal((signal) => signal + 1);
      }
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

  return (
    <div className={styles.root}>
      <div className={styles.body}>
        <section className={styles.panelBody}>
          <div className={styles.modelHead}>
            <span className={styles.modelHeadLabel}>Model · <b>HivemindOS</b></span>
            <button
              type="button"
              className={styles.balancePill}
              data-funded={modelCreditPillFunded || undefined}
              title={modelCreditPillFunded ? "Manage model credits" : "Add model credits"}
              onClick={openFundingModal}
            >
              {modelCreditPillFunded ? <span className={styles.balanceDot} /> : <Coins aria-hidden="true" />}
              <span className={styles.balanceAmt}>{formatUsd(modelCreditPillBalanceUsd)}</span>
              <span className={styles.balanceCar}><ChevronRight aria-hidden="true" /></span>
            </button>
          </div>

          {freeModelOption ? (
            <button
              type="button"
              className={styles.freeHero}
              data-active={selectedModelIsFree || undefined}
              aria-pressed={selectedModelIsFree}
              onClick={() => pickModel(freeModelOption.id, "free")}
            >
              <span className={styles.freeHex}><Bot aria-hidden="true" /></span>
              <span style={{ minWidth: 0 }}>
                <span className={styles.freeName}>{freeModelOption.name}<span className={styles.freeBadge}>Free</span></span>
                <span className={styles.freeSub}>{freeModelOption.subtitle}</span>
                {freeMeter ? (
                  <span
                    className={styles.freeMeter}
                    data-exhausted={freeMeter.exhausted || undefined}
                  >
                    <span
                      className={styles.freeMeterBar}
                      role="img"
                      aria-label={`Free allowance: ${freeMeter.label}`}
                    >
                      <span
                        className={styles.freeMeterFill}
                        style={{ width: `${Math.round(freeMeter.fraction * 100)}%` }}
                      />
                    </span>
                    <span className={styles.freeMeterLabel}>{freeMeter.label}</span>
                  </span>
                ) : null}
              </span>
              <span className={styles.freeCheck}><Check aria-hidden="true" /></span>
            </button>
          ) : null}

          <div className={styles.subhead}>
            All models{allModelCount ? <span className={styles.subheadTag}>· {allModelCount} available</span> : null}
            {confidentialModelCount ? <span className={styles.subheadTag}>· {confidentialModelCount} confidential verified</span> : null}
            <span className={styles.subheadSpacer} />
            {gatewayCustomModels.length ? (
              <span className={styles.sortRow} role="group" aria-label="Sort models">
                {GATEWAY_MODEL_SORTS.map((sort) => (
                  <button
                    key={sort.id}
                    type="button"
                    className={styles.sortPill}
                    data-active={modelSort === sort.id || undefined}
                    aria-pressed={modelSort === sort.id}
                    onClick={() => {
                      setModelSort(sort.id);
                      setModelPage(0);
                    }}
                  >
                    {sort.label}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
          <div className={styles.searchBox}>
            <Search aria-hidden="true" />
            <input
              value={modelQuery}
              onChange={(event) => {
                setModelQuery(event.target.value);
                setModelPage(0);
              }}
              placeholder="Search models"
              aria-label="Search models"
            />
          </div>
          <div className={styles.chipGrid}>
            {visibleAllModels.map((option) => {
              const computeFirst = isComputeFirstHivemindosModel(option.id);
              const computeHosted = isHiveComputeHostedModelId(option.id);
              const customGatewayModel = isCustomHivemindosWalletPaidModel(option.id);
              return renderPaidModelChip(option, {
                fallbackIcon: customGatewayModel ? undefined : computeFirst || computeHosted ? Zap : Network,
                sale: computeFirst || computeHosted,
                showUpstream: !customGatewayModel && !computeHosted,
                needTitle: computeHosted ? "Requires credits for Hive Compute" : computeFirst ? "Requires credits for fallback" : "Requires credits",
              });
            })}
            {gatewayModelsLoading ? (
              <p className={styles.loadingLine} role="status" aria-label="Loading gateway models">
                <LoaderCircle className={styles.spin} aria-hidden="true" />Loading gateway models
              </p>
            ) : null}
            {!matchingAllModels.length && !gatewayModelsLoading ? (
              <p className={styles.muted} style={{ gridColumn: "1 / -1" }}>
                {trimmedModelQuery ? `No models match “${modelQuery.trim()}”.` : "No models are available yet."}
              </p>
            ) : null}
          </div>

          {matchingAllModels.length > GATEWAY_MODELS_PAGE_SIZE ? (
            <div className={styles.pagerRow}>
              <button
                type="button"
                className={styles.pagerBtn}
                disabled={allModelPage === 0}
                aria-label="Previous models page"
                onClick={() => setModelPage(Math.max(0, allModelPage - 1))}
              >
                <ChevronRight aria-hidden="true" style={{ transform: "rotate(180deg)" }} />
              </button>
              <span className={styles.pagerLabel}>
                {allModelPage * GATEWAY_MODELS_PAGE_SIZE + 1}–{Math.min((allModelPage + 1) * GATEWAY_MODELS_PAGE_SIZE, matchingAllModels.length)} of {matchingAllModels.length}
              </span>
              <button
                type="button"
                className={styles.pagerBtn}
                disabled={allModelPage >= allPageCount - 1}
                aria-label="Next models page"
                onClick={() => setModelPage(Math.min(allPageCount - 1, allModelPage + 1))}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {!fundingConfigured ? (
            <div className={styles.note}><Coins aria-hidden="true" />Scout stays free. Paid models unlock once you add credits.</div>
          ) : null}

          {message ? <div className={styles.msg}>{message}</div> : null}
        </section>
      </div>

      {fund ? (
        <div
          className={styles.fundOverlay}
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeFundingModal(); }}
        >
          <section className={styles.fundModal} role="dialog" aria-modal="true" aria-label="Fund HivemindOS">
            <div className={styles.fundHead}>
              <span className={styles.fundTile}><Wallet aria-hidden="true" /></span>
              <div className={styles.fundHeadText}>
                <h3>Fund HivemindOS</h3>
                <p>Credits pay per-request across every wallet-paid route and model.</p>
              </div>
              <button type="button" className={styles.closeButton} onClick={closeFundingModal} aria-label="Close funding">
                <X aria-hidden="true" />
              </button>
            </div>

            <div className={styles.fundBody}>
              {fundDone ? (
                <div className={styles.fundDone}>
                  <span className={styles.doneMark}><Check aria-hidden="true" /></span>
                  <h4>{cardFundingReady ? "Credits added" : "Wallet ready"}</h4>
                  <p>{message || "Wallet-paid routes and models are unlocked for this agent."}</p>
                </div>
              ) : fundBrowse ? (
                <WalletSelectPanel
                  pickables={walletPickables}
                  getSurvivalSnapshot={getSurvivalSnapshot}
                  currentId={currentWalletId}
                  onConfirm={linkSelectedWallet}
                  onCancel={() => setFundBrowse(false)}
                  title="Link a funding wallet"
                  subtitle="Pick one of your local wallets or a configured agent wallet. Balances match the Wallets and Trade views."
                  confirmLabel={linkingWalletId ? "Linking wallet" : "Use for LLM calls"}
                  cancelLabel="Back"
                  confirmDisabled={isBusy}
                  emptyCopy={personalBalancesLoading ? "Loading local wallets..." : "No local signing wallets were found."}
                  panelClassName={styles.walletSelectorEmbed}
                />
              ) : (
                <>
                  {fund.gate ? (
                    <div className={styles.gateBanner}>
                      <span className={styles.gateIcon}><Coins aria-hidden="true" /></span>
                      <span className={styles.gateText}>
                        <b>{fund.pendingModel ? `${modelDisplayName(fund.pendingModel)} requires credits to use.` : "This model requires credits to use."}</b> Fund now to continue.
                      </span>
                    </div>
                  ) : null}

                  <div className={styles.creditBalanceRow}>
                    <span className={styles.creditBalanceIcon}><Coins aria-hidden="true" /></span>
                    <div className={styles.creditText}>
                      <span className={styles.fieldLabel}>Credit Balance</span>
                      <strong>{creditBalanceSummaryLabel}</strong>
                      <span>{modelCreditHelp}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.creditBalanceRefresh}
                      disabled={creditRefreshing || creditFunding}
                      aria-label="Refresh HivemindOS credits"
                      onClick={() => void refreshModelCredits()}
                    >
                      <RefreshCcw className={creditRefreshing ? styles.spin : ""} aria-hidden="true" />
                    </button>
                  </div>

                  <div className={styles.fundingDivider} role="separator" aria-label="Add credits">
                    <span>Add credits</span>
                  </div>

                  <div
                    className={styles.fundingModes}
                    data-mode={fundingMode}
                    role="group"
                    aria-label="HivemindOS funding method"
                  >
                    <button
                      type="button"
                      className={styles.fundingMode}
                      data-active={fundingMode === "credits" || undefined}
                      aria-pressed={fundingMode === "credits"}
                      onClick={() => void selectFundingMode("credits")}
                    >
                      <CreditCard aria-hidden="true" />
                      Card
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
                    <div className={styles.creditBox}>
                      {topUpAmountSelector}
                      <div className={styles.creditActions}>
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
                  ) : walletReady ? (
                    <div className={styles.walletFundingLayout}>
                      {topUpAmountSelector}
                      <button
                        type="button"
                        className={styles.walletSourceCard}
                        disabled={isBusy}
                        onClick={openWalletBrowser}
                        aria-label={`Change ${walletChainLabel} funding wallet`}
                      >
                        <span className={styles.walletSourceIcon}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={walletChainIcon} alt="" aria-hidden="true" />
                        </span>
                        <span className={styles.walletSourceMain}>
                          <span className={styles.fieldLabel}>Funding wallet</span>
                          <strong>{walletChainLabel} wallet</strong>
                          <span>{shortWalletAddress(effectiveWalletAddress)}</span>
                        </span>
                        <span className={styles.walletSourceBalance}>
                          <span>USDC available</span>
                          <strong>{walletUsdcBalanceLabel}</strong>
                        </span>
                      </button>
                      {cryptoTopUpBlockReason ? (
                        <p className={styles.walletFundingHint} data-tone="warn">{cryptoTopUpBlockReason}</p>
                      ) : null}
                      {creditPaymentTokenOptions.length ? (
                        <label className={styles.paymentTokenRow}>
                          <span>Pay with</span>
                          <select
                            value={selectedCreditPaymentToken?.id ?? creditPaymentToken}
                            onChange={(event) => setCreditPaymentToken(event.target.value)}
                            disabled={isBusy || creditFunding}
                          >
                            {creditPaymentTokenOptions.map((token) => (
                              <option key={token.id} value={token.id}>
                                {token.label} · {formatTokenAmount(token.balance)}
                                {token.valueUsd !== null ? ` · ${formatUsd(token.valueUsd)}` : ""}
                              </option>
                            ))}
                          </select>
                          <small>{creditPaymentTokenHint}</small>
                        </label>
                      ) : null}
                      {creditFunding ? (
                        <div className={styles.fundingProgress} role="status" aria-live="polite">
                          <span className={styles.fundingProgressDot} aria-hidden="true" />
                          <span>{creditFundingStage}</span>
                          <span className={styles.fundingProgressBar} aria-hidden="true" />
                        </div>
                      ) : null}
                      <div className={styles.creditActions}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.primary}`}
                          disabled={isBusy || creditRefreshing || creditFunding || !cardTopUpAmountValid || Boolean(cryptoTopUpBlockReason)}
                          onClick={() => void topUpModelCredits()}
                        >
                          {creditFunding ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Plus aria-hidden="true" />}
                          Fund with crypto
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.creditBox}>
                      <div className={styles.creditMain}>
                        <span className={styles.creditIcon}><Wallet aria-hidden="true" /></span>
                        <div className={styles.creditText}>
                          <span className={styles.fieldLabel}>Crypto wallet</span>
                          <strong>Pay with USDC</strong>
                          <span>Create a fresh Base wallet for this agent, or link a local wallet HivemindOS already holds.</span>
                        </div>
                      </div>
                      <div className={styles.creditActions}>
                        <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={isBusy} onClick={() => void createWallet()}>
                          {creating ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Plus aria-hidden="true" />}
                          New wallet
                        </button>
                        <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={isBusy} onClick={openWalletBrowser}>
                          <Search aria-hidden="true" />
                          Existing wallet
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className={styles.fundFoot}>
              <span className={styles.fundFootMsg}>
                {message || (fundingMode === "credits" ? "Card top-ups are stored in your hosted HivemindOS balance." : "Wallets stay usable even if setup is canceled.")}
              </span>
              <button type="button" className={`${styles.btn} ${fundDone ? styles.primary : styles.ghost}`} onClick={closeFundingModal}>
                {fundDone ? "Done" : "Close"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
