"use client";

import React from "react";
import { Download, X } from "lucide-react";
import { WALLET_SECRET_EXPORT_CONFIRMATION } from "@/lib/services/wallet/wallet-secret-export";

type WalletSecretExportResult = {
  ok?: boolean;
  error?: string;
  exportedCount?: number;
  label?: string;
  savedPath?: string;
};

type WalletSecretExportSheetProps = {
  walletId?: string;
  actionBusy?: boolean;
  actionStatus?: string;
  exportAction?: (confirmation: string) => Promise<WalletSecretExportResult> | WalletSecretExportResult;
  actions?: {
    onExportAgentWallet?: (walletId: string, confirmation: string) => Promise<WalletSecretExportResult> | WalletSecretExportResult;
  };
  onClose: () => void;
};

export function WalletSecretExportSheet({ walletId, actionBusy, actionStatus, exportAction, actions, onClose }: WalletSecretExportSheetProps) {
  const [confirmation, setConfirmation] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const canExport = confirmation.trim() === WALLET_SECRET_EXPORT_CONFIRMATION && !busy && !actionBusy;
  const visibleStatus = message || actionStatus || "";
  const isError = /\b(failed|unavailable|cancelled|could not|no local|error)\b/i.test(visibleStatus);

  async function exportKeys() {
    setBusy(true);
    setMessage("Preparing wallet secret export...");
    try {
      const trimmedConfirmation = confirmation.trim();
      const result = exportAction
        ? await exportAction(trimmedConfirmation)
        : walletId && actions?.onExportAgentWallet
          ? await actions.onExportAgentWallet(walletId, trimmedConfirmation)
          : null;
      if (!result) throw new Error("Wallet secret export is not available in this build.");
      if (result?.ok === false) throw new Error(result.error || "Wallet secret export failed.");
      const exportedCount = result?.exportedCount ?? 1;
      const exportLabel = result?.label || "wallet secret";
      setMessage(result?.savedPath
        ? `Saved ${exportedCount} ${exportLabel} export${exportedCount === 1 ? "" : "s"} to ${result.savedPath}.`
        : `Downloaded ${exportedCount} ${exportLabel} export${exportedCount === 1 ? "" : "s"}.`);
      setConfirmation("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet secret export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fw-sheet">
      <div className="fw-sheet-title">Export keys
        <button type="button" className="fw-x" onClick={onClose} aria-label="Close"><X size={14} strokeWidth={2} /></button>
      </div>
      <p className="fw-sheet-help">This saves the local wallet secret for offline backup. Wallets derived from a shared recovery phrase export this account&rsquo;s own private key (which maps to exactly this address), noting its derivation path; other wallets export their private key or recovery phrase. Anyone with the export can spend from this wallet.</p>
      <label className="fb-label">Confirm export
        <input className="fb-field fb-mono" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={WALLET_SECRET_EXPORT_CONFIRMATION} />
      </label>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="fb-btn primary sm" disabled={!canExport} onClick={() => void exportKeys()}><Download size={14} /> Export keys</button>
      </div>
      {visibleStatus ? <p className="fw-sheet-help" style={{ color: isError ? "var(--danger)" : undefined }}>{visibleStatus}</p> : null}
    </div>
  );
}
