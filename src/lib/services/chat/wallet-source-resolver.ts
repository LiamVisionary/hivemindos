import { listWalletInfos } from "@/lib/services/wallet/local-wallet-vault";
import {
  networkChainLabel,
  networkFamily,
  shortAddress,
  type SourceHint,
  type WalletFamily,
  type WalletSourceRef,
} from "@/lib/services/chat/wallet-action-intents";

/**
 * Resolve which wallet an action signs from. An explicit "my wallet 0x…" or
 * "my personal wallet" resolves to a personal (`user:`) wallet; otherwise the
 * agent's own wallet (fallback) is used. `requiredFamily` constrains the chain
 * to match the destination (USDC to a 0x address must come from an EVM wallet).
 * Server-only (reads the encrypted wallet vault index).
 */
export async function resolveWalletSource(
  hint: SourceHint,
  fallback: { agentId: string; address: string; network: string } | undefined,
  requiredFamily: WalletFamily,
): Promise<WalletSourceRef | { error: string }> {
  const personal = (await listWalletInfos({ agentIdPrefix: "user:" }).catch(() => []))
    .filter((info) => networkFamily(info.network) === requiredFamily);

  const personalRef = (info: { agentId: string; address: string; network: string }): WalletSourceRef =>
    ({ agentId: info.agentId, address: info.address, network: info.network, isPersonal: true, label: "your personal wallet" });

  if (hint.address) {
    const match = personal.find((info) => info.address.toLowerCase() === hint.address!.toLowerCase());
    if (match) return personalRef(match);
    if (fallback && fallback.address.toLowerCase() === hint.address.toLowerCase()) {
      return { agentId: fallback.agentId, address: fallback.address, network: fallback.network, isPersonal: false, label: "this agent's wallet" };
    }
    return { error: `I don't recognize the wallet ${shortAddress(hint.address)}. Use one of your configured wallets, or omit "from …" to use this agent's wallet.` };
  }

  if (hint.personal || hint.chain) {
    const candidates = hint.chain
      ? personal.filter((info) => (hint.chain === "base" ? info.network.startsWith("eip155:") : info.network.startsWith("solana:")))
      : personal;
    if (candidates.length === 1) return personalRef(candidates[0]);
    if (candidates.length === 0) return { error: `No personal ${requiredFamily === "evm" ? "EVM/Base" : "Solana"} wallet is configured. Import one in the Wallets tab first.` };
    return { error: `You have multiple personal wallets — tell me which address to send from (e.g. "from my wallet 0x…").` };
  }

  if (!fallback) return { error: "No wallet is available to send from. Specify a personal wallet address, or configure this agent's wallet." };
  if (networkFamily(fallback.network) !== requiredFamily) {
    return { error: `This agent's wallet is on ${networkChainLabel(fallback.network)}, which can't reach that destination. Specify a personal wallet with "from my wallet 0x…".` };
  }
  return { agentId: fallback.agentId, address: fallback.address, network: fallback.network, isPersonal: false, label: "this agent's wallet" };
}
