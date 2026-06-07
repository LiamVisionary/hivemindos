"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, Dispatch, ElementType, SetStateAction } from "react";
import Image from "next/image";
import { ChevronDown, KeyRound, Plus, Search, Send, WalletCards, X } from "lucide-react";
import type { AgentWalletCardProps } from "@/components/wallet/AgentWalletCard";
import type { AgentWalletCardCompactProps } from "@/components/wallet/AgentWalletCardCompact";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentPaymentProvider, AgentSurvivalSnapshot, AgentWalletConfig, AgentWalletTokenBalance, HoneyAgentReward } from "@/lib/types/agent-wallet";
import { resolveAgentWallet } from "@/lib/utils/agent-wallet";
import { createStyleClass } from "@/features/dashboard/style-classes";
import type { DashboardView, RuntimeUsageAnalytics, WalletActionState, WalletMoneyClawStatus, WalletVaultBackupStatus } from "@/features/dashboard/dashboard-types";
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
  lastOnchainSyncAt: number;
  createdAt: number;
  updatedAt: number;
};

type WalletRecipient = {
  id: string;
  label: string;
  group: "My wallet" | "Agent wallet";
  address: string;
  network: string;
};

type AgentWalletRow = {
  agent: AgentProfile;
  hasWallet: boolean;
  wallet: AgentWalletConfig;
};

const PERSONAL_WALLET_STORAGE_KEY = ".userWallets.v1";
const personalClass = createStyleClass(personalStyles);

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
  formatHiveAmount: (amount: number) => string;
  formatRelativeTime: (timestamp: number) => string;
  getSurvivalSnapshot: (wallet: AgentWalletConfig) => AgentSurvivalSnapshot;
  honeyLedgerEnabled: boolean;
  honeyStats: HoneyStats;
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

function safePersonalWallets(raw: string | null): PersonalWallet[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): PersonalWallet[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Partial<PersonalWallet>;
      if (!record.id || !record.address || !record.network) return [];
      return [{
        id: String(record.id),
        name: String(record.name || "My wallet"),
        address: String(record.address),
        network: String(record.network),
        custodyMode: record.custodyMode === "local" ? "local" : "watch",
        importedFrom: record.importedFrom || "watch",
        currentBalanceUsd: Number(record.currentBalanceUsd) || 0,
        nativeBalance: Number(record.nativeBalance) || 0,
        tokens: Array.isArray(record.tokens) ? record.tokens : [],
        lastOnchainSyncAt: Number(record.lastOnchainSyncAt) || 0,
        createdAt: Number(record.createdAt) || Date.now(),
        updatedAt: Number(record.updatedAt) || Date.now(),
      }];
    });
  } catch {
    return [];
  }
}

export function WalletPanel(props: WalletPanelProps) {
  const { AGENT_PAYMENT_PROVIDER_COPY, AgentWalletCard, AgentWalletCardCompact, Button, ChevronLeft, Download, HandCoins, LoaderCircle, RUNTIME_LABELS, RefreshCcw, activeView, claimAllHoneyToBankrHive, copyPaymentPrompt, createLocalWallet, displayAgents, enableHoneyLedger, formatHiveAmount, formatRelativeTime, getSurvivalSnapshot, honeyLedgerEnabled, honeyStats, initializeCoreWalletRails, moneyClawStatusByEnvName, refreshRuntimeIntegrations, refreshRuntimeUsage, refreshWalletBalance, renderAgentKey, resetWalletBurnClock, returnAllHiveToHoney, runWalletVaultBackupAction, runtimeUsage, runtimeUsageLoading, saveMoneyClawKey, selectedAgent, selectedHoneyReward, selectedWallet, selectedWalletSnapshot, sendWalletUsdc, setSelectedAgentId, setWalletExpanded, setWalletPanelMode, testX402Fetch, updateAgentProfile, updateWallet, updateWalletAction, vaultClass, walletActionsByAgent, walletClass, walletExpanded, walletPanelMode, walletStats, walletVaultBackupBusy, walletVaultBackupMessage, walletVaultBackupStatus, walletsByAgent } = props;
  const refreshedUsePodAgentIds = useRef<Set<string>>(new Set());
  const [bankrClaimBusy, setBankrClaimBusy] = useState(false);
  const [bankrConnectBusy, setBankrConnectBusy] = useState(false);
  const [bankrClaimStatus, setBankrClaimStatus] = useState("");
  const [bankrRecipientAddress, setBankrRecipientAddress] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("hivemindos.bankrRecipientAddress") ?? "";
  });
  const [personalWallets, setPersonalWallets] = useState<PersonalWallet[]>(() => {
    if (typeof window === "undefined") return [];
    return safePersonalWallets(window.localStorage.getItem(PERSONAL_WALLET_STORAGE_KEY));
  });
  const [personalWalletActions, setPersonalWalletActions] = useState<Record<string, WalletActionState>>({});
  const [personalImportOpen, setPersonalImportOpen] = useState(false);
  const [personalImportDraft, setPersonalImportDraft] = useState({
    name: "My Base wallet",
    network: "eip155:8453",
    importKind: "private-key" as "private-key" | "recovery-phrase" | "watch",
    secret: "",
    address: "",
  });
  const [personalImportStatus, setPersonalImportStatus] = useState("");
  const [quickSendOpen, setQuickSendOpen] = useState<Record<string, boolean>>({});
  const [quickSendSearch, setQuickSendSearch] = useState("");
  const bankrRecipientReady = /^0x[a-fA-F0-9]{40}$/.test(bankrRecipientAddress.trim());
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
  const walletRecipients = useMemo<WalletRecipient[]>(() => {
    const personal = personalWallets
      .filter((wallet) => wallet.address.trim())
      .map((wallet) => ({
        id: wallet.id,
        label: wallet.name,
        group: "My wallet" as const,
        address: wallet.address,
        network: wallet.network,
      }));
    const agentRecipients = displayAgents.flatMap((agent): WalletRecipient[] => {
      const wallet = resolveAgentWallet(agent, walletsByAgent[agent.id]);
      const address = wallet.walletAddress || wallet.vaultAddress;
      if (!address) return [];
      return [{
        id: `agent:${agent.id}`,
        label: agent.name,
        group: "Agent wallet",
        address,
        network: wallet.network,
      }];
    });
    return [...personal, ...agentRecipients];
  }, [displayAgents, personalWallets, walletsByAgent]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PERSONAL_WALLET_STORAGE_KEY, JSON.stringify(personalWallets));
  }, [personalWallets]);

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

      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }).catch(async (error: unknown) => {
        const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0;
        if (code !== 4902) return;
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x2105",
            chainName: "Base",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://mainnet.base.org"],
            blockExplorerUrls: ["https://basescan.org"],
          }],
        });
      });

      setBankrRecipientAddress(address);
      window.localStorage.setItem("hivemindos.bankrRecipientAddress", address);
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
    window.localStorage.setItem("hivemindos.bankrRecipientAddress", recipientAddress);
    const result = await claimAllHoneyToBankrHive(recipientAddress);
    setBankrClaimBusy(false);
    if (!result.ok) {
      setBankrClaimStatus(result.error ?? "Bankr HIVE claim failed.");
      return;
    }
    const hash = result.txHash ? ` Tx ${result.txHash.slice(0, 10)}...${result.txHash.slice(-6)}.` : "";
    setBankrClaimStatus(`Sent ${formatHiveAmount(result.amount ?? 0)} HIVE to Bankr.${hash}`);
  }

  function updatePersonalWallet(walletId: string, patch: Partial<PersonalWallet>) {
    setPersonalWallets((current) => current.map((wallet) => wallet.id === walletId ? { ...wallet, ...patch, updatedAt: Date.now() } : wallet));
  }

  function updatePersonalAction(walletId: string, patch: Partial<WalletActionState>) {
    setPersonalWalletActions((current) => ({
      ...current,
      [walletId]: { ...(current[walletId] ?? {}), ...patch },
    }));
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
      lastOnchainSyncAt: 0,
      createdAt: now,
      updatedAt: now,
    }, ...current]);
    setPersonalImportOpen(false);
    setPersonalImportStatus("Wallet created.");
  }

  async function importPersonalWallet() {
    const walletId = createPersonalWalletId();
    const name = personalImportDraft.name.trim() || "My wallet";
    const network = personalImportDraft.network;
    if (personalImportDraft.importKind === "watch") {
      const address = personalImportDraft.address.trim();
      if (!address) {
        setPersonalImportStatus("Paste a public address first.");
        return;
      }
      const now = Date.now();
      setPersonalWallets((current) => [{
        id: walletId,
        name,
        address,
        network,
        custodyMode: "watch",
        importedFrom: "watch",
        currentBalanceUsd: 0,
        nativeBalance: 0,
        tokens: [],
        lastOnchainSyncAt: 0,
        createdAt: now,
        updatedAt: now,
      }, ...current]);
      setPersonalImportOpen(false);
      setPersonalImportStatus("View-only wallet added.");
      return;
    }

    setPersonalImportStatus("Importing into encrypted wallet vault...");
    const response = await fetch("/api/wallet/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: walletId,
        network,
        secret: personalImportDraft.secret,
        importKind: personalImportDraft.importKind,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      wallet?: { address: string; network: string };
      importKind?: "private-key" | "recovery-phrase";
      error?: string;
    } | null;
    if (!response?.ok || !data?.ok || !data.wallet) {
      setPersonalImportStatus(data?.error ?? "Could not import wallet.");
      return;
    }
    const now = Date.now();
    setPersonalWallets((current) => [{
      id: walletId,
      name,
      address: data.wallet!.address,
      network: data.wallet!.network,
      custodyMode: "local",
      importedFrom: data.importKind || personalImportDraft.importKind,
      currentBalanceUsd: 0,
      nativeBalance: 0,
      tokens: [],
      lastOnchainSyncAt: 0,
      createdAt: now,
      updatedAt: now,
    }, ...current]);
    setPersonalImportDraft((current) => ({ ...current, secret: "", address: "" }));
    setPersonalImportOpen(false);
    setPersonalImportStatus("Wallet imported.");
  }

  async function connectBrowserWalletToPersonalList() {
    const provider = (window as WalletWindow).ethereum;
    setPersonalImportOpen(true);
    if (!provider) {
      setPersonalImportDraft((current) => ({
        ...current,
        network: "eip155:8453",
        importKind: "watch",
      }));
      setPersonalImportStatus("No browser wallet was found. Paste a public wallet address to track balances only, or choose Private key / Recovery phrase to enable sends.");
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
        lastOnchainSyncAt: 0,
        createdAt: now,
        updatedAt: now,
      }, ...current]);
      setPersonalImportStatus("Browser wallet added as view-only.");
      setPersonalImportOpen(false);
    } catch (error) {
      setPersonalImportOpen(true);
      setPersonalImportStatus(error instanceof Error ? error.message : "Could not connect browser wallet.");
    }
  }

  async function refreshPersonalWalletBalance(wallet: PersonalWallet) {
    updatePersonalAction(wallet.id, { busy: true, error: "", message: "Refreshing portfolio..." });
    const response = await fetch("/api/wallet/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: wallet.address, network: wallet.network }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      balance?: { tokenBalance: number; nativeBalance: number; fetchedAt: number; tokens?: AgentWalletTokenBalance[] };
      error?: string;
    } | null;
    if (!response?.ok || !data?.ok || !data.balance) {
      updatePersonalAction(wallet.id, { busy: false, error: data?.error ?? "Could not refresh this wallet.", message: "" });
      return;
    }
    updatePersonalWallet(wallet.id, {
      currentBalanceUsd: Number(data.balance.tokenBalance) || 0,
      nativeBalance: Number(data.balance.nativeBalance) || 0,
      tokens: data.balance.tokens ?? [],
      lastOnchainSyncAt: data.balance.fetchedAt,
    });
    updatePersonalAction(wallet.id, { busy: false, error: "", message: "Portfolio refreshed." });
  }

  async function sendPersonalWalletUsdc(wallet: PersonalWallet) {
    const action = personalWalletActions[wallet.id] ?? {};
    const amount = Number(action.sendAmount);
    updatePersonalAction(wallet.id, { busy: true, error: "", message: "Sending USDC..." });
    const response = await fetch("/api/wallet/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: wallet.id,
        toAddress: action.sendTo,
        amountUsd: amount,
        maxPaymentUsd: 100000,
        autoPayEnabled: false,
        confirmation: action.confirmation,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      signature?: string;
      error?: string;
    } | null;
    if (!response?.ok || !data?.ok) {
      updatePersonalAction(wallet.id, { busy: false, error: data?.error ?? "Could not send USDC.", message: "" });
      return;
    }
    updatePersonalAction(wallet.id, { busy: false, error: "", message: `Sent. Transaction: ${data.signature}`, confirmation: "" });
    await refreshPersonalWalletBalance(wallet);
  }

  function recipientOptionsFor(wallet: PersonalWallet, query: string) {
    const lower = query.trim().toLowerCase();
    return walletRecipients
      .filter((recipient) => recipient.id !== wallet.id)
      .filter((recipient) => !lower || `${recipient.label} ${recipient.address} ${recipient.group}`.toLowerCase().includes(lower));
  }

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
                    <Button type="button" size="sm" variant="secondary" onClick={() => setPersonalImportOpen((open) => !open)}>
                      {personalImportOpen ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
                      {personalImportOpen ? "Close" : "Add wallet"}
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void connectBrowserWalletToPersonalList()}>
                      <WalletCards aria-hidden="true" />
                      Connect
                    </Button>
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
                      <label>
                        <span>Import</span>
                        <select
                          value={personalImportDraft.importKind}
                          onChange={(event) => setPersonalImportDraft((current) => ({ ...current, importKind: event.target.value as "private-key" | "recovery-phrase" | "watch" }))}
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
                    ) : (
                      <label className={personalClass("personalImportSecret")}>
                        <span>{personalImportDraft.importKind === "recovery-phrase" ? "Recovery phrase" : "Private key"}</span>
                        <textarea
                          value={personalImportDraft.secret}
                          onChange={(event) => setPersonalImportDraft((current) => ({ ...current, secret: event.target.value }))}
                          placeholder={personalImportDraft.importKind === "recovery-phrase" ? "EVM recovery phrase" : "Encrypted locally after import"}
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

                {personalWallets.length ? (
                  <div className={personalClass("personalWalletGrid")} role="list" aria-label="User wallets">
                    {personalWallets.map((wallet) => {
                      const action = personalWalletActions[wallet.id] ?? {};
                      const sendOpen = Boolean(quickSendOpen[wallet.id]);
                      const recipients = recipientOptionsFor(wallet, quickSendSearch);
                      const tokenRows = wallet.tokens.length ? wallet.tokens : [
                        { symbol: "USDC", name: "USD Coin", balance: wallet.currentBalanceUsd, network: wallet.network, priceUsd: 1, valueUsd: wallet.currentBalanceUsd, priceChange24hPct: null },
                        { symbol: nativeSymbol(wallet.network), name: nativeSymbol(wallet.network), balance: wallet.nativeBalance, network: wallet.network, priceUsd: null, valueUsd: null, priceChange24hPct: null, isNative: true },
                      ] as AgentWalletTokenBalance[];
                      return (
                        <article key={wallet.id} className={personalClass("personalWalletCard")} role="listitem">
                          <header className={personalClass("personalWalletTop")}>
                            <div>
                              <strong>{wallet.name}</strong>
                              <span>{networkLabel(wallet.network)} · {wallet.custodyMode === "local" ? "Spendable" : "View-only"}</span>
                            </div>
                            <button type="button" onClick={() => void navigator.clipboard?.writeText(wallet.address)}>{shortenAddress(wallet.address)}</button>
                          </header>
                          <div className={personalClass("personalWalletBalance")}>
                            <strong>{formatMoney(wallet.currentBalanceUsd)}</strong>
                            <span>{formatToken(wallet.nativeBalance)} {nativeSymbol(wallet.network)}</span>
                          </div>
                          <div className={personalClass("personalTokenList")} aria-label={`${wallet.name} tokens`}>
                            {tokenRows.map((token) => (
                              <div key={`${token.symbol}-${token.isNative ? "native" : "token"}`} className={personalClass("personalTokenRow")}>
                                <span className={personalClass("personalTokenIcon")}>{token.symbol.slice(0, 1)}</span>
                                <div>
                                  <strong>{token.symbol}</strong>
                                  <span>{formatToken(token.balance)} {token.name}</span>
                                </div>
                                <div>
                                  <strong>{token.valueUsd == null ? "No quote" : formatMoney(token.valueUsd)}</strong>
                                  <span data-tone={(token.priceChange24hPct ?? 0) >= 0 ? "up" : "down"}>
                                    {token.priceChange24hPct == null ? "24h --" : `${token.priceChange24hPct >= 0 ? "+" : ""}${token.priceChange24hPct.toFixed(2)}%`}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className={personalClass("personalSendForm")}>
                            <label>
                              <span>Recipient</span>
                              <input
                                value={action.sendTo ?? ""}
                                onChange={(event) => updatePersonalAction(wallet.id, { sendTo: event.target.value })}
                                placeholder="0x... or Solana address"
                              />
                            </label>
                            <label>
                              <span>USDC</span>
                              <input
                                value={action.sendAmount ?? ""}
                                onChange={(event) => updatePersonalAction(wallet.id, { sendAmount: event.target.value })}
                                inputMode="decimal"
                                placeholder="0.00"
                              />
                            </label>
                            <label>
                              <span>Confirm</span>
                              <input
                                value={action.confirmation ?? ""}
                                onChange={(event) => updatePersonalAction(wallet.id, { confirmation: event.target.value })}
                                placeholder="SEND_USDC"
                              />
                            </label>
                          </div>
                          <div className={personalClass("personalWalletButtons")}>
                            <Button type="button" size="sm" variant="secondary" onClick={() => void refreshPersonalWalletBalance(wallet)} disabled={action.busy}>
                              <RefreshCcw aria-hidden="true" />
                              Refresh
                            </Button>
                            <div className={personalClass("quickSend")}>
                              <Button type="button" size="sm" disabled={action.busy || wallet.custodyMode !== "local"} onClick={() => void sendPersonalWalletUsdc(wallet)}>
                                <Send aria-hidden="true" />
                                Send
                              </Button>
                              <button
                                type="button"
                                className={personalClass("quickSendToggle")}
                                aria-label={`Choose quick-send recipient for ${wallet.name}`}
                                aria-expanded={sendOpen}
                                disabled={wallet.custodyMode !== "local"}
                                onClick={() => setQuickSendOpen((current) => ({ ...current, [wallet.id]: !current[wallet.id] }))}
                              >
                                <ChevronDown aria-hidden="true" />
                              </button>
                              {sendOpen ? (
                                <div className={personalClass("quickSendMenu")} role="dialog" aria-label="Quick send recipients">
                                  <label>
                                    <Search aria-hidden="true" />
                                    <input
                                      value={quickSendSearch}
                                      onChange={(event) => setQuickSendSearch(event.target.value)}
                                      placeholder="Search wallets"
                                    />
                                  </label>
                                  <div>
                                    {recipients.map((recipient) => {
                                      const compatible = recipient.network === wallet.network;
                                      return (
                                        <button
                                          key={recipient.id}
                                          type="button"
                                          disabled={!compatible}
                                          onClick={() => {
                                            updatePersonalAction(wallet.id, { sendTo: recipient.address });
                                            setQuickSendOpen((current) => ({ ...current, [wallet.id]: false }));
                                          }}
                                        >
                                          <span>
                                            <strong>{recipient.label}</strong>
                                            <small>{recipient.group} · {shortenAddress(recipient.address)}</small>
                                          </span>
                                          <small>{compatible ? networkLabel(recipient.network) : "Different network"}</small>
                                        </button>
                                      );
                                    })}
                                    {recipients.length ? null : <p>No wallets match.</p>}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                          {action.message ? <p className={personalClass("personalWalletStatus")} data-tone="ok">{action.message}</p> : null}
                          {action.error ? <p className={personalClass("personalWalletStatus")} data-tone="error">{action.error}</p> : null}
                        </article>
                      );
                    })}
                  </div>
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
                        <div role="listitem" key={renderAgentKey(agent, agentIndex)}>
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
