import { NextRequest, NextResponse } from "next/server";

import { HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID } from "@/lib/config/hivemindos-wallet-paid-models";
import {
  getHivemindosModelCreditToken,
  listHivemindosModelCreditTokenSummaries,
  type HivemindosModelCreditTokenSummary,
} from "@/lib/services/hivemindos-model-credit-vault";
import {
  configureXCommandAccount,
  getXCommandAccount,
  getXCommandHealth,
  pairXCommandDevice,
  responseObject,
  revokeXCommandDevice,
} from "@/lib/services/x-command/x-command-client";
import {
  startXCommandDriver,
  stopXCommandDriver,
  pulseXCommandDriver,
  xCommandDriverStatus,
} from "@/lib/services/x-command/x-command-driver";
import {
  clearXCommandDevice,
  readXCommandDevice,
  storeXCommandDevice,
} from "@/lib/services/x-command/x-command-device-vault";
import {
  disableXCommandWalletPolicy,
  listXCommandTradeReceipts,
  readXCommandWalletPolicy,
  saveXCommandWalletPolicy,
} from "@/lib/services/x-command/x-command-wallet-policy";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  action?: string;
  creditAccountId?: string;
  connectionId?: string;
  enabled?: boolean;
  queenMode?: "local" | "disabled";
  replyMode?: "dashboard" | "auto-ai";
  maxPaidCommandUsd?: number;
  deviceId?: string;
  name?: string;
  walletId?: string;
  walletIds?: string[];
  walletName?: string;
  walletPolicyEnabled?: boolean;
  maxTradeUsd?: number;
  dailyTradeLimitUsd?: number;
  slippageBps?: number;
};

function orderedAccounts(records: HivemindosModelCreditTokenSummary[]) {
  return [...records].sort((left, right) => {
    const leftShared = left.walletAgentId === HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID ? 1 : 0;
    const rightShared = right.walletAgentId === HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID ? 1 : 0;
    return rightShared - leftShared || right.updatedAt.localeCompare(left.updatedAt);
  });
}

async function accountCredential(requestedId = "") {
  const accounts = orderedAccounts(await listHivemindosModelCreditTokenSummaries());
  const selected = accounts.find((account) => account.walletAgentId === requestedId) ?? accounts[0] ?? null;
  const token = selected
    ? await getHivemindosModelCreditToken(selected.walletAgentId, selected.slug).catch(() => "")
    : "";
  return { accounts, selected, token };
}

async function localDevicePayload() {
  const [device, walletPolicy, tradeReceipts] = await Promise.all([
    readXCommandDevice(),
    readXCommandWalletPolicy(),
    listXCommandTradeReceipts(),
  ]);
  return {
    paired: Boolean(device),
    device: device ? { id: device.id, name: device.name, pairedAt: device.pairedAt } : null,
    driver: xCommandDriverStatus(),
    walletPolicy,
    tradeReceipts,
  };
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const selectedId = request.nextUrl.searchParams.get("creditAccountId")?.trim() || "";
  const { accounts, selected, token } = await accountCredential(selectedId);
  const healthPromise = responseObject(await getXCommandHealth().catch(() => new Response("{}", { status: 503 })));
  const accountPromise = token
    ? getXCommandAccount(token).then(async (response) => ({ status: response.status, payload: await responseObject(response) }))
    : Promise.resolve({ status: 200, payload: { ok: true, connections: [], jobs: [], devices: [], policy: null } });
  const [health, account, local] = await Promise.all([healthPromise, accountPromise, localDevicePayload()]);
  return NextResponse.json({
    ok: true,
    health,
    creditAccounts: accounts.map((item) => ({ accountId: item.walletAgentId, slug: item.slug, updatedAt: item.updatedAt })),
    selectedCreditAccountId: selected?.walletAgentId ?? "",
    creditsConfigured: Boolean(token),
    gateway: account.payload,
    gatewayStatus: account.status,
    local,
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as Body;
  const origin = request.nextUrl.origin;

  if (body.action === "start-driver") return NextResponse.json({ ok: true, driver: startXCommandDriver(origin) });
  if (body.action === "stop-driver") return NextResponse.json({ ok: true, driver: stopXCommandDriver() });
  if (body.action === "pulse") return NextResponse.json({ ok: true, driver: await pulseXCommandDriver(origin) });

  if (body.action === "save-wallet-policy") {
    try {
      const walletIds = Array.from(new Set([
        body.walletId?.trim() || "",
        ...(Array.isArray(body.walletIds) ? body.walletIds.map((id) => id.trim()) : []),
      ].filter(Boolean))).slice(0, 8);
      if (!walletIds.length) return NextResponse.json({ ok: false, error: "Choose a HivemindOSBot wallet first." }, { status: 400 });
      const stored = (await Promise.all(walletIds.map((walletId) => getWalletSecret(walletId))))
        .filter((wallet): wallet is NonNullable<typeof wallet> => Boolean(wallet))
        .filter((wallet) => ["eip155:8453", "eip155:4663", "solana:mainnet"].includes(wallet.info.network));
      if (!stored.length) {
        return NextResponse.json({ ok: false, error: "That selection has no local Base, Robinhood Chain, or Solana signing account." }, { status: 400 });
      }
      const primary = stored.find((wallet) => wallet.info.agentId === body.walletId?.trim()) ?? stored[0];
      const walletPolicy = await saveXCommandWalletPolicy({
        enabled: body.walletPolicyEnabled === true,
        walletId: body.walletId?.trim() || primary.info.agentId,
        walletName: body.walletName?.trim() || primary.info.name || "HivemindOSBot wallet",
        address: primary.info.address,
        network: primary.info.network,
        accounts: stored.map((wallet) => ({
          walletId: wallet.info.agentId,
          address: wallet.info.address,
          network: wallet.info.network,
        })),
        maxTradeUsd: Number(body.maxTradeUsd),
        dailyTradeLimitUsd: Number(body.dailyTradeLimitUsd),
        slippageBps: Number(body.slippageBps),
      });
      if (walletPolicy.enabled && await readXCommandDevice()) startXCommandDriver(origin);
      return NextResponse.json({ ok: true, walletPolicy });
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not save the HivemindOSBot wallet authorization." }, { status: 400 });
    }
  }

  if (body.action === "disable-wallet-policy") {
    return NextResponse.json({ ok: true, walletPolicy: await disableXCommandWalletPolicy() });
  }

  const { selected, token } = await accountCredential(body.creditAccountId?.trim() || "");
  if (!selected || !token) {
    return NextResponse.json({ ok: false, error: "Fund HivemindOS hosted credits before connecting the X command bot." }, { status: 402 });
  }

  if (body.action === "configure") {
    const response = await configureXCommandAccount(token, {
      connectionId: body.connectionId,
      enabled: body.enabled === true,
      queenMode: body.queenMode === "disabled" ? "disabled" : "local",
      replyMode: body.replyMode === "auto-ai" ? "auto-ai" : "dashboard",
      maxPaidCommandUsd: body.maxPaidCommandUsd,
    });
    if (response.ok && body.enabled === true && await readXCommandDevice()) startXCommandDriver(origin);
    return response;
  }

  if (body.action === "pair-device") {
    const response = await pairXCommandDevice(token, body.name?.trim() || "HivemindOS Queen");
    const payload = await responseObject(response);
    const device = payload.device && typeof payload.device === "object" && !Array.isArray(payload.device)
      ? payload.device as Record<string, unknown>
      : null;
    const deviceToken = typeof payload.deviceToken === "string" ? payload.deviceToken : "";
    const deviceId = typeof device?.id === "string" ? device.id : "";
    if (!response.ok || !deviceId || !deviceToken) return NextResponse.json(payload, { status: response.status });
    await storeXCommandDevice({
      id: deviceId,
      name: typeof device?.name === "string" ? device.name : "HivemindOS Queen",
      token: deviceToken,
      pairedAt: typeof device?.createdAt === "string" ? device.createdAt : new Date().toISOString(),
    });
    startXCommandDriver(origin);
    return NextResponse.json({ ok: true, device, driver: xCommandDriverStatus() }, { status: 201 });
  }

  if (body.action === "revoke-device") {
    const deviceId = body.deviceId?.trim() || "";
    if (!deviceId) return NextResponse.json({ ok: false, error: "deviceId is required." }, { status: 400 });
    const response = await revokeXCommandDevice(token, deviceId);
    if (response.ok && (await readXCommandDevice())?.id === deviceId) {
      stopXCommandDriver();
      await clearXCommandDevice();
    }
    return response;
  }

  return NextResponse.json({ ok: false, error: `Unknown X command action "${body.action ?? ""}".` }, { status: 400 });
}
