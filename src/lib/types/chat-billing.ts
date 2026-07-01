export type ChatResponseBilling = {
  provider?: string;
  label?: string;
  source?: string;
  costUsd?: number;
  balanceUsd?: number;
  paid?: boolean;
  network?: string;
};

function cleanString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function finiteNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function normalizeChatResponseBilling(value: unknown): ChatResponseBilling | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const provider = cleanString(record.provider);
  const label = cleanString(record.label);
  const source = cleanString(record.source);
  const network = cleanString(record.network);
  const costUsd = finiteNumber(record.costUsd);
  const balanceUsd = finiteNumber(record.balanceUsd);
  const paid = typeof record.paid === "boolean" ? record.paid : undefined;
  if (!provider && !label && !source && costUsd === undefined && balanceUsd === undefined && paid === undefined && !network) return undefined;
  return {
    provider,
    label,
    source,
    costUsd,
    balanceUsd,
    paid,
    network,
  };
}
