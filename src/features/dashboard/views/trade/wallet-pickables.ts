/* wallet-pickables.ts — shared wallet→pickable mapping for the wallet picker
   modal. Used by the Trade view (crypto/stocks) and by the Work→Simulation
   paid-run (x402) flow so both build the SAME pickable list (the user's own
   wallets + configured agent wallets) from one source of truth. */

import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { createDefaultAgentWallet, resolveAgentWallet } from "@/lib/utils/agent-wallet";
import type { PickableWallet } from "./WalletSelectModal";

/** Loose agent shape — panel prop bags are permissive across the dashboard. */
export type PickableAgent = { id: string; name?: string; wallet?: unknown; provider?: unknown; usePod?: unknown; venice?: unknown };

/** Map a personal/user wallet record (from the Wallets route) to a pickable card. */
export function personalPickable(record: Record<string, unknown>): PickableWallet | null {
  const id = String(record.id || record.agentId || "").trim();
  const address = String(record.address || "").trim();
  if (!id || !address) return null;
  const custody = record.custodyMode === "local" ? "local" : "watch";
  const wallet = {
    ...createDefaultAgentWallet(id),
    walletAddress: address,
    network: String(record.network || "eip155:8453"),
    custodyMode: custody,
    enabled: custody === "local",
    currentBalanceUsd: Number(record.currentBalanceUsd) || 0,
  } as AgentWalletConfig;
  return {
    id,
    name: String(record.name || "My wallet"),
    kind: "user",
    wallet,
    statusOverride: custody === "local" ? { tone: "ok", text: "Local wallet" } : { tone: "muted", text: "Watch only" },
  };
}

/** Resolve an agent's effective wallet (runtime evidence merged with stored config). */
export function walletForAgent(agent: PickableAgent, walletsByAgent?: Record<string, unknown>): AgentWalletConfig {
  return resolveAgentWallet(
    agent as Parameters<typeof resolveAgentWallet>[0],
    (walletsByAgent?.[agent.id] ?? agent.wallet) as Parameters<typeof resolveAgentWallet>[1],
  );
}

/** Map an agent to a pickable card (no filtering — callers layer their own). */
export function agentPickable(agent: PickableAgent, walletsByAgent?: Record<string, unknown>): PickableWallet {
  return {
    id: agent.id,
    name: agent.name || agent.id,
    kind: "agent",
    wallet: walletForAgent(agent, walletsByAgent),
    usePod: agent.usePod as AgentProfile["usePod"],
  };
}

// Networks executeX402Fetch will sign on (mirror of x402-agent-fetch.ts
// supportedEvmNetworks + supportedSvmNetworks). A wallet on any other network
// can't fund an x402 run.
export const X402_SUPPORTED_NETWORKS = new Set(["eip155:8453", "eip155:84532", "solana:mainnet", "solana:devnet"]);

/**
 * Whether a wallet can FUND a paid x402 run: it must have an address, hold a
 * local signing key (custodyMode "local" → a vault secret), and sit on a
 * network x402 supports. Watch-only/runtime-custody wallets can't sign. This is
 * a client-side predictor; the server vault is authoritative and may still 404.
 */
export function isX402CapableWallet(wallet: AgentWalletConfig): boolean {
  return Boolean(wallet.walletAddress?.trim?.())
    && wallet.custodyMode === "local"
    && X402_SUPPORTED_NETWORKS.has(wallet.network);
}

/**
 * Why a chosen wallet can't pay an x402 run right now ("" when it's ready).
 * Mirrors the gates in executeX402Fetch / validateMiroSharkChatRun so the UI can
 * explain the block before spending the click.
 */
export function x402WalletBlockReason(wallet: AgentWalletConfig): string {
  if (!wallet.walletAddress?.trim?.()) return "This wallet has no address yet.";
  if (wallet.custodyMode !== "local") return "This is a watch-only wallet — it can't sign payments. Create or import a local wallet in the Wallets tab.";
  if (!X402_SUPPORTED_NETWORKS.has(wallet.network)) return `x402 runs aren't supported on ${wallet.network}. Use a Base or Solana wallet.`;
  if (!wallet.enabled) return "Spending is turned off for this wallet. Enable Spend in the Wallets tab to use it for paid runs.";
  return "";
}
