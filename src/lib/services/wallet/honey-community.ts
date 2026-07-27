import { getHoneyWorkspaceId } from "@/lib/services/wallet/honey-ledger";
import { honeyComputeGatewayUrl } from "@/lib/services/wallet/honey-economy-config";

export type TelegramHoneyLinkResult = {
  linked: true;
  publicLabel: string;
};

export type HoneyContributionTier = {
  id: string;
  label: string;
  minimumHoney: number;
  multiplierBps: number;
  multiplier: number;
};

export type HoneyContributionStatus = {
  linked: boolean;
  publicLabel: string | null;
  linkedAt: string | null;
  honey: number;
  sources: {
    verifiedWork: number;
    peerRecognition: number;
    historicalTipSeed: number;
  };
  reviewedContributions: number;
  tier: HoneyContributionTier | null;
  nextTier: (HoneyContributionTier & { honeyNeeded: number }) | null;
  quotaMultiplierBps: number;
  quotaMultiplier: number;
};

export async function readHoneyContributionStatus(): Promise<HoneyContributionStatus> {
  const workspaceId = await getHoneyWorkspaceId();
  const response = await fetch(
    `${honeyComputeGatewayUrl()}/community/status?workspaceId=${encodeURIComponent(workspaceId)}`,
    { cache: "no-store", signal: AbortSignal.timeout(8_000) },
  );
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !data?.ok || typeof data.linked !== "boolean") {
    throw upstreamError(data?.error, response.status, "HONEY contribution status failed");
  }
  return {
    linked: data.linked,
    publicLabel: cleanNullableString(data.publicLabel),
    linkedAt: cleanNullableString(data.linkedAt),
    honey: nonNegativeNumber(data.honey),
    sources: honeySources(data.sources),
    reviewedContributions: Math.floor(nonNegativeNumber(data.reviewedContributions)),
    tier: contributionTier(data.tier),
    nextTier: contributionNextTier(data.nextTier),
    quotaMultiplierBps: quotaMultiplierBps(data.quotaMultiplierBps),
    quotaMultiplier: quotaMultiplierBps(data.quotaMultiplierBps) / 10_000,
  };
}

function honeySources(value: unknown): HoneyContributionStatus["sources"] {
  const sources = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    verifiedWork: nonNegativeNumber(sources.verifiedWork),
    peerRecognition: nonNegativeNumber(sources.peerRecognition),
    historicalTipSeed: nonNegativeNumber(sources.historicalTipSeed),
  };
}

export type TelegramHoneyLinkIntent = {
  deepLink: string;
  expiresAt: string;
};

// Tap-to-link: mint a one-time intent for this workspace and hand back the
// t.me deep link. The member taps Start in Telegram and the bot completes the
// link — no typed code. The gateway wallet-gates minting like /community/link.
export async function createTelegramHoneyLinkIntent(): Promise<TelegramHoneyLinkIntent> {
  const workspaceId = await getHoneyWorkspaceId();
  const response = await fetch(`${honeyComputeGatewayUrl()}/community/link-intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
    signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    deepLink?: string;
    expiresAt?: string;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok || typeof data.deepLink !== "string" || !data.deepLink.startsWith("https://t.me/")) {
    throw upstreamError(data?.error, response.status, "Telegram link request failed");
  }
  return { deepLink: data.deepLink, expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : "" };
}

export async function linkTelegramHoney(codeInput: string): Promise<TelegramHoneyLinkResult> {
  const code = codeInput.trim();
  if (!/^hny_[a-f0-9]{10}$/i.test(code)) throw new Error("Enter the one-time code from /linkhoney.");
  const workspaceId = await getHoneyWorkspaceId();
  const response = await fetch(`${honeyComputeGatewayUrl()}/community/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, workspaceId }),
    signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    linked?: boolean;
    publicLabel?: string;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok || !data.linked || !data.publicLabel) {
    throw upstreamError(data?.error, response.status, "Telegram HONEY link failed");
  }
  return { linked: true, publicLabel: data.publicLabel };
}

function contributionTier(value: unknown): HoneyContributionTier | null {
  if (!value || typeof value !== "object") return null;
  const tier = value as Record<string, unknown>;
  const id = cleanNullableString(tier.id);
  const label = cleanNullableString(tier.label);
  const multiplierBps = quotaMultiplierBps(tier.multiplierBps);
  if (!id || !label || !/^contributor-[1-6]$/.test(id) || multiplierBps <= 10_000) return null;
  return {
    id,
    label,
    minimumHoney: nonNegativeNumber(tier.minimumHoney),
    multiplierBps,
    multiplier: multiplierBps / 10_000,
  };
}

function contributionNextTier(value: unknown): HoneyContributionStatus["nextTier"] {
  const tier = contributionTier(value);
  if (!tier || !value || typeof value !== "object") return null;
  return { ...tier, honeyNeeded: nonNegativeNumber((value as Record<string, unknown>).honeyNeeded) };
}

function quotaMultiplierBps(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 10_000 && number <= 20_000 ? number : 10_000;
}

function nonNegativeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function cleanNullableString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 160) : null;
}

function upstreamError(message: unknown, status: number, fallback: string) {
  const error = new Error(typeof message === "string" && message.trim() ? message : `${fallback} (${status}).`) as Error & { status?: number };
  error.status = status;
  return error;
}
