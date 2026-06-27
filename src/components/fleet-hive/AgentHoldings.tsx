"use client";

import { ArrowRight } from "lucide-react";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import type { HiveAgent } from "./fleet-hive-types";

type CurrencySymbol = "USD" | "USDC" | "ETH" | "BANKR" | "HIVE";

interface Balance {
  sym: CurrencySymbol;
  amount: number;
}

interface CurrencyMeta {
  price: number;
  name: string;
  color: string;
  chg: number;
  fiat?: boolean;
  img?: string;
}

interface RankedBalance extends Balance {
  usd: number;
  change: number;
}

const FR_CCY: Record<CurrencySymbol, CurrencyMeta> = {
  USD: { price: 1, fiat: true, name: "US Dollar", color: "#3b9e6f", chg: 0 },
  USDC: { price: 1, name: "USD Coin", color: "#2775ca", chg: 0.02 },
  ETH: { price: 3200, name: "Ethereum", color: "#627eea", chg: 2.48 },
  BANKR: { price: 0.05, name: "Bankr", color: "#8b5cf6", chg: 4.1 },
  HIVE: { price: 0.34, name: "Hive", color: "#0e1118", chg: 28.4, img: "/hive-icon.png" },
};

function isCurrencySymbol(value: string): value is CurrencySymbol {
  return Object.prototype.hasOwnProperty.call(FR_CCY, value);
}

function normalizeCurrencySymbol(value?: string | null): CurrencySymbol {
  const symbol = (value || "USDC").trim().toUpperCase();
  if (isCurrencySymbol(symbol)) return symbol;
  if (symbol === "USD COIN") return "USDC";
  return "USDC";
}

function normalizePositive(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function frFmtAmount(sym: CurrencySymbol, amt: number): string {
  if (sym === "ETH") return amt.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (FR_CCY[sym]?.fiat) return `$${Math.round(amt).toLocaleString()}`;
  if (amt >= 10000) return `${Math.round(amt / 1000)}k`;
  if (amt >= 1000 && sym !== "USDC") return `${(amt / 1000).toFixed(1)}k`;
  return Math.round(amt).toLocaleString();
}

function frFmtUsdFull(v: number): string {
  if (v >= 1000) return `$${Math.round(v).toLocaleString()}`;
  return `$${v.toFixed(2)}`;
}

function frFmtChange(usdChg: number): { text: string; tone: "muted" | "up" | "down" } {
  const sign = usdChg < 0 ? "-" : "+";
  const abs = Math.abs(usdChg);
  if (abs === 0) return { text: "$0.00", tone: "muted" };
  if (abs < 0.01) return { text: `${sign}<$0.01`, tone: usdChg < 0 ? "down" : "up" };
  const value = abs >= 1000 ? Math.round(abs).toLocaleString() : abs.toFixed(2);
  return { text: `${sign}$${value}`, tone: usdChg < 0 ? "down" : "up" };
}

function frTopBalances(balances: Balance[] = [], n = 4): { top: RankedBalance[]; total: number } {
  const list = balances
    .map((balance) => {
      const usd = balance.amount * (FR_CCY[balance.sym]?.price ?? 0);
      return { ...balance, usd, change: (usd * (FR_CCY[balance.sym]?.chg ?? 0)) / 100 };
    })
    .filter((balance) => balance.amount > 0)
    .sort((left, right) => right.usd - left.usd);
  return { top: list.slice(0, n), total: list.reduce((sum, balance) => sum + balance.usd, 0) };
}

function walletBalances(agent: HiveAgent, wallet?: AgentWalletConfig): Balance[] {
  const balances: Balance[] = [];
  if (wallet) {
    const token = normalizeCurrencySymbol(wallet.tokenSymbol);
    const onchainUsd = normalizePositive(wallet.onchainBalanceUsd);
    const tokenUsd = onchainUsd > 0 ? onchainUsd : normalizePositive(wallet.currentBalanceUsd);
    if (tokenUsd > 0) balances.push({ sym: token, amount: tokenUsd / FR_CCY[token].price });
  }

  if (balances.length) return balances;
  const displayWallet = agent.wallet.trim();
  if (!displayWallet || displayWallet === "—" || displayWallet.toLowerCase() === "off") return [];

  const usdMatch = /^\$([\d,.]+)/.exec(displayWallet);
  if (usdMatch) return [{ sym: "USD", amount: Number(usdMatch[1].replace(/,/g, "")) || 0 }];

  const tokenMatch = /^([\d,.]+)\s*([a-zA-Z]+)$/.exec(displayWallet);
  if (!tokenMatch) return [];
  const symbol = normalizeCurrencySymbol(tokenMatch[2]);
  return [{ sym: symbol, amount: Number(tokenMatch[1].replace(/,/g, "")) || 0 }];
}

function TokenIcon({ sym }: { sym: CurrencySymbol }) {
  const meta = FR_CCY[sym];
  if (meta.img) {
    return (
      <span className="fr-holding-icon" style={{ background: meta.color }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={meta.img} width={32} height={32} alt="" />
      </span>
    );
  }
  if (sym === "ETH") {
    return (
      <span className="fr-holding-icon" style={{ background: meta.color }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff" aria-hidden="true" focusable="false">
          <path d="M12 2 5.6 12.1 12 15.9l6.4-3.8L12 2z" opacity="0.92" />
          <path d="M5.6 13.3 12 22l6.4-8.7L12 17.1 5.6 13.3z" opacity="0.7" />
        </svg>
      </span>
    );
  }
  return (
    <span className="fr-holding-icon" style={{ background: meta.color }}>
      <span>{sym === "BANKR" ? "B" : "$"}</span>
    </span>
  );
}

export function AgentHoldings({
  agent,
  wallet,
  topN = 4,
  onViewWallet,
}: {
  agent: HiveAgent;
  wallet?: AgentWalletConfig;
  topN?: number;
  onViewWallet?: () => void;
}) {
  const { top, total } = frTopBalances(walletBalances(agent, wallet), topN);

  return (
    <section className="fr-holdings" aria-label={`${agent.name} holdings`}>
      <div className="fr-holdings-header">
        <span className="fr-eyebrow">Holdings</span>
        <span>{top.length ? frFmtUsdFull(total) : "—"}</span>
      </div>

      {top.length ? (
        <div className="fr-holdings-list">
          {top.map((balance) => {
            const meta = FR_CCY[balance.sym];
            const change = frFmtChange(balance.change);
            return (
              <div className="fr-holding-row" key={balance.sym}>
                <TokenIcon sym={balance.sym} />
                <div className="fr-holding-main">
                  <strong>{meta.name}</strong>
                  <span>{frFmtAmount(balance.sym, balance.amount)} {balance.sym}</span>
                </div>
                <div className="fr-holding-value">
                  <strong>{frFmtUsdFull(balance.usd)}</strong>
                  <span data-tone={change.tone}>{change.text}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="fr-holdings-empty">No holdings yet.</div>
      )}

      <button type="button" className="fr-holdings-wallet" disabled={!onViewWallet} onClick={onViewWallet}>
        See full wallet
        <ArrowRight aria-hidden="true" size={13} strokeWidth={2} />
      </button>
    </section>
  );
}
