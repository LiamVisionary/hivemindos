import { NextRequest, NextResponse } from "next/server";
import { buildUsePodTokenEnvNameFromToken, saveUsePodRegistration } from "@/lib/services/usepod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SaveUsePodTokenBody = {
  token?: string;
  tokenEnvName?: string;
  dashboardUrl?: string;
  depositAddress?: string;
  depositCode?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as SaveUsePodTokenBody;
    const token = body.token?.trim() ?? "";
    const compact = token.replace(/[^A-Za-z0-9-]/g, "");
    if (compact.length < 16) {
      return NextResponse.json({ ok: false, error: "UsePod token is required." }, { status: 400 });
    }
    const tokenEnvName = buildUsePodTokenEnvNameFromToken(compact);
    const dashboardUrl = body.dashboardUrl?.trim()
      || `https://usepod.ai/dashboard?token=${encodeURIComponent(compact)}`;
    await saveUsePodRegistration({
      token: compact,
      tokenEnvName,
      dashboardUrl,
      depositAddress: body.depositAddress?.trim() ?? "",
      depositCode: body.depositCode?.trim() ?? "",
      raw: null,
    });
    return NextResponse.json({ ok: true, tokenEnvName, dashboardUrl });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not save UsePod token.",
    }, { status: 500 });
  }
}
