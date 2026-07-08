import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { generateWallet, type SupportedWalletNetwork } from "@/lib/services/wallet/chain-wallet";
import { getWalletSecret, storeWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { readWalletLedger, writeWalletRecord } from "@/lib/services/obsidian/wallet-ledger";
import { refreshWalletVaultBackup } from "@/lib/services/wallet/wallet-vault-backup";
import { createDefaultAgentWallet } from "@/lib/utils/agent-wallet";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WalletSetupBody = {
  action?: "create" | "link";
  agentId?: string;
  agentName?: string;
  walletVaultId?: string;
  network?: string;
  vaultPath?: string;
};

type VaultSyncResult =
  | { ok: true; status: Awaited<ReturnType<typeof refreshWalletVaultBackup>> }
  | { ok: false; error: string };

const DEFAULT_NETWORK: SupportedWalletNetwork = "eip155:8453";
const SUPPORTED_NETWORKS = new Set(["eip155:8453", "eip155:84532", "eip155:4663", "solana:mainnet", "solana:devnet"]);
const SETUP_WALLET_PREFIX = "hivemindos-models";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as WalletSetupBody;
    const action = body.action === "link" ? "link" : "create";
    const agentName = body.agentName?.trim() || "HivemindOS Models agent";

    if (action === "link") {
      const sourceVaultId = body.walletVaultId?.trim() || "";
      if (!sourceVaultId) {
        return NextResponse.json({ ok: false, error: "walletVaultId is required to link a wallet." }, { status: 400 });
      }
      const existing = await getWalletSecret(sourceVaultId);
      if (!existing) {
        return NextResponse.json({ ok: false, error: "The selected wallet is not available in the encrypted local vault." }, { status: 404 });
      }
      await persistWalletRecord({
        vaultPath: body.vaultPath,
        walletId: existing.info.agentId,
        agentName,
        address: existing.info.address,
        network: existing.info.network,
      });
      const vaultSync = await refreshWalletVaultBackupStatus(body.vaultPath);
      return NextResponse.json({
        ok: true,
        wallet: {
          vaultId: existing.info.agentId,
          address: existing.info.address,
          network: existing.info.network,
          kind: existing.info.agentId.startsWith("user:") ? "personal" : "agent",
        },
        vaultSync,
      });
    }

    const network = normalizeNetwork(body.network);
    const generated = generateWallet(network);
    const walletId = durableWalletId(body.agentId);
    const info = await storeWalletSecret({
      agentId: walletId,
      name: agentName,
      address: generated.address,
      network: generated.network,
      secret: generated.secret,
    });
    await persistWalletRecord({
      vaultPath: body.vaultPath,
      walletId: info.agentId,
      agentName,
      address: info.address,
      network: info.network,
    });
    const vaultSync = await refreshWalletVaultBackupStatus(body.vaultPath);
    return NextResponse.json({
      ok: true,
      wallet: {
        vaultId: info.agentId,
        address: info.address,
        network: info.network,
        kind: info.agentId.startsWith("user:") ? "personal" : "agent",
      },
      vaultSync,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not prepare HivemindOS Models wallet." }, { status: 500 });
  }
}

function durableWalletId(agentId?: string) {
  const trimmed = agentId?.trim() || "";
  if (trimmed && !trimmed.startsWith("new-")) return trimmed;
  return `${SETUP_WALLET_PREFIX}:${randomUUID()}`;
}

function normalizeNetwork(network?: string): SupportedWalletNetwork {
  const trimmed = network?.trim() || DEFAULT_NETWORK;
  if (!SUPPORTED_NETWORKS.has(trimmed)) return DEFAULT_NETWORK;
  return trimmed as SupportedWalletNetwork;
}

async function persistWalletRecord(input: {
  vaultPath?: string;
  walletId: string;
  agentName: string;
  address: string;
  network: string;
}) {
  const ledger = await readWalletLedger(input.vaultPath);
  const existingRecord = ledger.records.find((record) => record.agentId === input.walletId);
  const existingWallet = existingRecord?.wallet;
  const now = Date.now();
  await writeWalletRecord({
    vaultPath: input.vaultPath,
    agentId: input.walletId,
    agentName: existingRecord?.agentName || `${input.agentName} Models wallet`,
    runtime: existingRecord?.runtime || "hivemind-os",
    wallet: hivemindosModelsFundingWallet({
      existingWallet,
      walletId: input.walletId,
      address: input.address,
      network: input.network,
      now,
    }),
  });
}

function hivemindosModelsFundingWallet(input: {
  existingWallet?: AgentWalletConfig;
  walletId: string;
  address: string;
  network: string;
  now: number;
}): AgentWalletConfig {
  const base = input.existingWallet ?? {
    ...createDefaultAgentWallet(input.walletId),
    provider: "manual" as const,
  };
  return {
    ...base,
    enabled: true,
    walletAddress: input.address,
    vaultAddress: input.address,
    network: input.network,
    tokenSymbol: base.tokenSymbol || stableTokenSymbol(input.network),
    maxPaymentUsd: Number(base.maxPaymentUsd) > 0 ? Number(base.maxPaymentUsd) : 0.5,
    approvalRequiredOverUsd: Number.isFinite(base.approvalRequiredOverUsd) ? Number(base.approvalRequiredOverUsd) : 2,
    custodyMode: "local",
    updatedAt: input.now,
    notes: fundingWalletNotes(base.notes),
  };
}

function stableTokenSymbol(network: string): "USDC" | "USDG" {
  return network === "eip155:4663" ? "USDG" : "USDC";
}

function fundingWalletNotes(notes?: string) {
  const trimmed = notes?.trim() || "";
  const marker = "Selected as a HivemindOS Models LLM funding source.";
  if (!trimmed) return marker;
  if (trimmed.includes(marker)) return trimmed;
  return `${trimmed}\n${marker}`;
}

function refreshWalletVaultBackupStatus(vaultPath?: string): Promise<VaultSyncResult> {
  return refreshWalletVaultBackup(vaultPath).then(
    (status) => ({ ok: true, status }),
    (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "Encrypted wallet vault sync failed." }),
  );
}
