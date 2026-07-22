import "server-only";

import { readSharedAgentEnv } from "@/lib/services/integrations/shared-env";
import { socialAdapter } from "@/lib/services/socials/adapters";
import {
  appendSocialMetricSnapshots,
  getSocialAccount,
  mutateSocialQueue,
  readSocialQueue,
  reserveSocialReadOps,
} from "@/lib/services/socials/socials-store";
import type { SocialMetricSnapshot } from "@/lib/services/socials/socials-types";

export async function refreshSocialAnalytics(accountId: string) {
  const account = await getSocialAccount(accountId);
  if (!account) throw new Error(`Unknown social account: ${accountId}`);
  const env = await readSharedAgentEnv();
  const adapter = socialAdapter(account.platform);
  const externalIds = (await readSocialQueue())
    .filter((item) => item.accountId === accountId && item.state === "posted" && item.result?.externalId)
    .map((item) => item.result!.externalId)
    .slice(0, 100);
  const meteredOperations = account.platform === "x" && account.method === "managed-oauth"
    ? 1 + (externalIds.length ? 1 : 0)
    : 0;
  const readBudget = meteredOperations
    ? await reserveSocialReadOps(account.id, meteredOperations, account.maxDailyReadOps, account.awakeHours.timezone)
    : undefined;
  const [postMetrics, accountMetrics] = await Promise.all([
    adapter.fetchPostMetrics(account, externalIds, { env }),
    adapter.fetchAccountMetrics(account, { env }),
  ]);
  const metricsById = new Map(postMetrics.map((row) => [row.externalId, row]));
  if (metricsById.size) {
    await mutateSocialQueue((queue) => queue.map((item) => {
      const metrics = item.result?.externalId ? metricsById.get(item.result.externalId)?.metrics : undefined;
      return metrics && item.result ? { ...item, result: { ...item.result, metrics }, updatedAt: new Date().toISOString() } : item;
    }));
  }
  const now = new Date().toISOString();
  const snapshots: SocialMetricSnapshot[] = [
    ...postMetrics.map((row) => ({ at: row.at, accountId, externalId: row.externalId, metrics: row.metrics })),
    ...(Object.keys(accountMetrics).length ? [{ at: now, accountId, metrics: accountMetrics }] : []),
  ];
  await appendSocialMetricSnapshots(snapshots);
  return { refreshedPosts: postMetrics.length, accountMetrics, at: now, ...(readBudget ? { readBudget } : {}) };
}
