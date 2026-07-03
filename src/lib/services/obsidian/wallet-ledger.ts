import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { hostname } from "os";
import { join } from "path";

import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import type { AgentAssetSpendCaps, AgentSpendCapAsset, AgentWalletConfig, AgentWalletTokenBalance } from "@/lib/types/agent-wallet";
import { DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS, stripUnfundedWalletBalance } from "@/lib/utils/agent-wallet";

const WALLET_FOLDER = "Projects/HivemindOS/Wallets";

export type WalletLedgerRecord = {
  agentId: string;
  agentName: string;
  runtime?: string;
  machineName?: string;
  /** Hostname of the dashboard that last wrote the record. */
  dashboardMachine: string;
  /** ISO timestamp of the last write. */
  updatedAt: string;
  wallet: AgentWalletConfig;
};

export type WalletLedger = {
  vaultPath: string;
  folderPath: string;
  records: WalletLedgerRecord[];
};

/* ─── YAML helpers (flat primitives only) ───────────────────────── */

const NEEDS_QUOTE = /[:#\n]|^\s|\s$|^$|^(true|false|null|yes|no|on|off)$|^-?\d/i;

function escapeYamlString(value: string): string {
  if (!NEEDS_QUOTE.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function emitYamlValue(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  if (typeof value === "string") return escapeYamlString(value);
  return escapeYamlString(JSON.stringify(value));
}

function parseYamlScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(content: string): Record<string, string | number | boolean> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    out[key] = parseYamlScalar(value);
  }
  return out;
}

function parseAssetSpendCaps(value: string | number | boolean | undefined): AgentAssetSpendCaps {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const caps: AgentAssetSpendCaps = {};
    for (const asset of ["USDC", "ETH"] as const satisfies readonly AgentSpendCapAsset[]) {
      const cap = Number((parsed as Record<string, unknown>)[asset]);
      if (Number.isFinite(cap) && cap >= 0) caps[asset] = cap;
    }
    return caps;
  } catch {
    return {};
  }
}

function parseWalletTokens(value: string | number | boolean | undefined): AgentWalletTokenBalance[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((token): AgentWalletTokenBalance[] => {
      if (!token || typeof token !== "object" || Array.isArray(token)) return [];
      const record = token as Record<string, unknown>;
      const symbol = typeof record.symbol === "string" ? record.symbol.trim() : "";
      const name = typeof record.name === "string" ? record.name.trim() : symbol;
      const network = typeof record.network === "string" ? record.network.trim() : "";
      const balance = Number(record.balance);
      if (!symbol || !network || !Number.isFinite(balance) || balance <= 0) return [];
      const priceUsd = Number(record.priceUsd);
      const valueUsd = Number(record.valueUsd);
      const priceChange24hPct = Number(record.priceChange24hPct);
      return [{
        symbol,
        name,
        balance,
        network,
        priceUsd: Number.isFinite(priceUsd) ? priceUsd : null,
        valueUsd: Number.isFinite(valueUsd) ? valueUsd : null,
        priceChange24hPct: Number.isFinite(priceChange24hPct) ? priceChange24hPct : null,
        isNative: record.isNative === true,
        tokenAddress: typeof record.tokenAddress === "string" ? record.tokenAddress : undefined,
        iconUrl: typeof record.iconUrl === "string" ? record.iconUrl : null,
      }];
    });
  } catch {
    return [];
  }
}

/* ─── Record (de)serialisation ──────────────────────────────────── */

function networkLabel(network: string): string {
  switch (network) {
    case "eip155:8453": return "Base mainnet";
    case "eip155:84532": return "Base Sepolia";
    case "solana:mainnet": return "Solana mainnet";
    case "solana:devnet": return "Solana devnet";
    default: return network;
  }
}

function statusLabel(wallet: AgentWalletConfig): string {
  if (!wallet.enabled) return "Wallet off";
  if (wallet.currentBalanceUsd <= 0) return "Needs funding";
  if (wallet.dailyComputeBurnUsd > 0) {
    const days = wallet.currentBalanceUsd / wallet.dailyComputeBurnUsd;
    return `Can spend · ${days.toFixed(1)} days runway`;
  }
  return "Can spend";
}

function renderRecordMarkdown(record: WalletLedgerRecord): string {
  const frontmatter: Array<[string, unknown]> = [
    ["agentId", record.agentId],
    ["agentName", record.agentName],
    ["runtime", record.runtime ?? ""],
    ["machineName", record.machineName ?? ""],
    ["dashboardMachine", record.dashboardMachine],
    ["updatedAt", record.updatedAt],
    ["enabled", record.wallet.enabled],
    ["provider", record.wallet.provider],
    ["walletAddress", record.wallet.walletAddress],
    ["network", record.wallet.network],
    ["tokenSymbol", record.wallet.tokenSymbol],
    ["seedBalanceUsd", record.wallet.seedBalanceUsd],
    ["currentBalanceUsd", record.wallet.currentBalanceUsd],
    ["dailyComputeBurnUsd", record.wallet.dailyComputeBurnUsd],
    ["maxPaymentUsd", record.wallet.maxPaymentUsd],
    ["assetSpendCaps", record.wallet.assetSpendCaps],
    ["approvalRequiredOverUsd", record.wallet.approvalRequiredOverUsd],
    ["dailyBudgetUsd", record.wallet.dailyBudgetUsd ?? 0],
    ["monthlyBudgetUsd", record.wallet.monthlyBudgetUsd ?? 0],
    ["autoPayEnabled", record.wallet.autoPayEnabled],
    ["duplicatePaymentGuardEnabled", record.wallet.duplicatePaymentGuardEnabled !== false],
    ["duplicatePaymentGuardSeconds", record.wallet.duplicatePaymentGuardSeconds ?? DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS],
    ["clawCardEnvName", record.wallet.clawCardEnvName],
    ["moneyClawEnvName", record.wallet.moneyClawEnvName],
    ["x402BaseUrl", record.wallet.x402BaseUrl],
    ["veilAutoSendEnabled", record.wallet.veilAutoSendEnabled === true],
    ["veilAutoPrivateX402", record.wallet.veilAutoPrivateX402 !== false],
    ["survivalStartedAt", record.wallet.survivalStartedAt],
    ["updatedAtMs", record.wallet.updatedAt],
    ["notes", record.wallet.notes],
    ["custodyMode", record.wallet.custodyMode],
    ["vaultAddress", record.wallet.vaultAddress],
    ["onchainBalanceUsd", record.wallet.onchainBalanceUsd],
    ["nativeBalance", record.wallet.nativeBalance],
    ["tokens", record.wallet.tokens],
    ["lastOnchainSyncAt", record.wallet.lastOnchainSyncAt],
  ];

  // Stock-trading config — only emitted for trading-enabled wallets so the other
  // wallet files stay clean. Without this the venue/paper/cap silently never
  // persisted, so the buy-stock rail saw "Stock buying is off" after a save.
  if (record.wallet.tradingVenue) {
    frontmatter.push(["tradingVenue", record.wallet.tradingVenue]);
    frontmatter.push(["alpacaPaper", record.wallet.alpacaPaper !== false]);
    if (record.wallet.alpacaKeyEnvName) frontmatter.push(["alpacaKeyEnvName", record.wallet.alpacaKeyEnvName]);
    if (record.wallet.alpacaSecretEnvName) frontmatter.push(["alpacaSecretEnvName", record.wallet.alpacaSecretEnvName]);
    if (typeof record.wallet.maxTradeUsd === "number" && record.wallet.maxTradeUsd > 0) {
      frontmatter.push(["maxTradeUsd", record.wallet.maxTradeUsd]);
    }
  }

  const head = frontmatter.map(([key, value]) => `${key}: ${emitYamlValue(value)}`).join("\n");
  const balance = record.wallet.currentBalanceUsd.toFixed(2);
  const body = [
    `# ${record.agentName} — Wallet`,
    "",
    `- **Status**: ${statusLabel(record.wallet)}`,
    `- **Balance**: $${balance} ${record.wallet.tokenSymbol || "USDC"} on ${networkLabel(record.wallet.network)}`,
    record.wallet.walletAddress ? `- **Address**: \`${record.wallet.walletAddress}\`` : null,
    `- **Runtime**: ${record.runtime ?? "—"}`,
    `- **Last updated**: ${record.updatedAt} from \`${record.dashboardMachine}\``,
  ].filter(Boolean).join("\n");

  return `---\n${head}\n---\n\n${body}\n`;
}

function parseRecordMarkdown(filename: string, content: string): WalletLedgerRecord | null {
  const fm = parseFrontmatter(content);
  const agentId = typeof fm.agentId === "string" ? fm.agentId : filename.replace(/\.md$/i, "");
  if (!agentId) return null;
  const wallet: AgentWalletConfig = {
    agentId,
    enabled: Boolean(fm.enabled),
    provider: (typeof fm.provider === "string" ? fm.provider : "bankr") as AgentWalletConfig["provider"],
    walletAddress: typeof fm.walletAddress === "string" ? fm.walletAddress : "",
    network: typeof fm.network === "string" ? fm.network : "eip155:8453",
    tokenSymbol: typeof fm.tokenSymbol === "string" ? fm.tokenSymbol : "USDC",
    seedBalanceUsd: typeof fm.seedBalanceUsd === "number" ? fm.seedBalanceUsd : 0,
    currentBalanceUsd: typeof fm.currentBalanceUsd === "number" ? fm.currentBalanceUsd : 0,
    dailyComputeBurnUsd: typeof fm.dailyComputeBurnUsd === "number" ? fm.dailyComputeBurnUsd : 0,
    maxPaymentUsd: typeof fm.maxPaymentUsd === "number" ? fm.maxPaymentUsd : 0,
    assetSpendCaps: {
      ETH: typeof fm.veilMaxTransferEth === "number" ? fm.veilMaxTransferEth : 0.01,
      ...parseAssetSpendCaps(fm.assetSpendCaps),
    },
    approvalRequiredOverUsd: typeof fm.approvalRequiredOverUsd === "number" ? fm.approvalRequiredOverUsd : 0,
    dailyBudgetUsd: typeof fm.dailyBudgetUsd === "number" ? Math.max(0, fm.dailyBudgetUsd) : 0,
    monthlyBudgetUsd: typeof fm.monthlyBudgetUsd === "number" ? Math.max(0, fm.monthlyBudgetUsd) : 0,
    autoPayEnabled: Boolean(fm.autoPayEnabled),
    duplicatePaymentGuardEnabled: typeof fm.duplicatePaymentGuardEnabled === "boolean" ? fm.duplicatePaymentGuardEnabled : true,
    duplicatePaymentGuardSeconds: typeof fm.duplicatePaymentGuardSeconds === "number" ? Math.max(1, fm.duplicatePaymentGuardSeconds) : DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS,
    clawCardEnvName: typeof fm.clawCardEnvName === "string" ? fm.clawCardEnvName : "CLAWCARD_API_KEY",
    moneyClawEnvName: typeof fm.moneyClawEnvName === "string" ? fm.moneyClawEnvName : "MONEYCLAW_API_KEY",
    x402BaseUrl: typeof fm.x402BaseUrl === "string" ? fm.x402BaseUrl : "",
    veilAutoSendEnabled: typeof fm.veilAutoSendEnabled === "boolean" ? fm.veilAutoSendEnabled : false,
    veilAutoPrivateX402: typeof fm.veilAutoPrivateX402 === "boolean" ? fm.veilAutoPrivateX402 : true,
    tradingVenue: (fm.tradingVenue === "alpaca" || fm.tradingVenue === "xstocks" || fm.tradingVenue === "robinhood-chain") ? fm.tradingVenue : undefined,
    alpacaKeyEnvName: typeof fm.alpacaKeyEnvName === "string" && fm.alpacaKeyEnvName ? fm.alpacaKeyEnvName : undefined,
    alpacaSecretEnvName: typeof fm.alpacaSecretEnvName === "string" && fm.alpacaSecretEnvName ? fm.alpacaSecretEnvName : undefined,
    alpacaPaper: typeof fm.alpacaPaper === "boolean" ? fm.alpacaPaper : undefined,
    maxTradeUsd: typeof fm.maxTradeUsd === "number" && fm.maxTradeUsd > 0 ? fm.maxTradeUsd : undefined,
    survivalStartedAt: typeof fm.survivalStartedAt === "number" ? fm.survivalStartedAt : 0,
    updatedAt: typeof fm.updatedAtMs === "number" ? fm.updatedAtMs : 0,
    notes: typeof fm.notes === "string" ? fm.notes : "",
    custodyMode: (typeof fm.custodyMode === "string" ? fm.custodyMode : "watch") as AgentWalletConfig["custodyMode"],
    vaultAddress: typeof fm.vaultAddress === "string" ? fm.vaultAddress : "",
    onchainBalanceUsd: typeof fm.onchainBalanceUsd === "number" ? fm.onchainBalanceUsd : 0,
    nativeBalance: typeof fm.nativeBalance === "number" ? fm.nativeBalance : 0,
    tokens: parseWalletTokens(fm.tokens),
    lastOnchainSyncAt: typeof fm.lastOnchainSyncAt === "number" ? fm.lastOnchainSyncAt : 0,
  };
  return {
    agentId,
    agentName: typeof fm.agentName === "string" && fm.agentName ? fm.agentName : agentId,
    runtime: typeof fm.runtime === "string" ? fm.runtime : undefined,
    machineName: typeof fm.machineName === "string" ? fm.machineName : undefined,
    dashboardMachine: typeof fm.dashboardMachine === "string" ? fm.dashboardMachine : "",
    updatedAt: typeof fm.updatedAt === "string" ? fm.updatedAt : new Date(0).toISOString(),
    wallet: stripUnfundedWalletBalance(wallet),
  };
}

/* ─── Public API ─────────────────────────────────────────────────── */

const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+$/;

function fileNameFor(agentId: string): string {
  const safe = SAFE_FILE_NAME.test(agentId)
    ? agentId
    : agentId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${safe}.md`;
}

export async function readWalletLedger(vaultPath?: string): Promise<WalletLedger> {
  const resolved = resolveObsidianVaultPath(vaultPath);
  const folderPath = join(resolved, WALLET_FOLDER);
  let entries: string[] = [];
  try {
    entries = await readdir(folderPath);
  } catch {
    return { vaultPath: resolved, folderPath, records: [] };
  }
  const records: WalletLedgerRecord[] = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".md")) continue;
    if (entry.toLowerCase() === "readme.md") continue;
    if (entry.toLowerCase().includes(".sync-conflict-")) continue;
    try {
      const raw = await readFile(join(folderPath, entry), "utf8");
      const record = parseRecordMarkdown(entry, raw);
      if (record) records.push(record);
    } catch {
      /* skip unreadable file */
    }
  }
  records.sort((a, b) => a.agentName.localeCompare(b.agentName));
  return { vaultPath: resolved, folderPath, records };
}

export async function writeWalletRecord(input: {
  vaultPath?: string;
  agentId: string;
  agentName: string;
  runtime?: string;
  machineName?: string;
  wallet: AgentWalletConfig;
}): Promise<WalletLedgerRecord> {
  if (!input.agentId.trim()) throw new Error("Missing agentId.");
  const resolved = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const folderPath = join(resolved, WALLET_FOLDER);
  await mkdir(folderPath, { recursive: true });

  const record: WalletLedgerRecord = {
    agentId: input.agentId,
    agentName: input.agentName || input.agentId,
    runtime: input.runtime,
    machineName: input.machineName,
    dashboardMachine: hostname(),
    updatedAt: new Date().toISOString(),
    wallet: stripUnfundedWalletBalance({ ...input.wallet, agentId: input.agentId }),
  };
  const filePath = join(folderPath, fileNameFor(input.agentId));
  await writeFile(filePath, renderRecordMarkdown(record), "utf8");
  return record;
}
