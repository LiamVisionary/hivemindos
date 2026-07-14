"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Coins, RefreshCw, ShieldCheck } from "lucide-react";

import { LoadingBar, Skeleton, Spinner } from "@/features/dashboard/views/zero-human-companies/primitives";
import "@/features/dashboard/views/zero-human-companies/theme.css";

// User confirms the wallet payment by clicking "Pay" — this token satisfies the
// x402 approval gate on the funding route (shared with the Models top-up flow).
const FUND_CONFIRMATION = "FUND_HIVEMINDOS_CREDITS";

type FundingWallet = { id: string; name: string; address: string; network: string };

type CreditAccount = {
  id: string;
  slug: string;
  payer: string;
  network: string;
  tokenHash: string;
  balanceUsd: number;
  totalCreditedUsd: number;
  totalDebitedUsd: number;
  createdAt: string;
  updatedAt: string;
  label: string | null;
};

// Balance below this reads as "at risk of draining" — the per-run X-read floor
// is ~$1.30, so anything under a few runs' worth is flagged amber.
const LOW_BALANCE_USD = 5;

function usd(value: number): string {
  return `$${(Number.isFinite(value) ? value : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function shortId(id: string): string {
  return id.length > 20 ? `${id.slice(0, 12)}…${id.slice(-6)}` : id;
}

function accountName(account: CreditAccount): string {
  if (account.label) return account.label;
  if (account.payer) return account.payer;
  return shortId(account.id);
}

export function HivemindOSManagementPanel() {
  const [accounts, setAccounts] = useState<CreditAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fundingId, setFundingId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [wallets, setWallets] = useState<FundingWallet[]>([]);
  const [walletChoice, setWalletChoice] = useState<Record<string, string>>({});
  const [walletAmount, setWalletAmount] = useState<Record<string, string>>({});
  const [walletBusyId, setWalletBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/credit-accounts", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error || `Could not load credit accounts (HTTP ${res.status}).`);
        setAccounts(null);
        return;
      }
      setAccounts(Array.isArray(body.accounts) ? body.accounts : []);
    } catch {
      setError("The credit gateway is unreachable right now.");
      setAccounts(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Load local Base signing wallets that can pay a top-up over x402 (USDC).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/wallet/personal", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        const list: FundingWallet[] = Array.isArray(body?.wallets) ? body.wallets : Array.isArray(body?.accounts) ? body.accounts : [];
        const base = list.filter((w) => w && w.network === "eip155:8453" && w.address);
        if (!cancelled) setWallets(base);
      } catch { /* wallet funding stays hidden if the list can't load */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const fundFromWallet = useCallback(async (account: CreditAccount) => {
    if (!account.label) return;
    const walletVaultId = walletChoice[account.id] || wallets[0]?.id || "";
    const amountUsd = Number(walletAmount[account.id]);
    if (!walletVaultId) { setNotice("Pick a funding wallet first."); return; }
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) { setNotice("Enter a positive USDC amount."); return; }
    setWalletBusyId(account.id);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/credit-accounts/fund-with-wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountLabel: account.label, walletVaultId, amountUsd, confirmation: FUND_CONFIRMATION }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) { setNotice(body?.error || `Wallet payment failed (HTTP ${res.status}).`); return; }
      setNotice(`Paid ${usd(body.creditedUsd ?? amountUsd)} USDC to ${account.label} from ${walletVaultId}.`);
      setWalletAmount((prev) => ({ ...prev, [account.id]: "" }));
      await load();
    } catch {
      setNotice("The wallet payment could not be completed.");
    } finally {
      setWalletBusyId(null);
    }
  }, [walletChoice, walletAmount, wallets, load]);

  const fund = useCallback(async (account: CreditAccount) => {
    const amountUsd = Number(amounts[account.id]);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      setNotice("Enter a positive amount to add.");
      return;
    }
    setFundingId(account.id);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/credit-accounts/fund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: account.id, amountUsd, reason: "admin console top-up" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setNotice(body?.error || `Funding failed (HTTP ${res.status}).`);
        return;
      }
      setNotice(body.duplicate
        ? `Already credited — ${accountName(account)} is at ${usd(body.balanceUsd)}.`
        : `Added ${usd(amountUsd)} to ${accountName(account)} — now ${usd(body.balanceUsd)}.`);
      setAmounts((prev) => ({ ...prev, [account.id]: "" }));
      await load();
    } catch {
      setNotice("The credit gateway is unreachable right now.");
    } finally {
      setFundingId(null);
    }
  }, [amounts, load]);

  const totalBalance = useMemo(
    () => (accounts ?? []).reduce((sum, account) => sum + (account.balanceUsd || 0), 0),
    [accounts],
  );

  return (
    <section style={{ position: "fixed", inset: 0, overflowY: "auto", background: "var(--bg)", color: "var(--fg)", padding: "28px 32px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <ShieldCheck size={22} color="var(--live)" />
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>HivemindOS Credit Accounts</h1>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh accounts"
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 500, fontSize: 13, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-2, transparent)", color: "var(--fg)", cursor: loading ? "default" : "pointer" }}
          >
            {loading ? <Spinner /> : <RefreshCw size={14} />} Refresh
          </button>
        </header>
        <p style={{ fontSize: 13, color: "var(--fg-2)", margin: "0 0 20px" }}>
          Every internal prepaid credit account and its balance. Fund any account directly — no card or wallet needed.
          {accounts ? <> Total across {accounts.length} account{accounts.length === 1 ? "" : "s"}: <strong style={{ color: "var(--fg)" }}>{usd(totalBalance)}</strong>.</> : null}
        </p>

        {notice ? (
          <div role="status" style={{ fontSize: 13, fontWeight: 500, padding: "10px 14px", borderRadius: 8, marginBottom: 16, border: "1px solid color-mix(in srgb, var(--live) 30%, transparent)", background: "var(--live-soft, transparent)", color: "var(--live)" }}>{notice}</div>
        ) : null}

        {error ? (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, padding: "12px 14px", borderRadius: 8, border: "1px solid color-mix(in srgb, #e5484d 34%, transparent)", background: "color-mix(in srgb, #e5484d 8%, transparent)", color: "var(--fg)" }}>
            <AlertTriangle size={16} color="#e5484d" style={{ flex: "0 0 auto", marginTop: 1 }} />
            <span>{error}</span>
          </div>
        ) : null}

        {loading && !accounts ? (
          <div role="status" aria-label="Loading credit accounts" style={{ display: "grid", gap: 10 }}>
            <LoadingBar />
            {[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 84, borderRadius: 12 }} />)}
          </div>
        ) : null}

        {accounts && accounts.length === 0 && !error ? (
          <p style={{ fontSize: 13, color: "var(--fg-2)" }}>No credit accounts found.</p>
        ) : null}

        <div style={{ display: "grid", gap: 12 }}>
          {(accounts ?? []).map((account) => {
            const low = account.balanceUsd < LOW_BALANCE_USD;
            const busy = fundingId === account.id;
            return (
              <div key={account.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", background: "var(--bg-2, transparent)" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 12px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14.5, fontWeight: 600 }}>
                    <Coins size={15} color={low ? "#f5a623" : "var(--live)"} />
                    {accountName(account)}
                  </span>
                  <code style={{ fontSize: 11, color: "var(--fg-3, var(--fg-2))" }}>{account.id}</code>
                  <span style={{ fontSize: 11, color: "var(--fg-3, var(--fg-2))" }}>· {account.network} · {account.slug}</span>
                  <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 600, color: low ? "#f5a623" : "var(--fg)" }}>{usd(account.balanceUsd)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--fg-2)", marginTop: 4 }}>
                  credited {usd(account.totalCreditedUsd)} · debited {usd(account.totalDebitedUsd)}
                  {low ? <span style={{ color: "#f5a623", fontWeight: 500 }}> · low balance</span> : null}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "var(--fg-2)" }}>$</span>
                  <input
                    inputMode="decimal"
                    placeholder="Amount"
                    value={amounts[account.id] ?? ""}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [account.id]: e.target.value }))}
                    disabled={busy}
                    style={{ width: 120, fontSize: 13, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)" }}
                  />
                  <button
                    type="button"
                    onClick={() => void fund(account)}
                    disabled={busy}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500, padding: "7px 14px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--live) 40%, transparent)", background: "color-mix(in srgb, var(--live) 12%, transparent)", color: "var(--live)", cursor: busy ? "default" : "pointer" }}
                  >
                    {busy ? <><Spinner /> Adding…</> : "Add funds"}
                  </button>
                </div>
                {account.label && wallets.length > 0 ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11.5, color: "var(--fg-3, var(--fg-2))" }}>or pay USDC from</span>
                    <select
                      value={walletChoice[account.id] ?? wallets[0]?.id ?? ""}
                      onChange={(e) => setWalletChoice((prev) => ({ ...prev, [account.id]: e.target.value }))}
                      disabled={walletBusyId === account.id}
                      style={{ fontSize: 12.5, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)", maxWidth: 200 }}
                    >
                      {wallets.map((w) => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
                    </select>
                    <input
                      inputMode="decimal"
                      placeholder="USDC"
                      value={walletAmount[account.id] ?? ""}
                      onChange={(e) => setWalletAmount((prev) => ({ ...prev, [account.id]: e.target.value }))}
                      disabled={walletBusyId === account.id}
                      style={{ width: 90, fontSize: 12.5, padding: "6px 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)" }}
                    />
                    <button
                      type="button"
                      onClick={() => void fundFromWallet(account)}
                      disabled={walletBusyId === account.id}
                      title="Pays USDC from the selected wallet over x402 and credits this account"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 500, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-2, transparent)", color: "var(--fg)", cursor: walletBusyId === account.id ? "default" : "pointer" }}
                    >
                      {walletBusyId === account.id ? <><Spinner /> Paying…</> : "Pay from wallet"}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
