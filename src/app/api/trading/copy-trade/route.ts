import { NextRequest, NextResponse } from "next/server";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  ENGINE_OFFLINE_AFTER_MS,
  MAX_COPY_TRADE_USD,
  defaultCopyTradingConfig,
  isCopyTradeNetwork,
  type CopyTradingConfig,
} from "@/lib/types/copy-trading";
import {
  normalizeConfig,
  readConfigs,
  readEngineStatus,
  readRuntimeStates,
  removeConfig,
  setConfigEnabled,
  upsertConfig,
} from "@/lib/services/copy-trading/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Config + status surface for copy-trading. This route NEVER runs the engine or
 * executes swaps — the standalone daemon is the sole execution host (so two
 * processes can't double-mirror the same target tx). It only reads/writes the
 * shared ~/.hivemindos/copy-trading.json store and reports the daemon's status.
 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const [configs, states, engine] = await Promise.all([readConfigs(), readRuntimeStates(), readEngineStatus()]);
    const online = Boolean(engine && Date.now() - engine.heartbeatMs < ENGINE_OFFLINE_AFTER_MS);
    return NextResponse.json({ ok: true, configs, states, engine, online });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to read copy-trading." }, { status: 500 });
  }
}

type Body = {
  action?: "upsert" | "start" | "stop" | "delete";
  id?: string;
  config?: Partial<CopyTradingConfig>;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    switch (body.action) {
      case "upsert":
        return await handleUpsert(body.config ?? {});
      case "start":
        return await handleEnable(body.id, true);
      case "stop":
        return await handleEnable(body.id, false);
      case "delete":
        if (!body.id) return bad("A config id is required.");
        await removeConfig(body.id);
        return NextResponse.json({ ok: true });
      default:
        return bad("Unknown action.");
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Copy-trading update failed." }, { status: 400 });
  }
}

async function handleUpsert(input: Partial<CopyTradingConfig>): Promise<NextResponse> {
  const agentId = String(input.agentId || "").trim();
  const network = input.network;
  const walletAddress = String(input.walletAddress || "").trim();
  const targetAddress = String(input.targetAddress || "").trim();

  if (!agentId) return bad("Pick an acting wallet first.");
  if (!isCopyTradeNetwork(network)) return bad("Copy-trading runs on Base or Solana only.");
  if (!targetAddress) return bad("Enter the wallet address to copy.");
  if (!isValidAddress(targetAddress, network)) return bad("That target address isn't valid for this chain.");
  if (targetAddress.toLowerCase() === walletAddress.toLowerCase()) return bad("Pick a target other than the acting wallet (no self-copy).");
  if (input.maxCopyUsd != null && Number(input.maxCopyUsd) > MAX_COPY_TRADE_USD + 0.001) {
    return bad(`Max per trade can't exceed $${MAX_COPY_TRADE_USD} on this rail.`);
  }

  // The acting wallet must have a local signing key — watch-only / Bankr can't sign mirrors.
  const stored = await getWalletSecret(agentId);
  if (!stored) return bad("That wallet has no local signing key, so it can't copy-trade. Use a local-signer wallet.");
  if (stored.info.network !== network) return bad("The acting wallet's network doesn't match the chosen chain.");

  const base = defaultCopyTradingConfig({ id: input.id || newId(), agentId, walletAddress: stored.info.address, network });
  const merged = normalizeConfig({ ...base, ...input, id: base.id, agentId, walletAddress: stored.info.address, network });
  const saved = await upsertConfig(merged);
  return NextResponse.json({ ok: true, config: saved });
}

async function handleEnable(id: string | undefined, enabled: boolean): Promise<NextResponse> {
  if (!id) return bad("A config id is required.");
  const config = await setConfigEnabled(id, enabled);
  if (!config) return bad("No such copy-trading config.");
  return NextResponse.json({ ok: true, config });
}

function isValidAddress(address: string, network: CopyTradingConfig["network"]): boolean {
  if (network === "solana:mainnet") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function newId(): string {
  return `ct_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function bad(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
