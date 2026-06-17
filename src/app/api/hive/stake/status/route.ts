import { formatUnits } from "viem";
import type { Address } from "viem";
import { NextRequest, NextResponse } from "next/server";
import { isHiveEvmAddress } from "@/lib/config/hive-staking";
import { createHiveStakingPublicClient, getHiveStakeAccountStatus, getHiveStakingContractStatus } from "@/lib/services/hive-staking";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StatusBody = {
  addresses?: string[];
};

type StakeStatusApiRow = {
  address: Address;
  activeStakedHive: number;
  pendingUnstakeHive: number;
  unstakeAvailableAt: string;
  cooldownSeconds: number;
  tier: string | null;
  paused: boolean;
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
    if (!addresses.length) {
      return NextResponse.json({ ok: true, statuses: [] });
    }
    const client = createHiveStakingPublicClient();
    const contractStatus = await getHiveStakingContractStatus({ client });
    const statusResults = await Promise.all(addresses.map(async (address): Promise<StakeStatusApiRow | null> => {
      try {
        const status = await getHiveStakeAccountStatus({ account: address, client });
        return {
          address,
          activeStakedHive: Number(formatUnits(status.activeStakedRaw, 18)),
          pendingUnstakeHive: Number(formatUnits(status.pendingUnstakeRaw, 18)),
          unstakeAvailableAt: status.unstakeAvailableAt.toString(),
          cooldownSeconds: Number(contractStatus.cooldown),
          tier: status.tier?.id ?? null,
          paused: contractStatus.paused,
        };
      } catch {
        return null;
      }
    }));
    const statuses = statusResults.filter((status): status is StakeStatusApiRow => Boolean(status));
    return NextResponse.json({
      ok: true,
      cooldownSeconds: Number(contractStatus.cooldown),
      paused: contractStatus.paused,
      statuses,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not read HIVE stake status." }, { status: 500 });
  }
}
