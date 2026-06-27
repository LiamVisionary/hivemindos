"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowUpFromLine, Check, Clock, Hexagon, RefreshCcw, Share2, Shield, Sparkles, WalletCards } from "lucide-react";
import type { AgentWalletTokenBalance } from "@/lib/types/agent-wallet";
import { DEFAULT_BASE_HIVE_TOKEN_ADDRESS, HIVE_STAKING_TIERS } from "@/lib/config/hive-staking";
import { isBaseHiveTokenLike, isEvmAddress, shortenEvmAddress, stakeHiveWithBrowserWallet, type BrowserEthereumProvider } from "@/lib/services/hive-staking-client";
import { HIVE_STAKING_REWARD_MIN_ACTIVE_SECONDS, HIVE_STAKING_REWARD_RATE_LABEL, HIVE_STAKING_REWARD_USD_PER_MILLION } from "@/lib/services/hive-staking-rewards";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import styles from "./stake.module.css";

type WalletWindow = Window & {
  ethereum?: BrowserEthereumProvider;
};

type PersonalWallet = {
  id: string;
  name?: string;
  address: string;
  network: string;
  custodyMode?: "local" | "watch";
  importedFrom?: "generated" | "private-key" | "recovery-phrase" | "browser" | "watch";
  currentBalanceUsd?: number;
  nativeBalance?: number;
  tokens?: AgentWalletTokenBalance[];
  lastOnchainSyncAt?: number;
};

type HiveWalletRow = {
  wallet: PersonalWallet;
  token: AgentWalletTokenBalance;
};

type StakeDraft = {
  rowKey: string;
  amount: string;
  busy: boolean;
  message: string;
  error: string;
};

type StakeStatusRow = {
  address: string;
  activeStakedHive: number;
  pendingUnstakeHive: number;
  paused: boolean;
  cooldownSeconds?: number;
};

type StakePageClientProps = {
  stakingContractAddress: string;
  /* Opt-in preview. When true (or NEXT_PUBLIC_STAKE_DEMO="1"), the page renders
     representative seeded wallets + stake status instead of hitting the live
     APIs, so you can see the fully-populated layout. Leave unset in prod. */
  demoMode?: boolean;
};

// ── Demo seed (opt-in) ────────────────────────────────────────────────────
// A Builder-tier wallet set: ~62M HIVE staked, next target Curator (100M).
const STAKE_DEMO_PRICE_USD = 0.0012;
const STAKE_DEMO_COOLDOWN_SECONDS = 14 * 86_400;
const MIN_ACTIVE_REWARD_DAYS = HIVE_STAKING_REWARD_MIN_ACTIVE_SECONDS / 86_400;

function demoWallet(id: string, name: string, address: string, custodyMode: "local" | "watch", balance: number): PersonalWallet {
  const token = {
    symbol: "HIVE",
    name: "HIVE",
    balance,
    network: "eip155:8453",
    tokenAddress: DEFAULT_BASE_HIVE_TOKEN_ADDRESS,
    valueUsd: balance * STAKE_DEMO_PRICE_USD,
    priceUsd: STAKE_DEMO_PRICE_USD,
    priceChange24hPct: 4.2,
    iconUrl: null,
    isNative: false,
  } satisfies AgentWalletTokenBalance;
  return {
    id,
    name,
    address,
    network: "eip155:8453",
    custodyMode,
    importedFrom: custodyMode === "local" ? "recovery-phrase" : "watch",
    currentBalanceUsd: balance * STAKE_DEMO_PRICE_USD,
    nativeBalance: 0,
    tokens: [token],
    lastOnchainSyncAt: Date.now(),
  };
}

const STAKE_DEMO_WALLETS: PersonalWallet[] = [
  demoWallet("demo-treasury", "Treasury · Base", "0x7a3fbe9c21d4e58a0b6c1f2d3e4a5b6c7d8e9f01", "local", 18_400_000),
  demoWallet("demo-ops", "Ops hot wallet", "0x2c9d10ab34ef5678129055cd34ef56781290abcd", "local", 5_250_000),
  demoWallet("demo-vault", "Cold vault", "0x5e1a77b3c9d04e2f8a16b5c4d3e2f1a09b8c7d6e", "watch", 41_000_000),
];

const STAKE_DEMO_STATUSES: Record<string, StakeStatusRow> = {
  "0x7a3fbe9c21d4e58a0b6c1f2d3e4a5b6c7d8e9f01": { address: "0x7a3fbe9c21d4e58a0b6c1f2d3e4a5b6c7d8e9f01", activeStakedHive: 48_000_000, pendingUnstakeHive: 0, paused: false, cooldownSeconds: STAKE_DEMO_COOLDOWN_SECONDS },
  "0x2c9d10ab34ef5678129055cd34ef56781290abcd": { address: "0x2c9d10ab34ef5678129055cd34ef56781290abcd", activeStakedHive: 4_000_000, pendingUnstakeHive: 0, paused: false, cooldownSeconds: STAKE_DEMO_COOLDOWN_SECONDS },
  "0x5e1a77b3c9d04e2f8a16b5c4d3e2f1a09b8c7d6e": { address: "0x5e1a77b3c9d04e2f8a16b5c4d3e2f1a09b8c7d6e", activeStakedHive: 10_000_000, pendingUnstakeHive: 2_000_000, paused: false, cooldownSeconds: STAKE_DEMO_COOLDOWN_SECONDS },
};

type LoadWalletsOptions = {
  refresh?: boolean;
  walletList?: PersonalWallet[];
};

// Why-stake benefits, paired with Fleet-style icon tiles. Glyphs match the
// fr-/Reserve mock: sparkle, network, promote (arrow-up), shield.
const STAKE_BENEFITS = [
  { Icon: Sparkles, text: "Seasonal HIVE reward buckets by tier" },
  { Icon: Share2, text: "Governance signaling and roadmap weight" },
  { Icon: ArrowUpFromLine, text: "Bounty boosting and curator eligibility" },
  { Icon: Shield, text: "Marketplace trust, badges, and Honey multipliers" },
];

const STAKE_REWARD_RULES = [
  { label: "No pre-season requirement", value: "Join during a season" },
  { label: `${MIN_ACTIVE_REWARD_DAYS} active-day minimum`, value: "Claim eligibility" },
  { label: "Time-weighted rewards", value: "Stake-seconds" },
  { label: "Unstake request", value: "Stops accrual" },
];

function walletKey(wallet: Pick<PersonalWallet, "network" | "address">) {
  return `${wallet.network}:${wallet.address.toLowerCase()}`;
}

function mergeWalletsByAccount(wallets: PersonalWallet[], seed: PersonalWallet | null) {
  if (!seed) return wallets;
  const index = wallets.findIndex((wallet) => walletKey(wallet) === walletKey(seed));
  if (index < 0) return [seed, ...wallets];
  const existing = wallets[index]!;
  const seededHiveTokens = (seed.tokens ?? []).filter(isBaseHiveTokenLike);
  const existingHasHive = (existing.tokens ?? []).some(isBaseHiveTokenLike);
  const merged = {
    ...seed,
    ...existing,
    tokens: existingHasHive ? existing.tokens : [...seededHiveTokens, ...(existing.tokens ?? [])],
  };
  return wallets.map((wallet, walletIndex) => (walletIndex === index ? merged : wallet));
}

function rowKey(row: HiveWalletRow) {
  return `${row.wallet.id}:${row.token.network}:${row.token.tokenAddress?.toLowerCase() || row.token.symbol}`;
}

function formatHive(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 HIVE";
  if (value >= 1_000_000_000) return `${trimCompact(value / 1_000_000_000)}b HIVE`;
  if (value >= 1_000_000) return `${trimCompact(value / 1_000_000)}m HIVE`;
  if (value >= 1_000) return `${trimCompact(value / 1_000)}k HIVE`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })} HIVE`;
}

function formatUsd(value: number) {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function trimCompact(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: value >= 10 ? 1 : 2 }).replace(/\.0$/, "");
}

function formatStakeInputAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 8 });
}

function tierAmount(value: bigint) {
  return formatHive(Number(value));
}

function formatCooldown(seconds?: number) {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return "Not loaded";
  const days = seconds / 86_400;
  if (Number.isInteger(days)) return `${days} day${days === 1 ? "" : "s"}`;
  return `${(Math.round(days * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} days`;
}

function finiteQueryNumber(value: string | null) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function personalWalletFromStakeParams(params: URLSearchParams): PersonalWallet | null {
  const id = params.get("walletId")?.trim();
  const address = params.get("address")?.trim();
  const network = params.get("network")?.trim();
  const balance = finiteQueryNumber(params.get("tokenBalance"));
  if (!id || !address || network !== "eip155:8453" || !isEvmAddress(address) || balance == null) return null;
  const tokenAddress = params.get("tokenAddress")?.trim() || DEFAULT_BASE_HIVE_TOKEN_ADDRESS;
  const token = {
    symbol: params.get("tokenSymbol")?.trim() || "HIVE",
    name: params.get("tokenName")?.trim() || "HIVE",
    balance,
    network,
    tokenAddress,
    valueUsd: finiteQueryNumber(params.get("tokenValueUsd")),
    priceUsd: finiteQueryNumber(params.get("tokenPriceUsd")),
    priceChange24hPct: finiteQueryNumber(params.get("tokenPriceChange24hPct")),
    iconUrl: params.get("tokenIconUrl")?.trim() || null,
    isNative: false,
  } satisfies AgentWalletTokenBalance;
  if (!isBaseHiveTokenLike(token)) return null;
  const custodyMode = params.get("custodyMode") === "local" ? "local" : "watch";
  const importedFrom = params.get("importedFrom");
  return {
    id,
    name: params.get("walletName")?.trim() || "My wallet Base",
    address,
    network,
    custodyMode,
    importedFrom: importedFrom === "generated" || importedFrom === "private-key" || importedFrom === "recovery-phrase" || importedFrom === "browser" ? importedFrom : "watch",
    currentBalanceUsd: finiteQueryNumber(params.get("tokenValueUsd")) ?? 0,
    nativeBalance: 0,
    tokens: [token],
    lastOnchainSyncAt: Date.now(),
  };
}

async function fetchPersonalWallets() {
  const response = await fetch("/api/wallet/personal", { headers: { accept: "application/json" } }).catch(() => null);
  const data = await response?.json().catch(() => null) as { ok?: boolean; wallets?: PersonalWallet[]; error?: string } | null;
  if (!response?.ok || !data?.ok || !Array.isArray(data.wallets)) {
    throw new Error(data?.error || "Could not load wallets.");
  }
  return data.wallets;
}

async function refreshWallet(wallet: PersonalWallet) {
  const response = await fetch("/api/wallet/balance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address, network: wallet.network }),
  }).catch(() => null);
  const data = await response?.json().catch(() => null) as {
    ok?: boolean;
    balance?: { totalValueUsd?: number | null; nativeBalance: number; tokens?: AgentWalletTokenBalance[]; fetchedAt: number };
    error?: string;
  } | null;
  if (!response?.ok || !data?.ok || !data.balance) throw new Error(data?.error || "Could not refresh wallet.");
  return {
    ...wallet,
    currentBalanceUsd: Number(data.balance.totalValueUsd) || wallet.currentBalanceUsd || 0,
    nativeBalance: Number(data.balance.nativeBalance) || 0,
    tokens: data.balance.tokens ?? [],
    lastOnchainSyncAt: data.balance.fetchedAt,
  };
}

export default function StakePageClient({ stakingContractAddress, demoMode = false }: StakePageClientProps) {
  const demoActive = demoMode || (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STAKE_DEMO === "1");
  const searchParams = useSearchParams();
  const seededWallet = useMemo(() => demoActive ? null : personalWalletFromStakeParams(searchParams), [searchParams, demoActive]);
  const [wallets, setWallets] = useState<PersonalWallet[]>(() => demoActive ? STAKE_DEMO_WALLETS : seededWallet ? [seededWallet] : []);
  const [loading, setLoading] = useState(() => demoActive ? false : !seededWallet);
  const [refreshingBalances, setRefreshingBalances] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<StakeDraft | null>(null);
  const [stakeStatuses, setStakeStatuses] = useState<Record<string, StakeStatusRow>>(() => demoActive ? STAKE_DEMO_STATUSES : {});
  const [contractCooldownSeconds, setContractCooldownSeconds] = useState<number>();
  const [contractTotalStakedHive, setContractTotalStakedHive] = useState<number | null>(demoActive ? 1_420_000_000 : null);
  const nativeDesktopRuntime = useMemo(() => isTauriDesktopRuntime(), []);

  const hiveRows = useMemo<HiveWalletRow[]>(() => wallets
      .filter((wallet) => wallet.network === "eip155:8453" && isEvmAddress(wallet.address))
      .flatMap((wallet) => (wallet.tokens ?? [])
      .filter(isBaseHiveTokenLike)
      .map((token) => ({
        wallet,
        token: {
          ...token,
          tokenAddress: token.tokenAddress || DEFAULT_BASE_HIVE_TOKEN_ADDRESS,
        },
      }))), [wallets]);
  const totalHive = useMemo(() => hiveRows.reduce((total, row) => total + row.token.balance, 0), [hiveRows]);
  const totalStakedHive = useMemo(() => Object.values(stakeStatuses).reduce((total, row) => total + row.activeStakedHive, 0), [stakeStatuses]);
  const totalPendingUnstakeHive = useMemo(() => Object.values(stakeStatuses).reduce((total, row) => total + row.pendingUnstakeHive, 0), [stakeStatuses]);
  const statusCooldownSeconds = useMemo(() => Object.values(stakeStatuses).find((row) => Number.isFinite(row.cooldownSeconds))?.cooldownSeconds, [stakeStatuses]);
  const unstakeCooldownSeconds = contractCooldownSeconds ?? statusCooldownSeconds;
  const nextTier = useMemo(() => HIVE_STAKING_TIERS.find((tier) => Number(tier.thresholdHive) > totalStakedHive) ?? null, [totalStakedHive]);

  // The highest tier the active stake already clears, plus progress to the next.
  const currentTier = useMemo(() => {
    const reached = HIVE_STAKING_TIERS.filter((tier) => totalStakedHive >= Number(tier.thresholdHive));
    return reached.length ? reached[reached.length - 1] : null;
  }, [totalStakedHive]);
  const tierProgress = useMemo(() => {
    const prev = currentTier ? Number(currentTier.thresholdHive) : 0;
    const span = nextTier ? Number(nextTier.thresholdHive) - prev : 1;
    return nextTier ? Math.min(1, Math.max(0, (totalStakedHive - prev) / span)) : 1;
  }, [currentTier, nextTier, totalStakedHive]);
  const toNextHive = nextTier ? Number(nextTier.thresholdHive) - totalStakedHive : 0;
  const hivePriceUsd = useMemo(() => {
    const priced = hiveRows.find((row) => Number.isFinite(row.token.priceUsd as number) && (row.token.priceUsd as number) > 0);
    return priced ? Number(priced.token.priceUsd) : null;
  }, [hiveRows]);
  const stakedUsd = hivePriceUsd != null && totalStakedHive > 0
    ? `$${Math.round(totalStakedHive * hivePriceUsd).toLocaleString()}`
    : null;

  const loadStakeStatuses = useCallback(async (walletList: PersonalWallet[]) => {
    const addresses = walletList
      .filter((wallet) => wallet.network === "eip155:8453" && isEvmAddress(wallet.address))
      .map((wallet) => wallet.address);
    if (!addresses.length) {
      setStakeStatuses({});
    }
    const response = await fetch("/api/hive/stake/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      cooldownSeconds?: number;
      totalStakedHive?: number;
      statuses?: StakeStatusRow[];
    } | null;
    if (!response?.ok || !data?.ok || !Array.isArray(data.statuses)) return;
    if (Number.isFinite(data.cooldownSeconds)) setContractCooldownSeconds(data.cooldownSeconds);
    if (Number.isFinite(data.totalStakedHive)) setContractTotalStakedHive(data.totalStakedHive ?? null);
    setStakeStatuses(Object.fromEntries(data.statuses.map((row) => [row.address.toLowerCase(), row])));
  }, []);

  const loadWallets = useCallback(async (options: LoadWalletsOptions = {}) => {
    const showInitialLoading = !options.refresh && !seededWallet;
    if (showInitialLoading) setLoading(true);
    setError("");
    try {
      const loaded = options.walletList ?? await fetchPersonalWallets();
      const baseWallets = loaded.filter((wallet) => wallet.network === "eip155:8453" && isEvmAddress(wallet.address));
      if (!options.refresh) {
        const nextWallets = mergeWalletsByAccount(loaded, seededWallet);
        setWallets(nextWallets);
        void loadStakeStatuses(nextWallets);
        return nextWallets;
      }
      setRefreshingBalances(true);
      const refreshed = await Promise.all(baseWallets.map((wallet) => refreshWallet(wallet).catch(() => wallet)));
      const byKey = new Map(refreshed.map((wallet) => [walletKey(wallet), wallet]));
      const nextWallets = mergeWalletsByAccount(loaded.map((wallet) => byKey.get(walletKey(wallet)) ?? wallet), seededWallet);
      setWallets(nextWallets);
      void loadStakeStatuses(nextWallets);
      return nextWallets;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load HIVE staking wallets.");
      return [];
    } finally {
      if (showInitialLoading) setLoading(false);
      if (options.refresh) setRefreshingBalances(false);
    }
  }, [loadStakeStatuses, seededWallet]);

  useEffect(() => {
    if (demoActive) return;
    let cancelled = false;
    void loadWallets().then((loaded) => {
      if (cancelled || !loaded.length) return;
      void loadWallets({ refresh: true, walletList: loaded });
    });
    return () => {
      cancelled = true;
    };
  }, [loadWallets, demoActive]);

  async function connectBrowserWallet() {
    const provider = (window as WalletWindow).ethereum;
    if (!provider) {
      setError("No browser wallet extension was found.");
      return;
    }
    setBusy(true);
    setStatus("Connecting browser wallet...");
    setError("");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const address = accounts.find((account) => isEvmAddress(account));
      if (!address) throw new Error("Wallet connected, but no EVM account was returned.");
      const now = Date.now();
      const row: PersonalWallet = {
        id: `user:${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: "Browser wallet",
        address,
        network: "eip155:8453",
        custodyMode: "watch",
        importedFrom: "browser",
        tokens: [],
        lastOnchainSyncAt: 0,
      };
      setWallets((current) => {
        const exists = new Set(current.map(walletKey));
        return exists.has(walletKey(row)) ? current : [row, ...current];
      });
      void fetch("/api/wallet/personal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallets: [row] }),
      }).catch(() => null);
      const refreshed = await refreshWallet(row);
      setWallets((current) => {
        const without = current.filter((wallet) => walletKey(wallet) !== walletKey(refreshed));
        return [refreshed, ...without];
      });
      setStatus("Browser wallet connected and refreshed.");
      void loadStakeStatuses([refreshed]);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not connect wallet.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function refreshAll() {
    if (demoActive) {
      setStatus("Preview data — connect a wallet to load live balances.");
      return;
    }
    setBusy(true);
    setStatus("Refreshing HIVE balances...");
    await loadWallets({ refresh: true });
    setStatus("HIVE balances and stake status refreshed.");
    setBusy(false);
  }

  async function stakeRow(row: HiveWalletRow) {
    const key = rowKey(row);
    const amountText = draft?.rowKey === key ? draft.amount.trim() : "";
    const amount = Number(amountText);
    if (!stakingContractAddress) {
      setDraft((current) => current?.rowKey === key ? { ...current, error: "HIVE staking contract address is not configured.", message: "" } : current);
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setDraft((current) => current?.rowKey === key ? { ...current, error: "Enter a HIVE amount to stake.", message: "" } : current);
      return;
    }
    if (amount > row.token.balance) {
      setDraft((current) => current?.rowKey === key ? { ...current, error: "Amount is higher than this wallet's HIVE balance.", message: "" } : current);
      return;
    }
    if (demoActive) {
      setDraft((current) => current?.rowKey === key ? { ...current, busy: true, error: "", message: "Signing demo stake transaction..." } : current);
      window.setTimeout(() => {
        const addr = row.wallet.address.toLowerCase();
        setStakeStatuses((prev) => {
          const existing = prev[addr] ?? { address: row.wallet.address, activeStakedHive: 0, pendingUnstakeHive: 0, paused: false, cooldownSeconds: STAKE_DEMO_COOLDOWN_SECONDS };
          return { ...prev, [addr]: { ...existing, activeStakedHive: existing.activeStakedHive + amount } };
        });
        setDraft((current) => current?.rowKey === key ? { ...current, busy: false, error: "", message: "Demo stake confirmed — preview only, no on-chain transaction." } : current);
      }, 800);
      return;
    }
    if (row.wallet.custodyMode === "local") {
      await stakeLocalRow(row, key, amountText);
      return;
    }
    if (nativeDesktopRuntime) {
      setDraft((current) => current?.rowKey === key ? { ...current, error: "This is a view-only wallet in the desktop app. Import the wallet locally or stake from an external wallet surface.", message: "" } : current);
      return;
    }
    await stakeBrowserRow(row, key, amountText);
  }

  async function stakeLocalRow(row: HiveWalletRow, key: string, amountText: string) {
    setDraft((current) => current?.rowKey === key ? { ...current, busy: true, error: "", message: "Preparing local staking transaction..." } : current);
    try {
      setDraft((current) => current?.rowKey === key ? { ...current, message: "Signing local HIVE approval and stake transactions..." } : current);
      const response = await fetch("/api/hive/stake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: row.wallet.id,
          amountHive: amountText,
          tokenAddress: row.token.tokenAddress || DEFAULT_BASE_HIVE_TOKEN_ADDRESS,
          confirmation: "STAKE_HIVE",
        }),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; approveHash?: string; stakeHash?: string; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Could not stake HIVE.");
      setDraft((current) => current?.rowKey === key ? {
        ...current,
        busy: false,
        error: "",
        message: `Stake confirmed${result.stakeHash ? ` (${shortenEvmAddress(result.stakeHash)})` : ""}. Refreshing wallet state...`,
      } : current);
      window.setTimeout(() => void refreshAll(), 1000);
    } catch (stakeError) {
      setDraft((current) => current?.rowKey === key ? {
        ...current,
        busy: false,
        error: stakeError instanceof Error ? stakeError.message : "Could not stake HIVE.",
        message: "",
      } : current);
    }
  }

  async function stakeBrowserRow(row: HiveWalletRow, key: string, amountText: string) {
    const provider = (window as WalletWindow).ethereum;
    if (!provider) {
      setDraft((current) => current?.rowKey === key ? { ...current, error: "No browser wallet found. Connect the wallet that owns this HIVE.", message: "" } : current);
      return;
    }
    setDraft((current) => current?.rowKey === key ? { ...current, busy: true, error: "", message: "Connecting Base wallet..." } : current);
    try {
      const result = await stakeHiveWithBrowserWallet({
        provider,
        walletAddress: row.wallet.address,
        tokenAddress: row.token.tokenAddress || DEFAULT_BASE_HIVE_TOKEN_ADDRESS,
        stakingAddress: stakingContractAddress,
        amountText,
        onStatus: (message) => setDraft((current) => current?.rowKey === key ? { ...current, message } : current),
      });
      setDraft((current) => current?.rowKey === key ? {
        ...current,
        busy: false,
        error: "",
        message: `Stake confirmed${result.stakeHash ? ` (${shortenEvmAddress(result.stakeHash)})` : ""}. Refreshing wallet state...`,
      } : current);
      window.setTimeout(() => void refreshAll(), 1000);
    } catch (stakeError) {
      setDraft((current) => current?.rowKey === key ? {
        ...current,
        busy: false,
        error: stakeError instanceof Error ? stakeError.message : "Could not stake HIVE.",
        message: "",
      } : current);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        {demoActive ? (
          <div className={styles.demoRibbon}><Sparkles size={13} aria-hidden="true" /> Preview data — representative balances, not your live wallet.</div>
        ) : null}
        <nav className={styles.topBar} aria-label="Stake navigation">
          <Link href="/?view=wallet"><ArrowLeft aria-hidden="true" /> Wallets</Link>
          <div className={styles.topStats}>
            <span><b>{formatHive(totalStakedHive)}</b> staked</span>
            {contractTotalStakedHive != null ? <span><b>{formatHive(contractTotalStakedHive)}</b> vault</span> : null}
            <span><b>{HIVE_STAKING_REWARD_RATE_LABEL}</b> rewards</span>
            <span><b>{formatHive(totalHive)}</b> detected</span>
            <span><b>{currentTier ? currentTier.label : "—"}</b> tier</span>
          </div>
          <Link href="/docs/monetization/hive-staking-and-community-tiers.html">Tier docs</Link>
        </nav>

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={`${styles.eyebrow} ${styles.eyebrowHoney}`}><Hexagon aria-hidden="true" /> HIVE staking</p>
            <h1>Stake HIVE for status, access, and seasonal reward buckets.</h1>
            <p className={styles.lede}>Staking is not a payment. Your HIVE stays yours while it is locked in the Base staking contract. Higher tiers earn from bigger seasonal HIVE reward buckets when reward seasons are funded.</p>
            <div className={styles.benefits}>
              {STAKE_BENEFITS.map(({ Icon, text }) => (
                <span key={text} className={styles.benefit}>
                  <i className={styles.benefitIcon}><Icon aria-hidden="true" /></i>
                  {text}
                </span>
              ))}
            </div>
            <div className={styles.rewardRules} aria-label="Seasonal reward rules">
              {STAKE_REWARD_RULES.map((rule) => (
                <span key={rule.label}>
                  <Clock aria-hidden="true" />
                  <b>{rule.label}</b>
                  {rule.value}
                </span>
              ))}
            </div>
          </div>

          <aside className={styles.progressPanel} aria-label="HIVE staking summary">
            <span className={styles.progLabel}>Active stake</span>
            <span className={styles.progBig}>
              {formatHive(totalStakedHive)}
              {stakedUsd ? <small>{stakedUsd}</small> : null}
            </span>
            <div className={styles.progBadges}>
              <span className={`${styles.pill} ${styles.pillReached}`}>
                {currentTier ? <><Check size={11} aria-hidden="true" /> {currentTier.label}</> : "No tier yet"}
              </span>
              <span className={`${styles.pill} ${styles.pillNext}`}>
                {nextTier ? `Next · ${nextTier.label}` : "Top tier"}
              </span>
            </div>
            <div className={styles.bar}><i style={{ width: `${(tierProgress * 100).toFixed(1)}%` }} /></div>
            <div className={styles.progFoot}>
              <span><b>{formatHive(totalStakedHive)}</b> staked</span>
              <span>{nextTier ? <><b>{formatHive(toNextHive)}</b> to {nextTier.label}</> : "Highest tier reached"}</span>
            </div>
            <div className={styles.miniGrid}>
              <div><span>Detected</span><strong>{formatHive(totalHive)}</strong></div>
              <div><span>Unstaking</span><strong>{formatHive(totalPendingUnstakeHive)}</strong></div>
              <div><span>Cooldown</span><strong>{formatCooldown(unstakeCooldownSeconds)}</strong></div>
              <div><span>Claim min</span><strong>{MIN_ACTIVE_REWARD_DAYS} active days</strong></div>
              <div><span>Reward pool</span><strong>{formatUsd(HIVE_STAKING_REWARD_USD_PER_MILLION)} / $1m</strong></div>
            </div>
          </aside>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Launch tiers</p>
              <h2>Stake targets</h2>
            </div>
          </div>
          <div className={styles.tierGrid}>
            {HIVE_STAKING_TIERS.map((tier, index) => {
              const reached = totalStakedHive >= Number(tier.thresholdHive);
              const isNext = nextTier?.id === tier.id;
              const cardClass = [
                styles.tierCard,
                reached ? styles.tierCardReached : "",
                isNext ? styles.tierCardNext : "",
              ].filter(Boolean).join(" ");
              return (
                <article key={tier.id} className={cardClass}>
                  <span className={styles.ladn}>{String(index + 1).padStart(2, "0")}</span>
                  <div className={styles.tierTop}>
                    <span className={styles.tierName}>
                      <Hexagon className={styles.tierMark} aria-hidden="true" />
                      <strong>{tier.label}</strong>
                    </span>
                    {reached ? (
                      <span className={`${styles.tierBadge} ${styles.tierBadgeReached}`}>
                        <Check aria-hidden="true" size={11} /> Reached
                      </span>
                    ) : isNext ? (
                      <span className={`${styles.tierBadge} ${styles.tierBadgeNext}`}>Next</span>
                    ) : null}
                  </div>
                  <span className={styles.tierThreshold}>
                    {tierAmount(tier.thresholdHive).replace(" HIVE", "")}
                    <small className={styles.tierUnit}>HIVE</small>
                  </span>
                  <div className={styles.tierReward}>
                    <span>{tier.holderMultiple} bucket</span>
                    <span>{tier.bucketRateLabel} eligible revenue</span>
                    <span>{formatUsd(tier.rewardBucketUsdPerMillion)} / $1m</span>
                  </div>
                  <p>{tier.role}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Connected wallets</p>
              <h2>Stake available HIVE</h2>
              <p className={styles.panelIntro}>Balances are pulled from the same personal Base wallets shown in the Wallets view. Staking locks HIVE in the Base contract, waits for approval and stake confirmation, and never transfers ownership away from you.</p>
            </div>
            <div className={styles.actions}>
              {!nativeDesktopRuntime ? (
                <button type="button" className={styles.ghostButton} onClick={() => void connectBrowserWallet()} disabled={busy}>
                  <WalletCards aria-hidden="true" /> Connect wallet
                </button>
              ) : (
                <Link className={styles.ghostButton} href="/?view=wallet"><WalletCards aria-hidden="true" /> Add local wallet</Link>
              )}
              <button type="button" className={styles.primaryButton} onClick={() => void refreshAll()} disabled={busy || loading}>
                <RefreshCcw aria-hidden="true" /> Refresh
              </button>
            </div>
          </div>

          {status ? <p className={styles.status} data-tone="ok">{status}</p> : null}
          {error ? <p className={styles.status} data-tone="error">{error}</p> : null}
          {!stakingContractAddress ? <p className={styles.status} data-tone="error">HIVE staking contract address is not configured yet.</p> : null}

          <div className={styles.walletList}>
            {loading ? (
              <div className={styles.empty}>Loading HIVE balances...</div>
            ) : hiveRows.length ? hiveRows.map((row) => {
              const key = rowKey(row);
              const activeDraft = draft?.rowKey === key ? draft : null;
              const canStakeInThisRuntime = row.wallet.custodyMode === "local" || !nativeDesktopRuntime;
              const stakeStatus = stakeStatuses[row.wallet.address.toLowerCase()];
              return (
                <article key={key} className={styles.walletRow}>
                  <div className={styles.walletMain}>
                    <strong>{row.wallet.name || "Base wallet"}</strong>
                    <span>
                      <i className={`${styles.custodyDot} ${row.wallet.custodyMode === "local" ? styles.custodyDotLocal : ""}`} aria-hidden="true" />
                      {shortenEvmAddress(row.wallet.address)} · {row.wallet.custodyMode === "local" ? "local signer" : "view-only"}
                    </span>
                  </div>
                  <div className={styles.walletBalance}>
                    <strong>{formatHive(row.token.balance)}</strong>
                    <span>{row.token.valueUsd == null ? "No quote" : `$${row.token.valueUsd.toFixed(2)}`}</span>
                    <span>{formatHive(stakeStatus?.activeStakedHive ?? 0)} staked</span>
                  </div>
                  <div className={styles.stakeBox}>
                    <div className={styles.stakeForm}>
                      <input
                        inputMode="decimal"
                        value={activeDraft?.amount ?? ""}
                        placeholder="Amount"
                        onChange={(event) => setDraft({ rowKey: key, amount: event.target.value, busy: false, message: "", error: "" })}
                        disabled={activeDraft?.busy}
                        aria-label={`HIVE amount to stake from ${row.wallet.name || row.wallet.address}`}
                      />
                      <button
                        type="button"
                        className={styles.smallButton}
                        onClick={() => setDraft({ rowKey: key, amount: formatStakeInputAmount(row.token.balance), busy: false, message: "", error: "" })}
                        disabled={activeDraft?.busy}
                      >
                        Max
                      </button>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => void stakeRow(row)}
                        disabled={activeDraft?.busy || !stakingContractAddress || !canStakeInThisRuntime}
                      >
                        <Shield aria-hidden="true" />
                        {activeDraft?.busy ? "Signing…" : "Stake"}
                      </button>
                    </div>
                    {!canStakeInThisRuntime ? <p className={styles.status} data-tone="error">This Base wallet is view-only on this desktop. Import its Base private key or recovery phrase in Wallets, or stake from an external wallet surface.</p> : null}
                    {activeDraft?.message ? <p className={styles.status} data-tone="ok">{activeDraft.message}</p> : null}
                    {activeDraft?.error ? <p className={styles.status} data-tone="error">{activeDraft.error}</p> : null}
                  </div>
                </article>
              );
            }) : refreshingBalances ? (
              <div className={styles.empty}>Checking Base HIVE balances...</div>
            ) : (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}><WalletCards aria-hidden="true" /></span>
                <strong>No Base HIVE detected yet</strong>
                <p>Connect a Base wallet or refresh your balances to start staking. The tier targets above show what each stake level unlocks.</p>
                <div className={styles.actions}>
                  {!nativeDesktopRuntime ? (
                    <button type="button" className={styles.primaryButton} onClick={() => void connectBrowserWallet()} disabled={busy}>
                      <WalletCards aria-hidden="true" /> Connect wallet
                    </button>
                  ) : (
                    <Link className={styles.primaryButton} href="/?view=wallet"><WalletCards aria-hidden="true" /> Add local wallet</Link>
                  )}
                  <button type="button" className={styles.ghostButton} onClick={() => void refreshAll()} disabled={busy}>
                    <RefreshCcw aria-hidden="true" /> Refresh
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
