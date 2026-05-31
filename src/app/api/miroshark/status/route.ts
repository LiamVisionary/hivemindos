import { getMiroSharkCompanionStatus } from "@/lib/services/miroshark/companion-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIROSHARK_STATUS_CACHE_MS = 60_000;
const MIROSHARK_RUNNING_STATUS_CACHE_MS = 10_000;

let cachedStatus: {
  checkedAt: number;
  payload: Awaited<ReturnType<typeof getMiroSharkCompanionStatus>>;
} | null = null;
let inFlightStatus: ReturnType<typeof getMiroSharkCompanionStatus> | null = null;

export async function GET(request: Request) {
  const now = Date.now();
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const cacheMs = cachedStatus?.payload.install.running ? MIROSHARK_RUNNING_STATUS_CACHE_MS : MIROSHARK_STATUS_CACHE_MS;
  if (!forceRefresh && cachedStatus && now - cachedStatus.checkedAt < cacheMs) {
    return Response.json(cachedStatus.payload);
  }

  if (forceRefresh) {
    inFlightStatus = null;
  }
  inFlightStatus ??= getMiroSharkCompanionStatus({ requestUrl: request.url })
    .then((payload) => {
      cachedStatus = { checkedAt: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      inFlightStatus = null;
    });

  return Response.json(await inFlightStatus);
}
