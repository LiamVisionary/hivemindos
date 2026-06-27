/* wallet-pickables.ts — shared wallet→pickable mapping for the wallet picker
   modal. Used by the Trade view (crypto/stocks) and by the Work→Simulation
   paid-run (x402) flow so both build the SAME pickable list (the user's own
   wallets + configured agent wallets) from one source of truth.

   Personal wallets are GROUPED by recovery-phrase seed (Base + Solana from one
   seed → one card) via the shared grouping module, matching the Wallets screen.
   A grouped card carries its per-chain `accounts`; since a trade runs on one
   chain, selection resolves to a specific account id via resolvePickableAccount. */

import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { createDefaultAgentWallet, resolveAgentWallet } from "@/lib/utils/agent-wallet";
import {
  buildGroupedPersonalWallets,
  chainShortLabel,
  type PersonalWalletAccount,
} from "@/lib/utils/personal-wallet-grouping";
import type { PickableAccount, PickableWallet } from "./WalletSelectModal";

/** Loose agent shape — panel prop bags are permissive across the dashboard. */
export type PickableAgent = { id: string; name?: string; wallet?: unknown; provider?: unknown; usePod?: unknown; venice?: unknown };

/** Build the executable AgentWalletConfig for one per-chain account. */
function walletConfigForAccount(account: PersonalWalletAccount): AgentWalletConfig {
  return {
    ...createDefaultAgentWallet(account.id),
    walletAddress: account.address,
    network: account.network,
    custodyMode: account.custodyMode,
    enabled: account.custodyMode === "local",
    currentBalanceUsd: account.currentBalanceUsd || 0,
  } as AgentWalletConfig;
}

/**
 * Group raw personal wallet records into one pickable per seed. The card shows
 * the seed's total balance and its chains as selectable badges. `accountFilter`
 * lets a caller keep only accounts that qualify (e.g. x402-capable); a group
 * with no surviving accounts is dropped.
 */
export function groupedUserPickables(
  records: Array<Record<string, unknown>>,
  opts?: { accountFilter?: (wallet: AgentWalletConfig) => boolean },
): PickableWallet[] {
  const groups = buildGroupedPersonalWallets(records as unknown[] as any[]);
  const out: PickableWallet[] = [];
  for (const group of groups) {
    let accounts: PickableAccount[] = group.accounts.map((account) => ({ ...account, wallet: walletConfigForAccount(account) }));
    if (opts?.accountFilter) accounts = accounts.filter((account) => opts.accountFilter!(account.wallet));
    if (!accounts.length) continue;
    const defaultAccount = accounts.find((account) => account.id === group.spendId)
      ?? accounts.find((account) => account.chainKey === "base")
      ?? accounts[0];
    const totalUsd = accounts.reduce((sum, account) => sum + (Number(account.wallet.currentBalanceUsd) || 0), 0);
    out.push({
      id: defaultAccount.id,
      name: group.name,
      kind: "user",
      // The card balance is the seed total; execution uses the per-account wallet
      // resolved from the chosen chain (resolvePickableAccount).
      wallet: { ...defaultAccount.wallet, currentBalanceUsd: totalUsd } as AgentWalletConfig,
      statusOverride: group.canSpend ? { tone: "ok", text: "Local wallet" } : { tone: "muted", text: "Watch only" },
      accounts,
    });
  }
  return out;
}

/**
 * Resolve a selected id (a pickable id, or — for a grouped user wallet — one of
 * its per-chain account ids) to a single-chain pickable the trade/x402 flow can
 * execute against. Returns null when the id isn't selectable.
 */
/**
 * Flat, one-pickable-per-chain-account list (no grouping). Used by surfaces that
 * have no in-action chain selector — e.g. the x402 paid-run confirm — so the user
 * can still pick the exact chain account. Multi-chain wallets get a chain suffix
 * so the rows are distinguishable. `accountFilter` keeps only qualifying accounts.
 */
export function userAccountPickables(
  records: Array<Record<string, unknown>>,
  opts?: { accountFilter?: (wallet: AgentWalletConfig) => boolean },
): PickableWallet[] {
  const out: PickableWallet[] = [];
  for (const group of buildGroupedPersonalWallets(records as unknown[] as any[])) {
    let accounts: PickableAccount[] = group.accounts.map((account) => ({ ...account, wallet: walletConfigForAccount(account) }));
    if (opts?.accountFilter) accounts = accounts.filter((account) => opts.accountFilter!(account.wallet));
    const multi = accounts.length > 1;
    for (const account of accounts) {
      out.push({
        id: account.id,
        name: multi ? `${group.name} · ${chainShortLabel(account.chainKey, account.networkLabel)}` : group.name,
        kind: "user",
        wallet: account.wallet,
        statusOverride: group.canSpend ? { tone: "ok", text: "Local wallet" } : { tone: "muted", text: "Watch only" },
      });
    }
  }
  return out;
}

export function resolvePickableAccount(pickables: PickableWallet[], id: string): PickableWallet | null {
  if (!id) return null;
  for (const pickable of pickables) {
    if (pickable.accounts && pickable.accounts.length) {
      const account = pickable.accounts.find((entry) => entry.id === id);
      if (account) {
        return {
          id: account.id,
          name: pickable.name,
          kind: pickable.kind,
          wallet: account.wallet,
          statusOverride: pickable.statusOverride,
          pending: pickable.pending,
          usePod: pickable.usePod,
        };
      }
    } else if (pickable.id === id) {
      return pickable;
    }
  }
  return null;
}

export function isSelectablePickableId(pickables: PickableWallet[], id: string): boolean {
  return Boolean(resolvePickableAccount(pickables, id));
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
