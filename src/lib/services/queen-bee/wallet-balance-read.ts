import "server-only";

import { readWalletLedger } from "@/lib/services/obsidian/wallet-ledger";
import { getWalletBalance } from "@/lib/services/wallet/chain-wallet";

type WalletScope = "agent" | "personal" | "all";

type WalletBalanceDependencies = {
  readLedger?: typeof readWalletLedger;
  readBalance?: typeof getWalletBalance;
  timeoutMs?: number;
};

const DEFAULT_BALANCE_TIMEOUT_MS = 5_000;

function scopeForQuery(query: string): WalletScope {
  if (/\b(?:personal|my own)\s+wallets?\b/i.test(query)) return "personal";
  if (/\bagent\s+wallets?\b/i.test(query)) return "agent";
  return "all";
}

function includesScope(agentId: string, scope: WalletScope) {
  const personal = agentId.startsWith("user:");
  return scope === "all" || (scope === "personal" ? personal : !personal);
}

function accountKey(network: string, address: string) {
  return `${network.trim().toLowerCase()}|${address.trim().toLowerCase()}`;
}

function networkLabel(network: string) {
  if (network === "eip155:8453") return "Base";
  if (network === "eip155:84532") return "Base Sepolia";
  if (network === "eip155:4663") return "Robinhood Chain";
  if (network === "solana:mainnet") return "Solana";
  if (network === "solana:devnet") return "Solana Devnet";
  return network || "unknown network";
}

function usd(value: number) {
  return `$${Math.max(0, value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("live balance read timed out")), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Read every configured HivemindOS wallet from the canonical Shared Brain
 * ledger, dedupe shared addresses, and refresh public on-chain balances. No
 * signer, secret, recovery phrase, or full wallet address is returned.
 */
export async function readQueenWalletBalances(
  query: string,
  dependencies: WalletBalanceDependencies = {},
) {
  const scope = scopeForQuery(query);
  const ledger = await (dependencies.readLedger ?? readWalletLedger)();
  const records = ledger.records.filter((record) => includesScope(record.agentId, scope));
  if (!records.length) {
    return `HivemindOS has no configured ${scope === "agent" ? "agent" : scope === "personal" ? "personal" : "agent or personal"} wallets in the canonical wallet ledger.`;
  }

  const groups = new Map<string, {
    address: string;
    network: string;
    records: typeof records;
    storedBalanceUsd: number;
    lastSyncAt: number;
  }>();
  const missingAddress = records.filter((record) => !(record.wallet.walletAddress || record.wallet.vaultAddress));
  for (const record of records) {
    const address = (record.wallet.walletAddress || record.wallet.vaultAddress || "").trim();
    if (!address) continue;
    const key = accountKey(record.wallet.network, address);
    const current = groups.get(key);
    const storedBalanceUsd = Math.max(
      0,
      Number(record.wallet.onchainBalanceUsd) || Number(record.wallet.currentBalanceUsd) || 0,
    );
    const lastSyncAt = Number(record.wallet.lastOnchainSyncAt) || 0;
    if (current) {
      current.records.push(record);
      current.storedBalanceUsd = Math.max(current.storedBalanceUsd, storedBalanceUsd);
      current.lastSyncAt = Math.max(current.lastSyncAt, lastSyncAt);
    } else {
      groups.set(key, {
        address,
        network: record.wallet.network,
        records: [record],
        storedBalanceUsd,
        lastSyncAt,
      });
    }
  }

  const readBalance = dependencies.readBalance ?? getWalletBalance;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_BALANCE_TIMEOUT_MS;
  const balances = await Promise.all([...groups.entries()].map(async ([key, group]) => {
    try {
      const balance = await withTimeout(readBalance(group.address, group.network), timeoutMs);
      const totalValueUsd = Number(balance.totalValueUsd);
      return {
        key,
        balanceUsd: Number.isFinite(totalValueUsd) && totalValueUsd >= 0
          ? totalValueUsd
          : Math.max(0, Number(balance.tokenBalance) || 0),
        live: true,
      };
    } catch {
      return {
        key,
        balanceUsd: group.storedBalanceUsd,
        live: false,
      };
    }
  }));
  const byKey = new Map(balances.map((balance) => [balance.key, balance]));
  const totalUsd = balances.reduce((sum, balance) => sum + balance.balanceUsd, 0);
  const liveCount = balances.filter((balance) => balance.live).length;
  const cachedCount = balances.length - liveCount;

  const lines = [...groups.entries()].flatMap(([key, group]) => {
    const result = byKey.get(key)!;
    return group.records.map((record, index) => {
      const shared = group.records.length > 1
        ? index === 0
          ? `; shared by ${group.records.length} agents and counted once in the total`
          : "; same underlying wallet, excluded from the unique-wallet total"
        : "";
      const freshness = result.live
        ? "live on-chain"
        : `cached${group.lastSyncAt ? ` from ${new Date(group.lastSyncAt).toISOString()}` : "; never live-synced"}`;
      return `- ${record.agentName || record.agentId}: ${usd(result.balanceUsd)} (${networkLabel(group.network)}; ${freshness}${shared})`;
    });
  });
  for (const record of missingAddress) {
    lines.push(`- ${record.agentName || record.agentId}: no wallet address is configured.`);
  }

  return [
    `HivemindOS ${scope} wallet balances from the canonical wallet ledger and public chain reads:`,
    `Unique-wallet total: ${usd(totalUsd)} across ${balances.length} configured address${balances.length === 1 ? "" : "es"}.`,
    ...lines,
    `Freshness: ${liveCount} live; ${cachedCount} cached fallback${cachedCount === 1 ? "" : "s"}${missingAddress.length ? `; ${missingAddress.length} missing an address` : ""}.`,
    cachedCount
      ? "Cached rows could not be verified live during this request; state that caveat in the answer."
      : "All reported balances were verified live during this request.",
  ].join("\n");
}
