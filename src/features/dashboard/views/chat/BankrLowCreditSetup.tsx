"use client";

import { useCallback, useEffect, useState } from "react";
import { LowCreditSetup, type LowCreditFundingOption } from "./LowCreditSetup";

type BankrCreditsState = {
  ok?: boolean;
  balanceUsd?: number | null;
  balanceLabel?: string;
  fundingOptions?: LowCreditFundingOption[];
  error?: string;
  message?: string;
};

type BankrLowCreditSetupProps = {
  diagnostic?: string;
  onFunded?: () => void | Promise<void>;
};

const FUND_CONFIRMATION = "FUND_BANKR_LLM_CREDITS";

export function BankrLowCreditSetup({ diagnostic, onFunded }: BankrLowCreditSetupProps) {
  const [state, setState] = useState<BankrCreditsState>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setStatus("Checking Bankr LLM credits...");
    try {
      const response = await fetch("/api/bankr/llm-credits", { cache: "no-store" }).catch(() => null);
      const data = await response?.json().catch(() => null) as BankrCreditsState | null;
      setState(data ?? { ok: false, error: "Could not read Bankr LLM credits." });
      setStatus(data?.ok ? "Bankr LLM credit status refreshed." : data?.error ?? "Could not read Bankr LLM credits.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(handle);
  }, [refresh]);

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
      setState((current) => ({ ...current, ...data }));
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
      diagnostic={diagnostic || state.error}
      fundingOptions={state.fundingOptions ?? []}
      busy={busy}
      status={status}
      confirmationLabel={FUND_CONFIRMATION}
      defaultAmountUsd={10}
      onRefresh={refresh}
      onFund={fund}
    />
  );
}
