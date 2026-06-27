import { NextResponse } from "next/server";

import { listWalletInfos } from "@/lib/services/wallet/local-wallet-vault";
import { readWalletLedger, writeWalletRecord } from "@/lib/services/obsidian/wallet-ledger";
import type { AgentWalletConfig, AgentWalletTokenBalance, AgentWalletVaultInfo } from "@/lib/types/agent-wallet";
import { createDefaultAgentWallet } from "@/lib/utils/agent-wallet";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PersonalWalletRecord = {
  id: string;
  name?: string;
  address: string;
  network: string;
  custodyMode?: "local" | "watch";
  importedFrom?: "generated" | "private-key" | "recovery-phrase" | "browser" | "watch";
  currentBalanceUsd?: number;
  nativeBalance?: number;
  tokens?: AgentWalletTokenBalance[];
  lastOnchainSyncAt?: number;
  createdAt?: number;
  updatedAt?: number;
};

type PersonalWalletResponse = PersonalWalletRecord & {
  agentId: string;
  tokens: AgentWalletTokenBalance[];
  portfolioVersion: number;
};

const RECOVERY_PHRASE_WALLET_ID_SUFFIX = /:(?:eip155-\d+|solana-[a-z0-9-]+)$/i;

function isRecoveryPhraseWalletId(id: string) {
  return id.startsWith("user:") && RECOVERY_PHRASE_WALLET_ID_SUFFIX.test(id);
}

function personalWalletImportSource(
  id: string,
  custodyMode?: "local" | "watch",
  importedFrom?: PersonalWalletRecord["importedFrom"],
): PersonalWalletRecord["importedFrom"] {
  if (importedFrom === "recovery-phrase" || isRecoveryPhraseWalletId(id)) return "recovery-phrase";
  if (importedFrom) return importedFrom;
  return custodyMode === "local" ? "private-key" : "watch";
}

function personalWalletName(agentId: string, agentName: string, network: string) {
  if (agentName && agentName !== agentId) return agentName;
  return isRecoveryPhraseWalletId(agentId)
    ? `My wallet ${network.startsWith("solana:") ? "Solana" : "Base"}`
    : `My ${network.startsWith("solana:") ? "Solana" : "Base"} wallet`;
}

function isGenericPersonalWalletName(name: unknown): boolean {
  const normalized = String(name || "").trim().toLowerCase();
  return normalized === "my wallet"
    || normalized === "my wallet base"
    || normalized === "my wallet solana"
    || normalized === "my base wallet"
    || normalized === "my solana wallet";
}

function personalWalletFromAgentWallet(agentId: string, agentName: string, wallet: AgentWalletConfig) {
  const address = wallet.walletAddress || wallet.vaultAddress || "";
  if (!address) return null;
  const custodyMode = wallet.custodyMode === "local" ? "local" : "watch";
  return {
    agentId,
    id: agentId,
    name: personalWalletName(agentId, agentName, wallet.network),
    address,
    network: wallet.network,
    custodyMode,
    importedFrom: personalWalletImportSource(agentId, custodyMode),
    currentBalanceUsd: wallet.currentBalanceUsd || wallet.onchainBalanceUsd || 0,
    nativeBalance: wallet.nativeBalance || 0,
    tokens: Array.isArray(wallet.tokens) ? wallet.tokens : [],
    portfolioVersion: 0,
    lastOnchainSyncAt: wallet.lastOnchainSyncAt || 0,
    createdAt: wallet.updatedAt || 0,
    updatedAt: wallet.updatedAt || 0,
  } satisfies PersonalWalletResponse;
}

function walletAccountKey(input: Pick<PersonalWalletRecord, "network" | "address">) {
  return `${input.network}:${input.address.toLowerCase()}`;
}

function walletFromVaultInfo(wallet: AgentWalletVaultInfo): PersonalWalletResponse {
  const timestamp = Date.parse(wallet.createdAt) || Date.now();
  return {
    agentId: wallet.agentId,
    id: wallet.agentId,
    name: personalWalletName(wallet.agentId, wallet.name ?? "", wallet.network),
    address: wallet.address,
    network: wallet.network,
    custodyMode: wallet.custodyMode,
    importedFrom: personalWalletImportSource(wallet.agentId, wallet.custodyMode),
    currentBalanceUsd: 0,
    nativeBalance: 0,
    tokens: [],
    portfolioVersion: 0,
    lastOnchainSyncAt: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function ledgerWalletWithSignerTruth(wallet: PersonalWalletResponse, vaultByAccount: Map<string, AgentWalletVaultInfo>): PersonalWalletResponse {
  const vaultWallet = vaultByAccount.get(walletAccountKey(wallet));
  if (!vaultWallet) {
    return {
      ...wallet,
      custodyMode: "watch",
      importedFrom: "watch",
    };
  }
  return {
    ...wallet,
    agentId: vaultWallet.agentId,
    id: vaultWallet.agentId,
    name: vaultWallet.name && isGenericPersonalWalletName(wallet.name) ? vaultWallet.name : wallet.name,
    custodyMode: vaultWallet.custodyMode,
    importedFrom: personalWalletImportSource(vaultWallet.agentId, vaultWallet.custodyMode),
  };
}

function agentWalletFromPersonalRecord(record: PersonalWalletRecord): AgentWalletConfig {
  const now = Date.now();
  return {
    ...createDefaultAgentWallet(record.id),
    enabled: false,
    provider: "manual",
    walletAddress: record.address,
    network: record.network,
    tokenSymbol: record.network.startsWith("solana:") ? "SOL" : "ETH",
    currentBalanceUsd: Number(record.currentBalanceUsd) || 0,
    custodyMode: record.custodyMode === "watch" ? "watch" : "local",
    onchainBalanceUsd: Number(record.currentBalanceUsd) || 0,
    nativeBalance: Number(record.nativeBalance) || 0,
    tokens: Array.isArray(record.tokens) ? record.tokens : [],
    lastOnchainSyncAt: Number(record.lastOnchainSyncAt) || 0,
    updatedAt: Number(record.updatedAt) || now,
  };
}

export async function GET(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    const vaultPath = url.searchParams.get("vaultPath") ?? undefined;
    const [ledger, vaultWallets] = await Promise.all([
      readWalletLedger(vaultPath),
      listWalletInfos({ agentIdPrefix: "user:" }),
    ]);
    const vaultByAccount = new Map(vaultWallets.map((wallet) => [walletAccountKey(wallet), wallet]));
    const ledgerWallets = ledger.records
      .filter((record) => record.agentId.startsWith("user:"))
      .map((record) => personalWalletFromAgentWallet(record.agentId, record.agentName, record.wallet))
      .filter((wallet): wallet is NonNullable<typeof wallet> => Boolean(wallet))
      .map((wallet) => ledgerWalletWithSignerTruth(wallet, vaultByAccount));
    const existing = new Set(ledgerWallets.map(walletAccountKey));
    const wallets = [
      ...ledgerWallets,
      ...vaultWallets
        .filter((wallet) => !existing.has(walletAccountKey(wallet)))
        .map(walletFromVaultInfo),
    ];
    return NextResponse.json({ ok: true, wallets });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read personal wallets.",
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as { vaultPath?: string; wallets?: PersonalWalletRecord[] };
    const records = await Promise.all((Array.isArray(body.wallets) ? body.wallets : [])
      .filter((wallet) => wallet.id?.startsWith("user:") && wallet.address && wallet.network)
      .map((wallet) => writeWalletRecord({
        vaultPath: body.vaultPath,
        agentId: wallet.id,
        agentName: wallet.name || `My ${wallet.network.startsWith("solana:") ? "Solana" : "Base"} wallet`,
        wallet: agentWalletFromPersonalRecord(wallet),
      })));
    return NextResponse.json({ ok: true, records });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not save personal wallets.",
    }, { status: 500 });
  }
}
