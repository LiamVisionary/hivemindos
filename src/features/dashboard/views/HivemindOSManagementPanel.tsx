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
  services?: string[]; // gateway ids this account has been used by, e.g. ["x-studio-gateway"]
};

// Friendly names for the gateway ids stamped on ledger rows.
const SERVICE_LABELS: Record<string, string> = {
  "x-studio-gateway": "X Studio",
  "research-gateway": "Hive Research",
  "media-studio-gateway": "Media Studio",
  "x-transcript-gateway": "X Transcript",
};

function serviceLabel(id: string): string {
  return SERVICE_LABELS[id] || humanizeSlug(id.replace(/-gateway$/, ""));
}

// Balance below this reads as "at risk of draining" — the per-run X-read floor
// is ~$1.30, so anything under a few runs' worth is flagged amber.
const LOW_BALANCE_USD = 5;

function usd(value: number): string {
  return `$${(Number.isFinite(value) ? value : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function shortHex(value: string): string {
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

// "hive-research" -> "Hive Research", "x-studio" -> "X Studio".
function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => (word.toLowerCase() === "x" ? "X" : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ") || slug;
}

function networkLabel(network: string): string {
  if (network === "stripe") return "Card";
  if (network === "eip155:8453") return "Base";
  if (network === "eip155:84532") return "Base Sepolia";
  if (network.startsWith("solana")) return "Solana";
  if (network.startsWith("eip155:")) return `EVM ${network.slice("eip155:".length)}`;
  return network;
}

// A human title. Vault-labeled accounts get their real name; unlabeled ones are
// named by how they were funded (card vs on-chain wallet) with a short handle,
// instead of dumping a raw Stripe id or wallet address.
function prettyAccountName(account: CreditAccount): string {
  const label = (account.label || "").trim();
  if (label) {
    const idx = label.indexOf(":");
    const prefix = idx >= 0 ? label.slice(0, idx) : "";
    const rest = idx >= 0 ? label.slice(idx + 1) : label;
    if (prefix === "service") return humanizeSlug(rest);
    if (label === "shared:hivemindos-models") return "HivemindOS Models (shared pool)";
    // There can be more than one legacy per-install model-credit account; append
    // the short handle so they're distinguishable instead of identically named.
    if (prefix === "hmos-model-credits") return `HivemindOS Models · ${rest.slice(0, 8)}`;
    if (prefix === "agent") return `${humanizeSlug(rest)} agent`;
    return humanizeSlug(rest || label);
  }
  const payer = account.payer || "";
  if (payer.startsWith("stripe:")) return `Card credit · …${payer.slice(-6)}`;
  if (/^0x[a-fA-F0-9]{40}$/.test(payer)) return `Wallet credit · ${shortHex(payer)}`;
  return `Credit account · ${account.id.replace(/^pagw_acct_/, "").slice(0, 8)}`;
}

// One line telling the user what the account IS FOR. The strongest signal is
// which services have actually spent from it (from the ledger); fall back to the
// vault label's role, then the funding source.
function accountKind(account: CreditAccount): string {
  const services = (account.services || []).filter(Boolean);
  const label = (account.label || "").trim();
  if (label.startsWith("service:")) {
    return `Service rail — funds ${prettyAccountName(account)}'s paid API reads`;
  }
  if (label.startsWith("hmos-model-credits:") || label === "shared:hivemindos-models") return "Shared hosted-model credit pool";
  if (label.startsWith("agent:")) return "Agent credit account";
  if (services.length) {
    const funded = account.payer.startsWith("stripe:") ? "Card credit" : account.network.startsWith("eip155") ? "Wallet credit (USDC)" : "Prepaid credit";
    return `${funded}, used by ${services.map(serviceLabel).join(" · ")}`;
  }
  if (account.payer.startsWith("stripe:")) return "Card-funded credit — not used yet";
  if (account.network.startsWith("eip155")) return "Wallet-funded credit (USDC) — not used yet";
  return "Prepaid credit account";
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
  const [customerCount, setCustomerCount] = useState(0);

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
      setCustomerCount(Number(body.customerAccountCount) || 0);
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
        ? `Already credited — ${prettyAccountName(account)} is at ${usd(body.balanceUsd)}.`
        : `Added ${usd(amountUsd)} to ${prettyAccountName(account)} — now ${usd(body.balanceUsd)}.`);
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
          Your internal service, model, and agent credit accounts — the rails that power the apps. Fund any of them directly.
          {accounts ? <> Total across {accounts.length} account{accounts.length === 1 ? "" : "s"}: <strong style={{ color: "var(--fg)" }}>{usd(totalBalance)}</strong>.</> : null}
          {customerCount > 0 ? <> <span style={{ color: "var(--fg-3, var(--fg-2))" }}>({customerCount} customer top-up account{customerCount === 1 ? "" : "s"} hidden — those are customers' own balances, not managed here.)</span></> : null}
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
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 15, fontWeight: 600 }}>
                    <Coins size={15} color={low ? "#f5a623" : "var(--live)"} />
                    {prettyAccountName(account)}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 600, color: low ? "#f5a623" : "var(--fg)" }}>{usd(account.balanceUsd)}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 3 }}>
                  {accountKind(account)}
                  {low ? <span style={{ color: "#f5a623", fontWeight: 500 }}> · low balance</span> : null}
                </div>
                <div style={{ fontSize: 11, color: "var(--fg-3, var(--fg-2))", marginTop: 3, display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "center" }}>
                  <span>{networkLabel(account.network)}</span>
                  <span>· credited {usd(account.totalCreditedUsd)} · debited {usd(account.totalDebitedUsd)}</span>
                  <code style={{ opacity: 0.75 }}>· {account.id}</code>
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
