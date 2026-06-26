import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { WalletActionState } from "@/features/dashboard/dashboard-types";

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

type ExportableWalletGroup = {
  name: string;
  primaryWallet: { id: string };
  wallets: Array<{ id: string; custodyMode: "local" | "watch" }>;
};

type WalletActionUpdater = (walletId: string, patch: Partial<WalletActionState>) => void;

export async function exportPersonalWalletGroupSecret(
  group: ExportableWalletGroup,
  exportWalletSecrets: ExportWalletSecrets,
  updatePersonalAction: WalletActionUpdater,
) {
  const localWallets = group.wallets.filter((wallet) => wallet.custodyMode === "local");
  if (!localWallets.length) {
    updatePersonalAction(group.primaryWallet.id, { error: "This wallet is view-only, so there is no local secret to export.", message: "" });
    return;
  }
  updatePersonalAction(group.primaryWallet.id, { busy: true, error: "", message: "Preparing wallet secret export..." });
  const result = await exportWalletSecrets({
    agentIds: localWallets.map((wallet) => wallet.id),
    label: group.name,
  });
  updatePersonalAction(group.primaryWallet.id, exportResultAction(result, localWallets.length));
}

export async function exportAgentWalletSecret(
  agent: AgentProfile,
  exportWalletSecrets: ExportWalletSecrets,
  updateWalletAction: WalletActionUpdater,
  options: { confirmation?: string } = {},
) {
  updateWalletAction(agent.id, { busy: true, error: "", message: "Preparing wallet secret export..." });
  const result = await exportWalletSecrets({
    agentIds: [agent.id],
    label: `${agent.name} agent wallet`,
    confirmation: options.confirmation,
  });
  updateWalletAction(agent.id, exportResultAction(result, 1));
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
