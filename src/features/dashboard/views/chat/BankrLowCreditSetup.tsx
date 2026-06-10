"use client";

import { useCallback, useEffect, useState } from "react";
import { LowCreditSetup, type LowCreditFundingOption } from "./LowCreditSetup";

type BankrCreditsState = {
  ok?: boolean;
  balanceUsd?: number | null;
  balanceLabel?: string;
  fundingOptions?: LowCreditFundingOption[];
  fundingError?: string;
  error?: string;
  message?: string;
};

type BankrLowCreditSetupProps = {
  diagnostic?: string;
  variant?: "full" | "compact";
  initialCredits?: BankrCreditsState;
  onFunded?: () => void | Promise<void>;
};

const FUND_CONFIRMATION = "FUND_BANKR_LLM_CREDITS";

export function BankrLowCreditSetup({ diagnostic, variant = "full", initialCredits, onFunded }: BankrLowCreditSetupProps) {
  const [fetchedState, setFetchedState] = useState<BankrCreditsState>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const state = { ...(initialCredits ?? {}), ...fetchedState };

  const refresh = useCallback(async (includeFundingOptions = true) => {
    setBusy(true);
    setStatus("Checking Bankr LLM credits...");
    try {
      const response = await fetch(`/api/bankr/llm-credits${includeFundingOptions ? "" : "?mode=balance"}`, { cache: "no-store" }).catch(() => null);
      const data = await response?.json().catch(() => null) as BankrCreditsState | null;
      setFetchedState((current) => ({ ...current, ...(data ?? { ok: false, error: "Could not read Bankr LLM credits." }) }));
      setStatus(data?.ok ? "" : data?.error ?? "Could not read Bankr LLM credits.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (variant === "compact" && initialCredits?.balanceLabel) return undefined;
    const handle = window.setTimeout(() => void refresh(variant !== "compact"), 0);
    return () => window.clearTimeout(handle);
  }, [initialCredits?.balanceLabel, refresh, variant]);

  const fund = async (input: { amountUsd: number; token: string; confirmation: string }) => {
    setBusy(true);
    setStatus("Funding Bankr LLM credits...");
    try {
      const response = await fetch("/api/bankr/llm-credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as BankrCreditsState | null;
      if (!response?.ok || !data?.ok) {
        setStatus(data?.error ?? "Could not fund Bankr LLM credits.");
        return;
      }
      setFetchedState((current) => ({ ...current, ...data }));
      setStatus(data.message || "Bankr LLM credits funded.");
      await onFunded?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <LowCreditSetup
      creditLabel="Bankr LLM"
      balanceLabel={state.balanceLabel ?? "Unknown"}
      diagnostic={diagnostic || state.fundingError || state.error}
      fundingOptions={state.fundingOptions ?? []}
      busy={busy}
      status={status}
      variant={variant}
      compactMessage="Top up credits to access the full set of Bankr Max Mode models."
      confirmationLabel={FUND_CONFIRMATION}
      defaultAmountUsd={10}
      onRefresh={refresh}
      onExpand={() => refresh(true)}
      onFund={fund}
    />
  );
}
