import { NextRequest } from "next/server";

import { readStoredAgentProfiles } from "@/lib/services/agent-profile-store";
import { readWalletLedger, writeWalletRecord } from "@/lib/services/obsidian/wallet-ledger";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { resolveAgentWallet } from "@/lib/utils/agent-wallet";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const vaultPath = request.nextUrl.searchParams.get("vaultPath") ?? undefined;
    const ledger = await readWalletLedger(vaultPath);
    // Ledger files only hold what was explicitly written to the vault. Live
    // runtime balances (UsePod's usePod.lastBalanceRemaining) live on the
    // agent profile instead — the dashboard merges them client-side via
    // resolveAgentWallet, so do the same here or remote consumers (the phone
    // app) see a zero balance the dashboard doesn't.
    const agents = await readStoredAgentProfiles().catch(() => []);
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const records = ledger.records.map((record) => {
      const agent = agentsById.get(record.agentId);
      return agent ? { ...record, wallet: resolveAgentWallet(agent, record.wallet) } : record;
    });
    return Response.json({ ok: true, ...ledger, records });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read wallet ledger.",
    }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      vaultPath?: string;
      agentId?: string;
      agentName?: string;
      runtime?: string;
      machineName?: string;
      wallet?: AgentWalletConfig;
    };
    if (!body.agentId?.trim()) {
      return Response.json({ ok: false, error: "Missing agentId." }, { status: 400 });
    }
    if (!body.wallet) {
      return Response.json({ ok: false, error: "Missing wallet payload." }, { status: 400 });
    }
    const record = await writeWalletRecord({
      vaultPath: body.vaultPath,
      agentId: body.agentId,
      agentName: body.agentName ?? body.agentId,
      runtime: body.runtime,
      machineName: body.machineName,
      wallet: body.wallet,
    });
    return Response.json({ ok: true, record });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not write wallet record.",
    }, { status: 400 });
  }
}
