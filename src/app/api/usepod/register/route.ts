import { NextRequest, NextResponse } from "next/server";
import { registerUsePodToken, saveUsePodRegistration } from "@/lib/services/usepod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { saveToEnv?: boolean };
    const registration = await registerUsePodToken();
    if (body.saveToEnv !== false) await saveUsePodRegistration(registration);
    return NextResponse.json({
      ok: true,
      tokenEnvName: registration.tokenEnvName ?? "USEPOD_TOKEN",
      depositEnvName: "USEPOD_DEPOSIT_ADDRESS",
      depositAddress: registration.depositAddress,
      depositCode: registration.depositCode,
      dashboardUrl: registration.dashboardUrl,
      fundingUrl: registration.dashboardUrl || `https://usepod.ai/fund?token=${encodeURIComponent(registration.token)}`,
      tokenPreview: `${registration.token.slice(0, 6)}...${registration.token.slice(-4)}`,
      savedToEnv: body.saveToEnv !== false,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not register a UsePod token.",
    }, { status: 500 });
  }
}
