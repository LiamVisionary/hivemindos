export type HostedMediaAction = "quote" | "generate" | "job";

export type HostedMediaQuoteInput = {
  model: string;
  input: Record<string, unknown>;
};

export type HostedMediaGenerateInput = HostedMediaQuoteInput & {
  agentId: string;
  maximumDebitUsd: number;
  idempotencyKey: string;
  approvalToken?: string;
  confirmation?: string;
  companyTaskId?: string;
};

const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const JOB_PATTERN = /^media_[a-zA-Z0-9_-]{8,100}$/;
const MAXIMUM_HOSTED_MEDIA_DEBIT_USD = 25;

export function normalizeHostedMediaAction(value: unknown): HostedMediaAction {
  const action = isRecord(value) ? stringValue(value.action).toLowerCase() : "";
  if (action === "quote" || action === "generate" || action === "job") return action;
  throw new Error("Hosted media action must be quote, generate, or job.");
}

export function normalizeHostedMediaQuoteInput(value: unknown): HostedMediaQuoteInput {
  if (!isRecord(value)) throw new Error("Hosted media request must be a JSON object.");
  const model = stringValue(value.model).toLowerCase();
  if (!MODEL_PATTERN.test(model)) throw new Error("Hosted media model is invalid.");
  if (!isRecord(value.input) || Object.keys(value.input).length === 0) {
    throw new Error("Hosted media input must be a non-empty JSON object.");
  }
  return { model, input: value.input };
}

export function normalizeHostedMediaGenerateInput(value: unknown): HostedMediaGenerateInput {
  if (!isRecord(value)) throw new Error("Hosted media request must be a JSON object.");
  const quote = normalizeHostedMediaQuoteInput(value);
  const agentId = boundedString(value.agentId, 200);
  if (!agentId) throw new Error("A local agent id is required for hosted media spending.");
  const maximumDebitUsd = Number(value.maximumDebitUsd);
  if (!Number.isFinite(maximumDebitUsd) || maximumDebitUsd <= 0 || maximumDebitUsd > MAXIMUM_HOSTED_MEDIA_DEBIT_USD) {
    throw new Error(`Hosted media maximum debit must be greater than $0 and no more than $${MAXIMUM_HOSTED_MEDIA_DEBIT_USD}.`);
  }
  const idempotencyKey = boundedString(value.idempotencyKey, 200);
  if (!idempotencyKey) throw new Error("A bounded idempotency key is required for hosted media generation.");
  const approvalToken = boundedString(value.approvalToken, 200);
  const confirmation = boundedString(value.confirmation, 100);
  const companyTaskId = boundedString(value.companyTaskId, 200);
  return {
    ...quote,
    agentId,
    maximumDebitUsd: roundSix(maximumDebitUsd),
    idempotencyKey,
    ...(approvalToken ? { approvalToken } : {}),
    ...(confirmation ? { confirmation } : {}),
    ...(companyTaskId ? { companyTaskId } : {}),
  };
}

export function normalizeHostedMediaJobId(value: unknown) {
  const jobId = stringValue(value);
  if (!JOB_PATTERN.test(jobId)) throw new Error("Hosted media job id is invalid.");
  return jobId;
}

function boundedString(value: unknown, maximumLength: number) {
  const text = stringValue(value);
  return text.length <= maximumLength ? text : "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function roundSix(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
