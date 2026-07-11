import "server-only";

import { resolvePooledHivemindosModelCreditToken } from "@/lib/services/hivemindos-model-credit-vault";
import { managedMediaBaseUrl } from "@/lib/services/paid-agent-cloud-client";
import { appendSpend } from "@/lib/services/wallet/spend-ledger";
import { evaluateSpend, resolveSpendGovernance } from "@/lib/services/wallet/spend-governance";
import type {
  HostedMediaGenerateInput,
  HostedMediaQuoteInput,
} from "@/lib/services/hosted-media-generation-domain";

const CREDIT_SLUG = "default";
const HOSTED_MEDIA_TIMEOUT_MS = 120_000;

export type HostedMediaGatewayResult = {
  status: number;
  payload: Record<string, unknown>;
};

export async function getHostedMediaCatalog(): Promise<HostedMediaGatewayResult> {
  return callHostedMediaGateway("", { method: "GET" });
}

export async function quoteHostedMedia(input: HostedMediaQuoteInput): Promise<HostedMediaGatewayResult> {
  return callHostedMediaGateway("quote", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function generateHostedMedia(input: HostedMediaGenerateInput): Promise<HostedMediaGatewayResult> {
  const governance = await resolveSpendGovernance(input.agentId);
  const decision = governance
    ? await evaluateSpend({
        wallet: governance.wallet,
        agentName: governance.agentName,
        kind: "api",
        asset: "USDC",
        amountUsd: input.maximumDebitUsd,
        target: managedMediaBaseUrl(),
        approvalToken: input.approvalToken,
        approvalThresholdSatisfied: input.confirmation === "CONFIRM_HOSTED_MEDIA_GENERATION",
        explanation: {
          headline: `Generate media with up to $${input.maximumDebitUsd.toFixed(2)} of hosted credits.`,
          summary: `Reserve hosted HivemindOS credits for ${input.model}.`,
          whyNow: "An agent requested a paid media generation through the official hosted route.",
          impact: "The gateway may spend provider funds and debit no more than the approved maximum from hosted credits.",
          requestedAction: "Approve only if this exact model request and maximum debit are intended.",
          evidence: [`Model: ${input.model}`, `Maximum debit: $${input.maximumDebitUsd.toFixed(6)}`, `Idempotency key: ${input.idempotencyKey}`],
          missingContext: [],
          source: "HivemindOS hosted media generation",
        },
      })
    : null;
  if (decision?.decision === "block") {
    return { status: 403, payload: { ok: false, error: decision.reason, governance: decision } };
  }
  if (decision?.decision === "approve") {
    return { status: 409, payload: { ok: false, error: decision.reason, approvalRequired: true, governance: decision } };
  }

  const token = await resolvePooledHivemindosModelCreditToken(CREDIT_SLUG, [input.agentId]);
  if (!token) {
    return {
      status: 402,
      payload: {
        ok: false,
        error: "Add HivemindOS Models credits before using hosted media generation.",
        creditSlug: CREDIT_SLUG,
      },
    };
  }
  const result = await callHostedMediaGateway("generate", {
    method: "POST",
    headers: {
      "idempotency-key": input.idempotencyKey,
      "x-hivemindos-credit-token": token,
    },
    body: JSON.stringify({
      model: input.model,
      input: input.input,
      maximumDebitUsd: input.maximumDebitUsd,
    }),
  });

  const billing = isRecord(result.payload.billing) ? result.payload.billing : {};
  const reservedUsd = numberValue(billing.reservedUsd);
  if (result.status === 202 && result.payload.duplicate !== true && reservedUsd > 0) {
    try {
      await appendSpend({
        agentId: input.agentId,
        companyId: decision?.companyId,
        kind: "api",
        asset: "USDC",
        amountUsd: reservedUsd,
        target: `hosted-media:${input.model}`,
        status: "executed",
        approvalId: decision?.grant?.id,
      });
    } catch (error) {
      result.payload.localGovernanceWarning = errorMessage(error, "The hosted generation started, but its local budget receipt could not be recorded.");
    }
  }
  return result;
}

export async function getHostedMediaJob(input: { jobId: string; agentId: string }): Promise<HostedMediaGatewayResult> {
  const token = await resolvePooledHivemindosModelCreditToken(CREDIT_SLUG, [input.agentId]);
  if (!token) {
    return { status: 401, payload: { ok: false, error: "The hosted credit token for this media job is unavailable." } };
  }
  return callHostedMediaGateway(`jobs/${encodeURIComponent(input.jobId)}`, {
    method: "GET",
    headers: { "x-hivemindos-credit-token": token },
  });
}

async function callHostedMediaGateway(path: string, init: RequestInit): Promise<HostedMediaGatewayResult> {
  const baseUrl = managedMediaBaseUrl();
  if (!baseUrl) return { status: 424, payload: { ok: false, error: "Official hosted media generation is not configured." } };
  const target = path ? `${baseUrl}/${path.replace(/^\/+/, "")}` : baseUrl;
  try {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(target, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(HOSTED_MEDIA_TIMEOUT_MS),
    });
    const value = await response.json().catch(() => null);
    return {
      status: response.status,
      payload: isRecord(value)
        ? value
        : { ok: false, error: `Hosted media gateway returned HTTP ${response.status} without a JSON response.` },
    };
  } catch (error) {
    return { status: 502, payload: { ok: false, error: errorMessage(error, "Hosted media gateway is unreachable.") } };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
