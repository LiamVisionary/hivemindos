"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LockKeyhole, RefreshCcw, Sparkles, WalletCards } from "lucide-react";
import type { AgentWalletTokenBalance } from "@/lib/types/agent-wallet";
import { DEFAULT_BASE_HIVE_TOKEN_ADDRESS, HIVE_STAKING_TIERS } from "@/lib/services/hive-staking";
import { isBaseHiveTokenLike, isEvmAddress, shortenEvmAddress, stakeHiveWithBrowserWallet, type BrowserEthereumProvider } from "@/lib/services/hive-staking-client";
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
};

type StakePageClientProps = {
  stakingContractAddress: string;
};

function walletKey(wallet: Pick<PersonalWallet, "network" | "address">) {
  return `${wallet.network}:${wallet.address.toLowerCase()}`;
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

export default function StakePageClient({ stakingContractAddress }: StakePageClientProps) {
  const [wallets, setWallets] = useState<PersonalWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<StakeDraft | null>(null);
  const [stakeStatuses, setStakeStatuses] = useState<Record<string, StakeStatusRow>>({});
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
  const nextTier = useMemo(() => HIVE_STAKING_TIERS.find((tier) => Number(tier.thresholdHive) > totalStakedHive) ?? null, [totalStakedHive]);

  const loadStakeStatuses = useCallback(async (walletList: PersonalWallet[]) => {
    const addresses = walletList
      .filter((wallet) => wallet.network === "eip155:8453" && isEvmAddress(wallet.address))
      .map((wallet) => wallet.address);
    if (!addresses.length) {
      setStakeStatuses({});
      return;
    }
    const response = await fetch("/api/hive/stake/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; statuses?: StakeStatusRow[] } | null;
    if (!response?.ok || !data?.ok || !Array.isArray(data.statuses)) return;
    setStakeStatuses(Object.fromEntries(data.statuses.map((row) => [row.address.toLowerCase(), row])));
  }, []);

  const loadWallets = useCallback(async (options: { refresh?: boolean } = {}) => {
    setLoading(true);
    setError("");
    try {
      const loaded = await fetchPersonalWallets();
      const baseWallets = loaded.filter((wallet) => wallet.network === "eip155:8453" && isEvmAddress(wallet.address));
      if (!options.refresh) {
        setWallets(loaded);
        void loadStakeStatuses(loaded);
        setLoading(false);
        return;
      }
      const refreshed = await Promise.all(baseWallets.map((wallet) => refreshWallet(wallet).catch(() => wallet)));
      const byKey = new Map(refreshed.map((wallet) => [walletKey(wallet), wallet]));
      const nextWallets = loaded.map((wallet) => byKey.get(walletKey(wallet)) ?? wallet);
      setWallets(nextWallets);
      void loadStakeStatuses(nextWallets);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load HIVE staking wallets.");
    } finally {
      setLoading(false);
    }
  }, [loadStakeStatuses]);

  useEffect(() => {
    void loadWallets({ refresh: true });
  }, [loadWallets]);

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
      const result = await response.json().catch(() => null) as { ok?: boolean; stakeHash?: string; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Could not stake HIVE.");
      setDraft((current) => current?.rowKey === key ? {
        ...current,
        busy: false,
        error: "",
        message: `Stake sent${result.stakeHash ? ` (${shortenEvmAddress(result.stakeHash)})` : ""}. Refresh after it confirms.`,
      } : current);
      window.setTimeout(() => void refreshAll(), 5000);
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
        message: `Stake sent${result.stakeHash ? ` (${shortenEvmAddress(result.stakeHash)})` : ""}. Refresh after it confirms.`,
      } : current);
      window.setTimeout(() => void refreshAll(), 5000);
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
        <nav className={styles.topBar} aria-label="Stake navigation">
          <Link href="/?view=wallet"><ArrowLeft aria-hidden="true" /> Wallets</Link>
          <Link href="/docs/monetization/hive-staking-and-community-tiers.html">Tier docs</Link>
        </nav>

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><Sparkles aria-hidden="true" /> HIVE staking</p>
            <h1>Stake HIVE to unlock community status, alpha rooms, and curation rights.</h1>
            <p>Staking is not a payment. Your HIVE stays yours while it is locked in the Base staking contract, and benefits pause when you unstake.</p>
            <div className={styles.benefits}>
              <span>Early zero-human company workflow drops</span>
              <span>Governance signaling and roadmap weight</span>
              <span>Bounty boosting and curator eligibility</span>
              <span>Marketplace trust, badges, and Honey multipliers</span>
            </div>
          </div>
          <aside className={styles.summary} aria-label="HIVE staking summary">
            <div className={`${styles.summaryCard} ${styles.summaryCardFeature}`}>
              <span>Detected HIVE</span>
              <strong>{formatHive(totalHive)}</strong>
            </div>
            <div className={styles.summaryCard}>
              <span>Active stake</span>
              <strong>{formatHive(totalStakedHive)}</strong>
            </div>
            <div className={styles.summaryCard}>
              <span>Pending unstake</span>
              <strong>{formatHive(totalPendingUnstakeHive)}</strong>
            </div>
            <div className={styles.summaryCard}>
              <span>Wallets with HIVE</span>
              <strong>{hiveRows.length}</strong>
            </div>
            <div className={styles.summaryCard}>
              <span>Next tier by active stake</span>
              <strong>{nextTier ? nextTier.label : "Visionary+"}</strong>
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
            {HIVE_STAKING_TIERS.map((tier) => {
              const reached = totalStakedHive >= Number(tier.thresholdHive);
              const isNext = nextTier?.id === tier.id;
              const cardClass = [
                styles.tierCard,
                reached ? styles.tierCardReached : "",
                isNext ? styles.tierCardNext : "",
              ].filter(Boolean).join(" ");
              return (
                <article key={tier.id} className={cardClass}>
                  <div className={styles.tierTop}>
                    <strong>{tier.label}</strong>
                    {reached ? (
                      <span className={`${styles.tierBadge} ${styles.tierBadgeReached}`}>
                        <Check aria-hidden="true" size={11} /> Reached
                      </span>
                    ) : isNext ? (
                      <span className={`${styles.tierBadge} ${styles.tierBadgeNext}`}>Next</span>
                    ) : null}
                  </div>
                  <span className={styles.tierThreshold}>{tierAmount(tier.thresholdHive)}</span>
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
              <p className={styles.panelIntro}>Balances are pulled from the same personal Base wallets shown in the Wallets view.</p>
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
                        <LockKeyhole aria-hidden="true" />
                        {activeDraft?.busy ? "Signing" : "Stake"}
                      </button>
                    </div>
                    {!canStakeInThisRuntime ? <p className={styles.status} data-tone="error">Desktop staking needs a local imported/generated wallet. Browser extension wallets cannot sign inside Tauri.</p> : null}
                    {activeDraft?.message ? <p className={styles.status} data-tone="ok">{activeDraft.message}</p> : null}
                    {activeDraft?.error ? <p className={styles.status} data-tone="error">{activeDraft.error}</p> : null}
                  </div>
                </article>
              );
            }) : (
              <div className={styles.empty}>No Base HIVE balances found yet. Connect a wallet or refresh your Wallets view.</div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
