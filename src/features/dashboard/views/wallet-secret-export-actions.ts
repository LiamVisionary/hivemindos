import type { WalletActionState } from "@/features/dashboard/dashboard-types";
import type { GroupedPersonalWallet } from "@/lib/utils/personal-wallet-grouping";

type WalletSecretExportResult = {
  ok?: boolean;
  error?: string;
  exportedCount?: number;
  label?: string;
  savedPath?: string;
};

type ExportWalletSecrets = (input: {
  agentIds: string[];
  label: string;
  filename?: string;
  confirmation?: string;
}) => Promise<WalletSecretExportResult>;

type WalletActionUpdater = (walletId: string, patch: Partial<WalletActionState>) => void;

export async function exportPersonalWalletGroupSecret(
  group: GroupedPersonalWallet,
  exportWalletSecrets: ExportWalletSecrets,
  updatePersonalAction?: WalletActionUpdater,
  options: { confirmation?: string } = {},
) {
  const localWallets = group.accounts.filter((wallet) => wallet.custodyMode === "local");
  const statusWalletId = group.spendId || group.id;
  if (!localWallets.length) {
    const result = { ok: false, error: "This wallet is view-only, so there is no local secret to export." };
    updatePersonalAction?.(statusWalletId, { error: result.error, message: "" });
    return result;
  }
  updatePersonalAction?.(statusWalletId, { busy: true, error: "", message: "Preparing wallet secret export..." });
  const result = await exportWalletSecrets({
    agentIds: localWallets.map((wallet) => wallet.id),
    label: group.name,
    confirmation: options.confirmation,
  });
  updatePersonalAction?.(statusWalletId, exportResultAction(result, localWallets.length));
  return result;
}

export async function exportAgentWalletSecret(
  wallet: { id: string; name: string },
  exportWalletSecrets: ExportWalletSecrets,
  updateWalletAction: WalletActionUpdater,
  options: { confirmation?: string } = {},
) {
  updateWalletAction(wallet.id, { busy: true, error: "", message: "Preparing wallet secret export..." });
  const result = await exportWalletSecrets({
    agentIds: [wallet.id],
    label: wallet.name,
    confirmation: options.confirmation,
  });
  updateWalletAction(wallet.id, exportResultAction(result, 1));
  return result;
}

function exportResultAction(result: WalletSecretExportResult, fallbackCount: number): Partial<WalletActionState> {
  const exportedCount = result.exportedCount ?? fallbackCount;
  return {
    busy: false,
    error: result.ok ? "" : result.error ?? "Wallet secret export failed.",
    message: result.ok
      ? result.savedPath
        ? `Saved ${exportedCount} ${result.label ?? "wallet secret"} export${exportedCount === 1 ? "" : "s"} to ${result.savedPath}.`
        : `Downloaded ${exportedCount} ${result.label ?? "wallet secret"} export${exportedCount === 1 ? "" : "s"}.`
      : "",
  };
}
