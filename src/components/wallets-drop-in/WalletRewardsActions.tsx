/* eslint-disable */
// @ts-nocheck
"use client";
import React from "react";

export function WalletRewardsActions({ actions }: any) {
  const rewards = actions?.bankrRewards || {};
  const stats = rewards.honeyStats || {};
  const vault = actions?.walletVaultBackup || {};
  const vaultStatus = vault.status || {};
  const [recipient, setRecipient] = React.useState(actions?.bankrRecipientAddress || "");
  const [busy, setBusy] = React.useState("");
  const [status, setStatus] = React.useState("");
  React.useEffect(() => setRecipient(actions?.bankrRecipientAddress || ""), [actions?.bankrRecipientAddress]);
  const fmt = (amount) => actions?.formatHiveAmount ? actions.formatHiveAmount(amount || 0) : String(amount || 0);
  const recipientReady = /^0x[a-fA-F0-9]{40}$/.test(recipient.trim());
  const vaultBusy = Boolean(vault.busy || busy.startsWith("vault-"));
  const connect = async () => { setBusy("connect"); setStatus(""); try { const address = await actions?.onConnectBankrWallet?.(); if (address) setRecipient(address); setStatus(address ? "Base wallet connected." : "Wallet connection did not return an address."); } catch (e) { setStatus(e instanceof Error ? e.message : "Could not connect wallet."); } finally { setBusy(""); } };
  const claim = async () => { setBusy("claim"); setStatus("Sending Bankr HIVE transaction..."); try { const result = await actions?.onClaimBankrHive?.(recipient.trim()); if (!result?.ok) throw new Error(result?.error || "Bankr HIVE claim failed."); const tx = result.txHash ? ` Tx ${result.txHash.slice(0, 10)}...${result.txHash.slice(-6)}.` : ""; setStatus(`Sent ${fmt(result.amount)} HIVE to Bankr.${tx}`); } catch (e) { setStatus(e instanceof Error ? e.message : "Bankr HIVE claim failed."); } finally { setBusy(""); } };
  const returnLegacy = async () => { setBusy("return"); setStatus("Moving legacy HIVE back to Honey..."); try { if (!actions?.onReturnAllHiveToHoney) throw new Error("Legacy HIVE return is not available in this build."); await actions.onReturnAllHiveToHoney(); setStatus("Legacy HIVE moved back to Honey."); } catch (e) { setStatus(e instanceof Error ? e.message : "Could not move legacy HIVE back."); } finally { setBusy(""); } };
  const runVault = async (action) => { setBusy(`vault-${action}`); setStatus(""); try { if (!actions?.onRunWalletVaultBackupAction) throw new Error("Wallet vault action is not available in this build."); await actions.onRunWalletVaultBackupAction(action); setStatus(action === "refresh" ? "Wallet vault sync requested." : "Wallet vault restore requested."); } catch (e) { setStatus(e instanceof Error ? e.message : "Wallet vault action failed."); } finally { setBusy(""); } };
  return (
    <div className="fb-card pad" style={{ display: "grid", gap: 14 }}>
      <div>
        <span className="fb-eyebrow">Bankr rewards</span>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }} className="fw-kv">
          <div><span>Total Honey</span><strong>{fmt(stats.totalHoney)}</strong></div>
          <div><span>Ready to claim</span><strong>{fmt(stats.availableHoney)}</strong></div>
          <div><span>Legacy HIVE</span><strong>{fmt(stats.legacyHive)}</strong></div>
        </div>
      </div>
      <label className="fb-label">Bankr receiving address<input className="fb-field fb-mono" value={recipient} onChange={(e) => { setRecipient(e.target.value); setStatus(""); }} placeholder="0x..." /></label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="fb-btn secondary" disabled={busy === "connect"} onClick={connect}>{busy === "connect" ? "Connecting..." : "Connect Base wallet"}</button>
        <button type="button" className="fb-btn primary" disabled={busy === "claim" || !recipientReady || (stats.availableHoney || 0) <= 0} onClick={claim}>Claim Bankr HIVE</button>
        {(stats.legacyHive || 0) > 0 ? <button type="button" className="fb-btn secondary" disabled={busy === "return"} onClick={returnLegacy}>{busy === "return" ? "Moving..." : "Move legacy HIVE back"}</button> : null}
      </div>
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
