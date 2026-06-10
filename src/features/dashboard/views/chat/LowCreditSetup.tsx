"use client";

import { useState } from "react";
import { LoaderCircle, RefreshCcw, WalletCards } from "lucide-react";

const CUSTOM_SOURCE_TOKEN = "__custom_source_token__";
const fieldLabelClass = "grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]";
const fieldControlClass = "min-h-[2.75rem] min-w-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.72)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]";

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
  variant?: "full" | "compact";
  compactMessage?: string;
  confirmationLabel?: string;
  defaultAmountUsd?: number;
  onRefresh?: () => void | Promise<void>;
  onExpand?: () => void | Promise<void>;
  onFund: (input: { amountUsd: number; token: string; confirmation: string }) => void | Promise<void>;
};

export function LowCreditSetup({
  creditLabel,
  balanceLabel = "Unknown",
  diagnostic,
  fundingOptions,
  busy = false,
  status = "",
  variant = "full",
  compactMessage = "Top up credits to access the full set of models.",
  confirmationLabel = "FUND_PROVIDER_CREDITS",
  defaultAmountUsd = 10,
  onRefresh,
  onExpand,
  onFund,
}: LowCreditSetupProps) {
  const [amountUsd, setAmountUsd] = useState(String(defaultAmountUsd));
  const [selectedToken, setSelectedToken] = useState(fundingOptions[0]?.token ?? "");
  const [customToken, setCustomToken] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [expanded, setExpanded] = useState(variant === "full");
  const selectedSourceToken = selectedToken || fundingOptions[0]?.token || "";
  const customSourceSelected = selectedSourceToken === CUSTOM_SOURCE_TOKEN;
  const token = customSourceSelected ? customToken.trim() : selectedSourceToken;
  const amount = Number(amountUsd);
  const canFund = Number.isFinite(amount) && amount > 0 && token && confirmation.trim() === confirmationLabel && !busy;
  const selectedOption = fundingOptions.find((option) => option.token === selectedSourceToken);

  if (variant === "compact" && !expanded) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <WalletCards aria-hidden="true" className="h-4 w-4 flex-none text-[var(--accent-strong)]" />
          <p className="m-0 text-xs leading-5 text-[var(--muted)]">
            <strong className="text-[var(--foreground)]">{creditLabel} credits are low.</strong> {compactMessage}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {balanceLabel ? <span className="font-mono text-xs text-[var(--foreground)]">{balanceLabel}</span> : null}
          {onRefresh ? (
            <button type="button" disabled={busy} onClick={() => void onRefresh()} className="inline-flex items-center gap-1 rounded-md border border-[rgba(148,163,184,0.16)] px-2 py-1 text-xs font-semibold text-[var(--foreground)] disabled:opacity-50">
              <RefreshCcw aria-hidden="true" className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              Refresh
            </button>
          ) : null}
          <button type="button" onClick={() => { setExpanded(true); void onExpand?.(); }} className="inline-flex items-center gap-1 rounded-md border border-[rgba(94,234,212,0.24)] bg-[rgba(20,184,166,0.12)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-strong)]">
            <WalletCards aria-hidden="true" className="h-3.5 w-3.5" />
            Top up
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-4 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(8,13,20,0.86)] p-4">
      <header className="relative pr-24">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-md border border-[rgba(94,234,212,0.2)] bg-[rgba(20,184,166,0.08)]">
            <WalletCards aria-hidden="true" className="h-5 w-5 text-[var(--accent-strong)]" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-300">Credits</p>
              <span className="rounded-full border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.62)] px-2 py-0.5 font-mono text-xs text-[var(--foreground)]">{balanceLabel}</span>
            </div>
            <h3 className="m-0 mt-2 text-base font-bold text-[var(--foreground)]">{creditLabel} credits are low</h3>
            <p className="m-0 mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
              Choose a source balance, enter an amount, then confirm the top-up to restore access.
            </p>
          </div>
        </div>
        {onRefresh ? (
          <button type="button" disabled={busy} onClick={() => void onRefresh()} className="absolute right-0 top-0 inline-flex min-h-9 items-center gap-2 rounded-md border border-[rgba(148,163,184,0.16)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] disabled:opacity-50">
            <RefreshCcw aria-hidden="true" className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            Refresh
          </button>
        ) : null}
      </header>

      <div className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,21,0.32)] p-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)]">
          <label className={fieldLabelClass}>
            Amount
            <input
              value={amountUsd}
              onChange={(event) => setAmountUsd(event.target.value)}
              inputMode="decimal"
              className={`${fieldControlClass} font-mono normal-case tracking-normal`}
              placeholder="10"
            />
          </label>
          <label className={fieldLabelClass}>
            Source balance
            <select
              value={selectedSourceToken}
              onChange={(event) => setSelectedToken(event.target.value)}
              className={`${fieldControlClass} font-mono normal-case tracking-normal`}
            >
              {!fundingOptions.length ? <option value="">No balances found</option> : null}
              {fundingOptions.map((option) => (
                <option value={option.token} key={`${option.token}:${option.detail}`}>{option.label}{option.balanceLabel ? ` · ${option.balanceLabel}` : ""}</option>
              ))}
              <option value={CUSTOM_SOURCE_TOKEN}>Other</option>
            </select>
            {selectedOption?.detail ? <span className="text-xs font-normal normal-case leading-5 tracking-normal text-[var(--muted)]">{selectedOption.detail}</span> : null}
          </label>
        </div>

        {customSourceSelected ? (
          <label className={fieldLabelClass}>
            Use another token or contract
            <input
              value={customToken}
              onChange={(event) => setCustomToken(event.target.value)}
              placeholder="Token symbol or contract address"
              className={`${fieldControlClass} font-mono normal-case tracking-normal`}
            />
            <span className="text-xs font-normal normal-case leading-5 tracking-normal text-[var(--muted)]">Enter a supported token symbol or contract address for the funding source.</span>
          </label>
        ) : null}
      </div>

      <div className="grid gap-2 rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,21,0.24)] p-3">
        <p className="m-0 text-xs leading-5 text-[var(--muted)]">
          Type <code className="font-mono text-[var(--foreground)]">{confirmationLabel}</code> to confirm this spend.
        </p>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={confirmationLabel}
            className={`${fieldControlClass} font-mono`}
          />
          <button
            type="button"
            disabled={!canFund}
            onClick={() => void onFund({ amountUsd: amount, token, confirmation })}
            className="inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-md border border-[rgba(94,234,212,0.24)] bg-[rgba(20,184,166,0.12)] px-4 py-2 text-sm font-semibold text-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <WalletCards aria-hidden="true" className="h-4 w-4" />}
            Fund {creditLabel}
          </button>
        </div>
      </div>

      {diagnostic || status ? (
        <div className="grid gap-2">
          {diagnostic ? <p className="m-0 text-xs leading-5 text-[var(--muted)]">{diagnostic}</p> : null}
          {status ? <p className="m-0 rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(10,14,21,0.36)] px-3 py-2 text-xs text-[var(--foreground)]">{status}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
