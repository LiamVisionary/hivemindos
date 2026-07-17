import { NextRequest } from "next/server";

import {
  BankrCopyTradingError,
  cancelBankrCopySubscription,
  changeBankrCopySubscription,
  fundBankrCopyWallet,
  getBankrCopyDashboard,
  publishBankrCopyPerformance,
  revokeBankrCopyPerformance,
  startBankrCopyTradingMonitor,
  verifyExistingBankrConnection,
} from "@/lib/services/trading/bankr-copy-trading";
import {
  BANKR_COPY_TRADING_API_KEY_ENV_NAMES,
  BANKR_COPY_TRADING_FEE_ACKNOWLEDGEMENT,
  BANKR_COPY_TRADING_RISK_ACKNOWLEDGEMENT,
} from "@/lib/services/trading/bankr-copy-trading-contract";
import { writeSharedHiveEnvValue } from "@/lib/services/hive-env-write";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RequestBody = {
  action?: "verify" | "start" | "subscribe" | "update" | "pause" | "resume" | "cancel" | "fund" | "publish-performance" | "revoke-performance";
  apiKey?: string;
  apiKeyEnv?: string;
  saveToHiveEnv?: boolean;
  activationIdempotencyKey?: string;
  fundingWalletId?: string;
  targetWallet?: string;
  connectionKind?: "existing" | "provisioned";
  subscriptionId?: string;
  maxTradeUsd?: number;
  maxDailyUsd?: number;
  scalePercent?: number;
  maxSlippageBps?: number;
  mode?: "paper" | "live";
  riskAcknowledgement?: string;
  feeAcknowledgement?: string;
  amountUsd?: number;
  confirmation?: string;
  approvalToken?: string;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return okJson(await getBankrCopyDashboard());
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as RequestBody | null;
  if (!body?.action) return errorJson("A Bankr copy-trading action is required.", 400);
  try {
    if (body.action === "verify") {
      const credential = await resolveBankrCopyApiKey(body);
      const wallet = await verifyExistingBankrConnection(credential.apiKey);
      if (body.saveToHiveEnv && body.apiKey?.trim()) {
        await writeSharedHiveEnvValue(credential.envKey, credential.apiKey);
      }
      return okJson({ wallet, apiKeyEnv: credential.envKey });
    }
    if (body.action === "start" || body.action === "subscribe") {
      if (!body.activationIdempotencyKey || !body.targetWallet || !body.connectionKind) {
        return errorJson("activationIdempotencyKey, targetWallet, and connectionKind are required.", 400);
      }
      const credential = body.connectionKind === "existing"
        ? await resolveBankrCopyApiKey(body)
        : null;
      const subscription = await startBankrCopyTradingMonitor({
        activationIdempotencyKey: body.activationIdempotencyKey,
        targetWallet: body.targetWallet,
        connectionKind: body.connectionKind,
        bankrApiKey: credential?.apiKey,
        maxTradeUsd: Number(body.maxTradeUsd),
        maxDailyUsd: Number(body.maxDailyUsd),
        scalePercent: Number(body.scalePercent),
        maxSlippageBps: Number(body.maxSlippageBps),
        mode: "live",
        riskAcknowledgement: body.riskAcknowledgement === BANKR_COPY_TRADING_RISK_ACKNOWLEDGEMENT
          ? body.riskAcknowledgement
          : "",
        feeAcknowledgement: body.feeAcknowledgement === BANKR_COPY_TRADING_FEE_ACKNOWLEDGEMENT
          ? body.feeAcknowledgement
          : "",
      });
      return okJson({ subscription }, { status: 201 });
    }
    if (!body.subscriptionId) return errorJson("subscriptionId is required.", 400);
    if (body.action === "pause" || body.action === "resume") {
      return okJson({ subscription: await changeBankrCopySubscription({
        subscriptionId: body.subscriptionId,
        status: body.action === "pause" ? "paused" : "active",
      }) });
    }
    if (body.action === "update") {
      return okJson({ subscription: await changeBankrCopySubscription({
        subscriptionId: body.subscriptionId,
        mode: body.mode,
        riskAcknowledgement: body.riskAcknowledgement,
        feeAcknowledgement: body.feeAcknowledgement,
        maxTradeUsd: body.maxTradeUsd,
        maxDailyUsd: body.maxDailyUsd,
        scalePercent: body.scalePercent,
        maxSlippageBps: body.maxSlippageBps,
      }) });
    }
    if (body.action === "cancel") {
      await cancelBankrCopySubscription(body.subscriptionId);
      return okJson({ canceled: true });
    }
    if (body.action === "publish-performance") {
      return okJson({ performancePublication: await publishBankrCopyPerformance(body.subscriptionId) });
    }
    if (body.action === "revoke-performance") {
      return okJson({ performanceRevocation: await revokeBankrCopyPerformance(body.subscriptionId) });
    }
    if (body.action === "fund") {
      if (!body.fundingWalletId) return errorJson("fundingWalletId is required.", 400);
      return okJson({ transfer: await fundBankrCopyWallet({
        subscriptionId: body.subscriptionId,
        fundingWalletId: body.fundingWalletId,
        amountUsd: Number(body.amountUsd),
        confirmation: body.confirmation,
        approvalToken: body.approvalToken,
      }) });
    }
    return errorJson("Unsupported Bankr copy-trading action.", 400);
  } catch (error) {
    return responseError(error);
  }
}

async function resolveBankrCopyApiKey(body: Pick<RequestBody, "apiKey" | "apiKeyEnv">) {
  const envKey = cleanEnvKey(body.apiKeyEnv)
    || (body.apiKey?.trim() ? BANKR_COPY_TRADING_API_KEY_ENV_NAMES[0] : "");
  const directValue = body.apiKey?.trim() ?? "";
  if (directValue) return { apiKey: directValue, envKey };
  if (!envKey) {
    throw new BankrCopyTradingError(400, "Choose a Shared Hive Env variable that contains a Bankr Wallet API key.");
  }
  const storedValue = await hiveEnvValue(envKey);
  if (!storedValue) {
    throw new BankrCopyTradingError(400, `${envKey} is not set in Shared Hive Env.`);
  }
  return { apiKey: storedValue, envKey };
}

function cleanEnvKey(value: string | undefined) {
  const key = value?.trim() ?? "";
  if (!key) return "";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new BankrCopyTradingError(400, "The Shared Hive Env variable name is invalid.");
  }
  return key;
}

function responseError(error: unknown) {
  if (error instanceof BankrCopyTradingError) {
    return errorJson(error.message, error.status, error.details);
  }
  return upstreamErrorJson("Bankr copy-trading request failed", error);
}
