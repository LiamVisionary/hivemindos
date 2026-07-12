"use client";
import React from "react";

type WalletRewardsHoneyStats = {
  totalHoney?: number;
  availableHoney?: number;
  legacyHive?: number;
};

type WalletRewardsVaultStatus = {
  vaultExists?: boolean;
  recordCount?: number;
  backupExists?: boolean;
  gpgAvailable?: boolean;
  recipientConfigured?: boolean;
};

export type WalletRewardsActionsSlice = {
  bankrRewards?: { honeyStats?: WalletRewardsHoneyStats };
  walletVaultBackup?: { status?: WalletRewardsVaultStatus; busy?: boolean; message?: string };
  bankrRecipientAddress?: string;
  formatHiveAmount?: (amount: number) => string;
  onConnectBankrWallet?: () => Promise<string | undefined>;
  onClaimBankrHive?: (recipient: string) => Promise<{ ok?: boolean; error?: string; txHash?: string; amount?: number } | undefined>;
  onReturnAllHiveToHoney?: () => Promise<unknown>;
  onRunWalletVaultBackupAction?: (action: "refresh" | "restore") => unknown;
};

export function WalletRewardsActions({ actions }: { actions?: WalletRewardsActionsSlice }) {
  const rewards: NonNullable<WalletRewardsActionsSlice["bankrRewards"]> = actions?.bankrRewards || {};
  const stats: WalletRewardsHoneyStats = rewards.honeyStats || {};
  const vault: NonNullable<WalletRewardsActionsSlice["walletVaultBackup"]> = actions?.walletVaultBackup || {};
  const vaultStatus: WalletRewardsVaultStatus = vault.status || {};
  const [busy, setBusy] = React.useState("");
  const [status, setStatus] = React.useState("");
  const fmt = (amount?: number) => actions?.formatHiveAmount ? actions.formatHiveAmount(amount || 0) : String(amount || 0);
  const vaultBusy = Boolean(vault.busy || busy.startsWith("vault-"));
  const returnLegacy = async () => { setBusy("return"); setStatus("Moving legacy HIVE back to Honey..."); try { if (!actions?.onReturnAllHiveToHoney) throw new Error("Legacy HIVE return is not available in this build."); await actions.onReturnAllHiveToHoney(); setStatus("Legacy HIVE moved back to Honey."); } catch (e) { setStatus(e instanceof Error ? e.message : "Could not move legacy HIVE back."); } finally { setBusy(""); } };
  const runVault = async (action: "refresh" | "restore") => { setBusy(`vault-${action}`); setStatus(""); try { if (!actions?.onRunWalletVaultBackupAction) throw new Error("Wallet vault action is not available in this build."); await actions.onRunWalletVaultBackupAction(action); setStatus(action === "refresh" ? "Wallet vault sync requested." : "Wallet vault restore requested."); } catch (e) { setStatus(e instanceof Error ? e.message : "Wallet vault action failed."); } finally { setBusy(""); } };
  return (
    <div className="fb-card pad" style={{ display: "grid", gap: 14 }}>
      <div>
        <span className="fb-eyebrow">Honey · contribution record</span>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }} className="fw-kv">
          <div><span>Total Honey</span><strong>{fmt(stats.totalHoney)}</strong></div>
          <div><span>Available Honey</span><strong>{fmt(stats.availableHoney)}</strong></div>
          <div><span>Legacy HIVE</span><strong>{fmt(stats.legacyHive)}</strong></div>
        </div>
      </div>
      <p className="fw-sheet-help">Honey records reviewed ecosystem contribution. It is not cash, company ownership, or automatically convertible to HIVE. Any future redemption requires a separately authorized policy.</p>
      {(stats.legacyHive || 0) > 0 ? <div><button type="button" className="fb-btn secondary" disabled={busy === "return"} onClick={returnLegacy}>{busy === "return" ? "Moving..." : "Move legacy HIVE back"}</button></div> : null}
      <details className="fw-details">
        <summary>Encrypted wallet vault</summary>
        <div className="fw-kv" style={{ marginTop: 10 }}>
          <div><span>Local vault</span><strong>{vaultStatus.vaultExists ? `${vaultStatus.recordCount} record${vaultStatus.recordCount === 1 ? "" : "s"}` : "Not created"}</strong></div>
          <div><span>Shared vault</span><strong>{vaultStatus.backupExists ? "Ready" : "Missing"}</strong></div>
          <div><span>GPG</span><strong>{vaultStatus.gpgAvailable ? "Available" : "Missing"}</strong></div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button type="button" className="fb-btn secondary" disabled={vaultBusy || !vaultStatus.vaultExists || !vaultStatus.gpgAvailable || !vaultStatus.recipientConfigured} onClick={() => runVault("refresh")}>Sync vault</button>
          <button type="button" className="fb-btn secondary" disabled={vaultBusy || !vaultStatus.backupExists || !vaultStatus.gpgAvailable} onClick={() => runVault("restore")}>Restore vault</button>
        </div>
        {vault.message ? <p className="fw-sheet-help">{vault.message}</p> : null}
      </details>
      {status ? <p className="fw-sheet-help">{status}</p> : null}
    </div>
  );
}
