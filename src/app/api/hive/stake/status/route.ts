import { formatUnits } from "viem";
import type { Address } from "viem";
import { NextRequest, NextResponse } from "next/server";
import { getHiveStakeStatus, isHiveEvmAddress } from "@/lib/services/hive-staking";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StatusBody = {
  addresses?: string[];
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as StatusBody;
    const addresses = [...new Set((Array.isArray(body.addresses) ? body.addresses : [])
      .map((address) => address.trim())
      .filter(isHiveEvmAddress)
      .map((address) => address.toLowerCase() as Address))].slice(0, 25);
    const statuses = await Promise.all(addresses.map(async (address) => {
      const status = await getHiveStakeStatus({ account: address });
      return {
        address,
        activeStakedHive: Number(formatUnits(status.activeStakedRaw, 18)),
        pendingUnstakeHive: Number(formatUnits(status.pendingUnstakeRaw, 18)),
        unstakeAvailableAt: status.unstakeAvailableAt.toString(),
        tier: status.tier?.id ?? null,
        paused: status.paused,
      };
    }));
    return NextResponse.json({ ok: true, statuses });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not read HIVE stake status." }, { status: 500 });
  }
}
