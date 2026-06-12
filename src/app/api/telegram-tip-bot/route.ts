import { NextRequest } from "next/server";

import { getTreasuryOverview } from "@/lib/services/telegram-tip-bot/hive-chain";
import { totalLiabilitiesRaw } from "@/lib/services/telegram-tip-bot/ledger";
import { getTelegramTipBotStatus, startTelegramTipBot, stopTelegramTipBot } from "@/lib/services/telegram-tip-bot/runner";
import { mutateTipBotState, readTipBotState } from "@/lib/services/telegram-tip-bot/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const state = await readTipBotState();
    const status = getTelegramTipBotStatus();
    const treasury = state.settings.treasuryAddress
      ? await getTreasuryOverview(state.settings.treasuryAddress).catch(() => null)
      : null;
    return Response.json({
      ok: true,
      runner: status,
      paused: state.settings.paused,
      token: {
        address: state.settings.tokenAddress,
        symbol: state.settings.tokenSymbol,
        decimals: state.settings.tokenDecimals,
      },
      users: Object.keys(state.users).length,
      tips: state.ledger.filter((entry) => entry.kind === "tip").length,
      liabilitiesRaw: totalLiabilitiesRaw(state).toString(),
      withdrawals: {
        pending: state.withdrawals.filter((w) => w.status === "pending" || w.status === "processing").length,
        needsReview: state.withdrawals.filter((w) => w.status === "needs-review").length,
      },
      openClaims: Object.values(state.claims).filter((claim) => claim.status === "open").length,
      treasury,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not read tip bot state." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    switch (body.action) {
      case "start":
        return Response.json({ ok: true, runner: await startTelegramTipBot() });
      case "stop":
        return Response.json({ ok: true, runner: await stopTelegramTipBot() });
      case "pause":
      case "resume": {
        const paused = body.action === "pause";
        await mutateTipBotState((draft) => {
          draft.settings.paused = paused;
        });
        return Response.json({ ok: true, paused });
      }
      default:
        return Response.json({ ok: false, error: "Unknown action. Use start, stop, pause, or resume." }, { status: 400 });
    }
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Tip bot action failed." },
      { status: 500 },
    );
  }
}
