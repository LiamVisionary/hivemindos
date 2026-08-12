export type ChatResponseBilling = {
  provider?: string;
  label?: string;
  source?: string;
  costUsd?: number;
  balanceUsd?: number;
  creditsDebited?: number;
  creditsBalance?: number;
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
  const creditsDebited = finiteNumber(record.creditsDebited);
  const creditsBalance = finiteNumber(record.creditsBalance);
  const opaqueManagedCredits = provider?.toLowerCase() === "hivemindos-models"
    && (source?.toLowerCase() === "prepaid-credit"
      || creditsDebited !== undefined
      || creditsBalance !== undefined);
  // Historical prepaid HivemindOS messages persisted the private USD debit and
  // balance. Scrub those fields as records are hydrated so old conversations
  // cannot keep rendering the retired dollar-denominated credit contract.
  const costUsd = opaqueManagedCredits ? undefined : finiteNumber(record.costUsd);
  const balanceUsd = opaqueManagedCredits ? undefined : finiteNumber(record.balanceUsd);
  const paid = typeof record.paid === "boolean" ? record.paid : undefined;
  if (
    !provider && !label && !source && costUsd === undefined && balanceUsd === undefined
    && creditsDebited === undefined && creditsBalance === undefined && paid === undefined && !network
  ) return undefined;
  return {
    provider,
    label,
    source,
    costUsd,
    balanceUsd,
    creditsDebited,
    creditsBalance,
    paid,
    network,
  };
}
