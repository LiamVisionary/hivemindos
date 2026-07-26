"use client";

/* Chat-route "fund this agent" modal. Same rail as the Wallets route: a local
 * personal wallet sends the recipient chain's stablecoin through the shared
 * fund-agent client (approval token + SEND_USDC confirmation + recipient gas
 * sponsorship), so behavior cannot drift between the two surfaces. */

import { useEffect, useMemo, useState } from "react";
import { Check, HandCoins, LoaderCircle, X } from "lucide-react";

import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { fetchPersonalWalletRecords } from "@/lib/native/personal-wallets";
import {
  executeAgentFunding,
  fundingNetworkLabel,
  stableSendAssetForNetwork,
} from "@/lib/services/wallet/fund-agent-client";
import {
  buildGroupedPersonalWallets,
  mergePersonalWalletSources,
  txExplorerName,
  txExplorerUrl,
  type GroupedPersonalWallet,
} from "@/lib/utils/personal-wallet-grouping";

import styles from "./agent-asset-overview.module.css";

const GAS_RESERVE_ETH = 0.00001;

function stableBalance(wallet: GroupedPersonalWallet, asset: string): number {
  return wallet.holdings.find(([symbol]) => symbol === asset)?.[1] ?? 0;
}

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: value < 1 ? 6 : 2 });
}

export function AgentFundModal({
  agent,
  recipientWallet,
  walletsByAgent,
  vaultPath,
  refreshWalletBalance,
  onClose,
}: {
  agent: AgentProfile;
  recipientWallet: AgentWalletConfig;
  walletsByAgent?: Record<string, AgentWalletConfig>;
  vaultPath?: string;
  refreshWalletBalance?: (agentId: string) => Promise<AgentWalletConfig | null | undefined>;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<Array<Record<string, unknown>> | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<"idle" | "funding" | "funded">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ signature?: string; recipientBalanceUsd?: number } | null>(null);

  const asset = stableSendAssetForNetwork(String(recipientWallet.network || ""));
  const networkLabel = fundingNetworkLabel(String(recipientWallet.network || ""));
  const recipientAddress = String(recipientWallet.walletAddress || recipientWallet.vaultAddress || "");

  useEffect(() => {
    let ignore = false;
    void fetchPersonalWalletRecords(vaultPath)
      .then((rows) => { if (!ignore) setRecords(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!ignore) setRecords([]); });
    return () => { ignore = true; };
  }, [vaultPath]);

  const mergedRecords = useMemo(
    () => mergePersonalWalletSources(records ?? [], walletsByAgent),
    [records, walletsByAgent],
  );

  const sources = useMemo(() => {
    return buildGroupedPersonalWallets(mergedRecords)
      .filter((wallet) => wallet.canSpend && stableBalance(wallet, asset) > 0)
      .sort((left, right) => stableBalance(right, asset) - stableBalance(left, asset));
  }, [mergedRecords, asset]);

  const source = sources.find((wallet) => wallet.id === selectedSourceId) ?? sources[0] ?? null;
  const available = source ? stableBalance(source, asset) : 0;
  const fundAmount = Number(amount);
  const funding = phase === "funding";
  const funded = phase === "funded";
  const canSubmit = !funding && !funded && Boolean(source) && Boolean(recipientAddress)
    && Number.isFinite(fundAmount) && fundAmount > 0 && fundAmount <= available;

  const baseEthBalance = source?.holdings.find(([symbol]) => symbol === "ETH")?.[1] ?? 0;
  const needsGasAssist = Boolean(
    source
    && asset === "USDC"
    && source.accounts.some((account) => account.network === "eip155:8453")
    && baseEthBalance < GAS_RESERVE_ETH,
  );

  const explorerNetwork = String(recipientWallet.network || "eip155:8453");
  const explorerUrl = result?.signature ? txExplorerUrl(explorerNetwork, result.signature) : "";

  const submit = async () => {
    if (funded) { onClose(); return; }
    if (!canSubmit || !source) return;
    setPhase("funding");
    setError("");
    try {
      const data = await executeAgentFunding({
        source,
        recipientAgentId: agent.id,
        recipientWallet,
        asset,
        amountUsd: fundAmount,
        confirmation: "SEND_USDC",
        personalWallets: mergedRecords,
      });
      const refreshed = await refreshWalletBalance?.(agent.id).catch(() => null);
      const recipientBalanceUsd = Number(refreshed?.currentBalanceUsd ?? refreshed?.onchainBalanceUsd);
      setResult({
        signature: data.signature,
        recipientBalanceUsd: Number.isFinite(recipientBalanceUsd) ? recipientBalanceUsd : undefined,
      });
      setPhase("funded");
    } catch (cause) {
      setPhase("idle");
      setError(cause instanceof Error ? cause.message : "Funding failed.");
    }
  };

  return (
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget && !funding) onClose(); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label={`Fund ${agent.name}`}>
        <header className={styles.modalHeader}>
          <HandCoins aria-hidden="true" />
          <h2>Fund {agent.name}</h2>
          <button type="button" className={styles.modalClose} aria-label="Close fund dialog" onClick={onClose} disabled={funding}>
            <X size={15} />
          </button>
        </header>
        <div className={styles.modalBody}>
          <p className={styles.help}>
            This agent receives {asset} on {networkLabel}. The transfer runs from a local personal wallet with the same
            approval flow as the Wallets route.
          </p>
          {!recipientAddress ? (
            <p className={styles.error}>
              {agent.name} has no deposit address yet. Set up its wallet from the Wallets view first.
            </p>
          ) : null}

          <div className={styles.modalSection}>
            <span className={styles.modalSectionTitle}>From wallet</span>
            {records === null ? (
              <div className={styles.rows} role="status" aria-label="Loading personal wallets">
                <div className={styles.skel} style={{ width: "88%" }} />
                <div className={styles.skel} style={{ width: "64%" }} />
              </div>
            ) : sources.length === 0 ? (
              <p className={styles.empty}>No local personal wallet holds spendable {asset}. Add or fund one in the Wallets view first.</p>
            ) : (
              <div className={styles.sourceGrid}>
                {sources.map((wallet) => (
                  <button
                    key={wallet.id}
                    type="button"
                    className={styles.sourceCard}
                    data-sel={(source?.id === wallet.id) ? "" : undefined}
                    onClick={() => { if (!funding && !funded) { setSelectedSourceId(wallet.id); setError(""); } }}
                  >
                    <b>{wallet.name}</b>
                    <small>{formatAmount(stableBalance(wallet, asset))} {asset} available · {wallet.kind}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={styles.modalSection}>
            <span className={styles.modalSectionTitle}>Amount</span>
            <div className={styles.amountRow}>
              <input
                className={styles.amountField}
                value={amount}
                inputMode="decimal"
                placeholder={source ? `Up to ${formatAmount(available)}` : "Select a wallet first"}
                disabled={!source || funding || funded}
                onChange={(event) => { setAmount(event.target.value); setError(""); }}
              />
              <span className={styles.assetTag}>{asset}</span>
            </div>
          </div>

          {needsGasAssist ? (
            <p className={styles.help}>
              This wallet is short on Base gas. {agent.name} will first cover only the missing gas reserve, up to
              {" "}{GAS_RESERVE_ETH} ETH, then receive the {asset}.
            </p>
          ) : null}

          {funded ? (
            <div className={styles.success}>
              <Check size={16} aria-hidden="true" />
              <div>
                <strong>{formatAmount(fundAmount)} {asset} sent to {agent.name}.</strong>{" "}
                {result?.recipientBalanceUsd != null
                  ? `The wallet now holds $${result.recipientBalanceUsd.toFixed(2)}.`
                  : "Refresh the wallet balance to verify the new total."}
                {explorerUrl ? (
                  <>
                    {" "}
                    <a href={explorerUrl} target="_blank" rel="noreferrer">View on {txExplorerName(explorerNetwork)} ↗</a>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.modalActions}>
            <button type="button" className={styles.primaryBtn} disabled={!canSubmit && !funded} onClick={() => void submit()}>
              {funding
                ? <LoaderCircle size={14} className={styles.spin} aria-hidden="true" />
                : funded
                  ? <Check size={14} aria-hidden="true" />
                  : <HandCoins size={14} aria-hidden="true" />}
              {funding ? "Funding" : funded ? "Done" : `Fund ${agent.name}`}
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={funding}>
              {funded ? "Close" : "Cancel"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
