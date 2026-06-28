"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCcw, Shield, Sparkles } from "lucide-react";
import { DEFAULT_BASE_HIVE_TOKEN_ADDRESS } from "@/lib/config/hive-staking";
import { isBaseHiveTokenLike, isEvmAddress, shortenEvmAddress } from "@/lib/services/hive-staking-client";
import styles from "./stake.module.css";

type BankrToken = {
  symbol: string;
  balance: number;
  network: string;
  tokenAddress?: string;
  isNative?: boolean;
  valueUsd?: number | null;
};

function formatHive(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 HIVE";
  if (value >= 1_000_000_000) return `${trim(value / 1_000_000_000)}b HIVE`;
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}m HIVE`;
  if (value >= 1_000) return `${trim(value / 1_000)}k HIVE`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })} HIVE`;
}

function trim(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: value >= 10 ? 1 : 2 }).replace(/\.0$/, "");
}

function formatAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 8 });
}

async function fetchBankrWallet() {
  const response = await fetch("/api/bankr/wallet", { headers: { accept: "application/json" } }).catch(() => null);
  const data = await response?.json().catch(() => null) as { ok?: boolean; configured?: boolean; address?: string } | null;
  if (!response?.ok || !data?.ok) return { configured: false, address: "" };
  return { configured: Boolean(data.configured), address: data.address?.trim() || "" };
}

async function fetchHiveBalance(address: string) {
  const response = await fetch("/api/wallet/balance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, network: "eip155:8453" }),
  }).catch(() => null);
  const data = await response?.json().catch(() => null) as { ok?: boolean; balance?: { tokens?: BankrToken[] } } | null;
  if (!response?.ok || !data?.ok || !Array.isArray(data.balance?.tokens)) return 0;
  return data.balance.tokens
    .filter((token) => isBaseHiveTokenLike(token))
    .reduce((total, token) => total + (Number(token.balance) || 0), 0);
}

async function fetchStakedHive(address: string) {
  const response = await fetch("/api/hive/stake/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresses: [address] }),
  }).catch(() => null);
  const data = await response?.json().catch(() => null) as {
    ok?: boolean;
    statuses?: Array<{ address: string; activeStakedHive: number }>;
  } | null;
  if (!response?.ok || !data?.ok || !Array.isArray(data.statuses)) return 0;
  const row = data.statuses.find((status) => status.address.toLowerCase() === address.toLowerCase());
  return Number(row?.activeStakedHive) || 0;
}

export default function BankrStakeCard() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [address, setAddress] = useState("");
  const [hiveBalance, setHiveBalance] = useState(0);
  const [stakedHive, setStakedHive] = useState(0);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadBalances = useCallback(async (addr: string) => {
    const [balance, staked] = await Promise.all([fetchHiveBalance(addr), fetchStakedHive(addr)]);
    setHiveBalance(balance);
    setStakedHive(staked);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchBankrWallet().then(async (info) => {
      if (cancelled) return;
      setConfigured(info.configured);
      if (info.configured && isEvmAddress(info.address)) {
        setAddress(info.address);
        await loadBalances(info.address).catch(() => undefined);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadBalances]);

  async function refresh() {
    if (!isEvmAddress(address)) return;
    setRefreshing(true);
    setError("");
    await loadBalances(address).catch(() => setError("Could not refresh the Bankr HIVE balance."));
    setRefreshing(false);
  }

  async function stake() {
    const value = Number(amount.trim());
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a HIVE amount to stake.");
      setMessage("");
      return;
    }
    if (hiveBalance > 0 && value > hiveBalance) {
      setError("Amount is higher than the Bankr wallet's HIVE balance.");
      setMessage("");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Submitting approval and stake through Bankr...");
    try {
      const response = await fetch("/api/hive/stake/bankr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountHive: amount.trim(),
          tokenAddress: DEFAULT_BASE_HIVE_TOKEN_ADDRESS,
          confirmation: "STAKE_HIVE",
        }),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; stakeHash?: string; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Could not stake HIVE through Bankr.");
      setMessage(`Stake confirmed${result.stakeHash ? ` (${shortenEvmAddress(result.stakeHash)})` : ""}. Refreshing...`);
      setAmount("");
      setTimeout(() => void refresh(), 1000);
    } catch (stakeError) {
      setError(stakeError instanceof Error ? stakeError.message : "Could not stake HIVE through Bankr.");
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  // Hide entirely until we know Bankr is configured — staking from a Bankr wallet
  // only makes sense when the user actually has one wired up.
  if (configured !== true) return null;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={`${styles.eyebrow} ${styles.eyebrowHoney}`}>Bankr wallet</p>
          <h2>Stake from your Bankr wallet</h2>
          <p className={styles.panelIntro}>
            Bankr signs from its own managed wallet, so this stakes the HIVE held in your Bankr account and the stake
            is recorded to the Bankr address. Needs a read-write Bankr key with contract calls enabled, plus a little
            Base ETH for gas.
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryButton} onClick={() => void refresh()} disabled={busy || refreshing}>
            <RefreshCcw aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      <div className={styles.walletList}>
        <article className={styles.walletRow}>
          <div className={styles.walletMain}>
            <strong>Bankr trading wallet</strong>
            <span>
              <i className={styles.custodyDot} aria-hidden="true" />
              {address ? shortenEvmAddress(address) : "Bankr-managed"} · Bankr-managed
            </span>
          </div>
          <div className={styles.walletBalance}>
            <strong>{refreshing ? "Checking…" : formatHive(hiveBalance)}</strong>
            <span><Sparkles size={11} aria-hidden="true" /> Bankr</span>
            <span>{formatHive(stakedHive)} staked</span>
          </div>
          <div className={styles.stakeBox}>
            <div className={styles.stakeForm}>
              <input
                inputMode="decimal"
                value={amount}
                placeholder="Amount"
                onChange={(event) => setAmount(event.target.value)}
                disabled={busy}
                aria-label="HIVE amount to stake from the Bankr wallet"
              />
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => setAmount(formatAmount(hiveBalance))}
                disabled={busy || hiveBalance <= 0}
              >
                Max
              </button>
              <button type="button" className={styles.primaryButton} onClick={() => void stake()} disabled={busy}>
                <Shield aria-hidden="true" />
                {busy ? "Staking…" : "Stake via Bankr"}
              </button>
            </div>
            {message ? <p className={styles.status} data-tone="ok">{message}</p> : null}
            {error ? <p className={styles.status} data-tone="error">{error}</p> : null}
          </div>
        </article>
      </div>
    </section>
  );
}
