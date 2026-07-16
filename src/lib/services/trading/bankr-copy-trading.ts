import "server-only";

import {
  BANKR_COPY_TRADING_FUND_CONFIRMATION,
  BANKR_COPY_TRADING_MAX_PLAN_PRICE_USD,
  BANKR_COPY_TRADING_PAYMENT_CONFIRMATION,
  BANKR_COPY_TRADING_PAYMENT_NETWORK,
  OFFICIAL_BANKR_COPY_TRADING_BASE_URL,
  type BankrCopyConnectionKind,
  type BankrCopyDashboard,
  type BankrCopyFundingWallet,
  type BankrCopySubscription,
} from "./bankr-copy-trading-contract";
import {
  getBankrCopyCredential,
  listBankrCopyCredentials,
  listBankrCopyRecoveries,
  removeBankrCopyCredential,
  removeBankrCopyRecovery,
  storeBankrCopyCredential,
  storeBankrCopyRecovery,
} from "./bankr-copy-trading-vault";
import { readWalletLedger } from "@/lib/services/obsidian/wallet-ledger";
import { sendUsdStable } from "@/lib/services/wallet/chain-wallet";
import { getWalletInfo, getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { evaluateSpend, loadGovernanceWallet } from "@/lib/services/wallet/spend-governance";
import { executeX402Fetch } from "@/lib/services/wallet/x402-agent-fetch";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";

type JsonObject = Record<string, unknown>;

export class BankrCopyTradingError extends Error {
  constructor(readonly status: number, message: string, readonly details: JsonObject = {}) {
    super(message);
  }
}

export async function listBankrCopyFundingWallets(): Promise<BankrCopyFundingWallet[]> {
  const ledger = await readWalletLedger();
  const rows = await Promise.all(ledger.records
    .filter((record) => record.wallet.enabled && record.wallet.network === BANKR_COPY_TRADING_PAYMENT_NETWORK && record.wallet.custodyMode === "local")
    .map(async (record) => {
      const signer = await getWalletInfo(record.agentId).catch(() => null);
      if (!signer) return null;
      return {
        id: record.agentId,
        name: record.agentName || record.agentId,
        address: signer.address,
        balanceUsd: Number(record.wallet.onchainBalanceUsd ?? record.wallet.currentBalanceUsd) || 0,
        maxPaymentUsd: Number(record.wallet.maxPaymentUsd) || 0,
      } satisfies BankrCopyFundingWallet;
    }));
  return rows.filter((row): row is BankrCopyFundingWallet => Boolean(row)).sort((left, right) => left.name.localeCompare(right.name));
}

export async function getBankrCopyDashboard(): Promise<BankrCopyDashboard> {
  await retryPendingBankrCopyRecoveries();
  const [health, pricing, fundingWallets, credentials] = await Promise.all([
    hostedRequest<JsonObject>("/health").catch(() => ({})),
    hostedRequest<{ pricing?: JsonObject }>("/v1/pricing").catch(() => ({})),
    listBankrCopyFundingWallets(),
    listBankrCopyCredentials(),
  ]);
  const pendingRecoveryCount = (await listBankrCopyRecoveries()).length;
  const subscriptions = await Promise.all(credentials.map(async (credential) => {
    try {
      const current = await readHostedSubscription(
        credential.subscription.targetWallet,
        credential.subscription.id,
        credential.accessToken,
      );
      await storeBankrCopyCredential({ subscription: current.subscription, accessToken: credential.accessToken });
      return current;
    } catch (error) {
      return {
        subscription: credential.subscription,
        events: [],
        statusError: error instanceof Error ? error.message : "Subscription status is unavailable.",
      };
    }
  }));
  const healthRecord = isRecord(health) ? health : {};
  const pricingRecord = isRecord(pricing) ? pricing : {};
  const plan = isRecord(pricingRecord.pricing) ? pricingRecord.pricing : {};
  return {
    available: healthRecord.enabled === true,
    managedExecutionAvailable: healthRecord.bankrManagedExecution === true,
    liveEnabled: healthRecord.liveEnabled === true,
    partnerProvisioningConfigured: healthRecord.partnerProvisioningConfigured === true,
    priceUsd: positiveNumber(plan.priceUsd, 4.99),
    periodDays: positiveNumber(plan.durationDays, 30),
    pendingRecoveryCount,
    fundingWallets,
    subscriptions,
  };
}

export async function verifyExistingBankrConnection(apiKey: string): Promise<{ evmAddress: string }> {
  const payload = await hostedRequest<{ wallet?: JsonObject }>("/v1/bankr/verify", {
    method: "POST",
    body: JSON.stringify({ apiKey: apiKey.trim() }),
  });
  const address = isRecord(payload.wallet) && typeof payload.wallet.evmAddress === "string"
    ? payload.wallet.evmAddress.toLowerCase()
    : "";
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new BankrCopyTradingError(502, "The hosted service did not return a valid Bankr wallet.");
  return { evmAddress: address };
}

export async function subscribeToBankrCopyTrading(input: {
  paymentWalletId: string;
  targetWallet: string;
  connectionKind: BankrCopyConnectionKind;
  bankrApiKey?: string;
  maxTradeUsd: number;
  maxDailyUsd: number;
  scalePercent: number;
  maxSlippageBps: number;
  mode?: "paper" | "live";
}): Promise<BankrCopySubscription> {
  const [walletRecord, signer] = await Promise.all([
    loadGovernanceWallet(input.paymentWalletId),
    getWalletSecret(input.paymentWalletId),
  ]);
  if (!walletRecord || !signer) throw new BankrCopyTradingError(404, "The selected Base payment wallet or its encrypted signer is missing.");
  if (!walletRecord.wallet.enabled) throw new BankrCopyTradingError(403, "The selected payment wallet is disabled.");
  if (signer.info.network !== BANKR_COPY_TRADING_PAYMENT_NETWORK || walletRecord.wallet.network !== BANKR_COPY_TRADING_PAYMENT_NETWORK) {
    throw new BankrCopyTradingError(403, "The x402 subscription payment requires a Base wallet.");
  }
  const maxPaymentUsd = walletRecord.wallet.maxPaymentUsd > 0
    ? Math.min(BANKR_COPY_TRADING_MAX_PLAN_PRICE_USD, walletRecord.wallet.maxPaymentUsd)
    : BANKR_COPY_TRADING_MAX_PLAN_PRICE_USD;
  const requestBody = {
    targetWallet: input.targetWallet,
    bankrConnection: input.connectionKind === "existing"
      ? { kind: "existing", apiKey: input.bankrApiKey?.trim() || "" }
      : { kind: "provisioned" },
    mode: input.mode || "paper",
    maxTradeUsd: input.maxTradeUsd,
    maxDailyUsd: input.maxDailyUsd,
    scalePercent: input.scalePercent,
    maxSlippageBps: input.maxSlippageBps,
  };
  const result = await executeX402Fetch({
    agentId: input.paymentWalletId,
    network: signer.info.network,
    secret: signer.secret,
    fromAddress: signer.info.address,
    url: `${OFFICIAL_BANKR_COPY_TRADING_BASE_URL}/v1/subscriptions`,
    method: "POST",
    body: requestBody,
    policy: {
      enabled: true,
      provider: "x402",
      network: BANKR_COPY_TRADING_PAYMENT_NETWORK,
      maxPaymentUsd,
      approvalRequiredOverUsd: 0,
      autoPayEnabled: false,
      x402BaseUrl: OFFICIAL_BANKR_COPY_TRADING_BASE_URL,
    },
    confirmation: BANKR_COPY_TRADING_PAYMENT_CONFIRMATION,
    approvalThresholdSatisfied: true,
    skipPlatformFee: true,
    timeoutMs: 90_000,
    approvalContext: {
      summary: "Buy 30 days of always-on Bankr copy-trading monitoring.",
      whyNow: "The hosted worker needs a paid subscription before it can monitor the target wallet continuously.",
      impact: "This pays the server-authored x402 USDC price on Base. It does not fund the Bankr trading wallet.",
      requestedAction: "Approve only if this target wallet and subscription price are expected.",
      evidence: [`Target: ${input.targetWallet}`, `Execution: ${input.connectionKind} Bankr wallet`],
      source: "HivemindOS Bankr copy trading",
    },
  });
  const payload = isRecord(result.bodyJson) ? result.bodyJson : {};
  if (!result.ok && payload.paymentSettled === true) {
    const receiptId = stringValue(payload.receiptId);
    const recoveryToken = stringValue(payload.recoveryToken);
    if (receiptId && recoveryToken) {
      return recoverPaidBankrCopyActivation(receiptId, recoveryToken, 3);
    }
  }
  if (!result.ok) {
    throw new BankrCopyTradingError(
      result.status || 502,
      typeof payload.error === "string" ? payload.error : "The x402 Bankr copy-trading subscription failed.",
      payload,
    );
  }
  const subscriptionId = stringValue(payload.subscriptionId);
  const accessToken = stringValue(payload.accessToken);
  const targetWallet = stringValue(payload.targetWallet).toLowerCase();
  if (!subscriptionId || !accessToken || !/^0x[0-9a-f]{40}$/.test(targetWallet)) {
    throw new BankrCopyTradingError(502, "The paid subscription response did not include its management credential.");
  }
  const current = await readHostedSubscription(targetWallet, subscriptionId, accessToken);
  await storeBankrCopyCredential({ subscription: current.subscription, accessToken });
  return current.subscription;
}

export async function changeBankrCopySubscription(input: {
  subscriptionId: string;
  status?: "active" | "paused";
  mode?: "paper" | "live";
  riskAcknowledgement?: string;
  maxTradeUsd?: number;
  maxDailyUsd?: number;
  scalePercent?: number;
  maxSlippageBps?: number;
}): Promise<BankrCopySubscription> {
  const credential = await requiredCredential(input.subscriptionId);
  const patch = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.riskAcknowledgement ? { riskAcknowledgement: input.riskAcknowledgement } : {}),
    ...(input.maxTradeUsd !== undefined ? { maxTradeUsd: input.maxTradeUsd } : {}),
    ...(input.maxDailyUsd !== undefined ? { maxDailyUsd: input.maxDailyUsd } : {}),
    ...(input.scalePercent !== undefined ? { scalePercent: input.scalePercent } : {}),
    ...(input.maxSlippageBps !== undefined ? { maxSlippageBps: input.maxSlippageBps } : {}),
  };
  if (!Object.keys(patch).length) throw new BankrCopyTradingError(400, "Choose a subscription setting to update.");
  const payload = await hostedRequest<{ subscription?: BankrCopySubscription }>(subscriptionPath(credential.subscription), {
    method: "PATCH",
    headers: { authorization: `Bearer ${credential.accessToken}` },
    body: JSON.stringify(patch),
  });
  if (!payload.subscription) throw new BankrCopyTradingError(502, "The hosted service did not return the updated subscription.");
  await storeBankrCopyCredential({ subscription: payload.subscription, accessToken: credential.accessToken });
  return payload.subscription;
}

export async function cancelBankrCopySubscription(subscriptionId: string): Promise<void> {
  const credential = await requiredCredential(subscriptionId);
  await hostedRequest(subscriptionPath(credential.subscription), {
    method: "DELETE",
    headers: { authorization: `Bearer ${credential.accessToken}` },
  });
  await removeBankrCopyCredential(subscriptionId);
}

export async function fundBankrCopyWallet(input: {
  subscriptionId: string;
  fundingWalletId: string;
  amountUsd: number;
  confirmation?: string;
  approvalToken?: string;
}): Promise<{ transactionHash: string; amountUsd: number; bankrWallet: string }> {
  if (input.confirmation !== BANKR_COPY_TRADING_FUND_CONFIRMATION) {
    throw new BankrCopyTradingError(409, `Confirm this transfer with ${BANKR_COPY_TRADING_FUND_CONFIRMATION}.`);
  }
  const amountUsd = Number(input.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd < 1 || amountUsd > 500) {
    throw new BankrCopyTradingError(400, "Funding amount must be from $1 through $500 USDC.");
  }
  const [credential, walletRecord, signer] = await Promise.all([
    requiredCredential(input.subscriptionId),
    loadGovernanceWallet(input.fundingWalletId),
    getWalletSecret(input.fundingWalletId),
  ]);
  if (!walletRecord || !signer) throw new BankrCopyTradingError(404, "The selected funding wallet or its encrypted signer is missing.");
  if (!walletRecord.wallet.enabled || walletRecord.wallet.custodyMode !== "local") {
    throw new BankrCopyTradingError(403, "Funding requires an enabled local Base wallet.");
  }
  if (walletRecord.wallet.network !== BANKR_COPY_TRADING_PAYMENT_NETWORK || signer.info.network !== BANKR_COPY_TRADING_PAYMENT_NETWORK) {
    throw new BankrCopyTradingError(403, "Funding requires a Base wallet.");
  }
  if (walletRecord.wallet.maxPaymentUsd > 0 && amountUsd > walletRecord.wallet.maxPaymentUsd) {
    throw new BankrCopyTradingError(403, "The funding amount exceeds this wallet's per-payment cap.");
  }
  let approvalId: string | undefined;
  if (walletRecord) {
    const decision = await evaluateSpend({
      wallet: walletRecord.wallet,
      agentName: walletRecord.agentName,
      kind: "send",
      asset: "USDC",
      amountUsd,
      target: credential.subscription.bankrWallet,
      approvalToken: input.approvalToken,
      approvalThresholdSatisfied: true,
      explanation: {
        summary: "Fund the Bankr wallet used for this copy-trading subscription.",
        whyNow: "Bankr can only copy trades from assets already held in its execution wallet.",
        impact: `This sends $${amountUsd.toFixed(2)} USDC on Base to ${credential.subscription.bankrWallet}.`,
        requestedAction: "Approve only if this is the expected Bankr execution wallet.",
        evidence: [`Subscription: ${input.subscriptionId}`, `Target trader: ${credential.subscription.targetWallet}`],
        source: "HivemindOS Bankr copy trading",
      },
    });
    if (decision.decision === "block") throw new BankrCopyTradingError(403, decision.reason);
    if (decision.decision === "approve") throw new BankrCopyTradingError(409, decision.reason, { approval: decision.approval });
    approvalId = decision.grant?.id;
  }
  const transfer = await sendUsdStable({
    network: signer.info.network,
    secret: signer.secret,
    fromAddress: signer.info.address,
    toAddress: credential.subscription.bankrWallet,
    amountUsd,
  });
  await appendSpend({
    agentId: input.fundingWalletId,
    kind: "send",
    asset: transfer.assetSymbol,
    amountUsd,
    target: shortTarget(credential.subscription.bankrWallet),
    status: "executed",
    approvalId,
    transactionHash: transfer.signature,
  }).catch(() => undefined);
  return { transactionHash: transfer.signature, amountUsd, bankrWallet: credential.subscription.bankrWallet };
}

async function retryPendingBankrCopyRecoveries(): Promise<void> {
  const pending = await listBankrCopyRecoveries();
  for (const recovery of pending.slice(0, 3)) {
    await recoverPaidBankrCopyActivation(recovery.receiptId, recovery.recoveryToken, 1).catch(async (error) => {
      if (error instanceof BankrCopyTradingError && [400, 409, 410].includes(error.status)) {
        await removeBankrCopyRecovery(recovery.receiptId);
      }
    });
  }
}

async function recoverPaidBankrCopyActivation(
  receiptId: string,
  recoveryToken: string,
  maxAttempts: number,
): Promise<BankrCopySubscription> {
  let currentToken = recoveryToken;
  await storeBankrCopyRecovery({ receiptId, recoveryToken: currentToken });
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const payload = await hostedRequest<JsonObject>("/v1/subscriptions/recover", {
        method: "POST",
        body: JSON.stringify({ recoveryToken: currentToken }),
        signal: AbortSignal.timeout(20_000),
      });
      const subscriptionId = stringValue(payload.subscriptionId);
      const accessToken = stringValue(payload.accessToken);
      const targetWallet = stringValue(payload.targetWallet).toLowerCase();
      if (!subscriptionId || !accessToken || !/^0x[0-9a-f]{40}$/.test(targetWallet)) {
        throw new BankrCopyTradingError(502, "Activation recovery did not return its management credential.");
      }
      const current = await readHostedSubscription(targetWallet, subscriptionId, accessToken);
      await storeBankrCopyCredential({ subscription: current.subscription, accessToken });
      await removeBankrCopyRecovery(receiptId);
      return current.subscription;
    } catch (error) {
      if (error instanceof BankrCopyTradingError) {
        const replacement = stringValue(error.details.recoveryToken);
        if (replacement) {
          currentToken = replacement;
          await storeBankrCopyRecovery({ receiptId, recoveryToken: currentToken });
        }
        if ([400, 409, 410].includes(error.status)) {
          await removeBankrCopyRecovery(receiptId);
          throw new BankrCopyTradingError(
            error.status,
            error.message,
            { paymentSettled: true, recoveryFailed: true, receiptId },
          );
        }
      }
    }
  }
  throw new BankrCopyTradingError(
    503,
    "The x402 payment settled, and activation recovery is safely queued. HivemindOS will retry when the dashboard refreshes; do not pay again.",
    { paymentSettled: true, recoveryQueued: true, receiptId },
  );
}

async function readHostedSubscription(targetWallet: string, subscriptionId: string, accessToken: string) {
  return hostedRequest<{
    subscription: BankrCopySubscription;
    events: BankrCopyDashboard["subscriptions"][number]["events"];
    usageToday?: { signalCount: number; reservedUsd: number; maxDailyUsd: number };
  }>(`/v1/subscriptions/${targetWallet}/${encodeURIComponent(subscriptionId)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

async function requiredCredential(subscriptionId: string) {
  const credential = await getBankrCopyCredential(subscriptionId);
  if (!credential) throw new BankrCopyTradingError(404, "This Bankr copy-trading subscription is not stored on this device.");
  return credential;
}

function subscriptionPath(subscription: Pick<BankrCopySubscription, "targetWallet" | "id">): string {
  return `/v1/subscriptions/${subscription.targetWallet}/${encodeURIComponent(subscription.id)}`;
}

async function hostedRequest<T extends JsonObject>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${OFFICIAL_BANKR_COPY_TRADING_BASE_URL}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
      signal: init.signal || AbortSignal.timeout(30_000),
    });
  } catch {
    throw new BankrCopyTradingError(502, "The hosted Bankr copy-trading service is unreachable.");
  }
  const payload = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    const body = isRecord(payload) ? payload : {};
    throw new BankrCopyTradingError(response.status, typeof body.error === "string" ? body.error : `Hosted copy trading returned HTTP ${response.status}.`, body);
  }
  if (!isRecord(payload)) throw new BankrCopyTradingError(502, "The hosted copy-trading service returned invalid JSON.");
  return payload as T;
}

function positiveNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
