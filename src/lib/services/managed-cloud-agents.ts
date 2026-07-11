import "server-only";

import { randomUUID } from "node:crypto";

import {
  MANAGED_CLOUD_FUND_CONFIRMATION,
  MANAGED_CLOUD_PAYMENT_NETWORK,
  OFFICIAL_MANAGED_CLOUD_AGENTS_BASE_URL,
  assertOfficialManagedCloudQuote,
  normalizeManagedCloudTopUp,
  type ManagedCloudAccount,
  type ManagedCloudAgent,
  type ManagedCloudAppProject,
  type ManagedCloudIntegration,
  type ManagedCloudPlan,
} from "@/lib/services/managed-cloud-agents-contract";
import {
  clearPendingManagedCloudSettlement,
  getManagedCloudAccountCredential,
  getPendingManagedCloudSettlement,
  storePendingManagedCloudSettlement,
  storeManagedCloudAccountToken,
} from "@/lib/services/managed-cloud-agent-token-vault";
import { sendUsdStable } from "@/lib/services/wallet/chain-wallet";
import { getWalletInfo, getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { readWalletLedger } from "@/lib/services/obsidian/wallet-ledger";
import { evaluateSpend, loadGovernanceWallet, resolveSpendGovernance } from "@/lib/services/wallet/spend-governance";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";
import { localTelemetryCollectorUrl } from "@/lib/services/hivemind-link-control";

type ApiObject = Record<string, unknown>;

export class ManagedCloudApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: ApiObject;

  constructor(status: number, message: string, code?: string, details?: ApiObject) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ManagedCloudFundingWallet = {
  id: string;
  name: string;
  address: string;
  maxPaymentUsd: number;
  autoPayEnabled: boolean;
  balanceUsd: number;
};

export async function listManagedCloudFundingWallets(): Promise<ManagedCloudFundingWallet[]> {
  const ledger = await readWalletLedger();
  const candidates = ledger.records.filter((record) => (
    record.wallet.enabled
    && record.wallet.network === MANAGED_CLOUD_PAYMENT_NETWORK
    && record.wallet.custodyMode === "local"
  ));
  const rows = await Promise.all(candidates.map(async (record) => {
    const signer = await getWalletInfo(record.agentId).catch(() => null);
    if (!signer) return null;
    return {
      id: record.agentId,
      name: record.agentName || record.wallet.agentId,
      address: signer.address,
      maxPaymentUsd: Number(record.wallet.maxPaymentUsd) || 0,
      autoPayEnabled: Boolean(record.wallet.autoPayEnabled),
      balanceUsd: Number(record.wallet.onchainBalanceUsd ?? record.wallet.currentBalanceUsd) || 0,
    } satisfies ManagedCloudFundingWallet;
  }));
  return rows
    .filter((row): row is ManagedCloudFundingWallet => Boolean(row))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function managedCloudRequest<T extends ApiObject>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${OFFICIAL_MANAGED_CLOUD_AGENTS_BASE_URL}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(600_000),
  });
  const payload = await response.json().catch(() => ({})) as ApiObject;
  if (!response.ok) {
    throw new ManagedCloudApiError(
      response.status,
      String(payload.error || `Managed cloud returned HTTP ${response.status}.`),
      typeof payload.code === "string" ? payload.code : undefined,
      payload,
    );
  }
  return payload as T;
}

async function requiredCredential() {
  const credential = await getManagedCloudAccountCredential();
  if (!credential) throw new ManagedCloudApiError(401, "Fund managed-agent credits before deploying your first cloud agent.", "managed_cloud_not_funded");
  return credential;
}

async function settleManagedCloudPayment(input: { quoteId: string; transactionHash: string }) {
  let settlement: {
    account: ManagedCloudAccount;
    accountToken?: string;
    creditedUsd: number;
    transactionHash: string;
  } | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      settlement = await managedCloudRequest<{
        account: ManagedCloudAccount;
        accountToken?: string;
        creditedUsd: number;
        transactionHash: string;
      }>("/v1/billing/settle", {
        method: "POST",
        body: JSON.stringify(input),
      });
      break;
    } catch (error) {
      if (!(error instanceof ManagedCloudApiError) || error.code !== "payment_confirming" || attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  if (!settlement) throw new ManagedCloudApiError(502, "Managed cloud payment could not be reconciled.", "settlement_unavailable");
  if (settlement.accountToken) {
    await storeManagedCloudAccountToken({ accountId: settlement.account.id, token: settlement.accountToken });
  }
  await clearPendingManagedCloudSettlement();
  return settlement;
}

export async function recoverPendingManagedCloudSettlement(): Promise<boolean> {
  const pending = await getPendingManagedCloudSettlement();
  if (!pending) return false;
  await settleManagedCloudPayment({ quoteId: pending.quoteId, transactionHash: pending.transactionHash });
  return true;
}

export async function getManagedCloudDashboard(): Promise<{
  configured: boolean;
  plans: ManagedCloudPlan[];
  topUpAmountsUsd: number[];
  account: ManagedCloudAccount | null;
  agents: ManagedCloudAgent[];
}> {
  await recoverPendingManagedCloudSettlement().catch(() => false);
  const catalog = await managedCloudRequest<{ plans: ManagedCloudPlan[]; topUpAmountsUsd: number[] }>("/v1/plans");
  const credential = await getManagedCloudAccountCredential();
  if (!credential) return { configured: false, plans: catalog.plans, topUpAmountsUsd: catalog.topUpAmountsUsd, account: null, agents: [] };
  try {
    const owned = await managedCloudRequest<{ account: ManagedCloudAccount; agents: ManagedCloudAgent[] }>("/v1/agents", {}, credential.token);
    return { configured: true, plans: catalog.plans, topUpAmountsUsd: catalog.topUpAmountsUsd, account: owned.account, agents: owned.agents };
  } catch (error) {
    if (error instanceof ManagedCloudApiError && error.status === 401) {
      return { configured: false, plans: catalog.plans, topUpAmountsUsd: catalog.topUpAmountsUsd, account: null, agents: [] };
    }
    throw error;
  }
}

export async function fundManagedCloudAccount(input: {
  walletAgentId: string;
  amountUsd: number;
  confirmation?: string;
  approvalToken?: string;
}): Promise<{ account: ManagedCloudAccount; creditedUsd: number; transactionHash: string }> {
  const amountUsd = normalizeManagedCloudTopUp(input.amountUsd);
  const walletAgentId = input.walletAgentId.trim();
  const [walletRecord, signer, existingCredential] = await Promise.all([
    loadGovernanceWallet(walletAgentId),
    getWalletSecret(walletAgentId),
    getManagedCloudAccountCredential(),
  ]);
  if (!walletRecord) throw new ManagedCloudApiError(404, "The selected funding wallet is missing from Wallets.", "wallet_not_found");
  if (!signer) throw new ManagedCloudApiError(404, "The encrypted local wallet key is missing.", "wallet_key_not_found");
  const wallet = walletRecord.wallet;
  if (!wallet.enabled) throw new ManagedCloudApiError(403, "The selected funding wallet is disabled.", "wallet_disabled");
  if (wallet.custodyMode !== "local") throw new ManagedCloudApiError(403, "Managed cloud funding requires a local signing wallet.", "local_wallet_required");
  if (wallet.network !== MANAGED_CLOUD_PAYMENT_NETWORK || signer.info.network !== MANAGED_CLOUD_PAYMENT_NETWORK) {
    throw new ManagedCloudApiError(403, "Managed cloud funding requires Base USDC.", "base_wallet_required");
  }
  if (wallet.maxPaymentUsd > 0 && amountUsd > wallet.maxPaymentUsd) {
    throw new ManagedCloudApiError(403, `The $${amountUsd.toFixed(2)} top up exceeds this wallet's $${wallet.maxPaymentUsd.toFixed(2)} per-payment cap.`, "wallet_payment_cap");
  }
  const confirmed = input.confirmation === MANAGED_CLOUD_FUND_CONFIRMATION;
  if (!wallet.autoPayEnabled && !confirmed) {
    throw new ManagedCloudApiError(409, `Confirm this payment with ${MANAGED_CLOUD_FUND_CONFIRMATION}.`, "confirmation_required");
  }

  const quoteResponse = await managedCloudRequest<{ quote: unknown }>(
    "/v1/billing/quotes",
    { method: "POST", body: JSON.stringify({ amountUsd }) },
    existingCredential?.token,
  );
  const quote = assertOfficialManagedCloudQuote(quoteResponse.quote, amountUsd);
  const governance = await resolveSpendGovernance(walletAgentId);
  let companyId: string | undefined;
  let approvalId: string | undefined;
  if (governance) {
    const decision = await evaluateSpend({
      wallet: governance.wallet,
      agentName: governance.agentName,
      kind: "api",
      asset: "USDC",
      amountUsd,
      target: quote.payTo,
      approvalToken: input.approvalToken,
      approvalThresholdSatisfied: confirmed,
      explanation: {
        summary: "Fund HivemindOS managed-agent compute and persistent storage credits.",
        whyNow: "A managed cloud agent needs prepaid credit before it can deploy or keep running.",
        impact: `This sends $${amountUsd.toFixed(2)} USDC on Base to the server-authored HivemindOS managed-agent recipient.`,
        requestedAction: "Approve only if this managed-agent top up is expected.",
        evidence: [`Network: ${quote.network}`, `Quote: ${quote.id}`],
        missingContext: [],
        source: "HivemindOS managed cloud",
      },
    });
    if (decision.decision === "block") throw new ManagedCloudApiError(403, decision.reason, "spend_blocked");
    if (decision.decision === "approve") {
      throw new ManagedCloudApiError(409, decision.reason, "approval_required", { approval: decision.approval });
    }
    companyId = decision.companyId;
    approvalId = decision.grant?.id;
  }

  const transfer = await sendUsdStable({
    network: signer.info.network,
    secret: signer.secret,
    fromAddress: signer.info.address,
    toAddress: quote.payTo,
    amountUsd,
  });
  await appendSpend({
    agentId: walletAgentId,
    companyId,
    kind: "api",
    asset: transfer.assetSymbol,
    amountUsd,
    target: shortTarget(quote.payTo),
    status: "executed",
    approvalId,
    transactionHash: transfer.signature,
  }).catch(() => undefined);

  await storePendingManagedCloudSettlement({ quoteId: quote.id, transactionHash: transfer.signature });
  const settlement = await settleManagedCloudPayment({ quoteId: quote.id, transactionHash: transfer.signature });
  if (!settlement.accountToken && !existingCredential) {
    throw new ManagedCloudApiError(502, "The cloud payment settled but no account credential was returned.", "missing_account_token", {
      transactionHash: transfer.signature,
      quoteId: quote.id,
    });
  }
  return {
    account: settlement.account,
    creditedUsd: settlement.creditedUsd,
    transactionHash: settlement.transactionHash,
  };
}

export async function createManagedCloudAgent(input: {
  name: string;
  planId: ManagedCloudPlan["id"];
  region?: string;
  modelTier?: "fast" | "balanced";
  idempotencyKey?: string;
}): Promise<{ account: ManagedCloudAccount; agent: ManagedCloudAgent }> {
  const credential = await requiredCredential();
  return managedCloudRequest("/v1/agents", {
    method: "POST",
    headers: { "idempotency-key": input.idempotencyKey || randomUUID() },
    body: JSON.stringify({ name: input.name, planId: input.planId, region: input.region, modelTier: input.modelTier }),
  }, credential.token);
}

export async function getManagedCloudAgent(instanceId: string) {
  const credential = await requiredCredential();
  return managedCloudRequest<{ agent: ManagedCloudAgent; health: { ok: boolean; status: number }; metering: unknown }>(`/v1/agents/${encodeURIComponent(instanceId)}`, {}, credential.token);
}

export async function listManagedCloudAppProjects(instanceId: string): Promise<ManagedCloudAppProject[]> {
  const credential = await requiredCredential();
  const result = await managedCloudRequest<{ projects: ManagedCloudAppProject[] }>(
    `/v1/agents/${encodeURIComponent(instanceId)}/apps`,
    {},
    credential.token,
  );
  return Array.isArray(result.projects) ? result.projects : [];
}

export async function getManagedCloudAppProject(instanceId: string, projectId: string): Promise<ManagedCloudAppProject> {
  const credential = await requiredCredential();
  const result = await managedCloudRequest<{ project: ManagedCloudAppProject }>(
    `/v1/agents/${encodeURIComponent(instanceId)}/apps/${encodeURIComponent(projectId)}`,
    {},
    credential.token,
  );
  return result.project;
}

export async function createManagedCloudAppProject(input: {
  instanceId: string;
  name: string;
  templateId?: "nextjs";
  idempotencyKey?: string;
}): Promise<ManagedCloudAppProject> {
  const credential = await requiredCredential();
  const result = await managedCloudRequest<{ project: ManagedCloudAppProject }>(
    `/v1/agents/${encodeURIComponent(input.instanceId)}/apps`,
    {
      method: "POST",
      headers: { "idempotency-key": input.idempotencyKey?.trim() || randomUUID() },
      body: JSON.stringify({ name: input.name, templateId: input.templateId || "nextjs" }),
    },
    credential.token,
  );
  return result.project;
}

export async function prepareManagedCloudAppArtifact(instanceId: string, projectId: string): Promise<Record<string, unknown>> {
  const credential = await requiredCredential();
  const result = await managedCloudRequest<{ artifact: Record<string, unknown> }>(
    `/v1/agents/${encodeURIComponent(instanceId)}/apps/${encodeURIComponent(projectId)}/artifact`,
    { method: "POST", body: "{}" },
    credential.token,
  );
  return result.artifact;
}

export async function changeManagedCloudAgentState(instanceId: string, action: "start" | "stop") {
  const credential = await requiredCredential();
  return managedCloudRequest<{ agent: ManagedCloudAgent }>(`/v1/agents/${encodeURIComponent(instanceId)}/${action}`, { method: "POST", body: "{}" }, credential.token);
}

export async function deleteManagedCloudAgent(instanceId: string) {
  const credential = await requiredCredential();
  return managedCloudRequest<{ deleted: boolean; agent: ManagedCloudAgent }>(`/v1/agents/${encodeURIComponent(instanceId)}`, { method: "DELETE" }, credential.token);
}

export async function chatWithManagedCloudAgent(instanceId: string, messages: unknown[]) {
  const credential = await requiredCredential();
  return managedCloudRequest<ApiObject>(`/v1/agents/${encodeURIComponent(instanceId)}/chat`, {
    method: "POST",
    body: JSON.stringify({ messages, stream: false }),
  }, credential.token);
}

export async function listManagedCloudIntegrations(instanceId: string): Promise<ManagedCloudIntegration[]> {
  const credential = await requiredCredential();
  const result = await managedCloudRequest<{ integrations: ManagedCloudIntegration[] }>(
    `/v1/agents/${encodeURIComponent(instanceId)}/integrations`,
    {},
    credential.token,
  );
  return result.integrations;
}

export async function addManagedCloudTailnet(input: { instanceId: string; authKey: string; advertiseTag?: string }) {
  const credential = await requiredCredential();
  return managedCloudRequest<{ integration: ManagedCloudIntegration; agent: ManagedCloudAgent }>(
    `/v1/agents/${encodeURIComponent(input.instanceId)}/integrations`,
    {
      method: "POST",
      body: JSON.stringify({ kind: "tailnet_auth", authKey: input.authKey, advertiseTag: input.advertiseTag }),
    },
    credential.token,
  );
}

export async function addManagedCloudRemoteMcp(input: {
  instanceId: string;
  name: string;
  url: string;
  authorization?: string;
}) {
  const credential = await requiredCredential();
  return managedCloudRequest<{ integration: ManagedCloudIntegration; agent: ManagedCloudAgent }>(
    `/v1/agents/${encodeURIComponent(input.instanceId)}/integrations`,
    {
      method: "POST",
      body: JSON.stringify({
        kind: "remote_mcp",
        name: input.name,
        url: input.url,
        headers: input.authorization ? { Authorization: input.authorization } : {},
      }),
    },
    credential.token,
  );
}

async function collectorJson(path: string, init: RequestInit = {}) {
  const response = await fetch(`${localTelemetryCollectorUrl().replace(/\/$/, "")}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || payload?.ok === false) {
    throw new ManagedCloudApiError(response.status, String(payload?.error || `Local Syncthing returned HTTP ${response.status}.`), "local_syncthing_error");
  }
  return payload || {};
}

export async function pairManagedCloudSharedBrain(input: { instanceId: string; localTailnetDnsName: string }) {
  const credential = await requiredCredential();
  const [agentResult, localStatus] = await Promise.all([
    getManagedCloudAgent(input.instanceId),
    collectorJson("/syncthing/status"),
  ]);
  const cloudAgent = agentResult.agent;
  if (!cloudAgent.tailnet.dnsName || !cloudAgent.sharedBrain.deviceId) {
    throw new ManagedCloudApiError(409, "Connect the cloud agent to your Tailnet and wait for Syncthing readiness before pairing the Shared Brain.", "cloud_sync_not_ready");
  }
  const localDeviceId = String(localStatus.deviceID || "");
  const localPath = String(localStatus.defaultSyncPath || "");
  if (!localDeviceId || !localPath) {
    throw new ManagedCloudApiError(409, "Local Syncthing is not ready or has no default Shared Brain path.", "local_sync_not_ready");
  }
  const cloudIntegration = await managedCloudRequest<{ integration: ManagedCloudIntegration; agent: ManagedCloudAgent }>(
    `/v1/agents/${encodeURIComponent(input.instanceId)}/integrations`,
    {
      method: "POST",
      body: JSON.stringify({
        kind: "brain_peer",
        name: "this-mac-brain",
        deviceId: localDeviceId,
        dnsName: input.localTailnetDnsName,
      }),
    },
    credential.token,
  );
  const local = await collectorJson("/syncthing/configure", {
    method: "POST",
    body: JSON.stringify({
      folderId: "hivemindos-vault",
      label: "hivemindos-vault",
      path: localPath,
      peerDeviceID: cloudAgent.sharedBrain.deviceId,
      peerName: cloudAgent.name,
      peerAddresses: [`tcp://${cloudAgent.tailnet.dnsName}:22000`, "dynamic"],
    }),
  });
  return { integration: cloudIntegration.integration, agent: cloudIntegration.agent, local };
}

export async function removeManagedCloudIntegration(instanceId: string, integrationId: string) {
  const credential = await requiredCredential();
  return managedCloudRequest<{ removed: boolean; agent: ManagedCloudAgent }>(
    `/v1/agents/${encodeURIComponent(instanceId)}/integrations/${encodeURIComponent(integrationId)}`,
    { method: "DELETE" },
    credential.token,
  );
}
