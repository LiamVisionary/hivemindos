"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, CSSProperties, Dispatch, ElementType, SetStateAction } from "react";
import Image from "next/image";
import Link from "next/link";
import { Copy, Download as DownloadIcon, KeyRound, LockKeyhole, Plus, RefreshCcw as RefreshIcon, Send, Shuffle, WalletCards, X } from "lucide-react";
import type { AgentWalletCardProps } from "@/components/wallet/AgentWalletCard";
import type { AgentWalletCardCompactProps } from "@/components/wallet/AgentWalletCardCompact";
import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentPaymentProvider, AgentSurvivalSnapshot, AgentWalletConfig, AgentWalletTokenBalance, HoneyAgentReward } from "@/lib/types/agent-wallet";
import { resolveAgentWallet } from "@/lib/utils/agent-wallet";
import { isBaseHiveTokenLike, switchBrowserWalletToBase } from "@/lib/services/hive-staking-client";
import { createStyleClass } from "@/features/dashboard/style-classes";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { dashboardStateValue, loadDashboardStateSnapshot, saveDashboardStateValue } from "@/lib/services/dashboard-state-client";
import type { DashboardView, RuntimeUsageAnalytics, WalletActionState, WalletMoneyClawStatus, WalletVaultBackupStatus } from "@/features/dashboard/dashboard-types";
import { exportAgentWalletSecret, exportPersonalWalletGroupSecret } from "./wallet-secret-export-actions";
import { AgentWalletsChecking, PersonalWalletsChecking, WalletUsageLoading } from "./WalletPanelLoading";
import { PersonalWalletMenu } from "./PersonalWalletMenu";
import { appendFreshImportedWallets, planImportedWalletMerge } from "./personal-wallet-import-merge";
import { stakeHrefForPersonalToken, walletCustodySummary } from "./personal-stake-link";
import personalStyles from "./PersonalWallets.module.css";

type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;
type WalletStats = {
  enabled: number;
  balance: number;
  critical: number;
};
type HoneyStats = {
  totalHoney: number;
  availableHoney: number;
  legacyHive: number;
  hiveQuote: number;
  rewardPoolHive: number;
  rewardPoolRemainingHive: number;
  rewardPoolSharePercent: number;
  hivePerMillionTokens: number;
};
type PaymentProviderCopy = Record<AgentPaymentProvider, {
  label: string;
  summary: string;
  setup: string;
}>;
type IconComponent = ElementType<{
  "aria-hidden"?: boolean | "true" | "false";
  className?: string;
  height?: number;
  width?: number;
}>;
type EthereumProvider = {
  request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
};
type WalletWindow = Window & {
  ethereum?: EthereumProvider;
};
type PersonalWallet = {
  id: string;
  name: string;
  address: string;
  network: string;
  custodyMode: "local" | "watch";
  importedFrom: "generated" | "private-key" | "recovery-phrase" | "browser" | "watch";
  currentBalanceUsd: number;
  nativeBalance: number;
  tokens: AgentWalletTokenBalance[];
  portfolioVersion?: number;
  lastOnchainSyncAt: number;
  createdAt: number;
  updatedAt: number;
};
type PersonalWalletVaultInfo = {
  agentId: string;
  id?: string;
  name?: string;
  address: string;
  network: string;
  custodyMode?: "local" | "watch";
  importedFrom?: PersonalWallet["importedFrom"];
  currentBalanceUsd?: number;
  nativeBalance?: number;
  tokens?: AgentWalletTokenBalance[];
  portfolioVersion?: number;
  lastOnchainSyncAt?: number;
  createdAt?: string | number;
  updatedAt?: number;
};
type PersonalPortfolioToken = AgentWalletTokenBalance & {
  walletId: string;
  walletName: string;
};
type PersonalWalletGroup = {
  id: string;
  name: string;
  wallets: PersonalWallet[];
  tokens: PersonalPortfolioToken[];
  totalValueUsd: number;
  nativeSummary: string;
  primaryWallet: PersonalWallet;
};
type AgentWalletRow = {
  agent: AgentProfile;
  hasWallet: boolean;
  wallet: AgentWalletConfig;
};
const BANKR_RECIPIENT_STORAGE_KEY = "hivemindos.bankrRecipientAddress";
const PERSONAL_WALLET_PORTFOLIO_VERSION = 7;
const RECOVERY_PHRASE_WORD_COUNT = 12;
const RECOVERY_PHRASE_WALLET_ID_SUFFIX = /:(?:eip155-\d+|solana-[a-z0-9-]+)$/i;
const personalClass = createStyleClass(personalStyles);
function emptyRecoveryPhraseWords() {
  return Array.from({ length: RECOVERY_PHRASE_WORD_COUNT }, () => "");
}

function normalizeRecoveryPhraseWord(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function parseRecoveryPhraseWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map(normalizeRecoveryPhraseWord)
    .filter(Boolean)
    .slice(0, RECOVERY_PHRASE_WORD_COUNT);
}

function isRecoveryPhraseWalletId(id: string) {
  return id.startsWith("user:") && RECOVERY_PHRASE_WALLET_ID_SUFFIX.test(id);
}

function normalizePersonalWalletImportSource(
  id: string,
  importedFrom?: PersonalWallet["importedFrom"],
): PersonalWallet["importedFrom"] {
  return importedFrom === "recovery-phrase" || isRecoveryPhraseWalletId(id)
    ? "recovery-phrase"
    : importedFrom || "watch";
}

function personalAccountGroupId(wallet: PersonalWallet) {
  return normalizePersonalWalletImportSource(wallet.id, wallet.importedFrom) === "recovery-phrase"
    ? wallet.id.replace(RECOVERY_PHRASE_WALLET_ID_SUFFIX, "")
    : wallet.id;
}

function personalAccountName(wallet: PersonalWallet) {
  if (normalizePersonalWalletImportSource(wallet.id, wallet.importedFrom) !== "recovery-phrase") return wallet.name;
  if (wallet.name === wallet.id) return wallet.id.replace(RECOVERY_PHRASE_WALLET_ID_SUFFIX, "");
  return wallet.name.replace(/\s+(?:Base|Solana)$/i, "");
}

function shouldRefreshPersonalWalletSnapshot(wallet: PersonalWallet) {
  return wallet.lastOnchainSyncAt <= 0 || (wallet.portfolioVersion ?? 0) < PERSONAL_WALLET_PORTFOLIO_VERSION;
}

type WalletPanelProps = {
  AGENT_PAYMENT_PROVIDER_COPY: PaymentProviderCopy;
  AgentWalletCard: ComponentType<AgentWalletCardProps>;
  AgentWalletCardCompact: ComponentType<AgentWalletCardCompactProps>;
  Button: ElementType;
  ChevronLeft: IconComponent;
  Download: IconComponent;
  HandCoins: IconComponent;
  LoaderCircle: IconComponent;
  RUNTIME_LABELS: Record<string, string>;
  RefreshCcw: IconComponent;
  activeView: DashboardView;
  copyPaymentPrompt: (wallet: AgentWalletConfig) => void | Promise<void>;
  createDefaultAgentWallet: (agentId: string) => AgentWalletConfig;
  createLocalWallet: (agentId: string, network: string) => void | Promise<void>;
  displayAgents: AgentProfile[];
  claimAllHoneyToBankrHive: (recipientAddress?: string) => Promise<{ ok: boolean; error?: string; txHash?: string; amount?: number; recipientAddress?: string }>;
  enableHoneyLedger: () => void;
  exportWalletSecrets: (input: { agentIds: string[]; label: string; filename?: string }) => Promise<{ ok?: boolean; error?: string; exportedCount?: number; label?: string }>;
  formatHiveAmount: (amount: number) => string;
  formatRelativeTime: (timestamp: number) => string;
  getSurvivalSnapshot: (wallet: AgentWalletConfig) => AgentSurvivalSnapshot;
  honeyLedgerEnabled: boolean;
  honeyStats: HoneyStats;
  hydrated: boolean;
  initializeCoreWalletRails: (agentId: string) => Promise<void>;
  moneyClawStatusByEnvName: Record<string, WalletMoneyClawStatus | null | undefined>;
  refreshRuntimeUsage: () => void | Promise<void>;
  refreshRuntimeIntegrations: (agent?: AgentProfile | null) => void | Promise<void>;
  refreshWalletBalance: (agentId: string) => void | Promise<void>;
  renderAgentKey: (agent: AgentProfile, index: number) => string;
  resetWalletBurnClock: (agentId: string) => void;
  returnAllHiveToHoney: () => void | Promise<void>;
  runWalletVaultBackupAction: (action: "refresh" | "restore") => void | Promise<void>;
  runtimeUsage: RuntimeUsageAnalytics | null | undefined;
  runtimeUsageLoading: boolean;
  saveMoneyClawKey: (agentId: string, apiKey: string, options: { shareWithAllAgents: boolean }) => Promise<{ ok: boolean; error?: string }>;
  selectedAgent: AgentProfile | null;
  selectedHoneyReward: HoneyAgentReward | null;
  selectedWallet: AgentWalletConfig | null;
  selectedWalletSnapshot: AgentSurvivalSnapshot | null;
  sharedVault: SharedVaultConfig;
  sendWalletUsdc: (agentId: string) => void | Promise<void>;
  setSelectedAgentId: Dispatch<SetStateAction<string>>;
  setWalletExpanded: Dispatch<SetStateAction<boolean>>;
  setWalletPanelMode: Dispatch<SetStateAction<"wallets" | "usage">>;
  testX402Fetch: (agentId: string) => void | Promise<void>;
  updateAgentProfile: (agentId: string, patch: Partial<AgentProfile>) => void;
  updateWallet: (agentId: string, patch: Partial<AgentWalletConfig>) => void;
  updateWalletAction: (agentId: string, patch: WalletActionState) => void;
  vaultClass: ClassNameBuilder;
  walletActionsByAgent: Record<string, WalletActionState | undefined>;
  walletClass: ClassNameBuilder;
  walletExpanded: boolean;
  walletPanelMode: "wallets" | "usage";
  walletStats: WalletStats;
  walletVaultBackupBusy: boolean;
  walletVaultBackupMessage: string;
  walletVaultBackupStatus: WalletVaultBackupStatus | null | undefined;
  walletsByAgent: Record<string, AgentWalletConfig | undefined>;
};

function createPersonalWalletId() {
  return `user:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function networkLabel(network: string) {
  switch (network) {
    case "eip155:8453": return "Base";
    case "eip155:84532": return "Base Sepolia";
    case "solana:mainnet": return "Solana";
    case "solana:devnet": return "Solana devnet";
    default: return network;
  }
}

function nativeSymbol(network: string) {
  return network.startsWith("solana:") ? "SOL" : "ETH";
}

function formatMoney(value: number) {
  return `$${Math.max(0, value || 0).toFixed(2)}`;
}

function formatToken(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: value >= 1 ? 4 : 8 });
}

function isLikelySpamPortfolioToken(token: Pick<AgentWalletTokenBalance, "symbol" | "name">) {
  const text = `${token.symbol ?? ""} ${token.name ?? ""}`.toLowerCase();
  if (!text.trim()) return false;
  return [
    /\bvisit\s+to\s+claim\b/,
    /\bclaim\s+(?:on|at|now|your)\b/,
    /\bairdrop\b/,
    /\bt\.me\/\S+/,
    /\btelegram\b/,
    /\bdiscord\.gg\b/,
    /\bbit\.ly\b/,
    /\bswap-[a-z0-9.-]+/,
    /\b(?:https?:\/\/|www\.)\S+/,
    /\.(?:com|org|net|xyz|io|app|top|site|click|lol|vip)\b/,
    /✅/,
  ].some((pattern) => pattern.test(text));
}

function hashTokenSeed(seed: string) {
  let hash = 0;
  for (const character of seed) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

type TokenIconStyle = CSSProperties & {
  "--token-accent-a"?: string;
  "--token-accent-b"?: string;
  "--token-accent-c"?: string;
};

function tokenIconFallbackStyle(token: Pick<AgentWalletTokenBalance, "symbol" | "name" | "network" | "tokenAddress">): TokenIconStyle {
  const hash = hashTokenSeed(`${token.network}:${token.tokenAddress ?? ""}:${token.symbol}:${token.name}`);
  const hue = hash % 360;
  return {
    "--token-accent-a": `hsl(${hue} 78% 62%)`,
    "--token-accent-b": `hsl(${(hue + 42) % 360} 72% 52%)`,
    "--token-accent-c": `hsl(${(hue + 196) % 360} 70% 58%)`,
  };
}

function tokenIconLabel(symbol: string) {
  const compact = symbol.replace(/[^a-z0-9]/gi, "");
  return (compact || "?").slice(0, 2).toUpperCase();
}

function chainBadgeSrc(network: string) {
  if (network.startsWith("solana:")) return "/icons/wallet/chains/solana.svg";
  if (network.startsWith("eip155:")) return "/icons/wallet/chains/base.svg";
  return "";
}

function PersonalTokenIcon({ token }: { token: PersonalPortfolioToken }) {
  const [imageFailed, setImageFailed] = useState(false);
  const iconUrl = imageFailed ? "" : token.iconUrl?.trim();
  const badgeSrc = chainBadgeSrc(token.network);
  if (iconUrl) {
    return (
      <span className={personalClass("personalTokenIconFrame")}>
        <span className={personalClass("personalTokenIcon")}>
          <Image src={iconUrl} alt="" width={44} height={44} unoptimized onError={() => setImageFailed(true)} />
        </span>
        {badgeSrc ? <Image className={personalClass("personalTokenChainBadge")} src={badgeSrc} alt="" width={16} height={16} /> : null}
      </span>
    );
  }
  return (
    <span className={personalClass("personalTokenIconFrame")}>
      <span
        aria-hidden="true"
        className={personalClass("personalTokenIcon", "personalTokenIconFallback")}
        style={tokenIconFallbackStyle(token)}
      >
        <span>{tokenIconLabel(token.symbol)}</span>
      </span>
      {badgeSrc ? <Image className={personalClass("personalTokenChainBadge")} src={badgeSrc} alt="" width={16} height={16} /> : null}
    </span>
  );
}

function shortenAddress(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function hasCreatedAgentWallet(agent: AgentProfile, wallet: AgentWalletConfig) {
  return Boolean(
    wallet.walletAddress.trim()
      || wallet.vaultAddress?.trim()
      || agent.usePod?.depositAddress?.trim()
      || agent.usePod?.depositCode?.trim()
      || agent.usePod?.dashboardUrl?.trim()
      || agent.usePod?.lastTestStatus === "ready",
  );
}

function compareAgentWalletRows(left: AgentWalletRow, right: AgentWalletRow) {
  if (left.hasWallet !== right.hasWallet) return left.hasWallet ? -1 : 1;
  return left.agent.name.localeCompare(right.agent.name, undefined, { sensitivity: "base" })
    || left.agent.id.localeCompare(right.agent.id, undefined, { sensitivity: "base" });
}

function personalWalletKey(wallet: Pick<PersonalWallet, "network" | "address">) {
  return `${wallet.network}:${wallet.address.toLowerCase()}`;
}

function timestampFromVaultDate(value: string | undefined) {
  const timestamp = value ? Date.parse(value) : 0;
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}

function personalWalletFromVaultInfo(wallet: PersonalWalletVaultInfo): PersonalWallet | null {
  if (!wallet.agentId || !wallet.address || !wallet.network) return null;
  const createdAt = typeof wallet.createdAt === "number" ? wallet.createdAt : timestampFromVaultDate(wallet.createdAt);
  return {
    id: wallet.id || wallet.agentId,
    name: wallet.name || `My ${networkLabel(wallet.network)} wallet`,
    address: wallet.address,
    network: wallet.network,
    custodyMode: wallet.custodyMode === "watch" ? "watch" : "local",
    importedFrom: normalizePersonalWalletImportSource(wallet.id || wallet.agentId, wallet.importedFrom || "private-key"),
    currentBalanceUsd: Number(wallet.currentBalanceUsd) || 0,
    nativeBalance: Number(wallet.nativeBalance) || 0,
    tokens: Array.isArray(wallet.tokens) ? wallet.tokens : [],
    portfolioVersion: Number(wallet.portfolioVersion) || 0,
    lastOnchainSyncAt: Number(wallet.lastOnchainSyncAt) || 0,
    createdAt,
    updatedAt: Number(wallet.updatedAt) || createdAt,
  };
}

export const WalletPanel = memo(WalletPanelComponent);

// Memoized (see export above) so unrelated background re-renders skip this panel.
function WalletPanelComponent(props: WalletPanelProps) {
  const { AGENT_PAYMENT_PROVIDER_COPY, AgentWalletCard, AgentWalletCardCompact, Button, ChevronLeft, Download, HandCoins, LoaderCircle, RUNTIME_LABELS, RefreshCcw, activeView, claimAllHoneyToBankrHive, copyPaymentPrompt, createLocalWallet, displayAgents, enableHoneyLedger, exportWalletSecrets, formatHiveAmount, formatRelativeTime, getSurvivalSnapshot, honeyLedgerEnabled, honeyStats, hydrated, initializeCoreWalletRails, moneyClawStatusByEnvName, refreshRuntimeIntegrations, refreshRuntimeUsage, refreshWalletBalance, renderAgentKey, resetWalletBurnClock, returnAllHiveToHoney, runWalletVaultBackupAction, runtimeUsage, runtimeUsageLoading, saveMoneyClawKey, selectedAgent, selectedHoneyReward, selectedWallet, selectedWalletSnapshot, sharedVault, sendWalletUsdc, setSelectedAgentId, setWalletExpanded, setWalletPanelMode, testX402Fetch, updateAgentProfile, updateWallet, updateWalletAction, vaultClass, walletActionsByAgent, walletClass, walletExpanded, walletPanelMode, walletStats, walletVaultBackupBusy, walletVaultBackupMessage, walletVaultBackupStatus, walletsByAgent } = props;
  const refreshedUsePodAgentIds = useRef<Set<string>>(new Set());
  const [bankrClaimBusy, setBankrClaimBusy] = useState(false);
  const [bankrConnectBusy, setBankrConnectBusy] = useState(false);
  const [bankrClaimStatus, setBankrClaimStatus] = useState("");
  const [bankrRecipientAddress, setBankrRecipientAddress] = useState("");
  const [personalWallets, setPersonalWallets] = useState<PersonalWallet[]>([]);
  const [personalWalletsChecking, setPersonalWalletsChecking] = useState(true);
  const [personalWalletActions, setPersonalWalletActions] = useState<Record<string, WalletActionState>>({});
  const [personalImportOpen, setPersonalImportOpen] = useState(false);
  const [personalImportDraft, setPersonalImportDraft] = useState({
    name: "My Base wallet",
    network: "eip155:8453",
    importKind: "private-key" as "private-key" | "recovery-phrase" | "watch",
    secret: "",
    address: "",
  });
  const [personalRecoveryWords, setPersonalRecoveryWords] = useState(() => emptyRecoveryPhraseWords());
  const [personalImportStatus, setPersonalImportStatus] = useState("");
  const [copiedAddressKey, setCopiedAddressKey] = useState("");
  const personalReimportAgentIdRef = useRef("");
  const autoRefreshPersonalWalletsRef = useRef(new Set<string>());
  const nativeDesktopRuntime = useMemo(() => isTauriDesktopRuntime(), []);
  const bankrRecipientReady = /^0x[a-fA-F0-9]{40}$/.test(bankrRecipientAddress.trim());
  const showPersonalWalletsChecking = personalWalletsChecking && activeView === "wallet" && walletPanelMode === "wallets";
  const effectiveSelectedWallet = selectedAgent && selectedWallet ? resolveAgentWallet(selectedAgent, selectedWallet) : selectedWallet;
  const effectiveSelectedWalletSnapshot = effectiveSelectedWallet ? getSurvivalSnapshot(effectiveSelectedWallet) : selectedWalletSnapshot;
  const agentWalletRows = useMemo<AgentWalletRow[]>(() => (
    displayAgents
      .map((agent) => {
        const wallet = resolveAgentWallet(agent, walletsByAgent[agent.id]);
        return {
          agent,
          hasWallet: hasCreatedAgentWallet(agent, wallet),
          wallet,
        };
      })
      .sort(compareAgentWalletRows)
  ), [displayAgents, walletsByAgent]);
  const personalWalletGroups = useMemo<PersonalWalletGroup[]>(() => {
    const groups = new Map<string, PersonalWallet[]>();
    for (const wallet of personalWallets) {
      const groupId = personalAccountGroupId(wallet);
      groups.set(groupId, [...(groups.get(groupId) ?? []), wallet]);
    }
    return [...groups.entries()].map(([id, wallets]) => {
      const tokens = wallets
        .flatMap((wallet) => wallet.tokens.map((token) => ({ ...token, walletId: wallet.id, walletName: wallet.name })))
        .filter((token) => !isLikelySpamPortfolioToken(token))
        .sort((left, right) => {
          const valueDelta = (right.valueUsd ?? -1) - (left.valueUsd ?? -1);
          if (valueDelta !== 0) return valueDelta;
          if (left.isNative !== right.isNative) return left.isNative ? -1 : 1;
          return `${left.network}:${left.symbol}`.localeCompare(`${right.network}:${right.symbol}`);
        });
      const totalValueUsd = Math.round(wallets.reduce((total, wallet) => total + wallet.currentBalanceUsd, 0) * 100) / 100;
      const nativeSummary = wallets
        .filter((wallet) => wallet.nativeBalance > 0)
        .map((wallet) => `${formatToken(wallet.nativeBalance)} ${nativeSymbol(wallet.network)}`)
        .join(" · ");
      return {
        id,
        name: personalAccountName(wallets[0]!),
        wallets,
        tokens,
        totalValueUsd,
        nativeSummary,
        primaryWallet: wallets[0]!,
      };
    });
  }, [personalWallets]);

  useEffect(() => {
    let cancelled = false;
    void loadDashboardStateSnapshot().then((snapshot) => {
      if (!cancelled) setBankrRecipientAddress(dashboardStateValue(snapshot, BANKR_RECIPIENT_STORAGE_KEY) ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeView !== "wallet" || walletPanelMode !== "wallets") return;
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) setPersonalWalletsChecking(true); });
    async function loadPersonalWalletVault() {
      const params = sharedVault.vaultPath.trim() ? `?vaultPath=${encodeURIComponent(sharedVault.vaultPath.trim())}` : "";
      const response = await fetch(`/api/wallet/personal${params}`, { headers: { accept: "application/json" } }).catch(() => null);
      const data = await response?.json().catch(() => null) as {
        ok?: boolean;
        wallets?: PersonalWalletVaultInfo[];
      } | null;
      if (cancelled) return;
      if (!response?.ok || !data?.ok || !Array.isArray(data.wallets)) return;
      const vaultWallets = data.wallets
        .map(personalWalletFromVaultInfo)
        .filter((wallet): wallet is PersonalWallet => Boolean(wallet));
      if (!vaultWallets.length) return;
      setPersonalWallets((current) => {
        const existing = new Set(current.map(personalWalletKey));
        const fresh = vaultWallets.filter((wallet) => !existing.has(personalWalletKey(wallet)));
        return fresh.length ? [...fresh, ...current] : current;
      });
    }
    void loadPersonalWalletVault().finally(() => {
      if (cancelled) return;
      setPersonalWalletsChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeView, sharedVault.vaultPath, walletPanelMode]);
  const persistPersonalWalletRecords = useCallback((wallets: PersonalWallet[]) => {
    const vaultPath = sharedVault.vaultPath.trim() || undefined;
    void fetch("/api/wallet/personal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vaultPath, wallets }),
    }).catch(() => null);
  }, [sharedVault.vaultPath]);

  async function refreshUsePodWallet(agent: AgentProfile) {
    const nextUsePod = {
      ...(agent.usePod ?? {}),
      lastTestStatus: "checking",
      lastStatusMessage: "Checking UsePod balance.",
    };
    updateAgentProfile(agent.id, { usePod: nextUsePod });
    await refreshRuntimeIntegrations({ ...agent, provider: "usepod", usePod: nextUsePod });
  }

  useEffect(() => {
    if (activeView !== "wallet" || walletPanelMode !== "wallets") return;
    for (const agent of displayAgents) {
      if (agent.provider !== "usepod" || refreshedUsePodAgentIds.current.has(agent.id)) continue;
      refreshedUsePodAgentIds.current.add(agent.id);
      void refreshRuntimeIntegrations(agent);
    }
  }, [activeView, displayAgents, refreshRuntimeIntegrations, walletPanelMode]);

  async function connectBaseWallet() {
    const provider = (window as WalletWindow).ethereum;
    if (!provider) {
      setBankrClaimStatus("No browser wallet found. Paste your Bankr receiving address instead.");
      return;
    }

    setBankrConnectBusy(true);
    setBankrClaimStatus("");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const address = accounts.find((account) => /^0x[a-fA-F0-9]{40}$/.test(account));
      if (!address) {
        setBankrClaimStatus("Wallet connected, but no EVM address was returned.");
        return;
      }

      await switchBrowserWalletToBase(provider);

      setBankrRecipientAddress(address);
      void saveDashboardStateValue(BANKR_RECIPIENT_STORAGE_KEY, address);
      setBankrClaimStatus("Base wallet connected. Ready to claim Bankr HIVE.");
    } catch (error) {
      setBankrClaimStatus(error instanceof Error ? error.message : "Could not connect wallet.");
    } finally {
      setBankrConnectBusy(false);
    }
  }

  async function claimBankrHive() {
    const recipientAddress = bankrRecipientAddress.trim();
    if (!bankrRecipientReady) {
      setBankrClaimStatus("Enter a valid Bankr EVM receiving address first.");
      return;
    }
    setBankrClaimBusy(true);
    setBankrClaimStatus("Sending Bankr HIVE transaction...");
    void saveDashboardStateValue(BANKR_RECIPIENT_STORAGE_KEY, recipientAddress);
    const result = await claimAllHoneyToBankrHive(recipientAddress);
    setBankrClaimBusy(false);
    if (!result.ok) {
      setBankrClaimStatus(result.error ?? "Bankr HIVE claim failed.");
      return;
    }
    const hash = result.txHash ? ` Tx ${result.txHash.slice(0, 10)}...${result.txHash.slice(-6)}.` : "";
    setBankrClaimStatus(`Sent ${formatHiveAmount(result.amount ?? 0)} HIVE to Bankr.${hash}`);
  }

  const updatePersonalWallet = useCallback((walletId: string, patch: Partial<PersonalWallet>) => {
    setPersonalWallets((current) => current.map((wallet) => wallet.id === walletId ? { ...wallet, ...patch, updatedAt: Date.now() } : wallet));
  }, []);

  const updatePersonalAction = useCallback((walletId: string, patch: Partial<WalletActionState>) => {
    setPersonalWalletActions((current) => ({
      ...current,
      [walletId]: { ...(current[walletId] ?? {}), ...patch },
    }));
  }, []);

  function copyPersonalAddress(wallet: Pick<PersonalWallet, "id" | "address">) {
    const key = `${wallet.id}:${wallet.address}`;
    void navigator.clipboard?.writeText(wallet.address);
    setCopiedAddressKey(key);
    window.setTimeout(() => {
      setCopiedAddressKey((current) => current === key ? "" : current);
    }, 1800);
  }

  function reimportPersonalWalletGroup(group: PersonalWalletGroup) {
    const wallet = group.wallets.find((row) => row.network === "eip155:8453") ?? group.primaryWallet;
    const recoveryGroup = group.wallets.length > 1 || normalizePersonalWalletImportSource(wallet.id, wallet.importedFrom) === "recovery-phrase";
    setPersonalImportDraft({ name: group.name, network: wallet.network, importKind: recoveryGroup ? "recovery-phrase" : "private-key", secret: "", address: "" });
    personalReimportAgentIdRef.current = recoveryGroup ? group.id : wallet.id;
    setPersonalRecoveryWords(emptyRecoveryPhraseWords());
    setPersonalImportStatus(recoveryGroup ? "Reimport the recovery phrase to restore local signer access for this account." : "Reimport the private key to restore local signer access for this wallet.");
    setPersonalImportOpen(true);
  }

  function updatePersonalImportKind(importKind: "private-key" | "recovery-phrase" | "watch") {
    setPersonalImportDraft((current) => ({ ...current, importKind, secret: "" }));
    if (importKind !== "recovery-phrase") {
      setPersonalRecoveryWords(emptyRecoveryPhraseWords());
    }
  }

  function updateRecoveryPhraseWords(startIndex: number, incomingWords: string[]) {
    setPersonalRecoveryWords((current) => {
      const next = [...current];
      incomingWords.slice(0, RECOVERY_PHRASE_WORD_COUNT - startIndex).forEach((word, offset) => {
        next[startIndex + offset] = normalizeRecoveryPhraseWord(word);
      });
      return next;
    });
  }

  function handleRecoveryPhraseInput(index: number, value: string) {
    const words = parseRecoveryPhraseWords(value);
    updateRecoveryPhraseWords(index, words.length > 1 ? words : [value]);
  }

  async function createPersonalWallet() {
    const walletId = createPersonalWalletId();
    const network = personalImportDraft.network;
    setPersonalImportStatus("Creating encrypted local wallet...");
    const response = await fetch("/api/wallet/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: walletId,
        network,
        name: personalImportDraft.name.trim() || "My wallet",
        vaultPath: sharedVault.vaultPath.trim() || undefined,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      wallet?: { address: string; network: string };
      error?: string;
    } | null;
    if (!response?.ok || !data?.ok || !data.wallet) {
      setPersonalImportStatus(data?.error ?? "Could not create wallet.");
      return;
    }
    const now = Date.now();
    setPersonalWallets((current) => [{
      id: walletId,
      name: personalImportDraft.name.trim() || "My wallet",
      address: data.wallet!.address,
      network: data.wallet!.network,
      custodyMode: "local",
      importedFrom: "generated",
      currentBalanceUsd: 0,
      nativeBalance: 0,
      tokens: [],
      portfolioVersion: 0,
      lastOnchainSyncAt: 0,
      createdAt: now,
      updatedAt: now,
    }, ...current]);
    setPersonalImportOpen(false);
    setPersonalImportStatus("Wallet created.");
  }

  async function importPersonalWallet() {
    const walletId = personalReimportAgentIdRef.current || createPersonalWalletId();
    const name = personalImportDraft.name.trim() || "My wallet";
    const network = personalImportDraft.network;
    if (personalImportDraft.importKind === "watch") {
      const address = personalImportDraft.address.trim();
      if (!address) {
        setPersonalImportStatus("Paste a public address first.");
        return;
      }
      const now = Number(new Date());
      const row: PersonalWallet = {
        id: walletId,
        name,
        address,
        network,
        custodyMode: "watch",
        importedFrom: "watch",
        currentBalanceUsd: 0,
        nativeBalance: 0,
        tokens: [],
        portfolioVersion: 0,
        lastOnchainSyncAt: 0,
        createdAt: now,
        updatedAt: now,
      };
      setPersonalWallets((current) => [row, ...current]);
      persistPersonalWalletRecords([row]);
      personalReimportAgentIdRef.current = "";
      setPersonalImportOpen(false);
      setPersonalImportStatus("View-only wallet added.");
      return;
    }

    const importSecret = personalImportDraft.importKind === "recovery-phrase"
      ? personalRecoveryWords.map((word) => word.trim()).filter(Boolean).join(" ")
      : personalImportDraft.secret;
    if (personalImportDraft.importKind === "recovery-phrase" && parseRecoveryPhraseWords(importSecret).length !== RECOVERY_PHRASE_WORD_COUNT) {
      setPersonalImportStatus("Enter all 12 recovery phrase words first.");
      return;
    }

    setPersonalImportStatus("Importing into encrypted wallet vault...");
    const response = await fetch("/api/wallet/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: walletId,
        network,
        name,
        secret: importSecret,
        importKind: personalImportDraft.importKind,
        vaultPath: sharedVault.vaultPath.trim() || undefined,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      wallet?: { agentId?: string; address: string; network: string; label?: string };
      wallets?: Array<{ agentId?: string; address: string; network: string; label?: string }>;
      importKind?: "private-key" | "recovery-phrase";
      error?: string;
    } | null;
    const importedWallets = data?.wallets?.length ? data.wallets : data?.wallet ? [data.wallet] : [];
    if (!response?.ok || !data?.ok || !importedWallets.length) {
      setPersonalImportStatus(data?.error ?? "Could not import wallet.");
      return;
    }
    const now = Number(new Date());
    const importedRows = importedWallets.map((wallet): PersonalWallet => ({
      id: wallet.agentId || walletId,
      name: importedWallets.length > 1 ? `${name} ${wallet.label || networkLabel(wallet.network)}` : name,
      address: wallet.address,
      network: wallet.network,
      custodyMode: "local",
      importedFrom: data.importKind || personalImportDraft.importKind,
      currentBalanceUsd: 0,
      nativeBalance: 0,
      tokens: [],
      portfolioVersion: 0,
      lastOnchainSyncAt: 0,
      createdAt: now,
      updatedAt: now,
    }));
    const { freshRows, upgradedRows, wallets: upgradedWallets } = planImportedWalletMerge(personalWallets, importedRows, now);
    if (!freshRows.length) {
      if (!upgradedRows.length) {
        setPersonalImportStatus(importedRows.length > 1 ? "Those recovery phrase accounts are already in My wallets." : "That wallet is already in My wallets.");
        return;
      }
      setPersonalWallets(upgradedWallets);
      upgradedRows.forEach((wallet) => void refreshPersonalWalletBalance(wallet));
      personalReimportAgentIdRef.current = "";
      setPersonalRecoveryWords(emptyRecoveryPhraseWords());
      setPersonalImportOpen(false);
      setPersonalImportStatus(importedRows.length > 1 ? "Signer access restored for the matching wallet rows." : "Signer access restored for this wallet.");
      return;
    }
    setPersonalWallets((current) => appendFreshImportedWallets(current, freshRows));
    freshRows.forEach((wallet) => void refreshPersonalWalletBalance(wallet));
    setPersonalImportDraft((current) => ({ ...current, secret: "", address: "" }));
    personalReimportAgentIdRef.current = "";
    setPersonalRecoveryWords(emptyRecoveryPhraseWords());
    setPersonalImportOpen(false);
    setPersonalImportStatus(freshRows.length > 1 ? `Imported ${freshRows.length} recovery phrase accounts. Refreshing token lists...` : "Wallet imported. Refreshing token list...");
  }

  async function connectBrowserWalletToPersonalList() {
    const provider = (window as WalletWindow).ethereum;
    if (!provider) {
      setPersonalImportStatus("No browser wallet extension was found. Use Add manually to paste a public address, import a key, or generate a wallet.");
      return;
    }
    setPersonalImportStatus("Connecting browser wallet...");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const address = accounts.find((account) => /^0x[a-fA-F0-9]{40}$/.test(account));
      if (!address) {
        setPersonalImportStatus("Wallet connected, but no EVM address was returned.");
        return;
      }
      const now = Date.now();
      setPersonalWallets((current) => [{
        id: createPersonalWalletId(),
        name: "Browser wallet",
        address,
        network: "eip155:8453",
        custodyMode: "watch",
        importedFrom: "browser",
        currentBalanceUsd: 0,
        nativeBalance: 0,
        tokens: [],
        portfolioVersion: 0,
        lastOnchainSyncAt: 0,
        createdAt: now,
        updatedAt: now,
      }, ...current]);
      setPersonalImportStatus("Browser wallet added as view-only.");
      personalReimportAgentIdRef.current = "";
      setPersonalImportOpen(false);
    } catch (error) {
      setPersonalImportStatus(error instanceof Error ? error.message : "Could not connect browser wallet.");
    }
  }

  const refreshPersonalWalletBalance = useCallback(async (wallet: PersonalWallet) => {
    updatePersonalAction(wallet.id, { busy: true, error: "", message: "Refreshing portfolio..." });
    const response = await fetch("/api/wallet/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: wallet.address, network: wallet.network }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      balance?: { tokenBalance: number; nativeBalance: number; totalValueUsd?: number | null; fetchedAt: number; tokens?: AgentWalletTokenBalance[] };
      error?: string;
    } | null;
    if (!response?.ok || !data?.ok || !data.balance) {
      updatePersonalAction(wallet.id, { busy: false, error: data?.error ?? "Could not refresh this wallet.", message: "" });
      return;
    }
    const updatedWallet = {
      ...wallet,
      currentBalanceUsd: Number(data.balance.totalValueUsd ?? data.balance.tokenBalance) || 0,
      nativeBalance: Number(data.balance.nativeBalance) || 0,
      tokens: data.balance.tokens ?? [],
      portfolioVersion: PERSONAL_WALLET_PORTFOLIO_VERSION,
      lastOnchainSyncAt: data.balance.fetchedAt,
      updatedAt: Date.now(),
    };
    updatePersonalWallet(wallet.id, updatedWallet);
    persistPersonalWalletRecords([updatedWallet]);
  const tokenCount = data.balance.tokens?.length ?? 0;
  updatePersonalAction(wallet.id, { busy: false, error: "", message: tokenCount > 2 ? `Portfolio refreshed: ${tokenCount} tokens.` : "Portfolio refreshed." });
  }, [persistPersonalWalletRecords, updatePersonalAction, updatePersonalWallet]);

  useEffect(() => {
    if (activeView !== "wallet" || walletPanelMode !== "wallets") return;
    personalWallets
      .filter((wallet) => shouldRefreshPersonalWalletSnapshot(wallet) && !autoRefreshPersonalWalletsRef.current.has(wallet.id))
      .slice(0, 4)
      .forEach((wallet) => {
        autoRefreshPersonalWalletsRef.current.add(wallet.id);
        void refreshPersonalWalletBalance(wallet);
      });
  }, [activeView, personalWallets, refreshPersonalWalletBalance, walletPanelMode]);

  return (<>
      {activeView === "wallet" ? (
      <section className={walletClass("walletPanel", "tabPanel")}>
        <div className={walletClass("walletHeader")}>
          <div>
            <p className="eyebrow">Spending safety</p>
            <h2>Wallets</h2>
            <p>
              Manage payment rails by default, with runtime usage one click away when you need the bill of materials.
            </p>
          </div>
          <div className={walletClass("walletTotals")} aria-label="Wallet summary">
            <span>
              Can spend
              <strong>{walletStats.enabled}</strong>
            </span>
            <span>
              Available
              <strong>${walletStats.balance.toFixed(2)}</strong>
            </span>
            <span>
              Need funding
              <strong>{walletStats.critical}</strong>
            </span>
          </div>
        </div>

        <div className={walletClass("walletSegmented")} role="tablist" aria-label="Wallet panel mode">
          {[
            ["wallets", "Wallets"],
            ["usage", "Usage"],
          ].map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={walletPanelMode === mode}
              className={walletClass("walletSegment", walletPanelMode === mode && "walletSegmentActive")}
              onClick={() => setWalletPanelMode(mode as "wallets" | "usage")}
            >
              {label}
            </button>
          ))}
        </div>

        {walletPanelMode === "usage" ? (
          runtimeUsageLoading ? (
            <WalletUsageLoading />
          ) : (
            <section className={walletClass("usagePanel")}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Runtime analytics</p>
                  <h3 className="m-0 text-base font-bold">Token usage</h3>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={() => void refreshRuntimeUsage()} disabled={runtimeUsageLoading}>
                  {runtimeUsageLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
                  Refresh
                </Button>
              </div>
              {runtimeUsage?.error ? <p className="m-0 text-xs text-[#fecdd3]">{runtimeUsage.error}</p> : null}
              <div className="grid gap-3 md:grid-cols-4">
                {[
                  ["Sessions", runtimeUsage?.totals?.sessions?.toLocaleString() ?? "0"],
                  ["Tokens", runtimeUsage?.totals?.tokens?.toLocaleString() ?? "0"],
                  ["Output", runtimeUsage?.totals?.outputTokens?.toLocaleString() ?? "0"],
                  ["Est. cost", `$${(runtimeUsage?.totals?.estimatedCostUsd ?? 0).toFixed(4)}`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(15,23,42,0.55)] p-3">
                    <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">{label}</span>
                    <strong className="mt-1 block text-xl">{value}</strong>
                  </div>
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <strong className="text-sm">Models</strong>
                  <div className="mt-2 grid gap-2">
                    {(runtimeUsage?.models ?? []).slice(0, 6).map((model) => (
                      <div key={model.model} className="flex items-center justify-between gap-3 rounded-md border border-[rgba(148,163,184,0.10)] px-3 py-2 text-xs">
                        <span className="min-w-0 break-words">{model.model}</span>
                        <b>{model.tokens.toLocaleString()}</b>
                      </div>
                    ))}
                    {runtimeUsage?.models?.length ? null : <p className="m-0 text-xs text-[var(--muted)]">No token rows found yet.</p>}
                  </div>
                </div>
                <div>
                  <strong className="text-sm">Recent sessions</strong>
                  <div className="mt-2 grid gap-2">
                    {(runtimeUsage?.rows ?? []).slice(0, 6).map((row) => (
                      <div key={`${row.runtime}-${row.sessionId}`} className="grid gap-1 rounded-md border border-[rgba(148,163,184,0.10)] px-3 py-2 text-xs">
                        <span className="font-semibold">{RUNTIME_LABELS[row.runtime]} · {row.model}</span>
                        <span className="text-[var(--muted)]">{row.totalTokens.toLocaleString()} tokens · {formatRelativeTime(Date.parse(row.updatedAt))}</span>
                      </div>
                    ))}
                    {runtimeUsage?.rows?.length ? null : <p className="m-0 text-xs text-[var(--muted)]">Hermes/OpenClaw usage appears here when local counters are readable.</p>}
                  </div>
                </div>
              </div>
            </section>
          )
        ) : null}

        {walletPanelMode === "wallets" ? (
        <div className={walletClass("walletWorkspace")}>
          {walletExpanded && selectedAgent && effectiveSelectedWallet && effectiveSelectedWalletSnapshot ? (
            (() => {
              const walletAction = walletActionsByAgent[selectedAgent.id] ?? {};
              const moneyClawEnvName = effectiveSelectedWallet.moneyClawEnvName?.trim() || "MONEYCLAW_API_KEY";
              return (
            <div className={walletClass("walletDetail")}>
              <button
                type="button"
                className={walletClass("walletBackBtn")}
                onClick={() => setWalletExpanded(false)}
              >
                <ChevronLeft aria-hidden="true" width={16} height={16} />
                All wallets
              </button>
              <AgentWalletCard
                agentName={selectedAgent.name}
                machineName={selectedAgent.machineName}
                agentUsePod={selectedAgent.usePod}
                wallet={effectiveSelectedWallet}
                survival={effectiveSelectedWalletSnapshot}
                honeyReward={selectedHoneyReward}
                honeyLedgerEnabled={honeyLedgerEnabled}
                providerCopy={AGENT_PAYMENT_PROVIDER_COPY[effectiveSelectedWallet.provider]}
                providerOptions={Object.entries(AGENT_PAYMENT_PROVIDER_COPY) as Array<[AgentPaymentProvider, typeof AGENT_PAYMENT_PROVIDER_COPY[AgentPaymentProvider]]>}
                moneyClawStatus={moneyClawStatusByEnvName[moneyClawEnvName] ?? null}
                walletAction={walletAction}
                onUpdateWallet={(patch) => updateWallet(selectedAgent.id, patch)}
                onUpdateAction={(patch) => updateWalletAction(selectedAgent.id, patch)}
                onSaveMoneyClawKey={(apiKey, options) => saveMoneyClawKey(selectedAgent.id, apiKey, options)}
                onUpdateUsePod={async (patch) => {
                  const nextUsePod = { ...(selectedAgent.usePod ?? {}), ...patch };
                  updateAgentProfile(selectedAgent.id, { usePod: nextUsePod });
                  await refreshRuntimeIntegrations({ ...selectedAgent, usePod: nextUsePod, provider: "usepod" });
                }}
                onResetRunway={() => resetWalletBurnClock(selectedAgent.id)}
                onCopyPaymentPrompt={() => copyPaymentPrompt(effectiveSelectedWallet)}
                onCreateLocalWallet={() => createLocalWallet(selectedAgent.id, effectiveSelectedWallet.network)}
	                onRefreshBalance={() => { void (effectiveSelectedWallet.provider === "usepod" ? refreshUsePodWallet(selectedAgent) : refreshWalletBalance(selectedAgent.id)); }}
	                onSendUsdc={() => sendWalletUsdc(selectedAgent.id)}
	                onCallX402={() => testX402Fetch(selectedAgent.id)}
	                onExportSecret={() => void exportAgentWalletSecret(selectedAgent, exportWalletSecrets, updateWalletAction)}
	              />
            </div>
              );
            })()
          ) : (
            <div className={personalClass("walletListStack")}>
              <section className={personalClass("personalWallets")} aria-label="My wallets">
                <div className={personalClass("personalWalletsHeader")}>
                  <div>
                    <p className="eyebrow">User connector</p>
                    <h3>My wallets</h3>
                    <p>Personal wallets stay above agent wallets and can quick-send to any saved user or agent address.</p>
                  </div>
                  <div className={personalClass("personalWalletActions")}>
                    <Link href="/stake" className={personalClass("personalStakeRouteLink")}><LockKeyhole aria-hidden="true" /> Stake HIVE</Link>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        personalReimportAgentIdRef.current = "";
                        setPersonalImportStatus("");
                        setPersonalImportOpen((open) => !open);
                      }}
                    >
                      {personalImportOpen ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
                      {personalImportOpen ? "Close" : "Add manually"}
                    </Button>
                    {!nativeDesktopRuntime ? (
                      <Button type="button" size="sm" variant="secondary" onClick={() => void connectBrowserWalletToPersonalList()}>
                        <WalletCards aria-hidden="true" />
                        Connect browser
                      </Button>
                    ) : null}
                  </div>
                </div>
                {personalImportStatus ? <p className={personalClass("personalConnectorStatus")}>{personalImportStatus}</p> : null}

                {personalImportOpen ? (
                  <div className={personalClass("personalImportPanel")}>
                    <div className={personalClass("personalImportGrid")}>
                      <label>
                        <span>Name</span>
                        <input
                          value={personalImportDraft.name}
                          onChange={(event) => setPersonalImportDraft((current) => ({ ...current, name: event.target.value }))}
                          placeholder="Treasury wallet"
                        />
                      </label>
                      {personalImportDraft.importKind !== "recovery-phrase" ? (
                        <label>
                          <span>Network</span>
                          <select
                            value={personalImportDraft.network}
                            onChange={(event) => setPersonalImportDraft((current) => ({ ...current, network: event.target.value }))}
                          >
                            <option value="eip155:8453">Base mainnet</option>
                            <option value="eip155:84532">Base Sepolia</option>
                            <option value="solana:mainnet">Solana mainnet</option>
                            <option value="solana:devnet">Solana devnet</option>
                          </select>
                        </label>
                      ) : null}
                      <label>
                        <span>Import</span>
                        <select
                          value={personalImportDraft.importKind}
                          onChange={(event) => updatePersonalImportKind(event.target.value as "private-key" | "recovery-phrase" | "watch")}
                        >
                          <option value="private-key">Private key (send enabled)</option>
                          <option value="recovery-phrase">Recovery phrase (send enabled)</option>
                          <option value="watch">Public address (view-only)</option>
                        </select>
                      </label>
                    </div>
                    {personalImportDraft.importKind === "watch" ? (
                      <label className={personalClass("personalImportSecret")}>
                        <span>Address</span>
                        <input
                          value={personalImportDraft.address}
                          onChange={(event) => setPersonalImportDraft((current) => ({ ...current, address: event.target.value }))}
                          placeholder={personalImportDraft.network.startsWith("solana:") ? "Solana address" : "0x..."}
                        />
                      </label>
                    ) : personalImportDraft.importKind === "recovery-phrase" ? (
                      <div className={personalClass("personalImportSecret")}>
                        <span>Recovery phrase</span>
                        <div className={personalClass("recoveryPhraseGrid")} role="group" aria-label="Recovery phrase words">
                          {personalRecoveryWords.map((word, index) => (
                            <label key={index} className={personalClass("recoveryWordField")}>
                              <span aria-hidden="true" className={personalClass("recoveryWordIndex")}>{index + 1}.</span>
                              <input
                                aria-label={`Recovery phrase word ${index + 1}`}
                                value={word}
                                onChange={(event) => handleRecoveryPhraseInput(index, event.target.value)}
                                onPaste={(event) => {
                                  const words = parseRecoveryPhraseWords(event.clipboardData.getData("text"));
                                  if (words.length > 1) {
                                    event.preventDefault();
                                    updateRecoveryPhraseWords(index, words);
                                  }
                                }}
                                autoCapitalize="none"
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                              />
                            </label>
                          ))}
                        </div>
                        <p className={personalClass("recoveryPhraseHint")}>Imports the Base and Solana mainnet accounts derived from this phrase.</p>
                      </div>
                    ) : (
                      <label className={personalClass("personalImportSecret")}>
                        <span>Private key</span>
                        <textarea
                          value={personalImportDraft.secret}
                          onChange={(event) => setPersonalImportDraft((current) => ({ ...current, secret: event.target.value }))}
                          placeholder="Encrypted locally after import"
                          spellCheck={false}
                        />
                      </label>
                    )}
                    <div className={personalClass("personalImportFooter")}>
                      <Button type="button" size="sm" onClick={() => void importPersonalWallet()}>
                        <KeyRound aria-hidden="true" />
                        {personalImportDraft.importKind === "watch" ? "Add view-only wallet" : "Import wallet"}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => void createPersonalWallet()}>
                        <Plus aria-hidden="true" />
                        Generate new
                      </Button>
                    </div>
                  </div>
                ) : null}

                {personalWalletGroups.length ? (
                  <div className={personalClass("personalWalletGrid")} role="list" aria-label="User wallets">
                    {personalWalletGroups.map((group) => {
                      const action = personalWalletActions[group.primaryWallet.id] ?? {};
                      const tokenRows = group.tokens.length ? group.tokens : group.wallets.flatMap((wallet): PersonalPortfolioToken[] => [
                        {
                          walletId: wallet.id,
                          walletName: wallet.name,
                          symbol: nativeSymbol(wallet.network),
                          name: nativeSymbol(wallet.network),
                          balance: wallet.nativeBalance,
                          network: wallet.network,
                          priceUsd: null,
                          valueUsd: null,
                          priceChange24hPct: null,
                          isNative: true,
                        },
                      ]);
                      return (
                        <article key={group.id} className={personalClass("personalWalletCard", "accountWalletCard")} role="listitem">
                          <header className={personalClass("personalWalletTop")}>
                            <div>
                              <strong>{group.name}</strong>
                              <span>{walletCustodySummary(group.wallets)}</span>
                            </div>
                            <PersonalWalletMenu
                              Button={Button}
                              copiedAddressKey={copiedAddressKey}
                              label={group.name}
                              networkLabel={networkLabel}
                              onCopyAddress={copyPersonalAddress}
                              onReimport={() => reimportPersonalWalletGroup(group)}
                              shortenAddress={shortenAddress}
                              wallets={group.wallets}
                            />
                          </header>
                          <div className={personalClass("personalWalletBalance")}>
                            <strong>{formatMoney(group.totalValueUsd)}</strong>
                            {group.nativeSummary ? <span>{group.nativeSummary}</span> : null}
                          </div>
                          <div className={personalClass("walletActionGrid")}>
                            <button type="button" onClick={() => updatePersonalAction(group.primaryWallet.id, { message: "Send flow is being tightened for multi-chain accounts." })}>
                              <Send aria-hidden="true" />
                              <span>Send</span>
                            </button>
                            <button type="button" disabled>
                              <Shuffle aria-hidden="true" />
                              <span>Swap</span>
                            </button>
                            <button type="button" onClick={() => copyPersonalAddress(group.primaryWallet)}>
                              <Copy aria-hidden="true" />
                              <span>Receive</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void exportPersonalWalletGroupSecret(group, exportWalletSecrets, updatePersonalAction)}
                              disabled={action.busy || !group.wallets.some((wallet) => wallet.custodyMode === "local")}
                            >
                              <DownloadIcon aria-hidden="true" />
                              <span>Export</span>
                            </button>
	                            <button type="button" onClick={() => void Promise.all(group.wallets.map((wallet) => refreshPersonalWalletBalance(wallet)))} disabled={action.busy}>
	                              <RefreshIcon aria-hidden="true" />
	                              <span>Refresh</span>
                            </button>
                          </div>
                          <div className={personalClass("personalTokenList")} aria-label={`${group.name} tokens`}>
                            {tokenRows.map((token) => {
                              const tokenWallet = group.wallets.find((wallet) => wallet.id === token.walletId);
                              const canStakeHive = isBaseHiveTokenLike(token);
                              return (
                                <div key={`${token.network}-${token.isNative ? "native" : token.tokenAddress || token.symbol}`} className={personalClass("personalTokenRowWrap")}>
                                  <div className={personalClass("personalTokenRow", canStakeHive && "personalTokenRowWithAction")}>
                                    <PersonalTokenIcon token={token} />
                                    <div className={personalClass("personalTokenMeta")}>
                                      <strong>{token.symbol}</strong>
                                      <span>{networkLabel(token.network)} · {formatToken(token.balance)} {token.name}</span>
                                    </div>
                                    <div className={personalClass("personalTokenValue")}>
                                      <strong>{token.valueUsd == null ? "No quote" : formatMoney(token.valueUsd)}</strong>
                                      <span data-tone={(token.priceChange24hPct ?? 0) >= 0 ? "up" : "down"}>
                                        {token.priceChange24hPct == null ? "24h --" : `${token.priceChange24hPct >= 0 ? "+" : ""}${token.priceChange24hPct.toFixed(2)}%`}
                                      </span>
                                    </div>
                                    {canStakeHive && tokenWallet ? (
                                      tokenWallet.custodyMode === "local" || !nativeDesktopRuntime ? (
                                        <Link href={stakeHrefForPersonalToken(tokenWallet, token)} className={personalClass("personalTokenStakeButton")}><LockKeyhole aria-hidden="true" /><span>Stake</span></Link>
                                      ) : (
                                        <button type="button" className={personalClass("personalTokenStakeButton")} disabled title="Import this Base wallet locally before staking in the desktop app."><LockKeyhole aria-hidden="true" /><span>View-only</span></button>
                                      )
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {action.message ? <p className={personalClass("personalWalletStatus")} data-tone="ok">{action.message}</p> : null}
                          {action.error ? <p className={personalClass("personalWalletStatus")} data-tone="error">{action.error}</p> : null}
                        </article>
                      );
                    })}
                  </div>
                ) : showPersonalWalletsChecking ? (
                  <PersonalWalletsChecking />
                ) : (
                  <div className={walletClass("walletEmpty")}>
                    <strong>No user wallets yet</strong>
                    <p>Add a personal wallet to see it before the agent wallets and use quick-send targets.</p>
                  </div>
                )}
              </section>

              <section className={personalClass("agentWalletsSection")} aria-label="Agent wallets">
                <div className={personalClass("agentWalletsHeader")}>
                  <div>
                    <p className="eyebrow">Agent wallets</p>
                    <h3>Agent spend rails</h3>
                  </div>
                </div>
                {displayAgents.length > 0 ? (
                  <div className={walletClass("walletGridList")} role="list" aria-label="Agent wallets">
                    {agentWalletRows.map(({ agent, wallet }, agentIndex) => {
                      const snapshot = getSurvivalSnapshot(wallet);
                      return (
                        <div role="listitem" data-bee={`wallet-agent-${agent.id}`} key={renderAgentKey(agent, agentIndex)}>
                          <AgentWalletCardCompact
                            agentName={agent.name}
                            agentUsePod={agent.usePod}
                            wallet={wallet}
                            survival={snapshot}
                            onOpen={() => {
                              setSelectedAgentId(agent.id);
                              setWalletExpanded(true);
                            }}
                            onInitialize={async () => {
                              setSelectedAgentId(agent.id);
                              await initializeCoreWalletRails(agent.id);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : !hydrated ? (
                  <AgentWalletsChecking />
                ) : (
                  <div className={walletClass("walletEmpty")}>
                    <strong>No agents yet</strong>
                    <p>Connect an agent first, then configure its spending limits and survival rails.</p>
                  </div>
                )}
              </section>
            </div>
          )}

          <aside className={walletClass("hiveRail", !honeyLedgerEnabled && "hiveRailDormant")} aria-label="Bankr rewards">
            <header className={walletClass("hiveRailHeader")}>
              <div>
                <p className="eyebrow">Bankr rewards</p>
                <h3>{honeyLedgerEnabled ? "Honey rewards" : "Honey rewards off"}</h3>
              </div>
              <Image
                className={walletClass("hiveRailPot")}
                src="/icons/generated/honey-pot.png"
                alt=""
                width={96}
                height={96}
                aria-hidden="true"
                priority
                unoptimized
              />
            </header>

            {honeyLedgerEnabled ? (
              <>
                <dl className={walletClass("hiveRailStats")}>
                  <div>
                    <dt>Total Honey</dt>
                    <dd>{formatHiveAmount(honeyStats.totalHoney)}</dd>
                  </div>
                  <div>
                    <dt>Ready to claim</dt>
                    <dd>{formatHiveAmount(honeyStats.availableHoney)}</dd>
                  </div>
                  <div>
                    <dt>Legacy HIVE</dt>
                    <dd>{formatHiveAmount(honeyStats.legacyHive)}</dd>
                  </div>
                </dl>

                <div className={walletClass("hiveRailRecipient")}>
                  <div className={walletClass("hiveRailRecipientHeader")}>
                    <label htmlFor="bankr-hive-recipient">Bankr receiving address</label>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void connectBaseWallet()}
                      disabled={bankrConnectBusy || bankrClaimBusy}
                    >
                      <HandCoins aria-hidden="true" />
                      {bankrConnectBusy ? "Connecting..." : "Connect Base wallet"}
                    </Button>
                  </div>
                  <input
                    id="bankr-hive-recipient"
                    type="text"
                    inputMode="text"
                    spellCheck={false}
                    value={bankrRecipientAddress}
                    onChange={(event) => {
                      setBankrRecipientAddress(event.target.value);
                      setBankrClaimStatus("");
                    }}
                    placeholder="0x..."
                    aria-invalid={bankrRecipientAddress.trim().length > 0 && !bankrRecipientReady}
                  />
                </div>

                <Button
                  type="button"
                  size="sm"
                  className={walletClass("hiveRailConvert")}
                  disabled={bankrClaimBusy || honeyStats.availableHoney <= 0 || !bankrRecipientReady}
                  onClick={() => void claimBankrHive()}
                  aria-label={`Claim ${formatHiveAmount(honeyStats.hiveQuote)} HIVE to your Bankr wallet`}
                >
                  <Image
                    className={walletClass("hiveRailConvertIcon")}
                    src="/icons/generated/honey-hive-icon.png"
                    alt=""
                    width={30}
                    height={30}
                    aria-hidden="true"
                    priority
                    unoptimized
                  />
                  <span>
                    <span>{bankrClaimBusy ? "Claiming Bankr HIVE..." : "Claim Bankr HIVE"}</span>
                    <span>{formatHiveAmount(honeyStats.availableHoney)} Honey → {formatHiveAmount(honeyStats.hiveQuote)} HIVE on Base</span>
                  </span>
                </Button>

                {bankrClaimStatus ? <p className={walletClass("hiveRailClaimStatus")}>{bankrClaimStatus}</p> : null}

                {honeyStats.legacyHive > 0 ? (
                  <div className={walletClass("hiveRailLegacy")}>
                    <p>
                      This is not Bankr HIVE. It is an old ledger-only conversion. Move it back to Honey.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={returnAllHiveToHoney}
                      aria-label={`Move ${formatHiveAmount(honeyStats.legacyHive)} legacy HIVE back to Honey`}
                    >
                      <RefreshCcw aria-hidden="true" />
                      Move back to Honey
                    </Button>
                  </div>
                ) : null}

                <details className={walletClass("hiveRailDetails")}>
                  <summary>Reward pool</summary>
                  <dl>
                    <div>
                      <dt>Pool size</dt>
                      <dd>
                        {formatHiveAmount(honeyStats.rewardPoolHive)} HIVE
                        <small>{formatHiveAmount(honeyStats.rewardPoolRemainingHive)} available to award</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Pool source</dt>
                      <dd>
                        {honeyStats.rewardPoolSharePercent.toFixed(4)}%
                        <small>of HIVE volume</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Rate</dt>
                      <dd>
                        {formatHiveAmount(honeyStats.hivePerMillionTokens)}
                        <small>HIVE per 1M tokens</small>
                      </dd>
                    </div>
                  </dl>
                </details>
              </>
            ) : (
              <>
                <p className={walletClass("hiveRailBlurb")}>
                  Watch supported local runtimes for real token usage, earn Honey, then claim Bankr HIVE once payout settlement is wired.
                </p>
                <Button type="button" size="sm" onClick={enableHoneyLedger}>
                  <HandCoins aria-hidden="true" />
                  Enable Honey ledger
                </Button>
                <details className={walletClass("hiveRailDetails")}>
                  <summary>What gets sent?</summary>
                  <p>
                    Agent id, workspace id, token count, model label, source, event id, and timestamp.
                    Prompts, responses, files, wallet keys, and machine details are not sent.
                    Hermes CLI usage is read from Hermes' own token counters while the dashboard is running.
                  </p>
                </details>
              </>
            )}

            <details className={walletClass("hiveRailDetails")}>
              <summary>Encrypted wallet vault</summary>
              <dl>
                <div>
                  <dt>Local vault</dt>
                  <dd>
                    {walletVaultBackupStatus?.vaultExists ? `${walletVaultBackupStatus.recordCount} record${walletVaultBackupStatus.recordCount === 1 ? "" : "s"}` : "Not created"}
                    <small>{walletVaultBackupStatus?.envKeyConfigured ? "env key" : walletVaultBackupStatus?.keyExists ? "file key" : "no key"}</small>
                  </dd>
                </div>
                <div>
                  <dt>Shared vault</dt>
                  <dd>
                    {walletVaultBackupStatus?.backupExists ? "Ready" : "Missing"}
                    <small>{walletVaultBackupStatus?.updatedAt ? formatRelativeTime(Date.parse(walletVaultBackupStatus.updatedAt)) : "not refreshed"}</small>
                  </dd>
                </div>
                <div>
                  <dt>GPG</dt>
                  <dd>
                    {walletVaultBackupStatus?.gpgAvailable ? "Available" : "Missing"}
                    <small>{walletVaultBackupStatus?.recipientConfigured ? "recipient ready" : "recipient missing"}</small>
                  </dd>
                </div>
              </dl>
              <div className={walletClass("walletVaultActions")}>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(walletVaultBackupBusy) || !walletVaultBackupStatus?.vaultExists || !walletVaultBackupStatus?.gpgAvailable || !walletVaultBackupStatus?.recipientConfigured}
                  onClick={() => runWalletVaultBackupAction("refresh")}
                >
                  <RefreshCcw aria-hidden="true" />
                  Sync
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(walletVaultBackupBusy) || !walletVaultBackupStatus?.backupExists || !walletVaultBackupStatus?.gpgAvailable}
                  onClick={() => runWalletVaultBackupAction("restore")}
                >
                  <Download aria-hidden="true" />
                  Restore
                </Button>
              </div>
              {walletVaultBackupMessage ? <p>{walletVaultBackupMessage}</p> : null}
            </details>

          </aside>
        </div>
        ) : null}
      </section>
      ) : null}

  </>);
}
