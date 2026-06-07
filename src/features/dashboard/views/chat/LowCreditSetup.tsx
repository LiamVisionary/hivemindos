"use client";

import { useState } from "react";
import { LoaderCircle, RefreshCcw, WalletCards } from "lucide-react";

export type LowCreditFundingOption = {
  token: string;
  label: string;
  detail: string;
  balanceLabel?: string;
  balanceUsd?: number;
};

type LowCreditSetupProps = {
  creditLabel: string;
  balanceLabel?: string;
  diagnostic?: string;
  fundingOptions: LowCreditFundingOption[];
  busy?: boolean;
  status?: string;
  confirmationLabel?: string;
  defaultAmountUsd?: number;
  onRefresh?: () => void | Promise<void>;
  onFund: (input: { amountUsd: number; token: string; confirmation: string }) => void | Promise<void>;
};

export function LowCreditSetup({
  creditLabel,
  balanceLabel = "Unknown",
  diagnostic,
  fundingOptions,
  busy = false,
  status = "",
  confirmationLabel = "FUND_PROVIDER_CREDITS",
  defaultAmountUsd = 10,
  onRefresh,
  onFund,
}: LowCreditSetupProps) {
  const [amountUsd, setAmountUsd] = useState(String(defaultAmountUsd));
  const [selectedToken, setSelectedToken] = useState(fundingOptions[0]?.token ?? "");
  const [customToken, setCustomToken] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const selectedSourceToken = selectedToken || fundingOptions[0]?.token || "";
  const token = customToken.trim() || selectedSourceToken;
  const amount = Number(amountUsd);
  const canFund = Number.isFinite(amount) && amount > 0 && token && confirmation.trim() === confirmationLabel && !busy;
  const selectedOption = fundingOptions.find((option) => option.token === selectedSourceToken);

  return (
    <section className="grid gap-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <WalletCards aria-hidden="true" className="mt-0.5 h-5 w-5 text-[var(--accent-strong)]" />
          <div>
            <p className="eyebrow">Credits</p>
            <h3 className="m-0 text-base font-bold text-[var(--foreground)]">{creditLabel} credits are low</h3>
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">
              Current credit balance: <span className="font-mono text-[var(--foreground)]">{balanceLabel}</span>. Choose a funded source balance, review the amount, then confirm the top-up.
            </p>
          </div>
        </div>
        {onRefresh ? (
          <button type="button" disabled={busy} onClick={() => void onRefresh()} className="inline-flex items-center gap-2 rounded-md border border-[rgba(148,163,184,0.16)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] disabled:opacity-50">
            <RefreshCcw aria-hidden="true" className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            Refresh
          </button>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
          Amount
          <input
            value={amountUsd}
            onChange={(event) => setAmountUsd(event.target.value)}
            inputMode="decimal"
            className="min-w-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.72)] px-2 py-2 font-mono text-xs normal-case tracking-normal text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
            placeholder="10"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
          Source balance
          <select
            value={selectedSourceToken}
            onChange={(event) => setSelectedToken(event.target.value)}
            disabled={!fundingOptions.length}
            className="min-w-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.72)] px-2 py-2 font-mono text-xs normal-case tracking-normal text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
          >
            {!fundingOptions.length ? <option value="">No balances found</option> : null}
            {fundingOptions.map((option) => (
              <option value={option.token} key={`${option.token}:${option.detail}`}>{option.label}{option.balanceLabel ? ` · ${option.balanceLabel}` : ""}</option>
            ))}
          </select>
        </label>
      </div>

      {selectedOption?.detail ? <p className="m-0 text-xs leading-5 text-[var(--muted)]">{selectedOption.detail}</p> : null}

      <details className="rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,21,0.28)] p-3">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--muted)]">Use another token or contract</summary>
        <input
          value={customToken}
          onChange={(event) => setCustomToken(event.target.value)}
          placeholder="Token symbol or contract address"
          className="mt-3 min-w-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.72)] px-2 py-2 font-mono text-xs text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
        />
        <p className="m-0 mt-2 text-xs leading-5 text-[var(--muted)]">This overrides the selected source balance for credit systems that support token-address funding.</p>
      </details>

      <div className="grid gap-1">
        <p className="m-0 text-xs leading-5 text-[var(--muted)]">
          Type <code className="font-mono text-[var(--foreground)]">{confirmationLabel}</code> to confirm this spend.
        </p>
        <input
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={confirmationLabel}
          className="min-w-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.72)] px-2 py-2 font-mono text-xs text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
        />
      </div>

      {diagnostic ? <p className="m-0 text-xs leading-5 text-[var(--muted)]">{diagnostic}</p> : null}
      {status ? <p className="m-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] px-3 py-2 text-xs text-[var(--foreground)]">{status}</p> : null}

      <button
        type="button"
        disabled={!canFund}
        onClick={() => void onFund({ amountUsd: amount, token, confirmation })}
        className="inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-md border border-[rgba(94,234,212,0.24)] bg-[rgba(20,184,166,0.12)] px-4 py-2 text-sm font-semibold text-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <WalletCards aria-hidden="true" className="h-4 w-4" />}
        Fund {creditLabel}
      </button>
    </section>
  );
}
